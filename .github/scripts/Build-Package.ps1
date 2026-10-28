$ErrorActionPreference = 'Stop'
$releaseRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$releaseSpec = Get-Content -LiteralPath (Join-Path $releaseRoot '.github\release.json') -Raw | ConvertFrom-Json
if ($releaseSpec.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid release version.' }
# Private original archives and runtime imports must never become public assets.
foreach ($forbidden in @('RecoveryBases','private-test-input','private-test')) {
    if (Test-Path -LiteralPath (Join-Path $releaseRoot $forbidden)) { throw ('Private input in public source tree: ' + $forbidden) }
}
& (Join-Path $releaseRoot 'source\build.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
$releaseExe = Join-Path $releaseRoot 'Enshrouded Mod Studio.exe'
if ((Get-Item -LiteralPath $releaseExe).VersionInfo.FileVersion -ne ($releaseSpec.version + '.0')) { throw 'Unexpected executable version.' }
$releaseOutput = Join-Path $releaseRoot 'artifacts'
New-Item -ItemType Directory -Path $releaseOutput -Force | Out-Null
$explanationShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
& $explanationShell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $releaseRoot 'tests\skill-point-explanation-tests.ps1') -StudioAssembly $releaseExe -AppRoot $releaseRoot -OutputFile (Join-Path $releaseOutput 'skill-point-explanation-results.json')
if ($LASTEXITCODE -ne 0) { throw 'Skill-point explanation checks failed.' }
# Pin the immutable public ZIP, then extract only its GUI for the actual old
# updater's read-only profile validator. The local root EXE was just rebuilt.
$profileLegacyParent = if ($env:RUNNER_TEMP) { [IO.Path]::GetFullPath($env:RUNNER_TEMP) } else { [IO.Path]::GetFullPath([IO.Path]::GetTempPath()) }
$profileLegacyRoot = Join-Path $profileLegacyParent ('studio-legacy27-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $profileLegacyRoot | Out-Null
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $profileLegacyZip = Join-Path $profileLegacyRoot 'studio-0.4.27.zip'
    Invoke-WebRequest -Uri 'https://github.com/Priestkiller/Enshrouded-Mod-Studio/releases/download/v0.4.27/Enshrouded-Mod-Studio-0.4.27.zip' -OutFile $profileLegacyZip -UseBasicParsing
    if ((Get-FileHash -LiteralPath $profileLegacyZip -Algorithm SHA256).Hash.ToLowerInvariant() -cne '3a6e1afee22cc616e1f1535ccb4b23db20b27291cea047059c649740c90d461b') { throw 'Public Studio 0.4.27 ZIP checksum mismatch.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $profileLegacyExe = Join-Path $profileLegacyRoot 'Enshrouded Mod Studio.exe'
    $profileLegacyArchive = [IO.Compression.ZipFile]::OpenRead($profileLegacyZip)
    try {
        $entries = @($profileLegacyArchive.Entries | Where-Object { $_.FullName -ceq 'Enshrouded Mod Studio.exe' })
        if ($entries.Count -ne 1 -or $entries[0].Length -lt 1 -or $entries[0].Length -gt 32MB) { throw 'Public Studio 0.4.27 GUI inventory mismatch.' }
        $inputStream = $entries[0].Open(); $outputStream = [IO.File]::Open($profileLegacyExe,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose(); $inputStream.Dispose() }
    } finally { $profileLegacyArchive.Dispose() }
    if ([Reflection.AssemblyName]::GetAssemblyName($profileLegacyExe).Version.ToString() -cne '0.4.27.0' -or [Diagnostics.FileVersionInfo]::GetVersionInfo($profileLegacyExe).FileVersion -cne '0.4.27.0') { throw 'Wrong pinned Studio 0.4.27 GUI version.' }
    # A child process prevents loading the new GUI into this process, where the
    # independent genuine 0.4.10 updater proof below still needs its old identity.
    $testShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    & $testShell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $releaseRoot 'tests\profile-normalization-tests.ps1') -StudioAssembly $releaseExe -LegacyStudioAssembly $profileLegacyExe -AppRoot $releaseRoot -OutputFile (Join-Path $releaseOutput 'profile-normalization-results.json')
    if ($LASTEXITCODE -ne 0) { throw 'Profile normalization and actual old updater checks failed.' }
} finally {
    $cleanup = [IO.Path]::GetFullPath($profileLegacyRoot)
    if ([IO.Path]::GetDirectoryName($cleanup) -cne $profileLegacyParent.TrimEnd([IO.Path]::DirectorySeparatorChar) -or -not [IO.Path]::GetFileName($cleanup).StartsWith('studio-legacy27-',[StringComparison]::Ordinal)) { throw 'Unowned legacy GUI cleanup path.' }
    if ((Get-Item -LiteralPath $cleanup).Attributes -band [IO.FileAttributes]::ReparsePoint -or (Get-ChildItem -LiteralPath $cleanup -Recurse -Force -Attributes ReparsePoint)) { throw 'Linked legacy GUI test data remains untouched.' }
    Remove-Item -LiteralPath $cleanup -Recurse -Force
}
$releaseStage = Join-Path $releaseOutput ('package-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $releaseStage | Out-Null
foreach ($dir in @('assets','engine','source','tools','ThirdParty','tests')) {
    Copy-Item -LiteralPath (Join-Path $releaseRoot $dir) -Destination (Join-Path $releaseStage $dir) -Recurse
}
foreach ($file in Get-ChildItem -LiteralPath $releaseRoot -File | Where-Object { $_.Extension -in @('.txt','.md','.cmd','.js') -or $_.Name -in @('Enshrouded Mod Studio.exe','Enshrouded Mod Studio.exe.config') }) {
    Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $releaseStage $file.Name)
}
# Only this GPL tool is downloaded. Proprietary patcher/vendor and the legacy
# parser are deliberately absent and are set up locally from the user's original
# package, or retained from an existing verified installation.
$releaseEmmDir = Join-Path $releaseStage 'engine\bin'
New-Item -ItemType Directory -Path $releaseEmmDir -Force | Out-Null
$releaseEmm = Join-Path $releaseEmmDir 'emm.exe'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri 'https://github.com/Brabb3l/kfc-parser/releases/download/v0.2.0/emm.exe' -OutFile $releaseEmm -UseBasicParsing
if ((Get-FileHash -LiteralPath $releaseEmm -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'b1133f6b8ea7000596cc7710901bd8307b48165b0e650c0487a611d90ea49305') { throw 'EMM checksum mismatch.' }
$releaseManifest = Get-Content -LiteralPath (Join-Path $releaseStage 'engine\engine-manifest.json') -Raw | ConvertFrom-Json
if ($releaseManifest.studio -ne $releaseSpec.version) { throw 'Manifest version mismatch.' }
foreach ($entry in $releaseManifest.files.PSObject.Properties) {
    if ($entry.Name.StartsWith('vendor/')) { continue }
    $file = [IO.Path]::GetFullPath((Join-Path (Join-Path $releaseStage 'engine') $entry.Name))
    if (-not $file.StartsWith((Join-Path $releaseStage 'engine') + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid manifest path.' }
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.Value) { throw ('Package hash mismatch: ' + $entry.Name) }
}
foreach ($forbidden in @('Data','PreviousSetups','Pruefungen','RecoveryBases','private-test-input','private-test','engine\config.json','engine\vendor','engine\enshrouded-patcher.exe','engine\bin\kfc-parser.exe','engine\bin\kfc-parser.compat')) {
    if (Test-Path -LiteralPath (Join-Path $releaseStage $forbidden)) { throw ('Forbidden package content: ' + $forbidden) }
}
foreach ($entry in Get-ChildItem -LiteralPath $releaseStage -Recurse -Force) {
    if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw ('Linked package content: ' + $entry.Name) }
    if ($entry.Name -in @('RecoveryBases','private-test-input','private-test','reference.json') -or
        (-not $entry.PSIsContainer -and ($entry.Name -match '\.kfc(?:_|$)' -or $entry.Extension -eq '.bytecode' -or $entry.Name -in @('enshrouded.exe','enshrouded_server.exe','enshrouded_server.json')))) {
        throw ('Private/game content in public package: ' + $entry.Name)
    }
}
foreach ($required in @('ThirdParty\kfc-parser-GPL-3.0.txt','ThirdParty\kfc-parser-source-1670859.zip','ThirdParty\EMM-HERKUNFT.txt','README.md','THIRD-PARTY.md')) {
    if (-not (Test-Path -LiteralPath (Join-Path $releaseStage $required))) { throw ('Required notice/source missing: ' + $required) }
}
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$releaseName = 'Enshrouded-Mod-Studio-' + $releaseSpec.version + '.zip'
$releaseZip = Join-Path $releaseOutput $releaseName
if (Test-Path -LiteralPath $releaseZip) { throw 'Release archive already exists.' }
$releaseArchive = [IO.Compression.ZipFile]::Open($releaseZip,[IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in Get-ChildItem -LiteralPath $releaseStage -File -Recurse | Sort-Object FullName) {
        $relative = $file.FullName.Substring($releaseStage.Length + 1).Replace('\','/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($releaseArchive,$file.FullName,$relative,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $releaseArchive.Dispose() }
# Check actual entry spellings with the genuine legacy updater. Python's
# ZipInfo.filename normalizes Windows slashes and cannot prove this contract.
$legacyZip = Join-Path $releaseOutput 'old-updater.zip'
Invoke-WebRequest -Uri 'https://github.com/Priestkiller/Enshrouded-Mod-Studio/releases/download/v0.4.10/Enshrouded-Mod-Studio-0.4.10.zip' -OutFile $legacyZip -UseBasicParsing
if ((Get-FileHash -LiteralPath $legacyZip -Algorithm SHA256).Hash.ToLowerInvariant() -ne '306b93ab7d94133349055143a9712f133c584d41f7ec9716e6b3ffa7a5bf3a1c') { throw 'Legacy updater checksum mismatch.' }
$legacyRoot = Join-Path $releaseOutput 'old-updater'
[IO.Compression.ZipFile]::ExtractToDirectory($legacyZip,$legacyRoot)
$legacyExe = @(Get-ChildItem -LiteralPath $legacyRoot -Filter 'Enshrouded Mod Studio.exe' -File -Recurse)
if ($legacyExe.Count -ne 1) { throw 'Legacy updater executable missing.' }
$legacyAssembly = [Reflection.Assembly]::LoadFrom($legacyExe[0].FullName)
if ($legacyAssembly.GetName().Version.ToString() -ne '0.4.10.0') { throw 'Wrong legacy updater version.' }
$legacyInstaller = $legacyAssembly.GetType('EnshroudedStudio.UpdateInstaller')
$legacyFlags = [Reflection.BindingFlags]'Static,NonPublic'
$archiveCheck = [IO.Compression.ZipFile]::OpenRead($releaseZip)
try {
    if (@($archiveCheck.Entries | Where-Object { $_.FullName.Contains('\') }).Count -ne 0) { throw 'ZIP contains backslash entry names.' }
    $null = $legacyInstaller.GetMethod('InspectZip',$legacyFlags).Invoke($null,@($archiveCheck,[string](Join-Path $releaseOutput 'legacy-inspection')))
} finally { $archiveCheck.Dispose() }
$legacyResult = [Activator]::CreateInstance($legacyAssembly.GetType('EnshroudedStudio.UpdateResult'))
$legacyResult.Repository = 'Priestkiller/Enshrouded-Mod-Studio'
$legacyResult.LatestVersion = $legacyAssembly.GetType('EnshroudedStudio.UpdateCheck').GetMethod('ParseVersion').Invoke($null,@([string]$releaseSpec.version))
$null = $legacyInstaller.GetMethod('ValidatePackage',$legacyFlags).Invoke($null,@([string]$releaseStage,$legacyResult,$false))
$releaseHash = (Get-FileHash -LiteralPath $releaseZip -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(($releaseZip + '.sha256'),($releaseHash + '  ' + $releaseName + [Environment]::NewLine),[Text.UTF8Encoding]::new($false))
$releaseProof = [ordered]@{version=$releaseSpec.version;archive=$releaseName;sha256=$releaseHash;bytes=(Get-Item -LiteralPath $releaseZip).Length;legacyRuntimeIncluded=$false;emmIncluded=$true;sourceIncluded=$true}
[IO.File]::WriteAllText((Join-Path $releaseOutput 'package.json'),($releaseProof | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
$releaseProof | ConvertTo-Json
