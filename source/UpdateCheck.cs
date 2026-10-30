using System;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace EnshroudedStudio
{
    public sealed class UpdateResult
    {
        public string Repository;
        public string ReleaseNotes;
        public string InstallerDownloadUrl, InstallerAssetName, InstallerSha256;
        public long InstallerAssetSize;
        public bool InstallerAvailable { get { return InstallerAssetSize > 0 && InstallerAssetSize <= UpdateInstaller.MaximumArchiveBytes && InstallerSha256 != null && Regex.IsMatch(InstallerSha256, @"^[a-f0-9]{64}\z"); } }
        public Version InstalledVersion;
        public Version LatestVersion;
        public string ReleaseTag;
        public string DownloadUrl;
        public string AssetName;
        public long AssetSize;
        public string Sha256;
        public string InstallUnavailableReason;
        public bool AutomaticInstallAvailable { get { return AssetSize > 0 && AssetSize <= UpdateInstaller.MaximumArchiveBytes && Sha256 != null && Regex.IsMatch(Sha256, @"^[a-f0-9]{64}\z"); } }
        public bool NoRelease;
        public bool IsNewer { get { return LatestVersion != null && LatestVersion > InstalledVersion; } }
    }

    public static class UpdateCheck
    {
        public static string InstalledVersion { get { return DisplayVersion(typeof(UpdateCheck).Assembly.GetName().Version); } }
        public const int TimeoutMilliseconds = 10000;
        public const int MaximumResponseBytes = 1024 * 1024;
        private static readonly Regex RepositoryPattern = new Regex(@"^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\z", RegexOptions.CultureInvariant);
        private static readonly Regex VersionPattern = new Regex(@"^v?[0-9]+\.[0-9]+\.[0-9]+(?:\.[0-9]+)?\z", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

        public static Version ParseVersion(string value)
        {
            Version parsed;
            if (value == null || !VersionPattern.IsMatch(value) || !Version.TryParse(value.TrimStart('v', 'V'), out parsed))
                throw new InvalidDataException("Die Versionsnummer der GitHub-Veröffentlichung ist nicht gültig.");
            return new Version(parsed.Major, parsed.Minor, parsed.Build, Math.Max(0, parsed.Revision));
        }

        public static string DisplayVersion(Version version)
        {
            return version.Revision == 0 ? version.ToString(3) : version.ToString(4);
        }

        public static string ValidateRepository(string repository)
        {
            if (repository == null || !RepositoryPattern.IsMatch(repository))
                throw new InvalidDataException("Die Updateadresse im Paket ist nicht gültig.");
            return repository;
        }

        public static string ExpectedAssetName(string tag)
        {
            ParseVersion(tag);
            return "Enshrouded-Mod-Studio-" + tag.TrimStart('v', 'V') + ".zip";
        }

        public static string ExpectedInstallerName(string tag)
        { ParseVersion(tag); return "Enshrouded-Mod-Studio-" + tag.TrimStart('v', 'V') + "-Setup.exe"; }
        public static bool IsAllowedInstallerUrl(string repository, string tag, string name, string url)
        {
            try
            {
                ValidateRepository(repository); if (name != ExpectedInstallerName(tag)) return false;
                Uri u; return Uri.TryCreate(url, UriKind.Absolute, out u) && u.Scheme == "https" && u.Host == "github.com" && u.IsDefaultPort && u.UserInfo.Length == 0 && u.Query.Length == 0 && u.Fragment.Length == 0 &&
                    string.Equals(url, "https://github.com/" + repository + "/releases/download/" + tag + "/" + name, StringComparison.Ordinal);
            }
            catch (InvalidDataException) { return false; }
        }
        public static bool IsAllowedAssetUrl(string repository, string tag, string assetName, string url)
        {
            try
            {
                ValidateRepository(repository);
                string expectedName = ExpectedAssetName(tag);
                if (!string.Equals(assetName, expectedName, StringComparison.Ordinal)) return false;
                Uri uri;
                if (!Uri.TryCreate(url, UriKind.Absolute, out uri) || uri.Scheme != Uri.UriSchemeHttps ||
                    !string.Equals(uri.Host, "github.com", StringComparison.OrdinalIgnoreCase) ||
                    !uri.IsDefaultPort || uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0) return false;
                string expected = "https://github.com/" + repository + "/releases/download/" + tag + "/" + expectedName;
                // Exact equality also rejects encoded separators, dot paths and alternate authority spellings.
                return string.Equals(url, expected, StringComparison.Ordinal);
            }
            catch (InvalidDataException) { return false; }
        }

        public static string RepositoryFromPackage(string appRoot)
        {
            string file = Path.Combine(appRoot, "assets", "update.json");
            if (!File.Exists(file)) throw new InvalidDataException("Die Updateadresse fehlt im Paket. Bitte das vollständige Mod-Studio-ZIP entpacken.");
            if (new FileInfo(file).Length > 4096) throw new InvalidDataException("Die Updateadresse im Paket ist nicht gültig.");
            var config = Json.Read(file);
            object value;
            if (!config.TryGetValue("repository", out value) || !(value is string)) throw new InvalidDataException("Die Updateadresse im Paket ist nicht gültig.");
            return ValidateRepository((string)value);
        }

        public static UpdateResult ParseRelease(string json, string repository, string installedVersion)
        {
            ValidateRepository(repository);
            var installed = ParseVersion(installedVersion);
            Dictionary<string, object> release;
            try
            {
                if (json == null || Encoding.UTF8.GetByteCount(json) > MaximumResponseBytes) throw new InvalidDataException();
                var serializer = Json.Serializer(); serializer.MaxJsonLength = MaximumResponseBytes; serializer.RecursionLimit = 30;
                release = Json.Object(serializer.DeserializeObject(json), "GitHub-Antwort");
            }
            catch (Exception ex)
            {
                if (!(ex is ArgumentException) && !(ex is InvalidOperationException) && !(ex is InvalidDataException)) throw;
                throw new InvalidDataException("GitHub hat keine gültige Release-Antwort geliefert.");
            }
            object value;
            if (!release.TryGetValue("draft", out value) || !(value is bool) || (bool)value ||
                !release.TryGetValue("prerelease", out value) || !(value is bool) || (bool)value)
                throw new InvalidDataException("Die Veröffentlichung ist keine freigegebene stabile Version.");
            if (!release.TryGetValue("tag_name", out value) || !(value is string)) throw new InvalidDataException("Die Versionsnummer fehlt in der GitHub-Antwort.");
            string tag = (string)value;
            var latest = ParseVersion(tag);
            var result = new UpdateResult { Repository = repository, InstalledVersion = installed, LatestVersion = latest, ReleaseTag = tag };
            object body; if (release.TryGetValue("body", out body) && body != null && !(body is string)) throw new InvalidDataException("Die Änderungsbeschreibung der Veröffentlichung ist ungültig.");
            result.ReleaseNotes = StartupUpdates.CleanNotes(body as string);
            if (!result.IsNewer) return result;
            object[] assets;
            if (!release.TryGetValue("assets", out value) || (assets = value as object[]) == null)
                throw new InvalidDataException("Die neue Version enthält noch kein passendes vollständiges ZIP. Bitte später erneut prüfen.");
            string expectedName = ExpectedAssetName(tag), download = null;
            foreach (object entry in assets)
            {
                var asset = entry as Dictionary<string, object>;
                if (asset == null || !asset.TryGetValue("name", out value) || !(value is string) || (string)value != expectedName) continue;
                if (download != null) throw new InvalidDataException("Der ZIP-Download ist nicht eindeutig. Bitte später erneut prüfen.");
                if (!asset.TryGetValue("browser_download_url", out value) || !(value is string) || !IsAllowedAssetUrl(repository, tag, expectedName, (string)value))
                    throw new InvalidDataException("Die Downloadadresse passt nicht zur vorgesehenen GitHub-Version.");
                download = (string)value;
                result.AssetName = expectedName;
                long size;
                if (asset.TryGetValue("size", out value) && (value is int || value is long) && (size = Convert.ToInt64(value)) > 0 && size <= UpdateInstaller.MaximumArchiveBytes)
                    result.AssetSize = size;
                if (asset.TryGetValue("digest", out value) && value is string && Regex.IsMatch((string)value, @"^sha256:[a-fA-F0-9]{64}\z"))
                    result.Sha256 = ((string)value).Substring(7).ToLowerInvariant();
            }
            if (download == null) throw new InvalidDataException("Die neue Version enthält noch kein passendes vollständiges ZIP. Bitte später erneut prüfen.");
            string setupName = ExpectedInstallerName(tag);
            foreach (object entry in assets)
            {
                var asset = entry as Dictionary<string, object>;
                if (asset == null || !asset.TryGetValue("name", out value) || !(value is string) || (string)value != setupName) continue;
                if (result.InstallerDownloadUrl != null) throw new InvalidDataException("Der Installer-Download ist nicht eindeutig.");
                if (!asset.TryGetValue("browser_download_url", out value) || !(value is string) || !IsAllowedInstallerUrl(repository, tag, setupName, (string)value))
                    throw new InvalidDataException("Die Installeradresse passt nicht zur vorgesehenen GitHub-Version.");
                result.InstallerDownloadUrl = (string)value; result.InstallerAssetName = setupName;
                long size;
                if (asset.TryGetValue("size", out value) && (value is int || value is long) && (size = Convert.ToInt64(value)) > 0 && size <= UpdateInstaller.MaximumArchiveBytes) result.InstallerAssetSize = size;
                if (asset.TryGetValue("digest", out value) && value is string && Regex.IsMatch((string)value, @"^sha256:[a-fA-F0-9]{64}\z")) result.InstallerSha256 = ((string)value).Substring(7).ToLowerInvariant();
            }
            result.DownloadUrl = download;
            if (!result.AutomaticInstallAvailable) result.InstallUnavailableReason = "GitHub liefert für dieses ZIP noch keine gültige SHA256-Prüfsumme und Dateigröße. Die automatische Installation ist deshalb nicht verfügbar.";
            return result;
        }

        public static async Task<UpdateResult> CheckAsync(string appRoot)
        {
            string repository = RepositoryFromPackage(appRoot);
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            var request = (HttpWebRequest)WebRequest.Create("https://api.github.com/repos/" + repository + "/releases/latest");
            request.Method = "GET"; request.UserAgent = "Enshrouded-Mod-Studio/" + InstalledVersion;
            request.Accept = "application/vnd.github+json";
            request.Headers["X-GitHub-Api-Version"] = "2022-11-28";
            request.AllowAutoRedirect = false; request.Timeout = TimeoutMilliseconds; request.ReadWriteTimeout = TimeoutMilliseconds;
            var transfer = Task.Run(delegate { return Fetch(request, repository); });
            if (await Task.WhenAny(transfer, Task.Delay(TimeoutMilliseconds)).ConfigureAwait(false) != transfer)
            {
                request.Abort();
                var faultObserver = transfer.ContinueWith(delegate(Task<UpdateResult> task) { GC.KeepAlive(task.Exception); }, TaskContinuationOptions.OnlyOnFaulted);
                GC.KeepAlive(faultObserver);
                throw new TimeoutException("Die Updateprüfung hat zu lange gedauert. Bitte später erneut versuchen.");
            }
            return await transfer.ConfigureAwait(false);
        }

        private static UpdateResult Fetch(HttpWebRequest request, string repository)
        {
            try
            {
                using (var response = (HttpWebResponse)request.GetResponse())
                {
                    if (response.StatusCode != HttpStatusCode.OK || response.ResponseUri.AbsoluteUri != request.RequestUri.AbsoluteUri)
                        throw new InvalidDataException("GitHub hat die Updateanfrage nicht wie erwartet beantwortet.");
                    if (response.ContentLength > MaximumResponseBytes) throw new InvalidDataException("Die GitHub-Antwort ist zu groß. Die Updateprüfung wurde abgebrochen.");
                    using (var input = response.GetResponseStream())
                    using (var bytes = new MemoryStream())
                    {
                        byte[] buffer = new byte[8192]; int count;
                        while ((count = input.Read(buffer, 0, buffer.Length)) > 0)
                        {
                            if (bytes.Length + count > MaximumResponseBytes) throw new InvalidDataException("Die GitHub-Antwort ist zu groß. Die Updateprüfung wurde abgebrochen.");
                            bytes.Write(buffer, 0, count);
                        }
                        return ParseRelease(Encoding.UTF8.GetString(bytes.ToArray()), repository, InstalledVersion);
                    }
                }
            }
            catch (WebException ex)
            {
                var response = ex.Response as HttpWebResponse;
                if (response != null)
                {
                    int status = (int)response.StatusCode; response.Close();
                    if (status == 404) return new UpdateResult { Repository = repository, InstalledVersion = ParseVersion(InstalledVersion), NoRelease = true };
                    if (status == 403 || status == 429) throw new InvalidOperationException("GitHub begrenzt gerade die Abfragen oder der Zugriff ist gesperrt. Bitte später erneut versuchen.");
                }
                if (ex.Status == WebExceptionStatus.Timeout || ex.Status == WebExceptionStatus.RequestCanceled)
                    throw new TimeoutException("Die Updateprüfung hat zu lange gedauert. Bitte später erneut versuchen.");
                throw new InvalidOperationException("GitHub ist gerade nicht erreichbar. Bitte die Internetverbindung prüfen und später erneut versuchen.");
            }
        }

        public static bool ShowDownloadDialog(Window owner, UpdateResult result, bool automatic = false, bool installedMode = false)
        {
            if (!result.IsNewer || !IsAllowedAssetUrl(result.Repository, result.ReleaseTag, ExpectedAssetName(result.ReleaseTag), result.DownloadUrl))
                throw new InvalidDataException("Es liegt kein geprüfter Download für eine neue Version vor.");
            if (installedMode && !result.InstallerAvailable) throw new InvalidDataException("Diese Veröffentlichung bietet noch keinen geprüften Installer für die installierte Anwendung. Das bisherige Studio bleibt geöffnet.");
            if (!result.AutomaticInstallAvailable && !installedMode)
            {
                if (MessageBox.Show(owner, result.InstallUnavailableReason + "\n\nDas ZIP stattdessen im Browser öffnen und manuell in einen neuen Ordner entpacken? Anschließend ‚Altes Setup übernehmen‘ verwenden.", "Automatische Installation nicht verfügbar", MessageBoxButton.YesNo, MessageBoxImage.Information) == MessageBoxResult.Yes)
                    Process.Start(new ProcessStartInfo(result.DownloadUrl) { UseShellExecute = true });
                return false;
            }
            return StartupUpdates.ShowUpdateNotice(owner, result, automatic);
        }

        private static string Fixture(string tag, string repository, string url)
        {
            return Json.Serializer().Serialize(new Dictionary<string, object> {
                { "tag_name", tag }, { "draft", false }, { "prerelease", false },
                { "assets", new object[] { new Dictionary<string, object> { { "name", ExpectedAssetName(tag) }, { "browser_download_url", url }, { "size", 12345 }, { "digest", "sha256:" + new string('a', 64) } } } }
            });
        }

        private static bool Rejected(Action action)
        {
            try { action(); return false; } catch (InvalidDataException) { return true; }
        }

        // Pure fixtures: no HTTP request, browser or file changes.
        public static void SelfTest(Action<bool, string> check)
        {
            const string repo = "Priestkiller/Enshrouded-Mod-Studio";
            Version current = ParseVersion(InstalledVersion);
            string tag = "v" + new Version(current.Major, current.Minor, current.Build + 1).ToString(3);
            string zip = ExpectedAssetName(tag), url = "https://github.com/" + repo + "/releases/download/" + tag + "/" + zip;
            check(ParseVersion("v0.4.9") == ParseVersion("0.4.9.0"), "Updater normalisiert drei- und vierteilige Versionsnummern");
            var newer = ParseRelease(Fixture(tag, repo, url), repo, InstalledVersion);
            check(newer.IsNewer && newer.DownloadUrl == url && newer.AutomaticInstallAvailable && newer.AssetSize == 12345 && newer.Sha256 == new string('a',64), "Updater findet das vollständige ZIP einer neueren stabilen Version");
            check(!ParseRelease("{\"tag_name\":\"v0.4.21\",\"draft\":false,\"prerelease\":false}", repo, InstalledVersion).IsNewer, "Updater benötigt bei identischer Version keinen neuen ZIP-Download");
            check(!ParseRelease("{\"tag_name\":\"v0.4.8\",\"draft\":false,\"prerelease\":false}", repo, InstalledVersion).IsNewer, "Updater bietet keine ältere Version an");
            string valid = Fixture(tag, repo, url);
            check(Rejected(delegate { ParseRelease(valid.Replace("\"draft\":false", "\"draft\":true"), repo, InstalledVersion); }) && Rejected(delegate { ParseRelease(valid.Replace("\"prerelease\":false", "\"prerelease\":true"), repo, InstalledVersion); }), "Updater weist Entwürfe und Vorabversionen ab");
            check(!IsAllowedAssetUrl(repo, tag, zip, url.Replace("github.com/", "github.com.evil.example/")) &&
                !IsAllowedAssetUrl(repo, tag, zip, url.Replace(repo, "Other/Repository")) &&
                !IsAllowedAssetUrl(repo, tag, zip, url + "?download=1") && !IsAllowedAssetUrl(repo, tag, zip, url + "#download") &&
                !IsAllowedAssetUrl(repo, tag, zip, url.Replace("https:", "http:")) &&
                !IsAllowedAssetUrl(repo, tag, zip, url.Replace("/" + tag + "/", "/" + tag + "-wrong/")), "Updater bindet HTTPS-Download exakt an Host, Repository, Tag und ZIP ohne Zusätze");
            check(Rejected(delegate { ParseRelease("{\"tag_name\":\"" + tag + "\",\"draft\":false,\"prerelease\":false,\"assets\":[]}", repo, InstalledVersion); }), "Updater weist fehlendes vollständiges Versions-ZIP ab");
            check(Rejected(delegate { ParseVersion("v0.4.10-beta"); }) && Rejected(delegate { ParseVersion("v0.4.10\n"); }) &&
                Rejected(delegate { ValidateRepository("Priestkiller/../Other"); }) && Rejected(delegate { ValidateRepository(repo + "\n"); }) &&
                Rejected(delegate { ParseRelease("kein JSON", repo, InstalledVersion); }), "Updater weist ungültige Versions-, Repository- und Antwortformate ab");
        }
    }
}
