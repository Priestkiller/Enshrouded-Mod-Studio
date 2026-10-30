Mod Studio checks for a newer stable GitHub release once at a normal launch. This is enabled by default and can be disabled under Tools. An update displays its release notes before installation, with an eight-second countdown, a pause button and a defer button. Manual checks remain available. A failed automatic attempt is not repeated for the same release for thirty minutes; a successful update or a different release clears that restriction.

The executing assembly supplies the installed version. Release notes are bounded plain text. Asset names, repository/tag URLs, positive bounded sizes and SHA-256 digests must match the GitHub API response. Missing installer metadata never falls back to a portable update for a registered installation.

Installed mode uses the shared `UserInstallState` registration/owner/root validation and a verified `Enshrouded-Mod-Studio-{version}-Setup.exe` asset. The installer receives only `--update-existing --wait-pid ID --wait-start UTC_TICKS --restart`, derives its destination from the registration and waits for this process to exit. The generic installer owns atomic replacement, rollback, uninstall ownership and stable-root preservation. It restarts Studio with `--after-update`, so the first new launch displays the saved notes and does not immediately start another online update.

Portable mode retains the existing verified ZIP migration and child-process acceptance handshake. The old portable copy keeps its forwarding pointer. The first portable-to-installed migration must import the old Data tree and runtime through the installer or existing setup transfer; this is separate from subsequent stable-root updates.

Profiles, bases, backups and UI state remain under `<AppRoot>/Data`. Application update preferences, attempt backoff and saved notes are under `Data/updates/startup.json`, separate from game profile/schema data. Unknown preference keys survive writes; malformed preferences defer automatic updates and remain untouched until the user explicitly changes the setting. No automatic installation begins during a patch or with unsaved edits. Update handoff, preview and self-test starts skip automatic network checks.

Background validation (no desktop, game or real installer launch):

```
powershell.exe -NoProfile -NonInteractive -File source/build.ps1
powershell.exe -NoProfile -NonInteractive -File tests/startup-update-tests.ps1 -StudioAssembly '.\Enshrouded Mod Studio.exe'
powershell.exe -NoProfile -NonInteractive -File tests/update-data-migration-tests.ps1 -StudioAssembly '.\Enshrouded Mod Studio.exe' -SandboxParent '<short writable sandbox>'
```

The startup suite exercises release metadata, version selection, unsafe URLs, digest absence, duplicate assets, settings preservation/repair, launch gates, backoff, pending-versus-installed notes and the installer command contract. The migration suite exercises the existing ZIP path, profile/basis preservation, traversal/links, interrupted operations, long generated paths and rollback metadata. Neither suite confirms a live GitHub download or UI interaction.
