using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

internal static class AppContainerProcess {
    static AppContainerProcess() { LastRunCleanupConfirmed = true; }
    [StructLayout(LayoutKind.Sequential)] struct Sa {
        public int size; public IntPtr descriptor; public int inherit;
    }
    [StructLayout(LayoutKind.Sequential)] struct PipeOverlapped {
        public IntPtr internalLow, internalHigh;
        public long offset;
        public IntPtr completedEvent;
    }
    [StructLayout(LayoutKind.Sequential)] struct SidAndAttributes {
        public IntPtr sid; public uint attributes;
    }
    [StructLayout(LayoutKind.Sequential)] struct Caps {
        public IntPtr sid, capabilities; public uint count, reserved;
    }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
        public int size; public string reserved, desktop, title;
        public int x,y,xSize,ySize,xChars,yChars,fill,flags;
        public short show, rsv2; public IntPtr rsvPtr, stdin, stdout, stderr;
    }
    [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup startup; public IntPtr list; }
    [StructLayout(LayoutKind.Sequential)] struct Pi { public IntPtr process, thread; public int pid, tid; }
    [StructLayout(LayoutKind.Sequential)] struct Limits {
        public long processTime, jobTime; public uint flags;
        public UIntPtr minWorking, maxWorking; public uint activeLimit;
        public UIntPtr affinity; public uint priority, scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct Io { public ulong readOps, writeOps, otherOps, readBytes, writeBytes, otherBytes; }
    [StructLayout(LayoutKind.Sequential)] struct JobLimits {
        public Limits basic; public Io io; public UIntPtr processMem, jobMem, peakProcess, peakJob;
    }
    [StructLayout(LayoutKind.Sequential)] struct JobAccounting {
        public long totalUser,totalKernel,periodUser,periodKernel;
        public uint pageFaults,totalProcesses,activeProcesses,terminatedProcesses;
    }
    public class Profile { public string Sid, Local; }
    internal sealed class Result {
        public uint Exit;
        public string Stdout, Stderr;
        public bool Cancelled, TimedOut, OutputTooLarge;
    }

    [DllImport("userenv.dll", CharSet=CharSet.Unicode)] static extern int CreateAppContainerProfile(string name,string display,string description,IntPtr capabilities,uint count,out IntPtr sid);
    [DllImport("userenv.dll", CharSet=CharSet.Unicode)] static extern int GetAppContainerFolderPath(string sid,out IntPtr path);
    [DllImport("userenv.dll", CharSet=CharSet.Unicode)] public static extern int DeleteAppContainerProfile(string name);
    [DllImport("advapi32.dll")] static extern IntPtr FreeSid(IntPtr sid);
    [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
    [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr token,int cls,IntPtr info,int bytes,out int returned);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref UIntPtr size);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,UIntPtr key,IntPtr value,UIntPtr size,IntPtr prev,IntPtr ret);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool CreatePipe(out IntPtr read,out IntPtr write,ref Sa attributes,uint size);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessW(string app,StringBuilder arguments,IntPtr p,IntPtr t,bool inherit,uint flags,IntPtr env,string cwd,ref StartupEx si,out Pi pi);
    [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr attributes,IntPtr name);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int cls,ref JobLimits limits,int length);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int cls,out JobAccounting accounting,int length,out int returned);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
    [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint exit);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string sddl,uint revision,out IntPtr descriptor,IntPtr size);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("kernelbase.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool DeriveCapabilitySidsFromName(
        string name,out IntPtr groupSids,out uint groupCount,out IntPtr capabilitySids,out uint capabilityCount);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateNamedPipeW(string name,uint openMode,uint pipeMode,uint maxInstances,uint outSize,uint inSize,uint timeout,ref Sa attrs);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFileW(string name,uint access,uint share,ref Sa attrs,uint disposition,uint flags,IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool ConnectNamedPipe(IntPtr pipe,IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool CancelIoEx(IntPtr handle,IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetOverlappedResult(IntPtr handle,IntPtr overlapped,out uint transferred,bool wait);

    static void PrivateDuplexPipe(out IntPtr server, out IntPtr client)
    {
        server=client=IntPtr.Zero;
        IntPtr descriptor;
        string user=WindowsIdentity.GetCurrent().User.Value;
        Check(ConvertStringSecurityDescriptorToSecurityDescriptorW("D:P(A;;GA;;;SY)(A;;GA;;;" + user + ")",1,out descriptor,IntPtr.Zero),"Private broker DACL");
        try {
            string name=@"\\.\pipe\VdtCursorInherited-" + Guid.NewGuid().ToString("N");
            Sa attrs=new Sa { size=Marshal.SizeOf(typeof(Sa)),descriptor=descriptor };
            IntPtr raw=CreateNamedPipeW(name,0x40080003,8,1,4096,4096,100,ref attrs);
            Check(raw.ToInt64()!=-1,"Create private broker server");
            server=raw;
            attrs.inherit=1;
            raw=CreateFileW(name,0xc0000000,0,ref attrs,3,0x40110000,IntPtr.Zero);
            Check(raw.ToInt64()!=-1,"Create private broker child endpoint");
            client=raw;
            // The child endpoint is already connected. Supply OVERLAPPED even
            // for the expected ERROR_PIPE_CONNECTED handshake.
            IntPtr overlapped=Struct(new PipeOverlapped());
            try {
                if(!ConnectNamedPipe(server,overlapped)) {
                    int code=Marshal.GetLastWin32Error();
                    if(code==997) {
                        // Never free an asynchronous buffer while the kernel still owns it.
                        CancelIoEx(server,overlapped);
                        uint transferred;
                        GetOverlappedResult(server,overlapped,out transferred,true);
                    }
                    if(code!=535) throw new Win32Exception(code,"Connect private broker");
                }
            } finally { Marshal.FreeHGlobal(overlapped); }
        } finally { LocalFree(descriptor); }
    }

    static async Task<bool> RelayToFixedBroker(IntPtr server,int brokerPort)
    {
        using (var handle = new SafePipeHandle(server,true))
        using (var pipe = new NamedPipeServerStream(PipeDirection.InOut,true,true,handle))
        {
            var buffer=new byte[4096];
            int size;
            try { size=await pipe.ReadAsync(buffer,0,buffer.Length).ConfigureAwait(false); }
            catch (IOException) { return true; }
            if (size==0) return true;

            using (var socket=new TcpClient(AddressFamily.InterNetwork))
            {
                await socket.ConnectAsync(IPAddress.Loopback,brokerPort).ConfigureAwait(false);
                using (var network=socket.GetStream())
                {
                    await network.WriteAsync(buffer,0,size).ConfigureAwait(false);
                    Task upstream=pipe.CopyToAsync(network,16*1024);
                    Task downstream=network.CopyToAsync(pipe,16*1024);
                    await Task.WhenAny(upstream,downstream).ConfigureAwait(false);
                    socket.Close();
                    pipe.Dispose();
                    Task drained = Task.WhenAll(upstream, downstream);
                    if (await Task.WhenAny(drained, Task.Delay(3000)).ConfigureAwait(false) != drained) return false;
                    // Closing the relay can cancel either copy. Both copies must settle.
                    try { await drained.ConfigureAwait(false); }
                    catch (IOException) { }
                    catch (ObjectDisposedException) { }
                    catch (OperationCanceledException) { }
                    return true;
                }
            }
        }
    }

    static IntPtr BuildNodeStdio(IntPtr[] handles)
    {
        // Match the pinned Node/libuv Win32 CRT descriptor layout.
        int count=handles.Length;
        IntPtr buffer=Marshal.AllocHGlobal(4+count+count*IntPtr.Size);
        Marshal.WriteInt32(buffer,count);
        for(int index=0;index<count;index++) {
            Marshal.WriteByte(buffer,4+index,0x09); // FOPEN | FPIPE.
            Marshal.WriteIntPtr(buffer,4+count+index*IntPtr.Size,handles[index]);
        }
        return buffer;
    }

    static void Check(bool ok,string stage) {
        if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error(),stage);
    }
    static void Close(ref IntPtr handle) { if (handle != IntPtr.Zero) { CloseHandle(handle); handle=IntPtr.Zero; } }
    internal static Profile NewProfile(string name) {
        IntPtr sid, folder=IntPtr.Zero;
        Marshal.ThrowExceptionForHR(CreateAppContainerProfile(name,name,"VDT Cursor isolated offline feasibility",IntPtr.Zero,0,out sid));
        try {
            string value=new SecurityIdentifier(sid).Value;
            Marshal.ThrowExceptionForHR(GetAppContainerFolderPath(value,out folder));
            return new Profile { Sid=value, Local=Marshal.PtrToStringUni(folder) };
        } catch { DeleteAppContainerProfile(name); throw; }
        finally { if(folder!=IntPtr.Zero) Marshal.FreeCoTaskMem(folder); FreeSid(sid); }
    }
    static IntPtr Block(byte[] bytes) {
        IntPtr p=Marshal.AllocHGlobal(bytes.Length); Marshal.Copy(bytes,0,p,bytes.Length); return p;
    }
    static IntPtr Struct<T>(T v) {
        IntPtr p=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(T))); Marshal.StructureToPtr(v,p,false); return p;
    }
    static void Attribute(IntPtr list,uint key,IntPtr value,int bytes) {
        Check(UpdateProcThreadAttribute(list,0,new UIntPtr(key),value,new UIntPtr((uint)bytes),IntPtr.Zero,IntPtr.Zero),"UpdateProcThreadAttribute "+key);
    }
    static string Quote(string arg) {
        var b=new StringBuilder("\""); int slashes=0;
        foreach(char ch in arg) {
            if(ch=='\\') { slashes++; continue; }
            b.Append('\\', ch=='"' ? slashes*2+1 : slashes).Append(ch); slashes=0;
        }
        return b.Append('\\',slashes*2).Append('"').ToString();
    }
    static int ReadTokenInt(IntPtr tok,int cls) {
        IntPtr p=Marshal.AllocHGlobal(4);
        try { int written; Check(GetTokenInformation(tok,cls,p,4,out written),"Token information "+cls); return Marshal.ReadInt32(p); }
        finally { Marshal.FreeHGlobal(p); }
    }
    static IntPtr RegistryReadCapability()
    {
        IntPtr groups, capabilities;
        uint groupCount, capabilityCount;
        Check(DeriveCapabilitySidsFromName("registryRead",out groups,out groupCount,out capabilities,out capabilityCount),"Resolve registryRead");
        try {
            if(capabilityCount!=1) throw new IOException("Unexpected capability SID count.");
            IntPtr sid=Marshal.ReadIntPtr(capabilities);
            Marshal.WriteIntPtr(capabilities,0,IntPtr.Zero);
            return sid;
        } finally {
            for(int i=0;i<groupCount;i++) LocalFree(Marshal.ReadIntPtr(groups,i*IntPtr.Size));
            for(int i=0;i<capabilityCount;i++) LocalFree(Marshal.ReadIntPtr(capabilities,i*IntPtr.Size));
            LocalFree(groups);
            LocalFree(capabilities);
        }
    }

    static bool VerifyToken(IntPtr process,string expected,IntPtr capability) {
        IntPtr tok; Check(OpenProcessToken(process,8,out tok),"Open process token");
        try {
            if(ReadTokenInt(tok,29)!=1) return false;
            int bytes; GetTokenInformation(tok,31,IntPtr.Zero,0,out bytes);
            if(bytes<=0 || bytes>4096) return false;
            IntPtr info=Marshal.AllocHGlobal(bytes);
            try {
                Check(GetTokenInformation(tok,31,info,bytes,out bytes),"Token AppContainer SID");
                if(new SecurityIdentifier(Marshal.ReadIntPtr(info)).Value!=expected) return false;
            } finally { Marshal.FreeHGlobal(info); }
            // TOKEN_MANDATORY_LABEL begins with its SID pointer.
            GetTokenInformation(tok,25,IntPtr.Zero,0,out bytes);
            if(bytes<IntPtr.Size || bytes>4096) return false;
            info=Marshal.AllocHGlobal(bytes);
            try {
                Check(GetTokenInformation(tok,25,info,bytes,out bytes),"AppContainer token integrity");
                if(new SecurityIdentifier(Marshal.ReadIntPtr(info)).Value!="S-1-16-4096") return false;
            } finally { Marshal.FreeHGlobal(info); }
            GetTokenInformation(tok,30,IntPtr.Zero,0,out bytes);
            if(bytes<4 || bytes>4096) return false;
            info=Marshal.AllocHGlobal(bytes);
            try {
                Check(GetTokenInformation(tok,30,info,bytes,out bytes),"Token network capabilities");
                int count=Marshal.ReadInt32(info);
                if(capability==IntPtr.Zero) return count==0;
                return count==1 && bytes>=IntPtr.Size*3 &&
                    new SecurityIdentifier(Marshal.ReadIntPtr(info,IntPtr.Size)).Equals(new SecurityIdentifier(capability));
            } finally { Marshal.FreeHGlobal(info); }
        } finally { Close(ref tok); }
    }
    static bool WaitEmpty(IntPtr job) {
        for(int i=0;i<30;i++) {
            int returned; JobAccounting info;
            Check(QueryInformationJobObject(job,1,out info,Marshal.SizeOf(typeof(JobAccounting)),out returned),"Job accounting");
            if(info.activeProcesses==0) return true;
            System.Threading.Thread.Sleep(100);
        }
        return false;
    }

    private sealed class OutputBudget
    {
        private readonly long maximum;
        private long used;
        public bool Exceeded { get; private set; }

        public OutputBudget(long maximum)
        {
            this.maximum = maximum;
        }

        public string Drain(IntPtr handle, IntPtr job)
        {
            using (var safe = new SafeFileHandle(handle, true))
            using (var stream = new FileStream(safe, FileAccess.Read))
            using (var data = new MemoryStream())
            {
                byte[] buffer = new byte[4096];
                int count;
                while ((count = stream.Read(buffer, 0, buffer.Length)) > 0)
                {
                    if (Interlocked.Add(ref used, count) > maximum)
                    {
                        Exceeded = true;
                        TerminateJobObject(job, 9);
                        return "";
                    }
                    data.Write(buffer, 0, count);
                }
                return Encoding.UTF8.GetString(data.ToArray());
            }
        }
    }

    private static void WriteInput(IntPtr handle, string input)
    {
        using (var safe = new SafeFileHandle(handle, true))
        using (var stream = new FileStream(safe, FileAccess.Write))
        {
            byte[] bytes = Encoding.UTF8.GetBytes(input);
            try { stream.Write(bytes, 0, bytes.Length); }
            catch (IOException) { } // Cursor may finish without consuming the complete prompt.
        }
    }

    // The browser is opened by the trusted worker outside this job. The job
    // owns every descendant of the credential-bearing CLI from before resume.
    internal static void RunDedicatedLogin(string exe, string entrypoint, string cwd,
        Dictionary<string,string> env, int timeoutMs, CancellationToken cancellation, Action<Stream> read)
    {
        IntPtr inputRead=IntPtr.Zero, inputWrite=IntPtr.Zero, outputRead=IntPtr.Zero, outputWrite=IntPtr.Zero;
        IntPtr list=IntPtr.Zero, handles=IntPtr.Zero, envBlock=IntPtr.Zero, job=IntPtr.Zero;
        bool initialized=false, assigned=false;
        var process = new Pi();
        Task reader = null;
        try
        {
            cancellation.ThrowIfCancellationRequested();
            var sa = new Sa { size=Marshal.SizeOf(typeof(Sa)), inherit=1 };
            Check(CreatePipe(out inputRead,out inputWrite,ref sa,0),"Login stdin pipe");
            Check(CreatePipe(out outputRead,out outputWrite,ref sa,0),"Login output pipe");
            Check(SetHandleInformation(outputRead,1,0),"Restrict login pipe inheritance");
            Close(ref inputWrite);
            UIntPtr size=UIntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref size);
            if (size.ToUInt64()==0 || size.ToUInt64()>65536) throw new IOException("Invalid login attribute list.");
            list=Marshal.AllocHGlobal((int)size.ToUInt64());
            Check(InitializeProcThreadAttributeList(list,1,0,ref size),"Initialize login attributes");
            initialized=true;
            handles=Marshal.AllocHGlobal(2*IntPtr.Size);
            Marshal.Copy(new[] {inputRead,outputWrite},0,handles,2);
            Attribute(list,0x20002,handles,2*IntPtr.Size);
            string vars=String.Join("\0",env.OrderBy(k=>k.Key,StringComparer.OrdinalIgnoreCase).Select(k=>k.Key+"="+k.Value))+"\0\0";
            envBlock=Block(Encoding.Unicode.GetBytes(vars));
            var startup = new StartupEx { list=list, startup=new Startup {
                size=Marshal.SizeOf(typeof(StartupEx)), flags=0x100,
                stdin=inputRead, stdout=outputWrite, stderr=outputWrite
            }};
            job=CreateJobObjectW(IntPtr.Zero,IntPtr.Zero);
            Check(job!=IntPtr.Zero,"Create dedicated login job");
            var limits=new JobLimits { basic=new Limits { flags=0x2000 | 0x8, activeLimit=1 } };
            Check(SetInformationJobObject(job,9,ref limits,Marshal.SizeOf(typeof(JobLimits))),"Configure dedicated login job");
            var args=new StringBuilder(Quote(exe)+" "+Quote(entrypoint)+" login");
            Check(CreateProcessW(exe,args,IntPtr.Zero,IntPtr.Zero,true,0x08080404,envBlock,cwd,ref startup,out process),
                "Create suspended dedicated login");
            Check(AssignProcessToJobObject(job,process.process),"Assign dedicated login job");
            assigned=true;
            Close(ref inputRead);
            Close(ref outputWrite);
            IntPtr readerHandle=outputRead;
            reader=Task.Factory.StartNew(()=>{
                using (var handle=new SafeFileHandle(readerHandle,true))
                using (var stream=new FileStream(handle,FileAccess.Read)) read(stream);
            },TaskCreationOptions.LongRunning);
            outputRead=IntPtr.Zero;
            cancellation.ThrowIfCancellationRequested();
            Check(ResumeThread(process.thread)!=0xffffffff,"Resume dedicated login");
            var clock=Stopwatch.StartNew();
            while (true)
            {
                cancellation.ThrowIfCancellationRequested();
                uint wait=WaitForSingleObject(process.process,50);
                if (wait==0) break;
                if (wait!=258 || reader.IsFaulted || clock.ElapsedMilliseconds>=timeoutMs)
                    throw new IOException("Dedicated login process did not complete.");
            }
            uint code;
            Check(GetExitCodeProcess(process.process,out code),"Read dedicated login exit status");
            if (code!=0) throw new IOException("Dedicated login did not succeed.");
        }
        finally
        {
            try
            {
                if (process.process!=IntPtr.Zero)
                {
                    bool reaped;
                    try {
                        if (assigned)
                        {
                            TerminateJobObject(job,9);
                            reaped=WaitEmpty(job);
                        }
                        else
                        {
                            TerminateProcess(process.process,9);
                            reaped=WaitForSingleObject(process.process,3000)==0;
                        }
                    }
                    catch { throw new DedicatedAuth.CleanupException(); }
                    if (!reaped) throw new DedicatedAuth.CleanupException();
                }
                Close(ref outputWrite);
                if (reader!=null && !reader.Wait(2000)) throw new DedicatedAuth.CleanupException();
            }
            finally
            {
                Close(ref inputRead);
                Close(ref inputWrite);
                Close(ref outputRead);
                Close(ref outputWrite);
                Close(ref process.process);
                Close(ref process.thread);
                Close(ref job);
                if (initialized) DeleteProcThreadAttributeList(list);
                if (list!=IntPtr.Zero) Marshal.FreeHGlobal(list);
                if (handles!=IntPtr.Zero) Marshal.FreeHGlobal(handles);
                if (envBlock!=IntPtr.Zero) Marshal.FreeHGlobal(envBlock);
            }
        }
    }

    internal static bool LastRunCleanupConfirmed { get; private set; }

    internal static Result Run(string sid, string exe, string[] argv, string cwd, Dictionary<string,string> env,
        string input, int timeoutMs, int maxOutputBytes, int brokerPort, CancellationToken cancellation)
    {
        // Descriptors are single-use across this process. The broker has its
        // own concurrent connection limit and can reuse slots after draining.
        const int relayCount = 64;
        const int jobKillOnClose = 0x2000;
        const int jobActiveProcessLimit = 0x8;
        const uint createSuspendedExtendedUnicodeNoWindow = 0x08080404;
        const uint securityCapabilitiesAttribute = 0x20009;
        const uint allApplicationPackagesPolicyAttribute = 0x2000F;
        const uint handleListAttribute = 0x20002;

        LastRunCleanupConfirmed = true;
        IntPtr inputRead = IntPtr.Zero, inputWrite = IntPtr.Zero;
        IntPtr outputRead = IntPtr.Zero, outputWrite = IntPtr.Zero;
        IntPtr errorRead = IntPtr.Zero, errorWrite = IntPtr.Zero;
        IntPtr list = IntPtr.Zero, job = IntPtr.Zero, sidBytes = IntPtr.Zero, caps = IntPtr.Zero;
        IntPtr policy = IntPtr.Zero, handles = IntPtr.Zero, envBlock = IntPtr.Zero, nodeStdio = IntPtr.Zero;
        IntPtr capability = IntPtr.Zero, capabilityEntry = IntPtr.Zero;
        var relayParents = new IntPtr[relayCount];
        var relayChildren = new IntPtr[relayCount];
        var relays = new List<Task<bool>>();
        var streams = new List<Task>();
        var budget = new OutputBudget(maxOutputBytes);
        var result = new Result();
        var pi = new Pi();
        bool initialized = false, assigned = false;

        try
        {
            cancellation.ThrowIfCancellationRequested();
            Sa sa = new Sa { size = Marshal.SizeOf(typeof(Sa)), inherit = 1 };
            Check(CreatePipe(out inputRead,out inputWrite,ref sa,0),"stdin pipe");
            Check(CreatePipe(out outputRead,out outputWrite,ref sa,0),"stdout pipe");
            Check(CreatePipe(out errorRead,out errorWrite,ref sa,0),"stderr pipe");
            Check(SetHandleInformation(inputWrite,1,0) && SetHandleInformation(outputRead,1,0) &&
                SetHandleInformation(errorRead,1,0),"Restrict parent pipe inheritance");

            UIntPtr size = UIntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero,3,0,ref size);
            if (size.ToUInt64() == 0 || size.ToUInt64() > 65536) throw new IOException("Invalid attribute list size.");
            list = Marshal.AllocHGlobal((int)size.ToUInt64());
            Check(InitializeProcThreadAttributeList(list,3,0,ref size),"Initialize process attributes");
            initialized = true;

            var sidObject = new SecurityIdentifier(sid);
            var sidBuffer = new byte[sidObject.BinaryLength];
            sidObject.GetBinaryForm(sidBuffer,0);
            sidBytes = Block(sidBuffer);
            capability = RegistryReadCapability();
            capabilityEntry = Struct(new SidAndAttributes { sid = capability, attributes = 4 });
            caps = Struct(new Caps { sid = sidBytes, capabilities = capabilityEntry, count = 1 });
            Attribute(list,securityCapabilitiesAttribute,caps,Marshal.SizeOf(typeof(Caps)));
            policy = Block(new byte[] { 1,0,0,0 });
            Attribute(list,allApplicationPackagesPolicyAttribute,policy,4);

            for (int i = 0; i < relayCount; i++) PrivateDuplexPipe(out relayParents[i],out relayChildren[i]);
            IntPtr[] inherited = new[] { inputRead,outputWrite,errorWrite }.Concat(relayChildren).ToArray();
            handles = Marshal.AllocHGlobal(IntPtr.Size * inherited.Length);
            Marshal.Copy(inherited,0,handles,inherited.Length);
            Attribute(list,handleListAttribute,handles,IntPtr.Size * inherited.Length);
            nodeStdio = BuildNodeStdio(inherited);
            string vars = String.Join("\0",env.OrderBy(k => k.Key,StringComparer.OrdinalIgnoreCase).Select(k => k.Key+"="+k.Value))+"\0\0";
            envBlock = Block(Encoding.Unicode.GetBytes(vars));
            var startup = new StartupEx {
                list = list,
                startup = new Startup {
                    size = Marshal.SizeOf(typeof(StartupEx)), flags = 0x100,
                    stdin = inputRead, stdout = outputWrite, stderr = errorWrite,
                    rsvPtr = nodeStdio, rsv2 = (short)(4+inherited.Length*(1+IntPtr.Size))
                }
            };

            job = CreateJobObjectW(IntPtr.Zero,IntPtr.Zero);
            Check(job != IntPtr.Zero,"Create worker job");
            var limits = new JobLimits { basic = new Limits { flags = jobKillOnClose | jobActiveProcessLimit, activeLimit = 1 } };
            Check(SetInformationJobObject(job,9,ref limits,Marshal.SizeOf(typeof(JobLimits))),"Configure worker job");
            var args = new StringBuilder(String.Join(" ",new[] { exe }.Concat(argv).Select(Quote)));
            Check(CreateProcessW(exe,args,IntPtr.Zero,IntPtr.Zero,true,createSuspendedExtendedUnicodeNoWindow,envBlock,cwd,ref startup,out pi),
                "Create suspended LPAC worker");
            LastRunCleanupConfirmed = false;
            Check(AssignProcessToJobObject(job,pi.process),"Assign job before resume");
            assigned = true;
            if (!VerifyToken(pi.process,sid,capability)) throw new IOException("Unexpected LPAC token.");

            Close(ref inputRead);
            Close(ref outputWrite);
            Close(ref errorWrite);
            IntPtr inputHandle = inputWrite, stdoutHandle = outputRead, stderrHandle = errorRead, ownedJob = job;
            inputWrite = outputRead = errorRead = IntPtr.Zero;
            streams.Add(Task.Factory.StartNew(() => WriteInput(inputHandle,input),TaskCreationOptions.LongRunning));
            var stdout = Task.Factory.StartNew(() => budget.Drain(stdoutHandle,ownedJob),TaskCreationOptions.LongRunning);
            var stderr = Task.Factory.StartNew(() => budget.Drain(stderrHandle,ownedJob),TaskCreationOptions.LongRunning);
            streams.Add(stdout);
            streams.Add(stderr);
            for (int i = 0; i < relayCount; i++)
            {
                Close(ref relayChildren[i]);
                IntPtr relay = relayParents[i];
                relayParents[i] = IntPtr.Zero;
                relays.Add(RelayToFixedBroker(relay,brokerPort));
            }

            cancellation.ThrowIfCancellationRequested();
            Check(ResumeThread(pi.thread) != 0xffffffff,"Resume LPAC worker");
            var clock = Stopwatch.StartNew();
            uint wait;
            do {
                wait = WaitForSingleObject(pi.process,50);
                if (wait != 0 && wait != 258) throw new IOException("Worker wait failed.");
            } while (wait == 258 && clock.ElapsedMilliseconds < timeoutMs && !cancellation.IsCancellationRequested);

            result.Cancelled = cancellation.IsCancellationRequested;
            result.TimedOut = wait == 258 && !result.Cancelled;
            Check(TerminateJobObject(job,9),"Terminate remaining worker processes");
            if (!WaitEmpty(job) || !WaitAll(streams,3000) || !WaitAll(relays.Cast<Task>().ToList(),5000))
                throw new IOException("Worker process or pipe cleanup unconfirmed.");
            LastRunCleanupConfirmed = true;
            Check(GetExitCodeProcess(pi.process,out result.Exit),"Read worker exit code");
            result.OutputTooLarge = budget.Exceeded;
            result.Stdout = stdout.Result;
            result.Stderr = stderr.Result;
            if (relays.Any(task => !task.Result)) throw new IOException("Worker proxy relay failed.");
            return result;
        }
        finally
        {
            if (pi.process != IntPtr.Zero && !LastRunCleanupConfirmed)
            {
                try {
                    bool processDone;
                    if (assigned) processDone = TerminateJobObject(job,9) && WaitEmpty(job);
                    else processDone = TerminateProcess(pi.process,9) && WaitForSingleObject(pi.process,3000) == 0;
                    LastRunCleanupConfirmed = processDone && WaitAll(streams,3000) && WaitAll(relays.Cast<Task>().ToList(),5000);
                } catch { LastRunCleanupConfirmed = false; }
            }
            for (int i = 0; i < relayCount; i++)
            {
                Close(ref relayChildren[i]);
                Close(ref relayParents[i]);
            }
            Close(ref pi.process);
            Close(ref pi.thread);
            Close(ref job);
            Close(ref inputRead);
            Close(ref inputWrite);
            Close(ref outputRead);
            Close(ref outputWrite);
            Close(ref errorRead);
            Close(ref errorWrite);
            if (initialized) DeleteProcThreadAttributeList(list);
            if (capability != IntPtr.Zero) LocalFree(capability);
            foreach (IntPtr allocation in new[] { list,sidBytes,caps,policy,handles,envBlock,nodeStdio,capabilityEntry })
                if (allocation != IntPtr.Zero) Marshal.FreeHGlobal(allocation);
        }
    }

    private static bool WaitAll(List<Task> tasks, int timeout)
    {
        try { return Task.WaitAll(tasks.ToArray(),timeout); }
        catch (AggregateException) { return tasks.All(task => task.IsCompleted); }
    }
}
