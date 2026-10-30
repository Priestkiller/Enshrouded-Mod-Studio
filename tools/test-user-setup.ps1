param([Parameter(Mandatory=$true)][string]$WorkDirectory)
$ErrorActionPreference='Stop'
$sourceRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workParent=[IO.Path]::GetFullPath($WorkDirectory)
New-Item -ItemType Directory -Path $workParent -Force | Out-Null
$work=Join-Path $workParent ('setup-tests-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
$data=Join-Path $work 'data';New-Item -ItemType Directory -Path $data | Out-Null
$definition=Join-Path $work 'PackageDefinition.cs'
[IO.File]::WriteAllText($definition,'namespace UGSM.Installation { internal static class PackageDefinition { internal const string AppId="UGSM.Player"; internal const string Version="1.1.0"; internal const string PayloadSha256=""; internal const string UninstallerSha256=""; } }')
$framework=Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319'
$references=@('System.dll','System.Core.dll','System.Security.dll','System.Web.Extensions.dll','System.Windows.Forms.dll','System.Drawing.dll','System.IO.Compression.dll','System.IO.Compression.FileSystem.dll')|ForEach-Object{'/reference:'+(Join-Path $framework $_)}
$exe=Join-Path $work 'SetupTests.exe'
$sources=@('setup-user\InstallState.cs','setup-user\Program.cs','setup-user\SetupTests.cs')|ForEach-Object{Join-Path $sourceRoot $_}
& (Join-Path $framework 'csc.exe') /nologo /target:exe /main:UGSM.Installation.SetupTests /platform:x64 /warnaserror+ ('/out:'+$exe) @references @sources $definition
if($LASTEXITCODE){throw 'Setup-Testprogramm konnte nicht kompiliert werden.'}
& $exe $data | Tee-Object -LiteralPath (Join-Path $workParent 'setup-headless-test.txt')
if($LASTEXITCODE){throw 'Setup-Tests fehlgeschlagen.'}
[ordered]@{passed=$true;headless=$true;installerLaunched=$false;registryMutated=$false;workDirectory=$work} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $workParent 'setup-headless-test.json') -Encoding UTF8
