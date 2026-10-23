using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;

namespace EnshroudedStudio
{
    public static class SkillReview
    {
        public static void SelfTest(Action<bool, string> check, string sandbox)
        {
            string target = Path.Combine(sandbox, "points-inspection-target"), file = Path.Combine(sandbox, "points-inspection.json");
            var result = new Dictionary<string, object> { { "operation", "inspect-skill-points" }, { "targetDir", target }, { "targetRole", "client" }, { "build", "1273043" },
                { "requested", 4 }, { "enabled", true }, { "tableCount", 1 }, { "matchingRequested", 0 }, { "allMatch", false },
                { "resources", new object[] { new Dictionary<string, object> { { "guid", "82706b40-61b1-4b8f-8b23-dcec6971bda1" }, { "value", 2 } } } } };
            var document = new Dictionary<string, object> { { "stage", "complete" }, { "message", "fixture" }, { "outcome", "success" }, { "progress", 100 }, { "result", result } };
            Json.Write(file, document, null);
            check(Describe(file, target, 4, true).Contains("Installierter Wert: 2") && Describe(file, target, 4, true).Contains("weicht vom Profil ab"), "Skill inspection displays actual2 versus requested4 instead of claiming application");
            bool stale = false; try { Describe(file, target, 8, true); } catch (InvalidDataException) { stale = true; }
            check(stale, "Skill inspection refuses a stale result belonging to another requested value");
            result["allMatch"] = true; Json.Write(file, document, null); bool inconsistent = false;
            try { Describe(file, target, 4, true); } catch (InvalidDataException) { inconsistent = true; }
            check(inconsistent, "Skill inspection rejects contradictory success flags and actual table values");
        }
        public static string Describe(string file, string target, int requested, bool enabled)
        {
            var progress = PatchProgress.Read(file);
            if (!PatchProgress.Succeeded(0, progress)) throw new InvalidDataException("Die Archivprüfung wurde nicht bestätigt.");
            var result = Json.Object(Json.Read(file)["result"], "Punkteprüfung");
            if (Convert.ToString(result["operation"]) != "inspect-skill-points" ||
                !string.Equals(Path.GetFullPath(Convert.ToString(result["targetDir"])).TrimEnd('\\'), Path.GetFullPath(target).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase) ||
                Json.Number(result["requested"]) != requested || !(result["enabled"] is bool) || (bool)result["enabled"] != enabled)
                throw new InvalidDataException("Die Prüfung gehört zu einer anderen Installation oder Profileinstellung.");
            string role = result["targetRole"] as string;
            if (role != "client" && role != "server") throw new InvalidDataException("Die geprüfte Installationsart fehlt.");
            var resources = result["resources"] as object[];
            if (resources == null || resources.Length == 0 || resources.Length > 64 || Json.Number(result["tableCount"]) != resources.Length)
                throw new InvalidDataException("Keine eindeutige Punkte-Tabelle im Ergebnis.");
            var values = new List<int>(); var identities = new HashSet<string>();
            foreach (object row in resources)
            {
                var resource = Json.Object(row, "Punkte-Tabelle"); double number = Json.Number(resource["value"]); Guid guid;
                if (number < 1 || number > int.MaxValue || number != Math.Floor(number) || !Guid.TryParse(Convert.ToString(resource["guid"]), out guid) || !identities.Add(guid.ToString()))
                    throw new InvalidDataException("Ungültiger oder doppelter Tabellenwert.");
                values.Add((int)number);
            }
            bool all = values.All(value => value == requested);
            if (!(result["allMatch"] is bool) || (bool)result["allMatch"] != all || Json.Number(result["matchingRequested"]) != values.Count(value => value == requested))
                throw new InvalidDataException("Die gemeldeten Tabellenwerte widersprechen dem Gesamtvergleich.");
            return (role == "client" ? "SPIELCLIENT" : "DEDICATED SERVER") + " · Revision " + Convert.ToString(result["build"]) +
                "\n\nInstallierter Wert: " + string.Join(", ", values.Distinct().Select(value => value.ToString())) +
                " Punkte je Level\nProfilwert: " + requested + " · Option " + (enabled ? "eingeschaltet" : "ausgeschaltet") +
                "\n\n" + (all ? "Der installierte Tabellenwert entspricht dem Profil." : "Der installierte Tabellenwert weicht vom Profil ab. Speichern allein reicht nicht: den Patch auf diese Installation anwenden.") +
                (role == "server" ? "\n\nDieser Wert belegt ausschließlich die Serverdateien. Für zusätzliche Levelpunkte auch den Spielclient jedes Mitspielers mit demselben Wert patchen." : "\n\nNach einer Änderung Spiel und Server vollständig neu starten. Im Mehrspieler denselben Wert auf Server und allen Clients verwenden.") +
                "\n\nDie Prüfung liest die Archive. Die tatsächliche Punktevergabe bei einem Levelaufstieg muss im Spiel geprüft werden.";
        }

        public static void Open(StudioStore store, Dictionary<string, object> source, Window owner)
        {
            var config = Json.Clone(source); string target = (string)config["gameDirectory"];
            if (!StudioStore.CheckGame(target).EndsWith("erkannt")) throw new InvalidDataException("Zuerst eine vollständige Client- oder Serverinstallation wählen.");
            var option = Json.Object(Json.Object(config["player"], "Spieler")["adjustSkillPointsPerLevel"], "Fertigkeitspunkte");
            int requested = checked((int)Json.Number(option["value"])); bool enabled = (bool)option["enabled"];
            var window = new Window { Owner = owner, Title = "Installierte Fähigkeitspunkte prüfen", Width = 690, Height = 650, WindowStartupLocation = WindowStartupLocation.CenterOwner,
                Background = StudioWindow.Brush("#101B29"), Foreground = System.Windows.Media.Brushes.White, FontFamily = owner.FontFamily, FontSize = 15 };
            StudioWindow.FitToWorkArea(window, SystemParameters.WorkArea); window.Resources = owner.Resources;
            var panel = new DockPanel { Margin = new Thickness(24) };
            var close = new Button { Content = "Schließen", IsEnabled = false, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 15, 0, 0) };
            close.Click += delegate { window.Close(); }; DockPanel.SetDock(close, Dock.Bottom); panel.Children.Add(close);
            var text = new TextBlock { Text = "Aktuelle Archive werden an einer Kopie gelesen …\n\n" + target, TextWrapping = TextWrapping.Wrap, LineHeight = 25 };
            panel.Children.Add(new ScrollViewer { Content = text, VerticalScrollBarVisibility = ScrollBarVisibility.Auto }); window.Content = panel;
            bool busy = true; window.Closing += delegate(object sender, System.ComponentModel.CancelEventArgs e) { if (busy) e.Cancel = true; };
            window.Loaded += async delegate {
                string file = Path.Combine(store.DataRoot, "updates", "points-" + Guid.NewGuid().ToString("N") + ".json"), log = Path.ChangeExtension(file, ".log");
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(file));
                    string description = await Task.Run(async delegate {
                        using (var process = store.LaunchSkillInspection(config, file))
                        {
                            var stdout = process.StandardOutput.ReadToEndAsync(); var stderr = process.StandardError.ReadToEndAsync();
                            await Task.WhenAll(stdout, stderr); process.WaitForExit();
                            File.WriteAllText(log, stdout.Result + Environment.NewLine + stderr.Result, new UTF8Encoding(false));
                            if (process.ExitCode != 0) throw new InvalidDataException("Die Punkteprüfung wurde abgebrochen. Protokoll: " + log);
                            return Describe(file, target, requested, enabled);
                        }
                    });
                    text.Text = description + "\n\nInstallation: " + target + "\nProtokoll: " + log;
                }
                catch (Exception ex) { text.Text = "Kein bestätigter Archivwert: " + ex.Message; }
                finally { busy = false; close.IsEnabled = true; }
            };
            window.ShowDialog();
        }
    }
}
