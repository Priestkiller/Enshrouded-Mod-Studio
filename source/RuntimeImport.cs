using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace EnshroudedStudio
{
    public static class RuntimeImport
    {
        public const string VerifiedParserSha256 = "b65d0558d09c1f0793e70ec50a76d9a06c3cc1a177b3185895b2c2ba1150250f";
        internal static int TestFailAfterCopies = -1;
        private static string Hash(string file)
        { using (var input = File.OpenRead(file)) using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(input)).Replace("-", "").ToLowerInvariant(); }
        private static string Child(string root, string relative)
        {
            if (string.IsNullOrWhiteSpace(relative) || Path.IsPathRooted(relative) || relative.Contains(":") || relative.Contains("\\") || relative.Split('/').Any(p => p == ".." || p == "." || p.Length == 0 || p.TrimEnd(' ', '.') != p || p.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)) throw new InvalidDataException("Ungültiger Runtime-Pfad.");
            string full = Path.GetFullPath(Path.Combine(root, relative));
            if (!full.StartsWith(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Runtime-Pfad liegt außerhalb des Studioordners.");
            return full;
        }
        private static void NoLinks(string root, string file)
        {
            string limit = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar), current = Path.GetFullPath(file);
            while (string.Equals(current, limit, StringComparison.OrdinalIgnoreCase) || current.StartsWith(limit + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            {
                if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("Verknüpfte Runtime-Pfade werden nicht verwendet: " + current);
                if (string.Equals(current, limit, StringComparison.OrdinalIgnoreCase)) break;
                current = Path.GetDirectoryName(current);
            }
        }
        private static Dictionary<string, string> Expected(string appRoot)
        {
            string engine = Path.GetFullPath(Path.Combine(appRoot, "engine"));
            var expected = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { { "enshrouded-patcher.exe", StudioStore.VerifiedEngineSha256 }, { "bin/kfc-parser.exe", VerifiedParserSha256 } };
            var manifest = Json.Read(Child(engine, "engine-manifest.json"));
            var files = Json.Object(manifest["files"], "Runtime-Manifest");
            foreach (var entry in files.Where(p => p.Key.StartsWith("vendor/", StringComparison.Ordinal)))
            {
                Child(engine, entry.Key);
                if (!(entry.Value is string) || !Regex.IsMatch((string)entry.Value, "^[a-fA-F0-9]{64}$")) throw new InvalidDataException("Ungültige Runtime-Prüfsumme: " + entry.Key);
                expected.Add(entry.Key, ((string)entry.Value).ToLowerInvariant());
            }
            if (expected.Count <= 2) throw new InvalidDataException("Die geprüfte Vendor-Dateiliste fehlt im aktuellen Studio-Manifest.");
            return expected;
        }
        public static int CountExpectedMissing(string appRoot)
        {
            string engine = Path.GetFullPath(Path.Combine(appRoot, "engine"));
            return Expected(appRoot).Count(p => !File.Exists(Child(engine, p.Key)));
        }
        public static int Import(string oldAppRoot, string appRoot)
        { return ImportExpected(Path.GetFullPath(Path.Combine(oldAppRoot, "engine")), Path.GetFullPath(Path.Combine(appRoot, "engine")), Expected(appRoot)); }
        private static int ImportExpected(string sourceRoot, string targetRoot, Dictionary<string, string> expected)
        {
            var missing = new List<string>(); var created = new List<string>();
            foreach (var entry in expected)
            {
                string target = Child(targetRoot, entry.Key); NoLinks(targetRoot, target);
                if (Directory.Exists(target)) throw new InvalidDataException("Eine Runtime-Datei ist durch einen Ordner blockiert: " + entry.Key);
                if (File.Exists(target)) { if (Hash(target) != entry.Value) throw new InvalidDataException("Vorhandene Runtime-Datei weicht von der geprüften Version ab und wird nicht überschrieben: " + entry.Key); }
                else missing.Add(entry.Key);
            }
            foreach (string name in missing)
            {
                string source = Child(sourceRoot, name); NoLinks(sourceRoot, source);
                if (!File.Exists(source) || Hash(source) != expected[name]) throw new InvalidDataException("Im alten Studio fehlt die passende geprüfte Runtime-Datei oder ihre Prüfsumme weicht ab: " + name + ". Bitte einen vollständigen bisherigen Studioordner wählen.");
            }
            try
            {
                foreach (string name in missing)
                {
                    string target = Child(targetRoot, name), source = Child(sourceRoot, name); NoLinks(sourceRoot, source); NoLinks(targetRoot, target);
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    string temp = Child(targetRoot, name + ".ri-" + Guid.NewGuid().ToString("N").Substring(0, 8));
                    try
                    {
                        using (var input = File.OpenRead(source)) using (var output = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None)) input.CopyTo(output);
                        if (Hash(temp) != expected[name]) throw new IOException("Die Runtime-Quelle wurde während der Übernahme verändert: " + name);
                        NoLinks(targetRoot, target); File.Move(temp, target); created.Add(name);
                        if (created.Count == TestFailAfterCopies) throw new IOException("INJECTED_RUNTIME_IMPORT_FAILURE");
                    }
                    finally { if (File.Exists(temp)) { NoLinks(targetRoot, temp); File.Delete(temp); } }
                }
                return created.Count;
            }
            catch (Exception failure)
            {
                var errors = new List<string>();
                foreach (string name in created.AsEnumerable().Reverse()) try { string target = Child(targetRoot, name); NoLinks(targetRoot, target); if (File.Exists(target)) { if (Hash(target) != expected[name]) throw new IOException("Nachträglich veränderte Datei bleibt erhalten: " + name); File.Delete(target); } } catch (Exception ex) { errors.Add(ex.Message); }
                throw new InvalidOperationException("Runtime nicht übernommen: " + failure.Message + (errors.Count == 0 ? " Neu kopierte Dateien wurden zurückgenommen." : " Rücknahme unvollständig: " + string.Join("; ", errors)), failure);
            }
        }
        public static void SelfTest(Action<bool, string> check, string sandbox)
        {
            string root = Path.Combine(sandbox, "runtime-fixture"), source = Path.Combine(root, "old"), target = Path.Combine(root, "new");
            var expected = new Dictionary<string, string>();
            foreach (string name in new[] { "enshrouded-patcher.exe", "bin/kfc-parser.exe", "vendor/test.js.bytecode" }) { string file = Child(source, name); Directory.CreateDirectory(Path.GetDirectoryName(file)); File.WriteAllText(file, "HARMLESS FIXTURE " + name); expected.Add(name, Hash(file)); }
            Directory.CreateDirectory(target); File.WriteAllText(Path.Combine(target, "studio-runner.js"), "CURRENT OWN CODE"); File.WriteAllText(Path.Combine(target, "config.json"), "CURRENT CONFIG");
            int imported = ImportExpected(source, target, expected); bool exact = expected.All(p => Hash(Child(target, p.Key)) == p.Value);
            check(imported == 3 && exact && File.ReadAllText(Path.Combine(target, "studio-runner.js")) == "CURRENT OWN CODE" && File.ReadAllText(Path.Combine(target, "config.json")) == "CURRENT CONFIG", "Runtime import copies only verified missing fixtures and preserves current own code and config");
            check(ImportExpected(Path.Combine(root, "missing-old-source"), target, expected) == 0, "A complete runtime needs no old runtime and remains unchanged");
            string mismatch = Path.Combine(root, "wrong-target"); Directory.CreateDirectory(mismatch); File.WriteAllText(Path.Combine(mismatch, "enshrouded-patcher.exe"), "KEEP WRONG FILE"); bool rejected = false;
            try { ImportExpected(source, mismatch, expected); } catch (InvalidDataException) { rejected = true; }
            check(rejected && File.ReadAllText(Path.Combine(mismatch, "enshrouded-patcher.exe")) == "KEEP WRONG FILE" && Directory.GetFiles(mismatch, "*", SearchOption.AllDirectories).Length == 1, "Wrong existing runtime is rejected without overwrite or other copied files");
            string badSource = Path.Combine(root, "bad-source"), clean = Path.Combine(root, "clean"); Directory.CreateDirectory(badSource); File.Copy(Child(source, "enshrouded-patcher.exe"), Child(badSource, "enshrouded-patcher.exe")); Directory.CreateDirectory(Path.Combine(badSource, "bin")); File.WriteAllText(Path.Combine(badSource, "bin", "kfc-parser.exe"), "WRONG SOURCE"); rejected = false;
            try { ImportExpected(badSource, clean, expected); } catch (InvalidDataException) { rejected = true; }
            check(rejected && !Directory.Exists(clean), "All missing runtime sources are hash-checked before creating the first target");
            string rollback = Path.Combine(root, "rollback"); Directory.CreateDirectory(rollback); File.Copy(Child(source, "enshrouded-patcher.exe"), Child(rollback, "enshrouded-patcher.exe")); rejected = false;
            try { TestFailAfterCopies = 2; ImportExpected(source, rollback, expected); } catch (InvalidOperationException) { rejected = true; } finally { TestFailAfterCopies = -1; }
            bool pathRejected = false; try { ImportExpected(source, clean, new Dictionary<string, string> { { "vendor/../../escape", expected.First().Value } }); } catch (InvalidDataException) { pathRejected = true; }
            string countApp = Path.Combine(root, "count-app"); Directory.CreateDirectory(Path.Combine(countApp, "engine"));
            Json.Write(Path.Combine(countApp, "engine", "engine-manifest.json"), new Dictionary<string, object> { { "files", new Dictionary<string, object> { { "vendor/test.js.bytecode", expected["vendor/test.js.bytecode"] }, { "studio-runner.js", expected.First().Value } } } }, null);
            check(rejected && Directory.GetFiles(rollback, "*", SearchOption.AllDirectories).Length == 1 && Hash(Child(rollback, "enshrouded-patcher.exe")) == expected["enshrouded-patcher.exe"] && pathRejected && !File.Exists(Path.Combine(root, "escape")) && CountExpectedMissing(countApp) == 3, "Runtime rollback preserves existing valid files, rejects traversal and counts only binary and vendor requirements");
        }
    }
}
