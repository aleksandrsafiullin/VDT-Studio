using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

internal sealed class PrivateSession
{
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)]
    private static extern bool DeleteFile(string path);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)]
    private static extern bool RemoveDirectory(string path);

    internal const string PolicyIdentity = "vdt-windows-cursor-lpac-v1";
    private const string PreloadSha = "2da495306c89474b56fc0c6ca8924329c3e17cc9e3b8162e8df495dfaec6ff0e";
    private const string CheckpointPolicy = "{\"version\":1,\"editor\":{\"vimMode\":false},\"approvalMode\":\"allowlist\",\"permissions\":{\"allow\":[],\"deny\":[\"Shell(*)\",\"Read(**)\",\"Read(/**)\",\"Write(**)\",\"Write(/**)\",\"Mcp(*:*)\",\"WebFetch(*)\"]},\"sandbox\":{\"mode\":\"disabled\",\"readBoundary\":\"workspace\"}}";
    private static readonly Regex VersionPattern = new Regex(@"\A[0-9]{4}\.[0-9]{1,2}\.[0-9]{1,2}(?:-[0-9]{2}-[0-9]{2}-[0-9]{2})?-[a-f0-9]{4,40}\z", RegexOptions.CultureInvariant);
    private static readonly Regex ModelPattern = new Regex(@"\A[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}\z", RegexOptions.CultureInvariant);
    private static readonly SecurityIdentifier Owner = WindowsIdentity.GetCurrent().User;
    private static readonly SecurityIdentifier OperatingSystem = new SecurityIdentifier("S-1-5-18");

    private readonly string root;
    private readonly string profile;
    private readonly string packageSid;
    private readonly string payload;
    private readonly string vendorConfig;
    private readonly string model;
    private readonly int brokerPort;
    private bool launched;
    private bool credentialsSeeded;
    private readonly HashSet<string> credentialValues = new HashSet<string>(StringComparer.Ordinal);

    internal string Workspace { get; private set; }
    internal string State { get; private set; }

    internal sealed class Identity
    {
        internal string Source, CliVersion, PayloadHash, PolicyHash, Preload;
    }

    internal static Identity Measure(string source, string version, int protocol)
    {
        if (!VersionPattern.IsMatch(version)) throw new IOException("Invalid vendor version.");
        string official = Path.Combine(LocalData(), "cursor-agent", "versions", version);
        official = DirectoryPath(official);
        if (!StringComparer.OrdinalIgnoreCase.Equals(DirectoryPath(source), official))
            throw new IOException("Unexpected vendor source.");
        RequirePlainFile(Path.Combine(official,"node.exe"));
        RequirePlainFile(Path.Combine(official,"index.js"));
        string preload = Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"proxy-preload.cjs");
        RequirePlainFile(preload);
        if (ShaFile(preload) != PreloadSha) throw new IOException("Unexpected proxy preload.");
        string executable = Process.GetCurrentProcess().MainModule.FileName;
        RequirePlainFile(executable);
        return new Identity {
            Source=official, CliVersion=version, PayloadHash=Inventory(official,null), Preload=preload,
            PolicyHash=protocol == 2 ? StandardPolicy.Identity :
                "sha256:" + Sha(Encoding.UTF8.GetBytes(PolicyIdentity+"\n"+ShaFile(executable)+"\n"+PreloadSha+"\n"))
        };
    }

    internal PrivateSession(Identity expected, string model, int brokerPort, int protocol)
    {
        if (!ModelPattern.IsMatch(model) || model == "auto") throw new IOException("Invalid model.");
        this.model = model;
        this.brokerPort = brokerPort;
        profile = "VdtCursorSession" + Guid.NewGuid().ToString("N");
        root = Path.Combine(protocol == 2 ? SessionParent() : DirectoryPath(Path.GetTempPath()),profile);
        if (Directory.Exists(root) || File.Exists(root)) throw new IOException("Private root collision.");

        bool profileCreated = false;
        bool rootCreated = false;
        try
        {
            packageSid = AppContainerProcess.NewProfile(profile).Sid;
            profileCreated = true;
            Directory.CreateDirectory(root, OwnedDirectoryAcl());
            rootCreated = true;
            var sid = new SecurityIdentifier(packageSid);
            SetAcl(root,sid,FileSystemRights.Traverse);
            payload = PrepareDirectory("payload",sid,FileSystemRights.ReadAndExecute);
            string policy = PrepareDirectory("policy",sid,FileSystemRights.ReadAndExecute);
            vendorConfig = Path.Combine(policy,"cli-config.json");
            File.WriteAllText(vendorConfig,CheckpointPolicy,new UTF8Encoding(false));
            // Cursor persists resumable chats next to the selected config.
            // Give only that child directory write access. The policy files
            // and their parent retain the read-only package ACL.
            string chats = PrepareDirectory(Path.Combine("policy","chats"),sid,FileSystemRights.Modify);
            SetLowIntegrity(chats);
            State = PrepareDirectory("state",sid,FileSystemRights.Modify);
            Workspace = PrepareDirectory("workspace",sid,FileSystemRights.ReadAndExecute);
            SetLowIntegrity(State);
            if (Inventory(expected.Source,payload) != expected.PayloadHash ||
                Inventory(payload,null) != expected.PayloadHash)
                throw new IOException("Vendor payload changed while staging.");
            string preloadCopy = Path.Combine(policy,"proxy-preload.cjs");
            File.Copy(expected.Preload,preloadCopy);
            if (ShaFile(preloadCopy) != PreloadSha) throw new IOException("Proxy preload changed while staging.");
        }
        catch
        {
            if (rootCreated) TryRemoveRoot(root);
            if (profileCreated) AppContainerProcess.DeleteAppContainerProfile(profile);
            throw;
        }
    }

    internal AppContainerProcess.Result Run(string[] args, string input, int deadline, int maxOutput,
        string vendorPolicyHash, CancellationToken cancellation)
    {
        RequireCheckpointArgs(args);
        if (Directory.EnumerateFileSystemEntries(Workspace).Any()) throw new IOException("Workspace is no longer empty.");
        string supplied = Path.Combine(DirectoryPath(Path.Combine(State,"cursor-config")),"cli-config.json");
        var suppliedInfo = RequirePlainFile(supplied);
        string expectedPolicy = "sha256:" + Sha(Encoding.UTF8.GetBytes(CheckpointPolicy));
        if (suppliedInfo.Length > 4096 || vendorPolicyHash != expectedPolicy ||
            "sha256:" + ShaFile(supplied) != expectedPolicy || "sha256:" + ShaFile(vendorConfig) != expectedPolicy)
            throw new IOException("Unexpected vendor policy.");

        foreach (string subdirectory in new[] { "appdata", "localappdata", "temp" })
            DirectoryPath(Directory.CreateDirectory(Path.Combine(State,subdirectory)).FullName);
        string auth = SeedCredentials();
        string system = Path.GetDirectoryName(Environment.SystemDirectory);
        var environment = new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase) {
            {"SystemRoot",system}, {"WINDIR",system}, {"PATH",Environment.SystemDirectory},
            {"HOME",State}, {"USERPROFILE",State},
            {"APPDATA",Path.Combine(State,"appdata")}, {"LOCALAPPDATA",Path.Combine(State,"localappdata")},
            {"TEMP",Path.Combine(State,"temp")}, {"TMP",Path.Combine(State,"temp")},
            {"CURSOR_CONFIG_DIR",Path.GetDirectoryName(vendorConfig)}, {"CURSOR_INVOKED_AS","agent.cmd"},
            {"AGENT_CLI_CREDENTIAL_STORE","file"},
            {"NODE_DISABLE_COMPILE_CACHE","1"}, {"NODE_USE_ENV_PROXY","1"},
            {"HTTP_PROXY","http://127.0.0.1:1"}, {"HTTPS_PROXY","http://127.0.0.1:1"}
        };
        var nodeArgs = new[] {
            "--preserve-symlinks", "--preserve-symlinks-main",
            // libuv 1.52 can spin constructing child stdio pipes in an AppContainer
            // before Windows rejects process creation. Deny the Node child API first.
            // Files, worker threads and native modules remain under the LPAC and Job.
            "--permission", "--allow-fs-read=*", "--allow-fs-write=*",
            "--allow-worker", "--allow-addons", "--allow-wasi", "--require",
            Path.Combine(Path.GetDirectoryName(vendorConfig),"proxy-preload.cjs"), Path.Combine(payload,"index.js")
        }.Concat(args).Concat(new[] {"--sandbox","disabled"}).ToArray();
        launched = true;
        var result = AppContainerProcess.Run(packageSid,Path.Combine(payload,"node.exe"),nodeArgs,Workspace,environment,
            input,deadline,maxOutput,brokerPort,cancellation);
        // A refresh can replace the in-session file. Screen both its current
        // opaque credential values and the initial seed before returning output.
        if (File.Exists(auth)) ReadCredentialFile(auth);
        if (credentialValues.Any(secret=>result.Stdout.Contains(secret) || result.Stderr.Contains(secret)))
            throw new CredentialDisclosureException();
        return result;
    }

    internal sealed class CredentialDisclosureException : Exception { }

    private string SeedCredentials()
    {
        string directory = DirectoryPath(Directory.CreateDirectory(Path.Combine(State,"appdata","Cursor")).FullName);
        string destination = Path.Combine(directory,"auth.json");
        if (credentialsSeeded)
        {
            ReadCredentialFile(destination);
            return destination;
        }

        string source = AuthSource();
        byte[] bytes = ReadCredentialFile(source);
        using (var target = new FileStream(destination,FileMode.CreateNew,FileAccess.Write,FileShare.None))
            target.Write(bytes,0,bytes.Length);
        credentialsSeeded = true;
        return destination;
    }

    internal static string LocalData()
    {
        return DirectoryPath(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData));
    }

    internal static string SystemRoot()
    {
        return DirectoryPath(Path.GetDirectoryName(Environment.SystemDirectory));
    }

    internal static string SessionParent()
    {
        return OwnedDirectory(OwnedDirectory(LocalData(), "VDT Cursor"), "Sessions");
    }

    internal static DirectorySecurity OwnedDirectoryAcl()
    {
        var acl = new DirectorySecurity();
        acl.SetOwner(Owner);
        acl.SetAccessRuleProtection(true, false);
        foreach (var sid in new[] { Owner, OperatingSystem })
            acl.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        return acl;
    }

    internal static string OwnedDirectory(string parent, string name)
    {
        string directory = Path.Combine(DirectoryPath(parent), name);
        Directory.CreateDirectory(directory, OwnedDirectoryAcl());
        directory = DirectoryPath(directory);
        RequireOwnedAccess(Directory.GetAccessControl(directory), true);
        return directory;
    }

    internal static string AuthDirectory(bool create)
    {
        string product = Path.Combine(LocalData(), "VDT Studio");
        if (create && !Directory.Exists(product)) Directory.CreateDirectory(product, OwnedDirectoryAcl());
        product = DirectoryPath(product);
        string current = product;
        foreach (var name in new[] { "Cursor Auth", "roaming", "Cursor" })
        {
            current = Path.Combine(current, name);
            if (create && !Directory.Exists(current)) Directory.CreateDirectory(current, OwnedDirectoryAcl());
            current = DirectoryPath(current);
            RequireOwnedAccess(Directory.GetAccessControl(current), name == "Cursor Auth");
        }
        return current;
    }

    internal static string AuthSource()
    {
        string source = Path.Combine(AuthDirectory(false), "auth.json");
        RequireOwnedAccess(RequirePlainFile(source).GetAccessControl(), false);
        return source;
    }

    internal static void RequireOwnedAccess(FileSystemSecurity security,bool protectedRoot)
    {
        if (!Owner.Equals(security.GetOwner(typeof(SecurityIdentifier))) ||
            (protectedRoot && !security.AreAccessRulesProtected))
            throw new IOException("Cursor auth ownership is not private.");
        var rules = security.GetAccessRules(true,true,typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>();
        if (rules.Any(rule=>rule.AccessControlType==AccessControlType.Allow &&
            !Owner.Equals(rule.IdentityReference) && !OperatingSystem.Equals(rule.IdentityReference)))
            throw new IOException("Cursor auth access is not private.");
    }

    private byte[] ReadCredentialFile(string path)
    {
        return ReadCredentialFile(path, credentialValues);
    }

    internal static byte[] ReadCredentialFile(string path, HashSet<string> values)
    {
        RequirePlainFile(path);
        byte[] bytes;
        using (var source = new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.Read))
        {
            if (source.Length<=0 || source.Length>64*1024) throw new IOException("Unexpected auth file size.");
            using (var content = new BinaryReader(source)) bytes = content.ReadBytes((int)source.Length);
        }
        var parser = new JavaScriptSerializer { MaxJsonLength=64*1024,RecursionLimit=12 };
        var raw = parser.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(bytes));
        int found=0;
        CollectCredentialValues(raw, values, ref found);
        if (found==0) throw new IOException("Dedicated auth state is empty.");
        return bytes;
    }

    private static void CollectCredentialValues(object item, HashSet<string> values, ref int found)
    {
        var value=item as string;
        if (value!=null)
        {
            if (value.Length>=8)
            {
                if (++found>256 || values.Count>=1024) throw new IOException("Unexpected auth format.");
                values.Add(value);
            }
            return;
        }
        var map=item as IDictionary;
        if (map!=null)
        {
            foreach (object child in map.Values) CollectCredentialValues(child, values, ref found);
            return;
        }
        var list=item as IList;
        if (list!=null)
            foreach (object child in list) CollectCredentialValues(child, values, ref found);
    }

    private void RequireCheckpointArgs(string[] supplied)
    {
        string[] prefix = { "--print", "--output-format", "stream-json", "--stream-partial-output", "--mode", "ask", "--workspace" };
        if (supplied.Length < prefix.Length + 3 || !supplied.Take(prefix.Length).SequenceEqual(prefix) ||
            !StringComparer.OrdinalIgnoreCase.Equals(supplied[prefix.Length],Workspace))
            throw new IOException("Unrecognized checkpoint command.");
        int index = prefix.Length + 1;
        if (supplied[index] == "--trust") index++;
        if (supplied.Length < index+2 || supplied[index] != "--model" || supplied[index+1] != model)
            throw new IOException("Checkpoint model differs from declared model.");
        index += 2;
        if (index == supplied.Length) return;
        if (supplied.Length != index+2 || supplied[index] != "--resume" ||
            !Regex.IsMatch(supplied[index+1],@"\A[a-zA-Z0-9][a-zA-Z0-9._:-]{0,511}\z"))
            throw new IOException("Unrecognized checkpoint resume.");
    }

    internal bool Close()
    {
        if (launched && !AppContainerProcess.LastRunCleanupConfirmed) return false;
        bool filesDeleted = TryRemoveRoot(root);
        bool profileDeleted = AppContainerProcess.DeleteAppContainerProfile(profile) == 0;
        return filesDeleted && profileDeleted;
    }

    internal static bool TryRemoveRoot(string root)
    {
        try
        {
            // AppContainer's package temp adds enough nesting to exceed MAX_PATH.
            var directory = new DirectoryInfo(@"\\?\" + root);
            var entries = new List<FileSystemInfo>();
            if (!Owner.Equals(directory.GetAccessControl(AccessControlSections.Owner).GetOwner(typeof(SecurityIdentifier))))
                return false;
            CollectCleanupEntries(directory, entries);
            foreach (var entry in entries)
            {
                var attributes = File.GetAttributes(entry.FullName);
                if ((attributes & FileAttributes.ReparsePoint) != 0) return false;
                bool deleted = (attributes & FileAttributes.Directory) != 0
                    ? RemoveDirectory(entry.FullName)
                    : DeleteFile(entry.FullName);
                if (!deleted) return false;
            }
            return true;
        }
        catch (IOException) { return false; }
        catch (UnauthorizedAccessException) { return false; }
    }

    private string PrepareDirectory(string name, SecurityIdentifier package, FileSystemRights rights)
    {
        string directory = Directory.CreateDirectory(Path.Combine(root,name)).FullName;
        SetAcl(directory,package,rights);
        return directory;
    }

    private static void SetAcl(string directory, SecurityIdentifier package, FileSystemRights rights)
    {
        var acl = new DirectorySecurity();
        acl.SetOwner(Owner);
        acl.SetAccessRuleProtection(true,false);
        foreach (var principal in new[] { Owner, OperatingSystem, package })
        {
            acl.AddAccessRule(new FileSystemAccessRule(principal, principal.Equals(package) ? rights : FileSystemRights.FullControl,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        }
        Directory.SetAccessControl(directory,acl);
    }

    private static void SetLowIntegrity(string directory)
    {
        var start = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory,"icacls.exe"),
            "\"" + directory + "\" /setintegritylevel (OI)(CI)L");
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.RedirectStandardOutput = true;
        start.RedirectStandardError = true;
        using (var child = Process.Start(start))
        {
            child.OutputDataReceived += (sender, value) => { };
            child.ErrorDataReceived += (sender, value) => { };
            child.BeginOutputReadLine();
            child.BeginErrorReadLine();
            if (!child.WaitForExit(5000))
            {
                child.Kill();
                child.WaitForExit();
                throw new IOException("Private integrity-label setup timed out.");
            }
            if (child.ExitCode != 0) throw new IOException("Private integrity-label setup failed.");
        }
    }

    internal static string DirectoryPath(string value)
    {
        if (String.IsNullOrWhiteSpace(value) || value.Length > 260 || value.Length < 4 ||
            value[1]!=':' || (value[2]!='\\' && value[2]!='/') || value.IndexOf(':',2)>=0)
            throw new IOException("Expected a local drive path.");
        string absolute = Path.GetFullPath(value.TrimEnd('\\','/'));
        for (var item = new DirectoryInfo(absolute); item != null; item = item.Parent)
            if (!item.Exists || (item.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new IOException("Unsafe directory path.");
        return absolute;
    }

    internal static FileInfo RequirePlainFile(string path)
    {
        var info = new FileInfo(path);
        if (!info.Exists || (info.Attributes & FileAttributes.ReparsePoint) != 0)
            throw new IOException("Unsafe file path.");
        return info;
    }

    internal static string Inventory(string source, string copy, CancellationToken cancellation = default(CancellationToken))
    {
        var values = new SortedDictionary<string,string>(StringComparer.Ordinal);
        long size = 0;
        int count = 0;
        Queue<string> directories = new Queue<string>();
        directories.Enqueue(source);
        while (directories.Count != 0)
        {
            var directory = new DirectoryInfo(directories.Dequeue());
            foreach (var child in directory.EnumerateFileSystemInfos())
            {
                cancellation.ThrowIfCancellationRequested();
                if (++count > 10000 || (child.Attributes & FileAttributes.ReparsePoint) != 0)
                    throw new IOException("Unexpected vendor payload entry.");
                string relative = child.FullName.Substring(source.Length+1);
                string target = copy == null ? null : Path.Combine(copy,relative);
                var folder = child as DirectoryInfo;
                if (folder != null)
                {
                    if (target != null) Directory.CreateDirectory(target);
                    directories.Enqueue(folder.FullName);
                    continue;
                }
                size += ((FileInfo)child).Length;
                if (size > 1024L * 1024L * 1024L) throw new IOException("Vendor payload exceeded its size limit.");
                string contentHash = ShaFile(child.FullName);
                if (target != null) File.Copy(child.FullName,target);
                values.Add(relative.Replace('\\','/'),contentHash);
            }
        }
        var inventory = new StringBuilder();
        foreach (var item in values) inventory.Append(item.Key).Append('\0').Append(item.Value).Append('\n');
        return "sha256:" + Sha(Encoding.UTF8.GetBytes(inventory.ToString()));
    }

    private static string ShaFile(string path)
    {
        using (var sha = SHA256.Create())
        using (var file = File.OpenRead(path)) return Hex(sha.ComputeHash(file));
    }

    private static string Sha(byte[] bytes)
    {
        using (var sha = SHA256.Create()) return Hex(sha.ComputeHash(bytes));
    }

    private static string Hex(byte[] bytes) { return BitConverter.ToString(bytes).Replace("-","").ToLowerInvariant(); }

    private static void CollectCleanupEntries(DirectoryInfo directory, List<FileSystemInfo> entries)
    {
        if ((directory.Attributes & FileAttributes.ReparsePoint) != 0)
            throw new IOException("Unexpected reparse point in private session.");
        foreach (var entry in directory.EnumerateFileSystemInfos())
        {
            if ((entry.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new IOException("Unexpected reparse point in private session.");
            var child = entry as DirectoryInfo;
            if (child != null) CollectCleanupEntries(child, entries);
            else entries.Add(entry);
        }
        entries.Add(directory);
    }
}
