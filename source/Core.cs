using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Collections.Generic;
using System.Globalization;
using System.Web.Script.Serialization;
using System.Diagnostics;
using System.Security.Cryptography;

namespace EnshroudedStudio
{
    public class FieldChoiceDef
    {
        public long Value { get; set; }
        public string Label { get; set; }
    }
    public class FieldDef
    {
        public string Key { get; set; }
        public string Label { get; set; }
        public string Help { get; set; }
        public bool Boolean { get; set; }
        public bool Integer { get; set; }
        public double Minimum { get; set; }
        public double Maximum { get; set; }
        public List<FieldChoiceDef> Choices { get; set; }
    }
    public class ModDef
    {
        public string Key { get; set; }
        public string Title { get; set; }
        public string Description { get; set; }
        public string Effect { get; set; }
        public string Example { get; set; }
        public string Notes { get; set; }
        public string Status { get; set; }
        public string WhenToUse { get; set; }
        public string Scope { get; set; }
        public bool ServerOnly { get; set; }
        public bool ClientOnly { get; set; }
        public bool KnownTargetOnly { get; set; }
        public List<FieldDef> Fields { get; set; }
    }
    public class CategoryDef
    {
        public string Key { get; set; }
        public string Title { get; set; }
        public string Description { get; set; }
        public List<ModDef> Mods { get; set; }
    }
    public class Profile
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public Dictionary<string, object> Config { get; set; }
        public override string ToString() { return Name; }
    }
    public static class Json
    {
        public static JavaScriptSerializer Serializer()
        { return new JavaScriptSerializer { MaxJsonLength = 4000000, RecursionLimit = 80 }; }
        public static Dictionary<string, object> Read(string path)
        { return Object(Serializer().DeserializeObject(File.ReadAllText(path, Encoding.UTF8)), "JSON-Dokument"); }
        public static Dictionary<string, object> Object(object value, string label)
        {
            var map = value as Dictionary<string, object>;
            if (map == null) throw new InvalidDataException(label + " muss ein JSON-Objekt sein.");
            return map;
        }
        public static Dictionary<string, object> Clone(Dictionary<string, object> map)
        { return Object(Serializer().DeserializeObject(Serializer().Serialize(map)), "Konfiguration"); }
        public static Dictionary<string, object> Merge(Dictionary<string, object> first, Dictionary<string, object> second)
        {
            var result = Clone(first);
            foreach (var pair in second)
            {
                object previous;
                if (result.TryGetValue(pair.Key, out previous) && previous is Dictionary<string, object> && pair.Value is Dictionary<string, object>)
                    result[pair.Key] = Merge((Dictionary<string, object>)previous, (Dictionary<string, object>)pair.Value);
                else result[pair.Key] = pair.Value;
            }
            return result;
        }
        public static string Encode(object value)
        {
            string raw = Serializer().Serialize(value);
            var output = new StringBuilder();
            int indent = 0; bool quoted = false, escaped = false;
            foreach (char c in raw)
            {
                if (quoted)
                {
                    output.Append(c);
                    if (escaped) escaped = false;
                    else if (c == '\\') escaped = true;
                    else if (c == '"') quoted = false;
                    continue;
                }
                if (c == '"') { quoted = true; output.Append(c); }
                else if (c == '{' || c == '[') { output.Append(c).AppendLine(); indent++; output.Append(' ', indent * 2); }
                else if (c == '}' || c == ']') { output.AppendLine(); indent--; output.Append(' ', indent * 2).Append(c); }
                else if (c == ',') output.Append(c).AppendLine().Append(' ', indent * 2);
                else if (c == ':') output.Append(": ");
                else output.Append(c);
            }
            return output.AppendLine().ToString();
        }
        public static void Write(string path, object value, string backupRoot)
        {
            path = Path.GetFullPath(path);
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            string contents = Encode(value);
            if (File.Exists(path) && File.ReadAllText(path, Encoding.UTF8) == contents) return;
            string temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                File.WriteAllText(temp, contents, new UTF8Encoding(false));
                if (File.Exists(path))
                {
                    if (backupRoot != null)
                    {
                        Directory.CreateDirectory(backupRoot);
                        string backup = DateTime.Now.ToString("yyyyMMdd-HHmmss-fff") + "-" + Guid.NewGuid().ToString("N").Substring(0, 6) + "-" + Path.GetFileName(path);
                        File.Copy(path, Path.Combine(backupRoot, backup));
                    }
                    File.Replace(temp, path, null);
                }
                else File.Move(temp, path);
            }
            finally { if (File.Exists(temp)) File.Delete(temp); }
        }
        public static double Number(object value)
        {
            if (value is bool || value is string || value == null) throw new FormatException("Zahl erwartet.");
            double number = Convert.ToDouble(value, CultureInfo.InvariantCulture);
            if (double.IsNaN(number) || double.IsInfinity(number)) throw new FormatException("Endliche Zahl erwartet.");
            return number;
        }
        public static bool ParseInput(string text, out double value)
        {
            text = text.Trim();
            if (text.Contains(",") && text.Contains(".")) { value = 0; return false; }
            return double.TryParse(text.Replace(',', '.'), NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint | NumberStyles.AllowExponent,
                CultureInfo.InvariantCulture, out value) && !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }
    public static class CompanionSpellUi
    {
        public const string Key = "enableSkeletonSummoningSpells";
        public const string Requirements = "Für Mehrspieler Server UND ALLE Spielclients mit demselben Spielbuild sowie gleichem Grundlimit, gleicher Dauer und gleichem Stärkefaktor patchen. Eigene Items, Symbole und Namen benötigen passende Dateien auf jedem Spielclient. Der Server verteilt keine Dateien an Clients.";
        public const string TestStatus = "Mehrspieler-Spieltest offen. Der Magier verwendet Eisgeschosse und beschwört zunächst keine Totenköpfe.";

        public static string TargetHint(string target, bool blocked)
        {
            if (blocked)
                return "Für die sechs Begleiterzauber zuerst einen vollständigen, eindeutig erkannten Spielclient- oder getrennten Dedicated-Serverordner wählen. Unbekannte und gemischte Ziele sind gesperrt. Eine bereits aktive Profiloption lässt sich ausschalten. " + Requirements + " " + TestStatus;
            string role = target == "Steam-Client erkannt"
                ? "Spielclient erkannt: gemeinsame Spieldaten sowie UI, Symbole und Namen werden lokal gepatcht. Solo-Spiel und LAN-Host verwenden diesen gepatchten Spielclient. "
                : "Dedicated Server erkannt: gemeinsame Item-, Rezept-, Zauber- und Begleiterdaten werden gepatcht. Die UI-, Symbol- und Namensdateien werden zusätzlich auf jedem Spielclient benötigt. ";
            return role + Requirements + " " + TestStatus;
        }

        public static string ToolTip(string target, bool blocked)
        {
            if (blocked) return TargetHint(target, true);
            return "Sechs Begleiterzauber auf diesem " + (target == "Steam-Client erkannt" ? "Spielclient" : "Dedicated Server") + " aktivieren. " + Requirements + " " + TestStatus;
        }

        public static string ActivationNotice(string title)
        {
            return title + ": eingeschaltet. Unten auf diese Installation anwenden. " + Requirements + " " + TestStatus;
        }
    }
    public class StudioStore
    {
        public readonly string AppRoot;
        public readonly string DataRoot;
        public string BackupRoot { get { return Path.Combine(DataRoot, "backups"); } }
        public List<CategoryDef> Schema;
        public Dictionary<string, object> Defaults;
        public List<Profile> Profiles = new List<Profile>();
        public List<string> LoadErrors = new List<string>();
        public string LastId;
        public const string VerifiedEngineSha256 = "9c9a5911dfe1b87a7c155dc9ba4c95fc4a40b2cdf98eb8b1cebde16c106d8872";
        public StudioStore(string appRoot, string dataRoot)
        {
            AppRoot = appRoot; DataRoot = dataRoot;
            Defaults = Json.Read(Path.Combine(appRoot, "assets", "defaults.json"));
            Schema = Json.Serializer().Deserialize<List<CategoryDef>>(File.ReadAllText(Path.Combine(appRoot, "assets", "schema.json"), Encoding.UTF8));
        }
        public Dictionary<string, object> Baseline()
        {
            var config = Json.Clone(Defaults);
            foreach (var cat in Schema)
                foreach (var mod in cat.Mods)
                    Json.Object(Json.Object(config[cat.Key], cat.Title)[mod.Key], mod.Title)["enabled"] = false;
            return config;
        }
        public Dictionary<string, object> Normalize(Dictionary<string, object> config)
        {
            var merged = Json.Merge(Defaults, config);
            var errors = Validate(merged);
            if (errors.Count > 0) throw new InvalidDataException(string.Join(Environment.NewLine, errors.Take(8)));
            return merged;
        }
        public List<string> Validate(Dictionary<string, object> config)
        {
            var errors = new List<string>();
            object value;
            foreach (string key in new[] { "gameDirectory", "outputDirectory", "kfcParserVersion" })
                if (!config.TryGetValue(key, out value) || !(value is string)) errors.Add(key + ": Text erwartet.");
            if (config.TryGetValue("outputDirectory", out value) && value is string && string.IsNullOrWhiteSpace((string)value)) errors.Add("Ausgabeordner darf nicht leer sein.");
            foreach (var cat in Schema.Where(c => c.Key != "settings"))
            {
                Dictionary<string, object> section;
                try { section = Json.Object(config[cat.Key], cat.Title); }
                catch { errors.Add(cat.Title + ": Kategorie fehlt oder ist ungültig."); continue; }
                foreach (var mod in cat.Mods)
                {
                    Dictionary<string, object> options;
                    try { options = Json.Object(section[mod.Key], mod.Title); }
                    catch { errors.Add(mod.Title + ": Einstellungen fehlen oder sind ungültig."); continue; }
                    if (!options.TryGetValue("enabled", out value) || !(value is bool)) errors.Add(mod.Title + ": enabled muss true oder false sein.");
                    foreach (var field in mod.Fields)
                    {
                        if (!options.TryGetValue(field.Key, out value)) { errors.Add(mod.Title + ": " + field.Label + " fehlt."); continue; }
                        if (field.Boolean)
                        { if (!(value is bool)) errors.Add(mod.Title + ": " + field.Label + " muss true oder false sein."); continue; }
                        try
                        {
                            double n = Json.Number(value);
                            if (n < field.Minimum || n > field.Maximum || (field.Integer && n != Math.Truncate(n)))
                                errors.Add(mod.Title + ": " + field.Label + " muss " + (field.Integer ? "ganzzahlig " : "") + "zwischen " + field.Minimum.ToString("G", CultureInfo.GetCultureInfo("de-DE")) + " und " + field.Maximum.ToString("G", CultureInfo.GetCultureInfo("de-DE")) + " liegen.");
                            if (field.Choices != null && field.Choices.Count > 0 && !field.Choices.Any(choice => choice.Value == n))
                                errors.Add(mod.Title + ": " + field.Label + " benötigt eine der angebotenen Varianten.");
                        }
                        catch { errors.Add(mod.Title + ": " + field.Label + " ist keine gültige Zahl."); }
                    }
                    if (mod.Key == "adjustChestRandomSlots")
                    {
                        try { if (Json.Number(options["min"]) > Json.Number(options["max"])) errors.Add("Truhenbeute: Minimum darf nicht größer als Maximum sein."); }
                        catch { }
                    }
                }
            }
            try
            {
                var settings = Json.Object(config["settings"], "Werkzeuge");
                foreach (string key in new[] { "keepTempFiles", "keepModdedFiles" })
                    if (!settings.TryGetValue(key, out value) || !(value is bool)) errors.Add(key + ": true oder false erwartet.");
            }
            catch { errors.Add("Werkzeug-Einstellungen fehlen oder sind ungültig."); }
            try
            {
                var world = Json.Object(config["world"], "Welt");
                var altar = Json.Object(world["adjustAltarLimit"], "Altäre");
                if (Json.Number(altar["cap"]) > 16 && !(bool)altar["unlockSafeAltarCap"])
                    errors.Add("Mehr als 16 Altäre benötigen die experimentelle Zusatzoption. Eine funktionierende Platzierung über 16 ist nicht bestätigt.");
                var gameplay = Json.Object(config["gameplay"], "Gameplay");
                var slots = Json.Object(gameplay["enableSourceLootSlots"], "Beuteplätze nach Quelle");
                var chest = Json.Object(gameplay["adjustChestRandomSlots"], "Truhenbeute");
                if ((bool)slots["enabled"] && Json.Number(slots["chestMultiplier"]) > 1 && (bool)chest["enabled"])
                    errors.Add("Truhenbeute: Entweder die festen Zufallsplätze oder den Truhen-Multiplikator unter Beuteplätze nach Quelle verwenden. Beide Einstellungen dürfen nicht gleichzeitig aktiv sein.");
                foreach (var pair in new[] { new[] { "enableUncapDedicatedServerSettings", "uncapServerFactorMin", "uncapServerFactorMax" }, new[] { "enableUncapClientSettings", "clientFactorMin", "clientFactorMax" } })
                {
                    var limits = Json.Object(gameplay[pair[0]], pair[0]);
                    if (Json.Number(limits[pair[1]]) >= Json.Number(limits[pair[2]]))
                        errors.Add("Faktorgrenzen: Das Minimum muss kleiner als das Maximum sein (" + pair[0] + ").");
                }
                var clientLimits = Json.Object(gameplay["enableUncapClientSettings"], "Client-Faktorgrenzen");
                if ((bool)clientLimits["enabled"])
                {
                    var serverLimits = Json.Object(gameplay["enableUncapDedicatedServerSettings"], "Server-Faktorgrenzen");
                    double clientMaximum = Json.Number(clientLimits["clientFactorMax"]);
                    double serverMaximum = (bool)serverLimits["enabled"] ? Json.Number(serverLimits["uncapServerFactorMax"]) : clientMaximum;
                    double effectiveMaximum = Math.Min(Math.Min(clientMaximum, serverMaximum), 4);
                    if (Json.Number(clientLimits["clientFactorMin"]) >= effectiveMaximum)
                        errors.Add("Client-Faktorgrenzen: Das Minimum muss strikt unter dem wirksamen Maximum " + effectiveMaximum.ToString("G", CultureInfo.GetCultureInfo("de-DE")) + " liegen. Dieses berücksichtigt die Server-Grenze und die Spieler-Obergrenze 4.");
                }
            }
            catch { /* Missing or malformed fields are already reported by the schema checks. */ }
            try
            {
                var ownSkeletonWorld = Json.Object(config["world"], "Welt");
                var ownSkeletons = Json.Object(ownSkeletonWorld["enableSkeletonSummoningSpells"], "Eigene Skelettzauber");
                var legacySkeletons = Json.Object(ownSkeletonWorld["adjustSummonedCompanions"], "Beschworene Begleiter");
                if ((bool)ownSkeletons["enabled"] && (bool)legacySkeletons["enabled"])
                    errors.Add("Für die eigenen Begleiterzauber die vorhandene Option „Beschworene Begleiter anpassen“ ausschalten. Beide Varianten können nicht gleichzeitig angewendet werden.");
            }
            catch { /* Schema validation reports malformed values. */ }
            return errors;
        }
        public void Load()
        {
            Directory.CreateDirectory(Path.Combine(DataRoot, "profiles"));
            foreach (string file in Directory.GetFiles(Path.Combine(DataRoot, "profiles"), "*.json"))
            {
                try
                {
                    var doc = Json.Read(file);
                    var profile = new Profile { Id = Path.GetFileNameWithoutExtension(file), Name = (string)doc["name"], Config = Normalize(Json.Object(doc["config"], "Profil")) };
                    Guid id; if (!Guid.TryParseExact(profile.Id, "N", out id)) throw new InvalidDataException("Ungültige Profil-ID.");
                    CheckName(profile.Name); Profiles.Add(profile);
                }
                catch (Exception ex) { LoadErrors.Add(Path.GetFileName(file) + ": " + ex.Message); }
            }
            bool first = Profiles.Count == 0;
            if (first)
            {
                var original = NewProfile("Unverändert", Baseline()); LastId = original.Id;
                var qol = Baseline();
                SetEnabled(qol, "inventory", "adjustStackSize", true);
                SetEnabled(qol, "inventory", "adjustSlotCount", true);
                SetEnabled(qol, "inventory", "enableHigherBackpackSlot", true);
                SetEnabled(qol, "player", "adjustFoodBuffReapply", true);
                NewProfile("Komfort", qol);
                var build = Baseline();
                SetEnabled(build, "player", "enableCreativeMode", true);
                SetEnabled(build, "world", "unblockBuildLimit", true);
                NewProfile("Bauen", build);
            }
            string meta = Path.Combine(DataRoot, "ui.json");
            if (!first && File.Exists(meta))
            { try { LastId = (string)Json.Read(meta)["lastProfile"]; } catch (Exception ex) { LoadErrors.Add("ui.json: " + ex.Message); } }
        }
        public static void SetEnabled(Dictionary<string, object> config, string cat, string mod, bool enabled)
        { Json.Object(Json.Object(config[cat], cat)[mod], mod)["enabled"] = enabled; }
        public static void CheckName(string name)
        { if (string.IsNullOrWhiteSpace(name) || name.Length > 80 || name.Any(char.IsControl)) throw new InvalidDataException("Profilname: 1 bis 80 Zeichen ohne Steuerzeichen verwenden."); }
        public Profile NewProfile(string name, Dictionary<string, object> config)
        {
            name = name.Trim(); CheckName(name);
            if (Profiles.Any(p => string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase))) throw new InvalidDataException("Ein Profil mit diesem Namen existiert bereits.");
            var profile = new Profile { Id = Guid.NewGuid().ToString("N"), Name = name, Config = Normalize(config) };
            Save(profile); Profiles.Add(profile); return profile;
        }
        public void Save(Profile profile)
        {
            CheckName(profile.Name);
            var errors = Validate(profile.Config);
            if (errors.Count > 0) throw new InvalidDataException(string.Join(Environment.NewLine, errors.Take(8)));
            Guid id; if (!Guid.TryParseExact(profile.Id, "N", out id)) throw new InvalidDataException("Ungültige Profil-ID.");
            Json.Write(Path.Combine(DataRoot, "profiles", profile.Id + ".json"), new Dictionary<string, object> {
                { "formatVersion", 1 }, { "name", profile.Name }, { "config", profile.Config }
            }, BackupRoot);
        }
        public void Select(string id)
        {
            string file = Path.Combine(DataRoot, "ui.json");
            var settings = File.Exists(file) ? Json.Read(file) : new Dictionary<string, object>();
            settings["lastProfile"] = id; Json.Write(file, settings, null); LastId = id;
        }
        public int Active(Dictionary<string, object> config)
        { return Schema.SelectMany(c => c.Mods.Select(m => new { Cat = c.Key, Mod = m.Key })).Count(x => (bool)Json.Object(Json.Object(config[x.Cat], x.Cat)[x.Mod], x.Mod)["enabled"]); }
        public static string CheckGame(string path)
        {
            if (string.IsNullOrWhiteSpace(path) || !Directory.Exists(path)) return "Spielordner auswählen.";
            bool client = File.Exists(Path.Combine(path, "enshrouded.exe")) && File.Exists(Path.Combine(path, "enshrouded.kfc")) && File.Exists(Path.Combine(path, "enshrouded.kfc_resources"));
            bool server = File.Exists(Path.Combine(path, "enshrouded_server.exe")) && File.Exists(Path.Combine(path, "enshrouded_server.kfc")) && File.Exists(Path.Combine(path, "enshrouded_server.kfc_resources"));
            if (client && server) return "Client und Server liegen zusammen. Bitte getrennte Installationsordner verwenden.";
            if (client) return "Steam-Client erkannt";
            if (server) return "Dedicated Server erkannt";
            return "Kein vollständiger Spielordner: passende EXE, KFC und kfc_resources werden benötigt.";
        }
        public static bool AllowsTarget(ModDef mod, string target)
        {
            if (mod.ClientOnly) return !mod.ServerOnly && target == "Steam-Client erkannt";
            if (mod.ServerOnly) return target == "Dedicated Server erkannt";
            return !mod.KnownTargetOnly || target == "Steam-Client erkannt" || target == "Dedicated Server erkannt";
        }
        public string RestrictedTargetError(Dictionary<string, object> config)
        {
            string target = CheckGame(config["gameDirectory"] as string);
            var serverOnly = new List<string>();
            var clientOnly = new List<string>();
            var knownTargetOnly = new List<string>();
            foreach (var category in Schema)
            {
                foreach (var mod in category.Mods.Where(definition => definition.ServerOnly || definition.ClientOnly || definition.KnownTargetOnly))
                {
                    var values = Json.Object(Json.Object(config[category.Key], category.Title)[mod.Key], mod.Title);
                    object enabled;
                    if (values.TryGetValue("enabled", out enabled) && enabled is bool && (bool)enabled && !AllowsTarget(mod, target))
                        (mod.ClientOnly ? clientOnly : mod.ServerOnly ? serverOnly : knownTargetOnly).Add(mod.Title);
                }
            }
            var errors = new List<string>();
            if (clientOnly.Count > 0) errors.Add(string.Join(", ", clientOnly) + ": Diese Testfunktion benötigt den vollständigen lokalen Spielordner für Singleplayer. Einen Ordner mit enshrouded.exe wählen oder die Option ausschalten.");
            if (serverOnly.Count > 0) errors.Add(string.Join(", ", serverOnly) + ": Hierfür einen vollständigen, getrennten Dedicated-Serverordner wählen oder die Option ausschalten.");
            if (knownTargetOnly.Count > 0) errors.Add(string.Join(", ", knownTargetOnly) + ": Hierfür einen eindeutig erkannten, vollständigen Steam-Spielordner für Singleplayer oder einen getrennten Dedicated-Serverordner wählen. Unbekannte und gemischte Ziele sind gesperrt; eine aktive Option lässt sich ausschalten.");
            return errors.Count == 0 ? null : string.Join(Environment.NewLine, errors) + " Die Wirkung im Spiel ist noch ungeprüft.";
        }
        public string ExportEngine(Dictionary<string, object> config)
        {
            var errors = Validate(config);
            if (errors.Count > 0) throw new InvalidDataException(string.Join(Environment.NewLine, errors.Take(8)));
            var gameplay = Json.Object(config["gameplay"], "Gameplay");
            var serverLimits = Json.Object(gameplay["enableUncapDedicatedServerSettings"], "Server-Grenzen");
            if ((bool)serverLimits["enabled"] && !IsVerifiedEngine123())
                throw new InvalidOperationException("Die Server-Grenzen-Erweiterung benötigt den geprüften Patcher 1.2.3. Die SHA256-Prüfsumme der eingebauten EXE stimmt nicht überein oder die Datei fehlt. Alte Versionen können Faktoren auf 1000 % festsetzen. Bitte die geprüfte vollständige Mod-Studio-Version verwenden.");
            var gather = Json.Object(gameplay["enableGatherLootMultipliers"], "Sammelbeute");
            if ((bool)gather["enabled"] && (Json.Number(gather["enemyLootMultiplier"]) != 1 || Json.Number(gather["chestLootMultiplier"]) != 1))
                throw new InvalidOperationException("Gegner- und Truhenbeute unter Sammelbeute haben im Patcher 1.2.3 keine Wirkung. Beide Werte müssen für den Patch-Start auf 1 stehen. Für zusätzliche Zufallsplätze stattdessen Beuteplätze nach Quelle verwenden; garantierte Itemmengen werden damit nicht vervielfacht.");
            string target = Path.Combine(AppRoot, "engine", "config.json");
            var output = Json.Clone(config);
            if (File.Exists(target))
            {
                var existing = Json.Read(target);
                output = Json.Merge(existing, output);
                object runtimeVersion;
                if (existing.TryGetValue("kfcParserVersion", out runtimeVersion) && runtimeVersion is string && !string.IsNullOrEmpty((string)runtimeVersion))
                    output["kfcParserVersion"] = runtimeVersion;
            }
            Json.Write(target, output, BackupRoot); return target;
        }
        public ProcessStartInfo LaunchInfo()
        {
            string exe = Path.Combine(AppRoot, "engine", "enshrouded-patcher.exe");
            if (!File.Exists(exe)) throw new FileNotFoundException("Der mitgelieferte Patcher fehlt.", exe);
            string runner = Path.GetFullPath(Path.Combine(AppRoot, "engine", "studio-runner.js"));
            if (!File.Exists(runner)) throw new FileNotFoundException("Der Mod-Studio-Startadapter fehlt. Bitte die vollständige Mod-Studio-Version entpacken.", runner);
            var info = new ProcessStartInfo(exe) { Arguments = "\"" + runner + "\"", WorkingDirectory = Path.GetDirectoryName(exe), UseShellExecute = false, CreateNoWindow = false };
            info.EnvironmentVariables["PKG_EXECPATH"] = "PKG_INVOKE_NODEJS";
            return info;
        }
        public ProcessStartInfo UpdateLaunchInfo(string statusFile)
        {
            var info = LaunchInfo();
            info.Arguments += " --update --status-file \"" + Path.GetFullPath(statusFile) + "\"";
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            info.StandardOutputEncoding = Encoding.UTF8;
            info.StandardErrorEncoding = Encoding.UTF8;
            return info;
        }
        public ProcessStartInfo BasisLaunchInfo(string statusFile, bool renew, string token)
        {
            if (renew && (token == null || token.Length != 64 || !token.All(Uri.IsHexDigit))) throw new InvalidDataException("Die Prüfung des aktuellen Dateistands fehlt. Bitte den Basisdialog erneut öffnen.");
            var info = LaunchInfo();
            info.Arguments += renew ? " --renew-basis --expected-fingerprint " + token + " --steam-files-verified" : " --inspect-basis";
            info.Arguments += " --status-file \"" + Path.GetFullPath(statusFile) + "\"";
            info.CreateNoWindow = true; info.RedirectStandardOutput = true; info.RedirectStandardError = true;
            info.StandardOutputEncoding = Encoding.UTF8; info.StandardErrorEncoding = Encoding.UTF8;
            return info;
        }
        public ProcessStartInfo StackInspectionLaunchInfo(string statusFile)
        {
            var info = LaunchInfo();
            info.Arguments += " --inspect-stacks --status-file \"" + Path.GetFullPath(statusFile) + "\"";
            info.CreateNoWindow = true; info.RedirectStandardOutput = true; info.RedirectStandardError = true;
            info.StandardOutputEncoding = Encoding.UTF8; info.StandardErrorEncoding = Encoding.UTF8;
            return info;
        }
        public bool IsVerifiedEngine123()
        {
            try
            {
                using (var stream = File.OpenRead(Path.Combine(AppRoot, "engine", "enshrouded-patcher.exe")))
                using (var sha = SHA256.Create())
                    return string.Equals(BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", ""), VerifiedEngineSha256, StringComparison.OrdinalIgnoreCase);
            }
            catch { return false; }
        }
        public Process Launch(Dictionary<string, object> config)
        {
            string roleError = RestrictedTargetError(config); if (roleError != null) throw new InvalidDataException(roleError);
            string path = (string)config["gameDirectory"];
            if (!CheckGame(path).EndsWith("erkannt")) throw new InvalidDataException(CheckGame(path));
            foreach (string process in new[] { "enshrouded", "enshrouded_server", "enshrouded-patcher" })
                if (Process.GetProcessesByName(process).Length > 0) throw new InvalidOperationException("Bitte " + process + " zuerst schließen.");
            var startInfo = LaunchInfo();
            ExportEngine(config);
            return Process.Start(startInfo);
        }
        public Process LaunchUpdate(Dictionary<string, object> config, string statusFile)
        {
            string roleError = RestrictedTargetError(config); if (roleError != null) throw new InvalidDataException(roleError);
            string path = (string)config["gameDirectory"];
            if (!CheckGame(path).EndsWith("erkannt")) throw new InvalidDataException(CheckGame(path));
            foreach (string process in new[] { "enshrouded", "enshrouded_server", "enshrouded-patcher" })
                if (Process.GetProcessesByName(process).Length > 0) throw new InvalidOperationException("Bitte " + process + " zuerst schließen.");
            var startInfo = UpdateLaunchInfo(statusFile);
            ExportEngine(config);
            return Process.Start(startInfo);
        }
        public Process LaunchBasisOperation(Dictionary<string, object> config, string statusFile, bool renew, string token)
        {
            string path = (string)config["gameDirectory"];
            if (!CheckGame(path).EndsWith("erkannt")) throw new InvalidDataException(CheckGame(path));
            if (Process.GetProcessesByName("enshrouded-patcher").Length > 0) throw new InvalidOperationException("Bitte den laufenden Patcher zuerst schließen.");
            if (renew) foreach (string process in new[] { "enshrouded", "enshrouded_server" })
                if (Process.GetProcessesByName(process).Length > 0) throw new InvalidOperationException("Bitte " + process + " vor dem Basiswechsel schließen.");
            var info = BasisLaunchInfo(statusFile, renew, token);
            ExportEngine(config);
            return Process.Start(info);
        }
        public Process LaunchStackInspection(Dictionary<string, object> config, string statusFile)
        {
            string path = (string)config["gameDirectory"];
            if (!CheckGame(path).EndsWith("erkannt")) throw new InvalidDataException(CheckGame(path));
            if (Process.GetProcessesByName("enshrouded-patcher").Length > 0) throw new InvalidOperationException("Bitte den laufenden Patcher zuerst schließen.");
            var info = StackInspectionLaunchInfo(statusFile);
            ExportEngine(config);
            return Process.Start(info);
        }
        public Process LaunchSkillInspection(Dictionary<string, object> config, string statusFile)
        {
            if (!CheckGame((string)config["gameDirectory"]).EndsWith("erkannt")) throw new InvalidDataException("Bitte eine vollständige Client- oder Serverinstallation wählen.");
            if (Process.GetProcessesByName("enshrouded-patcher").Length > 0) throw new InvalidOperationException("Bitte den laufenden Patcher zuerst schließen.");
            var info = StackInspectionLaunchInfo(statusFile);
            info.Arguments = info.Arguments.Replace("--inspect-stacks", "--inspect-skill-points");
            ExportEngine(config); return Process.Start(info);
        }
    }
}
