using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Security.Cryptography;

namespace EnshroudedStudio
{
    public sealed class RuntimeSetupResult
    {
        public int InstalledFiles { get; internal set; }
        public string Message { get { return InstalledFiles == 0 ? "Patcher ist vollständig eingerichtet. Du kannst dein Profil jetzt anwenden." : "Patcher eingerichtet: " + InstalledFiles + " geprüfte Dateien ergänzt. Wähle den Spielordner und wende dein Profil an."; } }
    }
    // Installs only a fixed, hash-bound runtime. Profiles, bases and game files
    // are not input to this operation and are never imported or changed here.
    public static class RuntimeSetup
    {
        public const string OfficialDownloadUrl = "https://www.nexusmods.com/enshrouded/mods/91?tab=files";
        public const string SupportedOriginalVersion = "1.2.3";
        public static bool IsReady(string appRoot)
        {
            NoLinks(appRoot);
            if (RuntimeImport.CountExpectedMissing(appRoot) != 0) return false;
            // Importing a complete runtime from itself validates every pinned
            // hash and has an empty copy list. Presence alone is insufficient.
            RuntimeImport.Import(appRoot, appRoot);
            return true;
        }
        private static string Hash(byte[] data)
        { using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(data)).Replace("-", "").ToLowerInvariant(); }
        private static string Child(string root, string relative)
        {
            if (string.IsNullOrWhiteSpace(relative) || relative.Contains(":") || relative.Contains("\\") || Path.IsPathRooted(relative) || relative.Split('/').Any(p => p.Length == 0 || p == "." || p == ".." || p.TrimEnd(' ', '.') != p || p.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)) throw new InvalidDataException("Ungültiger Patcher-Dateipfad.");
            string file = Path.GetFullPath(Path.Combine(root, relative));
            if (!file.StartsWith(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Patcher-Datei liegt außerhalb der Einrichtung.");
            return file;
        }
        private static void NoLinks(string file)
        {
            string current = Path.GetFullPath(file);
            while (!string.IsNullOrEmpty(current))
            {
                if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("Verknüpfte Patcherpfade sind nicht erlaubt.");
                string next = Path.GetDirectoryName(current); if (next == current) break; current = next;
            }
        }
        public static RuntimeSetupResult Install(string packagePath, string appRoot, string parserPath)
        {
            appRoot = Path.GetFullPath(appRoot); NoLinks(appRoot);
            var expected = RuntimeImport.Expected(appRoot);
            // The reader verifies the package and all embedded modules before
            // the first temporary file is created in the destination.
            var payload = OriginalRuntimeReader.Read(packagePath, parserPath, expected);
            return InstallPayload(payload, expected, appRoot);
        }
        private static RuntimeSetupResult InstallPayload(IDictionary<string, byte[]> payload, Dictionary<string, string> expected, string appRoot)
        {
            if (payload == null || payload.Count != expected.Count || expected.Any(p => !payload.ContainsKey(p.Key) || payload[p.Key] == null || Hash(payload[p.Key]) != p.Value)) throw new InvalidDataException("Das Originalpaket enthält nicht die vollständig geprüfte Patcher-Version.");
            NoLinks(appRoot);
            foreach (string name in expected.Keys) Child(appRoot, name);
            string stage = Path.Combine(appRoot, ".runtime-setup-" + Guid.NewGuid().ToString("N"));
            if (Directory.Exists(stage) || File.Exists(stage)) throw new IOException("Einrichtungsordner ist bereits vorhanden.");
            Directory.CreateDirectory(stage);
            try
            {
                foreach (var entry in payload)
                {
                    string file = Child(stage, entry.Key); NoLinks(file); Directory.CreateDirectory(Path.GetDirectoryName(file));
                    using (var stream = new FileStream(file, FileMode.CreateNew, FileAccess.Write, FileShare.None)) stream.Write(entry.Value, 0, entry.Value.Length);
                }
                int count = RuntimeImport.ImportExpected(stage, Path.Combine(appRoot, "engine"), expected);
                return new RuntimeSetupResult { InstalledFiles = count };
            }
            finally
            {
                NoLinks(stage);
                // This newly allocated tree contains only the allowlisted bytes
                // above; no foreign directory is adopted as installation work.
                if (Directory.Exists(stage)) Directory.Delete(stage, true);
            }
        }
        public static void SelfTest(Action<bool, string> check, string sandbox)
        {
            string root = Path.Combine(sandbox, "first-install"), app = Path.Combine(root, "app"); Directory.CreateDirectory(Path.Combine(app, "engine"));
            var bytes = new Dictionary<string, byte[]> { { "enshrouded-patcher.exe", new byte[] { 1, 2, 3 } }, { "bin/kfc-parser.exe", new byte[] { 4, 5, 6 } }, { "vendor/mod/fixture.js.bytecode", new byte[] { 7, 8, 9 } } };
            var expected = bytes.ToDictionary(p => p.Key, p => Hash(p.Value));
            File.WriteAllText(Path.Combine(app, "engine", "studio-runner.js"), "CURRENT STUDIO"); File.WriteAllText(Path.Combine(app, "engine", "config.json"), "CURRENT CONFIG");
            var result = InstallPayload(bytes, expected, app);
            check(result.InstalledFiles == 3 && !Directory.Exists(Path.Combine(app, "Data")) && File.ReadAllText(Path.Combine(app, "engine", "studio-runner.js")) == "CURRENT STUDIO" && File.ReadAllText(Path.Combine(app, "engine", "config.json")) == "CURRENT CONFIG", "First install needs no old Studio, profiles or archive basis and preserves current Studio files");
            check(InstallPayload(bytes, expected, app).InstalledFiles == 0 && Directory.GetDirectories(app, ".runtime-setup-*").Length == 0, "Complete runtime setup is idempotent and removes its temporary source");
            string invalid = Path.Combine(root, "invalid"); Directory.CreateDirectory(invalid); var bad = new Dictionary<string, byte[]>(bytes); bad["bin/kfc-parser.exe"] = new byte[] { 0 }; bool rejected = false;
            try { InstallPayload(bad, expected, invalid); } catch (InvalidDataException) { rejected = true; }
            check(rejected && Directory.GetFileSystemEntries(invalid).Length == 0, "Wrong runtime bytes are rejected before any destination write");
            string existing = Path.Combine(root, "existing"); Directory.CreateDirectory(Path.Combine(existing, "engine")); File.WriteAllText(Path.Combine(existing, "engine", "enshrouded-patcher.exe"), "KEEP WRONG FILE"); rejected = false;
            try { InstallPayload(bytes, expected, existing); } catch (InvalidDataException) { rejected = true; }
            check(rejected && File.ReadAllText(Path.Combine(existing, "engine", "enshrouded-patcher.exe")) == "KEEP WRONG FILE" && Directory.GetFiles(existing, "*", SearchOption.AllDirectories).Length == 1, "Setup refuses to overwrite an unknown existing runtime and copies no further files");
            string rollback = Path.Combine(root, "rollback"); Directory.CreateDirectory(rollback); rejected = false;
            try { RuntimeImport.TestFailAfterCopies = 2; InstallPayload(bytes, expected, rollback); } catch (InvalidOperationException) { rejected = true; } finally { RuntimeImport.TestFailAfterCopies = -1; }
            check(rejected && Directory.GetFiles(rollback, "*", SearchOption.AllDirectories).Length == 0 && Directory.GetDirectories(rollback, ".runtime-setup-*").Length == 0, "Interrupted runtime setup rolls back only newly copied files and cleans its staging source");
            var traversal = new Dictionary<string, byte[]> { { "vendor/../../escape", new byte[] { 1 } } }; rejected = false;
            try { InstallPayload(traversal, traversal.ToDictionary(p => p.Key, p => Hash(p.Value)), invalid); } catch (InvalidDataException) { rejected = true; }
            check(rejected && !File.Exists(Path.Combine(root, "escape")) && Directory.GetFileSystemEntries(invalid).Length == 0, "Runtime setup rejects traversal before allocating work");
        }
    }
}
