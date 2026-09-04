using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Text;
using System.Windows.Forms;

internal sealed class MuseFileDragTray : Form
{
    private readonly string[] files;
    private readonly Label statusLabel;
    private bool dragging;

    public MuseFileDragTray(string[] files)
    {
        this.files = files;

        Text = "Muse 拖到聊天";
        ShowInTaskbar = true;
        TopMost = true;
        FormBorderStyle = FormBorderStyle.FixedToolWindow;
        MaximizeBox = false;
        MinimizeBox = false;
        ClientSize = new Size(300, 92);
        BackColor = Color.FromArgb(24, 27, 34);
        ForeColor = Color.White;
        Cursor = Cursors.Hand;
        StartPosition = FormStartPosition.Manual;

        var cursor = Cursor.Position;
        var area = Screen.FromPoint(cursor).WorkingArea;
        Left = Math.Min(Math.Max(area.Left, cursor.X + 18), area.Right - Width);
        Top = Math.Min(Math.Max(area.Top, cursor.Y + 18), area.Bottom - Height);

        var icon = new Label
        {
            Text = "↗",
            Font = new Font("Segoe UI", 23F, FontStyle.Bold),
            ForeColor = Color.FromArgb(127, 150, 255),
            BackColor = Color.Transparent,
            TextAlign = ContentAlignment.MiddleCenter,
            Location = new Point(14, 14),
            Size = new Size(52, 52),
            Cursor = Cursors.Hand
        };
        statusLabel = new Label
        {
            Text = "按住这里拖出 " + files.Length + " 张图片",
            Font = new Font("Microsoft YaHei UI", 11F, FontStyle.Bold),
            ForeColor = Color.White,
            BackColor = Color.Transparent,
            TextAlign = ContentAlignment.MiddleLeft,
            Location = new Point(72, 14),
            Size = new Size(214, 30),
            Cursor = Cursors.Hand
        };
        var hint = new Label
        {
            Text = "拖进聊天框后松开鼠标",
            Font = new Font("Microsoft YaHei UI", 8.5F),
            ForeColor = Color.FromArgb(164, 172, 190),
            BackColor = Color.Transparent,
            TextAlign = ContentAlignment.MiddleLeft,
            Location = new Point(74, 45),
            Size = new Size(210, 24),
            Cursor = Cursors.Hand
        };

        Controls.Add(icon);
        Controls.Add(statusLabel);
        Controls.Add(hint);
        MouseDown += StartDrag;
        icon.MouseDown += StartDrag;
        statusLabel.MouseDown += StartDrag;
        hint.MouseDown += StartDrag;
    }

    private void StartDrag(object sender, MouseEventArgs eventArgs)
    {
        if (eventArgs.Button != MouseButtons.Left || dragging) return;
        dragging = true;
        statusLabel.Text = "正在拖动，放到聊天框…";
        try
        {
            var dragData = new DataObject();
            dragData.SetData(DataFormats.FileDrop, files);
            dragData.SetData("Preferred DropEffect", new MemoryStream(new byte[] { 1, 0, 0, 0 }));
            var result = DoDragDrop(dragData, DragDropEffects.Copy);
            if (result == DragDropEffects.Copy)
            {
                Close();
                return;
            }
            statusLabel.Text = "没有放入，可再次拖动";
        }
        finally
        {
            dragging = false;
        }
    }
}

internal static class MuseFileDragHost
{
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            var files = new List<string>();
            foreach (var encoded in args)
            {
                var path = Encoding.UTF8.GetString(Convert.FromBase64String(encoded));
                if (File.Exists(path)) files.Add(Path.GetFullPath(path));
            }
            if (files.Count == 0) return 2;

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (var tray = new MuseFileDragTray(files.ToArray()))
            {
                Application.Run(tray);
            }
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.ToString());
            return 1;
        }
    }
}
