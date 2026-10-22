using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace EnshroudedStudio
{
    public sealed class StackReviewWindow
    {
        public Window Window { get; private set; }
        private readonly StudioStore store;
        private readonly Dictionary<string, object> config;
        private readonly string target;
        private readonly int requested;
        private readonly bool enabled;
        private readonly TextBlock summary, metadata, guidance, diagnostics;
        private readonly StackPanel values;
        private readonly Button refresh, close;
        private readonly ProgressBar progress;
        private bool busy;

        public StackReviewWindow(StudioStore store, Dictionary<string, object> configuration, Window owner)
        {
            this.store = store; config = Json.Clone(configuration); target = (string)config["gameDirectory"];
            var option = Json.Object(Json.Object(config["inventory"], "Inventar")["adjustStackSize"], "Stapelgröße");
            requested = checked((int)Json.Number(option["value"])); enabled = (bool)option["enabled"];
            Window = new Window { Title = "Installierte Stapel prüfen", Owner = owner,
                Width = Math.Min(840, SystemParameters.WorkArea.Width - 24), Height = Math.Min(790, SystemParameters.WorkArea.Height - 24),
                MinWidth = 560, MinHeight = 420, WindowStartupLocation = WindowStartupLocation.CenterOwner,
                Background = StudioWindow.Brush("#101B29"), Foreground = Brushes.White, FontFamily = new FontFamily("Segoe UI"), FontSize = 15,
                UseLayoutRounding = true, SnapsToDevicePixels = true };
            if (owner != null) Window.Resources = owner.Resources;
            TextOptions.SetTextFormattingMode(Window, TextFormattingMode.Display); TextOptions.SetTextRenderingMode(Window, TextRenderingMode.ClearType);
            var layout = new Grid { Margin = new Thickness(26) };
            layout.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); layout.RowDefinitions.Add(new RowDefinition()); layout.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var heading = new StackPanel(); heading.Children.Add(Text("Installierte Stapel prüfen", 26, "#FFFFFF", true));
            var subtitle = Text("Tatsächliche Archivwerte mit deinem Profil vergleichen", 16, "#C7D7E7"); subtitle.Margin = new Thickness(0, 6, 0, 18); heading.Children.Add(subtitle); layout.Children.Add(heading);
            var body = new StackPanel();
            body.Children.Add(Text("AUSGEWÄHLTE INSTALLATION", 12, "#AFC3D8", true));
            var path = Text(target, 16, "#FFFFFF"); path.Margin = new Thickness(0, 6, 0, 12); body.Children.Add(path);
            metadata = Text("Profilwert: " + requested.ToString("N0", CultureInfo.GetCultureInfo("de-DE")) + " · Option " + (enabled ? "eingeschaltet" : "ausgeschaltet"), 14, "#C7D7E7"); metadata.Margin = new Thickness(0, 0, 0, 16); body.Children.Add(metadata);
            summary = Text("Die installierten Archive werden an einer Kopie ausgelesen. Das kann einen Moment dauern …", 17, "#FFD39E", true);
            body.Children.Add(new Border { Child = summary, Background = StudioWindow.Brush("#1A2A3D"), Padding = new Thickness(16), CornerRadius = new CornerRadius(6), Margin = new Thickness(0, 0, 0, 18) });
            guidance = Text("Diese Prüfung liest den ausgewählten Client- oder Serverstand. Sie ändert keine Spieldateien und wendet kein Profil an.", 15, "#D8E6F2"); guidance.Margin = new Thickness(0, 0, 0, 18); body.Children.Add(guidance);
            values = new StackPanel(); body.Children.Add(values);
            diagnostics = Text("", 13, "#AFC3D8"); diagnostics.Margin = new Thickness(0, 16, 0, 0); body.Children.Add(diagnostics);
            var scroll = new ScrollViewer { Content = body, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
            if (Window.Resources.Contains("SlimScroll")) scroll.Style = (Style)Window.Resources["SlimScroll"]; Grid.SetRow(scroll, 1); layout.Children.Add(scroll);
            var footer = new StackPanel { Margin = new Thickness(0, 18, 0, 0) };
            footer.Children.Add(Text("Archivnachweis: Die Wirkung im laufenden Spiel und der Zustand eines anderen Rechners werden hier nicht geprüft.", 13, "#AFC3D8"));
            progress = new ProgressBar { Height = 4, IsIndeterminate = true, Foreground = StudioWindow.Brush("#63D5CF"), Margin = new Thickness(0, 12, 0, 12) }; footer.Children.Add(progress);
            var actions = new WrapPanel { HorizontalAlignment = HorizontalAlignment.Right };
            refresh = new Button { Content = "Erneut prüfen", Padding = new Thickness(15, 9, 15, 9), Margin = new Thickness(0, 0, 8, 0) };
            close = new Button { Content = "Schließen", Padding = new Thickness(15, 9, 15, 9) };
            refresh.Click += delegate { Run(); }; close.Click += delegate { Window.Close(); }; actions.Children.Add(refresh); actions.Children.Add(close); footer.Children.Add(actions);
            Grid.SetRow(footer, 2); layout.Children.Add(footer); Window.Content = layout;
            Window.Closing += delegate(object sender, System.ComponentModel.CancelEventArgs e) { if (busy) e.Cancel = true; }; Window.Loaded += delegate { Run(); };
        }
        private static TextBlock Text(string value, double size, string color, bool bold = false)
        { return new TextBlock { Text = value, FontSize = size, Foreground = StudioWindow.Brush(color), FontWeight = bold ? FontWeights.SemiBold : FontWeights.Normal, TextWrapping = TextWrapping.Wrap }; }
        private static string SampleName(string value)
        {
            switch (value)
            {
                case "Material_Wood": case "Material_T1_Wood_Logs": return "Holzscheite";
                case "Material_T1_Resin": return "Harz";
                case "Material_T2_Wood_Hardwood": return "Hartholz";
                default: return value;
            }
        }
        private void SetBusy(bool value)
        { busy = value; refresh.IsEnabled = !value; close.IsEnabled = !value; progress.Visibility = value ? Visibility.Visible : Visibility.Collapsed; }
        private async void Run()
        {
            if (busy) return; SetBusy(true); values.Children.Clear(); diagnostics.Text = "";
            summary.Text = "Die installierten Archive werden an einer Kopie ausgelesen. Das kann einen Moment dauern …";
            string dir = Path.Combine(store.DataRoot, "updates"), file = Path.Combine(dir, "stacks-" + Guid.NewGuid().ToString("N") + ".json"), log = Path.ChangeExtension(file, ".log"), logProblem = null;
            try
            {
                StackStatus result = await Task.Run(async delegate {
                    Directory.CreateDirectory(dir);
                    using (var process = store.LaunchStackInspection(config, file))
                    {
                        var stdout = process.StandardOutput.ReadToEndAsync(); var stderr = process.StandardError.ReadToEndAsync();
                        await Task.WhenAll(stdout, stderr); process.WaitForExit();
                        try { File.WriteAllText(log, stdout.Result + Environment.NewLine + stderr.Result, new UTF8Encoding(false)); }
                        catch (Exception ex) { logProblem = "Zusätzliches Textprotokoll nicht gespeichert: " + ex.Message; }
                        PatchProgress report = null; try { report = PatchProgress.Read(file); } catch { }
                        if (!PatchProgress.Succeeded(process.ExitCode, report)) throw new InvalidDataException(report == null ? "Kein bestätigter Abschluss der Stapelprüfung (Exitcode " + process.ExitCode + ")." : report.Message);
                        return StackStatus.Read(file, target, requested, enabled);
                    }
                });
                Render(result); diagnostics.Text = (result.Warnings.Count == 0 ? "" : string.Join("\n", result.Warnings) + "\n") +
                    (logProblem == null ? "Protokoll: " + log : logProblem + "\nStatusdatei: " + file);
            }
            catch (Exception ex)
            {
                summary.Text = "Das Ergebnis konnte nicht bestätigt werden: " + ex.Message;
                guidance.Text = "Bitte Installationsordner und Protokoll prüfen und die Prüfung erneut starten. Aus dieser Meldung lässt sich kein bestätigter Stapelwert ableiten.";
                diagnostics.Text = logProblem == null ? "Protokoll: " + log : logProblem + "\nStatusdatei: " + file;
            }
            finally { SetBusy(false); }
        }
        private void Render(StackStatus result)
        {
            var culture = CultureInfo.GetCultureInfo("de-DE");
            summary.Text = result.GetFriendlyMessage(); summary.Foreground = StudioWindow.Brush(result.Enabled && !result.AllMatch ? "#FFD39E" : "#A7E8DC");
            metadata.Text = (result.TargetRole == "server" ? "Dedicated Server" : "Spielclient") + " · Revision " + result.Build.Split('|')[0] + " · Profilwert " + result.Requested.ToString("N0", culture) + " · Option " + (result.Enabled ? "eingeschaltet" : "ausgeschaltet");
            if (!result.Enabled) guidance.Text = "Die Stapeloption ist im aktuellen Profil ausgeschaltet. Die Zahlen zeigen nur den Dateistand im Vergleich zum eingetragenen Wert. Zum Ändern die Option einschalten und anschließend ‚Patch anwenden / aktualisieren‘ drücken.";
            else if (!result.AllMatch) guidance.Text = "Die Archive enthalten den gewünschten Wert noch nicht vollständig. Prüfe den gewählten Client- bzw. Serverordner und den bestätigten Patch-Abschluss. Nach einem Steam-Spielupdate: Dateien prüfen lassen, unter Werkzeuge ‚Spielupdate / Basis wechseln‘ nutzen und das Profil erneut anwenden. Danach hier nochmals prüfen.";
            else guidance.Text = "Der Profilwert steht vollständig in den geprüften Archivdaten. Zum Spieltest nach einem Neustart zwei Stapel desselben Gegenstands zusammenlegen oder weitere Exemplare aufnehmen. Der Wert setzt ein Limit; er erzeugt keine zusätzlichen Gegenstände und erhöht bestehende Mengen nicht automatisch. Bei weiterhin altem Limit den tatsächlich gestarteten Client und verbundenen Server prüfen.";
            values.Children.Add(Text("GEFUNDENE STAPELLIMITS", 12, "#AFC3D8", true));
            foreach (var row in result.Distribution)
                values.Children.Add(Text(row.Value.ToString("N0", culture) + " pro Stapel  ·  " + row.Count.ToString("N0", culture) + " Gegenstandsarten", 15, row.Value == result.Requested ? "#A7E8DC" : "#D8E6F2"));
            var singles = Text(result.SingletonCount.ToString("N0", culture) + " Einzeleinträge mit Limit 1 sind separat gezählt. Sie werden durch die Stapeloption nicht stapelbar gemacht.", 14, "#AFC3D8"); singles.Margin = new Thickness(0, 9, 0, 18); values.Children.Add(singles);
            values.Children.Add(Text("BEISPIELE AUS DEM ARCHIV", 12, "#AFC3D8", true));
            foreach (var sample in result.Samples.Take(8)) values.Children.Add(Text(SampleName(sample.Name) + "  ·  " + sample.Value.ToString("N0", culture), 14, "#D8E6F2"));
            var build = Text("Gelesener Stand: " + result.Build + "\nEXE-Prüfwert: " + result.ExeHash, 12, "#AFC3D8"); build.Margin = new Thickness(0, 15, 0, 0); values.Children.Add(build);
        }
        public static void Open(StudioStore store, Dictionary<string, object> config, Window owner)
        { new StackReviewWindow(store, config, owner).Window.ShowDialog(); }
    }
}
