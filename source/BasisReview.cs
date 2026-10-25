using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace EnshroudedStudio
{
    public sealed class BasisReviewWindow
    {
        public Window Window { get; private set; }
        public bool Renewed { get; private set; }
        private readonly StudioStore store;
        private readonly Dictionary<string, object> config;
        private readonly string target;
        private readonly TextBlock summary, detail;
        private readonly CheckBox verified;
        private readonly Button renew, recheck, close;
        private readonly ProgressBar progress;
        private BasisStatus inspected;
        private bool busy;

        public BasisReviewWindow(StudioStore store, Dictionary<string, object> configuration, Window owner)
        {
            this.store = store; config = Json.Clone(configuration); target = (string)config["gameDirectory"];
            Window = new Window {
                Title = "Spielupdate · Patch-Basis", Owner = owner,
                Width = Math.Min(800, SystemParameters.WorkArea.Width - 24),
                Height = Math.Min(760, SystemParameters.WorkArea.Height - 24),
                MinWidth = 560, MinHeight = 420,
                WindowStartupLocation = WindowStartupLocation.CenterOwner,
                Background = StudioWindow.Brush("#101B29"), Foreground = Brushes.White,
                FontFamily = new FontFamily("Segoe UI"), FontSize = 15,
                UseLayoutRounding = true, SnapsToDevicePixels = true
            };
            if (owner != null) Window.Resources = owner.Resources;
            TextOptions.SetTextFormattingMode(Window, TextFormattingMode.Display);
            TextOptions.SetTextRenderingMode(Window, TextRenderingMode.ClearType);
            var layout = new Grid { Margin = new Thickness(26) };
            layout.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            layout.RowDefinitions.Add(new RowDefinition());
            layout.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var heading = new StackPanel();
            heading.Children.Add(Text("Nach einem Spielupdate", 26, "#FFFFFF", true));
            var subtitle = Text("Aktuelle Spieldateien als neue Ausgangsbasis verwenden", 16, "#C7D7E7");
            subtitle.Margin = new Thickness(0, 6, 0, 18); heading.Children.Add(subtitle);
            layout.Children.Add(heading);

            var body = new StackPanel();
            body.Children.Add(Text("AUSGEWÄHLTE INSTALLATION", 12, "#AFC3D8", true));
            var path = Text(target, 16, "#FFFFFF"); path.Margin = new Thickness(0, 6, 0, 18); body.Children.Add(path);
            summary = Text("Der aktuelle Dateistand wird geprüft …", 17, "#FFD39E", true);
            body.Children.Add(new Border { Child = summary, Background = StudioWindow.Brush("#1A2A3D"), Padding = new Thickness(16), CornerRadius = new CornerRadius(6), Margin = new Thickness(0, 0, 0, 18) });
            body.Children.Add(Text("1. Enshrouded und den Dedicated Server schließen.", 16, "#FFFFFF", true));
            body.Children.Add(Text("2. Die Dateien der ausgewählten Installation über Steam prüfen lassen.", 16, "#FFFFFF", true));
            var steam = Text("In Steam: Bibliothek → Enshrouded bzw. Enshrouded Dedicated Server → Eigenschaften → Installierte Dateien → Dateien auf Fehler überprüfen. Bei einem gemieteten Server die entsprechende Reparaturfunktion des Anbieters nutzen.", 14, "#C7D7E7");
            steam.Margin = new Thickness(0, 8, 0, 14); body.Children.Add(steam);
            body.Children.Add(Text("3. Neue Basis freigeben, danach das Profil erneut anwenden.", 16, "#FFFFFF", true));
            var explanation = Text("Die Freigabe legt nur die Zuordnung zur bisherigen Basis zurück. Alte Sicherungen bleiben erhalten. Es werden dabei keine alten Archive ins Spiel kopiert und noch keine Mods angewendet. Die neue Basis wird beim nächsten Patch aus den aktuellen Dateien gesichert; deine Profileinstellungen bleiben bestehen.", 14, "#C7D7E7");
            explanation.Margin = new Thickness(0, 8, 0, 16); body.Children.Add(explanation);
            verified = new CheckBox {
                Content = Text("Ich habe die Dateien dieser Installation nach dem Update über Steam bzw. den Anbieter prüfen lassen und verwende den unveränderten Stand als neue Ausgangsbasis.", 15, "#FFFFFF"),
                Margin = new Thickness(0, 0, 8, 12), Visibility = Visibility.Collapsed
            };
            ((TextBlock)verified.Content).MaxWidth = 430;
            verified.Checked += delegate { UpdateButtons(); }; verified.Unchecked += delegate { UpdateButtons(); };
            body.Children.Add(verified);
            var assurance = Text("Das Tool prüft Dateistand und Zuordnung. Ob die Steam-Dateiprüfung ausgeführt wurde, bestätigst du hier selbst.", 13, "#AFC3D8");
            assurance.Margin = new Thickness(0, 0, 0, 12); body.Children.Add(assurance);
            detail = Text("", 13, "#C7D7E7"); body.Children.Add(detail);
            var scroll = new ScrollViewer { Content = body, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
            if (Window.Resources.Contains("SlimScroll")) scroll.Style = (Style)Window.Resources["SlimScroll"];
            Grid.SetRow(scroll, 1); layout.Children.Add(scroll);

            var footer = new StackPanel { Margin = new Thickness(0, 18, 0, 0) };
            progress = new ProgressBar { Height = 4, IsIndeterminate = true, Foreground = StudioWindow.Brush("#63D5CF"), Margin = new Thickness(0, 0, 0, 14) };
            footer.Children.Add(progress);
            var actions = new WrapPanel { HorizontalAlignment = HorizontalAlignment.Right };
            recheck = new Button { Content = "Neu prüfen", Margin = new Thickness(0, 0, 8, 6), Padding = new Thickness(14, 9, 14, 9) };
            renew = new Button { Content = "Neue Basis freigeben", Margin = new Thickness(0, 0, 8, 6), Padding = new Thickness(14, 9, 14, 9), IsEnabled = false };
            close = new Button { Content = "Schließen", Margin = new Thickness(0, 0, 0, 6), Padding = new Thickness(14, 9, 14, 9) };
            recheck.Click += delegate { Run(false); }; renew.Click += delegate { Run(true); }; close.Click += delegate { Window.Close(); };
            actions.Children.Add(recheck); actions.Children.Add(renew); actions.Children.Add(close); footer.Children.Add(actions);
            Grid.SetRow(footer, 2); layout.Children.Add(footer); Window.Content = layout;
            Window.Closing += delegate(object sender, System.ComponentModel.CancelEventArgs e) { if (busy) e.Cancel = true; };
            Window.Loaded += delegate { Run(false); };
        }
        private static TextBlock Text(string value, double size, string color, bool bold = false)
        { return new TextBlock { Text = value, FontSize = size, Foreground = StudioWindow.Brush(color), FontWeight = bold ? FontWeights.SemiBold : FontWeights.Normal, TextWrapping = TextWrapping.Wrap }; }
        private void UpdateButtons()
        {
            renew.IsEnabled = !busy && inspected != null && inspected.CanRenew && verified.IsChecked == true;
            verified.IsEnabled = !busy; recheck.IsEnabled = !busy; close.IsEnabled = !busy;
            progress.Visibility = busy ? Visibility.Visible : Visibility.Collapsed;
        }
        private async void Run(bool renewing)
        {
            if (busy || (renewing && (inspected == null || !inspected.CanRenew || verified.IsChecked != true))) return;
            string token = renewing ? inspected.Token : null;
            busy = true; if (!renewing) { inspected = null; verified.IsChecked = false; verified.Visibility = Visibility.Collapsed; }
            summary.Text = renewing ? "Die bisherige Basis-Zuordnung wird zurückgelegt …" : "Der aktuelle Dateistand wird geprüft …";
            UpdateButtons();
            string directory = Path.Combine(store.DataRoot, "updates");
            string statusFile = Path.Combine(directory, "basis-" + Guid.NewGuid().ToString("N") + ".json");
            string logFile = Path.ChangeExtension(statusFile, ".log");
            string logProblem = null;
            try
            {
                BasisStatus result = await Task.Run(async delegate {
                    Directory.CreateDirectory(directory);
                    using (var process = store.LaunchBasisOperation(config, statusFile, renewing, token))
                    {
                        var stdout = process.StandardOutput.ReadToEndAsync();
                        var stderr = process.StandardError.ReadToEndAsync();
                        await Task.WhenAll(stdout, stderr); process.WaitForExit();
                        try { File.WriteAllText(logFile, stdout.Result + Environment.NewLine + stderr.Result, new UTF8Encoding(false)); }
                        catch (Exception ex) { logProblem = "Das zusätzliche Textprotokoll konnte nicht gespeichert werden: " + ex.Message; }
                        PatchProgress report = null;
                        try { report = PatchProgress.Read(statusFile); } catch { }
                        if (!PatchProgress.Succeeded(process.ExitCode, report))
                            throw new InvalidDataException(report == null ? "Kein bestätigtes Ergebnis der Basisprüfung (Exitcode " + process.ExitCode + ")." : report.Message);
                        var read = BasisStatus.Read(statusFile, target);
                        if (read.Operation != (renewing ? "renew-basis" : "inspect-basis"))
                            throw new InvalidDataException("Die Antwort gehört nicht zur angeforderten Basis-Aktion.");
                        return read;
                    }
                });
                inspected = result; summary.Text = result.GetFriendlyMessage();
                verified.Visibility = result.CanRenew ? Visibility.Visible : Visibility.Collapsed;
                detail.Text = "Installation: " + (result.TargetRole == "client" ? "Spielclient" : "Dedicated Server") +
                    " · aktueller EXE-Prüfwert: " + result.CurrentExe.Substring(0, 12) +
                    (result.PreviousExe == null ? "" : " · bisher: " + result.PreviousExe.Substring(0, 12)) +
                    (result.Warnings.Count == 0 ? "" : "\n" + string.Join("\n", result.Warnings)) +
                    (logProblem == null ? "\nProtokoll: " + logFile : "\n" + logProblem + "\nStatusdatei: " + statusFile);
                if (result.Renewed) { Renewed = true; busy = false; Window.DialogResult = true; return; }
            }
            catch (Exception ex)
            {
                inspected = null; verified.IsChecked = false; verified.Visibility = Visibility.Collapsed;
                summary.Text = "Das Ergebnis konnte nicht bestätigt werden: " + ex.Message;
                detail.Text = "Mit ‚Neu prüfen‘ den aktuellen Stand erneut einlesen. Auch bei einer fehlenden Abschlussmeldung kann der Vorgang bereits ausgeführt worden sein. Details: " + (logProblem == null ? logFile : statusFile + "\n" + logProblem);
            }
            finally { busy = false; UpdateButtons(); }
        }
        public static bool Open(StudioStore store, Dictionary<string, object> config, Window owner)
        {
            var review = new BasisReviewWindow(store, config, owner);
            return review.Window.ShowDialog() == true && review.Renewed;
        }
    }
}
