using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace EnshroudedStudio
{
    public static class ClientProfiles
    {
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
