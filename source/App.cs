using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Collections.Generic;
using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Markup;
using System.Windows.Data;
using System.Windows.Automation;
using System.Windows.Input;
using System.Windows.Threading;
using System.Diagnostics;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace EnshroudedStudio
{
    public class StudioWindow
    {
        public Window Window;
        public StudioStore Store;
        public Profile Current;
        public Dictionary<string, object> Config;
        public bool Dirty;
        public string ProfileLoadError;
        public Dictionary<string, string> Drafts = new Dictionary<string, string>();
        public Dictionary<string, string> InputErrors = new Dictionary<string, string>();
        public Dictionary<string, CheckBox> Toggles = new Dictionary<string, CheckBox>();
        public Dictionary<string, TextBox> Fields = new Dictionary<string, TextBox>();
        public Dictionary<string, ComboBox> ChoiceFields = new Dictionary<string, ComboBox>();
        public Dictionary<string, Expander> Details = new Dictionary<string, Expander>();
        public HashSet<string> OpenDetails = new HashSet<string>();
        private bool loading;
        private bool patcherRunning;
        private bool checkingUpdates;
        private bool installingUpdate;
        private bool windowClosed;
        private bool testMode;
        private int runtimeMissingCount;
        private Process engineProcess;
        private bool directUpdate;
        private string patchStatusFile, patchLogFile;
        private StreamWriter patchLog;
        private readonly object logLock = new object();
        private ListBox categories;
        private ComboBox profiles;
        private StackPanel options;
        private TextBox search, gamePath;
        private CheckBox onlyActive;
        private TextBlock notice, status, gameStatus;
        private TextBlock skillTargetHint;
        private Action refreshClientPackageStatus;
        private readonly Dictionary<string, Action> targetRoleUpdates = new Dictionary<string, Action>();
        private StackPanel skillClientActions;
        private string selected = "inventory";
        private Grid optionsGrid;
        private int cardRow;
        private DispatcherTimer timer;

        public T Find<T>(string name) where T : class { return Window.FindName(name) as T; }
        public static Brush Brush(string hex) { return (Brush)new BrushConverter().ConvertFromString(hex); }
        public StudioWindow(StudioStore store, bool testing)
        {
            Store = store; testMode = testing;
            runtimeMissingCount = testMode ? 0 : RuntimeImport.CountExpectedMissing(store.AppRoot);
            using (var stream = File.OpenRead(Path.Combine(store.AppRoot, "assets", "MainWindow.xaml"))) Window = (Window)XamlReader.Load(stream);
            FitWindowToWorkArea(SystemParameters.WorkArea);
            string heroFile = Path.Combine(store.AppRoot, "assets", "shroud-valley.png");
            if (File.Exists(heroFile)) Find<Image>("HeroArt").Source = new BitmapImage(new Uri(heroFile));
            var heroGrid = (Grid)Find<Image>("HeroArt").Parent;
            heroGrid.SizeChanged += delegate { heroGrid.Clip = new RectangleGeometry(new Rect(0, 0, heroGrid.ActualWidth, heroGrid.ActualHeight), 10, 10); };
            string iconFile = Path.Combine(store.AppRoot, "assets", "studio-icon.png");
            if (File.Exists(iconFile)) Window.Icon = BitmapFrame.Create(new Uri(iconFile));
            Find<Button>("MinimizeWindow").Click += delegate { Window.WindowState = WindowState.Minimized; };
            Find<Button>("MaximizeWindow").Click += delegate { Window.WindowState = Window.WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized; };
            Find<Button>("CloseWindow").Click += delegate { Window.Close(); };
            categories = Find<ListBox>("Categories"); profiles = Find<ComboBox>("Profiles"); options = Find<StackPanel>("OptionsPanel");
            search = Find<TextBox>("Search"); gamePath = Find<TextBox>("GamePath"); onlyActive = Find<CheckBox>("OnlyActive");
            notice = Find<TextBlock>("Notice"); status = Find<TextBlock>("SaveStatus"); gameStatus = Find<TextBlock>("GameStatus");
            AutomationProperties.SetName(search, "Funktionen durchsuchen");
            AutomationProperties.SetName(gamePath, "Enshrouded-Ordner");
            AutomationProperties.SetName(profiles, "Profil auswählen");
            foreach (var cat in Store.Schema)
            {
                var row = new DockPanel();
                var count = new TextBlock { Text = cat.Mods.Count == 0 ? "" : cat.Mods.Count.ToString("00"), FontSize = 13, Foreground = Brush("#AFC3D8"), VerticalAlignment = VerticalAlignment.Center };
                DockPanel.SetDock(count, Dock.Right); row.Children.Add(count);
                var navIcon = Icon(cat.Key, "#7595B0"); navIcon.Width = 17; navIcon.Height = 18; navIcon.Margin = new Thickness(0, 0, 10, 0);
                DockPanel.SetDock(navIcon, Dock.Left); row.Children.Add(navIcon);
                var navTitle = new TextBlock { Text = cat.Title, FontSize = 16 };
                navTitle.SetBinding(TextBlock.ForegroundProperty, new Binding("Foreground") { RelativeSource = new RelativeSource(RelativeSourceMode.FindAncestor, typeof(ListBoxItem), 1) });
                row.Children.Add(navTitle);
                categories.Items.Add(new ListBoxItem { Content = row, Tag = cat.Key });
            }
            categories.SelectionChanged += delegate
            {
                if (loading || categories.SelectedItem == null) return;
                selected = (string)((ListBoxItem)categories.SelectedItem).Tag;
                loading = true; search.Text = ""; loading = false; Render(); Find<ScrollViewer>("OptionsScroll").ScrollToTop();
            };
            search.TextChanged += delegate { if (!loading) { Render(); Find<ScrollViewer>("OptionsScroll").ScrollToTop(); } };
            onlyActive.Checked += delegate { if (!loading) { Render(); Find<ScrollViewer>("OptionsScroll").ScrollToTop(); } };
            onlyActive.Unchecked += delegate { if (!loading) { Render(); Find<ScrollViewer>("OptionsScroll").ScrollToTop(); } };
            gamePath.TextChanged += delegate
            {
                if (loading || Config == null) return;
                Config["gameDirectory"] = gamePath.Text.Trim(); MarkDirty(); UpdateGame();
            };
            profiles.SelectionChanged += delegate
            {
                if (loading || profiles.SelectedItem == null) return;
                var next = (Profile)profiles.SelectedItem;
                if (Current != null && next.Id == Current.Id) return;
                if (!MayLeave()) { loading = true; profiles.SelectedItem = Current; loading = false; return; }
                LoadProfile(next);
            };
            Find<Button>("SaveProfile").Click += delegate { Act(SaveCurrent); };
            Find<Button>("CopyProfile").Click += delegate { Act(CopyCurrent); };
            Find<Button>("ImportConfig").Click += delegate { Act(Import); };
            Find<Button>("ExportConfig").Click += delegate { Act(Export); };
            Find<Button>("BrowseGame").Click += delegate
            {
                using (var dialog = new System.Windows.Forms.FolderBrowserDialog())
                {
                    dialog.Description = "Client oder Server: Installationsordner mit passender EXE, KFC und kfc_resources auswählen.";
                    if (Directory.Exists(gamePath.Text)) dialog.SelectedPath = gamePath.Text;
                    if (dialog.ShowDialog() == System.Windows.Forms.DialogResult.OK) gamePath.Text = dialog.SelectedPath;
                }
            };
            Find<Button>("LaunchPatcher").Click += delegate { Act(UpdatePatch); };
            Find<Button>("ServerCheck").Click += delegate { Act(ReviewServer); };
            Find<Button>("ClearSearch").Click += delegate { search.Clear(); search.Focus(); };
            Window.PreviewKeyDown += delegate(object sender, KeyEventArgs e)
            {
                if (Keyboard.Modifiers == ModifierKeys.Control && e.Key == Key.F) { search.Focus(); search.SelectAll(); e.Handled = true; }
                else if (Keyboard.Modifiers == ModifierKeys.Control && e.Key == Key.S && !patcherRunning) { Act(SaveCurrent); e.Handled = true; }
                else if (e.Key == Key.Escape && search.IsKeyboardFocusWithin && search.Text.Length > 0) { search.Clear(); e.Handled = true; }
            };
            Find<Button>("SetupRuntime").Click += delegate { Act(SetupPatcherRuntime); };
            Find<Button>("TransferSetup").Click += delegate { Act(TransferSetup); };
            Find<Button>("CheckUpdates").Click += delegate { CheckForUpdates(); };
            Find<Button>("OpenPatchLog").Click += delegate { Act(OpenPatchLog); };
            Find<Button>("ChangeBasis").Click += delegate { Act(ChangeBasis); };
            Find<Button>("HelpButton").Click += delegate
            {
                MessageBox.Show(Window,
                    "Erstinstallation: ‚Patcher einrichten‘ liest das Originalpaket. Ein alter Studioordner ist nicht erforderlich.\n\n1. Installationsordner mit passender EXE, KFC und kfc_resources wählen.\n2. Optionen einschalten und Werte einstellen.\n3. Spiel oder Server schließen.\n4. ‚Patch anwenden / aktualisieren‘ drücken.\n\n" +
                    "Der Knopf speichert das Profil, bereitet den Patch an Kopien vor, prüft die Archive und wendet das Ergebnis an. Fortschritt und Ergebnis erscheinen hier im Tool. Bei späteren Änderungen denselben Knopf erneut benutzen.\n\n" +
                    "Die erste Basis entspricht den aktuellen Dateien. Vorhandene ältere Mods sind darin enthalten. Für einen sauberen Anfang zuerst die Steam-Dateiprüfung verwenden. Nach Spielupdates eine neue Basis wählen; alte Backups bleiben erhalten.\n\n" +
                    "Spätere Profile werden aus derselben gespeicherten Basis erstellt. Alle Mods aus bereitet diese Basis vor. Gespeicherte Basis wiederherstellen nimmt die Änderungen dieses Tools zurück.\n\n" +
                    "Serverwerte prüfen liest enshrouded_server.json. Bereits gespeicherte 1000%-Werte werden nicht automatisch zurückgesetzt.\n\n" +
                    "‚Update prüfen‘ installiert neuere Tool-Versionen und übernimmt Profile, Einstellungen und Sicherungen automatisch. Das bisherige Studio bleibt als Rückfall erhalten. Beim erstmaligen Wechsel von einer älteren Version ‚Altes Setup übernehmen‘ verwenden. Für Steam-Spielupdates die Erklärung unter Werkzeuge lesen.\n\n" +
                    "Profile/Sicherungen: Data\\profiles, Data\\backups. Archivbasis und Prüfprotokolle: Data\\patches. Engine: 1.2.3 mit Mod-Studio-Ergänzungen. Die Spielwirkung einzelner Optionen bleibt live zu prüfen.",
                    "Hinweise zu Enshrouded Mod Studio", MessageBoxButton.OK, MessageBoxImage.Information);
            };
            Window.Closing += delegate(object sender, System.ComponentModel.CancelEventArgs e)
            {
                if (installingUpdate) { e.Cancel = true; return; }
                if (patcherRunning && directUpdate) { e.Cancel = true; if (!testMode) MessageBox.Show(Window, "Der Patch wird noch verarbeitet. Bitte auf das Ergebnis warten. Du kannst das Fenster minimieren.", "Aktualisierung läuft"); return; }
                if (!testMode && !MayLeave()) e.Cancel = true;
            };
            loading = true;
            profiles.ItemsSource = Store.Profiles;
            profiles.SelectedItem = Store.Profiles.FirstOrDefault(p => p.Id == Store.LastId) ?? Store.Profiles.First();
            categories.SelectedIndex = 1;
            loading = false;
            LoadProfile((Profile)profiles.SelectedItem);
            if (!testMode && runtimeMissingCount > 0) notice.Text = "Erstinstallation: ‚Patcher einrichten‘ ergänzt die Programmdateien aus dem Originalpaket. Ein alter Studioordner ist nicht erforderlich.";
            if (Store.LoadErrors.Count > 0) notice.Text = "Einige Profildateien konnten nicht geladen werden: " + string.Join(" · ", Store.LoadErrors);
            timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
            timer.Tick += delegate
            {
                if (!patcherRunning) return;
                try
                {
                    if (directUpdate) ReadPatchProgress();
                    if (engineProcess.HasExited)
                    {
                        if (directUpdate) { FinishUpdate(); return; }
                        int code = engineProcess.ExitCode; patcherRunning = false; SetLocked(false);
                        status.Text = "Patcher beendet (Exitcode " + code + ").";
                        notice.Text = "Details stehen im Patcher-Fenster und unter Data\\patches. Der Exitcode allein bestätigt keinen erfolgreichen Patch.";
                        engineProcess.Dispose(); engineProcess = null;
                    }
                }
                catch (Exception ex) { notice.Text = "Patcher-Status konnte nicht gelesen werden: " + ex.Message; }
            };
            if (!testing) timer.Start();
            Window.Closed += delegate { windowClosed = true; timer.Stop(); if (engineProcess != null) engineProcess.Dispose(); };
        }
        public void Act(Action action)
        {
            try { action(); }
            catch (Exception ex)
            {
                status.Text = "Nicht ausgeführt"; notice.Text = ex.Message;
                if (!testMode) MessageBox.Show(Window, ex.Message, "Bitte prüfen", MessageBoxButton.OK, MessageBoxImage.Warning);
                else throw;
            }
        }
        private async void CheckForUpdates()
        {
            if (patcherRunning || checkingUpdates) return;
            if (testMode) { notice.Text = "Die Online-Updateprüfung ist im Testmodus deaktiviert."; return; }
            checkingUpdates = true; UpdateCheckButtonState();
            status.Text = "Updateprüfung läuft …";
            try
            {
                var result = await UpdateCheck.CheckAsync(Store.AppRoot);
                if (windowClosed) return;
                if (patcherRunning) return;
                if (result.NoRelease)
                {
                    status.Text = "Noch keine öffentliche Version gefunden";
                    MessageBox.Show(Window, "Für dieses Mod Studio ist auf GitHub noch keine öffentliche stabile Version verfügbar. Bitte später erneut prüfen.", "Update prüfen", MessageBoxButton.OK, MessageBoxImage.Information);
                }
                else if (!result.IsNewer)
                {
                    status.Text = "Mod Studio ist aktuell";
                    MessageBox.Show(Window, "Installiert: " + UpdateCheck.DisplayVersion(result.InstalledVersion) + "\nNeueste stabile Version: " + UpdateCheck.DisplayVersion(result.LatestVersion) + "\n\nDu verwendest bereits diese oder eine neuere Version.", "Mod Studio ist aktuell", MessageBoxButton.OK, MessageBoxImage.Information);
                }
                else
                {
                    status.Text = "Update verfügbar: " + UpdateCheck.DisplayVersion(result.LatestVersion);
                    if (UpdateCheck.ShowDownloadDialog(Window, result))
                    {
                        SaveCurrent();
                        if (Store.LoadErrors.Count > 0) throw new InvalidDataException("Einige Profile konnten nicht geladen werden. Bitte diese vor dem automatischen Update korrigieren: " + string.Join(" · ", Store.LoadErrors));
                        installingUpdate = true; SetLocked(true);
                        var bar = Find<ProgressBar>("PatchProgress"); bar.Visibility = Visibility.Visible; bar.IsIndeterminate = false; bar.Value = 0;
                        var reporter = new Progress<UpdateInstallProgress>(delegate(UpdateInstallProgress value) {
                            if (windowClosed) return; status.Text = value.Message; bar.Value = value.Percent;
                            notice.Text = "Neue Tool-Version wird installiert. Profile, Einstellungen und Archivbasen werden automatisch übernommen. Das bisherige Studio bleibt als Sicherung erhalten.";
                        });
                        var installed = await UpdateInstaller.InstallAsync(result, Store.AppRoot, Store.DataRoot, reporter);
                        status.Text = "Neue Version starten und Profile prüfen …";
                        await ToolHandoff.StartAndConfirmAsync(installed, Store);
                        installingUpdate = false; Dirty = false; Window.Close();
                    }
                }
            }
            catch (Exception ex)
            {
                if (!windowClosed && !patcherRunning)
                {
                    status.Text = installingUpdate ? "Tool-Update nicht abgeschlossen" : "Updateprüfung nicht möglich";
                    MessageBox.Show(Window, ex.Message, "Update prüfen", MessageBoxButton.OK, MessageBoxImage.Warning);
                }
            }
            finally { bool wasInstalling = installingUpdate; installingUpdate = false; checkingUpdates = false; if (!windowClosed) { if (wasInstalling) SetLocked(false); UpdateCheckButtonState(); } }
        }
        private void UpdateCheckButtonState()
        {
            var button = Find<Button>("CheckUpdates");
            if (button == null) return;
            button.IsEnabled = !patcherRunning && !checkingUpdates;
            button.Content = installingUpdate ? "Update wird installiert …" : checkingUpdates ? "Update wird geprüft …" : "Update prüfen · " + UpdateCheck.InstalledVersion;
        }
        public bool MayLeave()
        {
            if (!Dirty) return true;
            if (testMode) return false;
            var result = MessageBox.Show(Window, "Änderungen am Profil ‚" + Current.Name + "‘ speichern?", "Ungespeicherte Änderungen", MessageBoxButton.YesNoCancel, MessageBoxImage.Question);
            if (result == MessageBoxResult.Cancel) return false;
            if (result == MessageBoxResult.No) return true;
            try { SaveCurrent(); return true; }
            catch (Exception ex) { notice.Text = ex.Message; MessageBox.Show(Window, ex.Message, "Speichern nicht möglich"); return false; }
        }
        public static void FitToWorkArea(Window window, Rect area)
        {
            // WorkArea is in WPF DIPs; a fixed minimum must not exceed it at high DPI.
            double width = Math.Max(1, area.Width - 16), height = Math.Max(1, area.Height - 16);
            window.MinWidth = Math.Min(window.MinWidth, width); window.MinHeight = Math.Min(window.MinHeight, height);
            window.Width = Math.Min(window.Width, width); window.Height = Math.Min(window.Height, height);
            if (!double.IsNaN(window.Left)) window.Left = Math.Max(area.Left + 8, Math.Min(window.Left, area.Right - window.Width - 8));
            if (!double.IsNaN(window.Top)) window.Top = Math.Max(area.Top + 8, Math.Min(window.Top, area.Bottom - window.Height - 8));
        }
        public void FitWindowToWorkArea(Rect area) { FitToWorkArea(Window, area); }
        public bool LoadProfile(Profile profile)
        {
            // Persist the selection before replacing drafts or the working profile.
            try { Store.Select(profile.Id); ProfileLoadError = null; }
            catch (Exception ex)
            {
                ProfileLoadError = "Profil konnte nicht gewechselt werden: " + ex.Message;
                loading = true; profiles.SelectedItem = Current; loading = false;
                notice.Text = ProfileLoadError;
                if (!testMode) MessageBox.Show(Window, ProfileLoadError, "Profilwechsel nicht möglich", MessageBoxButton.OK, MessageBoxImage.Warning);
                return false;
            }
            loading = true; Current = profile; Config = Json.Clone(profile.Config); Dirty = false;
            Find<Button>("ChangeBasis").Visibility = Visibility.Collapsed;
            profiles.SelectedItem = profile;
            Drafts.Clear(); InputErrors.Clear(); gamePath.Text = (string)Config["gameDirectory"];
            loading = false;
            UpdateGame(); Render(); status.Text = "Profil geladen: " + profile.Name;
            Find<TextBlock>("ProfileState").Text = "Gespeichert"; Find<TextBlock>("ProfileState").Foreground = Brush("#AAC6D7");
            Find<TextBlock>("SidebarProfile").Text = profile.Name;
            Window.Title = "Enshrouded · Mod Studio — " + profile.Name;
            notice.Text = "Profil geladen. Schalter und Werte werden mit ‚Speichern‘ gesichert.";
            return true;
        }
        public void MarkDirty()
        {
            Dirty = true; status.Text = "Ungespeicherte Änderungen";
            Find<TextBlock>("ProfileState").Text = "Nicht gespeichert"; Find<TextBlock>("ProfileState").Foreground = Brush("#EFC186");
            Window.Title = "Enshrouded · Mod Studio — " + Current.Name + " *";
            UpdateCount();
        }
        public void UpdateCount()
        { Find<TextBlock>("ActiveCount").Text = Store.Active(Config) + " von " + Store.Schema.Sum(c => c.Mods.Count) + " eingeschaltet"; }
        public void UpdateGame()
        {
            string result = StudioStore.CheckGame((string)Config["gameDirectory"]);
            gameStatus.ToolTip = result;
            gameStatus.Text = result.EndsWith("erkannt") ? (result.StartsWith("Dedicated") ? "Server erkannt" : "Client erkannt") : (string.IsNullOrWhiteSpace((string)Config["gameDirectory"]) ? "Ordner fehlt" : "Ordner unvollständig");
            gameStatus.Foreground = Brush(result.EndsWith("erkannt") ? "#A5E3CB" : "#F0D0A0");
            Find<TextBlock>("InstallationHelp").Text = result.EndsWith("erkannt") ?
                (result.StartsWith("Dedicated") ? "Ziel: Dedicated Server. Der Spielclient auf deinem PC wird separat gepatcht." : "Ziel: Spielclient. Für deinen Dedicated Server dessen eigenen Installationsordner wählen.") :
                "Client oder Server: Passende EXE, KFC und kfc_resources müssen im gewählten Ordner liegen.";
            if (result.EndsWith("erkannt")) Find<TextBlock>("InstallationHelp").Text += PatchBasis.Exists(Store.DataRoot, (string)Config["gameDirectory"]) ? " Patch-Basis vorhanden." : " Noch keine Originalbasis: eine passende mitgelieferte Referenz wird geprüft. Sonst sind unveränderte Spieldateien erforderlich.";
            if (!testMode && runtimeMissingCount > 0) Find<TextBlock>("InstallationHelp").Text += " Patcher fehlt: ‚Patcher einrichten‘ verwenden. Kein altes Studio erforderlich.";
            Find<TextBlock>("GamePathHint").Visibility = string.IsNullOrWhiteSpace(gamePath.Text) ? Visibility.Visible : Visibility.Collapsed;
            string roleError = Store.RestrictedTargetError(Config);
            Find<Button>("LaunchPatcher").IsEnabled = !patcherRunning && !installingUpdate && roleError == null && result.EndsWith("erkannt") && (testMode || runtimeMissingCount == 0);
            Find<Button>("LaunchPatcher").ToolTip = patcherRunning ? "Aktualisierung läuft. Bitte auf das Ergebnis warten." : roleError ?? (!testMode && runtimeMissingCount > 0 ? "Patcher fehlt. Zuerst ‚Patcher einrichten‘ verwenden; kein altes Studio erforderlich." : result.EndsWith("erkannt") ? "Profil speichern und in der angezeigten Zielinstallation anwenden." : "Zuerst den vollständigen Client- oder Serverordner wählen.");
            foreach (var refresh in targetRoleUpdates.Values) refresh();
            if (refreshClientPackageStatus != null) refreshClientPackageStatus();
            UpdateSkillTargetHint();
        }
        public void EnsureValid()
        {
            var errors = InputErrors.Where(pair =>
            {
                string[] key = pair.Key.Split('.');
                return key.Length < 3 || (bool)Json.Object(Json.Object(Config[key[0]], key[0])[key[1]], key[1])["enabled"];
            }).Select(pair => pair.Value).Concat(Store.Validate(Config)).ToList();
            if (errors.Count > 0) throw new InvalidDataException(string.Join(Environment.NewLine, errors.Take(8)));
        }
        public void SaveCurrent()
        {
            EnsureValid();
            var saved = new Profile { Id = Current.Id, Name = Current.Name, Config = Json.Clone(Config) };
            Store.Save(saved); Current.Config = saved.Config; Dirty = false;
            Find<TextBlock>("ProfileState").Text = "Gespeichert"; Find<TextBlock>("ProfileState").Foreground = Brush("#AAC6D7");
            status.Text = "Profil gespeichert · " + DateTime.Now.ToString("HH:mm");
            notice.Text = "Profil gespeichert. Mit ‚Patch anwenden / aktualisieren‘ übernimmst du es in den gewählten Spielordner.";
            Window.Title = "Enshrouded · Mod Studio — " + Current.Name;
        }
        private string AskName(string suggested, string title)
        {
            var dialog = new Window { Title = title, Owner = Window, Width = 520, Height = 250, ResizeMode = ResizeMode.NoResize,
                WindowStartupLocation = WindowStartupLocation.CenterOwner, Background = Brush("#121E2C"), Foreground = Brushes.White, FontFamily = Window.FontFamily };
            TextOptions.SetTextFormattingMode(dialog, TextFormattingMode.Display); TextOptions.SetTextRenderingMode(dialog, TextRenderingMode.ClearType);
            dialog.Resources = Window.Resources;
            var panel = new StackPanel { Margin = new Thickness(22) };
            panel.Children.Add(new TextBlock { Text = "Profilname", Margin = new Thickness(0, 0, 0, 8) });
            var input = new TextBox { Text = suggested, MaxLength = 80 }; panel.Children.Add(input);
            var row = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 14, 0, 0) };
            var cancel = new Button { Content = "Abbrechen", IsCancel = true, Margin = new Thickness(0, 0, 8, 0) };
            var ok = new Button { Content = "Erstellen", IsDefault = true };
            ok.Click += delegate { dialog.DialogResult = true; }; row.Children.Add(cancel); row.Children.Add(ok); panel.Children.Add(row); dialog.Content = panel;
            dialog.Loaded += delegate { input.Focus(); input.SelectAll(); };
            return dialog.ShowDialog() == true ? input.Text : null;
        }
        private void RefreshProfiles(Profile select)
        {
            loading = true; profiles.ItemsSource = null; profiles.ItemsSource = Store.Profiles; profiles.SelectedItem = select; loading = false;
            LoadProfile(select);
        }
        private void CopyCurrent()
        {
            EnsureValid();
            string name = AskName(Current.Name + " – Kopie", "Neues Profil aus aktueller Auswahl");
            if (name == null) return;
            var next = Store.NewProfile(name, Config); RefreshProfiles(next);
            notice.Text = "Neues Profil erstellt. Die bisherige Profilversion bleibt erhalten.";
        }
        private void Import()
        {
            if (!MayLeave()) return;
            var dialog = new OpenFileDialog { Filter = "JSON-Konfiguration (*.json)|*.json", Title = "Vorhandene Konfiguration importieren" };
            if (dialog.ShowDialog(Window) != true) return;
            var doc = Json.Read(dialog.FileName);
            if (doc.ContainsKey("config")) doc = Json.Object(doc["config"], "Profil-Konfiguration");
            var config = Store.Normalize(doc);
            string name = AskName(Path.GetFileNameWithoutExtension(dialog.FileName), "Import als neues Profil");
            if (name == null) return;
            var next = Store.NewProfile(name, config); RefreshProfiles(next);
            notice.Text = "Importiert. Zusätzliche, unbekannte JSON-Einstellungen bleiben erhalten.";
        }
        private void Export()
        {
            EnsureValid();
            var dialog = new SaveFileDialog { Filter = "JSON-Konfiguration (*.json)|*.json", FileName = "config.json", Title = "Patcher-kompatible Konfiguration exportieren", OverwritePrompt = true };
            if (dialog.ShowDialog(Window) != true) return;
            string target = Path.GetFullPath(dialog.FileName);
            string engine = Path.GetFullPath(Path.Combine(Store.AppRoot, "engine", "config.json"));
            if (string.Equals(target, engine, StringComparison.OrdinalIgnoreCase))
            {
                if (patcherRunning || Process.GetProcessesByName("enshrouded-patcher").Length > 0) throw new InvalidOperationException("Die laufende Patcher-Konfiguration kann nicht überschrieben werden.");
                Store.ExportEngine(Config);
            }
            else Json.Write(target, Config, Store.BackupRoot);
            status.Text = "Konfiguration exportiert"; notice.Text = target;
        }
        private void Launch()
        {
            if (patcherRunning) return;
            SaveCurrent();
            engineProcess = Store.Launch(Config); patcherRunning = true; SetLocked(true);
            status.Text = "Mod-Studio-Patcher geöffnet";
            notice.Text = "Im Patcher zuerst die Vorschau erstellen, dann die geprüften Archive anwenden. Die Profile bleiben bis zum Beenden des Patchers gesperrt.";
        }
        private void SetupPatcherRuntime()
        {
            if (patcherRunning || installingUpdate) return;
            bool installed = RuntimeSetupUi.Open(Window, Store.AppRoot);
            runtimeMissingCount = testMode ? 0 : RuntimeImport.CountExpectedMissing(Store.AppRoot);
            UpdateGame();
            if (installed) { status.Text = "Patcher eingerichtet"; notice.Text = "Programmdateien sind bereit. Spielordner und Optionen wählen, dann ‚Patch anwenden / aktualisieren‘ drücken. Profile und Spieldateien wurden bei der Einrichtung nicht verändert."; }
        }
        private void TransferSetup()
        {
            if (!MayLeave()) return;
            using (var dialog = new System.Windows.Forms.FolderBrowserDialog())
            {
                dialog.Description = "Den bisherigen vollständigen Mod-Studio-Ordner auswählen. Fehlende geprüfte Runtime sowie vorhandene Profile und Archivbasen werden übernommen.";
                if (dialog.ShowDialog() != System.Windows.Forms.DialogResult.OK) return;
                SetupTransferReport imported;
                try { imported = SetupTransfer.Import(dialog.SelectedPath, Store); }
                finally { runtimeMissingCount = testMode ? 0 : RuntimeImport.CountExpectedMissing(Store.AppRoot); UpdateGame(); }
                var select = imported.Profiles.FirstOrDefault(p => p.Id == imported.SelectedProfileId) ?? imported.Profiles.LastOrDefault() ?? Current;
                RefreshProfiles(select);
                UpdateGame();
                status.Text = "Vorhandenes Setup übernommen";
                notice.Text = imported.ToString();
                if (!testMode) MessageBox.Show(Window, imported.ToString(), "Setup und Runtime übernommen", MessageBoxButton.OK, MessageBoxImage.Information);
            }
        }
        private void CreateSkillClientProfile()
        {
            SaveCurrent();
            var dialog = new OpenFileDialog { Title = "Enshrouded-Spielclient auswählen – nicht den Dedicated Server", Filter = "Enshrouded-Spielclient (enshrouded.exe)|enshrouded.exe", FileName = "enshrouded.exe", CheckFileExists = true };
            var client = Store.Profiles.FirstOrDefault(p => StudioStore.CheckGame((string)p.Config["gameDirectory"]) == "Steam-Client erkannt");
            if (client != null) dialog.InitialDirectory = (string)client.Config["gameDirectory"];
            if (dialog.ShowDialog(Window) != true) return;
            var copy = ClientProfiles.Create(Store, Config, Current.Name, Path.GetDirectoryName(dialog.FileName));
            RefreshProfiles(copy);
            status.Text = "Client-Profil angelegt – noch nicht angewendet";
            notice.Text = "Die aktuellen Einstellungen wurden für den gewählten Spielclient kopiert; Fertigkeitspunkte sind dort eingeschaltet. Auswahl prüfen und ‚Patch anwenden / aktualisieren‘ drücken. Im Mehrspieler denselben Punktewert auf Server und Clients verwenden.";
        }
        private void UpdateSkillTargetHint()
        {
            if (skillTargetHint == null || Config == null) return;
            string target = StudioStore.CheckGame((string)Config["gameDirectory"]);
            if (skillClientActions != null) skillClientActions.Visibility = target == "Steam-Client erkannt" ? Visibility.Visible : Visibility.Collapsed;
            skillTargetHint.Text = target == "Dedicated Server erkannt" ?
                "Du bearbeitest den Dedicated Server. Diese Option überträgt den Punktewert NICHT automatisch an alle Spieler. Eine ausschließlich serverseitige Vergabe zusätzlicher Levelpunkte ist mit diesem Archivpatcher nicht unterstützt. Ein bestätigter Server-Archivwert ist kein Nachweis für die Punktevergabe im Spielclient." :
                target == "Steam-Client erkannt" ? "Du bearbeitest den Spielclient. Hier muss der gewünschte Punktewert ebenfalls angewendet und danach im Spiel geprüft werden. Im Mehrspieler denselben Wert auch auf dem Server und den anderen Clients einstellen. Nach dem Anwenden das Spiel neu starten und einen Levelaufstieg prüfen." :
                "Nur den Dedicated Server zu patchen ändert keine Clientdateien. Für diese Option auch die lokale Clientinstallation mit demselben Punktewert bearbeiten. Wähle dafür die enshrouded.exe des Spielclients.";
        }
        private void ApplyClientSkillPoints()
        {
            if (patcherRunning || installingUpdate) return;
            SaveCurrent();
            if (StudioStore.CheckGame((string)Config["gameDirectory"]) == "Steam-Client erkannt")
            {
                Json.Object(Json.Object(Config["player"], "Spieler")["adjustSkillPointsPerLevel"], "Fertigkeitspunkte")["enabled"] = true;
                MarkDirty(); Render(); UpdatePatch(); return;
            }
            var dialog = new OpenFileDialog { Title = "Fertigkeitspunkte direkt im Spielclient anwenden – enshrouded.exe wählen", Filter = "Enshrouded-Spielclient|enshrouded.exe", FileName = "enshrouded.exe", CheckFileExists = true };
            var clients = Store.Profiles.Where(p => StudioStore.CheckGame((string)p.Config["gameDirectory"]) == "Steam-Client erkannt").ToList();
            if (clients.Count > 0) dialog.InitialDirectory = (string)clients[0].Config["gameDirectory"];
            if (dialog.ShowDialog(Window) != true) return;
            var copy = ClientProfiles.CreatePointsOnly(Store, Config, Path.GetDirectoryName(dialog.FileName));
            RefreshProfiles(copy);
            UpdatePatch();
        }
        private void ReviewSkillPoints()
        {
            if (patcherRunning || installingUpdate) return;
            EnsureValid(); SkillReview.Open(Store, Config, Window);
        }
        private void UpdatePatch()
        {
            if (patcherRunning) return;
            if (!testMode && (runtimeMissingCount = RuntimeImport.CountExpectedMissing(Store.AppRoot)) > 0) { UpdateGame(); throw new InvalidOperationException("Der Patcher ist noch nicht eingerichtet. ‚Patcher einrichten‘ ergänzt ihn aus dem Originalpaket; du brauchst kein altes Studio. Es wurden keine Spieldateien geändert."); }
            SaveCurrent();
            if (!StudioStore.CheckGame((string)Config["gameDirectory"]).EndsWith("erkannt")) throw new InvalidDataException(StudioStore.CheckGame((string)Config["gameDirectory"]));
            if (!testMode && !PatchBasis.Exists(Store.DataRoot, (string)Config["gameDirectory"]))
            {
                string review = "Für diesen Ordner gibt es hier noch keine gespeicherte Ausgangsbasis:\n" + Config["gameDirectory"] + "\n\nEine mitgelieferte Originalbasis wird nur bei exakt passender Spiel-EXE geprüft und übernommen. Ohne passende Referenz müssen die aktuellen Spieldateien unverändert sein. Bereits enthaltene Mod-Studio-Beschwörungen werden vor dem Patchen erkannt.\n\nFehlt die Originalbasis bei bereits gepatchten Dateien, vorher über Steam unveränderte Spieldateien herstellen. Ein alter Studioordner ist dafür nicht erforderlich.\n\nSoll die passende Originalbasis geprüft und das eingestellte Profil jetzt vorbereitet werden?";
                if (MessageBox.Show(Window, review, "Ausgangsbasis für den ersten Patch", MessageBoxButton.YesNo, MessageBoxImage.Information) != MessageBoxResult.Yes) { notice.Text = "Noch nicht angewendet. Zuerst das alte Setup übernehmen oder saubere Spieldateien bereitstellen."; return; }
            }
            string id = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0, 8);
            string dir = Path.Combine(Store.DataRoot, "updates"); Directory.CreateDirectory(dir);
            patchStatusFile = Path.Combine(dir, id + ".json"); patchLogFile = Path.Combine(dir, id + ".log");
            lock (logLock) patchLog = new StreamWriter(patchLogFile, false, new UTF8Encoding(false)) { AutoFlush = true };
            try
            {
                engineProcess = Store.LaunchUpdate(Config, patchStatusFile);
                engineProcess.OutputDataReceived += delegate(object sender, DataReceivedEventArgs args) { WritePatchLog(args.Data); };
                engineProcess.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs args) { WritePatchLog(args.Data); };
                engineProcess.BeginOutputReadLine(); engineProcess.BeginErrorReadLine();
            }
            catch { lock (logLock) { patchLog.Dispose(); patchLog = null; } throw; }
            directUpdate = true; patcherRunning = true; SetLocked(true);
            Find<Button>("ChangeBasis").Visibility = Visibility.Collapsed;
            Find<Button>("OpenPatchLog").Visibility = Visibility.Visible;
            var bar = Find<ProgressBar>("PatchProgress"); bar.Visibility = Visibility.Visible; bar.Value = 0; bar.IsIndeterminate = true; bar.Foreground = Brush("#63D5CF");
            status.Text = "Patch wird vorbereitet …";
            notice.Text = "Das Profil wird aus der gespeicherten Basis neu aufgebaut, geprüft und angewendet. Vorhandene Multiplikatoren werden dabei nicht gestapelt.";
        }
        private void WritePatchLog(string line)
        { if (line == null) return; lock (logLock) { if (patchLog != null) patchLog.WriteLine(line); } }
        private void ReadPatchProgress()
        {
            try
            {
                if (!File.Exists(patchStatusFile)) return;
                var progress = PatchProgress.Read(patchStatusFile);
                var bar = Find<ProgressBar>("PatchProgress"); bar.IsIndeterminate = false; bar.Value = progress.Progress;
                status.Text = progress.Message; notice.ToolTip = progress.Message;
            }
            catch (IOException) { }
            catch (Exception) { /* An incomplete or invalid report never counts as success. */ }
        }
        private void FinishUpdate()
        {
            engineProcess.WaitForExit(); int code = engineProcess.ExitCode;
            PatchProgress progress = null; try { progress = PatchProgress.Read(patchStatusFile); } catch { }
            lock (logLock) { if (patchLog != null) { patchLog.Dispose(); patchLog = null; } }
            bool success = PatchProgress.UpdateSucceeded(code, progress);
            patcherRunning = false; directUpdate = false; SetLocked(false);
            var bar = Find<ProgressBar>("PatchProgress"); bar.IsIndeterminate = false; bar.Value = success ? 100 : (progress == null ? 0 : progress.Progress); bar.Foreground = Brush(success ? "#63D5CF" : "#F7A18F");
            status.Text = success ? (progress.Warnings.Count > 0 ? "Patch aktualisiert · Hinweise beachten" : "Patch angewendet / aktualisiert") : "Aktualisierung nicht abgeschlossen";
            notice.Text = success ? progress.Message + (progress.Warnings.Count > 0 ? " Hinweise: " + string.Join(" · ", progress.Warnings) : " Weitere Profiländerungen übernimmst du mit demselben Knopf.") : (progress == null ? "Der Patcher hat keinen bestätigten Abschluss gemeldet (Exitcode " + code + ")." : progress.Message) + " Protokoll: " + patchLogFile;
            if (!success && progress != null && progress.ActionCode == "basis_required")
            {
                Find<Button>("ChangeBasis").Visibility = Visibility.Visible;
                status.Text = "Neue Patch-Basis erforderlich";
                notice.Text = "Die Installation passt nicht mehr zur gespeicherten Basis. Spiel schließen, Dateien über Steam prüfen lassen und unten ‚Spielupdate / Basis wechseln‘ öffnen. Alte Sicherungen werden dabei nicht ins Spiel kopiert.";
            }
            notice.ToolTip = notice.Text; engineProcess.Dispose(); engineProcess = null;
        }
        private void ChangeBasis()
        {
            if (patcherRunning) return;
            SaveCurrent();
            string check = StudioStore.CheckGame((string)Config["gameDirectory"]);
            if (!check.EndsWith("erkannt")) throw new InvalidDataException(check);
            if (!BasisReviewWindow.Open(Store, Config, Window)) return;
            Find<Button>("ChangeBasis").Visibility = Visibility.Collapsed;
            UpdateGame(); status.Text = "Neue Ausgangsbasis freigegeben";
            notice.Text = "Die alte Basis-Zuordnung wurde zurückgelegt; alle Sicherungen und Profile bleiben erhalten. Jetzt ‚Patch anwenden / aktualisieren‘ drücken, um die neue Basis zu sichern und das Profil anzuwenden.";
        }
        private void ReviewStacks()
        {
            if (patcherRunning) return;
            EnsureValid();
            string check = StudioStore.CheckGame((string)Config["gameDirectory"]);
            if (!check.EndsWith("erkannt")) throw new InvalidDataException(check);
            StackReviewWindow.Open(Store, Config, Window);
        }
        private void DiagnoseInstallation()
        {
            if (patcherRunning) return;
            EnsureValid();
            string check = StudioStore.CheckGame((string)Config["gameDirectory"]);
            if (!check.EndsWith("erkannt")) throw new InvalidDataException(check);
            Store.ExportEngine(Config);
            string script = Path.Combine(Store.AppRoot, "tools", "Diagnose.ps1");
            if (!File.Exists(script)) throw new FileNotFoundException("Die Diagnose fehlt. Bitte das vollständige Paket entpacken.", script);
            Process.Start(new ProcessStartInfo {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"),
                Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script + "\" -OpenReport",
                WorkingDirectory = Store.AppRoot, UseShellExecute = false, CreateNoWindow = true
            });
            notice.Text = "Die lesende Diagnose läuft. Ihr Bericht öffnet sich als Textdatei; Spielarchive werden dabei nicht geändert.";
        }
        private void OpenPatchLog()
        {
            string target = !string.IsNullOrEmpty(patchLogFile) && File.Exists(patchLogFile) ? patchLogFile : Path.Combine(Store.DataRoot, "updates");
            if (!File.Exists(target)) Directory.CreateDirectory(target);
            Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
        }
        private void SetLocked(bool locked)
        {
            foreach (string control in new[] { "Profiles", "CopyProfile", "SaveProfile", "BrowseGame", "ImportConfig", "ExportConfig", "GamePath", "OptionsScroll", "SetupRuntime", "TransferSetup", "ChangeBasis", "ServerCheck" })
                Find<UIElement>(control).IsEnabled = !locked;
            Find<Button>("CheckUpdates").IsEnabled = !locked && !checkingUpdates;
            UpdateGame();
        }
        public void ChooseCategory(string key)
        {
            selected = key; loading = true;
            foreach (ListBoxItem item in categories.Items) if ((string)item.Tag == key) categories.SelectedItem = item;
            search.Text = ""; loading = false; Render(); Find<ScrollViewer>("OptionsScroll").ScrollToTop();
        }
        public void Render()
        {
            if (Config == null) return;
            options.Children.Clear(); Toggles.Clear(); Fields.Clear(); ChoiceFields.Clear(); Details.Clear(); targetRoleUpdates.Clear(); skillTargetHint = null; skillClientActions = null; refreshClientPackageStatus = null; UpdateCount();
            string query = search.Text.Trim();
            var category = Store.Schema.First(c => c.Key == selected);
            Find<TextBlock>("CategoryTitle").Text = query.Length == 0 ? category.Title : "Suchergebnisse";
            Find<TextBlock>("CategoryDescription").Text = query.Length == 0 ? category.Description : "Suche in allen Mod-Kategorien nach „" + query + "“.";
            var hint = Find<TextBlock>("SearchHint"); if (hint != null) hint.Visibility = query.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
            Find<Button>("ClearSearch").Visibility = query.Length == 0 ? Visibility.Collapsed : Visibility.Visible;
            Find<CheckBox>("OnlyActive").IsEnabled = selected != "settings" || query.Length > 0;
            if (selected == "settings" && query.Length == 0) { Find<TextBlock>("ResultsCount").Text = "Diagnose und Verwaltung"; RenderSettings(); return; }
            optionsGrid = new Grid();
            optionsGrid.ColumnDefinitions.Add(new ColumnDefinition()); optionsGrid.ColumnDefinitions.Add(new ColumnDefinition());
            options.Children.Add(optionsGrid); cardRow = 0;
            int found = 0;
            foreach (var cat in Store.Schema)
            {
                if (query.Length == 0 && cat.Key != selected) continue;
                foreach (var mod in cat.Mods)
                {
                    if (query.Length > 0 && (mod.Title + " " + mod.Description + " " + mod.Key + " " + mod.Effect + " " + mod.Example + " " + mod.WhenToUse + " " + mod.Scope + " " + string.Join(" ", mod.Fields.Select(f => f.Label + " " + f.Help))).IndexOf(query, StringComparison.OrdinalIgnoreCase) < 0) continue;
                    var data = Json.Object(Json.Object(Config[cat.Key], cat.Key)[mod.Key], mod.Title);
                    if (onlyActive.IsChecked == true && !(bool)data["enabled"]) continue;
                    AddCard(cat, mod, data); found++;
                }
            }
            Find<TextBlock>("ResultsCount").Text = found + (found == 1 ? " Option" : " Optionen") + (onlyActive.IsChecked == true ? " · Filter: eingeschaltet" : " · Schalter wählen, Werte anpassen, unten anwenden");
            if (found == 0)
            {
                var empty = new StackPanel { Margin = new Thickness(22, 24, 22, 24) };
                empty.Children.Add(Readable("Keine passenden Einstellungen", 20, "#EDF3FA"));
                empty.Children.Add(Readable("Suche oder Filter schränken die Auswahl ein. Setze beides zurück, um alle Optionen dieser Kategorie zu sehen.", 14, "#BCD0E1"));
                var reset = new Button { Content = "Suche und Filter zurücksetzen", HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 14, 0, 0) };
                reset.Click += delegate { loading = true; search.Clear(); onlyActive.IsChecked = false; loading = false; Render(); Find<ScrollViewer>("OptionsScroll").ScrollToTop(); };
                empty.Children.Add(reset); options.Children.Add(empty);
            }
        }
        private static System.Windows.Shapes.Path Icon(string category, string color)
        {
            string geometry;
            switch (category)
            {
                case "player": geometry = "M 12,2 A 4,4 0 1 1 12,10 A 4,4 0 1 1 12,2 M 4,22 L 4,19 C 4,11 20,11 20,19 L 20,22"; break;
                case "inventory": geometry = "M 2,7 L 12,2 L 22,7 L 22,19 L 12,24 L 2,19 Z M 2,7 L 12,12 L 22,7 M 12,12 L 12,24 M 7,4 L 17,9"; break;
                case "world": geometry = "M 3,11 L 12,3 L 21,11 M 5,9 L 5,22 L 19,22 L 19,9 M 10,22 L 10,15 L 15,15 L 15,22"; break;
                case "gameplay": geometry = "M 3,2 L 9,4 L 20,15 L 15,20 L 4,9 Z M 12,22 L 22,12 M 17,18 L 22,23 M 3,22 L 8,17 M 3,15 L 9,21 M 14,8 L 19,3 L 23,2 L 22,6 L 17,11"; break;
                default: geometry = "M 9,2 L 15,2 L 16,6 L 20,7 L 23,12 L 20,17 L 16,18 L 15,22 L 9,22 L 8,18 L 4,17 L 1,12 L 4,7 L 8,6 Z M 16,12 A 4,4 0 1 1 8,12 A 4,4 0 1 1 16,12"; break;
            }
            return new System.Windows.Shapes.Path { Data = Geometry.Parse(geometry), Stroke = Brush(color), StrokeThickness = 1.4, Width = 21, Height = 22, Stretch = Stretch.Uniform, SnapsToDevicePixels = false, VerticalAlignment = VerticalAlignment.Center };
        }
        private TextBlock Readable(string text, int size, string color)
        { return new TextBlock { Text = text, FontSize = size, Foreground = Brush(color), TextWrapping = TextWrapping.Wrap, LineHeight = size + 7 }; }
        private void AddDetail(StackPanel target, string heading, string text)
        {
            target.Children.Add(new TextBlock { Text = heading, FontSize = 14, FontWeight = FontWeights.SemiBold, Foreground = Brush("#A9E5DD"), Margin = new Thickness(0, 14, 0, 5) });
            target.Children.Add(Readable(text, 15, "#D3DFEB"));
        }
        private void AddCard(CategoryDef cat, ModDef mod, Dictionary<string, object> data)
        {
            string prefix = cat.Key + "." + mod.Key;
            var body = new StackPanel();
            var top = new Grid(); top.ColumnDefinitions.Add(new ColumnDefinition()); top.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var titleArea = new StackPanel { Margin = new Thickness(0, 0, 18, 0) };
            titleArea.Children.Add(new TextBlock { Text = mod.Title, FontSize = 18, FontWeight = FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap });
            if (!string.IsNullOrEmpty(mod.Status)) titleArea.Children.Add(new TextBlock { Text = mod.Status, FontSize = 13, Foreground = Brush("#EDC48F"), Margin = new Thickness(0, 6, 0, 0), TextWrapping = TextWrapping.Wrap });
            top.Children.Add(titleArea);
            bool brokenServerLimits = mod.Key == "enableUncapDedicatedServerSettings" && !Store.IsVerifiedEngine123();
            var toggle = new CheckBox { Style = (Style)Window.Resources["Toggle"], IsChecked = (bool)data["enabled"], IsEnabled = !brokenServerLimits || (bool)data["enabled"] };
            if (brokenServerLimits) toggle.ToolTip = "Die geprüfte Engine 1.2.3 fehlt oder wurde verändert. Bitte das vollständige Paket verwenden. Ein altes Profil kann diese Option weiterhin ausschalten.";
            AutomationProperties.SetName(toggle, mod.Title);
            var switchRow = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Top };
            var state = new TextBlock { Text = toggle.IsChecked == true ? "Aktiv" : "Inaktiv", FontSize = 15, Foreground = Brush("#C3D4E5"), VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 12, 0) };
            switchRow.Children.Add(state); switchRow.Children.Add(toggle); Grid.SetColumn(switchRow, 1); top.Children.Add(switchRow);
            body.Children.Add(top); Toggles[prefix] = toggle;
            var summary = Readable(mod.Description, 15, "#D4E1ED"); summary.Margin = new Thickness(0, 9, 0, 0); body.Children.Add(summary);
            TextBlock roleHint = null;
            if (mod.ServerOnly || mod.ClientOnly || mod.KnownTargetOnly)
            {
                roleHint = Readable("", 14, "#F1D1A0"); roleHint.Tag = prefix + ".TargetRoleHint";
                body.Children.Add(new Border { Child = roleHint, Background = Brush("#20303D"), BorderBrush = Brush("#7D694A"), BorderThickness = new Thickness(1), Padding = new Thickness(12), CornerRadius = new CornerRadius(6), Margin = new Thickness(0, 12, 0, 0) });
            }
            var auxiliary = new StackPanel();
            if (cat.Key == "inventory" && mod.Key == "adjustStackSize")
            {
                var inspect = new Button { Content = "Installierte Stapel prüfen …", Tag = "InspectStacks", HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 12, 0, 0), Padding = new Thickness(13, 9, 13, 9) };
                inspect.Click += delegate { Act(ReviewStacks); }; auxiliary.Children.Add(inspect);
                auxiliary.Children.Add(Readable("Liest die installierten Archive und vergleicht sie mit dem Profilwert. Ändert keine Spieldateien.", 13, "#C6D4E3"));
            }
            if (cat.Key == "player" && mod.Key == "adjustSkillPointsPerLevel")
            {
                var targetHelp = new StackPanel();
                skillTargetHint = Readable("", 14, "#F1D1A0"); UpdateSkillTargetHint(); targetHelp.Children.Add(skillTargetHint);
                skillClientActions = new StackPanel { Tag = "SkillClientActions", Visibility = StudioStore.CheckGame((string)Config["gameDirectory"]) == "Steam-Client erkannt" ? Visibility.Visible : Visibility.Collapsed };
                targetHelp.Children.Add(skillClientActions);
                var clientProfile = new Button { Content = "Gleiches Profil für Spielclient anlegen …", HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 12, 0, 0), Padding = new Thickness(13, 9, 13, 9) };
                clientProfile.Click += delegate { Act(CreateSkillClientProfile); }; skillClientActions.Children.Add(clientProfile);
                skillClientActions.Children.Add(Readable("Kopiert alle Einstellungen des aktuellen Profils in ein neues Client-Profil und aktiviert dort die Fertigkeitspunkte-Option. Es werden dabei noch keine Spieldateien geändert.", 13, "#C6D4E3"));
                var applyPoints = new Button { Content = "Punkte auf diesem Spiel-PC anwenden …", Tag = "ApplyClientSkillPoints", HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 12, 0, 0), Padding = new Thickness(13, 9, 13, 9) };
                applyPoints.Click += delegate { Act(ApplyClientSkillPoints); }; skillClientActions.Children.Add(applyPoints);
                skillClientActions.Children.Add(Readable("Übernimmt den Punktewert und startet den Patch für die gewählte enshrouded.exe. Ein vorhandenes eindeutiges Client-Profil bleibt mit seinen übrigen Einstellungen erhalten. Ohne Client-Profil wird nur die Punkteoption aktiviert. Dies ist keine ausschließlich serverseitige Lösung; die Wirkung im Mehrspieler muss im Spiel geprüft werden.", 13, "#C6D4E3"));
                var inspectPoints = new Button { Content = "Installierte Fähigkeitspunkte prüfen …", Tag = "InspectSkillPoints", HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 10, 0, 0), Padding = new Thickness(13, 9, 13, 9) };
                inspectPoints.Click += delegate { Act(ReviewSkillPoints); }; targetHelp.Children.Add(inspectPoints);
                auxiliary.Children.Add(new Border { Child = targetHelp, Background = Brush("#20303D"), BorderBrush = Brush("#7D694A"), BorderThickness = new Thickness(1), Padding = new Thickness(14), CornerRadius = new CornerRadius(6), Margin = new Thickness(0, 13, 0, 0) });
            }
            var editable = new List<Control>();
            var fields = new StackPanel();
            var editHint = Readable("Zum Bearbeiten einschalten. Ausgeschaltet gilt nach dem Anwenden die gespeicherte Ausgangsbasis.", 13, "#AEC6DA");
            editHint.Margin = new Thickness(0, 7, 0, 0); editHint.Visibility = toggle.IsChecked == true ? Visibility.Collapsed : Visibility.Visible;
            foreach (var field in mod.Fields)
            {
                string key = prefix + "." + field.Key;
                var row = new Grid { Margin = new Thickness(0, 14, 0, 0) };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(210) }); row.ColumnDefinitions.Add(new ColumnDefinition());
                var inputArea = new StackPanel { Margin = new Thickness(0, 0, 20, 0) };
                if (field.Boolean)
                {
                    var flag = new CheckBox { IsChecked = (bool)data[field.Key], Content = Readable(field.Label, 15, "#EDF3FA"), MinHeight = 34, IsEnabled = toggle.IsChecked == true };
                    AutomationProperties.SetName(flag, mod.Title + ": " + field.Label);
                    flag.Checked += delegate { data[field.Key] = true; MarkDirty(); };
                    flag.Unchecked += delegate { data[field.Key] = false; MarkDirty(); };
                    inputArea.Children.Add(flag); editable.Add(flag);
                }
                else if (field.Choices != null && field.Choices.Count > 0)
                {
                    inputArea.Children.Add(Readable(field.Label, 14, "#E0EAF4"));
                    var label = new FrameworkElementFactory(typeof(TextBlock));
                    label.SetBinding(TextBlock.TextProperty, new Binding("Label")); label.SetValue(TextBlock.TextWrappingProperty, TextWrapping.Wrap);
                    label.SetValue(TextBlock.MaxWidthProperty, 140.0); label.SetValue(TextBlock.LineHeightProperty, 20.0);
                    var input = new ComboBox { ItemsSource = field.Choices, SelectedValuePath = "Value", SelectedValue = checked((long)Json.Number(data[field.Key])),
                        ItemTemplate = new DataTemplate { VisualTree = label }, FontSize = 14, Width = 190, MinHeight = 38,
                        HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 7, 0, 0), IsEnabled = toggle.IsChecked == true };
                    AutomationProperties.SetName(input, mod.Title + ": " + field.Label);
                    input.SelectionChanged += delegate
                    {
                        var choice = input.SelectedItem as FieldChoiceDef;
                        if (choice == null) return;
                        data[field.Key] = choice.Value; Drafts.Remove(key); InputErrors.Remove(key); MarkDirty();
                        notice.Text = mod.Title + ": " + choice.Label + " gewählt. Die Wirkung im Spiel bleibt ungeprüft.";
                        if (mod.Key == "adjustSummonedCompanions" && field.Key == "companionVariant" && choice.Value == 3)
                            notice.Text = mod.Title + ": Im Spiel die vorhandenen Zaubervarianten nacheinander verwenden, um eine Mischgruppe zu testen. Die tatsächliche Spielwirkung bleibt offen.";
                    };
                    inputArea.Children.Add(input); editable.Add(input); ChoiceFields[key] = input;
                }
                else
                {
                    inputArea.Children.Add(Readable(field.Label, 14, "#E0EAF4"));
                    string draft; if (!Drafts.TryGetValue(key, out draft)) draft = Json.Number(data[field.Key]).ToString("R", CultureInfo.GetCultureInfo("de-DE"));
                    var input = new TextBox { Text = draft, FontSize = 16, Width = 170, HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 7, 0, 0), IsEnabled = toggle.IsChecked == true };
                    AutomationProperties.SetName(input, mod.Title + ": " + field.Label);
                    var fieldError = Readable("", 12, "#FFC1B2"); fieldError.Margin = new Thickness(0, 5, 0, 0); fieldError.Visibility = Visibility.Collapsed;
                    if (InputErrors.ContainsKey(key)) { input.Tag = "Invalid"; input.BorderBrush = Brush("#F7A18F"); fieldError.Text = InputErrors[key]; fieldError.Visibility = Visibility.Visible; }
                    input.TextChanged += delegate
                    {
                        Drafts[key] = input.Text; double number;
                        if (!Json.ParseInput(input.Text, out number) || number < field.Minimum || number > field.Maximum || (field.Integer && Math.Truncate(number) != number))
                        {
                            string minimum = (field.Integer ? Math.Ceiling(field.Minimum) : field.Minimum).ToString("G", CultureInfo.GetCultureInfo("de-DE"));
                            InputErrors[key] = mod.Title + ": " + field.Label + " benötigt " + (field.Integer ? "eine ganze Zahl" : "eine Zahl") + " von " + minimum + " bis " + field.Maximum.ToString("G", CultureInfo.GetCultureInfo("de-DE")) + ".";
                            input.Tag = "Invalid"; input.BorderBrush = Brush("#F7A18F"); fieldError.Text = "Bitte " + (field.Integer ? "eine ganze Zahl" : "eine Zahl") + " von " + minimum + " bis " + field.Maximum.ToString("G", CultureInfo.GetCultureInfo("de-DE")) + " eingeben."; fieldError.Visibility = Visibility.Visible;
                        }
                        else { InputErrors.Remove(key); data[field.Key] = field.Integer ? (object)(long)number : number; input.Tag = null; input.BorderBrush = Brush("#465970"); fieldError.Text = ""; fieldError.Visibility = Visibility.Collapsed; }
                        MarkDirty(); notice.Text = InputErrors.Count > 0 ? InputErrors.Values.First() : "Änderungen noch nicht gespeichert.";
                    };
                    inputArea.Children.Add(input); inputArea.Children.Add(fieldError); editable.Add(input); Fields[key] = input;
                }
                row.Children.Add(inputArea);
                var explanation = new StackPanel();
                explanation.Children.Add(Readable(field.Help, 14, "#CBD9E8"));
                var original = Json.Object(Json.Object(Store.Defaults[cat.Key], cat.Key)[mod.Key], mod.Key)[field.Key];
                string defaultText = field.Boolean ? ((bool)original ? "Ein" : "Aus") : Json.Number(original).ToString("R", CultureInfo.GetCultureInfo("de-DE"));
                if (field.Choices != null && field.Choices.Count > 0)
                {
                    var originalChoice = field.Choices.FirstOrDefault(choice => choice.Value == Json.Number(original));
                    if (originalChoice != null) defaultText = originalChoice.Label;
                }
                var defaultLabel = Readable("Patch-Vorgabe: " + defaultText + " · kein ausgelesener Spielwert", 12, "#ADC4D8"); defaultLabel.Margin = new Thickness(0, 5, 0, 0); explanation.Children.Add(defaultLabel);
                Grid.SetColumn(explanation, 1); row.Children.Add(explanation); fields.Children.Add(row);
            }
            if (mod.Fields.Count > 0) body.Children.Add(new Border { Child = fields, BorderBrush = Brush("#38516A"), BorderThickness = new Thickness(0, 1, 0, 0), Margin = new Thickness(0, 12, 0, 8) });
            if (mod.Fields.Count > 0) body.Children.Add(editHint);
            if (auxiliary.Children.Count > 0) body.Children.Add(auxiliary);
            var detailsBody = new StackPanel();
            AddDetail(detailsBody, "Wo anwenden?", mod.Scope); AddDetail(detailsBody, "Wann ist das sinnvoll?", mod.WhenToUse); AddDetail(detailsBody, "Was wird geändert?", mod.Effect); AddDetail(detailsBody, "Beispiel", mod.Example); AddDetail(detailsBody, "Grenzen und Besonderheiten", mod.Notes);
            var details = new Expander { Header = new TextBlock { Text = "Anwendung, Beispiel und Grenzen", FontSize = 14, Foreground = Brush("#A9E5DD"), TextWrapping = TextWrapping.Wrap }, Content = detailsBody, Margin = new Thickness(0, 7, 0, 0), IsExpanded = OpenDetails.Contains(prefix) };
            details.Expanded += delegate { OpenDetails.Add(prefix); };
            details.Collapsed += delegate { OpenDetails.Remove(prefix); };
            Details[prefix] = details; body.Children.Add(details);
            var card = new Border { Child = body, Background = Brush("#1B293A"), BorderBrush = Brush(toggle.IsChecked == true ? "#66AAA5" : "#41566C"), BorderThickness = new Thickness(1), Padding = new Thickness(18), CornerRadius = new CornerRadius(7), Margin = new Thickness(0, 0, 0, 12) };
            Action refreshTarget = null;
            RoutedEventHandler changed = delegate
            {
                data["enabled"] = toggle.IsChecked == true;
                if (brokenServerLimits && toggle.IsChecked != true) toggle.IsEnabled = false;
                foreach (var input in editable) input.IsEnabled = toggle.IsChecked == true;
                editHint.Visibility = toggle.IsChecked == true ? Visibility.Collapsed : Visibility.Visible;
                state.Text = toggle.IsChecked == true ? "Aktiv" : "Inaktiv";
                card.BorderBrush = Brush(toggle.IsChecked == true ? "#5A9B9D" : "#445D76"); MarkDirty();
                if (refreshTarget != null) { refreshTarget(); UpdateGame(); }
                notice.Text = toggle.IsChecked == true ? (mod.ServerOnly || mod.ClientOnly || mod.KnownTargetOnly ? mod.Title + (StudioStore.CheckGame(Config["gameDirectory"] as string) == "Steam-Client erkannt" ? ": Singleplayer-Test eingeschaltet. Unten auf die lokalen Spieldaten anwenden; die Spielwirkung bleibt ungeprüft." : ": lokale Testfunktion eingeschaltet. Datenpatch vorbereiten; die Spielwirkung im Multiplayer bleibt ungeprüft.") : mod.Title + ": eingeschaltet. Unten anwenden, um die Spieldateien zu aktualisieren.") : mod.Title + ": ausgeschaltet. Beim nächsten Anwenden wird diese Änderung aus dem Patch entfernt.";
                if (toggle.IsChecked == true && mod.Key == CompanionSpellUi.Key)
                    notice.Text = CompanionSpellUi.ActivationNotice(mod.Title);
                if (onlyActive.IsChecked == true) Window.Dispatcher.BeginInvoke(new Action(Render));
            };
            toggle.Checked += changed; toggle.Unchecked += changed;
            if (mod.ServerOnly || mod.ClientOnly || mod.KnownTargetOnly)
            {
                refreshTarget = delegate
                {
                    string target = StudioStore.CheckGame(Config["gameDirectory"] as string);
                    bool blocked = !StudioStore.AllowsTarget(mod, target);
                    bool clientTarget = target == "Steam-Client erkannt";
                    toggle.IsEnabled = (!brokenServerLimits || toggle.IsChecked == true) && (!blocked || toggle.IsChecked == true);
                    foreach (var input in editable) input.IsEnabled = toggle.IsChecked == true && !blocked;
                    state.Text = blocked ? (toggle.IsChecked == true ? "Im Profil aktiv · Ziel gesperrt" : mod.ClientOnly ? "Nur Singleplayer" : mod.ServerOnly ? "Nur Server" : "Ordner wählen") : toggle.IsChecked == true ? "Aktiv" : "Inaktiv";
                    if (blocked)
                    {
                        roleHint.Text = mod.ClientOnly ? "Diese neue Testfunktion ist nur für Singleplayer freigegeben. Wähle den vollständigen lokalen Spielordner mit enshrouded.exe. Eine bereits aktive Profiloption lässt sich ausschalten." : mod.ServerOnly ? (clientTarget ? "Spielclient erkannt: Diese Server-Testversion ist hier gesperrt. Wähle den Dedicated-Serverordner. Eine bereits aktive Profiloption lässt sich ausschalten." : "Für diese lokale Server-Testversion zuerst einen vollständigen, getrennten Dedicated-Serverordner wählen. Unbekannte und gemischte Ziele sind gesperrt.") : "Für diese lokale Testfunktion einen vollständigen, eindeutig erkannten Steam-Spielordner für Singleplayer oder einen getrennten Dedicated-Serverordner wählen. Unbekannte und gemischte Ziele sind gesperrt. Eine bereits aktive Profiloption lässt sich ausschalten.";
                    }
                    else roleHint.Text = clientTarget ? "Singleplayer-Test: lokaler Spielordner erkannt. Der Patch ändert die Spieldaten dieser Installation; die Spielwirkung ist noch ungeprüft." : "Dedicated Server erkannt · lokale Testfunktion. Der Patch ändert Serverdaten; die Wirkung mit unveränderten Spielclients im Multiplayer ist noch ungeprüft.";
                    if (mod.Key == CompanionSpellUi.Key)
                        roleHint.Text = CompanionSpellUi.TargetHint(target, blocked);
                    if (!blocked && mod.Key == "adjustSummonedCompanions")
                        roleHint.Text += " Mit „Im Spiel per Zauber wählen“ die vorhandenen Zaubervarianten für eine Mischgruppe wechseln; der tatsächliche Spieltest steht noch aus.";
                    toggle.ToolTip = blocked ? roleHint.Text : clientTarget ? "Lokale Testfunktion für Singleplayer aktivieren. Die Spielwirkung bleibt ungeprüft." : "Lokale Testfunktion für den Dedicated Server aktivieren. Die Spielwirkung im Multiplayer bleibt ungeprüft.";
                    if (mod.Key == CompanionSpellUi.Key)
                        toggle.ToolTip = CompanionSpellUi.ToolTip(target, blocked);
                    editHint.Text = blocked ? (mod.ClientOnly ? "Für diesen Singleplayer-Test einen vollständigen lokalen Spielordner wählen oder die Option ausschalten." : mod.ServerOnly ? "Werte werden für dieses Ziel nicht bearbeitet oder angewendet. Serverordner wählen oder die Option ausschalten." : "Werte werden für dieses Ziel nicht bearbeitet oder angewendet. Getrennten Spiel- oder Serverordner wählen oder die Option ausschalten.") : "Zum Bearbeiten einschalten. Ausgeschaltet gilt nach dem Anwenden die gespeicherte Ausgangsbasis.";
                    editHint.Visibility = blocked || toggle.IsChecked != true ? Visibility.Visible : Visibility.Collapsed;
                };
                targetRoleUpdates[prefix] = refreshTarget; refreshTarget();
            }
            optionsGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            Grid.SetRow(card, cardRow++); Grid.SetColumnSpan(card, 2); optionsGrid.Children.Add(card);
        }

        private void ReviewServer()
        {
            string path = Path.Combine((string)Config["gameDirectory"], "enshrouded_server.json");
            if (!File.Exists(path))
            {
                var chooser = new OpenFileDialog { Title = "Aktuelle enshrouded_server.json auswählen", Filter = "Server-Konfiguration (enshrouded_server.json)|enshrouded_server.json|JSON-Dateien (*.json)|*.json", FileName = "enshrouded_server.json" };
                if (Directory.Exists((string)Config["gameDirectory"])) chooser.InitialDirectory = (string)Config["gameDirectory"];
                if (chooser.ShowDialog(Window) != true) return;
                path = chooser.FileName;
            }
            var review = ServerReview.Read(path);
            CreateReviewWindow(review, path).ShowDialog();
        }
        public Window CreateReviewWindow(ServerReview review, string path)
        {
            var dialog = new Window { Title = "Serverwerte prüfen — nur lesen", Width = 900, Height = 760, MinWidth = 760, MinHeight = 600,
                Owner = Window, WindowStartupLocation = WindowStartupLocation.CenterOwner, Background = Brush("#101B29"), Foreground = Brushes.White, FontFamily = Window.FontFamily, FontSize = 15, UseLayoutRounding = true, SnapsToDevicePixels = true };
            FitToWorkArea(dialog, SystemParameters.WorkArea);
            TextOptions.SetTextFormattingMode(dialog, TextFormattingMode.Display); TextOptions.SetTextRenderingMode(dialog, TextRenderingMode.ClearType);
            dialog.Resources = Window.Resources;
            var grid = new Grid { Margin = new Thickness(24) };
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); grid.RowDefinitions.Add(new RowDefinition()); grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var header = new StackPanel(); header.Children.Add(new TextBlock { Text = "Serverwerte prüfen", FontSize = 25, FontWeight = FontWeights.SemiBold });
            var source = Readable(path, 14, "#C1D2E4"); source.Margin = new Thickness(0, 8, 0, 12); header.Children.Add(source);
            var summary = Readable(review.Summary, 15, "#D8E6F2"); summary.Margin = new Thickness(0, 0, 0, 16); header.Children.Add(summary); grid.Children.Add(header);
            var list = new StackPanel();
            foreach (var entry in review.Entries)
            {
                var body = new StackPanel(); body.Children.Add(new TextBlock { Text = entry.Label, FontSize = 16, FontWeight = FontWeights.SemiBold });
                var number = Readable(entry.Value, 19, entry.Attention ? "#FFD39E" : "#A7E8DC"); number.Margin = new Thickness(0, 5, 0, 6); body.Children.Add(number);
                body.Children.Add(Readable(entry.Explanation, 15, "#C7D7E7"));
                list.Children.Add(new Border { Child = body, Background = Brush("#172739"), BorderBrush = Brush(entry.Attention ? "#B68C5B" : "#46617C"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(6), Padding = new Thickness(15), Margin = new Thickness(0, 0, 7, 12) });
            }
            var scroll = new ScrollViewer { Content = list, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Style = (Style)Window.Resources["SlimScroll"] }; Grid.SetRow(scroll, 1); grid.Children.Add(scroll);
            var footer = new StackPanel { Margin = new Thickness(0, 16, 0, 0) };
            footer.Children.Add(Readable("Diese Prüfung liest nur die JSON-Datei. Gepatchte Archive und der Zustand des laufenden Servers werden nicht ausgelesen. Die Datei wird nicht verändert.", 14, "#C5D5E6"));
            var actions = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 14, 0, 0) };
            var copy = new Button { Content = "Diagnose kopieren", Margin = new Thickness(0, 0, 10, 0) };
            copy.Click += delegate { Clipboard.SetText(review.SafeSummary()); copy.Content = "Kopiert"; };
            var close = new Button { Content = "Schließen", IsCancel = true }; close.Click += delegate { dialog.Close(); };
            actions.Children.Add(copy); actions.Children.Add(close); footer.Children.Add(actions); Grid.SetRow(footer, 2); grid.Children.Add(footer);
            dialog.Content = new Border { Background = Brush("#101B29"), Child = grid }; return dialog;
        }
        private void RenderSettings()
        {
            var panel = new StackPanel();
            panel.Children.Add(new TextBlock { Text = "Patcher einrichten – Erstinstallation", FontSize = 21, FontWeight = FontWeights.SemiBold });
            panel.Children.Add(Readable("Du brauchst kein altes Studio. Die Einrichtung liest das geprüfte Originalpaket 1.2.3 und ergänzt nur fehlende Programmdateien. Profile, Archivbasen und Spieldateien bleiben dabei unberührt.", 15, "#D1DFED"));
            var setupRuntime = new Button { Content = "Patcher einrichten …", HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 12, 0, 20) }; setupRuntime.Click += delegate { Act(SetupPatcherRuntime); }; panel.Children.Add(setupRuntime);
            panel.Children.Add(new TextBlock { Text = "Clientpaket für Servermanager", FontSize = 21, FontWeight = FontWeights.SemiBold });
            panel.Children.Add(ClientPackageUi.Build(Store, Window, delegate { return Config["gameDirectory"] as string; }, Act, delegate(string message) { notice.Text = message; }, out refreshClientPackageStatus));
            panel.Children.Add(new TextBlock { Text = "Bereits gepatcht? Einfach aktualisieren.", FontSize = 21, FontWeight = FontWeights.SemiBold });
            var updateHelp = Readable("Schalter oder Werte ändern und unten ‚Patch anwenden / aktualisieren‘ drücken. Das Tool erstellt die gewünschten Änderungen jedes Mal aus seiner gespeicherten Basis neu. Ein Faktor 2 bleibt deshalb auch nach mehreren Aktualisierungen Faktor 2. Ausgeschaltete Mods werden aus dem neuen Patch entfernt.", 15, "#D1DFED"); updateHelp.Margin = new Thickness(0, 9, 0, 12); panel.Children.Add(updateHelp);
            var transfer = new Button { Content = "Altes Setup übernehmen …", HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 0, 0, 12) }; transfer.Click += delegate { Act(TransferSetup); }; panel.Children.Add(transfer);
            panel.Children.Add(Readable("Beim Wechsel von einer bisherigen Studio-Version zuerst den bisherigen Studio-Ordner übernehmen. Dadurch bleiben Profile und ursprüngliche Archivbasis verfügbar. Hat ein älterer Patcher keine passende Basis gespeichert, können enthaltene Mods nicht zuverlässig rückgängig gemacht werden. Dann über Steam saubere Spieldateien herstellen und eine neue Basis wählen.", 14, "#C7D7E7"));
            panel.Children.Add(new TextBlock { Text = "Nach einem Enshrouded-Spielupdate", FontSize = 19, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 23, 0, 8) });
            panel.Children.Add(Readable("Spiel und Server schließen, die Dateien über Steam prüfen lassen und hier die neue Ausgangsbasis freigeben. Danach ‚Patch anwenden / aktualisieren‘ drücken. Der Dialog zeigt den erkannten Dateistand; alte Sicherungen bleiben erhalten.", 15, "#D1DFED"));
            var basis = new Button { Content = "Spielupdate / Basis wechseln …", HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 13, 0, 0) }; basis.Click += delegate { Act(ChangeBasis); }; panel.Children.Add(basis);
            var advanced = new Button { Content = "Erweiterte Patch-Werkzeuge öffnen …", HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 13, 0, 12) }; advanced.Click += delegate { Act(Launch); }; panel.Children.Add(advanced);
            var logButton = new Button { Content = "Letztes Patch-Protokoll öffnen", HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 0, 0, 28) }; logButton.Click += delegate { Act(OpenPatchLog); }; panel.Children.Add(logButton);
            panel.Children.Add(new TextBlock { Text = "Installierte Stapelgrößen", FontSize = 21, FontWeight = FontWeights.SemiBold });
            var stackHelp = Readable("Liest die tatsächlichen Item-Limits aus dem aktuell gewählten Client- oder Serverarchiv. Du siehst, wie viele stapelbare Gegenstände deinen Profilwert enthalten. Nach einem Spielupdate zuerst eine neue Basis freigeben und das Profil anwenden; anschließend hier den installierten Stand prüfen.", 15, "#D1DFED"); stackHelp.Margin = new Thickness(0, 9, 0, 12); panel.Children.Add(stackHelp);
            var stacks = new Button { Content = "Installierte Stapel prüfen …", Tag = "InspectStacks", HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 0, 0, 28) }; stacks.Click += delegate { Act(ReviewStacks); }; panel.Children.Add(stacks);
            panel.Children.Add(new TextBlock { Text = "Welche Installation wird geladen?", FontSize = 21, FontWeight = FontWeights.SemiBold });
            var diagnosticHelp = Readable("Vergleicht die aktuellen Archive mit dem zuletzt gespeicherten Patchstand und prüft die Startpfade laufender Spiel- und Serverprozesse. Der Bericht nennt außerdem den KFC-Pfad aus dem letzten verfügbaren Spielprotokoll. Auf dem Server-PC ausführen, um dessen Stand zu prüfen.", 15, "#D1DFED"); diagnosticHelp.Margin = new Thickness(0, 9, 0, 12); panel.Children.Add(diagnosticHelp);
            var diagnostic = new Button { Content = "Ladepfad & Patchstand prüfen …", Tag = "DiagnoseInstallation", HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 0, 0, 28) }; diagnostic.Click += delegate { Act(DiagnoseInstallation); }; panel.Children.Add(diagnostic);
            panel.Children.Add(new TextBlock { Text = "Server und Gegnerschaden", FontSize = 21, FontWeight = FontWeights.SemiBold });
            var serverHelp = Readable("Prüft die gespeicherten Faktoren für Gegner- und Bossschaden, Spielerleben und Angriffshäufigkeit. Die Prüfung liest enshrouded_server.json; sie ändert keine Serverwerte.", 15, "#D1DFED"); serverHelp.Margin = new Thickness(0, 9, 0, 12); panel.Children.Add(serverHelp);
            var server = new Button { Content = "Serverwerte prüfen …", HorizontalAlignment = HorizontalAlignment.Left }; server.Click += delegate { Act(ReviewServer); }; panel.Children.Add(server);
            panel.Children.Add(new TextBlock { Text = "Speicherort", FontSize = 21, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 30, 0, 10) });
            panel.Children.Add(Readable(Store.DataRoot, 15, "#D1DFED"));
            panel.Children.Add(Readable("Hier liegen Profile, Originalbasen und Arbeitskopien. Alte Arbeitsdaten werden automatisch bereinigt; Profile, passende Basen und offene Wiederherstellungsvorgänge bleiben geschützt.", 15, "#C8D8E8"));
            panel.Children.Add(new TextBlock { Text = "Dateien nach dem Patchen", FontSize = 21, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 30, 0, 10) });
            var settings = Json.Object(Config["settings"], "Werkzeuge");
            foreach (var entry in new[] {
                new[] { "keepTempFiles", "Entpackte Dateien behalten", "Behält die entpackten und erneut gelesenen Prüfdaten nach dem Anwenden. Das benötigt zusätzlichen Speicher. Jede Vorschau wird frisch aus der gespeicherten Basis erstellt." },
                new[] { "keepModdedFiles", "Geänderte Ausgabedateien behalten", "Kopiert die geänderten JSON-Dateien nach dem Anwenden zusätzlich in den gewählten Ausgabeordner. Die Archivbasis bleibt separat unter Data/patches gespeichert." }
            })
            {
                string key = entry[0];
                var flag = new CheckBox { Content = new TextBlock { Text = entry[1], FontSize = 16, TextWrapping = TextWrapping.Wrap }, IsChecked = (bool)settings[key], Margin = new Thickness(0, 12, 0, 6) };
                flag.Checked += delegate { settings[key] = true; MarkDirty(); }; flag.Unchecked += delegate { settings[key] = false; MarkDirty(); }; panel.Children.Add(flag);
                panel.Children.Add(Readable(entry[2], 15, "#C8D8E8"));
            }
            panel.Children.Add(new TextBlock { Text = "Ausgabeordner des Patchers", FontSize = 16, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 25, 0, 8) });
            var output = new TextBox { Text = (string)Config["outputDirectory"], FontSize = 16 }; output.TextChanged += delegate { Config["outputDirectory"] = output.Text; MarkDirty(); }; panel.Children.Add(output);
            var help = Readable("./output ist ein Unterordner im Verzeichnis engine. Relative Pfade beziehen sich auf engine. Hier werden bei eingeschaltetem „Geänderte Ausgabedateien behalten“ pro Lauf eigene Unterordner angelegt. Die Vorschau selbst arbeitet unter Data/patches.", 15, "#C8D8E8"); help.Margin = new Thickness(0, 9, 0, 24); panel.Children.Add(help);
            var disable = new Button { Content = "Alle Mods in diesem Profil ausschalten", HorizontalAlignment = HorizontalAlignment.Left };
            disable.Click += delegate
            {
                foreach (var cat in Store.Schema) foreach (var mod in cat.Mods) StudioStore.SetEnabled(Config, cat.Key, mod.Key, false);
                MarkDirty(); Render(); notice.Text = "Alle Mods im Profil aus. Bereits gepatchte Spieldateien sind dadurch noch nicht wiederhergestellt.";
            };
            panel.Children.Add(disable);
            var disableHelp = Readable("Danach ‚Patch anwenden / aktualisieren‘ drücken. Damit wird die gespeicherte Basis ohne die Mod-Änderungen dieses Profils installiert.", 14, "#C8D8E8"); disableHelp.Margin = new Thickness(0, 9, 0, 18); panel.Children.Add(disableHelp);
            var folder = new Button { Content = "Profil- und Sicherungsordner öffnen", HorizontalAlignment = HorizontalAlignment.Left }; folder.Click += delegate { Act(delegate { Process.Start(new ProcessStartInfo(Store.DataRoot) { UseShellExecute = true }); }); }; panel.Children.Add(folder);
            var manual = new Button { Content = "Alle Einstellungen als Text öffnen", HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 12, 0, 0) }; manual.Click += delegate { Act(delegate { Process.Start(new ProcessStartInfo(Path.Combine(Store.AppRoot, "EINSTELLUNGEN.txt")) { UseShellExecute = true }); }); }; panel.Children.Add(manual);
            var sections = new StackPanel(); StackPanel section = null;
            foreach (FrameworkElement child in panel.Children.Cast<FrameworkElement>().ToList())
            {
                panel.Children.Remove(child);
                var heading = child as TextBlock;
                if (section == null || (heading != null && heading.FontSize >= 19))
                {
                    section = new StackPanel(); child.Margin = new Thickness(0, 0, 0, 7);
                    sections.Children.Add(new Border { Background = Brush("#1B293A"), BorderBrush = Brush("#41566C"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(7), Padding = new Thickness(18), Margin = new Thickness(0, 0, 0, 12), Child = section });
                }
                section.Children.Add(child);
            }
            options.Children.Add(sections);
        }

        public void Screenshot(string path)
        { CaptureWindow(Window, path, 1); }
        public static void CaptureWindow(Window window, string path, double scale)
        {
            window.Show(); window.UpdateLayout();
            window.Dispatcher.Invoke(DispatcherPriority.Render, new Action(delegate { }));
            var content = (FrameworkElement)window.Content;
            var bitmap = new RenderTargetBitmap((int)Math.Ceiling(content.ActualWidth * scale), (int)Math.Ceiling(content.ActualHeight * scale), 96 * scale, 96 * scale, PixelFormats.Pbgra32);
            bitmap.Render(content);
            var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(bitmap));
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path)));
            using (var file = File.Create(path)) encoder.Save(file);
        }
    }
    public static class Program
    {
        [STAThread]
        public static int Main(string[] args)
        {
            try
            {
                string root = AppDomain.CurrentDomain.BaseDirectory;
                if (args.Length == 0 && ToolHandoff.TryForward(root)) return 0;
                if (args.Length > 0 && args[0] == "--self-test") return SelfTests.Run(root, args.Length > 1 ? args[1] : Path.Combine(root, "test-report.txt"));
                bool preview = args.Length > 0 && args[0] == "--preview";
                if (preview && args.Length < 2) throw new ArgumentException("--preview benötigt einen PNG-Pfad.");
                string data = preview ? Path.Combine(Path.GetDirectoryName(Path.GetFullPath(args[1])), "preview-data-" + Guid.NewGuid().ToString("N")) : Path.Combine(root, "Data");
                var store = new StudioStore(root, data); store.Load();
                var app = new Application();
                var ui = new StudioWindow(store, preview);
                if (args.Length > 0 && args[0] == "--update-startup")
                {
                    if (args.Length != 2) throw new ArgumentException("Startbestätigung fehlt.");
                    if (store.LoadErrors.Count > 0) throw new InvalidDataException("Übernommene Profile sind nicht vollständig lesbar: " + string.Join(" · ", store.LoadErrors));
                    ui.Window.Loaded += delegate { ToolHandoff.AwaitAcceptance(store, args[1], ui.Window); };
                }
                if (preview)
                {
                    if (args.Length < 2) throw new ArgumentException("--preview benötigt einen PNG-Pfad.");
                    if (args.Length > 2) ui.ChooseCategory(args[2]); ui.Screenshot(args[1]);
                    ui.Window.Close();
                    return 0;
                }
                return app.Run(ui.Window);
            }
            catch (Exception ex)
            {
                if (args.Length > 0)
                {
                    string error = args.Length > 1 ? Path.GetFullPath(args[1]) + ".error.txt" : Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "startup-error.txt");
                    File.WriteAllText(error, ex.ToString());
                }
                else MessageBox.Show(ex.Message, "Enshrouded Mod Studio konnte nicht starten", MessageBoxButton.OK, MessageBoxImage.Error);
                return 1;
            }
        }
    }
}
