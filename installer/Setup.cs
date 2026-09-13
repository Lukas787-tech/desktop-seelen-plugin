using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

// Setup for Seelen Desktop Surface.
//
// Compiled by scripts/release.mjs with the C# 5 compiler that ships in .NET
// Framework 4, with the built widgets, the theme and the voice server scripts
// embedded as payload.zip. Everything installs per user, so it never asks for
// administrator rights itself; winget does, if Seelen UI has to be installed.
//
//   Setup.exe                     the window
//   Setup.exe /quiet [/voice] [/notheme] [/log <file>]
//   Setup.exe /uninstall [/quiet] [/log <file>]

namespace SeelenDesktopSurface
{
    sealed class Options
    {
        public bool Theme = true;
        public bool Voice;
        public bool Quiet;
        public bool Uninstall;
        public string LogPath;
    }

    sealed class SeelenInfo
    {
        public bool Installed;
        public bool Store;
        public string Version;
        public string Dir;
        public string Slu;
        public string DataDir;

        /// <summary>Built and tested against 2.8; the host API it uses arrived there.</summary>
        public bool Supported
        {
            get
            {
                if (!Installed) return false;
                if (string.IsNullOrEmpty(Version)) return true;
                var parts = Version.Split('.', '-', '+');
                int major, minor;
                if (parts.Length < 2 || !int.TryParse(parts[0], out major) || !int.TryParse(parts[1], out minor)) return true;
                return major > 2 || (major == 2 && minor >= 8);
            }
        }
    }

    sealed class Installer
    {
        public const string Product = "Seelen Desktop Surface";
        public const string Homepage = "https://github.com/Lukas787-tech/desktop-seelen-plugin";
        const string ProductKey = "SeelenDesktopSurface";
        const string Publisher = "Lukas787-tech";
        const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + ProductKey;
        const string ThemeId = "@ralfm/surface";
        static readonly string[] WidgetIds = { "@ralfm/desktop", "@ralfm/palette" };

        /// <summary>
        /// Whether Seelen counts a widget it has no settings entry for as switched
        /// on. Taken as no: in a real settings.json every widget carries an
        /// explicit `enabled`, and one switched on from Seelen's settings has an
        /// entry holding nothing else. If that is wrong, the cost is one needless
        /// restart of Seelen UI.
        /// </summary>
        internal const bool MissingEntryMeansEnabled = false;

        readonly Action<string> log;
        readonly Func<string, bool> ask;

        public Installer(Action<string> log, Func<string, bool> ask)
        {
            this.log = log;
            this.ask = ask;
        }

        static string AppData { get { return Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData); } }
        static string LocalAppData { get { return Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData); } }
        static string Profile { get { return Environment.GetFolderPath(Environment.SpecialFolder.UserProfile); } }
        public static string VoiceDir { get { return Path.Combine(Profile, ".ralfm-voice"); } }
        static string ProgramDir { get { return Path.Combine(LocalAppData, "Programs", ProductKey); } }

        public static string Version
        {
            get
            {
                var attribute = (AssemblyInformationalVersionAttribute)Attribute.GetCustomAttribute(
                    typeof(Installer).Assembly, typeof(AssemblyInformationalVersionAttribute));
                return attribute != null ? attribute.InformationalVersion : "dev";
            }
        }

        // --- finding Seelen ------------------------------------------------------

        public static SeelenInfo DetectSeelen()
        {
            var info = new SeelenInfo();
            foreach (var hive in new[] { RegistryHive.LocalMachine, RegistryHive.CurrentUser })
            {
                foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
                {
                    if (info.Dir == null) ReadUninstallEntry(hive, view, info);
                }
            }

            var usual = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Seelen\Seelen UI");
            if (info.Dir == null && File.Exists(Path.Combine(usual, "seelen-ui.exe"))) info.Dir = usual;
            if (info.Dir != null)
            {
                var exe = Path.Combine(info.Dir, "seelen-ui.exe");
                var slu = Path.Combine(info.Dir, "slu.exe");
                if (File.Exists(slu)) info.Slu = slu;
                if (string.IsNullOrEmpty(info.Version) && File.Exists(exe)) info.Version = FileVersionInfo.GetVersionInfo(exe).ProductVersion;
                info.Installed = File.Exists(exe) || info.Slu != null;
            }

            info.DataDir = Path.Combine(AppData, "com.seelen.seelen-ui");

            // The Microsoft Store build keeps its data inside its package.
            var packages = Path.Combine(LocalAppData, "Packages");
            if (!info.Installed && Directory.Exists(packages))
            {
                var store = Directory.GetDirectories(packages, "Seelen.SeelenUI_*").FirstOrDefault();
                if (store != null)
                {
                    info.Installed = true;
                    info.Store = true;
                    var alias = Path.Combine(LocalAppData, @"Microsoft\WindowsApps\slu.exe");
                    if (File.Exists(alias)) info.Slu = alias;
                    var data = Path.Combine(store, @"LocalCache\Roaming\com.seelen.seelen-ui");
                    if (Directory.Exists(data)) info.DataDir = data;
                }
            }
            return info;
        }

        static void ReadUninstallEntry(RegistryHive hive, RegistryView view, SeelenInfo info)
        {
            try
            {
                using (var root = RegistryKey.OpenBaseKey(hive, view))
                using (var uninstall = root.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"))
                {
                    if (uninstall == null) return;
                    foreach (var name in uninstall.GetSubKeyNames())
                    {
                        using (var key = uninstall.OpenSubKey(name))
                        {
                            if (key == null) continue;
                            var display = key.GetValue("DisplayName") as string;
                            if (display == null || !display.StartsWith("Seelen UI", StringComparison.OrdinalIgnoreCase)) continue;
                            info.Version = key.GetValue("DisplayVersion") as string;
                            var location = ((key.GetValue("InstallLocation") as string) ?? "").Trim().Trim('"');
                            if (location.Length > 0) info.Dir = location;
                            return;
                        }
                    }
                }
            }
            catch (Exception)
            {
                // An unreadable hive is the same as no entry in it.
            }
        }

        public static string Describe(SeelenInfo seelen)
        {
            if (!seelen.Installed) return "Seelen UI is not installed. It is what runs the surface, so it comes first.";
            var name = "Seelen UI" + (string.IsNullOrEmpty(seelen.Version) ? "" : " " + seelen.Version) + (seelen.Store ? " (Microsoft Store)" : "");
            return seelen.Supported
                ? "✓ " + name + " is installed."
                : name + " is installed, but this needs Seelen UI 2.8 or newer.";
        }

        public static bool IsInstalled(SeelenInfo seelen)
        {
            if (Directory.Exists(Path.Combine(seelen.DataDir, @"widgets\ralfm-desktop"))) return true;
            using (var key = Registry.CurrentUser.OpenSubKey(UninstallKey)) return key != null;
        }

        static bool SeelenRunning()
        {
            return Process.GetProcessesByName("seelen-ui").Length > 0;
        }

        public static string Winget()
        {
            var path = OnPath("winget.exe");
            if (path != null) return path;
            var alias = Path.Combine(LocalAppData, @"Microsoft\WindowsApps\winget.exe");
            return File.Exists(alias) ? alias : null;
        }

        /// <summary>Installs or updates Seelen UI through winget, which asks for elevation itself.</summary>
        public void GetSeelen(bool update)
        {
            var winget = Winget();
            if (winget == null) throw new InvalidOperationException("winget is not available; download Seelen UI from https://seelen.io.");
            log((update ? "Updating" : "Installing") + " Seelen UI with winget...");
            var code = Run(winget, new[] { update ? "upgrade" : "install", "--id", "Seelen.SeelenUI", "-e", "--accept-package-agreements", "--accept-source-agreements" }, null, true, 30 * 60 * 1000);
            log(code == 0 ? "Seelen UI is ready." : "winget finished with code " + code + ".");
        }

        // --- installing ----------------------------------------------------------

        public void Install(SeelenInfo seelen, Options options)
        {
            log(Product + " " + Version + " for " + Describe(seelen).TrimStart('✓', ' '));
            var payload = ExtractPayload();
            try
            {
                Directory.CreateDirectory(seelen.DataDir);
                Place(seelen, payload, "widget", "ralfm-desktop");
                Place(seelen, payload, "widget", "ralfm-palette");
                if (options.Theme) Place(seelen, payload, "theme", "ralfm-surface");
                try
                {
                    SwitchOn(seelen, options.Theme);
                }
                catch (Exception e)
                {
                    // The files are in place; switching them on is the part a person can finish.
                    log("Could not switch them on by itself: " + e.Message);
                    log(ManualSwitchOn(options.Theme));
                }
                RegisterUninstall();
                if (options.Voice) InstallVoice(payload);
                log("");
                log("Done. The surface is on every display. In its Assistant panel the gear sets up a model,");
                log("and the waveform button next to the message box starts a spoken conversation.");
            }
            finally
            {
                TryDelete(payload);
            }
        }

        static string ExtractPayload()
        {
            var dir = Path.Combine(Path.GetTempPath(), ProductKey + "-" + Guid.NewGuid().ToString("N"));
            using (var stream = typeof(Installer).Assembly.GetManifestResourceStream("payload.zip"))
            {
                if (stream == null) throw new InvalidOperationException("This setup was built without its payload.");
                using (var zip = new ZipArchive(stream, ZipArchiveMode.Read))
                {
                    foreach (var entry in zip.Entries)
                    {
                        var relative = entry.FullName.Replace('\\', '/');
                        while (relative.StartsWith("./")) relative = relative.Substring(2);
                        if (relative.Length == 0 || relative.EndsWith("/")) continue;
                        var target = Path.GetFullPath(Path.Combine(dir, relative));
                        if (!target.StartsWith(dir + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                        {
                            throw new InvalidOperationException("The payload holds an unsafe path: " + entry.FullName);
                        }
                        Directory.CreateDirectory(Path.GetDirectoryName(target));
                        entry.ExtractToFile(target, true);
                    }
                }
            }
            return dir;
        }

        /// <summary>
        /// Copies one resource where Seelen scans for it at startup, and loads it
        /// into the running Seelen too. The old copy is unloaded first: loading
        /// over a live one re-registers it without rebuilding its webview, which
        /// would leave the old code running.
        /// </summary>
        void Place(SeelenInfo seelen, string payload, string kind, string name)
        {
            var source = Path.Combine(payload, kind + "s", name);
            var dest = Path.Combine(seelen.DataDir, kind + "s", name);
            if (Directory.Exists(dest)) Slu(seelen, new[] { "resource", "unload", kind, dest });
            TryDelete(dest);
            if (Directory.Exists(dest)) throw new IOException("Could not replace " + dest + ". Close anything using it and run setup again.");
            CopyDirectory(source, dest);
            var loaded = Slu(seelen, new[] { "resource", "load", kind, dest }) == 0;
            log((loaded ? "Installed and loaded " : "Installed ") + kind + " " + name + (loaded ? "" : "; Seelen loads it when it next starts"));
        }

        int Slu(SeelenInfo seelen, string[] args)
        {
            if (seelen.Slu == null || !SeelenRunning()) return -1;
            try
            {
                return Run(seelen.Slu, args, null, false, 60 * 1000);
            }
            catch (Exception)
            {
                return -1;
            }
        }

        /// <summary>
        /// Switches the widgets (and theme) on in Seelen's settings. Seelen holds
        /// its settings in memory and rewrites the file, so an edit made while it
        /// runs is lost: it is stopped, edited and started again - and only when
        /// something actually needs switching on, and only after asking.
        /// </summary>
        void SwitchOn(SeelenInfo seelen, bool theme)
        {
            var file = Path.Combine(seelen.DataDir, "settings.json");
            var themeId = theme ? ThemeId : null;
            if (!File.Exists(file))
            {
                log("Seelen has not saved its settings yet. Start Seelen UI once; if the surface does not appear,");
                log("switch on Desktop and Command palette under Widgets in Seelen's settings.");
                return;
            }
            if (SeelenSettings.Apply(ReadSettings(file), WidgetIds, themeId, MissingEntryMeansEnabled).Count == 0)
            {
                log("Seelen already has " + (theme ? "the widgets and the theme" : "the widgets") + " switched on.");
                return;
            }

            var running = SeelenRunning();
            if (running && !ask("Seelen UI restarts once to switch the surface on" + (theme ? " and apply its theme" : "") + ". Restart it now?"))
            {
                log(ManualSwitchOn(theme));
                return;
            }
            if (running) StopSeelen();

            try
            {
                string original;
                var root = ReadSettings(file, out original);
                var changes = SeelenSettings.Apply(root, WidgetIds, themeId, MissingEntryMeansEnabled);
                WriteWithRetry(file + ".before-desktop-surface", original);
                WriteWithRetry(file, Json.Write(root));
                foreach (var change in changes) log("Seelen settings: " + change);
            }
            finally
            {
                // Whatever happened to the file, Seelen UI is not left stopped.
                if (running) StartSeelen(seelen);
            }
            if (!running) return;

            // Seelen writes its settings back from memory, so what counts is what
            // it kept once it was up again - a copy of it started by its service
            // before the edit landed would have read the old file.
            Thread.Sleep(4000);
            if (SeelenSettings.Apply(ReadSettings(file), WidgetIds, themeId, MissingEntryMeansEnabled).Count > 0) log(ManualSwitchOn(theme));
        }

        static string ManualSwitchOn(bool theme)
        {
            return "Not switched on yet. In Seelen's settings, turn on Desktop and Command palette under Widgets"
                + (theme ? ", and the Desktop Surface theme under Themes, below the default theme." : ".");
        }

        static JsonObject ReadSettings(string file)
        {
            string text;
            return ReadSettings(file, out text);
        }

        /// <summary>
        /// Reads settings.json while Seelen may be writing it. Measured: straight
        /// after the widgets were loaded, a plain read failed because the file was
        /// in use by another process. So it is opened shared, and read again until
        /// it both opens and parses - a read that lands mid-write is not JSON.
        /// </summary>
        static JsonObject ReadSettings(string file, out string text)
        {
            for (int attempt = 1; ; attempt++)
            {
                try
                {
                    using (var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                    using (var reader = new StreamReader(stream, Encoding.UTF8))
                    {
                        text = reader.ReadToEnd();
                    }
                    var root = Json.Parse(text) as JsonObject;
                    if (root == null) throw new FormatException(file + " is not a settings object.");
                    return root;
                }
                catch (Exception e)
                {
                    if (!(e is IOException || e is FormatException) || attempt >= 20) throw;
                    Thread.Sleep(250);
                }
            }
        }

        static void WriteWithRetry(string file, string text)
        {
            for (int attempt = 1; ; attempt++)
            {
                try
                {
                    File.WriteAllText(file, text, new UTF8Encoding(false));
                    return;
                }
                catch (IOException)
                {
                    if (attempt >= 20) throw;
                    Thread.Sleep(250);
                }
            }
        }

        /// <summary>
        /// Ends Seelen UI itself. Its service, slu-service, is left alone: it
        /// appears to run elevated (a normal process cannot even read its path),
        /// so setup could not end it anyway, and it is not what holds the settings.
        /// </summary>
        void StopSeelen()
        {
            log("Stopping Seelen UI...");
            foreach (var process in Process.GetProcessesByName("seelen-ui"))
            {
                try
                {
                    process.Kill();
                    process.WaitForExit(10 * 1000);
                }
                catch (Exception e)
                {
                    throw new InvalidOperationException("Seelen UI could not be stopped (" + e.Message + "). Quit it from its tray icon and run setup again.");
                }
            }
        }

        void StartSeelen(SeelenInfo seelen)
        {
            // Its service may bring it back by itself; a second copy is not wanted.
            for (int i = 0; i < 10 && !SeelenRunning(); i++) Thread.Sleep(500);
            if (!SeelenRunning())
            {
                log("Starting Seelen UI...");
                var exe = seelen.Dir == null ? null : Path.Combine(seelen.Dir, "seelen-ui.exe");
                if (exe != null && File.Exists(exe)) Process.Start(new ProcessStartInfo(exe) { UseShellExecute = true, WorkingDirectory = seelen.Dir });
                for (int i = 0; i < 40 && !SeelenRunning(); i++) Thread.Sleep(500);
            }
            log(SeelenRunning() ? "Seelen UI is running again." : "Seelen UI did not come back by itself; start it from the Start menu.");
        }

        void InstallVoice(string payload)
        {
            log("");
            log("Installing the assistant's local voice. This downloads about 4 GB and takes a while.");
            var uv = FindUv();
            if (uv == null)
            {
                log("Installing uv, which sets up the voice's own Python...");
                var winget = Winget();
                if (winget != null)
                {
                    Run(winget, new[] { "install", "--id", "astral-sh.uv", "-e", "--silent", "--accept-package-agreements", "--accept-source-agreements" }, null, true, 10 * 60 * 1000);
                    uv = FindUv();
                }
                if (uv == null)
                {
                    Run("powershell.exe", new[] { "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "irm https://astral.sh/uv/install.ps1 | iex" }, null, true, 10 * 60 * 1000);
                    uv = FindUv();
                }
                if (uv == null) throw new InvalidOperationException("uv could not be installed. Install it from https://docs.astral.sh/uv/ and run setup again.");
            }

            var env = new Dictionary<string, string>();
            env["PATH"] = Path.GetDirectoryName(uv) + ";" + Environment.GetEnvironmentVariable("PATH");
            env["PYTHONIOENCODING"] = "utf-8";
            env["NO_COLOR"] = "1";
            var script = Path.Combine(payload, "voice", "install.ps1");
            var command = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; & '" + script.Replace("'", "''") + "'; exit $LASTEXITCODE";
            if (Run("powershell.exe", new[] { "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command }, env, true, Timeout.Infinite) != 0)
            {
                throw new InvalidOperationException("The voice did not install; the lines above say why. Everything else is installed.");
            }
            log("The voice is in " + VoiceDir + ". The assistant starts it when it needs it.");
        }

        static string FindUv()
        {
            var found = OnPath("uv.exe");
            if (found != null) return found;
            var candidates = new List<string>
            {
                Path.Combine(Profile, @".local\bin\uv.exe"),
                Path.Combine(LocalAppData, @"Microsoft\WinGet\Links\uv.exe"),
            };
            var packages = Path.Combine(LocalAppData, @"Microsoft\WinGet\Packages");
            if (Directory.Exists(packages))
            {
                foreach (var dir in Directory.GetDirectories(packages, "astral-sh.uv*")) candidates.Add(Path.Combine(dir, "uv.exe"));
            }
            return candidates.FirstOrDefault(File.Exists);
        }

        static string OnPath(string exe)
        {
            // The user PATH as it is now, which a winget install moments ago has
            // changed without telling this process.
            var path = Environment.GetEnvironmentVariable("PATH") + ";" + Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.User);
            foreach (var dir in path.Split(';'))
            {
                try
                {
                    var trimmed = Environment.ExpandEnvironmentVariables(dir.Trim().Trim('"'));
                    if (trimmed.Length == 0) continue;
                    var candidate = Path.Combine(trimmed, exe);
                    if (File.Exists(candidate)) return candidate;
                }
                catch (ArgumentException)
                {
                    // A malformed PATH entry.
                }
            }
            return null;
        }

        void RegisterUninstall()
        {
            Directory.CreateDirectory(ProgramDir);
            var target = Path.Combine(ProgramDir, "Setup.exe");
            var self = Assembly.GetExecutingAssembly().Location;
            if (!string.Equals(Path.GetFullPath(self), Path.GetFullPath(target), StringComparison.OrdinalIgnoreCase)) File.Copy(self, target, true);
            using (var key = Registry.CurrentUser.CreateSubKey(UninstallKey))
            {
                key.SetValue("DisplayName", Product);
                key.SetValue("DisplayVersion", Version);
                key.SetValue("Publisher", Publisher);
                key.SetValue("URLInfoAbout", Homepage);
                key.SetValue("InstallLocation", ProgramDir);
                key.SetValue("DisplayIcon", target);
                key.SetValue("UninstallString", "\"" + target + "\" /uninstall");
                key.SetValue("QuietUninstallString", "\"" + target + "\" /uninstall /quiet");
                key.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
            log("Listed in Windows' installed apps, for uninstalling.");
        }

        // --- uninstalling --------------------------------------------------------

        public void Uninstall(SeelenInfo seelen, bool quiet)
        {
            foreach (var item in new[] { new[] { "widget", "ralfm-desktop" }, new[] { "widget", "ralfm-palette" }, new[] { "theme", "ralfm-surface" } })
            {
                var dest = Path.Combine(seelen.DataDir, item[0] + "s", item[1]);
                if (!Directory.Exists(dest)) continue;
                Slu(seelen, new[] { "resource", "unload", item[0], dest });
                TryDelete(dest);
                log(Directory.Exists(dest) ? "Could not remove " + dest : "Removed " + item[0] + " " + item[1]);
            }

            if (Directory.Exists(VoiceDir) && (quiet || ask("Also remove the assistant's local voice (" + VoiceDir + ", about 4 GB)?")))
            {
                StopVoiceServer();
                TryDelete(VoiceDir);
                log(Directory.Exists(VoiceDir) ? "Could not remove all of " + VoiceDir + "; delete what is left by hand." : "Removed the local voice.");
            }

            var data = Path.Combine(seelen.DataDir, @"data\ralfm-desktop");
            if (!quiet && Directory.Exists(data) && ask("Also delete the surface's own data - assistant chats and API keys, notes and icon layout - in " + data + "?"))
            {
                TryDelete(data);
                TryDelete(Path.Combine(seelen.DataDir, @"data\ralfm-palette"));
                log("Removed the surface's data.");
            }

            Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false);
            log("Uninstalled. Seelen UI itself, and its settings, are untouched.");
        }

        static void StopVoiceServer()
        {
            foreach (var process in Process.GetProcesses())
            {
                try
                {
                    if (!process.ProcessName.StartsWith("python", StringComparison.OrdinalIgnoreCase)) continue;
                    if (process.MainModule.FileName.StartsWith(VoiceDir, StringComparison.OrdinalIgnoreCase))
                    {
                        process.Kill();
                        process.WaitForExit(5000);
                    }
                }
                catch (Exception)
                {
                    // Another user's process, or one that already exited.
                }
            }
        }

        /// <summary>The copy of setup in Programs cannot delete itself while it runs; cmd does it just after.</summary>
        public static void RemoveProgramDirAfterExit()
        {
            if (!Directory.Exists(ProgramDir)) return;
            var self = Assembly.GetExecutingAssembly().Location;
            if (!self.StartsWith(ProgramDir, StringComparison.OrdinalIgnoreCase))
            {
                TryDelete(ProgramDir);
                return;
            }
            Process.Start(new ProcessStartInfo("cmd.exe", "/c ping 127.0.0.1 -n 4 > nul & rmdir /s /q \"" + ProgramDir + "\"")
            {
                CreateNoWindow = true,
                UseShellExecute = false,
            });
        }

        // --- plumbing ------------------------------------------------------------

        int Run(string file, IEnumerable<string> args, IDictionary<string, string> env, bool echo, int timeoutMs)
        {
            var start = new ProcessStartInfo(file, string.Join(" ", args.Select(Quote)))
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            if (env != null)
            {
                foreach (var pair in env) start.EnvironmentVariables[pair.Key] = pair.Value;
            }
            using (var process = new Process { StartInfo = start })
            {
                DataReceivedEventHandler onLine = (sender, e) =>
                {
                    if (!echo || string.IsNullOrWhiteSpace(e.Data)) return;
                    // Colour codes from tools that think they are writing to a terminal.
                    var line = Regex.Replace(e.Data, @"\x1B\[[0-9;?]*[A-Za-z]", "").TrimEnd();
                    if (line.Length > 0) log("  " + line);
                };
                process.OutputDataReceived += onLine;
                process.ErrorDataReceived += onLine;
                process.Start();
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                if (!process.WaitForExit(timeoutMs))
                {
                    try { process.Kill(); } catch (Exception) { }
                    throw new TimeoutException(Path.GetFileName(file) + " did not finish in time.");
                }
                process.WaitForExit();
                return process.ExitCode;
            }
        }

        /// <summary>Quotes one argument the way the C runtime splits a command line.</summary>
        static string Quote(string arg)
        {
            if (arg.Length > 0 && arg.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return arg;
            var sb = new StringBuilder("\"");
            int slashes = 0;
            foreach (char c in arg)
            {
                if (c == '\\')
                {
                    slashes++;
                    continue;
                }
                if (c == '"')
                {
                    sb.Append('\\', slashes * 2 + 1).Append('"');
                    slashes = 0;
                    continue;
                }
                sb.Append('\\', slashes).Append(c);
                slashes = 0;
            }
            sb.Append('\\', slashes * 2).Append('"');
            return sb.ToString();
        }

        static void CopyDirectory(string source, string dest)
        {
            Directory.CreateDirectory(dest);
            foreach (var file in Directory.GetFiles(source)) File.Copy(file, Path.Combine(dest, Path.GetFileName(file)), true);
            foreach (var dir in Directory.GetDirectories(source)) CopyDirectory(dir, Path.Combine(dest, Path.GetFileName(dir)));
        }

        static void TryDelete(string dir)
        {
            for (int attempt = 0; attempt < 3 && Directory.Exists(dir); attempt++)
            {
                try
                {
                    foreach (var file in Directory.GetFiles(dir, "*", SearchOption.AllDirectories)) File.SetAttributes(file, FileAttributes.Normal);
                    Directory.Delete(dir, true);
                }
                catch (Exception)
                {
                    Thread.Sleep(400);
                }
            }
        }
    }

    sealed class MainForm : Form
    {
        readonly Options options;
        readonly Label status = new Label();
        readonly Button seelenButton = new Button();
        readonly CheckBox surfaceBox = new CheckBox();
        readonly CheckBox themeBox = new CheckBox();
        readonly CheckBox voiceBox = new CheckBox();
        readonly TextBox logBox = new TextBox();
        readonly ProgressBar progress = new ProgressBar();
        readonly Button installButton = new Button();
        readonly Button uninstallButton = new Button();
        readonly Button closeButton = new Button();
        SeelenInfo seelen;
        bool busy;
        bool removeProgramDir;

        public MainForm(Options options)
        {
            this.options = options;
            Text = Installer.Product + " " + Installer.Version + " Setup";
            Font = new Font("Segoe UI", 9f);
            AutoScaleDimensions = new SizeF(96f, 96f);
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(620, 580);
            MinimumSize = new Size(540, 500);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.White;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }

            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 7, Padding = new Padding(22, 18, 22, 14) };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
            for (int i = 0; i < 7; i++) layout.RowStyles.Add(i == 4 ? new RowStyle(SizeType.Percent, 100f) : new RowStyle(SizeType.AutoSize));

            var title = new Label { Text = Installer.Product, AutoSize = true, Font = new Font("Segoe UI Semibold", 16f), Margin = new Padding(0, 0, 0, 2) };
            var subtitle = new Label
            {
                Text = "A desktop, a command palette and an assistant for Seelen UI, with a theme to match.",
                AutoSize = true,
                ForeColor = Color.DimGray,
                Margin = new Padding(0, 0, 0, 14),
            };

            var seelenRow = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Margin = new Padding(0, 0, 0, 12) };
            status.AutoSize = true;
            status.Margin = new Padding(0, 7, 12, 0);
            seelenButton.AutoSize = true;
            seelenButton.Visible = false;
            seelenButton.Click += (s, e) => GetSeelen();
            seelenRow.Controls.Add(status);
            seelenRow.Controls.Add(seelenButton);

            var group = new GroupBox { Text = "Install", Dock = DockStyle.Fill, AutoSize = true, Padding = new Padding(12, 8, 12, 10), Margin = new Padding(0, 0, 0, 12) };
            var items = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false };
            surfaceBox.Text = "Desktop surface and command palette";
            surfaceBox.Checked = true;
            surfaceBox.Enabled = false;
            surfaceBox.AutoSize = true;
            themeBox.Text = "Theme for Seelen's dock, toolbar and menus, to match the surface";
            themeBox.Checked = options.Theme;
            themeBox.AutoSize = true;
            voiceBox.Text = "Local voice for the assistant (Kokoro, English and German)";
            voiceBox.Checked = options.Voice;
            voiceBox.AutoSize = true;
            var voiceNote = new Label
            {
                Text = "Downloads about 4 GB. Fastest on an NVIDIA graphics card. The assistant works without it.",
                AutoSize = true,
                ForeColor = Color.DimGray,
                Margin = new Padding(18, 0, 0, 2),
            };
            items.Controls.AddRange(new Control[] { surfaceBox, themeBox, voiceBox, voiceNote });
            group.Controls.Add(items);

            logBox.Multiline = true;
            logBox.ReadOnly = true;
            logBox.ScrollBars = ScrollBars.Vertical;
            logBox.Dock = DockStyle.Fill;
            logBox.BackColor = Color.FromArgb(247, 247, 247);
            logBox.BorderStyle = BorderStyle.FixedSingle;
            logBox.Font = new Font("Consolas", 9f);

            progress.Dock = DockStyle.Fill;
            progress.Style = ProgressBarStyle.Marquee;
            progress.MarqueeAnimationSpeed = 0;
            progress.Height = 6;
            progress.Margin = new Padding(0, 10, 0, 10);

            var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, FlowDirection = FlowDirection.RightToLeft, WrapContents = false };
            closeButton.Text = "Close";
            installButton.Text = "Install";
            uninstallButton.Text = "Uninstall";
            foreach (var button in new[] { closeButton, installButton, uninstallButton })
            {
                button.AutoSize = true;
                button.MinimumSize = new Size(96, 32);
            }
            closeButton.Click += (s, e) => Close();
            installButton.Click += (s, e) => Start(false);
            uninstallButton.Click += (s, e) => Start(true);
            buttons.Controls.AddRange(new Control[] { closeButton, installButton, uninstallButton });
            AcceptButton = installButton;

            layout.Controls.Add(title, 0, 0);
            layout.Controls.Add(subtitle, 0, 1);
            layout.Controls.Add(seelenRow, 0, 2);
            layout.Controls.Add(group, 0, 3);
            layout.Controls.Add(logBox, 0, 4);
            layout.Controls.Add(progress, 0, 5);
            layout.Controls.Add(buttons, 0, 6);
            Controls.Add(layout);

            Load += (s, e) =>
            {
                Detect();
                if (options.Uninstall && uninstallButton.Enabled) Start(true);
            };
            FormClosing += (s, e) => { if (busy) e.Cancel = true; };
            FormClosed += (s, e) => { if (removeProgramDir) Installer.RemoveProgramDirAfterExit(); };
        }

        void Detect()
        {
            seelen = Installer.DetectSeelen();
            var ready = seelen.Supported;
            status.Text = Installer.Describe(seelen);
            status.ForeColor = ready ? Color.FromArgb(16, 124, 16) : Color.FromArgb(196, 43, 28);
            seelenButton.Text = seelen.Installed ? "Update Seelen UI" : "Install Seelen UI";
            seelenButton.Visible = !ready;
            SetEnabled(true);
        }

        void SetEnabled(bool on)
        {
            var ready = seelen != null && seelen.Supported;
            installButton.Enabled = on && ready;
            uninstallButton.Enabled = on && seelen != null && Installer.IsInstalled(seelen);
            seelenButton.Enabled = on;
            themeBox.Enabled = on;
            voiceBox.Enabled = on;
            closeButton.Enabled = on;
        }

        void GetSeelen()
        {
            if (Installer.Winget() == null)
            {
                Process.Start("https://seelen.io");
                Log("Opened seelen.io. Install Seelen UI, start it once, then click Install here.");
                return;
            }
            var update = seelen.Installed;
            var question = (update ? "Update" : "Install") + " Seelen UI with winget?\n\n"
                + "This downloads Seelen UI's official installer (winget id Seelen.SeelenUI) and runs it. "
                + "Continuing accepts Seelen UI's license and winget's source agreement.";
            if (MessageBox.Show(this, question, Text, MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) return;
            RunInBackground(installer => installer.GetSeelen(update), Detect);
        }

        void Start(bool uninstall)
        {
            if (uninstall)
            {
                var question = "Remove the desktop surface, the command palette and the theme from Seelen UI?";
                if (MessageBox.Show(this, question, Text, MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) return;
            }
            options.Theme = themeBox.Checked;
            options.Voice = voiceBox.Checked;
            var current = seelen;
            RunInBackground(
                installer =>
                {
                    if (uninstall)
                    {
                        installer.Uninstall(current, false);
                        removeProgramDir = true;
                    }
                    else
                    {
                        installer.Install(current, options);
                    }
                },
                Detect);
        }

        void RunInBackground(Action<Installer> work, Action after)
        {
            busy = true;
            SetEnabled(false);
            progress.MarqueeAnimationSpeed = 30;
            if (logBox.TextLength > 0) Log("");
            var installer = new Installer(Log, Ask);
            var thread = new Thread(() =>
            {
                try
                {
                    work(installer);
                }
                catch (Exception e)
                {
                    Log("");
                    Log("Failed: " + e.Message);
                }
                finally
                {
                    BeginInvoke((Action)(() =>
                    {
                        busy = false;
                        progress.MarqueeAnimationSpeed = 0;
                        after();
                    }));
                }
            });
            thread.IsBackground = true;
            thread.Start();
        }

        void Log(string line)
        {
            if (IsDisposed) return;
            if (InvokeRequired)
            {
                BeginInvoke((Action<string>)Log, line);
                return;
            }
            logBox.AppendText(line + Environment.NewLine);
        }

        bool Ask(string question)
        {
            return (bool)Invoke((Func<bool>)(() => MessageBox.Show(this, question, Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes));
        }
    }

    static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            var options = new Options();
            for (int i = 0; i < args.Length; i++)
            {
                switch (args[i].TrimStart('-', '/').ToLowerInvariant())
                {
                    case "quiet": options.Quiet = true; break;
                    case "voice": options.Voice = true; break;
                    case "notheme":
                    case "no-theme": options.Theme = false; break;
                    case "uninstall": options.Uninstall = true; break;
                    case "log": if (i + 1 < args.Length) options.LogPath = args[++i]; break;
                    case "settings-test": return i + 2 < args.Length ? SettingsTest(args[i + 1], args[i + 2]) : -1;
                }
            }

            if (options.Quiet) return RunQuiet(options);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm(options));
            return 0;
        }

        /// <summary>No window; every question is answered yes. Exit codes: 0 done, 1 failed, 2 Seelen UI missing or too old.</summary>
        static int RunQuiet(Options options)
        {
            Action<string> log = line =>
            {
                if (options.LogPath != null) File.AppendAllText(options.LogPath, line + Environment.NewLine, new UTF8Encoding(false));
            };
            var installer = new Installer(log, question =>
            {
                log("? " + question + " -> yes");
                return true;
            });
            try
            {
                var seelen = Installer.DetectSeelen();
                if (options.Uninstall)
                {
                    installer.Uninstall(seelen, true);
                    Installer.RemoveProgramDirAfterExit();
                    return 0;
                }
                if (!seelen.Supported)
                {
                    log(Installer.Describe(seelen));
                    return 2;
                }
                installer.Install(seelen, options);
                return 0;
            }
            catch (Exception e)
            {
                log("Failed: " + e.Message);
                return 1;
            }
        }

        /// <summary>For the build's own check: applies the settings change to a copy. Exit code is the number of changes.</summary>
        static int SettingsTest(string input, string output)
        {
            var root = (JsonObject)Json.Parse(File.ReadAllText(input, Encoding.UTF8));
            var changes = SeelenSettings.Apply(root, new[] { "@ralfm/desktop", "@ralfm/palette" }, "@ralfm/surface", Installer.MissingEntryMeansEnabled);
            File.WriteAllText(output, Json.Write(root), new UTF8Encoding(false));
            return changes.Count;
        }
    }
}
