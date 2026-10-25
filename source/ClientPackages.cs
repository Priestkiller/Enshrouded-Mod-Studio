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
            if (!settings.ContainsKey("clientBasisDirectory")) settings["clientBasisDirectory"] = null;
            if (!settings.ContainsKey("outputDirectory")) settings["outputDirectory"] = Path.Combine(dataRoot, "client-packages");
            object value;
            if (Json.Number(settings["format"]) != 1 || !(settings["enabled"] is bool))
                throw new InvalidDataException("Die Clientpaket-Einrichtung hat ein unbekanntes Format.");
            if (settings.TryGetValue("clientBasisDirectory", out value) && value != null && !(value is string))
                throw new InvalidDataException("Der Pfad der Clientbasis ist ungültig.");
            if (!(settings["outputDirectory"] is string)) throw new InvalidDataException("Der Clientpaket-Ausgabeordner ist ungültig.");
            return settings;
        }
        public static void Save(string dataRoot, bool enabled, string clientBasisDirectory, string outputDirectory)
        {
            var settings = Load(dataRoot); // Preserve fields added by a future package builder.
            string output = AbsoluteDirectory(outputDirectory, "Paket-Ausgabeordner");
            string basis = string.IsNullOrWhiteSpace(clientBasisDirectory) ? null : AbsoluteDirectory(clientBasisDirectory, "Clientbasis");
            if (basis != null)
            {
                foreach (string name in new[] { "enshrouded.exe", "enshrouded.kfc", "enshrouded.kfc_resources" })
                    if (!File.Exists(Path.Combine(basis, name))) throw new InvalidDataException("Die Clientbasis benötigt " + name + ".");
                if (File.Exists(Path.Combine(basis, "enshrouded_server.exe"))) throw new InvalidDataException("Clientbasis und Dedicated Server müssen getrennte Ordner sein.");
                if (Within(basis, output) || Within(output, basis)) throw new InvalidDataException("Clientbasis und Paket-Ausgabeordner dürfen sich nicht überschneiden.");
            }
            settings["enabled"] = enabled;
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
                if (!File.Exists(file)) return "Für diese Installation wurde noch kein Clientpaket erstellt. Der nächste erfolgreiche Patch startet die Erstellung automatisch.";
                var report = Json.Read(file); object value;
                string state = report.TryGetValue("status", out value) ? value as string : null;
                string message = report.TryGetValue("message", out value) ? value as string : null;
                string revision = report.TryGetValue("revision", out value) ? Convert.ToString(value) : null;
                string directory = report.TryGetValue("packageDirectory", out value) ? value as string : null;
                string label = state == "ready" ? "Clientpaket erstellt" : state == "disabled" ? "Automatische Paketerstellung aus" : state == "blocked" ? "Clientpaket wartet auf Einrichtung" : (state == "error" || state == "failed") ? "Clientpaket nicht erstellt" : state == "invalidated" ? "Neues Clientpaket erforderlich" : "Clientpaket-Status";
                return label + (string.IsNullOrEmpty(revision) ? "" : " · Revision " + revision) + (string.IsNullOrEmpty(message) ? "" : "\n" + message) + (string.IsNullOrEmpty(directory) ? "" : "\n" + directory);
            }
            catch (Exception) { return "Der letzte Paketstatus konnte nicht gelesen werden. Details stehen im Patch-Protokoll."; }
        }
    }

    public static class ClientPackageUi
    {
        private static TextBlock Text(string value, double size)
        { return new TextBlock { Text = value, FontSize = size, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 9) }; }
        public static Panel Build(StudioStore store, Window owner, Func<string> gameDirectory, Action<Action> run, Action<string> saved, out Action refreshStatus)
        {
            var panel = new StackPanel();
            panel.Children.Add(Text("Nach jedem erfolgreich angewendeten Patch ein passendes Clientpaket für den Servermanager vorbereiten. Das Paket wird lokal erstellt; die Veröffentlichung und der Download im Spielerclient werden separat im Servermanager eingerichtet.", 15));
            Dictionary<string, object> settings;
            try { settings = ClientPackageSettings.Load(store.DataRoot); }
            catch (Exception error)
            {
                panel.Children.Add(Text("Einrichtung konnte nicht gelesen werden: " + error.Message + "\n" + ClientPackageSettings.FilePath(store.DataRoot), 15));
                refreshStatus = delegate { }; return panel;
            }
            var enabled = new CheckBox { Content = "Clientpaket nach erfolgreichem Patch automatisch erstellen", IsChecked = (bool)settings["enabled"], Margin = new Thickness(0, 4, 0, 14), FontSize = 16 };
            panel.Children.Add(enabled);
            panel.Children.Add(Text("Clientbasis für Serverpatches", 16));
            var basis = new TextBox { Text = settings["clientBasisDirectory"] as string ?? "", FontSize = 15, MinWidth = 180 };
            var browseBasis = new Button { Content = "Client wählen …", Margin = new Thickness(10, 0, 0, 0) };
            var basisRow = new DockPanel(); DockPanel.SetDock(browseBasis, Dock.Right); basisRow.Children.Add(browseBasis); basisRow.Children.Add(basis); panel.Children.Add(basisRow);
            var basisHelp = Text("Ein zum Serverbuild passender Spielclient mit enshrouded.exe, .kfc und .kfc_resources. Die Installation wird beim Paketbau nur gelesen. Bei einem Clientpatch verwendet das Tool dessen passende gesicherte Basis.", 14); basisHelp.Margin = new Thickness(0, 8, 0, 14); panel.Children.Add(basisHelp);
            browseBasis.Click += delegate
            {
                var dialog = new OpenFileDialog { Title = "Passenden Spielclient als Paketbasis wählen", Filter = "Enshrouded-Spielclient|enshrouded.exe", CheckFileExists = true };
                if (Directory.Exists(basis.Text)) dialog.InitialDirectory = basis.Text;
                if (dialog.ShowDialog(owner) == true) basis.Text = Path.GetDirectoryName(dialog.FileName);
            };
            panel.Children.Add(Text("Paket-Ausgabeordner", 16));
            var output = new TextBox { Text = (string)settings["outputDirectory"], FontSize = 15, MinWidth = 180 };
            var browseOutput = new Button { Content = "Ordner wählen …", Margin = new Thickness(10, 0, 0, 0) };
            var outputRow = new DockPanel(); DockPanel.SetDock(browseOutput, Dock.Right); outputRow.Children.Add(browseOutput); outputRow.Children.Add(output); panel.Children.Add(outputRow);
            var outputHelp = Text("Standard: neben Profilen und Patchdaten. Wähle bei Bedarf einen Ordner auf H:. Diese Einrichtung gilt für das Tool und wird nicht in exportierte Modprofile übernommen.", 14); outputHelp.Margin = new Thickness(0, 8, 0, 14); panel.Children.Add(outputHelp);
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
            Action refresh = delegate { state.Text = ClientPackageSettings.StatusText(store.DataRoot, gameDirectory()); state.Foreground = StudioWindow.Brush(state.Text.StartsWith("Clientpaket erstellt", StringComparison.Ordinal) ? "#A7E8DC" : "#F1D1A0"); };
            refreshStatus = refresh;
            var save = new Button { Content = "Paketeinrichtung speichern", HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 2, 0, 12) };
            save.Click += delegate { run(delegate { ClientPackageSettings.Save(store.DataRoot, enabled.IsChecked == true, basis.Text, output.Text); save.Content = "Paketeinrichtung speichern"; saved("Paketeinrichtung gespeichert. Sie gilt ab dem nächsten erfolgreichen Patch."); refresh(); }); };
            panel.Children.Add(save);
            foreach (Control control in new Control[] { enabled, basis, output })
            {
                var field = control as TextBox;
                if (field != null) field.TextChanged += delegate { save.Content = "Paketeinrichtung speichern *"; };
            }
            enabled.Checked += delegate { save.Content = "Paketeinrichtung speichern *"; };
            enabled.Unchecked += delegate { save.Content = "Paketeinrichtung speichern *"; };
            panel.Children.Add(state);
            var open = new Button { Content = "Gespeicherten Paket-Ausgabeordner öffnen", HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 4, 0, 0) };
            open.Click += delegate { run(delegate { string directory = (string)ClientPackageSettings.Load(store.DataRoot)["outputDirectory"]; if (!Directory.Exists(directory)) throw new DirectoryNotFoundException("Der Paketordner wird beim ersten erfolgreichen Paketbau angelegt."); Process.Start(new ProcessStartInfo(directory) { UseShellExecute = true }); }); };
            panel.Children.Add(open); refresh(); return panel;
        }
    }
}
