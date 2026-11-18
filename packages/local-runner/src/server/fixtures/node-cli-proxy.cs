// Test-only native Windows launcher. The adjacent files identify the fixture
// script and the existing Node executable; no shell or PATH lookup is used.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;

internal static class NodeCliProxy
{
    private static string Quote(string value)
    {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char ch in value)
        {
            if (ch == '\\')
            {
                slashes++;
                continue;
            }
            if (ch == '"')
            {
                result.Append('\\', slashes * 2 + 1);
                result.Append(ch);
            }
            else
            {
                result.Append('\\', slashes);
                result.Append(ch);
            }
            slashes = 0;
        }
        result.Append('\\', slashes * 2);
        result.Append('"');
        return result.ToString();
    }

    private static int Main(string[] args)
    {
        string executable = Assembly.GetExecutingAssembly().Location;
        var arguments = new StringBuilder(Quote(executable + ".cjs"));
        foreach (string argument in args)
            arguments.Append(' ').Append(Quote(argument));

        var start = new ProcessStartInfo
        {
            FileName = File.ReadAllText(executable + ".node").Trim(),
            Arguments = arguments.ToString(),
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        using (var child = Process.Start(start))
        {
            var stdout = child.StandardOutput.BaseStream.CopyToAsync(Console.OpenStandardOutput());
            var stderr = child.StandardError.BaseStream.CopyToAsync(Console.OpenStandardError());
            child.WaitForExit();
            Task.WaitAll(stdout, stderr);
            return child.ExitCode;
        }
    }
}
