param(
 [Parameter(Mandatory=$true)][ValidateSet('Studio','Player')][string]$AppKind,
 [Parameter(Mandatory=$true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
 [Parameter(Mandatory=$true)][string]$PayloadZip,
 [Parameter(Mandatory=$true)][string]$OutputFile
)
$ErrorActionPreference='Stop'
$sourceRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$PayloadZip=[IO.Path]::GetFullPath($PayloadZip)
$OutputFile=[IO.Path]::GetFullPath($OutputFile)
if(-not(Test-Path -LiteralPath $PayloadZip -PathType Leaf)){throw 'Das fertige ZIP-Paket fehlt.'}
if((Get-Item -LiteralPath $PayloadZip).Length -gt 128MB){throw 'ZIP-Paket überschreitet 128 MiB.'}
$appId=if($AppKind -eq 'Player'){'UGSM.Player'}else{'Enshrouded.ModStudio'}
$exeName=if($AppKind -eq 'Player'){'UGSM.Player.exe'}else{'Enshrouded Mod Studio.exe'}
$framework=Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319'
$vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if(-not(Test-Path -LiteralPath $vswhere)){throw 'Visual Studio Roslyn wird für ein reproduzierbares Setup benötigt.'}
$compiler=@(& $vswhere -latest -products '*' -find 'MSBuild\**\Bin\Roslyn\csc.exe' | Where-Object {Test-Path -LiteralPath $_ -PathType Leaf}) | Select-Object -First 1
if(-not $compiler){throw 'Der installierte Roslyn-Compiler fehlt.'}
$outputParent=Split-Path -Parent $OutputFile
New-Item -ItemType Directory -Path $outputParent -Force | Out-Null
$work=Join-Path $outputParent ('.setup-build-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 $archive=[IO.Compression.ZipFile]::OpenRead($PayloadZip)
 try {
  if($archive.Entries.Count -gt 8192){throw 'Zu viele ZIP-Einträge.'}
  $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $inventory=[Collections.Generic.List[object]]::new()
  $total=0L
  foreach($entry in $archive.Entries){
   if($entry.FullName.EndsWith('/')){continue}
   $relative=$entry.FullName.Replace('\','/')
   if($relative -match '(^/|:|(^|/)\.\.?(/|$)|//|[<>"|?*])' -or $relative -match '(^|/)[^/]*[ .](/|$)' -or $relative -match '(^|/)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|/|$)' -or -not $seen.Add($relative)){throw ('Unsicherer ZIP-Pfad: '+$relative)}
   if($relative -match '^(Data|PreviousSetups|profiles|saves|savegame|cache|logs|\.git|\.ugsm-player|\.ugsm-studio-transfer)(/|$)' -or $relative -in @('.ugsm-install.json','Uninstall-UGSM.exe') -or $relative -match '\.(kfc|dmp|key)$'){throw ('Private Daten oder nicht erlaubte Nutzdaten im Paket: '+$relative)}
   if((($entry.ExternalAttributes -shr 16) -band 0xf000) -eq 0xa000 -or ($entry.ExternalAttributes -band 0x400) -ne 0){throw 'ZIP-Verknüpfungen sind nicht erlaubt.'}
   $total += $entry.Length
   if($entry.Length -lt 0 -or $total -gt 512MB -or $inventory.Count -ge 4096){throw 'Programmpaket zu groß.'}
   $stream=$entry.Open(); $hash=[Security.Cryptography.SHA256]::Create()
   try {$digest=([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose();$stream.Dispose()}
   $inventory.Add([ordered]@{Path=$relative;Size=$entry.Length;Sha256=$digest})
  }
  if(-not $seen.Contains($exeName)){throw 'Das Hauptprogramm fehlt im ZIP.'}
  if($AppKind -eq 'Player'){
   $expected=@('UGSM.Player.exe','ugsm-player.exe','UGSM.Player.exe.config','THIRD-PARTY-NOTICES.txt','Anleitung.txt','sha256.json')
   if($inventory.Count -ne 6 -or @($expected | Where-Object {-not $seen.Contains($_)}).Count){throw 'Das Spielerclient-Paket muss exakt die sechs veröffentlichten Dateien enthalten.'}
   $reader=[IO.StreamReader]::new($archive.GetEntry('sha256.json').Open())
   try{$checksums=$reader.ReadToEnd() | ConvertFrom-Json}finally{$reader.Dispose()}
   if(@($checksums.PSObject.Properties).Count -ne 5){throw 'Ungültiges Spielerclient-Prüfsummenverzeichnis.'}
   foreach($file in $inventory | Where-Object {$_.Path -ne 'sha256.json'}){if($checksums.($file.Path) -ne $file.Sha256){throw ('Spielerclient-Prüfsumme stimmt nicht: '+$file.Path)}}
  }else{
   $allowedRoot=@('Enshrouded Mod Studio.exe','Enshrouded Mod Studio.exe.config')
   foreach($file in $inventory){if($file.Path.Contains('/')){if($file.Path.Split('/')[0] -notin @('assets','engine','source','tools','ThirdParty','tests','setup-user')){throw ('Unbekannter Studio-Paketordner: '+$file.Path)}}elseif($file.Path -notin $allowedRoot -and $file.Path -notmatch '\.(txt|md|json|cmd|ps1|js|ico|png|svg|license)$'){throw ('Unbekannte Studio-Paketdatei: '+$file.Path)}}
  }
  $mainFile=Join-Path $work $exeName
  $source=$archive.GetEntry($exeName).Open();$destination=[IO.File]::Create($mainFile)
  try{$source.CopyTo($destination)}finally{$source.Dispose();$destination.Dispose()}
  $fileVersion=[Version]([Diagnostics.FileVersionInfo]::GetVersionInfo($mainFile).FileVersion)
  if($fileVersion -ne [Version]($Version+'.0')){throw ('ZIP-Programmversion '+$fileVersion+' passt nicht zu Setup '+$Version)}
 }finally{$archive.Dispose()}
 $inventoryPath=Join-Path $work 'inventory.json'
 [IO.File]::WriteAllText($inventoryPath,(ConvertTo-Json -InputObject @($inventory.ToArray()) -Depth 5 -Compress),[Text.UTF8Encoding]::new($false))
 $payloadSha=(Get-FileHash -LiteralPath $PayloadZip -Algorithm SHA256).Hash.ToLowerInvariant()
 $definition=Join-Path $work 'PackageDefinition.cs'
 function Write-Definition([string]$uninstallSha){
  $text='[assembly: System.Reflection.AssemblyVersion("'+$Version+'.0")][assembly: System.Reflection.AssemblyFileVersion("'+$Version+'.0")]namespace UGSM.Installation { internal static class PackageDefinition { internal const string AppId="'+$appId+'"; internal const string Version="'+$Version+'"; internal const string PayloadSha256="'+$payloadSha+'"; internal const string UninstallerSha256="'+$uninstallSha+'"; } }'
  [IO.File]::WriteAllText($definition,$text,[Text.UTF8Encoding]::new($false))
 }
 $references=@('System.dll','System.Core.dll','System.Security.dll','System.Web.Extensions.dll','System.Windows.Forms.dll','System.Drawing.dll','System.IO.Compression.dll','System.IO.Compression.FileSystem.dll')|ForEach-Object{'/reference:'+(Join-Path $framework $_)}
 $sources=@((Join-Path $sourceRoot 'setup-user\InstallState.cs'),(Join-Path $sourceRoot 'setup-user\Program.cs'),$definition)
 $pathmap='/pathmap:'+$work+'=/setup-build,'+$sourceRoot+'=/ugsm-source'
 $uninstaller=Join-Path $work 'Uninstall-UGSM.exe'
 Write-Definition ''
 & $compiler /nologo /target:winexe /platform:x64 /optimize+ /warnaserror+ /deterministic+ $pathmap /define:UNINSTALLER ('/out:'+$uninstaller) @references @sources
 if($LASTEXITCODE){throw 'Deinstallationsprogramm konnte nicht kompiliert werden.'}
 Write-Definition ((Get-FileHash -LiteralPath $uninstaller -Algorithm SHA256).Hash.ToLowerInvariant())
 & $compiler /nologo /target:winexe /platform:x64 /optimize+ /warnaserror+ /deterministic+ $pathmap ('/out:'+$OutputFile) ('/resource:'+$PayloadZip+',UGSM.Setup.Payload') ('/resource:'+$inventoryPath+',UGSM.Setup.Inventory') ('/resource:'+$uninstaller+',UGSM.Setup.Uninstaller') @references @sources
 if($LASTEXITCODE){throw 'Setup konnte nicht kompiliert werden.'}
 [ordered]@{format=1;kind=$AppKind;appId=$appId;version=$Version;setup=(Split-Path -Leaf $OutputFile);sha256=(Get-FileHash -LiteralPath $OutputFile -Algorithm SHA256).Hash.ToLowerInvariant();bytes=(Get-Item -LiteralPath $OutputFile).Length;payloadSha256=$payloadSha;files=$inventory.Count;uncompressedBytes=$total;installedOrLaunched=$false} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath ($OutputFile+'.build.json') -Encoding UTF8
 Get-FileHash -LiteralPath $OutputFile -Algorithm SHA256
}finally{
 # Only the exact generated child directory is removed, using PowerShell end-to-end.
 $resolvedWork=[IO.Path]::GetFullPath($work)
 if([IO.Path]::GetDirectoryName($resolvedWork) -ne [IO.Path]::GetFullPath($outputParent).TrimEnd('\') -or -not([IO.Path]::GetFileName($resolvedWork).StartsWith('.setup-build-'))){throw 'Unsicherer Setup-Arbeitsordner.'}
 if(Test-Path -LiteralPath $resolvedWork){Remove-Item -LiteralPath $resolvedWork -Recurse -Force}
}
