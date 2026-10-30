using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace UGSM.Installation
{
    internal static class SetupProgram
    {
        [STAThread]
        private static int Main(string[] args)
        {
            try
            {
                Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
#if UNINSTALLER
                if (args.Length > 0 && args[0] == "--uninstall-worker")
                {
                    if (args.Length != 5) throw new InvalidDataException("Ungültiger Deinstallationsauftrag.");
                    string root = UserInstallState.RootPath(args[1]);
                    var record = UserInstallState.ReadRegistered(PackageDefinition.AppId, root);
                    if (record == null) throw new InvalidDataException("Die Installation ist nicht registriert.");
                    SetupEngine.WaitForProcess(args[2], args[3], UserInstallState.Resolve(root, UserInstallState.UninstallerName));
                    if (args[4] != "confirmed") throw new InvalidDataException("Deinstallation nicht bestätigt.");
                    SetupEngine.Uninstall(record);
                    MessageBox.Show("Deinstallation abgeschlossen. Persönliche Daten und veränderte Dateien bleiben erhalten.", UserInstallState.AppName(PackageDefinition.AppId), MessageBoxButtons.OK, MessageBoxIcon.Information); return 0;
                }
                string installRoot = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                var installed = UserInstallState.ReadRegistered(PackageDefinition.AppId, installRoot);
                if (installed == null) throw new InvalidDataException("Dieses Programm ist nicht als Installation registriert.");
                Application.Run(new SetupForm(installed));
#else
                if (args.Length != 0)
                {
                    if (args.Length != 6 || args[0] != "--update-existing" || args[1] != "--wait-pid" || args[3] != "--wait-start" || args[5] != "--restart") throw new InvalidDataException("Ungültiger Updateauftrag.");
                    string root = UserInstallState.RegisteredRoot(PackageDefinition.AppId);
                    if (root == null) throw new InvalidDataException("Keine installierte Programmversion gefunden.");
                    var record = UserInstallState.ReadRegistered(PackageDefinition.AppId, root);
                    if (new Version(PackageDefinition.Version) <= new Version(record.Version)) throw new InvalidDataException("Das Update ist nicht neuer als die installierte Version.");
                    // Check identity before displaying the progress window or letting the old app exit.
                    SetupEngine.ValidateProcess(args[2], args[4], UserInstallState.Resolve(root, UserInstallState.ExeName(PackageDefinition.AppId)));
                    Application.Run(new SetupForm(root, args[2], args[4]));
                }
                else Application.Run(new SetupForm());
#endif
                return 0;
            }
            catch (Exception error) { MessageBox.Show(error.Message, UserInstallState.AppName(PackageDefinition.AppId), MessageBoxButtons.OK, MessageBoxIcon.Error); return 1; }
        }
    }

    internal static class SetupEngine
    {
        internal static bool ProtectedData(string path)
        {
            string first = UserInstallState.RelativePath(path).Split('/')[0];
            return new[] { "Data", "PreviousSetups", "profiles", "saves", "savegame", "cache", "logs", ".git", ".ugsm-player", ".ugsm-studio-transfer" }.Contains(first, StringComparer.OrdinalIgnoreCase);
        }
        internal static List<InstallFile> Inventory()
        {
            using (var reader = new StreamReader(Assembly.GetExecutingAssembly().GetManifestResourceStream("UGSM.Setup.Inventory")))
            {
                var files = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 }.Deserialize<List<InstallFile>>(reader.ReadToEnd());
                var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                if (files == null || files.Count == 0 || files.Count > 4096 || files.Sum(f => f.Size) > 512L * 1024 * 1024) throw new InvalidDataException("Ungültiges Programmpaket.");
                foreach (var file in files)
                {
                    file.Path = UserInstallState.RelativePath(file.Path);
                    if (!seen.Add(file.Path) || ProtectedData(file.Path) || file.Path == UserInstallState.MarkerName || file.Path == UserInstallState.UninstallerName || file.Size < 0 || file.Sha256 == null || file.Sha256.Length != 64 || file.Sha256.Any(c => !Uri.IsHexDigit(c))) throw new InvalidDataException("Unsicheres Programmpaket.");
                }
                if (!files.Any(f => f.Path == UserInstallState.ExeName(PackageDefinition.AppId))) throw new InvalidDataException("Hauptprogramm fehlt im Paket.");
                return files;
            }
        }
        internal static string PrivateDirectory(string parent, string name)
        {
            UserInstallState.NoLinks(parent);
            string path = Path.Combine(parent, name + Guid.NewGuid().ToString("N"));
            var acl = new DirectorySecurity(); acl.SetAccessRuleProtection(true, false);
            foreach (var sid in new[] { new SecurityIdentifier(UserInstallState.CurrentSid), new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null) })
                acl.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
            Directory.CreateDirectory(path, acl); return path;
        }
        internal static void DeleteOwnedTree(string parent, string path)
        {
            parent = Path.GetFullPath(parent).TrimEnd('\\'); path = Path.GetFullPath(path);
            if (!path.StartsWith(parent + "\\", StringComparison.OrdinalIgnoreCase) || Path.GetDirectoryName(path) != parent || (!Path.GetFileName(path).StartsWith(".ugsm-stage-") && !Path.GetFileName(path).StartsWith(".ugsm-rollback-"))) throw new InvalidDataException("Bereinigungsordner außerhalb der Setup-Arbeitsordner.");
            UserInstallState.NoLinks(path);
            if (Directory.Exists(path))
            {
                foreach (string child in Directory.EnumerateFileSystemEntries(path, "*", SearchOption.AllDirectories)) UserInstallState.NoLinks(child);
                Directory.Delete(path, true);
            }
        }
        internal static void Extract(string stage, List<InstallFile> files)
        {
            var expected = files.ToDictionary(f => f.Path, StringComparer.OrdinalIgnoreCase);
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("UGSM.Setup.Payload"))
            {
                if (stream == null || stream.Length > 128L * 1024 * 1024) throw new InvalidDataException("Programmpaket fehlt oder ist zu groß.");
                using (var hash = System.Security.Cryptography.SHA256.Create()) if (BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant() != PackageDefinition.PayloadSha256) throw new InvalidDataException("Die Prüfsumme des Programmpakets stimmt nicht.");
                stream.Position = 0;
                var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                using (var zip = new ZipArchive(stream, ZipArchiveMode.Read))
                {
                    if (zip.Entries.Count > 8192) throw new InvalidDataException("Zu viele ZIP-Einträge.");
                    foreach (var entry in zip.Entries)
                    {
                        if (entry.FullName.EndsWith("/")) { UserInstallState.RelativePath(entry.FullName.TrimEnd('/')); continue; }
                        string relative = UserInstallState.RelativePath(entry.FullName);
                        InstallFile expectedFile;
                        if (!expected.TryGetValue(relative, out expectedFile) || !seen.Add(relative) || entry.Length != expectedFile.Size || ((entry.ExternalAttributes >> 16) & 0xf000) == 0xa000 || (entry.ExternalAttributes & (int)FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("Unerwartete Datei im Programmpaket: " + relative);
                        string output = UserInstallState.Resolve(stage, relative); Directory.CreateDirectory(Path.GetDirectoryName(output));
                        using (var source = entry.Open()) using (var target = new FileStream(output, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                        {
                            byte[] buffer = new byte[65536]; long length = 0; int read;
                            while ((read = source.Read(buffer, 0, buffer.Length)) > 0) { length += read; if (length > expectedFile.Size) throw new InvalidDataException("Entpackte Datei zu groß."); target.Write(buffer, 0, read); }
                            if (length != expectedFile.Size) throw new InvalidDataException("Unvollständige Programmdatei.");
                        }
                        if (UserInstallState.Sha256(output) != expectedFile.Sha256) throw new InvalidDataException("Beschädigte Programmdatei: " + relative);
                    }
                }
                if (seen.Count != expected.Count) throw new InvalidDataException("Unvollständiges Programmpaket.");
            }
            using (var source = Assembly.GetExecutingAssembly().GetManifestResourceStream("UGSM.Setup.Uninstaller"))
            using (var target = new FileStream(UserInstallState.Resolve(stage, UserInstallState.UninstallerName), FileMode.CreateNew, FileAccess.Write)) source.CopyTo(target);
            if (UserInstallState.Sha256(UserInstallState.Resolve(stage, UserInstallState.UninstallerName)) != PackageDefinition.UninstallerSha256) throw new InvalidDataException("Deinstallationsprogramm beschädigt.");
        }
        internal static void ReplaceFile(string source, string target)
        {
            UserInstallState.NoLinks(target); Directory.CreateDirectory(Path.GetDirectoryName(target));
            string temporary = target + ".setup-" + Guid.NewGuid().ToString("N");
            try { File.Copy(source, temporary); if (File.Exists(target)) File.Replace(temporary, target, null); else File.Move(temporary, target); }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
        // The same transaction primitive is exercised with synthetic files by the headless tests.
        internal static void ApplyFiles(string stage, string root, string rollback, IEnumerable<string> paths, Action<int> afterCopy)
        {
            var changed = new List<KeyValuePair<string, bool>>();
            try
            {
                int index = 0;
                foreach (string relative in paths)
                {
                    string target = UserInstallState.Resolve(root, relative), source = UserInstallState.Resolve(stage, relative), backup = UserInstallState.Resolve(rollback, relative);
                    bool existed = File.Exists(target);
                    if (existed) { Directory.CreateDirectory(Path.GetDirectoryName(backup)); File.Copy(target, backup); }
                    changed.Add(new KeyValuePair<string, bool>(relative, existed));
                    ReplaceFile(source, target); if (afterCopy != null) afterCopy(++index);
                }
            }
            catch
            {
                foreach (var changedFile in changed.AsEnumerable().Reverse())
                {
                    string target = UserInstallState.Resolve(root, changedFile.Key);
                    if (changedFile.Value) ReplaceFile(UserInstallState.Resolve(rollback, changedFile.Key), target); else if (File.Exists(target)) File.Delete(target);
                }
                throw;
            }
        }
        internal static void ImportStudio(string stage, string oldRoot)
        {
            oldRoot = UserInstallState.RootPath(oldRoot);
            if (!File.Exists(UserInstallState.Resolve(oldRoot, "Enshrouded Mod Studio.exe"))) throw new InvalidDataException("Im gewählten bisherigen Ordner fehlt das Mod Studio.");
            var start = new ProcessStartInfo(UserInstallState.Resolve(stage, "Enshrouded Mod Studio.exe"), "--import-portable \"" + oldRoot + "\"") { WorkingDirectory = stage, UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true };
            using (var process = Process.Start(start))
            {
                var errors = process.StandardError.ReadToEndAsync();
                if (!process.WaitForExit(600000)) { try { process.Kill(); } catch { } throw new IOException("Die Übernahme wurde nicht innerhalb von zehn Minuten abgeschlossen. Der bisherige Ordner bleibt erhalten."); }
                string message = errors.GetAwaiter().GetResult();
                if (process.ExitCode != 0) throw new IOException("Bisheriges Setup konnte nicht übernommen werden: " + (message.Length > 2000 ? message.Substring(0, 2000) : message));
            }
        }
        internal static void MoveImportedData(string stage, string root)
        {
            string source = UserInstallState.Resolve(stage, "Data"), target = UserInstallState.Resolve(root, "Data");
            if (!Directory.Exists(source)) return;
            if (Directory.Exists(target) || File.Exists(target)) throw new IOException("Der Zielordner enthält bereits Benutzerdaten. Diese werden nicht überschrieben.");
            Directory.Move(source, target);
        }
        internal static void Install(string root, bool shortcut, Action<string> progress, string importRoot)
        {
            root = UserInstallState.RootPath(root);
            string registered = UserInstallState.RegisteredRoot(PackageDefinition.AppId);
            if (registered != null && !UserInstallState.Same(registered, root)) throw new InvalidDataException("Das Programm ist bereits unter " + registered + " installiert. Diesen Ordner für das Update verwenden.");
            InstallRecord old = null;
            if (registered != null && File.Exists(UserInstallState.Resolve(root, UserInstallState.MarkerName))) old = UserInstallState.ReadRegistered(PackageDefinition.AppId, root);
            else if (Directory.Exists(root) && Directory.EnumerateFileSystemEntries(root).Any()) throw new InvalidDataException("Bitte einen leeren eigenen Programmordner wählen. Vorhandene portable Programme werden nicht überschrieben.");
            if (old != null && new Version(PackageDefinition.Version) < new Version(old.Version)) throw new InvalidDataException("Eine neuere Version ist bereits installiert.");
            string parent = Path.GetDirectoryName(root); Directory.CreateDirectory(parent); UserInstallState.NoLinks(parent);
            string stage = PrivateDirectory(parent, ".ugsm-stage-"), rollback = PrivateDirectory(parent, ".ugsm-rollback-");
            bool committed = false, applied = false, importedData = false; List<string> copied = null;
            string marker = UserInstallState.Resolve(root, UserInstallState.MarkerName);
            string oldMarker = old == null ? null : UserInstallState.ToJson(old);
            string shortcutPath = old != null && !String.IsNullOrEmpty(old.ShortcutPath) ? old.ShortcutPath : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), UserInstallState.AppName(PackageDefinition.AppId) + ".lnk");
            byte[] previousShortcut = !String.IsNullOrEmpty(shortcutPath) && File.Exists(shortcutPath) ? File.ReadAllBytes(shortcutPath) : null;
            try
            {
                progress("Programmpaket vollständig prüfen …"); var inventory = Inventory(); Extract(stage, inventory);
                if (!String.IsNullOrWhiteSpace(importRoot))
                {
                    if (!String.Equals(PackageDefinition.AppId, "Enshrouded.ModStudio", StringComparison.Ordinal) || old != null || UserInstallState.Same(root, UserInstallState.RootPath(importRoot))) throw new InvalidDataException("Die Übernahme ist nur bei einer neuen Studio-Installation in einen anderen leeren Ordner möglich.");
                    progress("Profile, Einstellungen und Originalbasen aus dem bisherigen Studio übernehmen …"); ImportStudio(stage, importRoot);
                }
                string uninstall = UserInstallState.Resolve(stage, UserInstallState.UninstallerName);
                inventory.Add(new InstallFile { Path = UserInstallState.UninstallerName, Sha256 = UserInstallState.Sha256(uninstall), Size = new FileInfo(uninstall).Length });
                if (old != null) foreach (var prior in old.Files) if (!inventory.Any(f => UserInstallState.Same(f.Path, prior.Path))) inventory.Add(prior);
                copied = inventory.Where(f => File.Exists(UserInstallState.Resolve(stage, f.Path))).Select(f => f.Path).ToList();
                // Checked private runtime imported by Studio is copied transactionally, but remains user data.
                if (!String.IsNullOrWhiteSpace(importRoot)) foreach (string file in Directory.EnumerateFiles(stage, "*", SearchOption.AllDirectories))
                {
                    UserInstallState.NoLinks(file);
                    string relative = file.Substring(stage.Length + 1).Replace('\\', '/');
                    if (!copied.Contains(relative, StringComparer.OrdinalIgnoreCase) && relative.StartsWith("engine/", StringComparison.OrdinalIgnoreCase)) copied.Add(relative);
                }
                var copiedHashes = copied.ToDictionary(p => p, p => UserInstallState.Sha256(UserInstallState.Resolve(stage, p)), StringComparer.OrdinalIgnoreCase);
                RequireAppClosed(root);
                Directory.CreateDirectory(root); progress("Programmdateien installieren; Einstellungen bleiben erhalten …");
                ApplyFiles(stage, root, rollback, copied, null);
                applied = true;
                foreach (var file in copiedHashes)
                    if (UserInstallState.Sha256(UserInstallState.Resolve(root, file.Key)) != file.Value) throw new InvalidDataException("Installierte Programmdatei konnte nicht bestätigt werden: " + file.Key);
                if (Directory.Exists(UserInstallState.Resolve(stage, "Data"))) { MoveImportedData(stage, root); importedData = true; }
                var record = new InstallRecord { Format = 1, AppId = PackageDefinition.AppId, Version = PackageDefinition.Version, Root = root, OwnerSid = UserInstallState.CurrentSid, ShortcutPath = shortcut ? shortcutPath : null, Files = inventory };
                UserInstallState.AtomicText(marker, UserInstallState.ToJson(record));
                UserInstallState.Register(record);
                if (shortcut) CreateShortcut(shortcutPath, UserInstallState.Resolve(root, UserInstallState.ExeName(PackageDefinition.AppId)), root);
                committed = true; progress("Installation abgeschlossen.");
            }
            catch
            {
                // ApplyFiles rolls itself back on copy errors; only roll back completed copies here.
                if (applied)
                {
                    if (importedData) Directory.Move(UserInstallState.Resolve(root, "Data"), UserInstallState.Resolve(stage, "Data"));
                    foreach (string path in copied.AsEnumerable().Reverse())
                    {
                        string backup = UserInstallState.Resolve(rollback, path), target = UserInstallState.Resolve(root, path);
                        if (File.Exists(backup)) ReplaceFile(backup, target); else if (File.Exists(target)) File.Delete(target);
                    }
                    if (oldMarker == null) { if (File.Exists(marker)) File.Delete(marker); Registry.CurrentUser.DeleteSubKeyTree(UserInstallState.RegistryPrefix + PackageDefinition.AppId, false); }
                    else { UserInstallState.AtomicText(marker, oldMarker); UserInstallState.Register(old); }
                }
                if (!String.IsNullOrEmpty(shortcutPath)) { if (previousShortcut != null) File.WriteAllBytes(shortcutPath, previousShortcut); else if (File.Exists(shortcutPath)) File.Delete(shortcutPath); }
                throw;
            }
            finally { DeleteOwnedTree(parent, stage); if (committed) DeleteOwnedTree(parent, rollback); }
        }
        internal static void CreateShortcut(string path, string exe, string root)
        {
            if (String.IsNullOrEmpty(path)) throw new InvalidDataException("Startmenüpfad fehlt.");
            string programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
            if (!UserInstallState.Same(Path.GetDirectoryName(path), programs) || Path.GetFileName(path) != UserInstallState.AppName(PackageDefinition.AppId) + ".lnk") throw new InvalidDataException("Startmenüpfad außerhalb der Programmeinträge dieses Setups.");
            UserInstallState.NoLinks(path); Directory.CreateDirectory(programs);
            Type type = Type.GetTypeFromProgID("WScript.Shell"); object shell = Activator.CreateInstance(type), link = null;
            try
            {
                link = type.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { path }); Type t = link.GetType();
                t.InvokeMember("TargetPath", BindingFlags.SetProperty, null, link, new object[] { exe }); t.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, link, new object[] { root });
                t.InvokeMember("Description", BindingFlags.SetProperty, null, link, new object[] { UserInstallState.AppName(PackageDefinition.AppId) }); t.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
            }
            finally { if (link != null) System.Runtime.InteropServices.Marshal.FinalReleaseComObject(link); System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell); }
        }
        internal static Process ValidateProcess(string pidText, string ticksText, string expectedExe)
        {
            int pid; long ticks;
            if (!Int32.TryParse(pidText, out pid) || pid <= 0 || !Int64.TryParse(ticksText, out ticks) || ticks <= 0) throw new InvalidDataException("Ungültiger Updateprozess.");
            Process process;
            try { process = Process.GetProcessById(pid); }
            catch (ArgumentException) { return null; }
            if (process.StartTime.ToUniversalTime().Ticks != ticks || !UserInstallState.Same(Path.GetFullPath(process.MainModule.FileName), Path.GetFullPath(expectedExe))) { process.Dispose(); throw new InvalidDataException("Der wartende Prozess gehört nicht zur installierten Programmversion."); }
            return process;
        }
        internal static void WaitForProcess(string pid, string ticks, string expectedExe)
        {
            using (var process = ValidateProcess(pid, ticks, expectedExe)) if (process != null && !process.WaitForExit(120000)) throw new IOException("Das Programm wurde nicht beendet. Bitte schließen und das Update erneut starten.");
        }
        internal static void StartApp(string root) { Process.Start(new ProcessStartInfo(UserInstallState.Resolve(root, UserInstallState.ExeName(PackageDefinition.AppId)), PackageDefinition.AppId == "Enshrouded.ModStudio" ? "--after-update" : "") { WorkingDirectory = root, UseShellExecute = false }); }
        internal static void RequireAppClosed(string root)
        {
            string expected = UserInstallState.Resolve(root, UserInstallState.ExeName(PackageDefinition.AppId));
            foreach (var process in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(expected)))
            {
                using (process)
                {
                    try { if (UserInstallState.Same(process.MainModule.FileName, expected)) throw new IOException("Bitte zuerst " + UserInstallState.AppName(PackageDefinition.AppId) + " schließen."); }
                    catch (System.ComponentModel.Win32Exception) { throw new IOException("Ein laufender gleichnamiger Programmprozess konnte nicht geprüft werden. Bitte zuerst schließen."); }
                    catch (InvalidOperationException) { }
                }
            }
        }
        internal static int RemoveOwnedFiles(InstallRecord record)
        {
            int retained = 0;
            foreach (var file in record.Files)
            {
                if (ProtectedData(file.Path)) { retained++; continue; }
                string path = UserInstallState.Resolve(record.Root, file.Path);
                if (!File.Exists(path)) continue;
                if (new FileInfo(path).Length == file.Size && UserInstallState.Sha256(path) == file.Sha256) File.Delete(path); else retained++;
            }
            return retained;
        }
        internal static void Uninstall(InstallRecord record)
        {
            // No recursive root deletion: all unlisted/modified files, Data and saves survive.
            RequireAppClosed(record.Root);
            RemoveOwnedFiles(record);
            string marker = UserInstallState.Resolve(record.Root, UserInstallState.MarkerName); if (File.Exists(marker)) File.Delete(marker);
            if (!String.IsNullOrEmpty(record.ShortcutPath) && UserInstallState.Same(Path.GetDirectoryName(record.ShortcutPath), Environment.GetFolderPath(Environment.SpecialFolder.Programs)) && Path.GetFileName(record.ShortcutPath) == UserInstallState.AppName(record.AppId) + ".lnk")
            { UserInstallState.NoLinks(record.ShortcutPath); if (File.Exists(record.ShortcutPath)) File.Delete(record.ShortcutPath); }
            Registry.CurrentUser.DeleteSubKeyTree(UserInstallState.RegistryPrefix + record.AppId, false);
            if (Directory.Exists(record.Root))
            {
                foreach (string directory in record.Files.Select(f => Path.GetDirectoryName(UserInstallState.Resolve(record.Root, f.Path))).Distinct().OrderByDescending(p => p.Length))
                    if (Directory.Exists(directory) && !Directory.EnumerateFileSystemEntries(directory).Any()) Directory.Delete(directory);
                if (Directory.Exists(record.Root) && !Directory.EnumerateFileSystemEntries(record.Root).Any()) Directory.Delete(record.Root);
            }
        }
        internal static void LaunchUninstaller(InstallRecord record)
        {
            string work = PrivateDirectory(Path.GetDirectoryName(record.Root), ".ugsm-uninstall-");
            string helper = Path.Combine(work, "Uninstall.exe"); File.Copy(Assembly.GetExecutingAssembly().Location, helper);
            var process = Process.GetCurrentProcess();
            string args = "--uninstall-worker \"" + record.Root + "\" " + process.Id + " " + process.StartTime.ToUniversalTime().Ticks + " confirmed";
            Process.Start(new ProcessStartInfo(helper, args) { UseShellExecute = false, WorkingDirectory = work });
        }
    }

    internal sealed class SetupForm : Form
    {
        private readonly TextBox folder;
        private readonly Label status;
        private readonly Button install, browse;
        private readonly CheckBox shortcut;
        private readonly TextBox importFolder;
        private readonly ProgressBar progress;
        private bool busy, finished;
        private readonly InstallRecord uninstall;
        private readonly string waitPid, waitTicks;
        internal SetupForm() : this(null, null, null, null) { }
        internal SetupForm(InstallRecord record) : this(record.Root, null, null, record) { }
        internal SetupForm(string root, string pid, string ticks) : this(root, pid, ticks, null) { }
        private SetupForm(string root, string pid, string ticks, InstallRecord record)
        {
            uninstall = record; waitPid = pid; waitTicks = ticks;
            Text = UserInstallState.AppName(PackageDefinition.AppId) + (record == null ? " – Setup" : " – Deinstallieren");
            bool offerImport = String.Equals(PackageDefinition.AppId, "Enshrouded.ModStudio", StringComparison.Ordinal) && record == null && pid == null && UserInstallState.RegisteredRoot(PackageDefinition.AppId) == null;
            int extra = offerImport ? 80 : 0;
            ClientSize = new Size(650, 340 + extra); FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; StartPosition = FormStartPosition.CenterScreen; Font = new Font("Segoe UI", 10F);
            var heading = new Label { Text = record == null ? UserInstallState.AppName(PackageDefinition.AppId) + " installieren" : "Programm entfernen", Font = new Font("Segoe UI", 17F, FontStyle.Bold), Left = 24, Top = 20, Width = 600, Height = 40 };
            Controls.Add(heading);
            Controls.Add(new Label { Text = record == null ? "Version " + PackageDefinition.Version + " · Installation für deinen Windows-Benutzer" : "Profile, Einstellungen, Spielstände und veränderte Dateien bleiben erhalten.", Left = 26, Top = 68, Width = 596, Height = 44 });
            string existing = root ?? UserInstallState.RegisteredRoot(PackageDefinition.AppId);
            folder = new TextBox { Left = 26, Top = 124, Width = 488, Text = existing ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", PackageDefinition.AppId == "UGSM.Player" ? "UGSM-Player" : "Enshrouded-Mod-Studio"), ReadOnly = existing != null || record != null };
            Controls.Add(folder);
            browse = new Button { Left = 524, Top = 121, Width = 100, Height = 32, Text = "Ordner …", Enabled = existing == null && record == null };
            browse.Click += delegate { using (var dialog = new FolderBrowserDialog { Description = "Einen leeren eigenen Programmordner wählen", ShowNewFolderButton = true }) if (dialog.ShowDialog(this) == DialogResult.OK) folder.Text = dialog.SelectedPath; }; Controls.Add(browse);
            shortcut = new CheckBox { Text = "Verknüpfung im Startmenü erstellen", Left = 26, Top = 168, Width = 500, Checked = true, Visible = record == null }; Controls.Add(shortcut);
            importFolder = new TextBox { Left = 26, Top = 229, Width = 488, Visible = offerImport };
            if (offerImport)
            {
                Controls.Add(new Label { Text = "Bisheriges portables Mod Studio übernehmen (optional)", Left = 26, Top = 201, Width = 598, Height = 24 }); Controls.Add(importFolder);
                var importBrowse = new Button { Left = 524, Top = 226, Width = 100, Height = 32, Text = "Ordner …" };
                importBrowse.Click += delegate { using (var dialog = new FolderBrowserDialog { Description = "Bisherigen Studio-Ordner mit EXE und Data wählen", ShowNewFolderButton = false }) if (dialog.ShowDialog(this) == DialogResult.OK) importFolder.Text = dialog.SelectedPath; }; Controls.Add(importBrowse);
            }
            status = new Label { Left = 26, Top = 204 + extra, Width = 598, Height = 48, Text = pid == null ? "Du kannst einen eigenen Ordner wählen, beispielsweise auf H:." : "Update wird vorbereitet …" }; Controls.Add(status);
            progress = new ProgressBar { Left = 26, Top = 261 + extra, Width = 598, Height = 14 }; Controls.Add(progress);
            install = new Button { Left = 394, Top = 291 + extra, Width = 230, Height = 34, Text = record == null ? "Installieren" : "Deinstallieren" }; install.Click += async delegate { await Run(); }; Controls.Add(install);
            FormClosing += delegate(object sender, FormClosingEventArgs e) { if (busy) e.Cancel = true; };
            if (pid != null) Shown += async delegate { await Run(); };
        }
        private void SetStatus(string text) { if (IsHandleCreated) BeginInvoke(new Action(delegate { status.Text = text; })); }
        private async Task Run()
        {
            if (finished) { Close(); return; }
            if (busy) return; busy = true; install.Enabled = false; browse.Enabled = false; shortcut.Enabled = false; progress.Style = ProgressBarStyle.Marquee;
            string root = folder.Text;
            try
            {
                if (uninstall != null) { SetupEngine.LaunchUninstaller(uninstall); busy = false; Close(); return; }
                bool makeShortcut = shortcut.Checked;
                string import = importFolder.Visible ? importFolder.Text.Trim() : "";
                if (waitPid != null) await Task.Run(delegate { SetupEngine.WaitForProcess(waitPid, waitTicks, UserInstallState.Resolve(root, UserInstallState.ExeName(PackageDefinition.AppId))); });
                await Task.Run(delegate { SetupEngine.Install(root, makeShortcut, SetStatus, import); });
                if (waitPid != null) { SetupEngine.StartApp(root); busy = false; Close(); return; }
                status.Text = "Fertig. Du findest das Programm im Startmenü. Profile und Einstellungen bleiben bei künftigen Updates erhalten."; install.Text = "Schließen"; install.Enabled = true; finished = true;
            }
            catch (Exception error)
            {
                status.Text = "Vorgang abgebrochen: " + error.Message; install.Text = "Erneut versuchen"; install.Enabled = true;
                if (waitPid != null) { try { SetupEngine.StartApp(root); } catch { } }
            }
            finally { busy = false; progress.Style = ProgressBarStyle.Blocks; }
        }
    }
}
