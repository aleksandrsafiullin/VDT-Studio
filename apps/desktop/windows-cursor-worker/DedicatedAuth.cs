using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

internal static class DedicatedAuth
{
    private const int LoginDeadlineMs = 180000;
    private const int OutputLimit = 256 * 1024;

    internal sealed class CleanupException : Exception { }

    internal static bool Available()
    {
        try
        {
            byte[] bytes = PrivateSession.ReadCredentialFile(PrivateSession.AuthSource(), new HashSet<string>(StringComparer.Ordinal));
            Array.Clear(bytes, 0, bytes.Length);
            return true;
        }
        catch (IOException) { return false; }
        catch (UnauthorizedAccessException) { return false; }
        catch (ArgumentException) { return false; }
        catch (InvalidOperationException) { return false; }
    }

    internal static void SignIn(PrivateSession.Identity identity, CancellationToken cancellation)
    {
        string parent = PrivateSession.SessionParent();
        string root = Path.Combine(parent, "VdtCursorLogin" + Guid.NewGuid().ToString("N"));
        if (Directory.Exists(root) || File.Exists(root)) throw new IOException("Private login scope collision.");
        Directory.CreateDirectory(root, PrivateSession.OwnedDirectoryAcl());
        bool mayRemove = true;
        try
        {
            string payload = PrivateSession.OwnedDirectory(root, "payload");
            string home = PrivateSession.OwnedDirectory(root, "home");
            string roaming = PrivateSession.OwnedDirectory(root, "roaming");
            string local = PrivateSession.OwnedDirectory(root, "local");
            string temp = PrivateSession.OwnedDirectory(root, "tmp");
            string config = PrivateSession.OwnedDirectory(root, "config");
            if (PrivateSession.Inventory(identity.Source, payload, cancellation) != identity.PayloadHash ||
                PrivateSession.Inventory(payload, null, cancellation) != identity.PayloadHash)
                throw new IOException("Login payload changed while staging.");

            var environment = new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
            environment["SystemRoot"] = PrivateSession.SystemRoot();
            environment["WINDIR"] = environment["SystemRoot"];
            environment["PATH"] = Environment.SystemDirectory;
            environment["COMSPEC"] = Path.Combine(Environment.SystemDirectory, "cmd.exe");
            environment["HOME"] = home;
            environment["USERPROFILE"] = home;
            environment["APPDATA"] = roaming;
            environment["LOCALAPPDATA"] = local;
            environment["TEMP"] = temp;
            environment["TMP"] = temp;
            environment["CURSOR_CONFIG_DIR"] = config;
            environment["CURSOR_INVOKED_AS"] = "agent.cmd";
            environment["AGENT_CLI_CREDENTIAL_STORE"] = "file";
            environment["NODE_DISABLE_COMPILE_CACHE"] = "1";
            environment["NO_OPEN_BROWSER"] = "1";
            environment["NO_COLOR"] = "1";
            AppContainerProcess.RunDedicatedLogin(Path.Combine(payload, "node.exe"), Path.Combine(payload, "index.js"),
                home, environment, LoginDeadlineMs, cancellation, stream => OpenVerifiedBrowser(stream, cancellation));

            string sourceDirectory = PrivateSession.DirectoryPath(Path.Combine(roaming, "Cursor"));
            PrivateSession.RequireOwnedAccess(Directory.GetAccessControl(sourceDirectory), false);
            string source = Path.Combine(sourceDirectory, "auth.json");
            PrivateSession.RequireOwnedAccess(PrivateSession.RequirePlainFile(source).GetAccessControl(), false);
            byte[] bytes = PrivateSession.ReadCredentialFile(source, new HashSet<string>(StringComparer.Ordinal));
            try
            {
                cancellation.ThrowIfCancellationRequested();
                Publish(bytes);
            }
            finally { Array.Clear(bytes, 0, bytes.Length); }
        }
        catch (CleanupException)
        {
            mayRemove = false;
            throw;
        }
        finally
        {
            if (mayRemove && !PrivateSession.TryRemoveRoot(root)) throw new CleanupException();
        }
    }

    private static readonly Regex BrowserUrl = new Regex(
        @"\Ahttps://cursor\.com/loginDeepControl\?challenge=[A-Za-z0-9_-]{43}&uuid=[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}&mode=login&redirectTarget=cli(?:&supportsSelectedTeamLogin=true)?\z",
        RegexOptions.CultureInvariant);

    [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
    private static extern IntPtr ShellExecuteW(IntPtr hwnd, string verb, string file, string parameters, string directory, int show);

    [DllImport("ole32.dll")]
    private static extern int CoInitializeEx(IntPtr reserved,uint mode);

    [DllImport("ole32.dll")]
    private static extern void CoUninitialize();

    private static void OpenBrowser(string address)
    {
        Marshal.ThrowExceptionForHR(CoInitializeEx(IntPtr.Zero,2));
        try
        {
            if (ShellExecuteW(IntPtr.Zero,"open",address,null,null,1).ToInt64()<=32)
                throw new IOException("Unable to open the provider sign-in page.");
        }
        finally { CoUninitialize(); }
    }

    private static void OpenVerifiedBrowser(Stream output, CancellationToken cancellation)
    {
        var token = new StringBuilder();
        bool oversized = false;
        bool opened = false;
        int count = 0;
        using (var reader = new BufferedStream(output))
        {
            for (int value=reader.ReadByte(); value!=-1; value=reader.ReadByte())
            {
                if (++count > OutputLimit) throw new IOException("Dedicated login output exceeded its limit.");
                if (value<=32 || value>=127)
                {
                    if (!opened && !oversized)
                    {
                        string candidate = token.ToString();
                        if (BrowserUrl.IsMatch(candidate))
                        {
                            cancellation.ThrowIfCancellationRequested();
                            OpenBrowser(candidate);
                            opened=true;
                        }
                    }
                    token.Clear();
                    oversized=false;
                }
                else if (token.Length<512) token.Append((char)value);
                else oversized=true;
            }
        }
        if (!opened) throw new IOException("The dedicated login did not provide the expected browser address.");
    }

    private static void Publish(byte[] bytes)
    {
        string directory = PrivateSession.AuthDirectory(true);
        string target = Path.Combine(directory, "auth.json");
        string staged = Path.Combine(directory, "vdt-login-" + Guid.NewGuid().ToString("N"));
        bool owned = false;
        try
        {
            using (var file = new FileStream(staged, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                owned = true;
                file.Write(bytes, 0, bytes.Length);
                file.Flush(true);
            }
            PrivateSession.RequireOwnedAccess(File.GetAccessControl(staged), false);
            if (File.Exists(target))
            {
                PrivateSession.AuthSource();
                File.Replace(staged, target, null);
            }
            else File.Move(staged, target);
            owned = false;
            PrivateSession.AuthSource();
        }
        finally
        {
            if (owned) File.Delete(staged);
        }
    }
}
