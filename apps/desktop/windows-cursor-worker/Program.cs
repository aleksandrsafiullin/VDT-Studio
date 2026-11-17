using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

internal static class Program
{
    private const int MaxPromptBytes = 1024 * 1024;
    private const int MaxFrameCharacters = 6 * MaxPromptBytes + 4096;
    private const int MaxResultCharacters = 24 * MaxPromptBytes + 4096;
    private const int MaxOutputBytes = 4 * MaxPromptBytes;
    private static readonly Regex IdPattern = new Regex(@"\A[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}\z",RegexOptions.CultureInvariant);
    private static readonly JavaScriptSerializer Writer = new JavaScriptSerializer { MaxJsonLength=MaxResultCharacters, RecursionLimit=24 };

    private sealed class Message
    {
        internal Dictionary<string,object> Frame;
        internal string Id;
        internal CancellationToken Cancellation;
    }

    private sealed class Control
    {
        private readonly object mutex = new object();
        private readonly BlockingCollection<Message> queued = new BlockingCollection<Message>(1);
        private CancellationTokenSource active;
        private string activeId;
        private bool closing;
        internal bool Failed { get; private set; }

        internal void Read()
        {
            var parser = new JavaScriptSerializer { MaxJsonLength=MaxFrameCharacters, RecursionLimit=24 };
            try
            {
                string line;
                while ((line=ReadBoundedLine(Console.In)) != null)
                {
                    var frame = parser.Deserialize<Dictionary<string,object>>(line);
                    string op = ReadString(frame,"op",16);
                    if (op=="close")
                    {
                        ValidateFields(frame,"op");
                        return;
                    }
                    if (op=="cancel")
                    {
                        ValidateFields(frame,"op","id");
                        string id = ReadId(frame);
                        lock (mutex)
                        {
                            if (active != null && id==activeId) active.Cancel();
                        }
                        continue;
                    }

                    var message = new Message { Frame=frame };
                    lock (mutex)
                    {
                        if (closing || active!=null) throw new IOException("Concurrent worker request.");
                        if (op=="run" || op=="signIn")
                        {
                            message.Id = ReadId(frame);
                            activeId = message.Id;
                            active = new CancellationTokenSource();
                            message.Cancellation = active.Token;
                        }
                        if (!queued.TryAdd(message)) throw new IOException("Worker request queue is full.");
                    }
                }
            }
            catch (IOException) { Failed=true; }
            catch (ArgumentException) { Failed=true; }
            catch (InvalidOperationException) { Failed=true; }
            finally
            {
                lock (mutex)
                {
                    closing=true;
                    if (active!=null) active.Cancel();
                }
                queued.CompleteAdding();
            }
        }

        internal Message Next()
        {
            Message message;
            return queued.TryTake(out message,Timeout.Infinite) ? message : null;
        }

        internal void Complete()
        {
            lock (mutex)
            {
                if (active==null) return;
                active.Dispose();
                active=null;
                activeId=null;
            }
        }
    }

    private static string ReadBoundedLine(TextReader reader)
    {
        var line = new StringBuilder(4096);
        for (int next=reader.Read(); next!=-1; next=reader.Read())
        {
            if (next=='\n') return line.ToString().TrimEnd('\r');
            if (line.Length>=MaxFrameCharacters) throw new IOException("Worker frame exceeded its limit.");
            line.Append((char)next);
        }
        if (line.Length!=0) throw new IOException("Worker frame missing newline.");
        return null;
    }

    private static void ValidateFields(Dictionary<string,object> frame,params string[] required)
    {
        if (frame==null || frame.Count!=required.Length || required.Any(field=>!frame.ContainsKey(field)))
            throw new IOException("Unexpected frame fields.");
    }

    private static string ReadId(Dictionary<string,object> frame)
    {
        string id = ReadString(frame,"id",160);
        if (!IdPattern.IsMatch(id)) throw new IOException("Invalid request ID.");
        return id;
    }

    private static string ReadString(Dictionary<string,object> frame,string field,int max)
    {
        object raw;
        if (frame==null || !frame.TryGetValue(field,out raw)) throw new IOException("Field missing.");
        var value = raw as string;
        if (value==null || value.Length>max || value.IndexOf('\0')>=0) throw new IOException("Invalid string field.");
        return value;
    }

    private static int ReadNumber(Dictionary<string,object> frame,string field,int min,int max)
    {
        object raw;
        if (!frame.TryGetValue(field,out raw) || !(raw is int) || (int)raw<min || (int)raw>max)
            throw new IOException("Invalid integer field.");
        return (int)raw;
    }

    private static string[] ReadArguments(Dictionary<string,object> frame)
    {
        var values = frame["args"] as IList;
        if (values==null || values.Count>16) throw new IOException("Invalid argument list.");
        return values.Cast<object>().Select(value=>{
            string arg = value as string;
            if (arg==null || arg.Length>512 || arg.IndexOf('\0')>=0) throw new IOException("Invalid argument.");
            return arg;
        }).ToArray();
    }

    private static int Main(string[] args)
    {
        if (args.Length!=0) return 64;
        // LPAC can create a long virtual Temp subtree inside the owned state.
        AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling", false);
        AppContext.SetSwitch("Switch.System.IO.BlockLongPaths", false);
        Console.InputEncoding=new UTF8Encoding(false);
        Console.OutputEncoding=new UTF8Encoding(false);
        var control=new Control();
        Task.Factory.StartNew(control.Read,TaskCreationOptions.LongRunning);
        PrivateSession session=null;
        int status=0;
        string operation="open";
        string initialId=null;
        try
        {
            Message first = control.Next();
            if (first==null) return control.Failed ? 64 : 0;
            initialId=first.Id;
            var frame = first.Frame;
            operation=ReadString(frame,"op",16);
            if (operation=="locate")
            {
                ValidateFields(frame,"op","version");
                ReadNumber(frame,"version",2,2);
                Write(new {ok=true,op=operation,localData=PrivateSession.LocalData(),
                    systemRoot=PrivateSession.SystemRoot(),privateRoot=PrivateSession.SessionParent()});
                return 0;
            }
            if (operation=="authStatus")
            {
                ValidateFields(frame,"op","version");
                ReadNumber(frame,"version",2,2);
                Write(new {ok=true,op=operation,ready=DedicatedAuth.Available()});
                return 0;
            }
            if (operation=="measure") ValidateFields(frame,"op","version","payloadRoot","cliVersion");
            else if (operation=="open")
                ValidateFields(frame,"op","version","payloadRoot","cliVersion","payloadHash","policyHash","model","brokerPort");
            else if (operation=="signIn")
                ValidateFields(frame,"op","id","version","payloadRoot","cliVersion","payloadHash","policyHash");
            else throw new IOException("Unexpected initial operation.");
            int protocol = ReadNumber(frame,"version",operation=="signIn" ? 2 : 1,2);
            var identity = PrivateSession.Measure(ReadString(frame,"payloadRoot",260),ReadString(frame,"cliVersion",120),protocol);

            if (operation=="measure")
            {
                Write(new {ok=true,op="measure",cliVersion=identity.CliVersion,payloadHash=identity.PayloadHash,policyHash=identity.PolicyHash});
                return 0;
            }
            if (ReadString(frame,"payloadHash",71)!=identity.PayloadHash || ReadString(frame,"policyHash",71)!=identity.PolicyHash)
                throw new IOException("Admission identity drift.");
            if (operation=="signIn")
            {
                try
                {
                    DedicatedAuth.SignIn(identity,first.Cancellation);
                    Write(new {ok=true,op=operation,id=first.Id});
                }
                catch (OperationCanceledException) { Write(Error(operation,first.Id,"CURSOR_CHECKPOINT_CANCELLED")); }
                catch (DedicatedAuth.CleanupException)
                {
                    Write(Error(operation,first.Id,"CURSOR_CHECKPOINT_CLEANUP_UNCONFIRMED"));
                    return 75;
                }
                catch (Exception) { Write(Error(operation,first.Id,"CURSOR_CHECKPOINT_PROCESS_ERROR")); }
                finally { control.Complete(); }
                return 0;
            }
            session=new PrivateSession(identity,ReadString(frame,"model",160),ReadNumber(frame,"brokerPort",1,65535),protocol);
            Write(new {ok=true,op="open",workspacePath=session.Workspace,statePath=session.State,
                cliVersion=identity.CliVersion,payloadHash=identity.PayloadHash,policyHash=identity.PolicyHash});

            operation="run";
            Message message;
            while ((message=control.Next())!=null)
            {
                object response;
                try
                {
                    frame=message.Frame;
                    ValidateFields(frame,"op","id","args","stdin","timeoutMs","maxOutputBytes","vendorPolicyHash");
                    if (message.Id==null) throw new IOException("Expected run frame.");
                    string input=ReadString(frame,"stdin",MaxPromptBytes);
                    if (Encoding.UTF8.GetByteCount(input)>MaxPromptBytes) throw new IOException("Prompt limit.");
                    var result = session.Run(ReadArguments(frame),input,ReadNumber(frame,"timeoutMs",1,600000),
                        ReadNumber(frame,"maxOutputBytes",1,MaxOutputBytes),ReadString(frame,"vendorPolicyHash",71),message.Cancellation);
                    if (result.Cancelled) response=Error("run",message.Id,"CURSOR_CHECKPOINT_CANCELLED");
                    else if (result.TimedOut) response=Error("run",message.Id,"CURSOR_CHECKPOINT_TIMEOUT");
                    else if (result.OutputTooLarge) response=Error("run",message.Id,"CURSOR_CHECKPOINT_OUTPUT_TOO_LARGE");
                    else response=new {ok=true,op="run",id=message.Id,exitCode=unchecked((int)result.Exit),stdout=result.Stdout,stderr=result.Stderr};
                }
                catch (OperationCanceledException)
                {
                    response=Error("run",message.Id,"CURSOR_CHECKPOINT_CANCELLED");
                }
                catch (PrivateSession.CredentialDisclosureException)
                {
                    response=Error("run",message.Id,"SECURITY_BOUNDARY_BREACH");
                    status=70;
                }
                catch (Exception)
                {
                    response=Error("run",message.Id,AppContainerProcess.LastRunCleanupConfirmed ? "CURSOR_CHECKPOINT_PROCESS_ERROR" : "CURSOR_CHECKPOINT_CLEANUP_UNCONFIRMED");
                    status=70;
                }
                finally { control.Complete(); }
                Write(response);
                if(status!=0) break;
            }
            if (control.Failed && status==0) status=64;
        }
        catch (Exception)
        {
            Write(Error(operation,initialId,"CURSOR_CHECKPOINT_QUALIFICATION_MISMATCH"));
            status=64;
        }
        finally
        {
            if (session!=null && !session.Close()) status=75;
        }
        return status;
    }

    private static object Error(string operation,string id,string code)
    {
        if (id==null) return new {ok=false,op=operation,code=code};
        return new {ok=false,op=operation,id=id,code=code};
    }

    private static void Write(object response)
    {
        try { Console.WriteLine(Writer.Serialize(response)); Console.Out.Flush(); }
        catch (IOException) { }
    }
}
