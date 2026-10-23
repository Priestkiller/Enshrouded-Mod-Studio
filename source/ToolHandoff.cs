using System;
using System.IO;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Threading;
using System.Text;
using System.Threading;
using System.CodeDom.Compiler;
using Microsoft.CSharp;

namespace EnshroudedStudio
{
    public static class ToolHandoff
    {
        private static string Hash(string file)
        { using (var stream = File.OpenRead(file)) using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant(); }
        private static string ReadyFile(string dataRoot, string token)
        {
            if (token == null || !Regex.IsMatch(token, "\\A[a-f0-9]{32}\\z")) throw new InvalidDataException("Ungültige Startbestätigung.");
            return Path.Combine(dataRoot, "tool-update-ready-" + token + ".json");
        }
        private static void AtomicBytes(string file, byte[] bytes)
        {
            string temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                File.WriteAllBytes(temporary, bytes);
                if (File.Exists(file)) File.Replace(temporary, file, null); else File.Move(temporary, file);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
        public static void ConfirmReady(StudioStore store, string token)
        {
            if (store.LoadErrors.Count > 0 || store.Profiles.Count == 0 || !store.Profiles.Exists(p => p.Id == store.LastId))
                throw new InvalidDataException("Die übernommenen Profile konnten nicht vollständig geladen werden.");
            Json.Write(ReadyFile(store.DataRoot, token), new Dictionary<string, object> {
                { "version", UpdateCheck.InstalledVersion }, { "pid", Process.GetCurrentProcess().Id },
                { "profiles", store.Profiles.Count }, { "selected", store.LastId }
            }, null);
        }
        public static void AwaitAcceptance(StudioStore store, string token, Window window)
        {
            window.IsEnabled = false; ConfirmReady(store, token);
            string accepted = ReadyFile(store.DataRoot, token) + ".accepted";
            var clock = Stopwatch.StartNew(); var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(250) };
            timer.Tick += delegate {
                bool confirmed = false;
                try { confirmed = File.Exists(accepted) && File.ReadAllText(accepted) == token; } catch (IOException) { } catch (UnauthorizedAccessException) { }
                if (confirmed) { timer.Stop(); window.IsEnabled = true; try { File.Delete(accepted); } catch { } }
                else if (clock.Elapsed > TimeSpan.FromSeconds(40)) { timer.Stop(); window.Close(); }
            };
            window.Closed += delegate { timer.Stop(); }; timer.Start();
        }
        public static Task StartAndConfirmAsync(UpdateInstallResult installed, StudioStore oldStore)
        { return StartAndConfirmCoreAsync(installed, oldStore, 120, 250); }

        private static async Task StartAndConfirmCoreAsync(UpdateInstallResult installed, StudioStore oldStore, int attempts, int delay)
        {
            string token = Guid.NewGuid().ToString("N"), file = ReadyFile(installed.DataRoot, token);
            if (installed.ExecutableSha256 == null || !Regex.IsMatch(installed.ExecutableSha256, "\\A[a-f0-9]{64}\\z") || Hash(installed.ExecutablePath) != installed.ExecutableSha256)
                throw new InvalidDataException("Die vorbereitete neue Anwendung wurde verändert. Der bisherige Programmstand bleibt geöffnet.");
            var expectedVersion = UpdateCheck.ParseVersion(FileVersionInfo.GetVersionInfo(installed.ExecutablePath).FileVersion);
            if (expectedVersion <= UpdateCheck.ParseVersion(UpdateCheck.InstalledVersion))
                throw new InvalidDataException("Die vorbereitete Anwendung ist keine neuere Tool-Version.");
            string pointer = Path.Combine(oldStore.DataRoot, "installed-tool-update.json");
            // Read before starting a child: a locked/unreadable pointer must not leave another application running.
            byte[] previousPointer = File.Exists(pointer) ? File.ReadAllBytes(pointer) : null;
            using (var process = Process.Start(new ProcessStartInfo {
                FileName = installed.ExecutablePath, Arguments = "--update-startup " + token,
                WorkingDirectory = installed.AppRoot, UseShellExecute = false }))
            {
                bool pointerTouched = false;
                try
                {
                bool ready = false; string confirmedVersion = null;
                for (int i = 0; i < attempts; i++)
                {
                    if (process.HasExited) throw new InvalidOperationException("Die neue Version konnte nicht gestartet werden. Dein bisheriges Studio bleibt geöffnet. Installierter Ordner: " + installed.AppRoot);
                    if (File.Exists(file))
                    {
                        var doc = Json.Read(file);
                        ready = Convert.ToInt32(doc["pid"]) == process.Id && Convert.ToInt32(doc["profiles"]) == oldStore.Profiles.Count &&
                            Convert.ToString(doc["selected"]) == oldStore.LastId &&
                            UpdateCheck.ParseVersion(Convert.ToString(doc["version"])) == expectedVersion;
                        if (!ready) throw new InvalidDataException("Die neue Version hat ihre übernommenen Profile nicht bestätigt. Das bisherige Studio bleibt geöffnet.");
                        confirmedVersion = Convert.ToString(doc["version"]);
                        break;
                    }
                    await Task.Delay(delay).ConfigureAwait(false);
                }
                if (!ready) throw new TimeoutException("Der neue Programmstart wurde nicht rechtzeitig bestätigt. Das bisherige Studio bleibt geöffnet. Neuer Ordner: " + installed.AppRoot);
                if (Hash(installed.ExecutablePath) != installed.ExecutableSha256)
                    throw new InvalidDataException("Die neue Anwendung wurde während des Starts verändert.");
                pointerTouched = true;
                Json.Write(pointer, new Dictionary<string, object> {
                    { "executable", installed.ExecutablePath }, { "version", confirmedVersion }, { "sha256", installed.ExecutableSha256 }
                }, null);
                AtomicBytes(file + ".accepted", new UTF8Encoding(false).GetBytes(token));
                try { File.Delete(file); } catch { }
                }
                catch (Exception original)
                {
                    // This process was created by this handoff and its UI is still disabled.
                    var cleanupErrors = new List<string>();
                    try
                    {
                        if (!process.HasExited)
                        {
                            try { process.Kill(); } catch (InvalidOperationException) { if (!process.HasExited) throw; }
                            if (!process.WaitForExit(10000)) cleanupErrors.Add("Der neue Prozess wurde nicht rechtzeitig beendet.");
                        }
                    }
                    catch (Exception cleanup) { cleanupErrors.Add("Neuen Prozess schließen: " + cleanup.Message); }
                    // Pointer recovery must run even if stopping the child failed or raced its exit.
                    try { if (pointerTouched) { if (previousPointer == null) File.Delete(pointer); else AtomicBytes(pointer, previousPointer); } }
                    catch (Exception cleanup) { cleanupErrors.Add("Vorherige Startweiterleitung wiederherstellen: " + cleanup.Message); }
                    if (cleanupErrors.Count > 0) throw new InvalidOperationException(original.Message + "\n\n" + string.Join("\n", cleanupErrors), original);
                    throw;
                }
            }
        }
        private static bool ChildEnded(string root)
        {
            string file = Path.Combine(root, "handoff-pid.txt");
            if (!File.Exists(file)) return false;
            try { using (var process = Process.GetProcessById(int.Parse(File.ReadAllText(file)))) return process.HasExited || process.WaitForExit(2000); }
            catch (ArgumentException) { return true; }
        }
        private static void Pump(int milliseconds)
        {
            var frame = new DispatcherFrame();
            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(milliseconds) };
            timer.Tick += delegate { timer.Stop(); frame.Continue = false; }; timer.Start(); Dispatcher.PushFrame(frame);
        }
        // Offline owned-child fixtures. No game, engine, network, shell association or downloaded executable is used.
        public static void SelfTest(Action<bool, string> check, string appRoot, string sandbox)
        {
            string root = Path.Combine(sandbox, "handoff"); Directory.CreateDirectory(root);
            string compiled = Path.Combine(root, "child.exe");
            var current = UpdateCheck.ParseVersion(UpdateCheck.InstalledVersion);
            string future = new Version(current.Major, current.Minor, checked(current.Build + 1), 0).ToString(4);
            string source = @"using System; using System.IO; using System.Threading; using System.Diagnostics; using System.Reflection; using System.Collections.Generic; using System.Web.Script.Serialization;
[assembly:AssemblyVersion(""@VERSION@"")][assembly:AssemblyFileVersion(""@VERSION@"")]
class Fixture {
 static JavaScriptSerializer json = new JavaScriptSerializer();
 static Dictionary<string,object> Read(string p) { return (Dictionary<string,object>)json.DeserializeObject(File.ReadAllText(p)); }
 static void Write(string p, object value) { File.WriteAllText(p+"".tmp"",json.Serialize(value)); File.Move(p+"".tmp"",p); }
 static int Main(string[] args) {
  string root=AppDomain.CurrentDomain.BaseDirectory, data=Path.Combine(root,""Data""), mode=File.ReadAllText(Path.Combine(root,""mode.txt""));
  File.WriteAllText(Path.Combine(root,""handoff-pid.txt""),Process.GetCurrentProcess().Id.ToString());
  if(mode==""exit"") return 9;
  string token=args[1], ready=Path.Combine(data,""tool-update-ready-""+token+"".json""), accepted=ready+"".accepted"";
  File.WriteAllText(Path.Combine(root,""handoff-ui-before.txt""),""disabled"");
  int count=0; var ids=new HashSet<string>();
  foreach(string file in Directory.GetFiles(Path.Combine(data,""profiles""),""*.json"")) { var p=Read(file); if(!(p[""config""] is Dictionary<string,object>))return 8; count++; ids.Add(Path.GetFileNameWithoutExtension(file)); }
  string selected=Convert.ToString(Read(Path.Combine(data,""ui.json""))[""lastProfile""]); if(!ids.Contains(selected))return 7;
  if(mode==""accepted-write-fails"")Directory.CreateDirectory(accepted);
  if(mode!=""no-ready"") {
   if(mode==""broken-json"")File.WriteAllText(ready,""{"" );
   else Write(ready,new Dictionary<string,object>{{""version"",mode==""old-version""?""@CURRENT@"":""@VERSION@""},{""pid"",Process.GetCurrentProcess().Id+(mode==""wrong-pid""?1:0)},{""profiles"",count+(mode==""wrong-count""?1:0)},{""selected"",mode==""wrong-selected""?new string('f',32):selected}});
  }
  for(int i=0;i<2000;i++) {
   if(File.Exists(accepted)&&File.ReadAllText(accepted)==token) {
    string pointer=File.ReadAllText(Path.Combine(root,""pointer-path.txt""));
    var doc=Read(pointer);
    Write(Path.Combine(root,""handoff-enabled.json""),new Dictionary<string,object>{{""accepted"",true},{""profiles"",count},{""selected"",selected},{""pointerBeforeEnable"",Convert.ToString(doc[""executable""])==Process.GetCurrentProcess().MainModule.FileName}});
    return 0;
   }
   Thread.Sleep(10);
  } return 6;
 }
}".Replace("@VERSION@", future).Replace("@CURRENT@", UpdateCheck.InstalledVersion);
            using (var compiler = new CSharpCodeProvider())
            {
                var options = new CompilerParameters { GenerateExecutable = true, OutputAssembly = compiled, CompilerOptions = "/target:winexe /platform:x64" };
                options.ReferencedAssemblies.Add("System.dll");
                options.ReferencedAssemblies.Add("System.Core.dll");
                options.ReferencedAssemblies.Add("System.Web.Extensions.dll");
                var build = compiler.CompileAssemblyFromSource(options, source);
                if (build.Errors.HasErrors) throw new InvalidDataException("Offline-Startfixture konnte nicht kompiliert werden: " + build.Errors[0]);
            }
            foreach (string mode in new[] { "success", "exit", "wrong-pid", "wrong-count", "wrong-selected", "old-version", "broken-json", "no-ready", "accepted-write-fails", "locked-pointer", "changed-exe" })
            {
                string oldData = Path.Combine(root, mode, "old", "Data"), childRoot = Path.Combine(root, mode, "new"), childData = Path.Combine(childRoot, "Data");
                var store = new StudioStore(appRoot, oldData); store.Load(); store.Select(store.Profiles[1].Id);
                Directory.CreateDirectory(Path.Combine(childData, "profiles"));
                var before = new Dictionary<string, string>();
                foreach (string profile in Directory.GetFiles(Path.Combine(oldData, "profiles"), "*.json"))
                { before[profile] = Hash(profile); File.Copy(profile, Path.Combine(childData, "profiles", Path.GetFileName(profile))); }
                File.Copy(Path.Combine(oldData, "ui.json"), Path.Combine(childData, "ui.json"));
                string executable = Path.Combine(childRoot, "Enshrouded Mod Studio.exe"), pointer = Path.Combine(oldData, "installed-tool-update.json");
                File.Copy(compiled, executable); File.WriteAllText(Path.Combine(childRoot, "mode.txt"), mode); File.WriteAllText(Path.Combine(childRoot, "pointer-path.txt"), pointer);
                var installed = new UpdateInstallResult { AppRoot = childRoot, DataRoot = childData, ExecutablePath = executable, ExecutableSha256 = Hash(executable) };
                byte[] previous = null;
                if (mode == "accepted-write-fails" || mode == "locked-pointer") { previous = new UTF8Encoding(false).GetBytes("{\"previous\":77}\n"); File.WriteAllBytes(pointer, previous); }
                if (mode == "changed-exe") installed.ExecutableSha256 = new string('0',64);
                bool rejected = false;
                try
                {
                    if (mode == "locked-pointer")
                    { using (var locked = new FileStream(pointer, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) StartAndConfirmCoreAsync(installed, store, 20, 100).GetAwaiter().GetResult(); }
                    else StartAndConfirmCoreAsync(installed, store, 20, 100).GetAwaiter().GetResult();
                }
                catch { rejected = true; }
                if (mode == "success")
                {
                    string enabled = Path.Combine(childRoot, "handoff-enabled.json"); var clock = Stopwatch.StartNew();
                    while (!File.Exists(enabled) && clock.ElapsedMilliseconds < 2000) Thread.Sleep(10);
                    bool confirmed = !rejected && File.Exists(enabled);
                    if (confirmed)
                    {
                        var observed = Json.Read(enabled); var forward = Json.Read(pointer);
                        confirmed = (bool)observed["accepted"] && (bool)observed["pointerBeforeEnable"] && Convert.ToInt32(observed["profiles"]) == store.Profiles.Count && Convert.ToString(observed["selected"]) == store.LastId &&
                            Convert.ToString(forward["executable"]) == executable && Convert.ToString(forward["sha256"]) == installed.ExecutableSha256 && UpdateCheck.ParseVersion(Convert.ToString(forward["version"])) == UpdateCheck.ParseVersion(future);
                    }
                    check(confirmed && ChildEnded(childRoot), "Handoff accepts an owned future child only after profile/PID/version confirmation and writes the SHA pointer before enabling it");
                }
                else
                {
                    bool noChild = mode == "locked-pointer" || mode == "changed-exe";
                    bool pointerRestored = previous == null ? !File.Exists(pointer) : File.ReadAllText(pointer) == new UTF8Encoding(false).GetString(previous);
                    check(rejected && pointerRestored && !File.Exists(Path.Combine(childRoot,"handoff-enabled.json")) && (noChild ? !File.Exists(Path.Combine(childRoot,"handoff-pid.txt")) : ChildEnded(childRoot)),
                        "Handoff rejects " + mode + " and keeps the prior pointer without leaving its owned child running");
                }
                bool unchanged = true; foreach (var profile in before) unchanged &= Hash(profile.Key) == profile.Value;
                check(unchanged, "Handoff preserves all original profile bytes for " + mode);
            }
            var uiStore = new StudioStore(appRoot, Path.Combine(root, "acceptance-ui")); uiStore.Load(); uiStore.Select(uiStore.Profiles[0].Id);
            string uiToken = Guid.NewGuid().ToString("N"), acceptance = ReadyFile(uiStore.DataRoot, uiToken) + ".accepted";
            var window = new Window();
            try
            {
                AwaitAcceptance(uiStore, uiToken, window); AtomicBytes(acceptance, new UTF8Encoding(false).GetBytes("wrong-token")); Pump(350);
                check(!window.IsEnabled, "Handoff child UI stays disabled for a missing or wrong acceptance token");
                AtomicBytes(acceptance, new UTF8Encoding(false).GetBytes(uiToken)); Pump(350);
                check(window.IsEnabled && !File.Exists(acceptance), "Handoff child UI unlocks only after its exact parent acceptance token and consumes the marker");
            }
            finally { window.Close(); }
        }
        // Old shortcuts continue to work after a successful update; only newer, unchanged executables are forwarded.
        public static bool TryForward(string appRoot)
        {
            string file = Path.Combine(appRoot, "Data", "installed-tool-update.json");
            if (!File.Exists(file)) return false;
            try
            {
                if (new FileInfo(file).Length > 8192) return false;
                var doc = Json.Read(file); string executable = doc["executable"] as string;
                if (UpdateCheck.ParseVersion(doc["version"] as string) <= UpdateCheck.ParseVersion(UpdateCheck.InstalledVersion) ||
                    !Path.IsPathRooted(executable) || Path.GetFileName(executable) != "Enshrouded Mod Studio.exe" || !File.Exists(executable) ||
                    Hash(executable) != doc["sha256"] as string) return false;
                Process.Start(new ProcessStartInfo(executable) { WorkingDirectory = Path.GetDirectoryName(executable), UseShellExecute = false }); return true;
            }
            catch { return false; }
        }
    }
}
