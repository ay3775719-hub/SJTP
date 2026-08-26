using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;

internal static class MuseWebCollectorHost
{
    private const string AllowedOrigin = "chrome-extension://pammmlffogkfhnapajdjgelkkcpiijll/";
    private const int MaxMessageBytes = 1024 * 1024;

    public static int Main(string[] args)
    {
        try
        {
            if (args.Length < 1 || !String.Equals(NormalizeOrigin(args[0]), AllowedOrigin, StringComparison.Ordinal))
            {
                WriteBrowserMessage("{\"status\":\"unauthorized\"}");
                return 2;
            }

            string request = ReadBrowserMessage();
            string forwarded = AddExtensionIdentity(request);
            string response = ForwardWithLaunch(forwarded);
            WriteBrowserMessage(response);
            return 0;
        }
        catch (Exception)
        {
            try { WriteBrowserMessage("{\"status\":\"muse_unavailable\"}"); } catch { }
            return 1;
        }
    }

    private static string NormalizeOrigin(string value)
    {
        return value.EndsWith("/", StringComparison.Ordinal) ? value : value + "/";
    }

    private static string AddExtensionIdentity(string json)
    {
        string trimmed = json.Trim();
        if (!trimmed.StartsWith("{", StringComparison.Ordinal) || !trimmed.EndsWith("}", StringComparison.Ordinal))
            throw new InvalidDataException();
        return trimmed.Substring(0, trimmed.Length - 1) + ",\"extensionId\":\"pammmlffogkfhnapajdjgelkkcpiijll\"}";
    }

    private static string ForwardWithLaunch(string request)
    {
        try { return Forward(request, 1000); }
        catch
        {
            string museExe = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "Muse.exe"));
            if (File.Exists(museExe))
            {
                Process.Start(new ProcessStartInfo { FileName = museExe, UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(museExe) });
            }
        }

        for (int attempt = 0; attempt < 30; attempt++)
        {
            Thread.Sleep(250);
            try { return Forward(request, 1000); } catch { }
        }
        throw new IOException();
    }

    private static string Forward(string request, int timeoutMs)
    {
        string pipeName = "MuseWebCollector-v1-" + Sanitize(Environment.UserName);
        using (var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.None))
        {
            pipe.Connect(timeoutMs);
            WriteFrame(pipe, request);
            pipe.Flush();
            return ReadFrame(pipe);
        }
    }

    private static string ReadBrowserMessage() { return ReadFrame(Console.OpenStandardInput()); }
    private static void WriteBrowserMessage(string json)
    {
        Stream output = Console.OpenStandardOutput();
        WriteFrame(output, json);
        output.Flush();
    }

    private static string ReadFrame(Stream stream)
    {
        byte[] header = ReadExact(stream, 4);
        int length = header[0] | (header[1] << 8) | (header[2] << 16) | (header[3] << 24);
        if (length <= 0 || length > MaxMessageBytes) throw new InvalidDataException();
        return Encoding.UTF8.GetString(ReadExact(stream, length));
    }

    private static void WriteFrame(Stream stream, string json)
    {
        byte[] body = Encoding.UTF8.GetBytes(json);
        if (body.Length > MaxMessageBytes) throw new InvalidDataException();
        byte[] header = BitConverter.GetBytes(body.Length);
        stream.Write(header, 0, header.Length);
        stream.Write(body, 0, body.Length);
    }

    private static byte[] ReadExact(Stream stream, int length)
    {
        byte[] buffer = new byte[length];
        int offset = 0;
        while (offset < length)
        {
            int read = stream.Read(buffer, offset, length - offset);
            if (read <= 0) throw new EndOfStreamException();
            offset += read;
        }
        return buffer;
    }

    private static string Sanitize(string value)
    {
        var output = new StringBuilder(value.Length);
        foreach (char ch in value)
            output.Append(Char.IsLetterOrDigit(ch) || ch == '_' || ch == '.' || ch == '-' ? ch : '_');
        return output.Length == 0 ? "user" : output.ToString();
    }
}
