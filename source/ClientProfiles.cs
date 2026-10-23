using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace EnshroudedStudio
{
    public static class ClientProfiles
    {
        public static Profile CreatePointsOnly(StudioStore store, Dictionary<string, object> sourceConfig, string clientDirectory)
        {
            if (StudioStore.CheckGame(clientDirectory) != "Steam-Client erkannt") throw new InvalidDataException("Bitte die vollständige Spielclient-Installation wählen.");
            string full = Path.GetFullPath(clientDirectory).TrimEnd(Path.DirectorySeparatorChar);
            var matches = store.Profiles.Where(p => SamePath(p.Config["gameDirectory"] as string, full)).ToList();
            if (matches.Count > 1) throw new InvalidOperationException("Für diesen Client existieren mehrere Profile. Bitte das gewünschte Client-Profil auswählen und dort den Punktewert einstellen und anwenden.");
            if (matches.Count == 0 && PatchBasis.Exists(store.DataRoot, full)) throw new InvalidOperationException("Für diesen Client ist bereits eine Patch-Basis gespeichert, aber kein zugehöriges Profil vorhanden. Bitte zuerst das bisherige Client-Profil importieren oder ein vollständiges Client-Profil auswählen, damit andere aktive Mods erhalten bleiben.");
            var copy = matches.Count == 1 ? Json.Clone(matches[0].Config) : store.Baseline();
            copy["gameDirectory"] = full;
            var source = Json.Object(Json.Object(sourceConfig["player"], "Spieler")["adjustSkillPointsPerLevel"], "Fertigkeitspunkte");
            var destination = Json.Object(Json.Object(copy["player"], "Spieler")["adjustSkillPointsPerLevel"], "Fertigkeitspunkte");
            destination["enabled"] = true; destination["value"] = source["value"];
            Validate(store, copy);
            if (matches.Count == 1)
            {
                var saved = new Profile { Id = matches[0].Id, Name = matches[0].Name, Config = copy };
                store.Save(saved); matches[0].Config = copy; return matches[0];
            }
            return store.NewProfile(UniqueName(store, "Fertigkeitspunkte " + source["value"]), copy);
        }

        private static bool SamePath(string left, string right)
        { try { return !string.IsNullOrWhiteSpace(left) && string.Equals(Path.GetFullPath(left).TrimEnd(Path.DirectorySeparatorChar), right, StringComparison.OrdinalIgnoreCase); } catch { return false; } }

        public static void SelfTest(Action<bool, string> check, string appRoot, string sandbox)
        {
            string directory = Path.Combine(sandbox, "points-only-client"); Directory.CreateDirectory(directory);
            foreach (string name in new[] { "enshrouded.exe", "enshrouded.kfc", "enshrouded.kfc_resources" }) File.WriteAllText(Path.Combine(directory, name), "fixture");
            var store = new StudioStore(appRoot, Path.Combine(sandbox, "points-only-data")); store.Load();
            var server = store.Baseline();
            var points = Json.Object(Json.Object(server["player"], "player")["adjustSkillPointsPerLevel"], "points"); points["value"] = 4;
            Json.Object(Json.Object(server["world"], "world")["enableSingleStepTaming"], "taming")["enabled"] = true;
            string source = Json.Encode(server); var client = CreatePointsOnly(store, server, directory);
            check(store.Active(client.Config) == 1 && Json.Number(Json.Object(Json.Object(client.Config["player"], "player")["adjustSkillPointsPerLevel"], "points")["value"]) == 4 && Json.Encode(server) == source,
                "Server points4 creates a separate client profile with only the points option and preserves the server profile");
            Json.Object(Json.Object(client.Config["inventory"], "inventory")["adjustStackSize"], "stacks")["enabled"] = true; store.Save(client);
            int count = store.Profiles.Count; points["value"] = 8; var updated = CreatePointsOnly(store, server, directory);
            check(updated.Id == client.Id && store.Profiles.Count == count && store.Active(updated.Config) == 2 && Json.Number(Json.Object(Json.Object(updated.Config["player"], "player")["adjustSkillPointsPerLevel"], "points")["value"]) == 8,
                "Repeated point transfer updates the same client profile while preserving its existing stack setting");
            store.NewProfile("Ambiguous client", updated.Config); bool rejected = false;
            try { CreatePointsOnly(store, server, directory); } catch (InvalidOperationException) { rejected = true; }
            check(rejected, "Point transfer refuses ambiguous client profiles instead of overwriting a guessed configuration");
        }

        public static Profile Create(StudioStore store, Dictionary<string, object> sourceConfig,
            string sourceName, string clientDirectory)
        {
            if (store == null) throw new ArgumentException("Der Profilspeicher fehlt.", "store");
            if (sourceConfig == null) throw new InvalidDataException("Die zu kopierende Konfiguration fehlt.");
            if (string.IsNullOrWhiteSpace(sourceName))
                throw new InvalidDataException("Für die Client-Kopie wird ein nicht leerer Ausgangsprofilname benötigt.");
            sourceName = sourceName.Trim();
            StudioStore.CheckName(sourceName);

            string clientStatus = StudioStore.CheckGame(clientDirectory);
            if (!string.Equals(clientStatus, "Steam-Client erkannt", StringComparison.Ordinal))
                throw new InvalidDataException("Bitte einen vollständigen, getrennten Steam-Clientordner auswählen. " + clientStatus);

            Dictionary<string, object> copy;
            try { copy = Json.Clone(sourceConfig); }
            catch (Exception ex)
            { throw new InvalidDataException("Die Ausgangskonfiguration konnte nicht als unabhängige Kopie gelesen werden.", ex); }

            Validate(store, copy);
            copy["gameDirectory"] = Path.GetFullPath(clientDirectory);
            var player = Json.Object(copy["player"], "Spieler");
            var points = Json.Object(player["adjustSkillPointsPerLevel"], "Fertigkeitspunkte je Level");
            points["enabled"] = true;
            Validate(store, copy);

            return store.NewProfile(UniqueName(store, sourceName), copy);
        }

        private static void Validate(StudioStore store, Dictionary<string, object> config)
        {
            var errors = store.Validate(config);
            if (errors.Count > 0)
                throw new InvalidDataException("Die Client-Kopie wurde nicht erstellt. Bitte die Ausgangseinstellungen korrigieren:" +
                    Environment.NewLine + string.Join(Environment.NewLine, errors.Take(8)));
        }

        private static string UniqueName(StudioStore store, string sourceName)
        {
            for (int sequence = 1; sequence < int.MaxValue; sequence++)
            {
                string suffix = " – Client" + (sequence == 1 ? "" : " (" + sequence + ")");
                int length = Math.Min(sourceName.Length, 80 - suffix.Length);
                // Keep a supplementary Unicode character whole when truncating a long name.
                if (length > 0 && length < sourceName.Length && char.IsHighSurrogate(sourceName[length - 1])) length--;
                string name = sourceName.Substring(0, length).TrimEnd() + suffix;
                if (!store.Profiles.Any(p => string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase)))
                { StudioStore.CheckName(name); return name; }
            }
            throw new InvalidDataException("Es konnte kein freier Name für das Client-Profil gefunden werden.");
        }

    }
}
