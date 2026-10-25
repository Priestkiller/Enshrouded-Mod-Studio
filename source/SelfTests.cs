using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Diagnostics;
using Microsoft.CSharp;
using System.CodeDom.Compiler;
using System.Runtime.InteropServices;
using System.Windows.Media;
using System.Reflection;

namespace EnshroudedStudio
{
    public static class SelfTests
    {
        [DllImport("shcore.dll")] private static extern int GetProcessDpiAwareness(IntPtr process, out int awareness);
        [DllImport("user32.dll")] private static extern IntPtr GetThreadDpiAwarenessContext();
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool AreDpiAwarenessContextsEqual(IntPtr first, IntPtr second);
        private static List<string> results = new List<string>();
        private static void Check(bool condition, string label)
        { if (!condition) throw new Exception("FAIL: " + label); results.Add("PASS: " + label); }
        private static Dictionary<string, object> Mod(Dictionary<string, object> config, string cat, string key)
        { return Json.Object(Json.Object(config[cat], cat)[key], key); }
        private static IEnumerable<DependencyObject> LogicalDescendants(DependencyObject root)
        {
            foreach (object child in LogicalTreeHelper.GetChildren(root))
            {
                var element = child as DependencyObject; if (element == null) continue;
                yield return element; foreach (var descendant in LogicalDescendants(element)) yield return descendant;
            }
        }
        private static void ExerciseEditingRegressions(StudioWindow ui, StudioStore store, string report)
        {
            var originalProfile = ui.Current;
            double oldWidth = ui.Window.Width, oldHeight = ui.Window.Height, oldLeft = ui.Window.Left, oldTop = ui.Window.Top;
            double oldMinWidth = ui.Window.MinWidth, oldMinHeight = ui.Window.MinHeight, oldMaxWidth = ui.Window.MaxWidth, oldMaxHeight = ui.Window.MaxHeight;
            var profile = store.NewProfile("UI-Regressionen 0.4.8", store.Baseline());
            var alternative = store.NewProfile("UI-Regressionen Wechselziel", store.Baseline());
            string key = "inventory.adjustStackSize", field = key + ".value";
            try
            {
                ui.LoadProfile(profile); ui.ChooseCategory("inventory"); ui.Toggles[key].IsChecked = true;
                ui.Fields[field].Text = "ungueltiger Entwurf"; ui.Toggles[key].IsChecked = false;
                ui.SaveCurrent();
                Check(!ui.Dirty && ui.InputErrors.ContainsKey(field) && ui.Drafts[field] == "ungueltiger Entwurf" && !ui.Fields[field].IsEnabled && !(bool)Mod(ui.Current.Config, "inventory", "adjustStackSize")["enabled"], "Disabled invalid drafts remain recoverable while the inactive profile saves successfully");
                ui.Toggles[key].IsChecked = true;
                bool blocked = false; try { ui.SaveCurrent(); } catch (InvalidDataException) { blocked = true; }
                var red = ui.Fields[field].BorderBrush as SolidColorBrush;
                Check(blocked && ui.Dirty && ui.InputErrors.ContainsKey(field) && ui.Fields[field].Text == "ungueltiger Entwurf" && ui.Fields[field].IsEnabled && red != null && red.Color.R > red.Color.G + 30 && red.Color.R > red.Color.B + 30, "Reactivating an invalid draft blocks saving again and restores the editable red error field");
                ui.ChooseCategory("settings");
                var allOff = LogicalDescendants(ui.Find<StackPanel>("OptionsPanel")).OfType<Button>().First(b => Convert.ToString(b.Content).StartsWith("Alle Mods", StringComparison.Ordinal));
                allOff.RaiseEvent(new RoutedEventArgs(Button.ClickEvent)); ui.SaveCurrent();
                Check(store.Active(ui.Config) == 0 && !ui.Dirty && ui.Drafts[field] == "ungueltiger Entwurf" && ui.InputErrors.ContainsKey(field), "The actual all-mods-off action permits saving without silently deleting an invalid inactive draft");

                ui.ChooseCategory("player"); string preciseKey = "player.adjustStaminaRegen.factor";
                ui.Toggles["player.adjustStaminaRegen"].IsChecked = true;
                ui.Fields[preciseKey].Text = "1.23456789"; ui.SaveCurrent();
                double precise = Json.Number(Mod(ui.Current.Config, "player", "adjustStaminaRegen")["factor"]);
                ui.LoadProfile(alternative); ui.LoadProfile(profile); ui.ChooseCategory("player");
                double shown;
                Check(precise == 1.23456789 && Json.ParseInput(ui.Fields[preciseKey].Text, out shown) && shown == precise && Json.Number(Mod(ui.Config, "player", "adjustStaminaRegen")["factor"]) == precise, "A saved factor1.23456789 remains numerically identical in the model and visible text after a full profile roundtrip");

                ui.ChooseCategory("inventory"); ui.Toggles[key].IsChecked = true; ui.Fields[field].Text = "Entwurf bleibt erhalten"; ui.Toggles[key].IsChecked = false; ui.SaveCurrent();
                var previous = ui.Current; string configBefore = Json.Encode(ui.Config), lastBefore = store.LastId;
                var draftsBefore = new Dictionary<string, string>(ui.Drafts); var errorsBefore = new Dictionary<string, string>(ui.InputErrors);
                string selectionFile = Path.Combine(store.DataRoot, "ui.json"), selectionBefore = File.ReadAllText(selectionFile);
                using (var exclusive = new FileStream(selectionFile, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
                    ui.Find<ComboBox>("Profiles").SelectedItem = alternative;
                Check(ui.Current == previous && ui.Find<ComboBox>("Profiles").SelectedItem == previous && Json.Encode(ui.Config) == configBefore && store.LastId == lastBefore && !ui.Dirty && !string.IsNullOrWhiteSpace(ui.ProfileLoadError) && ui.Drafts.Count == draftsBefore.Count && draftsBefore.All(p => ui.Drafts.ContainsKey(p.Key) && ui.Drafts[p.Key] == p.Value) && ui.InputErrors.Count == errorsBefore.Count && errorsBefore.All(p => ui.InputErrors.ContainsKey(p.Key) && ui.InputErrors[p.Key] == p.Value) && File.ReadAllText(selectionFile) == selectionBefore, "A locked selection file makes the real profile dropdown roll back Current, model, drafts, errors and selection without throwing");
                ui.Find<ComboBox>("Profiles").SelectedItem = alternative;
                Check(ui.Current == alternative && ui.Find<ComboBox>("Profiles").SelectedItem == alternative && store.LastId == alternative.Id && string.IsNullOrEmpty(ui.ProfileLoadError) && ui.Drafts.Count == 0 && ui.InputErrors.Count == 0, "The same dropdown switch succeeds after releasing ui.json and clears the previous load error");

                ui.Window.Show(); ui.Window.UpdateLayout(); ui.Window.WindowState = WindowState.Normal; ui.FitWindowToWorkArea(new Rect(0, 0, 1280, 680)); ui.Window.UpdateLayout();
                Check(ui.Window.Width >= 1000 && ui.Window.Width <= 1280 && ui.Window.Height >= 640 && ui.Window.Height <= 680 && ui.Window.MinWidth == 1000 && ui.Window.MinHeight == 640 && ui.Window.Left >= 0 && ui.Window.Top >= 0 && ui.Window.Left + ui.Window.Width <= 1280.5 && ui.Window.Top + ui.Window.Height <= 680.5, "A1280x680DIP work area contains the whole window while retaining the fitting1000x640 minimum");
                ui.Window.Width = 1000; ui.Window.Height = 680; ui.LoadProfile(profile); ui.ChooseCategory("inventory");
                ui.Toggles[key].IsChecked = true; ui.Fields[field].Text = "ungueltig";
                try { ui.SaveCurrent(); } catch (InvalidDataException) { }
                ui.Window.Show(); ui.Window.UpdateLayout();
                var firstInput = ui.Fields[field]; firstInput.BringIntoView(); firstInput.Focus(); ui.Window.UpdateLayout();
                ui.Screenshot(Path.Combine(Path.GetDirectoryName(report), "tested-compact-1000x680.png"));
                var scroll = ui.Find<ScrollViewer>("OptionsScroll");
                Rect inputRect = firstInput.TransformToAncestor(scroll).TransformBounds(new Rect(0, 0, firstInput.ActualWidth, firstInput.ActualHeight));
                Check(scroll.ViewportHeight >= firstInput.ActualHeight && firstInput.ActualHeight > 0 && inputRect.Top >= -1 && inputRect.Bottom <= scroll.ActualHeight + 1 && ui.Find<Button>("LaunchPatcher").ActualWidth > 100, "At1000x680DIP the flagged numeric field can be revealed fully and the main patch action remains available in the layout");
                var invalidBrush = firstInput.BorderBrush as SolidColorBrush;
                Check(invalidBrush != null && invalidBrush.Color.R > invalidBrush.Color.G + 30 && invalidBrush.Color.R > invalidBrush.Color.B + 30 && (!ui.Window.IsActive || firstInput.IsKeyboardFocusWithin), "The compact invalid field retains its red state and receives keyboard focus when the test window is active");
            }
            finally
            {
                ui.LoadProfile(originalProfile);
                ui.Window.MaxWidth = oldMaxWidth; ui.Window.MaxHeight = oldMaxHeight; ui.Window.MinWidth = oldMinWidth; ui.Window.MinHeight = oldMinHeight;
                ui.Window.Width = oldWidth; ui.Window.Height = oldHeight; ui.Window.Left = oldLeft; ui.Window.Top = oldTop;
            }
        }
        private static void ExerciseSummonPrototype(StudioWindow ui, StudioStore store, string sandbox, string report)
        {
            string key = "world.adjustSummonedCompanions";
            var previous = ui.Current; string server = Path.Combine(sandbox, "summon-server"), client = Path.Combine(sandbox, "summon-client"), mixed = Path.Combine(sandbox, "summon-mixed"), unknown = Path.Combine(sandbox, "summon-unknown");
            Directory.CreateDirectory(server); Directory.CreateDirectory(client); Directory.CreateDirectory(mixed); Directory.CreateDirectory(unknown);
            foreach (string suffix in new[] { ".exe", ".kfc", ".kfc_resources" })
            {
                File.WriteAllText(Path.Combine(server, "enshrouded_server" + suffix), "HARMLESS SERVER FIXTURE"); File.WriteAllText(Path.Combine(client, "enshrouded" + suffix), "HARMLESS CLIENT FIXTURE");
                File.WriteAllText(Path.Combine(mixed, "enshrouded_server" + suffix), "HARMLESS SERVER FIXTURE"); File.WriteAllText(Path.Combine(mixed, "enshrouded" + suffix), "HARMLESS CLIENT FIXTURE");
            }
            var baseline = store.Baseline(); baseline["gameDirectory"] = ""; baseline["singleplayerUnknown"] = 73;
            var profile = store.NewProfile("Lokaler Test Beschwörungen", baseline);
            Func<string> roleHint = delegate { return LogicalDescendants(ui.Find<StackPanel>("OptionsPanel")).OfType<TextBlock>().Single(text => Convert.ToString(text.Tag) == key + ".TargetRoleHint").Text; };
            try
            {
                ui.LoadProfile(profile); ui.ChooseCategory("world");
                Check(!ui.Toggles[key].IsEnabled && !ui.Toggles[key].IsChecked.Value && !ui.ChoiceFields[key + ".companionVariant"].IsEnabled, "Summon prototype cannot be activated for an unknown target");
                ui.Find<TextBox>("GamePath").Text = client;
                Check(ui.Toggles[key].IsEnabled && !ui.Fields[key + ".maxCompanions"].IsEnabled && !ui.ChoiceFields[key + ".companionVariant"].IsEnabled && ui.Find<Button>("LaunchPatcher").IsEnabled && store.RestrictedTargetError(ui.Config) == null, "Recognized Steam client unlocks the singleplayer summon switch while inactive fields remain disabled");
                Check(roleHint().Contains("Singleplayer-Test: lokaler Spielordner") && !roleHint().Contains("Dedicated Server erkannt"), "Client role hint explicitly describes the unverified local singleplayer test");
                ui.Toggles[key].IsChecked = true;
                Check(ui.Fields[key + ".maxCompanions"].IsEnabled && ui.ChoiceFields[key + ".companionVariant"].IsEnabled && ui.Find<Button>("LaunchPatcher").IsEnabled && store.RestrictedTargetError(ui.Config) == null, "A singleplayer summon prototype can be activated and edited without blocking the recognized client patch action");
                ui.Fields[key + ".maxCompanions"].Text = "6"; ui.Fields[key + ".durationSeconds"].Text = "180"; ui.Fields[key + ".strengthFactor"].Text = "2";
                ui.ChoiceFields[key + ".companionVariant"].SelectedValue = 2L; ui.SaveCurrent();
                var saved = Mod(profile.Config, "world", "adjustSummonedCompanions");
                Check((bool)saved["enabled"] && Json.Number(saved["maxCompanions"]) == 6 && Json.Number(saved["durationSeconds"]) == 180 && Json.Number(saved["strengthFactor"]) == 2 && Json.Number(saved["companionVariant"]) == 2 && store.RestrictedTargetError(ui.Config) == null, "Singleplayer prototype saves absolute limit, seconds, strength and numeric elite variant independently");
                var reloaded = new StudioStore(store.AppRoot, store.DataRoot); reloaded.Load();
                var persisted = reloaded.Profiles.Single(item => item.Id == profile.Id);
                Check(reloaded.LoadErrors.Count == 0 && (string)persisted.Config["gameDirectory"] == client && (bool)Mod(persisted.Config, "world", "adjustSummonedCompanions")["enabled"] && Json.Number(Mod(persisted.Config, "world", "adjustSummonedCompanions")["companionVariant"]) == 2 && Json.Number(persisted.Config["singleplayerUnknown"]) == 73, "A saved active singleplayer profile reloads from disk with its target, variant, identity and unknown settings intact");
                ui.LoadProfile(profile); ui.ChooseCategory("world");
                Check(Json.Number(ui.ChoiceFields[key + ".companionVariant"].SelectedValue) == 2 && ((FieldChoiceDef)ui.ChoiceFields[key + ".companionVariant"].SelectedItem).Label == "Eliteskelett", "Named summon variant survives a full profile roundtrip as numeric value2");
                for (long variant = 0; variant <= 3; variant++)
                {
                    ui.ChoiceFields[key + ".companionVariant"].SelectedValue = variant; ui.SaveCurrent(); ui.LoadProfile(profile); ui.ChooseCategory("world");
                    Check(Json.Number(Mod(profile.Config, "world", "adjustSummonedCompanions")["companionVariant"]) == variant && Json.Number(ui.ChoiceFields[key + ".companionVariant"].SelectedValue) == variant && (bool)Mod(profile.Config, "world", "adjustSummonedCompanions")["enabled"] && (string)profile.Config["gameDirectory"] == client, "Singleplayer profile retains exact numeric summon variant " + variant + " through save, normalize and reload");
                }
                Check(((FieldChoiceDef)ui.ChoiceFields[key + ".companionVariant"].SelectedItem).Label == "Im Spiel per Zauber wählen", "In-game spell selection keeps its existing label on the singleplayer profile");
                ui.Find<TextBox>("GamePath").Text = server;
                Check(ui.Toggles[key].IsEnabled && ui.Toggles[key].IsChecked == true && ui.Fields[key + ".maxCompanions"].IsEnabled && ui.ChoiceFields[key + ".companionVariant"].IsEnabled && ui.Find<Button>("LaunchPatcher").IsEnabled && store.RestrictedTargetError(ui.Config) == null, "Changing an active singleplayer profile to a recognized dedicated server keeps the option and patch action enabled");
                Check(roleHint().Contains("Dedicated Server erkannt") && roleHint().Contains("Multiplayer") && !roleHint().Contains("Singleplayer-Test"), "Server role hint refreshes immediately and preserves the unverified multiplayer limitation");
                ui.Find<TextBox>("GamePath").Text = client;
                Check(ui.Fields[key + ".maxCompanions"].IsEnabled && ui.Find<Button>("LaunchPatcher").IsEnabled && roleHint().Contains("Singleplayer-Test"), "Switching back to the client refreshes enabled controls and the singleplayer hint without rebuilding the card");
                ui.Find<TextBox>("GamePath").Text = unknown;
                Check(ui.Toggles[key].IsEnabled && ui.Toggles[key].IsChecked == true && !ui.Fields[key + ".maxCompanions"].IsEnabled && !ui.ChoiceFields[key + ".companionVariant"].IsEnabled && !ui.Find<Button>("LaunchPatcher").IsEnabled && store.RestrictedTargetError(ui.Config) != null, "An active summon profile blocks editing and patching on an unknown target while keeping its off-switch available");
                ui.SaveCurrent();
                Check(store.Validate(profile.Config).Count == 0 && (bool)Mod(profile.Config, "world", "adjustSummonedCompanions")["enabled"], "An active restricted profile remains locally saveable on an unknown target without losing its settings");
                ui.Find<TextBox>("Search").Text = "adjustSummonedCompanions"; ui.Screenshot(Path.Combine(Path.GetDirectoryName(report), "tested-summons-unknown-blocked.png"));
                ui.Toggles[key].IsChecked = false;
                Check(!ui.Toggles[key].IsEnabled && !ui.Find<Button>("LaunchPatcher").IsEnabled && store.RestrictedTargetError(ui.Config) == null, "Turning the prototype off clears its role error but does not permit an incomplete target or reactivation there");
                ui.Find<TextBox>("GamePath").Text = client; ui.Toggles[key].IsChecked = true;
                ui.Find<TextBox>("GamePath").Text = mixed;
                Check(ui.Toggles[key].IsEnabled && ui.Toggles[key].IsChecked == true && !ui.ChoiceFields[key + ".companionVariant"].IsEnabled && !ui.Find<Button>("LaunchPatcher").IsEnabled && store.RestrictedTargetError(ui.Config) != null && roleHint().Contains("gemischte"), "A mixed client/server folder blocks the active prototype and refreshes its hint while preserving the off-switch");
                ui.Toggles[key].IsChecked = false;
                Check(!ui.Toggles[key].IsEnabled && store.RestrictedTargetError(ui.Config) == null, "A disabled prototype cannot be reactivated on a mixed client/server target");
                var serverOnly = new ModDef { ServerOnly = true };
                Check(StudioStore.AllowsTarget(serverOnly, "Dedicated Server erkannt") && !StudioStore.AllowsTarget(serverOnly, "Steam-Client erkannt") && !StudioStore.AllowsTarget(serverOnly, "Spielordner auswählen.") && !StudioStore.AllowsTarget(new ModDef { ServerOnly = true, KnownTargetOnly = true }, "Steam-Client erkannt"), "The shared target gate retains the stronger legacy ServerOnly restriction including when both flags are present");
                ui.Find<TextBox>("GamePath").Text = server; ui.Toggles[key].IsChecked = true;
                ui.Fields[key + ".maxCompanions"].Text = "9"; bool rejected = false; try { ui.SaveCurrent(); } catch (InvalidDataException) { rejected = true; }
                Check(rejected, "Summon base-limit above8 is rejected before a profile save or any patch process");
                ui.Fields[key + ".maxCompanions"].Text = "4"; ui.Fields[key + ".durationSeconds"].Text = "120"; ui.Fields[key + ".strengthFactor"].Text = "1"; ui.ChoiceFields[key + ".companionVariant"].SelectedValue = 0L;
                ui.SaveCurrent(); ui.Screenshot(Path.Combine(Path.GetDirectoryName(report), "tested-summons-server.png"));
                ui.Find<TextBox>("GamePath").Text = client; ui.SaveCurrent();
                ui.Screenshot(Path.Combine(Path.GetDirectoryName(report), "tested-summons-singleplayer.png"));
                ui.ChoiceFields[key + ".companionVariant"].ApplyTemplate(); ui.Window.UpdateLayout();
                var combo = ui.ChoiceFields[key + ".companionVariant"];
                Check(combo.ActualWidth == 190 && combo.ActualHeight >= 38 && ((FieldChoiceDef)combo.SelectedItem).Label == "Zauberskelett (Original)", "Original summon label uses the bounded wrapping dropdown rather than an unexplained number or clipped fixed-height field");
                combo.SelectedValue = 3L; ui.Window.UpdateLayout();
                Check(combo.ActualWidth == 190 && combo.ActualHeight >= 38 && ((FieldChoiceDef)combo.SelectedItem).Label == "Im Spiel per Zauber wählen", "In-game selection remains inside the same wrapping dropdown width");
                combo.BringIntoView(); ui.Window.UpdateLayout();
                ui.Screenshot(Path.Combine(Path.GetDirectoryName(report), "tested-summons-ingame-selection.png"));
            }
            finally { ui.Find<TextBox>("Search").Clear(); ui.LoadProfile(previous); }
        }
        private static void ExerciseOwnSkeletonSpells(StudioWindow ui, StudioStore store, string sandbox, string report)
        {
            const string key = "world.enableSkeletonSummoningSpells";
            var previous = ui.Current;
            string client = Path.Combine(sandbox, "own-spells-client"), server = Path.Combine(sandbox, "own-spells-server");
            Directory.CreateDirectory(client); Directory.CreateDirectory(server);
            foreach (string name in new[] { "enshrouded.exe", "enshrouded.kfc", "enshrouded.kfc_resources" }) File.WriteAllText(Path.Combine(client, name), "UI fixture");
            foreach (string name in new[] { "enshrouded_server.exe", "enshrouded_server.kfc", "enshrouded_server.kfc_resources" }) File.WriteAllText(Path.Combine(server, name), "UI fixture");
            try
            {
                var config = store.Baseline(); config["gameDirectory"] = client;
                var profile = store.NewProfile("Eigene Skelettzauber Test", config);
                ui.LoadProfile(profile); ui.ChooseCategory("world");
                Check(ui.Toggles[key].IsEnabled && !ui.Fields[key + ".durationSeconds"].IsEnabled, "Own skeleton spells can be enabled on a complete singleplayer client while inactive values stay disabled");
                ui.Toggles[key].IsChecked = true;
                ui.Fields[key + ".maxCompanions"].Text = "5"; ui.Fields[key + ".durationSeconds"].Text = "180"; ui.Fields[key + ".strengthFactor"].Text = "2";
                ui.SaveCurrent(); ui.LoadProfile(profile); ui.ChooseCategory("world");
                var values = Mod(profile.Config, "world", "enableSkeletonSummoningSpells");
                Check((bool)values["enabled"] && Json.Number(values["maxCompanions"]) == 5 && Json.Number(values["durationSeconds"]) == 180 && Json.Number(values["strengthFactor"]) == 2 && ui.Find<Button>("LaunchPatcher").IsEnabled, "Own spell settings survive profile save and reload and allow client patching");
                ui.Find<TextBox>("Search").Text = "enableSkeletonSummoningSpells";
                ui.Screenshot(Path.Combine(Path.GetDirectoryName(report), "tested-own-skeleton-spells.png"));
                ui.Find<TextBox>("GamePath").Text = server;
                Check(ui.Toggles[key].IsEnabled && ui.Toggles[key].IsChecked == true && ui.Fields[key + ".maxCompanions"].IsEnabled && ui.Find<Button>("LaunchPatcher").IsEnabled && store.RestrictedTargetError(ui.Config) == null, "Own spell prototypes allow editing and patching a recognized dedicated server");
                ui.Toggles[key].IsChecked = false;
                Check(ui.Toggles[key].IsEnabled && ui.Find<Button>("LaunchPatcher").IsEnabled, "Disabled own spells allow ordinary server patching and remain available for reactivation there");
                ui.Find<TextBox>("GamePath").Text = client; ui.Toggles[key].IsChecked = true;
                Mod(ui.Config, "world", "adjustSummonedCompanions")["enabled"] = true;
                Check(store.Validate(ui.Config).Any(error => error.Contains("nicht gleichzeitig")), "Legacy and own-skeleton modes conflict explicitly before a patch launch");
                Mod(ui.Config, "world", "adjustSummonedCompanions")["enabled"] = false;
                var clientOnly = new ModDef { ClientOnly = true, KnownTargetOnly = true };
                Check(StudioStore.AllowsTarget(clientOnly, "Steam-Client erkannt") && !StudioStore.AllowsTarget(clientOnly, "Dedicated Server erkannt") && !StudioStore.AllowsTarget(clientOnly, "Spielordner auswählen.") && !StudioStore.AllowsTarget(new ModDef { ClientOnly = true, ServerOnly = true }, "Steam-Client erkannt"), "ClientOnly accepts exactly the known singleplayer client and rejects contradictory target flags");
            }
            finally { ui.Find<TextBox>("Search").Clear(); ui.LoadProfile(previous); }
        }
        private static void ExerciseLayoutRegressions(StudioWindow ui, StudioStore store)
        {
            var scroll = ui.Find<ScrollViewer>("OptionsScroll");
            foreach (var category in store.Schema.Where(c => c.Mods.Count > 0))
            {
                ui.ChooseCategory(category.Key); ui.Window.UpdateLayout();
                var numericControls = ui.Fields.Values.Cast<Control>().Concat(ui.ChoiceFields.Values.Cast<Control>()).ToList();
                Check(ui.Toggles.Count == category.Mods.Count && numericControls.Count == category.Mods.Sum(m => m.Fields.Count(f => !f.Boolean)) && numericControls.All(f => { Rect r = f.TransformToAncestor(scroll).TransformBounds(new Rect(0, 0, f.ActualWidth, f.ActualHeight)); return f.ActualWidth > 0 && r.Left >= 0 && r.Right <= scroll.ActualWidth; }), "All switches, numeric fields and variant choices fit the visible width in category " + category.Key);
            }
            ui.ChooseCategory("inventory"); scroll.ScrollToVerticalOffset(200); ui.Window.UpdateLayout();
            ui.Find<TextBox>("Search").Text = "adjustStackSize"; ui.Window.UpdateLayout();
            Check(scroll.VerticalOffset == 0 && ui.Find<Button>("ClearSearch").Visibility == Visibility.Visible && ui.Toggles.Count == 1, "A new search starts at the first result and exposes the clear action");
            ui.Find<TextBox>("Search").Text = "KEIN-TREFFER-UI-TEST"; ui.Window.UpdateLayout();
            var reset = LogicalDescendants(ui.Find<StackPanel>("OptionsPanel")).OfType<Button>().First(b => Convert.ToString(b.Content) == "Suche und Filter zurücksetzen");
            ui.Find<CheckBox>("OnlyActive").IsChecked = true;
            reset = LogicalDescendants(ui.Find<StackPanel>("OptionsPanel")).OfType<Button>().First(b => Convert.ToString(b.Content) == "Suche und Filter zurücksetzen");
            reset.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
            Check(ui.Find<TextBox>("Search").Text == "" && ui.Find<CheckBox>("OnlyActive").IsChecked == false && ui.Toggles.Count == store.Schema.First(c => c.Key == "inventory").Mods.Count, "The empty-state reset restores the category and both filters");
        }
        private static Dictionary<string, object> StackFixture(string target, bool server = false, bool all = false, bool enabled = true)
        {
            string prefix = server ? "enshrouded_server" : "enshrouded";
            return new Dictionary<string, object> {
                { "stage", "complete" }, { "message", "Archivdaten gelesen" }, { "progress", 100 }, { "outcome", "success" },
                { "result", new Dictionary<string, object> {
                    { "operation", "inspect-stacks" }, { "targetDir", target }, { "targetId", new string('a', 20) }, { "targetRole", server ? "server" : "client" },
                    { "build", "1273043|fixture" }, { "requested", 65000 }, { "enabled", enabled },
                    { "currentFingerprint", new Dictionary<string, object> { { "exe", new string('b', 64) }, { "archives", new Dictionary<string, object> { { prefix + ".kfc", new string('c', 64) }, { prefix + ".kfc_resources", new string('d', 64) } } } } },
                    { "stackableCount", 3 }, { "singletonCount", 4 }, { "matchingRequested", all ? 3 : 0 }, { "allMatch", all },
                    { "distribution", all ? new object[] { new Dictionary<string, object> { { "value", 65000 }, { "count", 3 } } } : new object[] { new Dictionary<string, object> { { "value", 250 }, { "count", 2 } }, new Dictionary<string, object> { { "value", 50 }, { "count", 1 } } } },
                    { "samples", new object[] { new Dictionary<string, object> { { "name", "Material_Wood" }, { "guid", "11111111-2222-3333-4444-555555555555" }, { "value", all ? 65000 : 250 } } } },
                    { "warnings", new string[] { "Archivprüfung; Spieltest offen." } }
                } }
            };
        }
        private static bool RejectStackFixture(string file, string target, Action<Dictionary<string, object>> mutate)
        {
            var document = StackFixture(target); mutate(Json.Object(document["result"], "result")); Json.Write(file, document, null);
            try { StackStatus.Read(file, target, 65000, true); return false; } catch (InvalidDataException) { return true; }
        }
        private static void ExerciseStackContracts(StudioStore store, Dictionary<string, object> config, string sandbox)
        {
            string statusFile = Path.Combine(sandbox, "stack status with spaces.json"), target = (string)config["gameDirectory"];
            var info = store.StackInspectionLaunchInfo(statusFile);
            Check(info.Arguments == "\"" + Path.Combine(store.AppRoot, "engine", "studio-runner.js") + "\" --inspect-stacks --status-file \"" + Path.GetFullPath(statusFile) + "\"" &&
                !info.UseShellExecute && info.CreateNoWindow && info.RedirectStandardOutput && info.RedirectStandardError && info.StandardOutputEncoding.CodePage == 65001 && info.StandardErrorEncoding.CodePage == 65001 && info.EnvironmentVariables["PKG_EXECPATH"] == "PKG_INVOKE_NODEJS",
                "Stack inspection quotes its exact status path, uses inspect-stacks only, and captures both UTF-8 streams without a console");
            string before = File.ReadAllText(Path.Combine(store.AppRoot, "engine", "config.json"));
            var invalid = Json.Clone(config); invalid["gameDirectory"] = Path.Combine(sandbox, "missing-stack-target"); bool rejected = false;
            try { using (var process = store.LaunchStackInspection(invalid, statusFile)) { if (process != null) process.WaitForExit(5000); } } catch (InvalidDataException) { rejected = true; }
            Check(rejected && File.ReadAllText(Path.Combine(store.AppRoot, "engine", "config.json")) == before && !File.Exists(statusFile), "Invalid stack target is rejected before profile export or process launch");
            Json.Write(statusFile, StackFixture(target), null); var mismatch = StackStatus.Read(statusFile, target + Path.DirectorySeparatorChar, 65000, true);
            Check(mismatch.StackableCount == 3 && mismatch.SingletonCount == 4 && mismatch.MatchingRequested == 0 && !mismatch.AllMatch && mismatch.Distribution.Sum(row => row.Count) == 3 && mismatch.Samples.Count == 1 && mismatch.GetFriendlyMessage().Contains("weichen"), "Stack mismatch preserves actual archive counts, distribution and samples without claiming game functionality");
            Json.Write(statusFile, StackFixture(target, true, true), null); var server = StackStatus.Read(statusFile, target.ToUpperInvariant(), 65000, true);
            Check(server.AllMatch && server.TargetRole == "server" && server.MatchingRequested == 3 && server.GetFriendlyMessage().Contains("Archivwert"), "Server stack result accepts only the role-matched archive pair and confirms archive values");
            Json.Write(statusFile, StackFixture(target, false, false, false), null); var disabled = StackStatus.Read(statusFile, target, 65000, false);
            Check(!disabled.Enabled && disabled.GetFriendlyMessage().Contains("ausgeschaltet") && !disabled.GetFriendlyMessage().Contains("weichen"), "Disabled stack option reports comparison data without treating the configured value as an applied expectation");
            Json.Write(statusFile, StackFixture(target), null);
            int bindingRejected = 0;
            try { StackStatus.Read(statusFile, Path.Combine(target, "other"), 65000, true); } catch (InvalidDataException) { bindingRejected++; }
            try { StackStatus.Read(statusFile, target, 64000, true); } catch (InvalidDataException) { bindingRejected++; }
            try { StackStatus.Read(statusFile, target, 65000, false); } catch (InvalidDataException) { bindingRejected++; }
            Check(bindingRejected == 3, "Stack payload is bound to the selected target, requested value and enabled state");
            var invalidMutations = new List<Action<Dictionary<string, object>>> {
                row => row["operation"] = "update", row => row["targetRole"] = "host", row => row["targetId"] = "wrong", row => row["build"] = "fixture-without-revision",
                row => row["requested"] = 1, row => row["requested"] = 65536, row => row["requested"] = 2.5, row => row["requested"] = "65000", row => row["enabled"] = 1,
                row => row["stackableCount"] = 0, row => row["stackableCount"] = -1, row => row["stackableCount"] = true, row => row["singletonCount"] = -1,
                row => row["matchingRequested"] = 4, row => row["allMatch"] = true,
                row => row["distribution"] = new object[0], row => row["distribution"] = new Dictionary<string, object>(),
                row => row["distribution"] = new object[] { new Dictionary<string, object> { { "value", 250 }, { "count", 3 } }, new Dictionary<string, object> { { "value", 250 }, { "count", 1 } } },
                row => row["distribution"] = new object[] { new Dictionary<string, object> { { "value", 1 }, { "count", 3 } } },
                row => row["distribution"] = new object[] { new Dictionary<string, object> { { "value", 65000 }, { "count", 3 } } },
                row => row["samples"] = new object[0], row => row["samples"] = new object[] { new Dictionary<string, object> { { "name", "Wood" }, { "guid", "wrong" }, { "value", 250 } } },
                row => row["samples"] = new object[] { new Dictionary<string, object> { { "name", "Wood" }, { "guid", "11111111-2222-3333-4444-555555555555" }, { "value", 999 } } },
                row => row["warnings"] = new object[] { true }, row => row.Remove("warnings"),
                row => Json.Object(row["currentFingerprint"], "fingerprint")["exe"] = new string('g', 64),
                row => Json.Object(row["currentFingerprint"], "fingerprint")["archives"] = new Dictionary<string, object> { { "enshrouded_server.kfc", new string('a', 64) }, { "enshrouded_server.kfc_resources", new string('b', 64) } }
            };
            int malformed = invalidMutations.Count(mutation => RejectStackFixture(statusFile, target, mutation));
            Check(malformed == invalidMutations.Count, "Stack payload rejects all " + malformed + " malformed operation, role, hash, uint16, count, distribution, sample and warning cases");
            Json.Write(statusFile, StackFixture(target), null);
            Check(PatchProgress.Succeeded(0, PatchProgress.Read(statusFile)) && !PatchProgress.UpdateSucceeded(0, PatchProgress.Read(statusFile)) && !PatchProgress.Succeeded(1, PatchProgress.Read(statusFile)), "A confirmed stack inspection can never impersonate an applied game update or survive a failing process exit");
        }
        private static void ExerciseBasisContracts(StudioStore store, Dictionary<string, object> config, string sandbox)
        {
            string statusFile = Path.Combine(sandbox, "basis status with spaces.json");
            string runner = Path.Combine(store.AppRoot, "engine", "studio-runner.js");
            string expectedStatus = " --status-file \"" + Path.GetFullPath(statusFile) + "\"";
            var inspect = store.BasisLaunchInfo(statusFile, false, null);
            Check(inspect.Arguments == "\"" + runner + "\" --inspect-basis" + expectedStatus,
                "Basis inspection passes only the inspect operation and exactly quoted status path with spaces");
            string token = new string('a', 64);
            var renew = store.BasisLaunchInfo(statusFile, true, token);
            Check(renew.Arguments == "\"" + runner + "\" --renew-basis --expected-fingerprint " + token + " --steam-files-verified" + expectedStatus,
                "Basis renewal passes the exact fingerprint and explicit verified-files confirmation");
            Check(new[] { inspect, renew }.All(info => !info.UseShellExecute && info.CreateNoWindow && info.RedirectStandardOutput && info.RedirectStandardError &&
                info.StandardOutputEncoding != null && info.StandardOutputEncoding.CodePage == 65001 && info.StandardErrorEncoding != null && info.StandardErrorEncoding.CodePage == 65001 &&
                info.EnvironmentVariables["PKG_EXECPATH"] == "PKG_INVOKE_NODEJS"),
                "Both basis operations are hidden, redirect stdout and stderr as UTF-8 and use the isolated Node runtime");
            Check(store.BasisLaunchInfo(statusFile, true, new string('A', 64)).Arguments.Contains(" --expected-fingerprint " + new string('A', 64) + " "),
                "A valid uppercase 64-digit fingerprint is accepted without changing its content");
            int invalidTokensRejected = 0;
            foreach (string invalidToken in new[] { null, "", new string('a', 63), new string('a', 65), new string('g', 64), new string('a', 63) + " ", new string('a', 63) + "\n", new string('a', 64) + " --inspect-basis" })
            {
                try { store.BasisLaunchInfo(statusFile, true, invalidToken); }
                catch (InvalidDataException) { invalidTokensRejected++; }
            }
            Check(invalidTokensRejected == 8, "Renewal rejects missing, short, long, nonhex, whitespace and argument-injection fingerprints");

            string engineConfig = Path.Combine(store.AppRoot, "engine", "config.json");
            string beforeConfig = File.ReadAllText(engineConfig);
            string receivedPath = Path.Combine(store.AppRoot, "engine", "received-status-path.txt");
            bool markerExisted = File.Exists(receivedPath);
            string beforeMarker = markerExisted ? File.ReadAllText(receivedPath) : null;
            string invalidRoot = Path.Combine(sandbox, "basis-invalid-targets"); Directory.CreateDirectory(invalidRoot);
            string incomplete = Path.Combine(invalidRoot, "incomplete"); Directory.CreateDirectory(incomplete);
            File.WriteAllText(Path.Combine(incomplete, "enshrouded.exe"), "TEST PLACEHOLDER");
            string mixed = Path.Combine(invalidRoot, "mixed"); Directory.CreateDirectory(mixed);
            foreach (string prefix in new[] { "enshrouded", "enshrouded_server" })
                foreach (string extension in new[] { ".exe", ".kfc", ".kfc_resources" })
                    File.WriteAllText(Path.Combine(mixed, prefix + extension), "TEST PLACEHOLDER");
            int targetsRejected = 0;
            foreach (string invalidTarget in new[] { "", Path.Combine(invalidRoot, "missing"), incomplete, mixed })
                foreach (bool renewal in new[] { false, true })
                {
                    var invalidConfig = Json.Clone(config); invalidConfig["gameDirectory"] = invalidTarget;
                    try
                    {
                        using (var unexpectedProcess = store.LaunchBasisOperation(invalidConfig, statusFile, renewal, renewal ? token : null))
                        { if (unexpectedProcess != null) unexpectedProcess.WaitForExit(5000); }
                    }
                    catch (InvalidDataException) { targetsRejected++; }
                }
            Check(targetsRejected == 8 && File.ReadAllText(engineConfig) == beforeConfig && File.Exists(receivedPath) == markerExisted &&
                (!markerExisted || File.ReadAllText(receivedPath) == beforeMarker) && !File.Exists(statusFile),
                "Basis launch rejects empty, missing, incomplete and mixed targets before export or child-process handoff");

            string progressFile = Path.Combine(sandbox, "basis-action-progress.json");
            Json.Write(progressFile, new Dictionary<string, object> {
                { "stage", "error" }, { "message", "Spielupdate erkannt" }, { "progress", 100 }, { "outcome", "error" },
                { "actionCode", "TOP_LEVEL_MUST_NOT_OVERRIDE_RESULT" }, { "reason", "unrelated" },
                { "result", new Dictionary<string, object> {
                    { "actionCode", "basis_version_changed" }, { "reason", "Die Spielversion gehört zu einer anderen Basis." },
                    { "warnings", new string[] { "Die bisherige Basis bleibt erhalten." } }
                } }
            }, null);
            var actionable = PatchProgress.Read(progressFile);
            Check(actionable.ActionCode == "basis_version_changed" && actionable.Reason == "Die Spielversion gehört zu einer anderen Basis." &&
                actionable.Warnings.SequenceEqual(new[] { "Die bisherige Basis bleibt erhalten." }),
                "Patch progress reads action code, German reason and warnings from the nested result contract");
            Check(!PatchProgress.Succeeded(0, actionable) && !PatchProgress.Succeeded(1, actionable),
                "An actionable basis-change error never becomes success even at 100 percent or exit zero");
            Json.Write(progressFile, new Dictionary<string, object> {
                { "stage", "done" }, { "message", "Fertig" }, { "progress", 100 }, { "outcome", "success" },
                { "result", new Dictionary<string, object> { { "actionCode", 42 }, { "reason", true } } }
            }, null);
            var optionalMetadata = PatchProgress.Read(progressFile);
            Check(optionalMetadata.ActionCode == null && optionalMetadata.Reason == null,
                "Optional action metadata with nontext values is not converted into misleading action or reason strings");
            int successCases = 0;
            foreach (string outcome in new[] { "running", "error", "success" })
                foreach (int exitCode in new[] { 0, 1, -1 })
                    if (PatchProgress.Succeeded(exitCode, new PatchProgress { Outcome = outcome, Stage = "done", Progress = 100 })) successCases++;
            Check(successCases == 1 && PatchProgress.Succeeded(0, optionalMetadata) && !PatchProgress.Succeeded(0, null),
                "Original success guard requires exactly exit zero plus explicit success outcome across all process and status combinations");
            Check(!PatchProgress.Succeeded(0, new PatchProgress { Outcome = "success", Stage = "modify", Progress = 40 }) &&
                !PatchProgress.Succeeded(0, new PatchProgress { Outcome = "success", Stage = "complete", Progress = 99 }) &&
                !PatchProgress.Succeeded(0, new PatchProgress { Outcome = "success", Stage = "error", Progress = 100 }),
                "Intermediate, incomplete and error stages cannot impersonate a final success report");
            Check(!PatchProgress.UpdateSucceeded(0, optionalMetadata) &&
                !PatchProgress.UpdateSucceeded(0, new PatchProgress { Outcome = "success", Stage = "complete", Progress = 100, Operation = "inspect-basis", Applied = true }) &&
                !PatchProgress.UpdateSucceeded(0, new PatchProgress { Outcome = "success", Stage = "complete", Progress = 100, Operation = "update", Applied = false }) &&
                PatchProgress.UpdateSucceeded(0, new PatchProgress { Outcome = "success", Stage = "complete", Progress = 100, Operation = "update", Applied = true }),
                "Game update success additionally requires the exact update operation and explicit applied confirmation");
        }
        private static void ExerciseAutomaticUpdate(StudioWindow ui, string fakeRoot, string game, bool failure, bool missingStatus, bool basisMismatch = false)
        {
            string engine = Path.Combine(fakeRoot, "engine"), errorMarker = Path.Combine(engine, "stub-error.marker"), missingMarker = Path.Combine(engine, "stub-no-status.marker");
            if (failure) File.WriteAllText(errorMarker, "fixture"); else if (File.Exists(errorMarker)) File.Delete(errorMarker);
            if (missingStatus) File.WriteAllText(missingMarker, "fixture"); else if (File.Exists(missingMarker)) File.Delete(missingMarker);
            var processField = typeof(StudioWindow).GetField("engineProcess", BindingFlags.Instance | BindingFlags.NonPublic);
            var statusField = typeof(StudioWindow).GetField("patchStatusFile", BindingFlags.Instance | BindingFlags.NonPublic);
            var finish = typeof(StudioWindow).GetMethod("FinishUpdate", BindingFlags.Instance | BindingFlags.NonPublic);
            Check(processField != null && statusField != null && finish != null, "Automatic update test targets the actual process and completion handlers");
            ui.Find<Button>("LaunchPatcher").RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
            var process = processField.GetValue(ui) as Process;
            Check(process != null, "Main update button launches the harmless backend stub");
            try
            {
                Check(!process.HasExited && !ui.Find<ComboBox>("Profiles").IsEnabled && !ui.Find<Button>("SaveProfile").IsEnabled && !ui.Find<Button>("TransferSetup").IsEnabled && !ui.Find<Button>("BrowseGame").IsEnabled && !ui.Find<Button>("LaunchPatcher").IsEnabled, "Profile, folder, transfer and update controls lock while the update process runs");
                if (!process.WaitForExit(10000)) { process.Kill(); throw new Exception("Automatic update stub exceeded its 10 second bound."); }
                int exitCode = process.ExitCode; string expectedStatus = (string)statusField.GetValue(ui);
                Check(File.ReadAllText(Path.Combine(engine, "received-status-path.txt")) == expectedStatus && expectedStatus.StartsWith(Path.Combine(ui.Store.DataRoot, "updates"), StringComparison.OrdinalIgnoreCase), "Actual main-button launch passes the exact status-file path");
                var received = Json.Read(Path.Combine(engine, "received-config.json"));
                Check((string)received["gameDirectory"] == game && received.ContainsKey("inventory") && File.ReadAllText(Path.Combine(engine, "received-update-mode.txt")) == "true", "Automatic launch hands off the complete saved profile and update mode");
                if (basisMismatch) Json.Write(expectedStatus, new Dictionary<string, object> {
                    { "stage", "error" }, { "message", "Spielversion geändert" }, { "progress", 0 }, { "outcome", "error" },
                    { "result", new Dictionary<string, object> { { "actionCode", "basis_required" }, { "reason", "version_changed" } } }
                }, null);
                finish.Invoke(ui, null);
                string status = ui.Find<TextBlock>("SaveStatus").Text, notice = ui.Find<TextBlock>("Notice").Text;
                if (basisMismatch) Check(exitCode == 1 && status == "Neue Patch-Basis erforderlich" && notice.Contains("Steam") && ui.Find<Button>("ChangeBasis").Visibility == Visibility.Visible && ui.Find<Button>("ChangeBasis").IsEnabled, "Version mismatch exposes the direct basis review action and Steam repair guidance without claiming patch success");
                else if (failure) Check(exitCode == 1 && status == "Aktualisierung nicht abgeschlossen" && notice.Contains("STUB_FEHLER") && !status.Contains("angewendet"), "Backend error and exit one produce a clear failure message, never a success label");
                else if (missingStatus) Check(exitCode == 0 && status == "Aktualisierung nicht abgeschlossen" && notice.Contains("keinen bestätigten Abschluss"), "Exit zero without a completion JSON cannot display GUI success");
                else Check(exitCode == 0 && status.Contains("Hinweise beachten") && notice.Contains("STUB_ERFOLG") && notice.Contains("STUB_HINWEIS") && ui.Find<ProgressBar>("PatchProgress").Value == 100, "Confirmed success JSON plus exit zero displays completion, progress and backend warnings");
                Check(ui.Find<ComboBox>("Profiles").IsEnabled && ui.Find<Button>("SaveProfile").IsEnabled && ui.Find<Button>("TransferSetup").IsEnabled && ui.Find<Button>("LaunchPatcher").IsEnabled && processField.GetValue(ui) == null, "Completion unlocks controls and releases the finished process");
                Check(File.ReadAllText(Path.Combine(game, "enshrouded.kfc")) == "TEST ARCHIVE" && File.ReadAllText(Path.Combine(game, "enshrouded.kfc_resources")) == "TEST RESOURCES", "Automatic GUI flow leaves both fake game archives byte-for-byte unchanged");
            }
            finally
            {
                var remaining = processField.GetValue(ui) as Process;
                if (remaining != null) { try { if (!remaining.WaitForExit(1500)) remaining.Kill(); } catch { } }
                if (File.Exists(errorMarker)) File.Delete(errorMarker); if (File.Exists(missingMarker)) File.Delete(missingMarker);
            }
        }
        public static int Run(string appRoot, string report)
        {
            report = Path.GetFullPath(report);
            string sandbox = Path.Combine(Path.GetDirectoryName(report), "self-test-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(sandbox);
            try
            {
                var store = new StudioStore(appRoot, Path.Combine(sandbox, "Data")); store.Load();
                Check(store.Schema.Sum(c => c.Mods.Count) == 47, "All 47 engine and Studio options represented");
                Check(store.Schema.SelectMany(c => c.Mods).Sum(m => m.Fields.Count) == store.Defaults.Where(k => new[] { "player", "inventory", "world", "gameplay" }.Contains(k.Key)).Sum(k => Json.Object(k.Value, k.Key).Sum(m => Json.Object(m.Value, m.Key).Count(p => p.Key != "enabled" && p.Key != "description"))), "Every backend option field represented");
                Check(store.Validate(store.Defaults).Count == 0, "Actual engine defaults satisfy schema");
                var storageDefinition = store.Schema.Single(category => category.Key == "world").Mods.Single(mod => mod.Key == "adjustFactoryInventoryAccess");
                var previousStorageProfile = store.Baseline(); Mod(previousStorageProfile, "world", "adjustFactoryInventoryAccess")["enabled"] = true;
                Check(!(bool)Mod(store.Defaults, "world", "adjustFactoryInventoryAccess")["enabled"] && (bool)Mod(store.Normalize(previousStorageProfile), "world", "adjustFactoryInventoryAccess")["enabled"] && storageDefinition.Status == "Fehler gemeldet · Materialzugriff unbestätigt", "Reported storage failure changes the new default to off while preserving an existing explicitly enabled profile");
                UpdateCheck.SelfTest(Check);
                RuntimeImport.SelfTest(Check, sandbox);
                UpdateInstaller.SelfTest(Check, appRoot, sandbox);
                ToolHandoff.SelfTest(Check, appRoot, sandbox);
                ClientProfiles.SelfTest(Check, appRoot, sandbox);
                SkillReview.SelfTest(Check, sandbox);
                var oldTamingConfig = store.Baseline(); Json.Object(oldTamingConfig["world"], "world").Remove("enableSingleStepTaming");
                var migratedTamingConfig = store.Normalize(oldTamingConfig);
                Check(!(bool)Mod(migratedTamingConfig, "world", "enableSingleStepTaming")["enabled"], "An older profile receives the new taming option disabled without enabling other mods");
                var oldProductionConfig = store.Baseline(); Json.Object(oldProductionConfig["world"], "world").Remove("adjustAnimalProduction");
                var migratedProduction = Mod(store.Normalize(oldProductionConfig), "world", "adjustAnimalProduction");
                Check(!(bool)migratedProduction["enabled"] && Json.Number(migratedProduction["quantityFactor"]) == 2 && Json.Number(migratedProduction["speedFactor"]) == 1, "Existing profiles receive configurable animal production disabled with separate amount and speed defaults");
                var oldSummonConfig = store.Baseline(); Json.Object(oldSummonConfig["world"], "world").Remove("adjustSummonedCompanions"); oldSummonConfig["summonMigrationUnknown"] = 73;
                var normalizedSummons = store.Normalize(oldSummonConfig); var migratedSummons = Mod(normalizedSummons, "world", "adjustSummonedCompanions");
                Check(!(bool)migratedSummons["enabled"] && Json.Number(migratedSummons["maxCompanions"]) == 4 && Json.Number(migratedSummons["durationSeconds"]) == 120 && Json.Number(migratedSummons["strengthFactor"]) == 1 && Json.Number(migratedSummons["companionVariant"]) == 0 && Json.Number(normalizedSummons["summonMigrationUnknown"]) == 73, "Older profiles receive the local summon prototype disabled with exact defaults and retain unknown settings");
                var summonDefinition = store.Schema.Single(category => category.Key == "world").Mods.Single(mod => mod.Key == "adjustSummonedCompanions");
                Check(!summonDefinition.ServerOnly && summonDefinition.KnownTargetOnly && store.Schema.SelectMany(category => category.Mods).Count(mod => mod.KnownTargetOnly) == 2 && store.Schema.SelectMany(category => category.Mods).All(mod => !mod.ServerOnly) && summonDefinition.Status == "Lokale Testfunktion · Spieltest offen" && summonDefinition.Fields.Single(field => field.Key == "companionVariant").Choices.Select(choice => choice.Value).SequenceEqual(new long[] {0,1,2,3}), "The existing summon prototype retains its recognized client or server targets alongside the new singleplayer-only option and retains its exact numeric variants0to3");
                Check(store.Schema.SelectMany(c => c.Mods).All(m => !string.IsNullOrWhiteSpace(m.Effect) && !string.IsNullOrWhiteSpace(m.Example) && !string.IsNullOrWhiteSpace(m.Notes) && !string.IsNullOrWhiteSpace(m.Status)), "Every option has effect, example, audit status and limitations");
                Check(store.Schema.SelectMany(c => c.Mods).All(m => !string.IsNullOrWhiteSpace(m.WhenToUse) && !string.IsNullOrWhiteSpace(m.Scope)), "All 46 options explain when to use them and where they apply");
                Check(PatchBasis.TargetId(@"D:\SteamLibrary\steamapps\common\Enshrouded") == "0f22d9dfcb5704d13687" && PatchBasis.TargetId(@"C:\Games Test\Enshrouded\") == "276ba4b311d6d8f195ce", "GUI basis lookup matches independent Node target IDs including spaces and trailing separators");
                Check(store.Schema.SelectMany(c => c.Mods).SelectMany(m => m.Fields).All(f => !string.IsNullOrWhiteSpace(f.Help) && f.Label != "Wert"), "Every option field has a specific label and explanation");
                int awareness;
                Check(GetProcessDpiAwareness(Process.GetCurrentProcess().Handle, out awareness) == 0 && awareness == 2, "Built executable runs with per-monitor DPI awareness");
                Check(AreDpiAwarenessContextsEqual(GetThreadDpiAwarenessContext(), new IntPtr(-4)), "Built executable uses Per-Monitor V2 DPI context");
                Check(store.Active(store.Baseline()) == 0, "Initial baseline disables every mod");
                Check(store.Profiles.Count == 3, "Baseline, comfort and building profiles created");
                Check(store.Profiles.First(p => p.Id == store.LastId).Name == "Unverändert", "First start selects unchanged baseline");
                string uiSettings = Path.Combine(store.DataRoot, "ui.json");
                store.Select(store.LastId);
                var persistedUi = Json.Read(uiSettings); persistedUi["futureUiSetting"] = new Dictionary<string, object> { { "preserve", 42 } }; Json.Write(uiSettings, persistedUi, null);
                store.Select(store.LastId);
                Check(Json.Number(Json.Object(Json.Read(uiSettings)["futureUiSetting"], "UI fixture")["preserve"]) == 42, "Selecting the migrated profile preserves unknown UI settings instead of replacing ui.json");
                var config = store.Baseline(); config["futureOption"] = new Dictionary<string, object> { { "value", 77 }, { "text", "Grüße \\\" {test} 🛠" } };
                Mod(config, "inventory", "adjustStackSize")["futureChild"] = 42;
                string unicode = Json.Encode(config);
                Check(Json.Object(Json.Serializer().DeserializeObject(unicode), "test").ContainsKey("futureOption"), "Formatted JSON round-trips strings and escaping");
                var normalized = store.Normalize(config);
                Check(normalized.ContainsKey("futureOption") && Mod(normalized, "inventory", "adjustStackSize").ContainsKey("futureChild"), "Unknown root and nested keys survive normalization");
                var created = store.NewProfile("Eigenes Profil", config);
                Mod(config, "inventory", "adjustStackSize")["value"] = 12;
                Check(Json.Number(Mod(created.Config, "inventory", "adjustStackSize")["value"]) == 65000, "Profile copies do not alias mutable data");
                var reloaded = new StudioStore(appRoot, store.DataRoot); reloaded.Load();
                Check(reloaded.Profiles.First(p => p.Name == "Eigenes Profil").Config.ContainsKey("futureOption"), "Profiles survive reload with unknown keys");
                bool duplicate = false; try { store.NewProfile("eigenes profil", store.Baseline()); } catch (InvalidDataException) { duplicate = true; }
                Check(duplicate, "Duplicate profile names rejected without overwriting");
                var invalid = store.Baseline(); Mod(invalid, "gameplay", "adjustGemSlotProbability")["legendary"] = 1.1;
                Check(store.Validate(invalid).Count > 0, "Out-of-range probabilities rejected");
                invalid = store.Baseline(); Mod(invalid, "gameplay", "adjustChestRandomSlots")["min"] = 8;
                Check(store.Validate(invalid).Count > 0, "Inverted chest loot range rejected");
                invalid = store.Baseline(); Mod(invalid, "inventory", "adjustStackSize")["value"] = 2.5;
                Check(store.Validate(invalid).Count > 0, "Fractional integer fields rejected");
                invalid = store.Baseline(); Mod(invalid, "inventory", "adjustStackSize")["enabled"] = "true";
                Check(store.Validate(invalid).Count > 0, "String booleans rejected");
                invalid = store.Baseline(); Mod(invalid, "gameplay", "enableSourceLootSlots")["enabled"] = true; Mod(invalid, "gameplay", "enableSourceLootSlots")["chestMultiplier"] = 2;
                Mod(invalid, "gameplay", "adjustChestRandomSlots")["enabled"] = true;
                Check(store.Validate(invalid).Any(e => e.Contains("gleichzeitig")), "Conflicting fixed chest slots and source chest multiplier rejected");
                Mod(invalid, "gameplay", "adjustChestRandomSlots")["enabled"] = false;
                Check(store.Validate(invalid).Count == 0, "Source loot multiplier works independently of fixed chest slots");
                invalid = store.Baseline(); Mod(invalid, "world", "adjustAltarLimit")["cap"] = 32;
                Check(store.Validate(invalid).Count > 0, "Altar cap above 16 requires explicit experimental option");
                Mod(invalid, "world", "adjustAltarLimit")["unlockSafeAltarCap"] = true;
                Check(store.Validate(invalid).Count == 0, "Experimental altar cap up to 32 can be represented");
                invalid = store.Baseline(); Mod(invalid, "gameplay", "enableUncapDedicatedServerSettings")["uncapServerFactorMin"] = 5;
                Check(store.Validate(invalid).Count > 0, "Inverted or equal factor bounds rejected");
                invalid = store.Baseline(); Mod(invalid, "gameplay", "enableUncapClientSettings")["enabled"] = true;
                Mod(invalid, "gameplay", "enableUncapClientSettings")["clientFactorMin"] = 4;
                Check(store.Validate(invalid).Any(e => e.Contains("wirksamen Maximum")), "Enabled client minimum equal to player cap 4 rejected before handoff");
                invalid = store.Baseline(); Mod(invalid, "gameplay", "enableUncapClientSettings")["enabled"] = true;
                Mod(invalid, "gameplay", "enableUncapClientSettings")["clientFactorMin"] = 2.5;
                Mod(invalid, "gameplay", "enableUncapDedicatedServerSettings")["enabled"] = true;
                Mod(invalid, "gameplay", "enableUncapDedicatedServerSettings")["uncapServerFactorMax"] = 2;
                Check(store.Validate(invalid).Any(e => e.Contains("wirksamen Maximum")), "Enabled client minimum above active server maximum rejected before handoff");
                double number;
                Check(Json.ParseInput("0,25", out number) && number == 0.25 && Json.ParseInput("0.25", out number) && number == 0.25 && !Json.ParseInput("NaN", out number) && !Json.ParseInput("1,000.5", out number), "German and invariant decimal input accepted; invalid and ambiguous input rejected");
                string file = Path.Combine(sandbox, "export.json"); Json.Write(file, created.Config, store.BackupRoot);
                created.Config["futureOption"] = 88; Json.Write(file, created.Config, store.BackupRoot);
                int backups = Directory.GetFiles(store.BackupRoot).Length;
                Check(backups > 0 && Directory.GetFiles(store.BackupRoot).Any(b => Json.Read(b).ContainsKey("futureOption")), "Overwritten config backed up before atomic replacement");
                Json.Write(file, created.Config, store.BackupRoot);
                Check(Directory.GetFiles(store.BackupRoot).Length == backups && Directory.GetFiles(sandbox, "*.tmp").Length == 0, "Identical export is idempotent and no temporary files remain");
                string fakeRoot = Path.Combine(sandbox, "handoff"); Directory.CreateDirectory(Path.Combine(fakeRoot, "assets"));
                foreach (string asset in new[] { "defaults.json", "schema.json" }) File.Copy(Path.Combine(appRoot, "assets", asset), Path.Combine(fakeRoot, "assets", asset));
                Directory.CreateDirectory(Path.Combine(fakeRoot, "engine"));
                var fake = new StudioStore(fakeRoot, Path.Combine(fakeRoot, "Data"));
                string game = Path.Combine(sandbox, "fake-game"); Directory.CreateDirectory(game);
                Check(!StudioStore.CheckGame(game).EndsWith("erkannt"), "Missing game files prevent launch");
                File.WriteAllText(Path.Combine(game, "enshrouded.exe"), "TEST PLACEHOLDER"); File.WriteAllText(Path.Combine(game, "enshrouded.kfc"), "TEST ARCHIVE");
                Check(!StudioStore.CheckGame(game).EndsWith("erkannt"), "Missing kfc_resources prevents a misleading recognized installation");
                File.WriteAllText(Path.Combine(game, "enshrouded.kfc_resources"), "TEST RESOURCES");
                Check(StudioStore.CheckGame(game) == "Steam-Client erkannt", "Client executable and matching archive recognized");
                var handoff = fake.Baseline(); handoff["gameDirectory"] = game;
                Json.Write(Path.Combine(fakeRoot, "engine", "config.json"), new Dictionary<string, object> { { "futureEngineField", 123 }, { "kfcParserVersion", "runtime-test" } }, null);
                string engineConfig = fake.ExportEngine(handoff); var exported = Json.Read(engineConfig);
                Check(exported.ContainsKey("futureEngineField") && (string)exported["kfcParserVersion"] == "runtime-test" && exported.ContainsKey("player"), "Handoff preserves backend metadata and future keys");
                var brokenServerConfig = fake.Baseline();
                StudioStore.SetEnabled(brokenServerConfig, "gameplay", "enableUncapDedicatedServerSettings", true);
                string beforeBlockedExport = File.ReadAllText(engineConfig);
                bool brokenExportBlocked = false;
                try { fake.ExportEngine(brokenServerConfig); } catch (InvalidOperationException) { brokenExportBlocked = true; }
                Check(brokenExportBlocked && File.ReadAllText(engineConfig) == beforeBlockedExport, "Missing or unverified engine blocks server limits without changing engine config");
                File.Copy(Path.Combine(appRoot, "engine", "enshrouded-patcher.exe"), Path.Combine(fakeRoot, "engine", "enshrouded-patcher.exe"));
                Check(fake.IsVerifiedEngine123(), "Supplied engine matches the fixed audited 1.2.3 SHA256");
                fake.ExportEngine(brokenServerConfig);
                Check((bool)Mod(Json.Read(engineConfig), "gameplay", "enableUncapDedicatedServerSettings")["enabled"], "Verified 1.2.3 engine permits separate server-factor bounds");
                StudioStore.SetEnabled(brokenServerConfig, "gameplay", "enableUncapDedicatedServerSettings", false);
                fake.ExportEngine(brokenServerConfig);
                Check(!(bool)Mod(Json.Read(engineConfig), "gameplay", "enableUncapDedicatedServerSettings")["enabled"], "Disabling server-factor bounds is preserved in handoff");
                var ignoredGather = fake.Baseline(); Mod(ignoredGather, "gameplay", "enableGatherLootMultipliers")["enabled"] = true;
                Mod(ignoredGather, "gameplay", "enableGatherLootMultipliers")["enemyLootMultiplier"] = 2;
                Check(fake.Validate(ignoredGather).Count == 0, "Legacy ineffective loot fields remain loadable and editable");
                bool ignoredGatherBlocked = false;
                try { fake.ExportEngine(ignoredGather); } catch (InvalidOperationException ex) { ignoredGatherBlocked = ex.Message.Contains("keine Wirkung"); }
                Check(ignoredGatherBlocked, "Ineffective enemy loot multiplier blocks handoff with an explanation");
                Mod(ignoredGather, "gameplay", "enableGatherLootMultipliers")["enemyLootMultiplier"] = 1;
                Mod(ignoredGather, "gameplay", "enableGatherLootMultipliers")["chestLootMultiplier"] = 2;
                ignoredGatherBlocked = false; try { fake.ExportEngine(ignoredGather); } catch (InvalidOperationException) { ignoredGatherBlocked = true; }
                Check(ignoredGatherBlocked, "Ineffective chest loot multiplier also blocks handoff");
                fake.ExportEngine(handoff);
                using (var compiler = new CSharpCodeProvider())
                {
                    var parameters = new CompilerParameters(new[] { "System.dll", "System.Web.Extensions.dll" }, Path.Combine(fakeRoot, "engine", "enshrouded-patcher.exe"), false);
                    parameters.GenerateExecutable = true; parameters.CompilerOptions = "/target:winexe";
                    string stubSource = @"using System; using System.IO; using System.Threading; using System.Collections.Generic; using System.Web.Script.Serialization;
class Stub { static int Main(string[] args) {
 var json=new JavaScriptSerializer(); File.WriteAllText(""received-working-directory.txt"",Environment.CurrentDirectory); File.WriteAllText(""received-runner.txt"",args.Length>0?args[0]:""MISSING RUNNER""); File.WriteAllText(""received-runtime-env.txt"",Environment.GetEnvironmentVariable(""PKG_EXECPATH"")??""MISSING""); File.Copy(""config.json"",""received-config.json"",true);
 string status=null;for(int i=0;i+1<args.Length;i++)if(args[i]==""--status-file"")status=args[i+1];File.WriteAllText(""received-status-path.txt"",status??"""");File.WriteAllText(""received-update-mode.txt"",Array.IndexOf(args,""--update"")>=0?""true"":""false"");
 if(status==null)return 0;bool failure=File.Exists(""stub-error.marker""),missing=File.Exists(""stub-no-status.marker"");Thread.Sleep(900);
 if(!missing){var report=new Dictionary<string,object>{{""stage"",failure?""error"":""done""},{""message"",failure?""STUB_FEHLER: no game archive was changed"":""STUB_ERFOLG: harmless fixture completed""},{""progress"",100},{""outcome"",failure?""error"":""success""},{""result"",new Dictionary<string,object>{{""operation"",""update""},{""applied"",!failure},{""warnings"",new string[]{""STUB_HINWEIS: synthetic test only""}}}}};File.WriteAllText(status,json.Serialize(report));}return failure?1:0; } }";
                    var build = compiler.CompileAssemblyFromSource(parameters, stubSource);
                    Check(!build.Errors.HasErrors, "Harmless backend stub compiled for process integration test");
                }
                File.WriteAllText(Path.Combine(fakeRoot, "engine", "studio-runner.js"), "// Harmless process contract fixture; the stub never evaluates this file.");
                Check(!fake.IsVerifiedEngine123(), "Modified engine fails the audited SHA256 check");
                var launchInfo = fake.LaunchInfo();
                Check(!launchInfo.UseShellExecute && !launchInfo.CreateNoWindow && launchInfo.EnvironmentVariables["PKG_EXECPATH"] == "PKG_INVOKE_NODEJS", "Runner launch sets the isolated Node runtime contract with an interactive console");
                var updateInfo = fake.UpdateLaunchInfo(Path.Combine(sandbox, "status with spaces.json"));
                Check(updateInfo.CreateNoWindow && updateInfo.RedirectStandardOutput && updateInfo.RedirectStandardError && updateInfo.Arguments.Contains(" --update --status-file \"") && updateInfo.Arguments.EndsWith("status with spaces.json\""), "Direct update is hidden, captures logs and quotes the status path");
                ExerciseBasisContracts(fake, handoff, sandbox);
                ExerciseStackContracts(fake, handoff, sandbox);
                string progressFile = Path.Combine(sandbox, "progress.json");
                Json.Write(progressFile, new Dictionary<string, object> { { "stage", "apply" }, { "message", "Dateien werden angewendet" }, { "progress", 90 }, { "outcome", "running" } }, null);
                var runningProgress = PatchProgress.Read(progressFile);
                Check(!PatchProgress.Succeeded(0, runningProgress) && !PatchProgress.Succeeded(0, null), "Exit zero without a confirmed completion never reports success");
                Json.Write(progressFile, new Dictionary<string, object> { { "stage", "done" }, { "message", "Fertig" }, { "progress", 100 }, { "outcome", "success" } }, null);
                Check(PatchProgress.Succeeded(0, PatchProgress.Read(progressFile)) && !PatchProgress.Succeeded(1, PatchProgress.Read(progressFile)), "Success requires both confirmed status and a zero process exit");
                Json.Write(progressFile, new Dictionary<string, object> { { "stage", "error" }, { "message", "Keine Änderung angewendet" }, { "progress", 25 }, { "outcome", "error" } }, null);
                Check(!PatchProgress.Succeeded(0, PatchProgress.Read(progressFile)), "Explicit failure cannot be mistaken for a successful update");
                bool userGameRunning = new[] { "enshrouded", "enshrouded_server", "enshrouded-patcher" }.Any(p => Process.GetProcessesByName(p).Length > 0);
                if (userGameRunning)
                {
                    bool blockedRunning = false;
                    try { fake.Launch(handoff); } catch (InvalidOperationException) { blockedRunning = true; }
                    Check(blockedRunning, "Running user game or patcher blocks real launch path");
                }
                fake.ExportEngine(handoff);
                using (var process = userGameRunning ? Process.Start(fake.LaunchInfo()) : fake.Launch(handoff))
                {
                    {
                        if (!process.WaitForExit(10000)) { process.Kill(); throw new Exception("Backend stub timed out."); }
                        Check(process.ExitCode == 0 && File.ReadAllText(Path.Combine(fakeRoot, "engine", "received-working-directory.txt")) == Path.Combine(fakeRoot, "engine"), "Patcher launch uses the correct working directory");
                        Check(Json.Read(Path.Combine(fakeRoot, "engine", "received-config.json")).ContainsKey("inventory") && File.ReadAllText(Path.Combine(game, "enshrouded.kfc")) == "TEST ARCHIVE", "Complete config handed to stub; fake game archive untouched");
                        Check(File.ReadAllText(Path.Combine(fakeRoot, "engine", "received-runner.txt")) == Path.Combine(fakeRoot, "engine", "studio-runner.js") && File.ReadAllText(Path.Combine(fakeRoot, "engine", "received-runtime-env.txt")) == "PKG_INVOKE_NODEJS", "Process receives the exact runner path and child-only Node runtime variable");
                    }
                }
                var application = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
                var ui = new StudioWindow(store, true);
                ui.ChooseCategory("world"); var singleStepKey = "world.enableSingleStepTaming";
                ui.Toggles[singleStepKey].IsChecked = true; ui.SaveCurrent();
                Check((bool)Mod(ui.Current.Config, "world", "enableSingleStepTaming")["enabled"] && !ui.Fields.Keys.Any(k => k.StartsWith(singleStepKey + ".")), "Single-success taming is a persistable boolean switch with no confusing numeric fields");
                ui.Toggles[singleStepKey].IsChecked = false; ui.SaveCurrent();
                string productionKey = "world.adjustAnimalProduction";
                ui.Toggles[productionKey].IsChecked = true; ui.Fields[productionKey + ".quantityFactor"].Text = "3"; ui.Fields[productionKey + ".speedFactor"].Text = "2"; ui.SaveCurrent();
                Check(Json.Number(Mod(ui.Current.Config, "world", "adjustAnimalProduction")["quantityFactor"]) == 3 && Json.Number(Mod(ui.Current.Config, "world", "adjustAnimalProduction")["speedFactor"]) == 2, "Animal production saves independently adjustable amount and speed in a profile");
                ui.Fields[productionKey + ".quantityFactor"].Text = "21"; bool productionBlocked = false; try { ui.SaveCurrent(); } catch (InvalidDataException) { productionBlocked = true; }
                Check(productionBlocked, "Animal production rejects an out-of-range factor before saving or patching");
                ui.Fields[productionKey + ".quantityFactor"].Text = "2"; ui.Fields[productionKey + ".speedFactor"].Text = "1"; ui.Toggles[productionKey].IsChecked = false; ui.SaveCurrent();
                ui.Find<TextBox>("Search").Text = "Tierproduktion"; ui.Screenshot(Path.Combine(Path.GetDirectoryName(report), "tested-animal-production.png")); ui.Find<TextBox>("Search").Clear();
                ExerciseSummonPrototype(ui, store, sandbox, report);
                ExerciseOwnSkeletonSpells(ui, store, sandbox, report);

                var slotsDefinition = store.Schema.SelectMany(c => c.Mods).First(m => m.Key == "adjustSlotCount");
                var rootDefinition = store.Schema.SelectMany(c => c.Mods).First(m => m.Key == "adjustSkillPointsPerRoot");
                Check(slotsDefinition.Fields.First(f => f.Key == "cap").Maximum == 255 && rootDefinition.Fields.First(f => f.Key == "factor").Integer && rootDefinition.Fields.First(f => f.Key == "factor").Maximum == 85, "Storage and root-point boundaries match the current uint8 game fields");
                var boundaryConfig = store.Baseline();
                Mod(boundaryConfig, "player", "adjustSkillPointsPerRoot")["factor"] = 0.5;
                Check(store.Validate(boundaryConfig).Count > 0, "Fractional root-point factors are rejected before creating truncated rewards");
                Mod(boundaryConfig, "player", "adjustSkillPointsPerRoot")["factor"] = 85;
                Mod(boundaryConfig, "inventory", "adjustSlotCount")["cap"] = 255;
                Check(store.Validate(boundaryConfig).Count == 0, "Safe root reward factor 85 and storage cap 255 are accepted");
                Mod(boundaryConfig, "inventory", "adjustSlotCount")["cap"] = 256;
                Check(store.Validate(boundaryConfig).Count > 0, "Storage slot cap 256 is rejected before uint8 overflow");
                ui.ChooseCategory("settings");
                Check(LogicalDescendants(ui.Window).OfType<Button>().Any(b => Convert.ToString(b.Tag) == "DiagnoseInstallation"), "Tools expose the read-only loaded-path and patch-state diagnosis");
                Check(ui.Find<Button>("TransferSetup") != null && ui.Find<Button>("MinimapButton") == null, "Setup transfer replaces the removed minimap entry");
                Check(TextOptions.GetTextFormattingMode(ui.Window) == TextFormattingMode.Display && TextOptions.GetTextRenderingMode(ui.Window) == TextRenderingMode.ClearType && ui.Window.UseLayoutRounding && ui.Window.SnapsToDevicePixels, "Display text formatting, ClearType and pixel alignment active");
                ui.ChooseCategory("inventory");
                string toggle = "inventory.adjustStackSize";
                ui.Toggles[toggle].IsChecked = true;
                Check(ui.Dirty && (bool)Mod(ui.Config, "inventory", "adjustStackSize")["enabled"], "GUI switch updates editable model");
                ui.Fields[toggle + ".value"].Text = "12345"; ui.SaveCurrent();
                Check(!ui.Dirty && Json.Number(Mod(ui.Current.Config, "inventory", "adjustStackSize")["value"]) == 12345, "GUI numeric field saves through profile persistence");
                ui.Fields[toggle + ".value"].Text = "kaputt";
                ui.ChooseCategory("player"); ui.ChooseCategory("inventory");
                Check(ui.InputErrors.Count == 1 && ui.Fields[toggle + ".value"].Text == "kaputt", "Invalid drafts survive navigation and remain marked");
                bool blocked = false; try { ui.SaveCurrent(); } catch (InvalidDataException) { blocked = true; }
                Check(blocked, "Invalid draft blocks save instead of silently writing stale value");
                ui.Fields[toggle + ".value"].Text = "23456"; ui.SaveCurrent();
                var before = ui.Current;
                var other = store.Profiles.First(p => p.Id != before.Id);
                ui.LoadProfile(other); ui.LoadProfile(before);
                Check(Json.Number(Mod(ui.Config, "inventory", "adjustStackSize")["value"]) == 23456, "Switching profiles restores each profile's own saved values");
                ExerciseEditingRegressions(ui, store, report);
                ExerciseLayoutRegressions(ui, store);
                ui.ChooseCategory("gameplay"); ui.Find<TextBox>("Search").Text = "Stapel";
                Check(ui.Toggles.Count >= 1 && ui.Toggles.ContainsKey(toggle), "Search finds matching options across categories including detailed descriptions");
                ui.Find<CheckBox>("OnlyActive").IsChecked = true;
                Check(ui.Toggles.Count == 1 && ui.Toggles.ContainsKey(toggle) && ui.Toggles.Values.All(t => t.IsChecked == true), "Active-only filter keeps only enabled matching results");
                ui.Find<CheckBox>("OnlyActive").IsChecked = false; ui.ChooseCategory("inventory");
                ui.LoadProfile(store.Profiles.First(p => p.Name == "Komfort"));
                ui.Screenshot(Path.Combine(Path.GetDirectoryName(report), "tested-inventory.png"));
                ui.Find<TextBox>("Search").Text = "Mehr Platz in Lagerkisten";
                string storageKey = "inventory.adjustSlotCount";
                ui.Details[storageKey].IsExpanded = true;
                var detailContent = (StackPanel)ui.Details[storageKey].Content;
                string expectedExample = store.Schema.SelectMany(c => c.Mods).First(m => m.Key == "adjustSlotCount").Example;
                Check(detailContent.Children.OfType<TextBlock>().Any(t => t.Text == expectedExample), "Expanded help renders the actual storage calculation example");
                ui.Render(); Check(ui.Details[storageKey].IsExpanded, "Expanded explanation survives rerendering");
                ui.Screenshot(Path.Combine(Path.GetDirectoryName(report), "tested-details.png"));
                ui.Find<ScrollViewer>("OptionsScroll").ScrollToVerticalOffset(300);
                ui.Screenshot(Path.Combine(Path.GetDirectoryName(report), "tested-details-reading.png"));
                ui.Find<ScrollViewer>("OptionsScroll").ScrollToTop();
                StudioWindow.CaptureWindow(ui.Window, Path.Combine(Path.GetDirectoryName(report), "tested-details-150.png"), 1.5);
                Check(File.Exists(Path.Combine(Path.GetDirectoryName(report), "tested-details-150.png")), "Detailed UI rendered at 150 percent output resolution");
                ui.Find<TextBox>("Search").Text = "";
                Check(ui.Find<ComboBox>("Profiles").SelectionBoxItem.ToString() == "Komfort", "Custom dropdown displays the currently loaded profile name");
                ui.ChooseCategory("gameplay");
                Check(ui.Toggles["gameplay.enableUncapDedicatedServerSettings"].IsEnabled == store.IsVerifiedEngine123(), "Server-limits switch follows the verified engine version");
                var previousProfile = ui.Current;
                var legacyConfig = store.Baseline(); StudioStore.SetEnabled(legacyConfig, "gameplay", "enableUncapDedicatedServerSettings", true);
                var legacyProfile = store.NewProfile("Altes Profil mit Server-Patch", legacyConfig);
                ui.LoadProfile(legacyProfile); ui.ChooseCategory("gameplay");
                var legacyToggle = ui.Toggles["gameplay.enableUncapDedicatedServerSettings"];
                bool canDisableLegacy = legacyToggle.IsEnabled && legacyToggle.IsChecked == true;
                legacyToggle.IsChecked = false; ui.SaveCurrent();
                Check(canDisableLegacy && legacyToggle.IsEnabled == store.IsVerifiedEngine123() && !(bool)Mod(ui.Current.Config, "gameplay", "enableUncapDedicatedServerSettings")["enabled"], "Legacy profiles can disable and save server-limits option; re-enabling follows engine verification");
                ui.LoadProfile(previousProfile); ui.ChooseCategory("gameplay");
                ui.Find<TextBox>("Search").Text = "enableUncapDedicatedServerSettings";
                ui.Details["gameplay.enableUncapDedicatedServerSettings"].IsExpanded = true;
                ui.Screenshot(Path.Combine(Path.GetDirectoryName(report), "tested-blocked-option.png"));
                ui.Find<TextBox>("Search").Text = "automatisch";
                ui.Screenshot(Path.Combine(Path.GetDirectoryName(report), "tested-auto-loot.png"));
                Check(ui.Fields.ContainsKey("gameplay.enableAutoLoot.pickupRadiusMeters"), "Complex automatic loot card renders all numeric controls");
                string serverFile = Path.Combine(sandbox, "enshrouded_server.json");
                var serverData = new Dictionary<string, object> {
                    { "gameSettingsPreset", "Custom" }, { "password", "SECRET-MUST-NOT-APPEAR" },
                    { "userGroups", new object[] { new Dictionary<string, object> { { "password", "GROUP-SECRET" } } } },
                    { "gameSettings", new Dictionary<string, object> { { "enemyDamageFactor", 3 }, { "bossDamageFactor", 2 }, { "playerHealthFactor", 0.5 }, { "threatBonus", 1 }, { "aggroPoolAmount", "Many" } } }
                };
                Json.Write(serverFile, serverData, null); string beforeReview = File.ReadAllText(serverFile);
                var review = ServerReview.Read(serverFile);
                Check(review.Entries[0].Value.Contains("300 %") && review.Entries[0].Attention && review.Entries[2].Attention, "Server diagnosis flags 300 percent damage and reduced health for Custom preset");
                Check(!review.SafeSummary().Contains("SECRET") && !review.SafeSummary().Contains("password"), "Server diagnosis excludes passwords and private user groups");
                Check(File.ReadAllText(serverFile) == beforeReview, "Server diagnosis leaves source configuration unchanged");
                var reviewWindow = ui.CreateReviewWindow(review, "Beispieldaten für den UI-Test — keine Messung deines Servers");
                StudioWindow.CaptureWindow(reviewWindow, Path.Combine(Path.GetDirectoryName(report), "tested-server-review.png"), 1); reviewWindow.Close();
                serverData["gameSettingsPreset"] = "Default"; Json.Write(serverFile, serverData, null); review = ServerReview.Read(serverFile);
                Check(!review.Entries[0].Attention && review.Summary.Contains("Custom"), "Preset diagnosis does not claim inactive custom numbers are effective");
                serverData["gameSettingsPreset"] = "Custom"; serverData["gameSettings"] = new Dictionary<string, object> { { "enemyDamageFactor", "3" } }; Json.Write(serverFile, serverData, null); review = ServerReview.Read(serverFile);
                Check(review.Entries[0].Attention && review.Entries[0].Value.Contains("Ungültig") && review.Entries[1].Value.Contains("Nicht in"), "Malformed and missing server values reported without inventing defaults");
                bool wrongServerFile = false; try { ServerReview.Read(engineConfig); } catch (InvalidDataException) { wrongServerFile = true; }
                Check(wrongServerFile, "Patcher configuration is rejected as a server settings file");
                ui.ChooseCategory("settings"); ui.Screenshot(Path.Combine(Path.GetDirectoryName(report), "tested-settings.png"));
                Check(ui.Find<StackPanel>("OptionsPanel").Children.Count == 1, "Tools view renders file settings");
                ui.Window.Width = 1100; ui.Window.Height = 780; ui.ChooseCategory("inventory");
                ui.Screenshot(Path.Combine(Path.GetDirectoryName(report), "tested-compact.png"));
                Check(ui.Find<ScrollViewer>("OptionsScroll").ActualHeight > 100 && ui.Find<Button>("LaunchPatcher").ActualWidth > 100, "Compact window retains scroll area and patcher action");
                var skillOption = store.Schema.SelectMany(c => c.Mods).First(m => m.Key == "adjustSkillPointsPerLevel");
                Check(skillOption.Scope.IndexOf("Client", StringComparison.OrdinalIgnoreCase) >= 0 && skillOption.Scope.IndexOf("Wert", StringComparison.OrdinalIgnoreCase) >= 0 && skillOption.Status.IndexOf("Spieltest", StringComparison.OrdinalIgnoreCase) >= 0 && skillOption.Notes.IndexOf("nicht im Spiel bestätigt", StringComparison.OrdinalIgnoreCase) >= 0, "Skill-point schema explains matching client values and does not guarantee a live gameplay repair");
                string fakeServer = Path.Combine(sandbox, "fake-dedicated"); Directory.CreateDirectory(fakeServer);
                File.WriteAllText(Path.Combine(fakeServer, "enshrouded_server.exe"), "TEST SERVER PLACEHOLDER"); File.WriteAllText(Path.Combine(fakeServer, "enshrouded_server.kfc"), "TEST SERVER ARCHIVE"); File.WriteAllText(Path.Combine(fakeServer, "enshrouded_server.kfc_resources"), "TEST SERVER RESOURCES");
                ui.ChooseCategory("player"); ui.Find<TextBox>("Search").Text = "adjustSkillPointsPerLevel";
                ui.Find<TextBox>("GamePath").Text = fakeServer;
                var skillElements = LogicalDescendants(ui.Find<StackPanel>("OptionsPanel")).ToList();
                Check(skillElements.OfType<Button>().Any(b => Convert.ToString(b.Tag) == "ApplyClientSkillPoints") && skillElements.OfType<Button>().Any(b => Convert.ToString(b.Tag) == "InspectSkillPoints"), "Skill-point card offers direct client application and installed archive inspection");
                var targetHint = skillElements.OfType<TextBlock>().FirstOrDefault(t => t.Text.StartsWith("Du bearbeitest den Dedicated Server.", StringComparison.Ordinal));
                Check(ui.Toggles.Count == 1 && ui.Toggles.ContainsKey("player.adjustSkillPointsPerLevel") && targetHint != null && targetHint.Text.IndexOf("Spielclient", StringComparison.OrdinalIgnoreCase) >= 0 && skillElements.OfType<Button>().Any(b => Convert.ToString(b.Content).IndexOf("Profil für Spielclient", StringComparison.OrdinalIgnoreCase) >= 0) && skillElements.OfType<TextBlock>().Any(t => t.Text.IndexOf("noch keine Spieldateien geändert", StringComparison.OrdinalIgnoreCase) >= 0), "Skill-point card contains dedicated-client guidance and the explicit client-profile action without opening a file dialog");
                var clientActions = skillElements.OfType<StackPanel>().First(p => Convert.ToString(p.Tag) == "SkillClientActions");
                Check(clientActions.Visibility == Visibility.Collapsed && targetHint.Text.Contains("nicht unterstützt"), "Server skill card explicitly rejects global server-only support and hides client application actions");
                string serverHint = targetHint.Text;
                ui.Find<TextBox>("GamePath").Text = game;
                bool refreshedClient = targetHint.Text.StartsWith("Du bearbeitest den Spielclient.", StringComparison.Ordinal) && targetHint.Text != serverHint;
                ui.Find<TextBox>("GamePath").Text = fakeServer;
                Check(refreshedClient && targetHint.Text == serverHint && ui.Find<TextBlock>("GameStatus").Text == "Server erkannt" && Convert.ToString(ui.Find<TextBlock>("GameStatus").ToolTip) == "Dedicated Server erkannt", "Changing the installation target refreshes the existing skill-point hint through UpdateGame without rerendering");
                ui.Window.Width = 1360; ui.Window.Height = 1080; ui.Find<ScrollViewer>("OptionsScroll").ScrollToTop();
                ui.Screenshot(Path.Combine(Path.GetDirectoryName(report), "tested-skillpoints-server.png"));
                ui.Window.Close();
                bool liveUserProcess = userGameRunning || new[] { "enshrouded", "enshrouded_server", "enshrouded-patcher" }.Any(p => Process.GetProcessesByName(p).Length > 0);
                if (liveUserProcess) results.Add("SKIP: Main-button automatic update fixture cases skipped because a user game, server or patcher is running.");
                else
                {
                    foreach (string asset in new[] { "MainWindow.xaml", "shroud-valley.png", "studio-icon.png", "studio.ico" })
                        if (asset != "shroud-valley.png" || File.Exists(Path.Combine(appRoot, "assets", asset))) File.Copy(Path.Combine(appRoot, "assets", asset), Path.Combine(fakeRoot, "assets", asset), true);
                    fake.Load(); var automationProfile = fake.Profiles.First(p => p.Name == "Unverändert"); automationProfile.Config["gameDirectory"] = game; fake.Save(automationProfile); fake.Select(automationProfile.Id);
                    var automaticUi = new StudioWindow(fake, true); automaticUi.Window.Show();
                    try { ExerciseAutomaticUpdate(automaticUi, fakeRoot, game, false, false); ExerciseAutomaticUpdate(automaticUi, fakeRoot, game, true, false); ExerciseAutomaticUpdate(automaticUi, fakeRoot, game, false, true); ExerciseAutomaticUpdate(automaticUi, fakeRoot, game, true, false, true); }
                    finally { automaticUi.Window.Close(); }
                }
                results.Add("LIMITATION: GUI tests use temporary profiles and harmless launch stubs. Archive staging/transactions are verified in a separate backend suite; live gameplay remains untested.");
                results.Add("Sandbox: " + sandbox);
                File.WriteAllLines(report, results, new UTF8Encoding(false));
                return 0;
            }
            catch (Exception ex)
            {
                results.Add(ex.ToString()); File.WriteAllLines(report, results, new UTF8Encoding(false)); return 1;
            }
        }
    }
}
