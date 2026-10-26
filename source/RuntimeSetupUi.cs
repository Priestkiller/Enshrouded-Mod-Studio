using System;
using System.IO;
using System.Diagnostics;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.Win32;

namespace EnshroudedStudio
{
    public static class RuntimeSetupUi
    {
        public static bool Open(Window owner, string appRoot)
        {
            if (RuntimeSetup.IsReady(appRoot))
            {
                MessageBox.Show(owner, "Patcher ist bereits eingerichtet. Kein Originalpaket mehr nötig. Wähle deinen Spielordner und die gewünschten Optionen und drücke ‚Patch anwenden / aktualisieren‘.", "Patcher ist bereit", MessageBoxButton.OK, MessageBoxImage.Information);
                return true;
            }
            bool installed = false, busy = false;
            var dialog = new Window { Owner = owner, Title = "Patcher einrichten", Width = 660, Height = 560, MinWidth = 540, MinHeight = 470, WindowStartupLocation = WindowStartupLocation.CenterOwner, Background = StudioWindow.Brush("#101B29"), Foreground = StudioWindow.Brush("#E5ECF4"), FontFamily = new FontFamily("Segoe UI"), FontSize = 15 };
            var panel = new StackPanel { Margin = new Thickness(24) };
            panel.Children.Add(new TextBlock { Text = "Patcher einrichten", FontSize = 24, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 0, 0, 12) });
            panel.Children.Add(new TextBlock { Text = "Du brauchst keinen alten Studioordner. Wähle das Original-Patcherpaket; diese Einrichtung ergänzt ausschließlich die geprüften Programmdateien.", TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 12) });
            var link = new Button { Content = "Offizielle Downloadseite öffnen", HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 0, 0, 8), Padding = new Thickness(12, 8, 12, 8) };
            link.Click += delegate { Process.Start(new ProcessStartInfo(RuntimeSetup.OfficialDownloadUrl) { UseShellExecute = true }); }; panel.Children.Add(link);
            panel.Children.Add(new TextBlock { Text = "Unterstützt: Original-Patcher " + RuntimeSetup.SupportedOriginalVersion + " mit passendem Custom-Parser. Andere Versionen werden erst nach einer Kompatibilitätsprüfung freigegeben.", Foreground = StudioWindow.Brush("#EFC186"), TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 15) });
            string selected = null, parser = null;
            var file = new TextBlock { Text = "Noch kein Originalpaket gewählt.", TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 8) }; panel.Children.Add(file);
            var browse = new Button { Content = "Original-ZIP oder Patcher-EXE wählen …", HorizontalAlignment = HorizontalAlignment.Left, Padding = new Thickness(12, 8, 12, 8), Margin = new Thickness(0, 0, 0, 8) };
            var parserBrowse = new Button { Content = "Parser-Datei wählen (nur bei einzelner EXE) …", HorizontalAlignment = HorizontalAlignment.Left, Padding = new Thickness(10, 7, 10, 7), Margin = new Thickness(0, 0, 0, 12), Visibility = Visibility.Collapsed };
            var status = new TextBlock { Text = "Profile, Einstellungen, Archivbasen und Spieldateien werden dabei nicht übernommen oder verändert.", TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 14) };
            var actions = new WrapPanel { HorizontalAlignment = HorizontalAlignment.Right };
            var install = new Button { Content = "Prüfen & einrichten", IsEnabled = false, Padding = new Thickness(14, 9, 14, 9), Margin = new Thickness(0, 0, 10, 0) };
            var close = new Button { Content = "Schließen", IsCancel = true, Padding = new Thickness(12, 9, 12, 9) };
            browse.Click += delegate {
                var picker = new OpenFileDialog { Title = "Original-Patcherpaket auswählen", Filter = "Original-Patcherpaket (*.zip;*.exe)|*.zip;*.exe|ZIP-Archiv (*.zip)|*.zip|Patcher (enshrouded-patcher.exe)|enshrouded-patcher.exe", CheckFileExists = true };
                if (picker.ShowDialog(dialog) != true) return;
                selected = picker.FileName; parser = null; file.Text = selected; install.IsEnabled = true; parserBrowse.Visibility = Path.GetExtension(selected).Equals(".exe", StringComparison.OrdinalIgnoreCase) ? Visibility.Visible : Visibility.Collapsed;
                status.Text = "Bereit zur Prüfung. Die Original-EXE wird bei der Einrichtung nicht gestartet.";
            };
            parserBrowse.Click += delegate {
                var picker = new OpenFileDialog { Title = "Passenden Original-Parser auswählen", Filter = "Custom-Parser (kfc-parser.exe)|kfc-parser.exe", CheckFileExists = true };
                if (picker.ShowDialog(dialog) == true) { parser = picker.FileName; status.Text = "Parser gewählt. Jetzt Prüfen & einrichten."; }
            };
            install.Click += async delegate {
                busy = true; browse.IsEnabled = parserBrowse.IsEnabled = link.IsEnabled = close.IsEnabled = install.IsEnabled = false;
                status.Text = "Originalpaket und Dateiprüfsummen prüfen …";
                try {
                    var result = await Task.Run(delegate { return RuntimeSetup.Install(selected, appRoot, parser); });
                    installed = true; status.Text = result.Message; status.Foreground = StudioWindow.Brush("#A5E3CB"); install.Content = "Eingerichtet";
                } catch (Exception ex) { status.Text = ex.Message; status.Foreground = StudioWindow.Brush("#EFC186"); install.IsEnabled = true; }
                finally { busy = false; browse.IsEnabled = parserBrowse.IsEnabled = link.IsEnabled = close.IsEnabled = true; }
            };
            close.Click += delegate { if (!busy) dialog.Close(); };
            dialog.Closing += delegate(object sender, System.ComponentModel.CancelEventArgs e) { if (busy) e.Cancel = true; };
            panel.Children.Add(browse); panel.Children.Add(parserBrowse); panel.Children.Add(status); actions.Children.Add(install); actions.Children.Add(close); panel.Children.Add(actions);
            dialog.Content = new ScrollViewer { Content = panel, VerticalScrollBarVisibility = ScrollBarVisibility.Auto }; dialog.ShowDialog(); return installed;
        }
    }
}
