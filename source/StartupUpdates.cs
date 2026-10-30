using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;

namespace EnshroudedStudio
{
    // Application preferences, separate from game profiles and patch options.
    public static class StartupUpdates
    {
        public const int CountdownSeconds = 8;
        public const int MaximumNotesCharacters = 40000;
        private const int MaximumStateBytes = 256 * 1024;
        private static string StateFile(string dataRoot) { return Path.Combine(dataRoot, "updates", "startup.json"); }
        private static void NoLinks(string file)
        {
            for (string current = Path.GetFullPath(file); !string.IsNullOrEmpty(current); current = Path.GetDirectoryName(current))
            {
                if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidDataException("Verknüpfte Updateeinstellungen werden nicht verwendet.");
                if (Path.GetDirectoryName(current) == current) break;
            }
        }
        private static Dictionary<string, object> Read(string dataRoot)
        {
            string file = StateFile(dataRoot); NoLinks(file);
            if (!File.Exists(file)) return new Dictionary<string, object>();
            if (new FileInfo(file).Length > MaximumStateBytes) throw new InvalidDataException("Die Updateeinstellungen sind zu groß.");
            return Json.Read(file);
        }
        private static void Save(string dataRoot, Dictionary<string, object> state)
        {
            string file = StateFile(dataRoot); NoLinks(file);
            if (Encoding.UTF8.GetByteCount(Json.Encode(state)) > MaximumStateBytes) throw new InvalidDataException("Die Updateeinstellungen sind zu groß.");
            Json.Write(file, state, Path.Combine(dataRoot, "backups"));
        }
        public static bool AutomaticEnabled(string dataRoot, out string warning)
        {
            warning = null;
            try
            {
                var state = Read(dataRoot); object value;
                if (!state.TryGetValue("automaticUpdates", out value)) return true;
                if (!(value is bool)) throw new InvalidDataException("Die automatische Updateeinstellung ist ungültig.");
                return (bool)value;
            }
            catch (Exception ex)
            { if (!(ex is IOException) && !(ex is UnauthorizedAccessException) && !(ex is InvalidDataException) && !(ex is ArgumentException) && !(ex is InvalidOperationException)) throw; warning = "Automatische Updates vorerst aus: " + ex.Message; return false; }
        }
        public static void SetAutomatic(string dataRoot, bool enabled)
        {
            Dictionary<string, object> state;
            try { state = Read(dataRoot); }
            catch (InvalidDataException) { state = new Dictionary<string, object>(); }
            catch (ArgumentException) { state = new Dictionary<string, object>(); }
            catch (InvalidOperationException) { state = new Dictionary<string, object>(); }
            state["automaticUpdates"] = enabled; Save(dataRoot, state);
        }
        public static string CleanNotes(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return "Für diese Version wurden keine Änderungsdetails angegeben.";
            var text = new StringBuilder(); bool truncated = false;
            foreach (char c in value.Replace("\r\n", "\n").Replace('\r', '\n'))
            {
                if (text.Length >= MaximumNotesCharacters) { truncated = true; break; }
                if ((!char.IsControl(c) || c == '\n' || c == '\t') && char.GetUnicodeCategory(c) != System.Globalization.UnicodeCategory.Format) text.Append(c);
            }
            return text.ToString().Trim() + (truncated ? "\n\nWeitere Einträge wurden gekürzt." : "");
        }
        public static bool ShouldCheck(bool enabled, bool handoff, bool testing, bool closed, bool busy, bool dirty, bool alreadyChecked)
        { return enabled && !handoff && !testing && !closed && !busy && !dirty && !alreadyChecked; }
        public static bool MayInstallAutomatically(UpdateResult release, bool closed, bool busy, bool dirty, bool installedMode = false)
        { return release != null && release.IsNewer && (installedMode ? release.InstallerAvailable : release.AutomaticInstallAvailable) && !closed && !busy && !dirty; }
        public static bool CanAttemptAutomatically(string dataRoot, string latestVersion, DateTime nowUtc)
        {
            var state = Read(dataRoot); object version, time;
            if (!state.TryGetValue("attemptedVersion", out version) || !(version is string) || (string)version != latestVersion) return true;
            DateTime started;
            if (!state.TryGetValue("attemptedAtUtc", out time) || !(time is string) || !DateTime.TryParse((string)time, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.RoundtripKind, out started)) return false;
            return nowUtc.ToUniversalTime() - started.ToUniversalTime() >= TimeSpan.FromMinutes(30);
        }
        public static void RecordAttempt(string dataRoot, string latestVersion, DateTime nowUtc)
        {
            UpdateCheck.ParseVersion(latestVersion); var state = Read(dataRoot);
            state["attemptedVersion"] = latestVersion; state["attemptedAtUtc"] = nowUtc.ToUniversalTime().ToString("o"); Save(dataRoot, state);
        }
        public static void EnsureBundledNotes(string appRoot, string dataRoot, string installedVersion)
        {
            var state = Read(dataRoot); object version;
            if (state.TryGetValue("installedUpdateVersion", out version) && version is string && (string)version == installedVersion) return;
            string file = Path.Combine(appRoot, "RELEASE-NOTES-" + installedVersion + ".txt");
            if (!File.Exists(file)) file = Path.Combine(appRoot, "AENDERUNGEN.txt");
            NoLinks(file); if (!File.Exists(file) || new FileInfo(file).Length > MaximumStateBytes) return;
            state["installedUpdateVersion"] = installedVersion; state["installedUpdateNotes"] = CleanNotes(File.ReadAllText(file, Encoding.UTF8)); Save(dataRoot, state);
        }
        public static System.Diagnostics.ProcessStartInfo InstallerStartInfo(string setup, int parentId, long parentStartUtcTicks)
        {
            if (parentId < 1 || parentStartUtcTicks < 1 || string.IsNullOrWhiteSpace(setup) || !Path.IsPathRooted(setup)) throw new InvalidDataException("Ungültige Startdaten für den geprüften Installer.");
            return new System.Diagnostics.ProcessStartInfo { FileName = setup, WorkingDirectory = Path.GetDirectoryName(setup), UseShellExecute = false,
                Arguments = "--update-existing --wait-pid " + parentId.ToString(System.Globalization.CultureInfo.InvariantCulture) + " --wait-start " + parentStartUtcTicks.ToString(System.Globalization.CultureInfo.InvariantCulture) + " --restart" };
        }
        public static async System.Threading.Tasks.Task StartInstalledUpdateAsync(string setup)
        {
            using (var current = System.Diagnostics.Process.GetCurrentProcess())
            using (var process = System.Diagnostics.Process.Start(InstallerStartInfo(setup, current.Id, current.StartTime.ToUniversalTime().Ticks)))
            {
                if (process == null) throw new IOException("Der geprüfte Installer konnte nicht gestartet werden.");
                await System.Threading.Tasks.Task.Delay(500);
                if (process.HasExited) throw new IOException("Der Installer konnte den Updatevorgang nicht vorbereiten. Das bisherige Studio bleibt geöffnet.");
            }
        }
        public static void RecordInstalled(string dataRoot, UpdateResult result)
        {
            if (result == null || !result.IsNewer) throw new InvalidDataException("Neue Updateversion fehlt.");
            var state = Read(dataRoot);
            state["installedUpdateVersion"] = UpdateCheck.DisplayVersion(result.LatestVersion);
            state["installedUpdateNotes"] = CleanNotes(result.ReleaseNotes);
            Save(dataRoot, state);
        }
        public static bool HasUnseenNotes(string dataRoot, string installedVersion)
        {
            var state = Read(dataRoot); object pending, seen;
            return state.TryGetValue("installedUpdateVersion", out pending) && pending is string &&
                UpdateCheck.ParseVersion((string)pending) == UpdateCheck.ParseVersion(installedVersion) &&
                (!state.TryGetValue("seenUpdateVersion", out seen) || !string.Equals(seen as string, (string)pending, StringComparison.Ordinal));
        }
        public static void MarkNotesSeen(string dataRoot, string installedVersion)
        {
            var state = Read(dataRoot); state["seenUpdateVersion"] = UpdateCheck.DisplayVersion(UpdateCheck.ParseVersion(installedVersion)); object attempted; if (state.TryGetValue("attemptedVersion", out attempted) && string.Equals(attempted as string, installedVersion, StringComparison.Ordinal)) { state.Remove("attemptedVersion"); state.Remove("attemptedAtUtc"); } Save(dataRoot, state);
        }
        private static Window NotesWindow(Window owner, string title, string heading, string notes, out StackPanel panel)
        {
            var window = new Window { Owner = owner, Title = title, Width = 680, SizeToContent = SizeToContent.Height,
                MaxHeight = Math.Max(350, SystemParameters.WorkArea.Height - 40), ResizeMode = ResizeMode.NoResize,
                WindowStartupLocation = WindowStartupLocation.CenterOwner, Background = new SolidColorBrush(Color.FromRgb(20, 31, 45)),
                Foreground = Brushes.White, FontFamily = owner.FontFamily, FontSize = 15 };
            window.Resources = owner.Resources; panel = new StackPanel { Margin = new Thickness(24) };
            panel.Children.Add(new TextBlock { Text = heading, FontSize = 21, FontWeight = FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 12) });
            panel.Children.Add(new TextBlock { Text = "Was sich geändert hat", FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 8, 0, 8) });
            panel.Children.Add(new ScrollViewer { Height = 220, VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                Content = new TextBox { Text = CleanNotes(notes), IsReadOnly = true, TextWrapping = TextWrapping.Wrap,
                    Background = Brushes.Transparent, Foreground = Brushes.White, BorderThickness = new Thickness(0), FontSize = 15, Padding = new Thickness(0, 0, 12, 0) } });
            window.Content = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Content = panel }; return window;
        }
        public static bool ShowUpdateNotice(Window owner, UpdateResult result, bool automatic)
        {
            StackPanel panel; var dialog = NotesWindow(owner, "Mod Studio aktualisieren", "Neue Version " + UpdateCheck.DisplayVersion(result.LatestVersion), result.ReleaseNotes, out panel);
            panel.Children.Add(new TextBlock { Text = "Installiert: " + UpdateCheck.DisplayVersion(result.InstalledVersion) + " → " + UpdateCheck.DisplayVersion(result.LatestVersion), Margin = new Thickness(0, 14, 0, 7) });
            panel.Children.Add(new TextBlock { Text = "Profile, Einstellungen und geprüfte Laufzeitdateien werden übernommen. Ein laufender Patch wird nicht unterbrochen.", TextWrapping = TextWrapping.Wrap });
            var countdown = new TextBlock { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 12, 0, 4) }; panel.Children.Add(countdown);
            var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 16, 0, 0) };
            var later = new Button { Content = "Später", IsCancel = true, Margin = new Thickness(0, 0, 10, 0) };
            var install = new Button { Content = "Jetzt aktualisieren", IsDefault = true };
            var timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) }; int remaining = CountdownSeconds;
            Action refresh = delegate { countdown.Text = "Automatische Aktualisierung in " + remaining + " Sekunden. Mit ‚Später‘ für diesen Start verschieben."; };
            if (automatic)
            {
                refresh(); var pause = new Button { Content = "In Ruhe lesen", Margin = new Thickness(0, 0, 10, 0) };
                pause.Click += delegate { timer.Stop(); countdown.Text = "Automatischer Start angehalten. Du kannst jetzt aktualisieren oder für diesen Start verschieben."; pause.IsEnabled = false; };
                buttons.Children.Add(pause);
                timer.Tick += delegate { remaining--; if (remaining <= 0) { timer.Stop(); dialog.DialogResult = true; } else refresh(); };
                dialog.Loaded += delegate { timer.Start(); };
            }
            else countdown.Visibility = Visibility.Collapsed;
            install.Click += delegate { timer.Stop(); dialog.DialogResult = true; };
            dialog.Closed += delegate { timer.Stop(); }; buttons.Children.Add(later); buttons.Children.Add(install); panel.Children.Add(buttons);
            return dialog.ShowDialog() == true;
        }
        public static void ShowInstalledNotes(Window owner, string dataRoot, string installedVersion, bool force)
        {
            if (!force && !HasUnseenNotes(dataRoot, installedVersion)) return;
            var state = Read(dataRoot); object notes, version;
            if (!state.TryGetValue("installedUpdateVersion", out version) || !(version is string) || UpdateCheck.ParseVersion((string)version) != UpdateCheck.ParseVersion(installedVersion)) return;
            if (!state.TryGetValue("installedUpdateNotes", out notes) || !(notes is string)) return;
            StackPanel panel; var dialog = NotesWindow(owner, "Neu im Mod Studio", "Aktualisierung auf " + UpdateCheck.DisplayVersion(UpdateCheck.ParseVersion(installedVersion)) + " abgeschlossen", (string)notes, out panel);
            var close = new Button { Content = "Weiter zum Mod Studio", IsDefault = true, IsCancel = true, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 18, 0, 0) };
            close.Click += delegate { dialog.DialogResult = true; }; panel.Children.Add(close); dialog.ShowDialog(); MarkNotesSeen(dataRoot, installedVersion);
        }
    }
}
