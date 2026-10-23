using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace EnshroudedStudio
{
    public sealed class SetupTransferReport
    {
        public int ImportedProfiles { get; internal set; }
        public int ImportedRuntimeFiles { get; internal set; }
        public int ImportedBases { get; internal set; }
        public int SkippedBases { get; internal set; }
        public string SelectedProfileId { get; internal set; }
        public List<string> Notes = new List<string>();
        public List<Profile> Profiles = new List<Profile>();
        public override string ToString()
        {
            return ImportedProfiles + " Profile und " + ImportedBases + " geprüfte Archivbasen übernommen." +
                (ImportedRuntimeFiles > 0 ? " " + ImportedRuntimeFiles + " geprüfte Runtime-Dateien ergänzt; keine Spieldateien angewendet." : "") +
                (SkippedBases > 0 ? " " + SkippedBases + " bereits vorhandene Ziele wurden beibehalten." : "") +
                (Notes.Count > 0 ? Environment.NewLine + Environment.NewLine + string.Join(Environment.NewLine, Notes) : "");
        }
    }
    public static class SetupTransfer
    {
        internal static int TestFailAfterSteps = -1;
        private sealed class ProfilePlan { public string OldId, Name; public Dictionary<string, object> Config; }
        private sealed class BasisPlan
        {
            public string Id, Source, BasisName, StateFile, StateHash, Stage, Destination;
            public string[] Archives;
            public Dictionary<string, object> State, Hashes;
            public bool Skip, Published, ExistingEmptyTarget;
        }
        private static string Hash(string file)
        { using (var input = File.OpenRead(file)) using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(input)).Replace("-", "").ToLowerInvariant(); }
        private static string HashBytes(byte[] bytes)
        { using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(); }
        private static bool Digest(object value) { return value is string && Regex.IsMatch((string)value, "^[a-fA-F0-9]{64}$"); }
        private static string Child(string root, string relative)
        {
            if (string.IsNullOrWhiteSpace(relative) || Path.IsPathRooted(relative) || relative.Contains(":") || relative.Replace('\\', '/').Split('/').Any(p => p == ".." || p == "." || p.Length == 0 || p.TrimEnd(' ', '.') != p || p.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)) throw new InvalidDataException("Ungültiger Übernahmepfad.");
            string path = Path.GetFullPath(Path.Combine(root, relative));
            if (!path.StartsWith(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Übernahmepfad liegt außerhalb des gewählten Ordners.");
            return path;
        }
        private static void NoLinks(string root, string file)
        {
            string current = Path.GetFullPath(file), limit = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
            while (current.StartsWith(limit + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            {
                if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("Verknüpfte Übernahmedateien werden nicht verwendet: " + current);
                current = Path.GetDirectoryName(current);
            }
        }
        private static void Write(string file, object value)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(file)); string temp = Path.Combine(Path.GetDirectoryName(file), ".st-" + Guid.NewGuid().ToString("N").Substring(0, 12) + ".tmp");
            try { byte[] bytes = new UTF8Encoding(false).GetBytes(Json.Encode(value)); using (var stream = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None)) stream.Write(bytes, 0, bytes.Length); if (File.Exists(file)) File.Replace(temp, file, null); else File.Move(temp, file); }
            finally { if (File.Exists(temp)) File.Delete(temp); }
        }
        private static Dictionary<string, object> ArchiveHashes(object value, string[] expected, string label)
        {
            var original = Json.Object(value, label); if (original.Count != expected.Length || expected.Any(n => !original.ContainsKey(n)) || original.Any(p => !Digest(p.Value))) throw new InvalidDataException(label + ": genau die zwei passenden KFC-Archive mit SHA256-Prüfsummen werden benötigt.");
            var clean = new Dictionary<string, object>(); foreach (string name in expected) clean.Add(name, ((string)original[name]).ToLowerInvariant()); return clean;
        }
        private static string UniqueName(string name, HashSet<string> names)
        {
            name = name.Trim(); StudioStore.CheckName(name); string candidate = name; int index = 1;
            while (names.Contains(candidate)) { string suffix = index == 1 ? " (importiert)" : " (importiert " + index + ")"; candidate = name.Substring(0, Math.Min(name.Length, 80 - suffix.Length)) + suffix; index++; }
            names.Add(candidate); return candidate;
        }
        private static void ValidateNoPending(string oldData)
        {
            string jobs = Path.Combine(oldData, "patches", "jobs"); if (!Directory.Exists(jobs)) return;
            foreach (string dir in Directory.GetDirectories(jobs))
            {
                string file = Path.Combine(dir, "transaction.json"); NoLinks(oldData, file); if (!File.Exists(file)) continue;
                var journal = Json.Read(file); object status;
                if (journal.TryGetValue("status", out status) && ((string)status == "running" || (string)status == "recovery-required")) throw new InvalidOperationException("Im alten Setup gibt es einen unterbrochenen Archivtausch. Diesen dort zuerst zurücknehmen; danach das Setup erneut übernehmen.");
            }
        }
        private static BasisPlan Basis(string oldData, string directory, string targetRoot)
        {
            string id = Path.GetFileName(directory); if (!Regex.IsMatch(id, "^[a-fA-F0-9]{20}$")) throw new InvalidDataException("Ungültige Archivziel-ID: " + id);
            string stateFile = Child(directory, "state.json"); NoLinks(oldData, stateFile);
            byte[] stateBytes = File.ReadAllBytes(stateFile); var state = Json.Object(Json.Serializer().DeserializeObject(Encoding.UTF8.GetString(stateBytes).TrimStart('\uFEFF')), "Archivstatus"); object value;
            if (!state.TryGetValue("basis", out value) || !(value is string) || !Regex.IsMatch((string)value, "^basis-[0-9]+$")) throw new InvalidDataException("Ungültiger Basisordner für " + id);
            string basisName = (string)value, basis = Child(directory, basisName); NoLinks(oldData, basis);
            if (!Directory.Exists(basis)) throw new InvalidDataException("Gespeicherte Basis fehlt: " + id);
            if (!state.TryGetValue("exeHash", out value) || !Digest(value)) throw new InvalidDataException("Versionsprüfsumme der Basis fehlt: " + id);
            string exeHash = ((string)value).ToLowerInvariant();
            var raw = Json.Object(state["basisArchives"], "Basisprüfsummen");
            string prefix = raw.ContainsKey("enshrouded.kfc") ? "enshrouded" : "enshrouded_server";
            string[] names = { prefix + ".kfc", prefix + ".kfc_resources" };
            var hashes = ArchiveHashes(raw, names, "Basisprüfsummen"); var current = ArchiveHashes(state["currentArchives"], names, "Aktueller Archivstand");
            foreach (string name in names) { string archive = Child(basis, name); NoLinks(oldData, archive); if (!File.Exists(archive) || Hash(archive) != (string)hashes[name]) throw new InvalidDataException("Archivbasis beschädigt oder unvollständig: " + id + "/" + name); }
            var added = new List<object>(); object addedValue;
            if (state.TryGetValue("addedFiles", out addedValue))
            {
                var entries = addedValue as object[]; if (entries == null) throw new InvalidDataException("Ungültige Zusatzdateiliste: " + id); var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (object entry in entries) { var item = Json.Object(entry, "Zusatzdatei"); string name = item.ContainsKey("name") ? item["name"] as string : null; if (name == null || !Regex.IsMatch(name, "^" + prefix + "_[0-9]+\\.dat$") || !seen.Add(name) || !item.ContainsKey("sha256") || !Digest(item["sha256"])) throw new InvalidDataException("Ungültige Zusatzdatei für " + id); added.Add(new Dictionary<string, object> { { "name", name }, { "sha256", ((string)item["sha256"]).ToLowerInvariant() } }); }
            }
            var clean = new Dictionary<string, object> { { "basis", basisName }, { "exeHash", exeHash }, { "basisArchives", hashes }, { "currentArchives", current }, { "addedFiles", added.ToArray() }, { "lastJob", null } };
            if (state.TryGetValue("basisWasCurrentData", out value) && value is bool) clean["basisWasCurrentData"] = value;
            string destination = Child(targetRoot, id); bool skip = File.Exists(Child(destination, "state.json")), empty = false;
            if (File.Exists(destination)) throw new InvalidDataException("Am Ziel liegt eine Datei statt eines Archivzielordners: " + id);
            if (Directory.Exists(destination) && !skip) { if (Directory.EnumerateFileSystemEntries(destination).Any()) throw new InvalidDataException("Der neue Archivzielordner " + id + " enthält Daten, aber keinen aktiven Status. Bitte diesen Konflikt zuerst prüfen."); empty = true; }
            return new BasisPlan { Id = id, Source = basis, BasisName = basisName, Archives = names, State = clean, Hashes = hashes, StateFile = stateFile, StateHash = HashBytes(stateBytes), Destination = destination, Skip = skip, ExistingEmptyTarget = empty };
        }
        private static void RemoveCreatedTarget(BasisPlan p, string allowedRoot)
        {
            if (p.Published) { foreach (string name in p.Archives.Concat(new[] { "state.json" })) { string file = name == "state.json" ? Child(p.Destination, name) : Child(Child(p.Destination, p.BasisName), name); NoLinks(allowedRoot, file); if (File.Exists(file)) File.Delete(file); } string basis = Child(p.Destination, p.BasisName); if (Directory.Exists(basis)) Directory.Delete(basis, false); if (Directory.Exists(p.Destination)) Directory.Delete(p.Destination, false); }
            else if (p.Stage != null && Directory.Exists(p.Stage)) { foreach (string name in p.Archives) { string file = Child(Child(p.Stage, p.BasisName), name); if (File.Exists(file)) File.Delete(file); } string state = Child(p.Stage, "state.json"); if (File.Exists(state)) File.Delete(state); string basis = Child(p.Stage, p.BasisName); if (Directory.Exists(basis)) Directory.Delete(basis, false); Directory.Delete(p.Stage, false); }
        }
        public static SetupTransferReport Import(string oldAppRoot, StudioStore newStore)
        {
            if (newStore == null) throw new ArgumentNullException("newStore");
            string oldRoot = Path.GetFullPath(oldAppRoot), oldData = Child(oldRoot, "Data"), data = Path.GetFullPath(newStore.DataRoot);
            if (string.Equals(oldData.TrimEnd(Path.DirectorySeparatorChar), data.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Quelle und Ziel des Setups sind identisch.");
            var report = new SetupTransferReport();
            if (!Directory.Exists(oldData))
            {
                report.ImportedRuntimeFiles = RuntimeImport.Import(oldRoot, newStore.AppRoot);
                if (report.ImportedRuntimeFiles == 0) throw new InvalidDataException("Im ausgewählten alten Studioordner fehlt Data. Die aktuelle Runtime ist bereits vollständig. Bitte den bisherigen Mod-Studio-Ordner mit den Profilen wählen.");
                report.Notes.Add("Die fehlende Programm-Runtime wurde bereitgestellt. Die Quelle enthält keine Profile oder Archivbasis; die vorhandenen Profile bleiben erhalten."); return report;
            }
            NoLinks(oldRoot, oldData); ValidateNoPending(oldData);
            var profiles = new List<ProfilePlan>(); var names = new HashSet<string>(newStore.Profiles.Select(p => p.Name), StringComparer.OrdinalIgnoreCase);
            string oldProfiles = Child(oldData, "profiles"), oldTargets = Child(oldData, "patches/targets"), targetRoot = Child(data, "patches/targets"); NoLinks(data, targetRoot);
            if (Directory.Exists(oldProfiles)) foreach (string file in Directory.GetFiles(oldProfiles, "*.json").OrderBy(f => f, StringComparer.OrdinalIgnoreCase))
            {
                NoLinks(oldRoot, file);
                try { var doc = Json.Read(file); string name = doc.ContainsKey("name") ? doc["name"] as string : null; if (name == null) throw new InvalidDataException("Profilname fehlt."); profiles.Add(new ProfilePlan { OldId = Path.GetFileNameWithoutExtension(file), Name = UniqueName(name, names), Config = newStore.Normalize(Json.Object(doc["config"], "Altes Profil")) }); }
                catch (Exception ex) { throw new InvalidDataException("Altes Profil " + Path.GetFileName(file) + " kann nicht übernommen werden: " + ex.Message + " Bitte dieses Profil zuerst korrigieren. Es wurde noch nichts übernommen.", ex); }
            }
            var bases = new List<BasisPlan>(); if (Directory.Exists(oldTargets)) foreach (string dir in Directory.GetDirectories(oldTargets)) { NoLinks(oldRoot, dir); if (File.Exists(Path.Combine(dir, "state.json"))) bases.Add(Basis(oldData, dir, targetRoot)); }
            if (profiles.Count == 0 && bases.Count == 0)
            {
                report.ImportedRuntimeFiles = RuntimeImport.Import(oldRoot, newStore.AppRoot);
                if (report.ImportedRuntimeFiles == 0) throw new InvalidDataException("Das alte Data-Verzeichnis enthält weder Profile noch eine aktive Archivbasis. Die Runtime ist bereits vollständig.");
                report.Notes.Add("Nur die fehlende Programm-Runtime wurde ergänzt; vorhandene Profile bleiben erhalten. Keine Profile oder aktive Archivbasis in der Quelle gefunden."); return report;
            }
            string oldSelected = null, uiFile = Child(oldData, "ui.json"); if (File.Exists(uiFile)) { NoLinks(oldRoot, uiFile); var ui = Json.Read(uiFile); object selected; if (ui.TryGetValue("lastProfile", out selected)) oldSelected = selected as string; }
            foreach (var b in bases.Where(b => b.Skip)) { report.SkippedBases++; report.Notes.Add("Archivziel " + b.Id + " ist im neuen Setup bereits vorhanden und wurde nicht überschrieben."); }
            if (bases.Count == 0) report.Notes.Add("Keine gespeicherte Archivbasis gefunden, wie bei älteren Versionen bis 0.3.1. Bereits vorhandene Patches können damit nicht automatisch entfernt werden. Für eine vollständige neue Ausgangsbasis wird saubere, über Steam geprüfte Spieldateien benötigt.");
            report.ImportedRuntimeFiles = RuntimeImport.Import(oldRoot, newStore.AppRoot);
            string stage = Child(data, ".setup-" + Guid.NewGuid().ToString("N").Substring(0, 10)); int steps = 0; var created = new List<Profile>();
            try
            {
                Directory.CreateDirectory(stage);
                using (new FileStream(Child(data, ".setup-transfer.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None))
                {
                    foreach (var b in bases.Where(b => !b.Skip))
                    {
                        NoLinks(data, b.Destination); b.Stage = Child(stage, b.Id); string copied = Child(b.Stage, b.BasisName); Directory.CreateDirectory(copied);
                        foreach (string name in b.Archives) { string source = Child(b.Source, name), destination = Child(copied, name); File.Copy(source, destination, false); if (Hash(destination) != (string)b.Hashes[name] || Hash(source) != (string)b.Hashes[name]) throw new IOException("Basis wurde während der Übernahme verändert: " + b.Id); }
                        Write(Child(b.Stage, "state.json"), b.State);
                    }
                    foreach (var b in bases) if (Hash(b.StateFile) != b.StateHash) throw new IOException("Das alte Archivsetup wurde während der Übernahme geändert. Bitte den alten Patcher beenden und erneut versuchen.");
                    foreach (var p in profiles) { var imported = newStore.NewProfile(p.Name, p.Config); created.Add(imported); if (p.OldId == oldSelected) report.SelectedProfileId = imported.Id; if (++steps == TestFailAfterSteps) throw new IOException("INJECTED_SETUP_TRANSFER_FAILURE"); }
                    Directory.CreateDirectory(targetRoot);
                    foreach (var b in bases.Where(b => !b.Skip)) { NoLinks(data, b.Destination); if (b.ExistingEmptyTarget && Directory.Exists(b.Destination)) Directory.Delete(b.Destination, false); Directory.Move(b.Stage, b.Destination); b.Published = true; if (++steps == TestFailAfterSteps) throw new IOException("INJECTED_SETUP_TRANSFER_FAILURE"); }
                }
                Directory.Delete(stage, false);
            }
            catch (Exception failure)
            {
                var rollbackErrors = new List<string>();
                foreach (var b in bases.Where(b => !b.Skip).Reverse()) { try { RemoveCreatedTarget(b, data); if (b.ExistingEmptyTarget && !Directory.Exists(b.Destination)) Directory.CreateDirectory(b.Destination); } catch (Exception ex) { rollbackErrors.Add(ex.Message); } }
                foreach (var p in created.AsEnumerable().Reverse()) { try { string file = Child(Child(data, "profiles"), p.Id + ".json"); NoLinks(data, file); if (File.Exists(file)) File.Delete(file); newStore.Profiles.Remove(p); } catch (Exception ex) { rollbackErrors.Add(ex.Message); } }
                try { if (Directory.Exists(stage)) Directory.Delete(stage, false); } catch (Exception ex) { rollbackErrors.Add(ex.Message); }
                throw new InvalidOperationException("Profile und Archivbasen wurden nicht übernommen: " + failure.Message + (rollbackErrors.Count == 0 ? " Bereits neu angelegte Datendateien wurden zurückgenommen." : " Rücknahme unvollständig; Arbeitsdaten: " + stage + ". " + string.Join("; ", rollbackErrors)) + (report.ImportedRuntimeFiles > 0 ? " Die separat geprüften " + report.ImportedRuntimeFiles + " Runtime-Dateien bleiben bereitgestellt; es wurden keine Spieldateien angewendet." : ""), failure);
            }
            report.Profiles.AddRange(created); report.ImportedProfiles = created.Count; report.ImportedBases = bases.Count(b => !b.Skip);
            if (report.ImportedBases > 0) report.Notes.Add("Die geprüfte Basis bleibt erhalten, damit ein erneutes Anwenden Multiplikatoren nicht auf bereits gepatchte Daten stapelt. Die neue Vorschau kontrolliert zusätzlich den aktuellen Spiel- und Archivstand. Alte Vorschau-Jobs und alte Studio-Quellen wurden nicht übernommen.");
            return report;
        }
    }
}
