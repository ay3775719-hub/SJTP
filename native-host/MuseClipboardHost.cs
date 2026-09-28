using System;
using System.Collections.Specialized;
using System.Drawing;
using System.IO;
using System.Text;
using System.Windows.Forms;

internal static class MuseClipboardHost
{
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length == 1 && args[0] == "--read-files")
            {
                var copiedFiles = Clipboard.GetFileDropList();
                if (copiedFiles.Count > 5000) return 2;
                foreach (string path in copiedFiles)
                    Console.Out.WriteLine(Convert.ToBase64String(Encoding.UTF8.GetBytes(path)));
                return 0;
            }
            var encodedLines = Console.In.ReadToEnd().Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            var files = new StringCollection();
            foreach (var encoded in encodedLines)
            {
                var path = Encoding.UTF8.GetString(Convert.FromBase64String(encoded));
                if (File.Exists(path)) files.Add(Path.GetFullPath(path));
            }
            if (files.Count == 0) return 2;

            var data = new DataObject();
            data.SetFileDropList(files);
            Bitmap bitmap = null;
            if (files.Count == 1)
            {
                try
                {
                    using (var source = Image.FromFile(files[0])) bitmap = new Bitmap(source);
                    data.SetData(DataFormats.Bitmap, true, bitmap);
                }
                catch
                {
                    // Formats not supported by System.Drawing still copy as a file.
                }
            }
            Clipboard.SetDataObject(data, true, 10, 100);
            if (bitmap != null) bitmap.Dispose();
            Console.Out.Write(files.Count.ToString());
            return 0;
        }
        catch
        {
            return 1;
        }
    }
}
