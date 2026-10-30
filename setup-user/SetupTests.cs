using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace UGSM.Installation
{
    internal static class SetupTests
    {
        private static int checks;
        private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); checks++; }
        private static void Reject(Action action, string message) { bool rejected = false; try { action(); } catch { rejected = true; } Check(rejected, message); }
        private static void Write(string root, string relative, string value) { string p = UserInstallState.Resolve(root, relative); Directory.CreateDirectory(Path.GetDirectoryName(p)); File.WriteAllText(p, value); }
        private static InstallFile Own(string root, string relative) { string p = UserInstallState.Resolve(root, relative); return new InstallFile { Path = relative, Size = new FileInfo(p).Length, Sha256 = UserInstallState.Sha256(p) }; }
        private static int Main(string[] args)
        {
            if (args.Length != 1) throw new ArgumentException("Owned test root required");
            string test = UserInstallState.RootPath(args[0]);
            if (!Directory.Exists(test) || Directory.EnumerateFileSystemEntries(test).Any()) throw new IOException("Test root must exist and be empty");
            foreach (string path in new[] { "../escape", "a/../escape", "/absolute", "C:/escape", "a:b", "a//b", "a/CON.txt", "a/lpt1", "a/trailing. ", "a\\..\\escape" }) Reject(delegate { UserInstallState.RelativePath(path); }, "Unsafe relative path accepted: " + path);
            Check(UserInstallState.RelativePath("assets/icon.png") == "assets/icon.png", "Valid relative path changed");
            Reject(delegate { UserInstallState.RootPath(Path.GetPathRoot(test)); }, "Drive root accepted");
            Reject(delegate { UserInstallState.RootPath("H:relative"); }, "Drive-relative root accepted");
            Reject(delegate { UserInstallState.RootPath("H:\\ambiguous. "); }, "Ambiguous Windows root accepted");
            string stage = Path.Combine(test, "stage"), root = Path.Combine(test, "app"), rollback = Path.Combine(test, "rollback");
            Directory.CreateDirectory(stage); Directory.CreateDirectory(root); Directory.CreateDirectory(rollback);
            Write(root, "app.exe", "old"); Write(root, "Data/profile.json", "profile"); Write(stage, "app.exe", "new"); Write(stage, "helper.exe", "helper");
            Reject(delegate { SetupEngine.ApplyFiles(stage, root, rollback, new[] { "app.exe", "helper.exe" }, delegate(int n) { if (n == 2) throw new IOException("injected failure"); }); }, "Injected failure ignored");
            Check(File.ReadAllText(Path.Combine(root, "app.exe")) == "old", "Existing file not rolled back");
            Check(!File.Exists(Path.Combine(root, "helper.exe")), "New file not rolled back");
            Check(File.ReadAllText(Path.Combine(root, "Data/profile.json")) == "profile", "Profile changed during rollback");
            string rollback2 = Path.Combine(test, "rollback2"); Directory.CreateDirectory(rollback2);
            SetupEngine.ApplyFiles(stage, root, rollback2, new[] { "app.exe", "helper.exe" }, null);
            Check(File.ReadAllText(Path.Combine(root, "app.exe")) == "new", "Update did not replace program");
            Check(File.ReadAllText(Path.Combine(root, "Data/profile.json")) == "profile", "Update touched profile");
            var record = new InstallRecord { Format = 1, AppId = "UGSM.Player", Root = root, OwnerSid = "test-user", Version = "1.0.0", Files = new List<InstallFile> { Own(root, "app.exe"), Own(root, "helper.exe") } };
            UserInstallState.Validate(record, "UGSM.Player", root, "test-user"); checks++;
            Reject(delegate { UserInstallState.Validate(record, "UGSM.Player", root, "another-user"); }, "Wrong owner accepted");
            Reject(delegate { UserInstallState.Validate(record, "Enshrouded.ModStudio", root, "test-user"); }, "Wrong app accepted");
            Write(root, "app.exe", "version-two");
            var updated = UserInstallState.WithUpdatedFiles(record, root, "1.1.0", new[] { "app.exe" });
            Check(updated.Version == "1.1.0" && updated.Files.Count == 2, "Updater lost ownership files");
            Check(updated.Files.Single(f => f.Path == "app.exe").Sha256 == UserInstallState.Sha256(Path.Combine(root, "app.exe")), "Updater kept old hash");
            Check(record.Version == "1.0.0", "Metadata update mutated prior rollback record");
            Write(root, "helper.exe", "user-modified");
            int retained = SetupEngine.RemoveOwnedFiles(updated);
            Check(!File.Exists(Path.Combine(root, "app.exe")), "Owned unchanged file retained");
            Check(File.ReadAllText(Path.Combine(root, "helper.exe")) == "user-modified" && retained == 1, "Modified program file deleted");
            Check(File.ReadAllText(Path.Combine(root, "Data/profile.json")) == "profile", "Uninstall deleted personal data");
            Check(SetupEngine.ProtectedData("Data/profiles.json") && SetupEngine.ProtectedData("saves/world.bin") && !SetupEngine.ProtectedData("assets/icon.png"), "Data protection classification wrong");
            UserInstallState.AtomicText(Path.Combine(root, "atomic.json"), "old"); UserInstallState.AtomicText(Path.Combine(root, "atomic.json"), "new");
            Check(File.ReadAllText(Path.Combine(root, "atomic.json")) == "new", "Atomic metadata replacement failed");
            Reject(delegate { SetupEngine.DeleteOwnedTree(test, root); }, "Unowned directory cleanup accepted");
            string importStage = Path.Combine(test, "import-stage"), importTarget = Path.Combine(test, "import-target");
            Directory.CreateDirectory(importStage); Directory.CreateDirectory(importTarget); Write(importStage, "Data/profile.json", "preserved-id");
            SetupEngine.MoveImportedData(importStage, importTarget);
            Check(File.ReadAllText(Path.Combine(importTarget, "Data/profile.json")) == "preserved-id", "Imported profile was not moved intact");
            Check(!Directory.Exists(Path.Combine(importStage, "Data")), "Import duplicated staged Data");
            Write(importStage, "Data/profile.json", "other-id");
            Reject(delegate { SetupEngine.MoveImportedData(importStage, importTarget); }, "Import overwrote existing Data");
            Check(File.ReadAllText(Path.Combine(importTarget, "Data/profile.json")) == "preserved-id", "Rejected import changed existing profile");
            Console.WriteLine("PASS " + checks + " headless checks; no app, installer, registry mutation or game launched.");
            return 0;
        }
    }
}
