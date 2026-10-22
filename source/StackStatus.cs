using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace EnshroudedStudio
{
    public sealed class StackDistribution
    {
        public int Value { get; internal set; }
        public int Count { get; internal set; }
    }
    public sealed class StackSample
    {
        public string Name { get; internal set; }
        public string Guid { get; internal set; }
        public int Value { get; internal set; }
    }
    public sealed class StackStatus
    {
        public string TargetDir { get; private set; }
        public string TargetId { get; private set; }
        public string TargetRole { get; private set; }
        public string Build { get; private set; }
        public string ExeHash { get; private set; }
        public int Requested { get; private set; }
        public bool Enabled { get; private set; }
        public int StackableCount { get; private set; }
        public int SingletonCount { get; private set; }
        public int MatchingRequested { get; private set; }
        public bool AllMatch { get; private set; }
        public List<StackDistribution> Distribution { get; private set; }
        public List<StackSample> Samples { get; private set; }
        public List<string> Warnings { get; private set; }

        public static StackStatus Read(string file, string expectedTarget, int expectedRequested, bool expectedEnabled)
        {
            var document = Json.Read(file); object resultValue;
            if (!document.TryGetValue("result", out resultValue)) throw Invalid("Das Ergebnis fehlt.");
            var result = Json.Object(resultValue, "Stapelprüfung");
            if (Text(result, "operation") != "inspect-stacks") throw Invalid("Die Antwort gehört nicht zur Stapelprüfung.");
            string target = DirectoryName(Text(result, "targetDir"));
            if (!string.Equals(target, DirectoryName(expectedTarget), StringComparison.OrdinalIgnoreCase)) throw Invalid("Das Ergebnis gehört zu einem anderen Installationsordner.");
            string role = Text(result, "targetRole");
            if (role != "client" && role != "server") throw Invalid("Die Installationsart ist ungültig.");
            string targetId = Hex(result, "targetId", 20);
            var fingerprint = Object(result, "currentFingerprint");
            string exe = Hex(fingerprint, "exe", 64);
            var archives = Object(fingerprint, "archives");
            string prefix = role == "client" ? "enshrouded" : "enshrouded_server";
            string[] names = { prefix + ".kfc", prefix + ".kfc_resources" };
            if (archives.Count != 2 || names.Any(name => !archives.ContainsKey(name))) throw Invalid("Die Archivnamen passen nicht zur Installationsart.");
            foreach (string name in names) Hex(archives, name, 64);
            string build = Text(result, "build");
            if (build.Length > 500 || !Regex.IsMatch(build, @"\A[0-9]+(?:\||\z)")) throw Invalid("Die Spielrevision fehlt oder ist ungültig.");
            int requested = Integer(result, "requested", 2, 65535);
            bool enabled = Boolean(result, "enabled");
            if (requested != expectedRequested || enabled != expectedEnabled) throw Invalid("Das Ergebnis gehört zu anderen Profileinstellungen. Bitte erneut prüfen.");
            int count = Integer(result, "stackableCount", 1, int.MaxValue);
            int singletons = Integer(result, "singletonCount", 0, int.MaxValue);
            int matching = Integer(result, "matchingRequested", 0, count);
            bool all = Boolean(result, "allMatch");
            if (all != (matching == count)) throw Invalid("Anzahl und Gesamtvergleich widersprechen sich.");
            var distribution = new List<StackDistribution>(); var seen = new HashSet<int>(); long sum = 0;
            foreach (object entry in Array(result, "distribution"))
            {
                var row = Json.Object(entry, "Stapelverteilung");
                int value = Integer(row, "value", 2, 65535), amount = Integer(row, "count", 1, count);
                if (!seen.Add(value)) throw Invalid("Ein Stapelwert kommt mehrfach in der Verteilung vor.");
                sum += amount; distribution.Add(new StackDistribution { Value = value, Count = amount });
            }
            if (sum != count || distribution.Where(row => row.Value == requested).Sum(row => (long)row.Count) != matching) throw Invalid("Die Verteilung passt nicht zu den gemeldeten Anzahlen.");
            var samples = new List<StackSample>(); var sampleIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (object entry in Array(result, "samples"))
            {
                var row = Json.Object(entry, "Stapelbeispiel");
                string name = Text(row, "name"), guid = Text(row, "guid"); Guid parsed;
                if (name.Length > 1000 || !System.Guid.TryParseExact(guid, "D", out parsed) || !sampleIds.Add(guid)) throw Invalid("Ein Beispiel hat eine ungültige oder doppelte Gegenstands-ID.");
                int value = Integer(row, "value", 2, 65535);
                if (!seen.Contains(value)) throw Invalid("Ein Beispielwert fehlt in der Verteilung.");
                samples.Add(new StackSample { Name = name, Guid = guid, Value = value });
            }
            if (samples.Count == 0 || samples.Count > Math.Min(count, 64)) throw Invalid("Die Zahl der Stapelbeispiele ist ungültig.");
            var warnings = new List<string>();
            foreach (object warning in Array(result, "warnings"))
            {
                if (!(warning is string)) throw Invalid("Ein Hinweis enthält keinen Text."); warnings.Add((string)warning);
            }
            return new StackStatus { TargetDir = target, TargetId = targetId, TargetRole = role, Build = build, ExeHash = exe,
                Requested = requested, Enabled = enabled, StackableCount = count, SingletonCount = singletons,
                MatchingRequested = matching, AllMatch = all, Distribution = distribution.OrderBy(row => row.Value).ToList(), Samples = samples, Warnings = warnings };
        }
        private static string DirectoryName(string path)
        {
            if (string.IsNullOrWhiteSpace(path) || !Path.IsPathRooted(path)) throw Invalid("Ein vollständiger Installationspfad fehlt.");
            try { string full = Path.GetFullPath(path), root = Path.GetPathRoot(full);
                return full.Length > root.Length ? full.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) : full; }
            catch (Exception ex) { throw new InvalidDataException("Ungültiger Installationspfad der Stapelprüfung.", ex); }
        }
        private static string Text(Dictionary<string, object> source, string key)
        {
            object value;
            if (!source.TryGetValue(key, out value) || !(value is string) || string.IsNullOrWhiteSpace((string)value)) throw Invalid("Das Textfeld „" + key + "“ fehlt oder ist ungültig.");
            return (string)value;
        }
        private static string Hex(Dictionary<string, object> source, string key, int size)
        { string value = Text(source, key); if (!Regex.IsMatch(value, "\\A[0-9a-fA-F]{" + size + "}\\z")) throw Invalid("Der Prüfwert „" + key + "“ ist ungültig."); return value; }
        private static Dictionary<string, object> Object(Dictionary<string, object> source, string key)
        { object value; if (!source.TryGetValue(key, out value)) throw Invalid("Das Feld „" + key + "“ fehlt."); return Json.Object(value, key); }
        private static object[] Array(Dictionary<string, object> source, string key)
        { object value; if (!source.TryGetValue(key, out value) || !(value is object[])) throw Invalid("Die Liste „" + key + "“ fehlt oder ist ungültig."); return (object[])value; }
        private static bool Boolean(Dictionary<string, object> source, string key)
        { object value; if (!source.TryGetValue(key, out value) || !(value is bool)) throw Invalid("Der Schalter „" + key + "“ ist ungültig."); return (bool)value; }
        private static int Integer(Dictionary<string, object> source, string key, int minimum, int maximum)
        {
            object value; if (!source.TryGetValue(key, out value) || value == null || value is bool || value is string) throw Invalid("Die Zahl „" + key + "“ fehlt oder ist ungültig.");
            double number; try { number = Json.Number(value); } catch { throw Invalid("Die Zahl „" + key + "“ ist ungültig."); }
            if (double.IsNaN(number) || double.IsInfinity(number) || number != Math.Floor(number) || number < minimum || number > maximum) throw Invalid("Die Zahl „" + key + "“ liegt außerhalb des gültigen Ganzzahlbereichs.");
            return (int)number;
        }
        private static InvalidDataException Invalid(string text)
        { return new InvalidDataException("Ungültiges Ergebnis der Stapelprüfung. " + text); }
        public string GetFriendlyMessage()
        {
            var culture = CultureInfo.GetCultureInfo("de-DE");
            return MatchingRequested.ToString("N0", culture) + " von " + StackableCount.ToString("N0", culture) + " stapelbaren Gegenständen haben im Archiv den Profilwert " + Requested.ToString("N0", culture) + "." +
                (!Enabled ? " Die Stapeloption ist in diesem Profil ausgeschaltet." : AllMatch ? " Der gewünschte Archivwert ist vollständig bestätigt." : " Die installierten Daten weichen vom eingestellten Profilwert ab.");
        }
    }
}
