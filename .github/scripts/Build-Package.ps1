$ErrorActionPreference = 'Stop'
$releaseRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$releaseSpec = Get-Content -LiteralPath (Join-Path $releaseRoot '.github\release.json') -Raw | ConvertFrom-Json
if ($releaseSpec.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid release version.' }
& (Join-Path $releaseRoot 'source\build.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
$releaseExe = Join-Path $releaseRoot 'Enshrouded Mod Studio.exe'
if ((Get-Item -LiteralPath $releaseExe).VersionInfo.FileVersion -ne ($releaseSpec.version + '.0')) { throw 'Unexpected executable version.' }
$releaseOutput = Join-Path $releaseRoot 'artifacts'
New-Item -ItemType Directory -Path $releaseOutput -Force | Out-Null
$releaseStage = Join-Path $releaseOutput ('package-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $releaseStage | Out-Null
foreach ($dir in @('assets','engine','source','tools','ThirdParty')) {
    Copy-Item -LiteralPath (Join-Path $releaseRoot $dir) -Destination (Join-Path $releaseStage $dir) -Recurse
}
foreach ($file in Get-ChildItem -LiteralPath $releaseRoot -File | Where-Object { $_.Extension -in @('.txt','.md','.cmd','.js') -or $_.Name -in @('Enshrouded Mod Studio.exe','Enshrouded Mod Studio.exe.config') }) {
    Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $releaseStage $file.Name)
}
# Only this GPL tool is downloaded. Proprietary patcher/vendor and the legacy
# parser are deliberately absent and must come from an existing installation.
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
foreach ($forbidden in @('Data','PreviousSetups','Pruefungen','engine\config.json','engine\vendor','engine\enshrouded-patcher.exe','engine\bin\kfc-parser.exe','engine\bin\kfc-parser.compat')) {
    if (Test-Path -LiteralPath (Join-Path $releaseStage $forbidden)) { throw ('Forbidden package content: ' + $forbidden) }
}
foreach ($required in @('ThirdParty\kfc-parser-GPL-3.0.txt','ThirdParty\kfc-parser-source-1670859.zip','ThirdParty\EMM-HERKUNFT.txt','README.md','THIRD-PARTY.md')) {
    if (-not (Test-Path -LiteralPath (Join-Path $releaseStage $required))) { throw ('Required notice/source missing: ' + $required) }
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$releaseName = 'Enshrouded-Mod-Studio-' + $releaseSpec.version + '.zip'
$releaseZip = Join-Path $releaseOutput $releaseName
if (Test-Path -LiteralPath $releaseZip) { throw 'Release archive already exists.' }
[IO.Compression.ZipFile]::CreateFromDirectory($releaseStage,$releaseZip,[IO.Compression.CompressionLevel]::Optimal,$false)
$releaseHash = (Get-FileHash -LiteralPath $releaseZip -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(($releaseZip + '.sha256'),($releaseHash + '  ' + $releaseName + [Environment]::NewLine),[Text.UTF8Encoding]::new($false))
$releaseProof = [ordered]@{version=$releaseSpec.version;archive=$releaseName;sha256=$releaseHash;bytes=(Get-Item -LiteralPath $releaseZip).Length;legacyRuntimeIncluded=$false;emmIncluded=$true;sourceIncluded=$true}
[IO.File]::WriteAllText((Join-Path $releaseOutput 'package.json'),($releaseProof | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
$releaseProof | ConvertTo-Json
