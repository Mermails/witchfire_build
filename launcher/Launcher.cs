using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace WitchfireAtelier
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            bool created;
            using (new Mutex(true, @"Local\WitchfireAtelier", out created))
            {
                if (!created)
                {
                    MessageBox.Show(
                        "L'atelier est déjà ouvert. Regardez la fenêtre déjà lancée, ou le navigateur.",
                        "Atelier Witchfire",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Information);
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                try
                {
                    using (var host = new SiteHost())
                    {
                        host.Start();
                        Application.Run(new MainForm(host));
                    }
                }
                catch (Exception ex)
                {
                    MessageBox.Show(ex.Message, "Atelier Witchfire", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
            }
        }
    }

    sealed class SiteHost : IDisposable
    {
        readonly Dictionary<string, byte[]> files = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
        readonly object vaultLock = new object();
        HttpListener listener;

        public int Port { get; private set; }
        public string Url { get { return "http://127.0.0.1:" + Port + "/"; } }

        public SiteHost()
        {
            var assembly = Assembly.GetExecutingAssembly();
            foreach (var name in assembly.GetManifestResourceNames())
            {
                using (var source = assembly.GetManifestResourceStream(name))
                using (var copy = new MemoryStream())
                {
                    source.CopyTo(copy);
                    files[name.Replace('\\', '/')] = copy.ToArray();
                }
            }
            if (!files.ContainsKey("index.html"))
                throw new InvalidOperationException("Le site est introuvable dans le programme.");
        }

        public void Start()
        {
            var port = 47321;
            while (true)
            {
                var candidate = new HttpListener();
                try
                {
                    candidate.Prefixes.Add("http://127.0.0.1:" + port + "/");
                    candidate.Start();
                    listener = candidate;
                    Port = port;
                    break;
                }
                catch (HttpListenerException)
                {
                    candidate.Close();
                    port++;
                    if (port > 47420) throw new InvalidOperationException("Aucun port local n'est libre pour ouvrir l'atelier.");
                }
            }

            listener.BeginGetContext(OnContext, null);
            OpenBrowser();
        }

        public void OpenBrowser()
        {
            try { Process.Start(Url); }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Le navigateur n'a pas pu s'ouvrir. Copiez cette adresse :\n" + Url + "\n\n" + ex.Message,
                    "Atelier Witchfire",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
            }
        }

        public void Stop()
        {
            if (listener == null) return;
            try { listener.Stop(); }
            catch { }
            listener = null;
        }

        public void Dispose()
        {
            Stop();
        }

        void OnContext(IAsyncResult result)
        {
            if (listener == null || !listener.IsListening) return;
            HttpListenerContext context;
            try { context = listener.EndGetContext(result); }
            catch { return; }
            try { listener.BeginGetContext(OnContext, null); }
            catch { }
            try { Serve(context); }
            catch { try { context.Response.Abort(); } catch { } }
        }

        void Serve(HttpListenerContext context)
        {
            byte[] body;
            string type;
            int code;
            var path = context.Request.Url.AbsolutePath;
            if (path == "/api/sauvegardes")
            {
                ServeVault(context);
                return;
            }
            if (!TryFile(path, out body, out type, out code))
                body = Encoding.UTF8.GetBytes(code == 400 ? "Requête refusée." : "Introuvable.");
            var response = context.Response;
            response.StatusCode = code;
            response.ContentType = type;
            response.Headers["Cache-Control"] = "no-store";
            response.ContentLength64 = body.Length;
            if (context.Request.HttpMethod != "HEAD")
                response.OutputStream.Write(body, 0, body.Length);
            response.OutputStream.Close();
        }

        bool TryFile(string path, out byte[] body, out string type, out int code)
        {
            body = null;
            type = "text/plain; charset=utf-8";
            code = 404;
            if (string.IsNullOrEmpty(path)) return false;
            if (path == "/") path = "/index.html";
            path = path.TrimStart('/');
            try { path = Uri.UnescapeDataString(path); }
            catch { code = 400; return false; }
            path = path.Replace('\\', '/');
            if (path.Contains("..") || path.StartsWith("/", StringComparison.Ordinal))
            {
                code = 400;
                return false;
            }
            if (!files.TryGetValue(path, out body)) return false;
            type = ContentType(path);
            code = 200;
            return true;
        }

        void ServeVault(HttpListenerContext context)
        {
            var method = context.Request.HttpMethod;
            byte[] body;
            var code = 200;
            if (method == "GET")
            {
                body = ReadVault();
            }
            else if (method == "POST")
            {
                string text;
                using (var reader = new StreamReader(context.Request.InputStream, Encoding.UTF8))
                    text = reader.ReadToEnd();
                if (text.Length > 2000000 || !LooksLikeVault(text))
                {
                    body = Encoding.UTF8.GetBytes("{\"ok\":false}");
                    code = 400;
                }
                else
                {
                    WriteVault(text);
                    body = Encoding.UTF8.GetBytes("{\"ok\":true}");
                }
            }
            else
            {
                body = Encoding.UTF8.GetBytes("{\"ok\":false}");
                code = 405;
            }
            var response = context.Response;
            response.StatusCode = code;
            response.ContentType = "application/json; charset=utf-8";
            response.Headers["Cache-Control"] = "no-store";
            response.ContentLength64 = body.Length;
            if (method != "HEAD") response.OutputStream.Write(body, 0, body.Length);
            response.OutputStream.Close();
        }

        static bool LooksLikeVault(string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return false;
            var trimmed = text.Trim();
            return trimmed.StartsWith("{") && trimmed.EndsWith("}") && trimmed.Contains("\"custom\"");
        }

        string VaultPath()
        {
            var folder = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            return Path.Combine(folder, "atelier-sauvegardes.json");
        }

        byte[] ReadVault()
        {
            lock (vaultLock)
            {
                var path = VaultPath();
                if (!File.Exists(path)) return Encoding.UTF8.GetBytes("{\"favorites\":[],\"custom\":[]}");
                return File.ReadAllBytes(path);
            }
        }

        void WriteVault(string text)
        {
            lock (vaultLock)
            {
                var path = VaultPath();
                var temp = path + ".tmp";
                File.WriteAllText(temp, text, new UTF8Encoding(false));
                if (File.Exists(path)) File.Replace(temp, path, null);
                else File.Move(temp, path);
            }
        }

        static string ContentType(string path)
        {
            var ext = Path.GetExtension(path).ToLowerInvariant();
            if (ext == ".html") return "text/html; charset=utf-8";
            if (ext == ".js") return "text/javascript; charset=utf-8";
            if (ext == ".css") return "text/css; charset=utf-8";
            if (ext == ".png") return "image/png";
            if (ext == ".jpg" || ext == ".jpeg") return "image/jpeg";
            if (ext == ".svg") return "image/svg+xml";
            if (ext == ".webp") return "image/webp";
            return "application/octet-stream";
        }

    }

    sealed class MainForm : Form
    {
        readonly SiteHost host;

        public MainForm(SiteHost host)
        {
            this.host = host;
            Text = "Atelier Witchfire";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = true;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(440, 168);
            BackColor = Color.FromArgb(22, 18, 14);
            ForeColor = Color.FromArgb(243, 234, 216);
            Font = new Font("Segoe UI", 10f);

            var title = new Label();
            title.Text = "L'atelier est ouvert dans le navigateur.";
            title.AutoSize = false;
            title.Bounds = new Rectangle(20, 18, 400, 28);
            title.ForeColor = Color.FromArgb(243, 234, 216);

            var address = new Label();
            address.Text = host.Url;
            address.AutoSize = false;
            address.Bounds = new Rectangle(20, 48, 400, 24);
            address.ForeColor = Color.FromArgb(212, 168, 92);

            var hint = new Label();
            hint.Text = "Laissez cette fenêtre ouverte. Fermez-la pour quitter.";
            hint.AutoSize = false;
            hint.Bounds = new Rectangle(20, 76, 400, 24);
            hint.ForeColor = Color.FromArgb(176, 164, 148);

            var reopen = new Button();
            reopen.Text = "Rouvrir";
            reopen.Bounds = new Rectangle(228, 116, 92, 32);
            reopen.FlatStyle = FlatStyle.Flat;
            reopen.BackColor = Color.FromArgb(42, 34, 26);
            reopen.ForeColor = Color.FromArgb(243, 234, 216);
            reopen.Click += delegate { host.OpenBrowser(); };

            var quit = new Button();
            quit.Text = "Quitter";
            quit.Bounds = new Rectangle(328, 116, 92, 32);
            quit.FlatStyle = FlatStyle.Flat;
            quit.BackColor = Color.FromArgb(42, 34, 26);
            quit.ForeColor = Color.FromArgb(243, 234, 216);
            quit.Click += delegate { Close(); };

            Controls.Add(title);
            Controls.Add(address);
            Controls.Add(hint);
            Controls.Add(reopen);
            Controls.Add(quit);
        }
    }
}
