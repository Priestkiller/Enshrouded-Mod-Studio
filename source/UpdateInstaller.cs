using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Collections.Generic;
using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.IO.Compression;
using System.Threading.Tasks;
using Microsoft.CSharp;
using System.CodeDom.Compiler;

namespace EnshroudedStudio
{
    public sealed class UpdateInstallProgress
    {
        public string Stage;
        public string Message;
        public int Percent;
    }
    public sealed class UpdateInstallResult
    {
        public string AppRoot;
        public string DataRoot;
        public string ExecutablePath;
        public string ExecutableSha256;
        public string ReceiptPath;
        public int ProfilesCopied;
        public int BasesCopied;
        public int RuntimeFilesCopied;
        public long DataBytesCopied;
        public List<string> Notes = new List<string>();
    }

    // Installs beside the old application. This class never starts an executable
    // and never applies a game patch. The caller owns UI locking and handoff.
    public static class UpdateInstaller
    {
        public const long MaximumArchiveBytes = 512L * 1024 * 1024;
        public const long MaximumExpandedBytes = 1024L * 1024 * 1024;
        public const long MaximumDataBytes = 256L * 1024 * 1024 * 1024;
        public const int MaximumDataFiles = 250000;
        private const int MaximumZipEntries = 10000;
        private const string ExecutableName = "Enshrouded Mod Studio.exe";
        private static readonly Regex Digest = new Regex(@"^[a-fA-F0-9]{64}\z", RegexOptions.CultureInvariant);
        private static readonly Regex TargetId = new Regex(@"^[a-fA-F0-9]{20}\z", RegexOptions.CultureInvariant);
        private static readonly Regex ReservedName = new Regex(@"^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|\z)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        private sealed class CopyFile { public string Relative, Source, Sha256; public long Size; public DateTime Written; }
        private sealed class TreePlan { public List<CopyFile> Files = new List<CopyFile>(); public List<string> Directories = new List<string>(); public long Bytes; }
        private sealed class ZipPlan { public ZipArchiveEntry Entry; public string Relative; public bool Directory; }

        public static Task<UpdateInstallResult> InstallAsync(UpdateResult release, string oldAppRoot, string oldDataRoot, IProgress<UpdateInstallProgress> progress)
        {
            return Task.Run(delegate { return InstallCore(release, oldAppRoot, oldDataRoot, progress,
                delegate(string destination) { Download(release, destination, progress); }, RuntimeImport.Import); });
        }

        // Offline integration API: exactly the same digest, package, migration and
        // runtime checks as InstallAsync. Reads old EXE metadata, not this DLL's version.
        public static UpdateInstallResult InstallFromZip(string zipFile, UpdateResult release, string oldAppRoot, string oldDataRoot, IProgress<UpdateInstallProgress> progress)
        {
            return InstallCore(release, oldAppRoot, oldDataRoot, progress,
                delegate(string destination) { CopyVerifiedArchive(zipFile, destination, release); }, RuntimeImport.Import);
        }

        private static void Report(IProgress<UpdateInstallProgress> progress, string stage, string message, int percent)
        { if (progress != null) progress.Report(new UpdateInstallProgress { Stage = stage, Message = message, Percent = percent }); }

        private static string Hash(string file)
        { using (var input = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read)) using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(input)).Replace("-", "").ToLowerInvariant(); }

        private static string Full(string path) { return Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar); }
        private static bool Same(string first, string second) { return string.Equals(Full(first), Full(second), StringComparison.OrdinalIgnoreCase); }
        private static void NoLinks(string path)
        {
            string current = Path.GetFullPath(path);
            while (!string.IsNullOrEmpty(current))
            {
                if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidDataException("Verknüpfte oder noch nicht lokal verfügbare Updatepfade werden nicht verwendet: " + current);
                string parent = Path.GetDirectoryName(current); if (parent == current) break; current = parent;
            }
        }
        private static string Child(string root, string relative)
        {
            if (string.IsNullOrEmpty(relative) || relative.IndexOf('\\') >= 0 || Path.IsPathRooted(relative)) throw new InvalidDataException("Ungültiger Updatepfad.");
            foreach (string part in relative.Split('/'))
                if (part.Length == 0 || part == "." || part == ".." || part.TrimEnd(' ', '.') != part || part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || ReservedName.IsMatch(part))
                    throw new InvalidDataException("Ungültiger Updatepfad: " + relative);
            string full = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
            if (!full.StartsWith(Full(root) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Updatepfad liegt außerhalb des Zielordners: " + relative);
            if (full.Length > 240) throw new InvalidDataException("Der Updatepfad ist für Windows zu lang. Bitte den bisherigen Studioordner zuerst an einen kürzeren Pfad verschieben: " + relative);
            return full;
        }
        private static Dictionary<string, object> ReadJson(string file)
        {
            if (new FileInfo(file).Length > 16 * 1024 * 1024) throw new InvalidDataException("Die Update-Metadatei ist zu groß: " + Path.GetFileName(file));
            return Json.Read(file);
        }
        private static Version ExeVersion(string exe)
        {
            try { return UpdateCheck.ParseVersion(AssemblyName.GetAssemblyName(exe).Version.ToString()); }
            catch (Exception ex) { throw new InvalidDataException("Die Programmversion konnte nicht bestätigt werden: " + Path.GetFileName(exe), ex); }
        }
        private static void ValidateRelease(UpdateResult release, string oldRoot)
        {
            if (release == null || release.NoRelease || release.LatestVersion == null || release.InstalledVersion == null || !release.IsNewer || !release.AutomaticInstallAvailable)
                throw new InvalidDataException("Für die automatische Installation werden eine neuere Version, GitHubs SHA256-Prüfsumme und eine gültige ZIP-Größe benötigt.");
            if (!string.Equals(UpdateCheck.RepositoryFromPackage(oldRoot), release.Repository, StringComparison.Ordinal) ||
                release.AssetName != UpdateCheck.ExpectedAssetName(release.ReleaseTag) ||
                UpdateCheck.ParseVersion(release.ReleaseTag) != release.LatestVersion ||
                !UpdateCheck.IsAllowedAssetUrl(release.Repository, release.ReleaseTag, release.AssetName, release.DownloadUrl))
                throw new InvalidDataException("Die Updateinformationen passen nicht zu diesem Studio und seiner GitHub-Version.");
            string oldExe = Path.Combine(oldRoot, ExecutableName); NoLinks(oldExe);
            if (!File.Exists(oldExe) || ExeVersion(oldExe) != release.InstalledVersion)
                throw new InvalidDataException("Die installierte Programmversion wurde seit der Updateprüfung geändert. Bitte erneut nach Updates suchen.");
        }

        public static bool IsAllowedDownloadRedirect(string initialUrl, string nextUrl)
        {
            Uri initial, next;
            if (!Uri.TryCreate(initialUrl, UriKind.Absolute, out initial) || initial.Scheme != "https" || initial.Host != "github.com" || !initial.IsDefaultPort || initial.UserInfo.Length != 0 || initial.Query.Length != 0 || initial.Fragment.Length != 0) return false;
            if (!Uri.TryCreate(nextUrl, UriKind.Absolute, out next) || next.Scheme != "https" || !next.IsDefaultPort || next.UserInfo.Length != 0 || next.Fragment.Length != 0) return false;
            if (nextUrl == initialUrl) return true;
            if (next.Host != "release-assets.githubusercontent.com" && next.Host != "objects.githubusercontent.com") return false;
            return Regex.IsMatch(next.AbsolutePath, @"^/github-production-release-asset(?:-2e65be)?/[0-9]+/[a-fA-F0-9-]+\z", RegexOptions.CultureInvariant);
        }
        private static void Download(UpdateResult release, string destination, IProgress<UpdateInstallProgress> progress)
        {
            string url = release.DownloadUrl; ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            var clock = Stopwatch.StartNew(); int lastReportedPercent = 5;
            for (int redirects = 0; redirects <= 3; redirects++)
            {
                if (clock.Elapsed > TimeSpan.FromMinutes(5)) throw new TimeoutException("Der Update-Download hat zu lange gedauert. Der bisherige Studioordner bleibt erhalten.");
                var request = (HttpWebRequest)WebRequest.Create(url);
                request.AllowAutoRedirect = false; request.Timeout = 30000; request.ReadWriteTimeout = 30000;
                request.UserAgent = "Enshrouded-Mod-Studio/" + UpdateCheck.InstalledVersion;
                try
                {
                    using (var response = (HttpWebResponse)request.GetResponse())
                    {
                        int code = (int)response.StatusCode;
                        if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308)
                        {
                            Uri redirected;
                            if (redirects == 3 || !Uri.TryCreate(new Uri(url), response.Headers["Location"], out redirected) || !IsAllowedDownloadRedirect(release.DownloadUrl, redirected.AbsoluteUri))
                                throw new InvalidDataException("GitHub hat auf einen nicht erlaubten Downloadort umgeleitet.");
                            url = redirected.AbsoluteUri; continue;
                        }
                        if (response.StatusCode != HttpStatusCode.OK || (response.ContentLength >= 0 && response.ContentLength != release.AssetSize))
                            throw new InvalidDataException("Die Downloadgröße passt nicht zu den geprüften GitHub-Angaben.");
                        using (var input = response.GetResponseStream())
                        using (var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                        {
                            byte[] buffer = new byte[65536]; long total = 0; int read;
                            while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
                            {
                                total += read;
                                if (total > release.AssetSize || total > MaximumArchiveBytes || clock.Elapsed > TimeSpan.FromMinutes(5)) throw new InvalidDataException("Der ZIP-Download ist größer als erwartet oder wurde nicht rechtzeitig beendet.");
                                output.Write(buffer, 0, read);
                                int percent = 5 + (int)(20 * total / release.AssetSize);
                                if (percent != lastReportedPercent) { Report(progress, "download", "Update wird heruntergeladen …", percent); lastReportedPercent = percent; }
                            }
                            if (total != release.AssetSize) throw new InvalidDataException("Der Update-Download wurde nicht vollständig übertragen.");
                        }
                        VerifyArchive(destination, release); return;
                    }
                }
                catch (WebException ex) { throw new IOException("Der Update-Download konnte nicht abgeschlossen werden. Bitte die Verbindung prüfen und erneut versuchen.", ex); }
            }
            throw new InvalidDataException("Zu viele Downloadumleitungen.");
        }
        private static void VerifyArchive(string zip, UpdateResult release)
        {
            if (new FileInfo(zip).Length != release.AssetSize || Hash(zip) != release.Sha256)
                throw new InvalidDataException("Die SHA256-Prüfsumme oder Dateigröße des Updates stimmt nicht mit GitHub überein. Das ZIP wird nicht installiert.");
        }
        private static void CopyVerifiedArchive(string source, string destination, UpdateResult release)
        {
            NoLinks(source); VerifyArchive(source, release);
            using (var input = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None)) input.CopyTo(output);
            VerifyArchive(destination, release);
        }

        private static List<ZipPlan> InspectZip(ZipArchive archive, string payload)
        {
            if (archive.Entries.Count == 0 || archive.Entries.Count > MaximumZipEntries) throw new InvalidDataException("Das Update-ZIP enthält eine ungültige Anzahl von Einträgen.");
            bool flat = archive.Entries.Any(e => e.FullName == ExecutableName);
            string prefix = flat ? "" : archive.Entries[0].FullName.Split('/')[0] + "/";
            if (!flat && (!archive.Entries.All(e => e.FullName == prefix || e.FullName.StartsWith(prefix, StringComparison.Ordinal)) || !archive.Entries.Any(e => e.FullName == prefix + ExecutableName)))
                throw new InvalidDataException("Das Update-ZIP enthält keinen eindeutigen Studio-Hauptordner.");
            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var tree = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
            var result = new List<ZipPlan>(); long total = 0;
            foreach (var entry in archive.Entries)
            {
                // Validate the original archive spelling as well as the stripped path.
                // A single wrapper must not hide ../, absolute names, ADS or links.
                Child(payload, entry.FullName.TrimEnd('/'));
                int sourceType = (entry.ExternalAttributes >> 16) & 0xf000;
                if ((entry.ExternalAttributes & (int)FileAttributes.ReparsePoint) != 0 || (sourceType != 0 && sourceType != 0x8000 && sourceType != 0x4000))
                    throw new InvalidDataException("Verknüpfte oder spezielle Dateien sind im Update-ZIP nicht erlaubt.");
                string relative = entry.FullName.Substring(prefix.Length);
                if (relative.Length == 0) continue;
                bool directory = relative.EndsWith("/", StringComparison.Ordinal);
                if (directory) relative = relative.Substring(0, relative.Length - 1);
                Child(payload, relative);
                if (relative.Split('/')[0].Equals("Data", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Das Update-ZIP darf keine fremden Benutzerprofile oder einen Data-Ordner enthalten.");
                int unixType = (entry.ExternalAttributes >> 16) & 0xf000;
                if ((entry.ExternalAttributes & (int)FileAttributes.ReparsePoint) != 0 || (unixType != 0 && unixType != 0x8000 && unixType != 0x4000) || (unixType == 0x4000 && !directory) || (directory && unixType == 0x8000))
                    throw new InvalidDataException("Verknüpfte oder spezielle Dateien sind im Update-ZIP nicht erlaubt.");
                if (!names.Add(relative)) throw new InvalidDataException("Das Update-ZIP enthält doppelte oder nur in Großschreibung abweichende Pfade: " + relative);
                string[] parts = relative.Split('/');
                for (int i = 1; i <= parts.Length; i++)
                {
                    string key = string.Join("/", parts.Take(i)); bool isDirectory = i < parts.Length || directory, existing;
                    if (tree.TryGetValue(key, out existing) && existing != isDirectory) throw new InvalidDataException("Datei-/Ordnerkollision im Update-ZIP: " + relative);
                    tree[key] = isDirectory;
                }
                if (directory && entry.Length != 0) throw new InvalidDataException("Ein ZIP-Ordner enthält unerwartete Daten.");
                if (entry.Length < 0 || entry.Length > 256L * 1024 * 1024 || (total += entry.Length) > MaximumExpandedBytes || (!directory && entry.Length > 1024 * 1024 && entry.CompressedLength > 0 && entry.Length / entry.CompressedLength > 2000))
                    throw new InvalidDataException("Das Update-ZIP überschreitet die erlaubte entpackte Größe.");
                result.Add(new ZipPlan { Entry = entry, Relative = relative, Directory = directory });
            }
            return result;
        }
        private static void Extract(string zip, string payload)
        {
            using (var input = new FileStream(zip, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var archive = new ZipArchive(input, ZipArchiveMode.Read))
            {
                var plan = InspectZip(archive, payload); Directory.CreateDirectory(payload);
                foreach (var entry in plan)
                {
                    string file = Child(payload, entry.Relative); NoLinks(file);
                    if (entry.Directory) { Directory.CreateDirectory(file); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(file));
                    using (var source = entry.Entry.Open())
                    using (var output = new FileStream(file, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                    {
                        byte[] buffer = new byte[65536]; int count; long total = 0;
                        while ((count = source.Read(buffer, 0, buffer.Length)) > 0) { total += count; if (total > entry.Entry.Length) throw new InvalidDataException("Ein ZIP-Eintrag ist größer als angegeben."); output.Write(buffer, 0, count); }
                        if (total != entry.Entry.Length) throw new InvalidDataException("Ein ZIP-Eintrag ist unvollständig.");
                    }
                }
            }
        }
        private static void ValidatePackage(string root, UpdateResult release, bool runtimeReady)
        {
            foreach (string relative in new[] { ExecutableName, ExecutableName + ".config", "assets/MainWindow.xaml", "assets/defaults.json", "assets/schema.json", "assets/update.json", "engine/studio-runner.js", "engine/studio-backend.js", "engine/engine-manifest.json" })
                if (!File.Exists(Child(root, relative))) throw new InvalidDataException("Im Update fehlt eine benötigte Programmdatei: " + relative);
            if (ExeVersion(Child(root, ExecutableName)) != release.LatestVersion || UpdateCheck.RepositoryFromPackage(root) != release.Repository)
                throw new InvalidDataException("Das ZIP enthält nicht die angekündigte Studio-Version oder gehört zu einem anderen Repository.");
            var manifest = ReadJson(Child(root, "engine/engine-manifest.json")); object studio;
            if (!manifest.TryGetValue("studio", out studio) || !(studio is string) || UpdateCheck.ParseVersion((string)studio) != release.LatestVersion)
                throw new InvalidDataException("Die Engine-Dateiliste gehört nicht zur angekündigten Studio-Version.");
            var files = Json.Object(manifest["files"], "Update-Dateiliste");
            if (files.Count == 0 || !files.ContainsKey("studio-runner.js") || !files.ContainsKey("studio-backend.js")) throw new InvalidDataException("Die geprüfte Engine-Dateiliste fehlt.");
            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var pair in files)
            {
                string file = Child(Path.Combine(root, "engine"), pair.Key);
                if (!names.Add(pair.Key) || !(pair.Value is string) || !Digest.IsMatch((string)pair.Value)) throw new InvalidDataException("Ungültige oder doppelte Datei in der Update-Dateiliste.");
                if (!runtimeReady && pair.Key.StartsWith("vendor/", StringComparison.Ordinal) && !File.Exists(file)) continue;
                if (!File.Exists(file) || Hash(file) != ((string)pair.Value).ToLowerInvariant()) throw new InvalidDataException("Eine Programmdatei stimmt nicht mit der geprüften Update-Dateiliste überein: " + pair.Key);
            }
        }

        private static TreePlan PlanData(string root)
        {
            var plan = new TreePlan(); if (!Directory.Exists(root)) return plan;
            NoLinks(root); var pending = new Stack<KeyValuePair<string,int>>(); pending.Push(new KeyValuePair<string,int>(root,0));
            while (pending.Count > 0)
            {
                var current = pending.Pop(); if (current.Value > 32) throw new InvalidDataException("Der Setup-Ordner ist zu tief verschachtelt.");
                foreach (string entry in Directory.EnumerateFileSystemEntries(current.Key))
                {
                    NoLinks(entry); string relative = entry.Substring(Full(root).Length + 1).Replace('\\','/'); Child(root, relative);
                    if (plan.Files.Count + plan.Directories.Count >= MaximumDataFiles) throw new InvalidDataException("Das Setup enthält mehr als 250.000 Dateien und Ordner.");
                    if (Directory.Exists(entry)) { plan.Directories.Add(relative); pending.Push(new KeyValuePair<string,int>(entry,current.Value+1)); }
                    else
                    {
                        var info = new FileInfo(entry);
                        if (info.Length > 16L*1024*1024*1024 || plan.Files.Count >= MaximumDataFiles || (plan.Bytes += info.Length) > MaximumDataBytes) throw new InvalidDataException("Das Setup überschreitet die automatische Übernahmegrenze (250.000 Dateien / 256 GiB).");
                        plan.Files.Add(new CopyFile { Relative = relative, Source = entry, Size = info.Length, Written = info.LastWriteTimeUtc });
                    }
                }
            }
            return plan;
        }
        private static void NoPending(TreePlan plan)
        {
            foreach (var item in plan.Files)
            {
                if (Regex.IsMatch(item.Relative, @"^patches/targets/[a-fA-F0-9]{20}/operation\.lock\z", RegexOptions.IgnoreCase)) throw new InvalidOperationException("Im bisherigen Setup liegt eine Vorgangssperre. Bitte den laufenden Patcher beenden bzw. den unterbrochenen Vorgang dort zuerst prüfen.");
                if (!Regex.IsMatch(item.Relative, @"^patches/jobs/[^/]+/transaction\.json\z", RegexOptions.IgnoreCase) && !Regex.IsMatch(item.Relative, @"^patches/targets/[a-fA-F0-9]{20}/basis-renewals/[^/]+/journal\.json\z", RegexOptions.IgnoreCase)) continue;
                var journal = ReadJson(item.Source); object value;
                if (!journal.TryGetValue("status", out value) || !(value is string) || !new[] { "committed", "rolled-back", "rolled-back-recovered" }.Contains((string)value))
                    throw new InvalidOperationException("Im bisherigen Setup gibt es einen unterbrochenen oder unbekannten Archivtausch. Diesen dort zuerst prüfen und zurücknehmen; danach das Update erneut starten.");
            }
            if (plan.Directories.Any(p => p.Split('/').Any(n => n.StartsWith(".setup-",StringComparison.OrdinalIgnoreCase)))) throw new InvalidOperationException("Eine bisherige Setup-Übernahme ist nicht abgeschlossen. Bitte diesen Zustand zuerst prüfen.");
        }
        private static void CopyTree(TreePlan plan, string destination, IProgress<UpdateInstallProgress> progress)
        {
            Directory.CreateDirectory(destination);
            foreach (string directory in plan.Directories.OrderBy(p => p.Length)) Directory.CreateDirectory(Child(destination,directory));
            long copied = 0; int lastReportedPercent = 50;
            foreach (var item in plan.Files)
            {
                NoLinks(item.Source); string target = Child(destination,item.Relative); Directory.CreateDirectory(Path.GetDirectoryName(target));
                using (var input = new FileStream(item.Source, FileMode.Open, FileAccess.Read, FileShare.Read))
                using (var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                { if (input.Length != item.Size || File.GetLastWriteTimeUtc(item.Source) != item.Written) throw new IOException("Das bisherige Setup wurde während des Updates geändert."); input.CopyTo(output); }
                item.Sha256 = Hash(target);
                if (Hash(item.Source) != item.Sha256) throw new IOException("Eine Setup-Datei wurde während der Übernahme geändert oder nicht korrekt kopiert.");
                File.SetLastWriteTimeUtc(target,item.Written); copied += item.Size;
                int percent=50+(int)(30*copied/Math.Max(1,plan.Bytes));
                if(percent!=lastReportedPercent){Report(progress,"settings","Profile, Einstellungen und vollständige Sicherungen werden übernommen …",percent);lastReportedPercent=percent;}
            }
        }
        private static void AssertUnchanged(TreePlan original, string root)
        {
            var current = PlanData(root);
            if (current.Files.Count != original.Files.Count || current.Directories.Count != original.Directories.Count) throw new IOException("Das bisherige Setup wurde während des Updates geändert.");
            var byName = current.Files.ToDictionary(f => f.Relative,StringComparer.OrdinalIgnoreCase);
            foreach (var item in original.Files)
            { CopyFile now; if (!byName.TryGetValue(item.Relative,out now) || now.Size != item.Size || now.Written != item.Written) throw new IOException("Das bisherige Setup wurde während des Updates geändert."); }
            NoPending(current);
        }
        private static int ValidateProfiles(string appRoot, string data)
        {
            var store = new StudioStore(appRoot,data); string directory = Path.Combine(data,"profiles");
            string[] files = Directory.Exists(directory) ? Directory.GetFiles(directory,"*.json") : new string[0];
            if (files.Length == 0) throw new InvalidDataException("Im bisherigen Setup fehlen die Profile. Die automatische Übernahme wird nicht durch neue Standardprofile ersetzt.");
            var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string file in files)
            {
                string id = Path.GetFileNameWithoutExtension(file); Guid parsed;
                if (!Guid.TryParseExact(id,"N",out parsed) || !ids.Add(id)) throw new InvalidDataException("Eine Profil-ID ist ungültig oder doppelt.");
                var profile = ReadJson(file); object name;
                if (!profile.TryGetValue("name",out name) || !(name is string)) throw new InvalidDataException("Ein Profilname fehlt.");
                StudioStore.CheckName((string)name); store.NormalizeForEditing(Json.Object(profile["config"],"Profil-Konfiguration"));
            }
            string uiFile = Path.Combine(data,"ui.json");
            if (File.Exists(uiFile)) { var ui=ReadJson(uiFile); object last; if (!ui.TryGetValue("lastProfile",out last) || !(last is string) || !ids.Contains((string)last)) throw new InvalidDataException("Das ausgewählte Profil passt nicht zu den übernommenen Profil-IDs."); }
            store.Load();
            if (store.LoadErrors.Count != 0 || store.Profiles.Count != ids.Count || store.Profiles.Any(p => !ids.Contains(p.Id)) || (File.Exists(uiFile) && store.LastId != (string)ReadJson(uiFile)["lastProfile"]))
                throw new InvalidDataException("Die neue Version konnte das übernommene Setup nicht vollständig laden. Das bisherige Studio bleibt erhalten.");
            return ids.Count;
        }
        private static int ValidateBases(string data)
        {
            string targets = Path.Combine(data,"patches","targets"); if (!Directory.Exists(targets)) return 0; int count=0;
            foreach (string dir in Directory.GetDirectories(targets))
            {
                string stateFile=Path.Combine(dir,"state.json"); if (!File.Exists(stateFile)) continue;
                if (!TargetId.IsMatch(Path.GetFileName(dir))) throw new InvalidDataException("Eine aktive Archivziel-ID ist ungültig.");
                var state=ReadJson(stateFile); object basisValue, exe;
                if (!state.TryGetValue("basis",out basisValue) || !(basisValue is string) || !Regex.IsMatch((string)basisValue,@"^basis-[0-9]+\z") || !state.TryGetValue("exeHash",out exe) || !(exe is string) || !Digest.IsMatch((string)exe)) throw new InvalidDataException("Eine aktive Archivbasis besitzt ungültige Metadaten.");
                var hashes=Json.Object(state["basisArchives"],"Archivbasis"); var current=Json.Object(state["currentArchives"],"Aktueller Archivstand");
                string prefix=hashes.ContainsKey("enshrouded.kfc")?"enshrouded":"enshrouded_server"; string[] names={prefix+".kfc",prefix+".kfc_resources"};
                if (hashes.Count!=2 || current.Count!=2) throw new InvalidDataException("Eine Archivbasis enthält nicht die zwei passenden Archive.");
                foreach (string name in names)
                {
                    object expected, now; if (!hashes.TryGetValue(name,out expected) || !(expected is string) || !Digest.IsMatch((string)expected) || !current.TryGetValue(name,out now) || !(now is string) || !Digest.IsMatch((string)now)) throw new InvalidDataException("Die Archivprüfsummen sind unvollständig.");
                    string file=Child(dir,(string)basisValue+"/"+name); if (!File.Exists(file) || Hash(file)!=((string)expected).ToLowerInvariant()) throw new InvalidDataException("Eine gespeicherte Archivbasis ist beschädigt oder unvollständig.");
                }
                count++;
            }
            return count;
        }
        private static void ArchivePreviewLinks(string data, UpdateInstallResult result)
        {
            string patches=Path.Combine(data,"patches"); if (!Directory.Exists(patches)) return;
            foreach (string file in Directory.GetFiles(patches,"latest-*.json"))
            {
                if (!Regex.IsMatch(Path.GetFileName(file),@"^latest-[a-fA-F0-9]{20}\.json\z")) continue;
                string destination=Child(data,"updates/migrated-"+Path.GetFileNameWithoutExtension(file)+"-"+Guid.NewGuid().ToString("N").Substring(0,8)+".original.json");
                Directory.CreateDirectory(Path.GetDirectoryName(destination)); File.Move(file,destination);
            }
            result.Notes.Add("Die vollständige bisherige Data-Historie wurde übernommen. Alte Vorschauverweise bleiben als Originaldateien unter Data/updates erhalten; vor dem nächsten Anwenden wird eine neue Vorschau erstellt.");
        }
        private static void FreeSpace(string parent,long required)
        {
            string drive=Path.GetPathRoot(parent);
            var info=new DriveInfo(drive);
            if (info.IsReady && info.AvailableFreeSpace<required) throw new IOException("Für das Update und die vollständige Setup-Kopie ist nicht genügend freier Speicher vorhanden. Der bisherige Ordner bleibt unverändert.");
        }
        private static void DeleteWork(string parent,string work)
        {
            if (!Full(work).StartsWith(Full(parent)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase) || !Regex.IsMatch(Path.GetFileName(work),@"^\.studio-update-[a-f0-9]{32}\z")) throw new InvalidOperationException("Temporärer Updatepfad ist nicht eindeutig.");
            if (!Directory.Exists(work)) return;
            // Walk without following links before invoking recursive deletion on this owned workspace only.
            var pending=new Stack<string>(); pending.Push(work);
            while(pending.Count>0) foreach(string entry in Directory.EnumerateFileSystemEntries(pending.Pop())) { NoLinks(entry); if(Directory.Exists(entry))pending.Push(entry); }
            NoLinks(work); Directory.Delete(work,true);
        }

        private static UpdateInstallResult InstallCore(UpdateResult release,string oldAppRoot,string oldDataRoot,IProgress<UpdateInstallProgress> progress,Action<string> obtainZip,Func<string,string,int> importRuntime)
        {
            string oldRoot=Full(oldAppRoot), oldData=Full(oldDataRoot); NoLinks(oldRoot); NoLinks(oldData);
            if (!Directory.Exists(oldRoot) || !Same(oldData,Path.Combine(oldRoot,"Data"))) throw new InvalidDataException("Das bisherige Studio und sein Data-Ordner passen nicht zusammen.");
            ValidateRelease(release,oldRoot);
            string parent=Path.GetDirectoryName(oldRoot); if(string.IsNullOrEmpty(parent))throw new InvalidDataException("Neben diesem Studioordner kann kein neuer Versionsordner angelegt werden."); NoLinks(parent);
            string versionDirectory="Enshrouded-Mod-Studio-"+UpdateCheck.DisplayVersion(release.LatestVersion);
            string finalRoot=Child(parent,versionDirectory);
            // A failed startup may leave a valid prepared version beside the old one.
            // A retry gets a fresh sibling and never asks the user to delete that copy.
            for(int attempt=0;File.Exists(finalRoot)||Directory.Exists(finalRoot);attempt++)
            {
                if(attempt>=10)throw new IOException("Ein freier neuer Versionsordner konnte nicht angelegt werden.");
                finalRoot=Child(parent,versionDirectory+"-"+Guid.NewGuid().ToString("N").Substring(0,8));
            }
            var dataPlan=PlanData(oldData); NoPending(dataPlan);
            string oldConfig=Path.Combine(oldRoot,"engine","config.json"); NoLinks(oldConfig);
            string oldConfigHash=File.Exists(oldConfig)?Hash(oldConfig):null;
            FreeSpace(parent,dataPlan.Bytes+MaximumExpandedBytes+release.AssetSize+128L*1024*1024);
            string work=Child(parent,".studio-update-"+Guid.NewGuid().ToString("N")), payload=Path.Combine(work,"app"), zip=Path.Combine(work,"download.zip");
            var result=new UpdateInstallResult { AppRoot=finalRoot,DataRoot=Path.Combine(finalRoot,"Data"),ExecutablePath=Path.Combine(finalRoot,ExecutableName),DataBytesCopied=dataPlan.Bytes };
            bool published=false;
            try
            {
                Directory.CreateDirectory(work); Report(progress,"download","Update wird heruntergeladen und geprüft …",5); obtainZip(zip); VerifyArchive(zip,release);
                Report(progress,"extract","Geprüftes ZIP wird sicher entpackt …",30); Extract(zip,payload); ValidatePackage(payload,release,false);
                Report(progress,"runtime","Passende Laufzeitdateien werden geprüft und übernommen …",40); result.RuntimeFilesCopied=importRuntime(oldRoot,payload); ValidatePackage(payload,release,true);
                string data=Path.Combine(payload,"Data"); CopyTree(dataPlan,data,progress);
                result.ProfilesCopied=ValidateProfiles(payload,data); result.BasesCopied=ValidateBases(data);
                if(oldConfigHash!=null)
                {
                    var store=new StudioStore(payload,data); store.NormalizeForEditing(ReadJson(oldConfig));
                    string target=Path.Combine(payload,"engine","config.json"); File.Copy(oldConfig,target,true);
                    if(Hash(target)!=oldConfigHash||Hash(oldConfig)!=oldConfigHash)throw new IOException("Die bisherige Engine-Konfiguration wurde während des Updates verändert.");
                }
                AssertUnchanged(dataPlan,oldData); ArchivePreviewLinks(data,result);
                result.ExecutableSha256=Hash(Path.Combine(payload,ExecutableName));
                string receiptRelative="updates/install-"+Guid.NewGuid().ToString("N")+".json";
                Json.Write(Child(data,receiptRelative),new Dictionary<string,object>{{"format",1},{"version",UpdateCheck.DisplayVersion(release.LatestVersion)},{"repository",release.Repository},{"zipSha256",release.Sha256},{"oldAppRoot",oldRoot},{"newAppRoot",finalRoot},{"profiles",result.ProfilesCopied},{"bases",result.BasesCopied},{"runtimeFiles",result.RuntimeFilesCopied},{"dataBytes",result.DataBytesCopied},{"notes",result.Notes.ToArray()}},null);
                result.ReceiptPath=Path.Combine(result.DataRoot,receiptRelative.Replace('/',Path.DirectorySeparatorChar));
                Report(progress,"publish","Neue Version und übernommenes Setup sind geprüft …",95);
                NoLinks(parent); NoLinks(finalRoot); if(File.Exists(finalRoot)||Directory.Exists(finalRoot))throw new IOException("Der neue Versionsordner wurde inzwischen angelegt. Es wird nichts überschrieben.");
                Directory.Move(payload,finalRoot); published=true; Report(progress,"ready","Neue Version ist bereit zum bestätigten Start.",100);
                return result;
            }
            finally
            {
                try { DeleteWork(parent,work); }
                catch(Exception ex) { if(published)result.Notes.Add("Temporäre Updatedateien konnten nicht vollständig entfernt werden: "+ex.Message); else throw new IOException("Die Updatevorbereitung ist fehlgeschlagen. Der bisherige Ordner bleibt erhalten. Temporäre Dateien konnten nicht vollständig entfernt werden: "+work,ex); }
            }
        }

        private static bool Rejected(Action action)
        { try{action();return false;}catch(InvalidDataException){return true;}catch(InvalidOperationException){return true;}catch(IOException){return true;} }
        private static void MakeZip(string file,Dictionary<string,byte[]> files,Action<ZipArchive> extra)
        {
            using(var output=new FileStream(file,FileMode.CreateNew,FileAccess.Write))using(var zip=new ZipArchive(output,ZipArchiveMode.Create))
            { foreach(var pair in files){var entry=zip.CreateEntry(pair.Key,CompressionLevel.Fastest);using(var stream=entry.Open())stream.Write(pair.Value,0,pair.Value.Length);} if(extra!=null)extra(zip); }
        }
        private static byte[] Bytes(string text){return new UTF8Encoding(false).GetBytes(text);}
        private static void DeleteFixture(string parent,string root)
        {
            if(!Same(Path.GetDirectoryName(root),parent) || !Regex.IsMatch(Path.GetFileName(root),@"^uf-[a-f0-9]{8}\z"))throw new InvalidOperationException("Unbekannter Update-Testordner.");
            if(!Directory.Exists(root))return;
            var pending=new Stack<string>();pending.Push(root);
            while(pending.Count>0)foreach(string entry in Directory.EnumerateFileSystemEntries(pending.Pop())){NoLinks(entry);if(Directory.Exists(entry))pending.Push(entry);}
            NoLinks(root);Directory.Delete(root,true);
        }
        // Offline, bounded fixtures. No downloaded binary is executed; one tiny old-version EXE is only compiled for metadata checks.
        public static void SelfTest(Action<bool,string> check,string appRoot,string sandbox)
        {
            string fixtureParent=Full(Path.GetDirectoryName(sandbox));
            string root=Child(fixtureParent,"uf-"+Guid.NewGuid().ToString("N").Substring(0,8));Directory.CreateDirectory(root);
            try
            {
            string old=Path.Combine(root,"old");Directory.CreateDirectory(Path.Combine(old,"engine"));Directory.CreateDirectory(Path.Combine(old,"assets"));
            using(var compiler=new CSharpCodeProvider())
            {
                var options=new CompilerParameters { GenerateExecutable=true,OutputAssembly=Path.Combine(old,ExecutableName),CompilerOptions="/target:winexe /platform:x64" };
                var output=compiler.CompileAssemblyFromSource(options,"using System.Reflection;[assembly:AssemblyVersion(\"0.0.0.1\")]class Fixture{static void Main(){}}");
                if(output.Errors.HasErrors)throw new Exception("Update fixture EXE could not be compiled.");
            }
            const string repository="Priestkiller/Enshrouded-Mod-Studio";
            File.WriteAllText(Path.Combine(old,"assets","update.json"),"{\"repository\":\""+repository+"\"}");
            string oldData=Path.Combine(old,"Data");var sourceStore=new StudioStore(appRoot,oldData);sourceStore.Load();sourceStore.Select(sourceStore.Profiles[1].Id);
            sourceStore.Profiles[1].Config["updateUnknownFixture"]=new Dictionary<string,object>{{"keep",42}};sourceStore.Save(sourceStore.Profiles[1]);
            File.WriteAllText(Path.Combine(old,"engine","config.json"),Json.Encode(sourceStore.Profiles[1].Config));
            string job="patches/jobs/123456-abcdef";Directory.CreateDirectory(Child(oldData,job));File.WriteAllText(Child(oldData,job+"/transaction.json"),"{\"status\":\"committed\",\"unknown\":123}");File.WriteAllText(Child(oldData,job+"/history.bin"),"KEEP HISTORY");
            string latest="patches/latest-"+new string('a',20)+".json";File.WriteAllText(Child(oldData,latest),"{\"job\":\"123456-abcdef\",\"unknown\":77}");
            Directory.CreateDirectory(Path.Combine(oldData,"backups"));File.WriteAllText(Path.Combine(oldData,"backups","custom.txt"),"KEEP BACKUP");
            Version version=ExeVersion(Path.Combine(appRoot,ExecutableName));string tag="v"+UpdateCheck.DisplayVersion(version);
            var files=new Dictionary<string,byte[]>();
            foreach(string name in new[]{ExecutableName,ExecutableName+".config","assets/MainWindow.xaml","assets/defaults.json","assets/schema.json"})files.Add(name,File.ReadAllBytes(Child(appRoot,name)));
            files.Add("assets/update.json",Bytes("{\"repository\":\""+repository+"\"}"));
            files.Add("engine/studio-runner.js",Bytes("HARMLESS RUNNER FIXTURE"));files.Add("engine/studio-backend.js",Bytes("HARMLESS BACKEND FIXTURE"));
            var manifestFiles=new Dictionary<string,object>();foreach(string name in new[]{"studio-runner.js","studio-backend.js"})using(var sha=SHA256.Create())manifestFiles[name]=BitConverter.ToString(sha.ComputeHash(files["engine/"+name])).Replace("-","").ToLowerInvariant();
            files.Add("engine/engine-manifest.json",Bytes(Json.Encode(new Dictionary<string,object>{{"studio",UpdateCheck.DisplayVersion(version)},{"files",manifestFiles}})));
            string good=Path.Combine(root,"good.zip");MakeZip(good,files,null);
            var release=new UpdateResult{Repository=repository,InstalledVersion=UpdateCheck.ParseVersion("0.0.0.1"),LatestVersion=version,ReleaseTag=tag,AssetName=UpdateCheck.ExpectedAssetName(tag),AssetSize=new FileInfo(good).Length,Sha256=Hash(good)};release.DownloadUrl="https://github.com/"+repository+"/releases/download/"+tag+"/"+release.AssetName;
            string initial=release.DownloadUrl;
            check(IsAllowedDownloadRedirect(initial,"https://release-assets.githubusercontent.com/github-production-release-asset/123/abc-def?sig=fixture")&&!IsAllowedDownloadRedirect(initial,"https://evil.example/file.zip")&&!IsAllowedDownloadRedirect(initial,"http://release-assets.githubusercontent.com/github-production-release-asset/123/abc-def")&&!IsAllowedDownloadRedirect(initial,"https://objects.githubusercontent.com/unrelated/file.zip"),"Auto-Update begrenzt HTTPS-Weiterleitungen auf GitHubs Release-CDNs");
            check(Rejected(delegate{var bad=new UpdateResult{AssetSize=release.AssetSize,Sha256=new string('0',64)};VerifyArchive(good,bad);}),"Auto-Update verwirft ZIPs mit falscher SHA256-Prüfsumme");
            string slip=Path.Combine(root,"slip.zip");MakeZip(slip,files,delegate(ZipArchive z){z.CreateEntry("../outside.txt");});
            check(Rejected(delegate{Extract(slip,Path.Combine(root,"slip-output"));})&&!Directory.Exists(Path.Combine(root,"slip-output")),"Auto-Update lehnt ZIP-Traversal vor der ersten Extraktion ab");
            string collision=Path.Combine(root,"collision.zip");MakeZip(collision,files,delegate(ZipArchive z){z.CreateEntry("ASSETS/schema.json");});
            check(Rejected(delegate{Extract(collision,Path.Combine(root,"collision-output"));}),"Auto-Update lehnt doppelte Windows-Pfade im ZIP ab");
            string link=Path.Combine(root,"link.zip");MakeZip(link,files,delegate(ZipArchive z){var e=z.CreateEntry("link");e.ExternalAttributes=unchecked((int)(0xa1ffu<<16));});
            check(Rejected(delegate{Extract(link,Path.Combine(root,"link-output"));}),"Auto-Update lehnt ZIP-Verknüpfungen ab");
            string transaction=Child(oldData,job+"/transaction.json");File.WriteAllText(transaction,"{\"status\":\"running\"}");check(Rejected(delegate{NoPending(PlanData(oldData));}),"Auto-Update blockiert unterbrochene Archivtauschvorgänge");File.WriteAllText(transaction,"{\"status\":\"committed\",\"unknown\":123}");
            var before=PlanData(oldData);foreach(var item in before.Files)item.Sha256=Hash(item.Source);string configHash=Hash(Path.Combine(old,"engine","config.json"));
            var installed=InstallCore(release,old,oldData,null,delegate(string target){CopyVerifiedArchive(good,target,release);},delegate(string from,string to){return 0;});
            var migratedStore=new StudioStore(installed.AppRoot,installed.DataRoot);migratedStore.Load();
            check(installed.ProfilesCopied==sourceStore.Profiles.Count&&migratedStore.LastId==sourceStore.LastId&&migratedStore.Profiles.Select(p=>p.Id).OrderBy(p=>p).SequenceEqual(sourceStore.Profiles.Select(p=>p.Id).OrderBy(p=>p))&&migratedStore.Profiles.Any(p=>p.Config.ContainsKey("updateUnknownFixture"))&&Hash(Path.Combine(installed.AppRoot,"engine","config.json"))==configHash,"Auto-Update erhält Profil-IDs, Auswahl, unbekannte Einstellungen und Engine-Konfiguration");
            check(before.Files.All(item=>Hash(item.Source)==item.Sha256)&&!File.Exists(Child(installed.DataRoot,latest))&&Directory.GetFiles(Path.Combine(installed.DataRoot,"updates"),"migrated-latest-*.original.json").Any()&&File.ReadAllText(Child(installed.DataRoot,job+"/history.bin"))=="KEEP HISTORY"&&File.ReadAllText(Path.Combine(installed.DataRoot,"backups","custom.txt"))=="KEEP BACKUP","Auto-Update lässt das alte Setup unverändert und bewahrt Historie mit sicher archivierten Vorschauverweisen");
            var repeated=InstallCore(release,old,oldData,null,delegate(string target){CopyVerifiedArchive(good,target,release);},delegate(string from,string to){return 0;});
            check(repeated.AppRoot!=installed.AppRoot&&File.Exists(installed.ExecutablePath)&&File.Exists(repeated.ExecutablePath)&&Hash(installed.ExecutablePath)==installed.ExecutableSha256,"Auto-Update verwendet beim Wiederholen einen neuen Ordner und erhält die vorherige vorbereitete Version");
            string extracted=Path.Combine(root,"wrong-version");Extract(good,extracted);var wrong=new UpdateResult{LatestVersion=UpdateCheck.ParseVersion("99.0.0"),Repository=repository};check(Rejected(delegate{ValidatePackage(extracted,wrong,false);}),"Auto-Update lehnt falsche EXE- und Paketversionen ab");
            }
            finally { DeleteFixture(fixtureParent,root); }
        }
    }
}
