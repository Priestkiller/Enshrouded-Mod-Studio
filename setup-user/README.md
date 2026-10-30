# Per-user setup for Studio and Spielerclient

These installers need no elevation and use the current Windows user. Manager continues to use its existing service installer.

Build only (never installs or opens an application):

```powershell
scripts/build-user-setup.ps1 -AppKind Player -Version 0.16.23 -PayloadZip <exact-built-zip> -OutputFile <UGSM-Player-0.16.23-Setup.exe>
scripts/build-user-setup.ps1 -AppKind Studio -Version 0.4.32 -PayloadZip <exact-built-zip> -OutputFile <Enshrouded-Mod-Studio-0.4.32-Setup.exe>
scripts/test-user-setup.ps1 -WorkDirectory <owned-test-output-on-H>
```

The builder validates the exact package inventory, inner Player checksums and the main EXE version. It embeds the immutable ZIP digest and each file's size/digest. Setup validates them again before installation and rehashes installed files before committing registration. It does not execute package scripts.

Installed applications retain a stable root. Existing matching HKCU registration is reused; a new installation offers a folder selector and defaults to the user's local Programs folder. H: can be selected explicitly. Setup never installs into a nonempty foreign/portable folder. Existing portable profile import is an application concern.

Registration uses HKCU `Software\Microsoft\Windows\CurrentVersion\Uninstall\UGSM.Player` or `Enshrouded.ModStudio` and `<root>/.ugsm-install.json`. The marker contains version, root, owner SID and owned file digests. Include `InstallState.cs` in each application build. `UserInstallState.IsRegistered(appId, root)` returns false for an ordinary portable copy and throws for damaged/orphan installation metadata. The Player's in-place updater calls `RefreshAfterUpdate(appId, root, version, relativeFiles)` after successful file replacement; this preserves uninstaller ownership while updating file digests and Apps & Features version.

Installed Studio update contract:

```text
Enshrouded-Mod-Studio-{version}-Setup.exe --update-existing --wait-pid <PID> --wait-start <UTC ticks> --restart
```

The setup reads its root only from its compiled app ID's registration. It validates the exact previous process path/start time, waits for shutdown, installs at the same root and restarts Studio with `--after-update`. No target folder or remote command can be supplied through this update mode. The application must verify release asset size/SHA-256 before launching Setup and persist release notes before exiting.

Each replacement has a rollback copy on the installation volume. Copy or metadata errors restore the previous files/marker/registration. Failed-operation rollback copies remain available beside the application for diagnosis; successful operations remove stage and rollback copies.

Uninstall deletes only installer-owned files whose current size and digest still match. It never recursively deletes the application root and never removes Data, profiles, saves, caches or unknown/modified files. The helper copies itself to a private adjacent work directory before uninstalling so Windows can release the installed uninstaller. The small running helper can remain there until normal temporary-file cleanup; it contains no user data or ZIP payload.

Headless checks use only synthetic owned files. They cover path escapes, reserved Windows names, wrong app/owner metadata, partial-copy rollback, metadata ownership merge, profile preservation and unchanged-versus-modified uninstall files. They do not modify the registry, launch Setup, install an application or claim a GUI/real-user installation test.
