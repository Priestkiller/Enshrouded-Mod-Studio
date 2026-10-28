using System;
using System.IO;
using System.Collections.Generic;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Win32;

namespace EnshroudedStudio
{
    // Local package setup is deliberately separate from transferable mod profiles.
    public static class ClientPackageSettings
    {
        public static string FilePath(string dataRoot) { return Path.Combine(dataRoot, "client-packages.json"); }
        public static Dictionary<string, object> Load(string dataRoot)
        {
            string file = FilePath(dataRoot);
            var settings = File.Exists(file) ? Json.Read(file) : new Dictionary<string, object>();
            if (!settings.ContainsKey("format")) settings["format"] = 1;
            if (!settings.ContainsKey("enabled")) settings["enabled"] = true;
            if (!settings.ContainsKey("transportMode")) settings["transportMode"] = "resource-recipe";
            if (!settings.ContainsKey("clientBasisDirectory")) settings["clientBasisDirectory"] = null;
            if (!settings.ContainsKey("outputDirectory")) settings["outputDirectory"] = Path.Combine(dataRoot, "client-packages");
            object value;
            if (Json.Number(settings["format"]) != 1 || !(settings["enabled"] is bool))
                throw new InvalidDataException("Die Clientpaket-Einrichtung hat ein unbekanntes Format.");
            if (settings.TryGetValue("clientBasisDirectory", out value) && value != null && !(value is string))
                throw new InvalidDataException("Der Pfad der Clientbasis ist ungültig.");
            if (!(settings["outputDirectory"] is string)) throw new InvalidDataException("Der Clientpaket-Ausgabeordner ist ungültig.");
            string mode = settings["transportMode"] as string;
            if (mode != "resource-recipe" && mode != "client-archive-delta") throw new InvalidDataException("Die gewählte Methode zur Modverteilung ist unbekannt.");
            return settings;
        }
        public static void Save(string dataRoot, bool enabled, string clientBasisDirectory, string outputDirectory)
        { SaveWithTransport(dataRoot, enabled, clientBasisDirectory, outputDirectory, "client-archive-delta"); }
        public static void SaveWithTransport(string dataRoot, bool enabled, string clientBasisDirectory, string outputDirectory, string transportMode)
        {
            var settings = Load(dataRoot); // Preserve fields added by a future package builder.
            if (transportMode != "resource-recipe" && transportMode != "client-archive-delta") throw new InvalidDataException("Die gewählte Methode zur Modverteilung ist unbekannt.");
            string output = AbsoluteDirectory(outputDirectory, "Paket-Ausgabeordner");
            string basis = string.IsNullOrWhiteSpace(clientBasisDirectory) ? null : clientBasisDirectory;
            if (basis != null && transportMode == "client-archive-delta")
            {
                basis = AbsoluteDirectory(basis, "Clientbasis");
                foreach (string name in new[] { "enshrouded.exe", "enshrouded.kfc", "enshrouded.kfc_resources" })
                    if (!File.Exists(Path.Combine(basis, name))) throw new InvalidDataException("Die Clientbasis benötigt " + name + ".");
                if (File.Exists(Path.Combine(basis, "enshrouded_server.exe"))) throw new InvalidDataException("Clientbasis und Dedicated Server müssen getrennte Ordner sein.");
                if (Within(basis, output) || Within(output, basis)) throw new InvalidDataException("Clientbasis und Paket-Ausgabeordner dürfen sich nicht überschneiden.");
            }
            settings["enabled"] = enabled;
            settings["transportMode"] = transportMode;
            settings["clientBasisDirectory"] = basis;
            settings["outputDirectory"] = output;
            Json.Write(FilePath(dataRoot), settings, null);
        }
        private static string AbsoluteDirectory(string value, string label)
        {
            if (string.IsNullOrWhiteSpace(value) || !Path.IsPathRooted(value) || Path.GetPathRoot(value).Length < 3 || !Path.GetPathRoot(value).EndsWith("\\"))
                throw new InvalidDataException(label + ": einen vollständigen absoluten Ordnerpfad angeben.");
            string result = Path.GetFullPath(value).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            if (result == Path.GetPathRoot(result + Path.DirectorySeparatorChar).TrimEnd(Path.DirectorySeparatorChar)) throw new InvalidDataException(label + ": einen eigenen Unterordner wählen.");
            if (File.Exists(result)) throw new InvalidDataException(label + ": der Pfad bezeichnet eine Datei.");
            return result;
        }
        private static bool Within(string root, string candidate)
        { return string.Equals(root, candidate, StringComparison.OrdinalIgnoreCase) || candidate.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase); }
        public static string StatusPath(string dataRoot, string gameDirectory)
        { return Path.Combine(dataRoot, "client-package-status", PatchBasis.TargetId(gameDirectory) + ".json"); }
        public static string StatusText(string dataRoot, string gameDirectory)
        {
            if (string.IsNullOrWhiteSpace(gameDirectory)) return "Für den Paketstatus zuerst eine Zielinstallation auswählen.";
            try
            {
                string file = StatusPath(dataRoot, gameDirectory);
                if (!File.Exists(file)) return "Noch keine Änderungen für Spieler bereitgestellt. Das gewünschte Profil mit Patch anwenden / aktualisieren übernehmen.";
                var report = Json.Read(file); object value;
                string state = report.TryGetValue("status", out value) ? value as string : null;
                string message = report.TryGetValue("message", out value) ? value as string : null;
                string label = state == "ready" ? "Änderungen für Spieler bereitgestellt" : state == "disabled" ? "Automatische Bereitstellung ausgeschaltet" : state == "blocked" || state == "waiting-client-basis" ? "Bereitstellung angehalten" : (state == "error" || state == "failed") ? "Änderungen nicht bereitgestellt" : state == "invalidated" ? "Aktuelles Änderungspaket erforderlich" : state == "building" || state == "preparing" ? "Änderungen werden vorbereitet …" : "Bereitstellungsstatus noch nicht bestätigt";
                return label + (string.IsNullOrEmpty(message) ? "" : "\n" + message);
            }
            catch (Exception) { return "Der letzte Paketstatus konnte nicht gelesen werden. Details stehen im Patch-Protokoll."; }
        }
        public static string StatusState(string dataRoot, string gameDirectory)
        {
            if (string.IsNullOrWhiteSpace(gameDirectory)) return "";
            try { string file = StatusPath(dataRoot, gameDirectory); if (!File.Exists(file)) return ""; var report = Json.Read(file); object value; return report.TryGetValue("status", out value) ? value as string ?? "" : ""; }
            catch (Exception) { return "unknown"; }
        }
    }

    public static class ClientPackageUi
    {
        private static TextBlock Text(string value, double size)
        { return new TextBlock { Text = value, FontSize = size, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 9) }; }
        public static Panel Build(StudioStore store, Window owner, Func<string> gameDirectory, Action<Action> run, Action<string> saved, out Action refreshStatus)
        {
            var panel = new StackPanel();
            panel.Children.Add(Text("Vorhandene Serverbasis verwenden. Der Manager verteilt die Änderungen; die Spieler wenden sie beim Synchronisieren auf ihre eigenen Spieldateien an.", 15));
            Dictionary<string, object> settings;
            try { settings = ClientPackageSettings.Load(store.DataRoot); }
            catch (Exception error)
            {
                panel.Children.Add(Text("Einrichtung konnte nicht gelesen werden: " + error.Message + "\n" + ClientPackageSettings.FilePath(store.DataRoot), 15));
                refreshStatus = delegate { }; return panel;
            }
            var enabled = new CheckBox { Content = "Änderungen nach erfolgreichem Serverpatch automatisch bereitstellen", IsChecked = (bool)settings["enabled"], Margin = new Thickness(0, 4, 0, 14), FontSize = 16 };
            panel.Children.Add(enabled);
            var stages = new StackPanel { Margin = new Thickness(0, 4, 0, 14) };
            var patchStep = Text("1 · Serverpatch\nProfil wählen und unten Patch anwenden / aktualisieren ausführen.", 15);
            var packageStep = Text("2 · Änderungen bereitstellen\nWartet auf die Prüfung des aktuellen Pakets.", 15);
            var playerStep = Text("3 · Spieler synchronisieren\nIm Spielerclient Synchronisieren & Spielen wählen, sobald der Manager die Änderungen freigibt.", 15);
            stages.Children.Add(patchStep); stages.Children.Add(packageStep); stages.Children.Add(playerStep); panel.Children.Add(stages);
            var advanced = new StackPanel();
            var legacy = new CheckBox { Content = "Ältere Methode mit fertig gepatchten Clientarchiven verwenden", IsChecked = (string)settings["transportMode"] == "client-archive-delta", Margin = new Thickness(0, 4, 0, 12), FontSize = 14 };
            advanced.Children.Add(legacy);
            advanced.Children.Add(Text("Nur für bestehende Einrichtungen: Diese ältere Methode benötigt zusätzlich eine getrennte Spielclient-Installation auf dem Serverrechner. Für die normale Verteilung ausgeschaltet lassen.", 14));
            advanced.Children.Add(Text("Clientbasis der älteren Methode", 16));
            var basis = new TextBox { Text = settings["clientBasisDirectory"] as string ?? "", FontSize = 15, MinWidth = 180 };
            var browseBasis = new Button { Content = "Client wählen …", Margin = new Thickness(10, 0, 0, 0) };
            var basisRow = new DockPanel(); DockPanel.SetDock(browseBasis, Dock.Right); basisRow.Children.Add(browseBasis); basisRow.Children.Add(basis); advanced.Children.Add(basisRow);
            var basisHelp = Text("Die Spielversion muss zum Server passen. Der gewählte Ordner wird nur von der älteren Paketmethode verwendet.", 14); basisHelp.Margin = new Thickness(0, 8, 0, 14); advanced.Children.Add(basisHelp);
            browseBasis.Click += delegate
            {
                var dialog = new OpenFileDialog { Title = "Passenden Spielclient als Paketbasis wählen", Filter = "Enshrouded-Spielclient|enshrouded.exe", CheckFileExists = true };
                if (Directory.Exists(basis.Text)) dialog.InitialDirectory = basis.Text;
                if (dialog.ShowDialog(owner) == true) basis.Text = Path.GetDirectoryName(dialog.FileName);
            };
            advanced.Children.Add(Text("Paket-Ausgabeordner", 16));
            var output = new TextBox { Text = (string)settings["outputDirectory"], FontSize = 15, MinWidth = 180 };
            var browseOutput = new Button { Content = "Ordner wählen …", Margin = new Thickness(10, 0, 0, 0) };
            var outputRow = new DockPanel(); DockPanel.SetDock(browseOutput, Dock.Right); outputRow.Children.Add(browseOutput); outputRow.Children.Add(output); advanced.Children.Add(outputRow);
            var outputHelp = Text("Bei einem verbundenen Manager wird dessen gemeinsame Ablage automatisch verwendet. Für andere Einrichtungen hier einen eigenen Ordner wählen, bei Bedarf auf H:.", 14); outputHelp.Margin = new Thickness(0, 8, 0, 14); advanced.Children.Add(outputHelp);
            browseOutput.Click += delegate
            {
                using (var dialog = new System.Windows.Forms.FolderBrowserDialog())
                {
                    dialog.Description = "Lokalen Ausgabeordner für Clientpakete wählen.";
                    if (Directory.Exists(output.Text)) dialog.SelectedPath = output.Text;
                    if (dialog.ShowDialog() == System.Windows.Forms.DialogResult.OK) output.Text = dialog.SelectedPath;
                }
            };
            var state = Text("", 14); state.Foreground = StudioWindow.Brush("#A7E8DC");
            Action refresh = delegate {
                string status = ClientPackageSettings.StatusState(store.DataRoot, gameDirectory());
                bool ready = status == "ready";
                state.Text = ClientPackageSettings.StatusText(store.DataRoot, gameDirectory()); state.Foreground = StudioWindow.Brush(ready ? "#A7E8DC" : "#F1D1A0");
                patchStep.Text = "1 · Serverpatch\n" + (ready ? "Erfolgreicher Patch für dieses Paket bestätigt." : "Profil mit Patch anwenden / aktualisieren übernehmen. Das Patch-Ergebnis steht im Protokoll.");
                patchStep.Foreground = StudioWindow.Brush(ready ? "#A7E8DC" : "#D6E6FF");
                packageStep.Text = "2 · Änderungen bereitstellen\n" + (ready ? "Paket geprüft und lokal bereit. Der Manager prüft und übernimmt es." : status == "building" || status == "preparing" ? "Die Bereitstellung läuft …" : "Für den aktuellen Stand noch nicht bestätigt.");
                packageStep.Foreground = StudioWindow.Brush(ready ? "#A7E8DC" : "#F1D1A0");
            };
            refreshStatus = refresh;
            var save = new Button { Content = "Bereitstellung speichern", HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 2, 0, 12) };
            save.Click += delegate { run(delegate { ClientPackageSettings.SaveWithTransport(store.DataRoot, enabled.IsChecked == true, basis.Text, output.Text, legacy.IsChecked == true ? "client-archive-delta" : "resource-recipe"); save.Content = "Bereitstellung speichern"; saved("Bereitstellung gespeichert. Das Profil anschließend mit Patch anwenden / aktualisieren übernehmen."); refresh(); }); };
            panel.Children.Add(save);
            foreach (Control control in new Control[] { enabled, basis, output })
            {
                var field = control as TextBox;
                if (field != null) field.TextChanged += delegate { save.Content = "Bereitstellung speichern *"; };
            }
            enabled.Checked += delegate { save.Content = "Bereitstellung speichern *"; };
            enabled.Unchecked += delegate { save.Content = "Bereitstellung speichern *"; };
            Action legacyState = delegate { basisRow.IsEnabled = legacy.IsChecked == true; basisHelp.Opacity = legacy.IsChecked == true ? 1 : 0.6; save.Content = "Bereitstellung speichern *"; };
            legacy.Checked += delegate { legacyState(); }; legacy.Unchecked += delegate { legacyState(); };
            basisRow.IsEnabled = legacy.IsChecked == true; basisHelp.Opacity = legacy.IsChecked == true ? 1 : 0.6;
            panel.Children.Add(state);
            var open = new Button { Content = "Gespeicherten Paket-Ausgabeordner öffnen", HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 4, 0, 0) };
            open.Click += delegate { run(delegate { string directory = (string)ClientPackageSettings.Load(store.DataRoot)["outputDirectory"]; if (!Directory.Exists(directory)) throw new DirectoryNotFoundException("Der Paketordner wird beim ersten erfolgreichen Paketbau angelegt."); Process.Start(new ProcessStartInfo(directory) { UseShellExecute = true }); }); };
            advanced.Children.Add(open);
            panel.Children.Add(new Expander { Header = "Erweiterte Einrichtung · ältere Paketmethode & Speicherort", IsExpanded = false, Content = advanced, Margin = new Thickness(0, 14, 0, 0) });
            refresh(); return panel;
        }
    }
}
