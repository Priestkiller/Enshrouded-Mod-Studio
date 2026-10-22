using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace EnshroudedStudio
{
    public class ReviewEntry
    {
        public string Label;
        public string Value;
        public string Explanation;
        public bool Attention;
    }
    public class ServerReview
    {
        public string Preset;
        public string Summary;
        public List<ReviewEntry> Entries = new List<ReviewEntry>();
        public static ServerReview Read(string file)
        {
            var json = Json.Read(file);
            if (!json.ContainsKey("gameSettingsPreset") && !json.ContainsKey("gameSettings"))
                throw new InvalidDataException("Die ausgewählte JSON-Datei enthält keine Server-Spielregeln. Bitte enshrouded_server.json auswählen, nicht die config.json des Patchers.");
            var review = new ServerReview(); object value;
            review.Preset = json.TryGetValue("gameSettingsPreset", out value) && value is string ? (string)value : "Nicht angegeben";
            var settings = json.ContainsKey("gameSettings") ? Json.Object(json["gameSettings"], "gameSettings") : new Dictionary<string, object>();
            bool custom = review.Preset == "Custom";
            review.Summary = custom ? "Profil Custom: Die unten gespeicherten Einzelwerte sind für dieses Profil vorgesehen." :
                "Profil " + review.Preset + ": Einzelwerte gelten laut Server-Anleitung bei Custom. Bei anderen Profilen sind die zugehörigen Profilwerte maßgeblich; die unten gespeicherten Zahlen belegen dann nicht die aktive Schwierigkeit.";
            foreach (var definition in new[] {
                new[] { "enemyDamageFactor", "Schaden gewöhnlicher Gegner", "Multipliziert den Schaden von Gegnern, ausgenommen Bosse.", "0.25", "5" },
                new[] { "bossDamageFactor", "Schaden von Bossen", "Multipliziert den Schaden von Boss-Angriffen.", "0.2", "5" },
                new[] { "playerHealthFactor", "Maximales Spielerleben", "Weniger Leben lässt denselben Treffer einen größeren Teil des Lebens abziehen.", "0.25", "4" },
                new[] { "threatBonus", "Häufigkeit der Gegnerangriffe", "Ändert die Angriffshäufigkeit, nicht direkt den Schaden pro Treffer. Bosse sind ausgenommen.", "0.25", "4" }
            })
            {
                var entry = new ReviewEntry { Label = definition[1], Explanation = definition[2] };
                if (!settings.TryGetValue(definition[0], out value)) entry.Value = "Nicht in der Datei gesetzt";
                else
                {
                    try
                    {
                        double number = Json.Number(value);
                        entry.Value = number.ToString("G6", CultureInfo.GetCultureInfo("de-DE")) + " = " + (number * 100).ToString("G6", CultureInfo.GetCultureInfo("de-DE")) + " %";
                        bool stronger = definition[0] == "playerHealthFactor" ? number < 1 : number > 1;
                        entry.Attention = custom && stronger;
                        if (custom && stronger) entry.Explanation += definition[0] == "playerHealthFactor" ? " Auffällig: unter dem normalen Lebensfaktor 1." : " Auffällig: über dem normalen Faktor 1.";
                        double minimum = double.Parse(definition[3], CultureInfo.InvariantCulture), maximum = double.Parse(definition[4], CultureInfo.InvariantCulture);
                        if (number < minimum || number > maximum) { entry.Attention = true; entry.Explanation += " Außerhalb des in der Server-Anleitung beschriebenen Standardbereichs."; }
                    }
                    catch { entry.Value = "Ungültiger Wert: Zahl erwartet"; entry.Attention = true; }
                }
                review.Entries.Add(entry);
            }
            foreach (var pair in new[] { new[] { "aggroPoolAmount", "Gleichzeitig angreifende Gegner" }, new[] { "randomSpawnerAmount", "Gegnermenge in der Welt" } })
            {
                string text = settings.TryGetValue(pair[0], out value) && value is string ? (string)value : "Nicht in der Datei gesetzt";
                review.Entries.Add(new ReviewEntry { Label = pair[1], Value = text, Explanation = "Eine größere Gegnerzahl kann Kämpfe gefährlicher machen, ohne den Schaden eines einzelnen Treffers zu ändern." });
            }
            return review;
        }
        public string SafeSummary()
        {
            var text = new StringBuilder("Enshrouded: Prüfung gespeicherter Serverwerte\n");
            text.AppendLine(Summary);
            foreach (var entry in Entries) text.AppendLine(entry.Label + ": " + entry.Value + " — " + entry.Explanation);
            text.AppendLine("Nur Dateiprüfung: Gepatchte Archive und der Zustand des laufenden Servers wurden nicht ausgelesen.");
            return text.ToString();
        }
    }
}
