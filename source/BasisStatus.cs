using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace EnshroudedStudio
{
    public sealed class BasisStatus
    {
        public string Operation { get; private set; }
        public string Kind { get; private set; }
        public string TargetDir { get; private set; }
        public string TargetId { get; private set; }
        public string TargetRole { get; private set; }
        public string Token { get; private set; }
        public string CurrentExe { get; private set; }
        public string PreviousExe { get; private set; }
        public List<string> Warnings { get; private set; }
        public bool SavedBasis { get; private set; }
        public string Basis { get; private set; }
        public bool Renewed { get; private set; }
        public bool CanRenew { get { return Kind == "version_changed" || Kind == "archives_changed"; } }

        public static BasisStatus Read(string statusFile, string expectedTargetDir)
        {
            string expected = FullDirectory(expectedTargetDir, "Erwarteter Spielordner");
            Dictionary<string, object> document;
            try { document = Json.Read(statusFile); }
            catch (Exception ex)
            { throw new InvalidDataException("Die Meldung zur Patch-Basis konnte nicht gelesen werden.", ex); }
            object resultValue;
            if (!document.TryGetValue("result", out resultValue)) throw Invalid("Das Ergebnis fehlt.");
            var result = Json.Object(resultValue, "Ergebnis der Basisprüfung");
            string operation = Text(result, "operation");
            string kind = Text(result, "kind");
            if (operation != "inspect-basis" && operation != "renew-basis") throw Invalid("Unbekannte Basis-Aktion.");
            if (!new[] { "version_changed", "archives_changed", "ready", "first_basis", "renewed" }.Contains(kind))
                throw Invalid("Unbekannter Basis-Zustand.");

            string target = FullDirectory(Text(result, "targetDir"), "Gemeldeter Spielordner");
            if (!string.Equals(expected, target, StringComparison.OrdinalIgnoreCase))
                throw Invalid("Die Meldung gehört zu einem anderen Spielordner. Bitte die Basis für den aktuell ausgewählten Ordner erneut prüfen.");
            string role = Text(result, "targetRole");
            if (role != "client" && role != "server") throw Invalid("Die Installationsart muss Client oder Dedicated Server sein.");
            string id = Hex(result, "targetId", 20);
            string token = Hex(result, "fingerprintToken", 64);
            string currentExe = Fingerprint(result, "currentFingerprint", role, false);
            string previousExe = Fingerprint(result, "previousFingerprint", role, true);

            object renewedValue;
            bool renewed = false;
            if (result.TryGetValue("renewed", out renewedValue))
            {
                if (!(renewedValue is bool)) throw Invalid("Die Bestätigung der Basisübernahme ist ungültig.");
                renewed = (bool)renewedValue;
            }
            else if (operation == "renew-basis") throw Invalid("Die Bestätigung der Basisübernahme fehlt.");
            if (operation == "inspect-basis" && (kind == "renewed" || renewed))
                throw Invalid("Eine reine Prüfung darf keine Basisübernahme bestätigen.");
            if (operation == "renew-basis" &&
                ((kind == "renewed" && !renewed) || (kind != "renewed" && renewed) ||
                 (kind != "renewed" && kind != "ready" && kind != "first_basis")))
                throw Invalid("Aktion und Bestätigung der Basisübernahme passen nicht zusammen.");

            object savedValue, basisValue, warningsValue;
            if (!result.TryGetValue("savedBasis", out savedValue) || !(savedValue is bool))
                throw Invalid("Die Angabe zur gespeicherten Basis fehlt oder ist ungültig.");
            if (!result.TryGetValue("basis", out basisValue) || (basisValue != null && !(basisValue is string)))
                throw Invalid("Der Name der gespeicherten Basis ist ungültig.");
            bool saved = (bool)savedValue;
            string basis = basisValue as string;
            if ((saved && string.IsNullOrWhiteSpace(basis)) || (!saved && basis != null))
                throw Invalid("Name und Status der gespeicherten Basis passen nicht zusammen.");
            if ((kind == "first_basis" || kind == "renewed") ? saved : !saved)
                throw Invalid("Basis-Zustand und gespeicherter Ausgangsstand passen nicht zusammen.");
            if (!result.TryGetValue("warnings", out warningsValue) || !(warningsValue is object[]))
                throw Invalid("Die Hinweisliste fehlt oder ist ungültig.");
            var warnings = new List<string>();
            foreach (object warning in (object[])warningsValue)
            {
                if (!(warning is string)) throw Invalid("Ein Hinweis enthält keinen Text.");
                warnings.Add((string)warning);
            }

            return new BasisStatus {
                Operation = operation, Kind = kind, TargetDir = target, TargetId = id, TargetRole = role,
                Token = token, CurrentExe = currentExe, PreviousExe = previousExe, Warnings = warnings,
                SavedBasis = saved, Basis = basis, Renewed = renewed
            };
        }

        private static string FullDirectory(string path, string label)
        {
            if (string.IsNullOrWhiteSpace(path)) throw Invalid(label + " fehlt.");
            try
            {
                if (!Path.IsPathRooted(path)) throw Invalid(label + " muss ein vollständiger Pfad sein.");
                string full = Path.GetFullPath(path);
                string root = Path.GetPathRoot(full);
                return full.Length > root.Length ? full.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) : full;
            }
            catch (InvalidDataException) { throw; }
            catch (Exception ex) { throw new InvalidDataException(label + " ist ungültig.", ex); }
        }
        private static string Text(Dictionary<string, object> source, string key)
        {
            object value;
            if (!source.TryGetValue(key, out value) || !(value is string) || string.IsNullOrWhiteSpace((string)value))
                throw Invalid("Das Textfeld „" + key + "“ fehlt oder ist ungültig.");
            return (string)value;
        }
        private static string Hex(Dictionary<string, object> source, string key, int length)
        {
            string value = Text(source, key);
            if (!Regex.IsMatch(value, "\\A[0-9a-fA-F]{" + length + "}\\z"))
                throw Invalid("Das Prüffeld „" + key + "“ hat ein ungültiges Format.");
            return value;
        }
        private static string Fingerprint(Dictionary<string, object> source, string key, string role, bool optional)
        {
            object value;
            if (!source.TryGetValue(key, out value) || value == null)
            { if (optional) return null; throw Invalid("Der aktuelle Dateistand fehlt."); }
            var fingerprint = Json.Object(value, "Dateistand");
            string exe = Hex(fingerprint, "exe", 64);
            object archivesValue;
            if (!fingerprint.TryGetValue("archives", out archivesValue)) throw Invalid("Die Archivprüfsummen fehlen.");
            var archives = Json.Object(archivesValue, "Archivprüfsummen");
            string prefix = role == "client" ? "enshrouded" : "enshrouded_server";
            string[] names = new[] { prefix + ".kfc", prefix + ".kfc_resources" };
            if (archives.Count != 2 || names.Any(name => !archives.ContainsKey(name)))
                throw Invalid("Die Archivnamen passen nicht zur gemeldeten Installationsart.");
            foreach (string name in names) Hex(archives, name, 64);
            return exe;
        }
        private static InvalidDataException Invalid(string detail)
        { return new InvalidDataException("Ungültige Meldung zur Patch-Basis. " + detail); }

        public string GetFriendlyMessage()
        {
            switch (Kind)
            {
                case "version_changed":
                    return "Die Spielversion wurde aktualisiert. Die gespeicherte Patch-Basis gehört zur vorherigen Version. Übernimm die aktuellen Spieldateien bewusst als neue Basis, bevor du Mods erneut anwendest.";
                case "archives_changed":
                    return "Die Spieldateien weichen vom zuletzt gespeicherten Stand ab. Prüfe, ob Steam das Spiel aktualisiert oder Dateien repariert hat. Danach kannst du die aktuellen Dateien bewusst als neue Basis übernehmen.";
                case "ready":
                    return "Die gespeicherte Patch-Basis passt zur aktuellen Installation. Profiländerungen können daraus neu aufgebaut werden.";
                case "first_basis":
                    return "Für diese Installation ist noch keine Patch-Basis gespeichert. Beim nächsten Aktualisieren wird sie aus den aktuellen Spieldateien angelegt.";
                case "renewed":
                    return "Die bisherige Patch-Basis wurde zurückgelegt. Beim nächsten Aktualisieren wird aus den aktuellen Spieldateien eine neue Basis aufgebaut. Mods wurden durch diesen Schritt noch nicht angewendet.";
                default: throw Invalid("Unbekannter Basis-Zustand.");
            }
        }
    }
}
