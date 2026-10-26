using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Web.Script.Serialization;

namespace EnshroudedStudio
{
    // Data-only reader for the explicitly approved original package. The original
    // program is never started, loaded as an assembly, evaluated or modified.
    public static class OriginalRuntimeReader
    {
        public const string VerifiedPatcherSha256 = "9c9a5911dfe1b87a7c155dc9ba4c95fc4a40b2cdf98eb8b1cebde16c106d8872";
        public const string VerifiedParserSha256 = "b65d0558d09c1f0793e70ec50a76d9a06c3cc1a177b3185895b2c2ba1150250f";
        private const int MaxEntries = 256;
        private const long MaxFile = 100L * 1024 * 1024, MaxExpanded = 128L * 1024 * 1024;
        private const string Patcher = "enshrouded-patcher.exe", Parser = "bin/kfc-parser.exe";

        private static string Hash(byte[] value)
        { using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(value)).Replace("-", "").ToLowerInvariant(); }

        private static void Verify(byte[] value, string expected, string label)
        {
            if (Hash(value) != expected.ToLowerInvariant()) throw new InvalidDataException(label + " gehört nicht zur geprüften Patcher-Version 1.2.3. Bitte das passende Originalpaket verwenden; vorhandene Studio-Dateien bleiben unverändert.");
        }

        private static Dictionary<string, string> CheckExpected(IDictionary<string, string> expected)
        {
            if (expected == null || expected.Count < 3 || expected.Count > MaxEntries) throw new InvalidDataException("Die geprüfte Runtime-Dateiliste fehlt.");
            var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var entry in expected)
            {
                string name = SafeEntry(entry.Key, false);
                if (name != entry.Key || (name != Patcher && name != Parser && !Regex.IsMatch(name, @"^vendor/[a-zA-Z0-9_./-]+\.js\.bytecode$")) || !Regex.IsMatch(entry.Value ?? "", @"\A[a-fA-F0-9]{64}\z") || result.ContainsKey(name)) throw new InvalidDataException("Die Runtime-Dateiliste enthält einen unbekannten Eintrag.");
                result.Add(name, entry.Value.ToLowerInvariant());
            }
            if (!result.ContainsKey(Patcher) || result[Patcher] != VerifiedPatcherSha256 || !result.ContainsKey(Parser) || result[Parser] != VerifiedParserSha256 || !result.Keys.Any(p => p.StartsWith("vendor/", StringComparison.Ordinal))) throw new InvalidDataException("Die Runtime-Dateiliste gehört nicht zur geprüften Patcher-Version 1.2.3.");
            return result;
        }

        private static string SafeEntry(string name, bool directory)
        {
            if (string.IsNullOrEmpty(name) || name.Length > 512 || name[0] == '/' || name[0] == '\\' || name.Any(c => c < 32 || c == 127 || ":<>\"|?*".IndexOf(c) >= 0)) throw new InvalidDataException("Unsicherer Pfad im Originalpaket.");
            string normalized = name.Replace('\\', '/');
            if (directory && normalized.EndsWith("/", StringComparison.Ordinal)) normalized = normalized.Substring(0, normalized.Length - 1);
            foreach (string part in normalized.Split('/'))
            {
                if (part.Length == 0 || part == "." || part == ".." || part.TrimEnd(' ', '.') != part || Regex.IsMatch(part, @"\A(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?\z", RegexOptions.IgnoreCase)) throw new InvalidDataException("Unsicherer Pfad im Originalpaket.");
            }
            return normalized;
        }

        private static string LocalFile(string file)
        {
            if (string.IsNullOrWhiteSpace(file) || !Path.IsPathRooted(file) || file.StartsWith(@"\\", StringComparison.Ordinal) || file.Any(c => c == '\0' || c == '\r' || c == '\n')) throw new InvalidDataException("Bitte eine lokale Original-ZIP oder Patcher-EXE auswählen.");
            string full = Path.GetFullPath(file), current = full;
            while (!string.IsNullOrEmpty(current))
            {
                if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("Verknüpfte Originalpakete werden nicht verwendet.");
                string parent = Path.GetDirectoryName(current); if (parent == current) break; current = parent;
            }
            if (!File.Exists(full) || (File.GetAttributes(full) & FileAttributes.Directory) != 0) throw new FileNotFoundException("Das ausgewählte Originalpaket fehlt.", full);
            return full;
        }

        private static byte[] FileBytes(string file)
        {
            file = LocalFile(file);
            using (var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                if (stream.Length <= 0 || stream.Length > MaxFile) throw new InvalidDataException("Die ausgewählte Originaldatei ist leer oder zu groß (höchstens 100 MiB).");
                return ReadBytes(stream, stream.Length);
            }
        }

        private static byte[] ReadBytes(Stream stream, long length)
        {
            if (length < 0 || length > MaxFile) throw new InvalidDataException("Ungültige Runtime-Dateigröße.");
            byte[] result = new byte[(int)length]; int offset = 0;
            while (offset < result.Length) { int n = stream.Read(result, offset, result.Length - offset); if (n == 0) throw new InvalidDataException("Das Originalpaket enthält eine unvollständige Datei."); offset += n; }
            if (stream.ReadByte() != -1) throw new InvalidDataException("Die entpackte Dateigröße stimmt nicht mit dem Originalpaket überein.");
            return result;
        }

        private static Dictionary<string, byte[]> ReadZip(string file)
        {
            var selected = new Dictionary<string, ZipArchiveEntry>(StringComparer.OrdinalIgnoreCase);
            using (var input = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                if (input.Length <= 0 || input.Length > MaxFile) throw new InvalidDataException("Das Original-ZIP ist leer oder größer als 100 MiB.");
                using (var archive = new ZipArchive(input, ZipArchiveMode.Read, false))
                {
                    if (archive.Entries.Count == 0 || archive.Entries.Count > MaxEntries) throw new InvalidDataException("Das Original-ZIP enthält zu viele oder keine Dateien.");
                    var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase); long total = 0;
                    foreach (var entry in archive.Entries)
                    {
                        bool directory = entry.FullName.EndsWith("/", StringComparison.Ordinal) || entry.FullName.EndsWith("\\", StringComparison.Ordinal);
                        string name = SafeEntry(entry.FullName, directory);
                        int unixType = (entry.ExternalAttributes >> 16) & 0xF000;
                        if (unixType == 0xA000 || (unixType != 0 && unixType != 0x8000 && unixType != 0x4000) || (entry.ExternalAttributes & (int)FileAttributes.ReparsePoint) != 0 || !names.Add(name)) throw new InvalidDataException("Verknüpfte, doppelte oder unbekannte Einträge im Original-ZIP.");
                        if (entry.Length < 0 || entry.Length > MaxFile || (directory && entry.Length != 0) || entry.Length > MaxExpanded - total) throw new InvalidDataException("Das Original-ZIP überschreitet die erlaubte entpackte Größe (128 MiB).");
                        total += entry.Length;
                        if (!directory)
                        {
                            string leaf = name.Substring(name.LastIndexOf('/') + 1);
                            if (string.Equals(leaf, Patcher, StringComparison.OrdinalIgnoreCase) || string.Equals(leaf, "kfc-parser.exe", StringComparison.OrdinalIgnoreCase))
                            {
                                if (selected.ContainsKey(leaf)) throw new InvalidDataException("Das Original-ZIP enthält mehrere Patcher- oder Parserdateien; keine davon wird geraten.");
                                selected.Add(leaf, entry);
                            }
                        }
                    }
                    if (!selected.ContainsKey(Patcher)) throw new InvalidDataException("Im Original-ZIP fehlt enshrouded-patcher.exe. Bitte das Original-Patcherpaket auswählen.");
                    var result = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
                    foreach (var entry in selected) using (var stream = entry.Value.Open()) result.Add(entry.Key == "kfc-parser.exe" ? Parser : Patcher, ReadBytes(stream, entry.Value.Length));
                    return result;
                }
            }
        }

        private static int IndexOf(byte[] bytes, byte[] needle, int start)
        {
            for (int i = start; i <= bytes.Length - needle.Length; i++) { if (bytes[i] != needle[0]) continue; int j = 1; while (j < needle.Length && bytes[i + j] == needle[j]) j++; if (j == needle.Length) return i; }
            return -1;
        }

        private static long Number(object value)
        { if (!(value is int) && !(value is long)) throw new InvalidDataException("Ungültiger Snapshot-Dateizeiger."); long n = Convert.ToInt64(value); if (n < 0) throw new InvalidDataException("Ungültiger Snapshot-Dateizeiger."); return n; }

        private static int EndOfObject(string text, int start)
        {
            int depth = 0; bool quoted = false;
            for (int i = start; i < text.Length; i++)
            {
                char c = text[i];
                if (quoted) { if (c == '\\') { i++; if (i >= text.Length) break; } else if (c == '"') quoted = false; }
                else if (c == '"') quoted = true;
                else if (c == '{') depth++;
                else if (c == '}' && --depth == 0) return i + 1;
            }
            throw new InvalidDataException("Die Runtime-Dateitabelle ist unvollständig.");
        }

        private static void ReadSnapshot(byte[] image, Dictionary<string, string> expected, Dictionary<string, byte[]> result)
        {
            // Caller must SHA-check the whole image before reaching this parser.
            byte[] marker = Encoding.ASCII.GetBytes("var PAYLOAD_POSITION = '"); int location = IndexOf(image, marker, 0);
            if (location < 0 || IndexOf(image, marker, location + marker.Length) >= 0) throw new InvalidDataException("Die geprüfte Patcher-Runtime enthält keinen eindeutigen Snapshot.");
            string header = Encoding.ASCII.GetString(image, location, Math.Min(1024, image.Length - location));
            var values = new Dictionary<string, long>();
            foreach (Match match in Regex.Matches(header, @"var (PAYLOAD_POSITION|PAYLOAD_SIZE|PRELUDE_POSITION|PRELUDE_SIZE)\s*=\s*'([0-9 ]+)'\s*\|\s*0\s*;"))
            { long number; if (values.ContainsKey(match.Groups[1].Value) || !long.TryParse(match.Groups[2].Value.Trim(), out number)) throw new InvalidDataException("Ungültiger Patcher-Snapshotkopf."); values.Add(match.Groups[1].Value, number); }
            if (values.Count != 4) throw new InvalidDataException("Unvollständiger Patcher-Snapshotkopf.");
            long payload = values["PAYLOAD_POSITION"], size = values["PAYLOAD_SIZE"], prelude = values["PRELUDE_POSITION"], preludeSize = values["PRELUDE_SIZE"];
            if (payload < 0 || size <= 0 || size > MaxFile || payload > image.LongLength - size || prelude != payload + size || preludeSize <= 0 || preludeSize > 2 * 1024 * 1024 || prelude > image.LongLength - preludeSize || prelude + preludeSize != image.LongLength) throw new InvalidDataException("Der Patcher-Snapshot liegt außerhalb der geprüften Datei.");
            string text = new UTF8Encoding(false, true).GetString(image, (int)prelude, (int)preludeSize);
            int start = text.IndexOf("{\"C:\\\\snapshot\\\\", StringComparison.Ordinal);
            if (start < 0) throw new InvalidDataException("Die geprüfte Runtime-Dateitabelle fehlt.");
            int end = EndOfObject(text, start);
            string tail = Regex.Replace(text.Substring(end), @"\s+", "");
            if (tail != ",\"C:\\\\snapshot\\\\dist\\\\index.js\",{},{},0);})") throw new InvalidDataException("Die Runtime verwendet ein unbekanntes oder komprimiertes Snapshotformat.");
            var serializer = new JavaScriptSerializer { MaxJsonLength = 2 * 1024 * 1024, RecursionLimit = 32 };
            var table = serializer.DeserializeObject(text.Substring(start, end - start)) as Dictionary<string, object>;
            if (table == null || table.Count > MaxEntries) throw new InvalidDataException("Ungültige Runtime-Dateitabelle.");
            foreach (var entry in expected.Where(e => e.Key.StartsWith("vendor/", StringComparison.Ordinal)))
            {
                string js = entry.Key.Substring("vendor/".Length); js = js.Substring(0, js.Length - ".bytecode".Length);
                string key = "C:\\snapshot\\dist\\" + js.Replace('/', '\\'); object raw;
                if (!table.TryGetValue(key, out raw)) throw new InvalidDataException("Im Original-Patcher fehlt das geprüfte Runtime-Modul: " + entry.Key);
                var row = raw as Dictionary<string, object>; object pointer;
                if (row == null || !row.TryGetValue("0", out pointer)) throw new InvalidDataException("Der Patcher enthält kein Bytecode-Modul: " + entry.Key);
                var span = pointer as object[];
                if (span == null || span.Length != 2) throw new InvalidDataException("Ungültiger Bytecode-Dateizeiger.");
                long offset = Number(span[0]), length = Number(span[1]);
                if (length <= 0 || length > MaxFile || offset > size - length) throw new InvalidDataException("Bytecode-Dateizeiger liegt außerhalb des Snapshots.");
                byte[] bytes = new byte[(int)length]; Buffer.BlockCopy(image, (int)(payload + offset), bytes, 0, bytes.Length); Verify(bytes, entry.Value, "Das Runtime-Modul " + entry.Key); result.Add(entry.Key, bytes);
            }
        }

        public static Dictionary<string, byte[]> Read(string packagePath, string parserPath, IDictionary<string, string> expected)
        {
            var approved = CheckExpected(expected); string package = LocalFile(packagePath);
            string extension = Path.GetExtension(package);
            Dictionary<string, byte[]> result;
            if (string.Equals(extension, ".zip", StringComparison.OrdinalIgnoreCase)) result = ReadZip(package);
            else if (string.Equals(extension, ".exe", StringComparison.OrdinalIgnoreCase)) result = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase) { { Patcher, FileBytes(package) } };
            else throw new InvalidDataException("Bitte das Original-Patcher-ZIP oder dessen enshrouded-patcher.exe auswählen.");
            // In particular, never parse or execute an image selected by name alone.
            Verify(result[Patcher], approved[Patcher], "Die Patcher-EXE");
            if (!result.ContainsKey(Parser))
            {
                string parser = string.IsNullOrWhiteSpace(parserPath) ? Path.Combine(Path.GetDirectoryName(package), "kfc-parser.exe") : parserPath;
                if (!File.Exists(parser)) throw new InvalidDataException("Der passende Customparser fehlt. Bitte das vollständige Original-ZIP mit kfc-parser.exe auswählen oder die benachbarte geprüfte Parserdatei bereitstellen; ein altes Studio ist nicht erforderlich.");
                result.Add(Parser, FileBytes(parser));
            }
            Verify(result[Parser], approved[Parser], "Der Customparser");
            ReadSnapshot(result[Patcher], approved, result);
            if (result.Count != approved.Count || approved.Any(e => !result.ContainsKey(e.Key))) throw new InvalidDataException("Die geprüfte Runtime wurde nicht vollständig gelesen.");
            return result;
        }
    }
}
