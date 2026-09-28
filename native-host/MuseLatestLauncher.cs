using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

internal static class MuseLatestLauncher
{
    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [STAThread]
    private static int Main()
    {
        try
        {
            var launcherDirectory = AppDomain.CurrentDomain.BaseDirectory;
            var packagedRoot = Directory.GetParent(Directory.GetParent(launcherDirectory.TrimEnd(Path.DirectorySeparatorChar)).FullName).FullName;
            var workspace = FindWorkspace(launcherDirectory);
            var packagedMuse = workspace == null ? Path.Combine(packagedRoot, "Muse.exe") : Path.Combine(workspace, "release", "win-unpacked", "Muse.exe");
            var packagedAsar = workspace == null ? Path.Combine(packagedRoot, "resources", "app.asar") : Path.Combine(workspace, "release", "win-unpacked", "resources", "app.asar");
            var launchRoot = workspace ?? packagedRoot;
            var localElectron = Path.Combine(launchRoot, "node_modules", "electron", "dist", "electron.exe");
            var localBuild = Path.Combine(launchRoot, "out", "main", "index.js");
            var legacyMuse = Path.Combine(launchRoot, "release", "installed-web-collector-v1", "Muse.exe");
            var useLocalBuild = File.Exists(localElectron) && File.Exists(localBuild)
                && (!File.Exists(packagedAsar) || File.GetLastWriteTimeUtc(localBuild) > File.GetLastWriteTimeUtc(packagedAsar));
            var executable = useLocalBuild ? localElectron : packagedMuse;

            if (!File.Exists(executable))
            {
                MessageBox.Show("The latest local Muse build is missing. Build Muse before using this shortcut.", "Muse could not start", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }

            if (ActivateRunningMuse(executable)) return 0;

            StopExactExecutable(legacyMuse);
            if (useLocalBuild) StopExactExecutable(packagedMuse);
            Thread.Sleep(250);

            Process.Start(new ProcessStartInfo
            {
                FileName = executable,
                Arguments = useLocalBuild ? Quote(launchRoot) : "",
                WorkingDirectory = useLocalBuild ? launchRoot : Path.GetDirectoryName(packagedMuse),
                UseShellExecute = true
            });
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Muse could not start", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static string FindWorkspace(string startDirectory)
    {
        var current = new DirectoryInfo(startDirectory);
        for (var depth = 0; current != null && depth < 8; depth++, current = current.Parent)
        {
            if (File.Exists(Path.Combine(current.FullName, "package.json")) &&
                File.Exists(Path.Combine(current.FullName, "out", "main", "index.js")))
                return current.FullName;
        }
        return null;
    }

    private static bool ActivateRunningMuse(string executable)
    {
        var processName = Path.GetFileNameWithoutExtension(executable);
        foreach (var process in Process.GetProcessesByName(processName))
        {
            try
            {
                if (!string.Equals(process.MainModule.FileName, executable, StringComparison.OrdinalIgnoreCase)) continue;
                if (process.MainWindowHandle == IntPtr.Zero) continue;
                ShowWindow(process.MainWindowHandle, 9);
                SetForegroundWindow(process.MainWindowHandle);
                return true;
            }
            catch
            {
                // Ignore short-lived Electron helper processes.
            }
        }
        return false;
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }

    private static void StopExactExecutable(string executable)
    {
        foreach (var process in Process.GetProcessesByName("Muse"))
        {
            try
            {
                if (string.Equals(process.MainModule.FileName, executable, StringComparison.OrdinalIgnoreCase)) process.Kill();
            }
            catch
            {
                // The old process may already be exiting.
            }
        }
    }

}
