using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Web.Script.Serialization;
using Microsoft.Win32;

namespace UGSM.Installation
{
    internal sealed class InstallFile
    {
        public string Path { get; set; }
        public string Sha256 { get; set; }
        public long Size { get; set; }
    }

    internal sealed class InstallRecord
    {
        public int Format { get; set; }
        public string AppId { get; set; }
        public string Version { get; set; }
        public string Root { get; set; }
        public string OwnerSid { get; set; }
        public string ShortcutPath { get; set; }
        public List<InstallFile> Files { get; set; }
    }

    // Shared by the two per-user installers and the applications' existing updaters.
    internal static class UserInstallState
    {
        internal const string MarkerName = ".ugsm-install.json";
        internal const string UninstallerName = "Uninstall-UGSM.exe";
        internal const string RegistryPrefix = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\";
        internal static string CurrentSid { get { return WindowsIdentity.GetCurrent().User.Value; } }
        internal static string ExeName(string appId) { CheckAppId(appId); return appId == "UGSM.Player" ? "UGSM.Player.exe" : "Enshrouded Mod Studio.exe"; }
        internal static string AppName(string appId) { CheckAppId(appId); return appId == "UGSM.Player" ? "UGSM Spielerclient" : "Enshrouded Mod Studio"; }
        internal static void CheckAppId(string appId)
        {
            if (appId != "UGSM.Player" && appId != "Enshrouded.ModStudio") throw new InvalidDataException("Unbekannte Programmkennung.");
        }
        internal static string RootPath(string value)
        {
            if (String.IsNullOrWhiteSpace(value) || value.Length < 4 || !Char.IsLetter(value[0]) || value[1] != ':' || (value[2] != '\\' && value[2] != '/')) throw new InvalidDataException("Ein vollständiger Installationspfad ist erforderlich.");
            RelativePath(value.Substring(3).TrimEnd('\\', '/'));
            string p = System.IO.Path.GetFullPath(value).TrimEnd('\\', '/');
            if (p.StartsWith(@"\\", StringComparison.Ordinal) || p.Length < 4 || p[1] != ':' || p == System.IO.Path.GetPathRoot(p).TrimEnd('\\')) throw new InvalidDataException("Ein eigener lokaler Programmordner ist erforderlich.");
            RelativePath(p.Substring(3));
            string windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            if (!String.IsNullOrEmpty(windows) && (Same(p, windows) || p.StartsWith(windows.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase))) throw new InvalidDataException("Der Windows-Ordner ist kein Installationsziel.");
            NoLinks(p);
            return p;
        }
        internal static bool Same(string a, string b) { return String.Equals(a.TrimEnd('\\','/'), b.TrimEnd('\\','/'), StringComparison.OrdinalIgnoreCase); }
        internal static string RelativePath(string input)
        {
            if (String.IsNullOrWhiteSpace(input) || System.IO.Path.IsPathRooted(input) || input.IndexOf(':') >= 0) throw new InvalidDataException("Ungültiger relativer Programmpfad.");
            string normalized = input.Replace('\\', '/');
            string[] segments = normalized.Split('/');
            foreach (string s in segments)
            {
                if (s.Length == 0 || s == "." || s == ".." || s.TrimEnd(' ', '.') != s || s.IndexOfAny(System.IO.Path.GetInvalidFileNameChars()) >= 0) throw new InvalidDataException("Unsicherer Programmpfad: " + input);
                string device = s.Split('.')[0].ToUpperInvariant();
                if (device == "CON" || device == "PRN" || device == "AUX" || device == "NUL" || (device.Length == 4 && (device.StartsWith("COM") || device.StartsWith("LPT")) && device[3] >= '1' && device[3] <= '9')) throw new InvalidDataException("Reservierter Windows-Dateiname.");
            }
            return normalized;
        }
        internal static string Resolve(string root, string relative)
        {
            string full = System.IO.Path.GetFullPath(System.IO.Path.Combine(root, RelativePath(relative).Replace('/', '\\')));
            if (!full.StartsWith(root.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Datei außerhalb des Programmordners.");
            NoLinks(full);
            return full;
        }
        internal static void NoLinks(string path)
        {
            string cursor = System.IO.Path.GetFullPath(path);
            while (!String.IsNullOrEmpty(cursor))
            {
                try { if ((File.GetAttributes(cursor) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("Verknüpfte Ordner oder Dateien sind als Installationsziel nicht erlaubt: " + cursor); }
                catch (FileNotFoundException) { }
                catch (DirectoryNotFoundException) { }
                cursor = System.IO.Path.GetDirectoryName(cursor);
            }
        }
        internal static string Sha256(string path)
        {
            using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
        }
        internal static string ToJson(InstallRecord record) { return new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 }.Serialize(record); }
        internal static InstallRecord Parse(string json) { return new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 }.Deserialize<InstallRecord>(json); }
        internal static void Validate(InstallRecord record, string appId, string root, string sid)
        {
            CheckAppId(appId);
            Version version;
            if (record == null || record.Format != 1 || record.AppId != appId || !Same(record.Root ?? "", root) || record.OwnerSid != sid || !System.Version.TryParse(record.Version, out version) || record.Files == null || record.Files.Count > 4096) throw new InvalidDataException("Die Installationsbestätigung passt nicht zu diesem Programm, Ordner oder Windows-Benutzer.");
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var f in record.Files)
            {
                string p = RelativePath(f.Path);
                if (!seen.Add(p) || f.Size < 0 || f.Sha256 == null || f.Sha256.Length != 64 || f.Sha256.Any(c => !Uri.IsHexDigit(c)) || Same(p, MarkerName)) throw new InvalidDataException("Ungültiges Dateiverzeichnis der Installation.");
            }
        }
        internal static string RegisteredRoot(string appId)
        {
            CheckAppId(appId);
            using (var key = Registry.CurrentUser.OpenSubKey(RegistryPrefix + appId))
            {
                if (key == null) return null;
                string root = key.GetValue("InstallLocation") as string;
                if (String.IsNullOrEmpty(root)) throw new InvalidDataException("Die Windows-Installation enthält keinen Programmordner. Setup erneut ausführen.");
                return RootPath(root);
            }
        }
        internal static InstallRecord ReadRegistered(string appId, string root)
        {
            root = RootPath(root);
            string registered = RegisteredRoot(appId);
            string marker = Resolve(root, MarkerName);
            if (registered == null || !Same(root, registered))
            {
                if (File.Exists(marker)) throw new InvalidDataException("Der Installationsordner hat keine passende Windows-Registrierung. Setup erneut ausführen.");
                return null;
            }
            if (!File.Exists(marker)) throw new InvalidDataException("Die Installationsbestätigung fehlt. Setup erneut ausführen; Benutzerdaten bleiben erhalten.");
            if (new FileInfo(marker).Length > 4 * 1024 * 1024) throw new InvalidDataException("Installationsbestätigung zu groß.");
            InstallRecord record;
            try { record = Parse(File.ReadAllText(marker)); Validate(record, appId, root, CurrentSid); }
            catch (Exception e) { if (e is InvalidDataException) throw; throw new InvalidDataException("Installationsbestätigung unlesbar. Setup erneut ausführen.", e); }
            return record;
        }
        internal static bool IsRegistered(string appId, string root) { return ReadRegistered(appId, root) != null; }
        internal static void AtomicText(string path, string text)
        {
            NoLinks(path);
            string temp = path + ".new-" + Guid.NewGuid().ToString("N");
            try { File.WriteAllText(temp, text, new System.Text.UTF8Encoding(false)); if (File.Exists(path)) File.Replace(temp, path, null); else File.Move(temp, path); }
            finally { if (File.Exists(temp)) File.Delete(temp); }
        }
        internal static InstallRecord WithUpdatedFiles(InstallRecord record, string root, string version, IEnumerable<string> updatedFiles)
        {
            Version parsed;
            if (!System.Version.TryParse(version, out parsed)) throw new InvalidDataException("Ungültige Programmversion.");
            var copy = Parse(ToJson(record));
            var files = copy.Files.ToDictionary(f => RelativePath(f.Path), StringComparer.OrdinalIgnoreCase);
            foreach (string value in updatedFiles)
            {
                string relative = RelativePath(value);
                if (Same(relative, MarkerName)) throw new InvalidDataException("Die Installationsbestätigung ist keine Programmdatei.");
                string path = Resolve(root, relative);
                if (!File.Exists(path)) throw new FileNotFoundException("Aktualisierte Programmdatei fehlt.", path);
                files[relative] = new InstallFile { Path = relative, Size = new FileInfo(path).Length, Sha256 = Sha256(path) };
            }
            copy.Files = files.Values.OrderBy(f => f.Path, StringComparer.OrdinalIgnoreCase).ToList(); copy.Version = version;
            return copy;
        }
        internal static bool RefreshAfterUpdate(string appId, string root, string version, IEnumerable<string> updatedFiles)
        {
            var record = ReadRegistered(appId, root);
            if (record == null) return false;
            var updated = WithUpdatedFiles(record, root, version, updatedFiles);
            string oldText = ToJson(record), marker = Resolve(root, MarkerName);
            AtomicText(marker, ToJson(updated));
            try { using (var key = Registry.CurrentUser.OpenSubKey(RegistryPrefix + appId, true)) { if (key == null) throw new InvalidDataException("Windows-Registrierung verschwunden."); key.SetValue("DisplayVersion", version); } }
            catch { AtomicText(marker, oldText); throw; }
            return true;
        }
        internal static void Register(InstallRecord record)
        {
            Validate(record, record.AppId, RootPath(record.Root), CurrentSid);
            using (var key = Registry.CurrentUser.CreateSubKey(RegistryPrefix + record.AppId))
            {
                string uninstall = "\"" + Resolve(record.Root, UninstallerName) + "\"";
                key.SetValue("DisplayName", AppName(record.AppId)); key.SetValue("DisplayVersion", record.Version); key.SetValue("InstallLocation", record.Root);
                key.SetValue("UninstallString", uninstall); key.SetValue("Publisher", "Priestkiller / UGSM"); key.SetValue("DisplayIcon", Resolve(record.Root, ExeName(record.AppId)));
                key.SetValue("EstimatedSize", (int)Math.Min(Int32.MaxValue, record.Files.Sum(f => f.Size) / 1024), RegistryValueKind.DWord);
                key.SetValue("NoModify", 1, RegistryValueKind.DWord); key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        }
    }
}
