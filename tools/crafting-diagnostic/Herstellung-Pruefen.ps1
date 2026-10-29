param([string]$StudioFolder,[string]$GameDirectory)
$ErrorActionPreference='Stop'
# Standalone archive diagnostic. Never invokes update, repack, restore or a game.
$script:ReferenceBuild='1273043|^/game38/branches/release_1.0|2026-10-20T14:55:29.904125Z'
$script:ApprovedParsers=@('b65d0558d09c1f0793e70ec50a76d9a06c3cc1a177b3185895b2c2ba1150250f')
function Safe-LocalPath([string]$value){
 if(-not $value -or -not [IO.Path]::IsPathRooted($value)){throw 'Ein lokaler absoluter Ordnerpfad ist erforderlich.'}
 $full=[IO.Path]::GetFullPath($value)
 if($full.StartsWith('\\') -or $full.Substring(2).Contains(':')){throw 'Netzwerk-, Geraete- und Datenstrompfade sind nicht erlaubt.'}
 for($cursor=$full;$cursor;$cursor=[IO.Path]::GetDirectoryName($cursor)){
  if(Test-Path -LiteralPath $cursor){if(((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Verknuepfte Diagnosepfade sind nicht erlaubt.'}}
  if([IO.Path]::GetDirectoryName($cursor) -eq $cursor){break}
 }
 return $full
}
function Read-SmallJSON([string]$file,[long]$maximum=2097152){
 $file=Safe-LocalPath $file
 if((Get-Item -LiteralPath $file).Length -gt $maximum){throw 'Die benoetigte JSON-Datei ueberschreitet die Diagnosegrenze.'}
 return [IO.File]::ReadAllText($file,[Text.Encoding]::UTF8)|ConvertFrom-Json
}
function Diagnostic-Number($value){
 if($value -is [int] -or $value -is [long] -or $value -is [double] -or $value -is [decimal]){
  $n=[double]$value;if(-not [double]::IsNaN($n) -and -not [double]::IsInfinity($n)){return $n}
 }
 return $null
}
function Read-CraftSelection($config){
 return [pscustomobject]@{quantityEnabled=($config.gameplay.enableCraftOutputMultiplier.enabled -ceq $true);quantityFactor=(Diagnostic-Number $config.gameplay.enableCraftOutputMultiplier.globalMultiplier);timeEnabled=($config.gameplay.enableAdjustCraftingTime.enabled -ceq $true);timeFactor=(Diagnostic-Number $config.gameplay.enableAdjustCraftingTime.factor)}
}
function Read-RecipeAnalysis($registry,$selection,[string]$build){
 if($registry.'$type' -cne 'keen::RecipeRegistryResource' -or $registry.'$guid' -cne '5e57de0f-280c-4559-8191-f02c1ba656e2' -or $registry.'$part' -ne 0){throw 'Unerwarteter Rezeptkatalog; Diagnose ohne Mengenbehauptung abgebrochen.'}
 $definitions=@(
  @('Rohkost-Fleischspiess','cb261229-dcee-4d0a-8224-6ec37212c81f','f4eb94dd-8e57-4b3c-9ab6-8fd0b3a49681',0),
  @('Schwarzpulver','061085cf-0949-415a-bfbf-b0102fc89d99','b387a93c-29aa-4444-9092-179ecee2c780',110),
  @('Fackel','7fa62007-a38e-4790-8591-873055fc3f34','224097e5-ed0d-49d2-9d23-43256a6682b3',0)
 )
 foreach($definition in $definitions){
  $matches=@($registry.recipes|Where-Object{$_.recipeGuid -ceq $definition[1]})
  if($matches.Count -ne 1){throw ('Rezept nicht eindeutig vorhanden: '+$definition[0])}
  $recipe=$matches[0];$outputs=@($recipe.output|Where-Object{$_.itemRef -ceq $definition[2]})
  if($outputs.Count -ne 1){throw ('Ausgabe-Identitaet nicht eindeutig: '+$definition[0])}
  $count=Diagnostic-Number $outputs[0].count;$duration=Diagnostic-Number $recipe.craftingDuration.value
  if($null -eq $count -or $count -lt 0 -or [Math]::Truncate($count) -ne $count -or $null -eq $duration -or $duration -lt 0){throw 'Ungueltiger nativer Rezeptwert.'}
  $expectedCount=$null;$expectedSeconds=$null
  if($build -ceq $script:ReferenceBuild){
   $expectedCount=1.0;if($selection.quantityEnabled){if($null -eq $selection.quantityFactor -or $selection.quantityFactor -le 0){throw 'Ungueltiger eingestellter Mengenfaktor.'};$expectedCount=[Math]::Max(1,[Math]::Floor($selection.quantityFactor+0.5))}
   $expectedSeconds=[double]$definition[3];if($selection.timeEnabled){if($null -eq $selection.timeFactor -or $selection.timeFactor -le 0){throw 'Ungueltiger eingestellter Zeitfaktor.'};$expectedSeconds=[Math]::Floor($expectedSeconds*1e9*$selection.timeFactor+0.5)/1e9}
  }
  [pscustomobject]@{name=$definition[0];recipeGuid=$definition[1];referenceCount=1;referenceSeconds=$definition[3];archiveCount=$count;archiveSeconds=$duration/1e9;expectedCount=$expectedCount;expectedSeconds=$expectedSeconds;referenceBuildMatches=($build -ceq $script:ReferenceBuild)}
 }
}
function Read-ArchiveEvidence([string]$game,[string]$prefix){
 foreach($name in @(($prefix+'.kfc'),($prefix+'.kfc_resources'))){
  $file=Safe-LocalPath (Join-Path $game $name);$info=Get-Item -LiteralPath $file
  if($info.PSIsContainer){throw 'Ein Spielarchiv ist kein regulaeres Dateiziel.'}
  [pscustomobject]@{name=$name;sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant();lastWriteUTC=$info.LastWriteTimeUtc.ToString('o');bytes=$info.Length}
 }
}
function Read-GameProcesses {
 foreach($process in @(Get-Process -Name enshrouded,enshrouded_server -ErrorAction SilentlyContinue)){
  $path='nicht lesbar';$started='nicht lesbar'
  try{if($process.Path){$path=$process.Path}}catch{}
  try{$started=$process.StartTime.ToUniversalTime().ToString('o')}catch{}
  [pscustomobject]@{name=$process.ProcessName;pid=$process.Id;path=$path;startedUTC=$started}
 }
}
function Read-LogEvidence([string]$game,[string]$prefix){
 $candidates=@((Join-Path $game ($prefix+'.log')),(Join-Path $game ('logs/'+$prefix+'.log')),(Join-Path ([IO.Path]::GetDirectoryName($game)) 'logs/enshrouded/enshrouded_server.log'))
 foreach($candidate in $candidates|Select-Object -Unique){
  if(-not(Test-Path -LiteralPath $candidate -PathType Leaf)){continue}
  $candidate=Safe-LocalPath $candidate;$stream=[IO.File]::Open($candidate,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite);$reader=[IO.StreamReader]::new($stream,[Text.Encoding]::UTF8)
  $firstTime=$null;$loaded=@();$characters=0;$lines=0
  try{while(-not $reader.EndOfStream -and $lines -lt 2000 -and $characters -lt 524288){
   $line=$reader.ReadLine();$lines++;$characters+=$line.Length
   if(-not $firstTime){$match=[regex]::Match($line,'Current UTC date:\s*(20\d{2}\.\d{2}\.\d{2} [0-2]\d:[0-5]\d:[0-5]\d)');if($match.Success){$firstTime=$match.Groups[1].Value+' UTC'}else{$match=[regex]::Match($line,'20\d{2}-\d{2}-\d{2}[T ][0-2]\d:[0-5]\d:[0-5]\d(?:[.,]\d+)?(?:\s*UTC|Z|\+00:00)?');if($match.Success){$firstTime=$match.Value}}}
   if($loaded.Count -lt 3 -and $line -match '(?i)\bLoaded\b.*enshrouded(?:_server)?\.kfc\b' -and $line -notmatch '(?i)password|token|invite|authorization|secret|command.?line'){$safe=[regex]::Replace($line,'[\x00-\x1f]',' ');$loaded+= $safe.Substring(0,[Math]::Min(260,$safe.Length))}
  }}finally{$reader.Dispose()}
  return [pscustomobject]@{file=$candidate;firstLogTimestamp=$firstTime;loadedArchives=$loaded}
 }
 return $null
}
function Read-HandoffEvidence([string]$game){
 $file=Join-Path $game '.ugsm-studio-transfer/handoff.json';if(-not(Test-Path -LiteralPath $file -PathType Leaf)){return $null}
 $value=Read-SmallJSON $file 65536
 $status=if($value.status -cin @('ready','preparing','failed','invalidated','waiting-client-basis')){$value.status}else{'unbekannt'}
 $plan=if($value.sourcePlanId -cmatch '^[0-9]+-[a-f0-9]{1,64}$'){$value.sourcePlanId}else{$null}
 $target=if($value.targetId -cmatch '^[a-f0-9]{20}$'){$value.targetId}else{$null}
 $revision=if($value.packageRevision -cmatch '^[a-f0-9]{64}$'){$value.packageRevision}else{$null}
 $source=$null;if($value.sourceDirectory){$source=Safe-LocalPath $value.sourceDirectory}
 return [pscustomobject]@{status=$status;sourceDirectory=$source;targetId=$target;planId=$plan;packageRevision=$revision}
}
function Format-CraftReport($report){
 $lines=[Collections.Generic.List[string]]::new();$lines.Add('HERSTELLUNG - NUR ARCHIVDIAGNOSE');$lines.Add('Zeit UTC: '+$report.checkedUTC)
 $lines.Add('Ziel: '+$report.gameDirectory);$lines.Add('Studio: '+$report.studioDirectory);$lines.Add('Build: '+$report.gameBuild)
 $lines.Add('Referenzbuild: '+$script:ReferenceBuild+'; Sollwerte nur fuer diesen Build.')
 $lines.Add('Konfiguration: Menge aktiv='+$report.selection.quantityEnabled+' Faktor='+$report.selection.quantityFactor+'; Zeit aktiv='+$report.selection.timeEnabled+' Faktor='+$report.selection.timeFactor)
 foreach($row in $report.recipes){$lines.Add($row.name+': Archivmenge='+$row.archiveCount+'; Soll='+$row.expectedCount+'; Archivdauer='+$row.archiveSeconds+'s; Solldauer='+$row.expectedSeconds+'s (Referenzmenge 1, Referenzdauer '+$row.referenceSeconds+'s)')}
 foreach($archive in $report.archives){$lines.Add($archive.name+': SHA256='+$archive.sha256+'; SchreibzeitUTC='+$archive.lastWriteUTC)}
 foreach($process in $report.processes){$lines.Add('Prozess '+$process.name+' PID='+$process.pid+'; StartUTC='+$process.startedUTC+'; EXE='+$process.path)}
 if(-not $report.processes.Count){$lines.Add('Keine Enshrouded-Prozesse erkannt.')}
 if($report.log){$lines.Add('Log: '+$report.log.file+'; erste Zeitangabe='+$report.log.firstLogTimestamp+' (Zeitzone wie im Log)');foreach($line in $report.log.loadedArchives){$lines.Add($line)}}
 if($report.handoff){$h=$report.handoff;$lines.Add('Uebergabe: '+$h.status+'; Quelle='+$h.sourceDirectory+'; ZielID='+$h.targetId+'; Plan='+$h.planId+'; Paket='+$h.packageRevision)}
 $lines.Add('Archivhashes waehrend der Pruefung unveraendert: '+$report.sourceArchivesUnchanged)
 if($report.error){$lines.Add('FEHLER: '+$report.error)}
 if($report.cleanupError){$lines.Add('Arbeitsdateien blieben erhalten: '+$report.cleanupError)}
 $lines.Add('Dateiwerte und Prozesszeiten belegen keine tatsaechlich im Spiel geladenen Werte. Keine Spiel- oder Serverdateien veraendert.')
 return $lines -join [Environment]::NewLine
}
function Remove-OwnedDiagnosticWork([string]$work,[string]$job){
 $work=Safe-LocalPath $work;$job=Safe-LocalPath $job
 if([IO.Path]::GetDirectoryName($work) -cne $job -or [IO.Path]::GetFileName($work) -cne 'work' -or [IO.File]::ReadAllText((Join-Path $work '.owned-crafting-diagnostic')) -cne 'crafting-readonly-v1'){throw 'Unbekannter Bereinigungspfad bleibt erhalten.'}
 if(@(Get-ChildItem -LiteralPath $work -Recurse -Force -Attributes ReparsePoint).Count){throw 'Verknuepfte Arbeitsdateien bleiben erhalten.'}
 Remove-Item -LiteralPath $work -Recurse -Force
}
function Invoke-CraftingDiagnostic([string]$StudioFolder,[string]$GameDirectory){
 if(-not $StudioFolder -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'engine') -PathType Container)){$StudioFolder=$PSScriptRoot}
 if(-not $StudioFolder){
  Add-Type -AssemblyName System.Windows.Forms;$dialog=New-Object Windows.Forms.FolderBrowserDialog
  try{$dialog.Description='Mod-Studio-Ordner mit dem Unterordner engine waehlen';$dialog.ShowNewFolderButton=$false;if($dialog.ShowDialog() -ne [Windows.Forms.DialogResult]::OK){throw 'Ordnerauswahl abgebrochen.'};$StudioFolder=$dialog.SelectedPath}finally{$dialog.Dispose()}
 }
 $StudioFolder=Safe-LocalPath $StudioFolder;$configFile=Join-Path $StudioFolder 'engine/config.json';$config=Read-SmallJSON $configFile
 if(-not $GameDirectory){$GameDirectory=$config.gameDirectory};$GameDirectory=Safe-LocalPath $GameDirectory
 $client=Test-Path -LiteralPath (Join-Path $GameDirectory 'enshrouded.exe') -PathType Leaf;$server=Test-Path -LiteralPath (Join-Path $GameDirectory 'enshrouded_server.exe') -PathType Leaf
 if($client -eq $server){throw 'Client oder Server muss im Zielordner eindeutig erkannt werden.'};$prefix=if($server){'enshrouded_server'}else{'enshrouded'}
 $parser=$null;$parserHash=$null
 foreach($relative in @('engine/bin/kfc-parser.exe','bin/kfc-parser.exe','engine/kfc-parser.exe')){
  $candidate=Safe-LocalPath (Join-Path $StudioFolder $relative);if(-not(Test-Path -LiteralPath $candidate -PathType Leaf)){continue}
  $candidateHash=(Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant();if($candidateHash -cin $script:ApprovedParsers){$parser=$candidate;$parserHash=$candidateHash;break}
 }
 if(-not $parser){throw 'Kein bereits vorhandener, gepruefter kfc-parser.exe im Studio gefunden. Keine Dateien heruntergeladen.'}
 $before=@(Read-ArchiveEvidence $GameDirectory $prefix)
 $parent=Safe-LocalPath (Join-Path $StudioFolder 'Data/diagnostics');[IO.Directory]::CreateDirectory($parent)|Out-Null
 $job=Safe-LocalPath (Join-Path $parent ('Herstellung-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)))
 [IO.Directory]::CreateDirectory($job)|Out-Null;$work=Join-Path $job 'work';$bin=Join-Path $work 'bin';$unpacked=Join-Path $work 'unpacked';[IO.Directory]::CreateDirectory($bin)|Out-Null
 [IO.File]::WriteAllText((Join-Path $work '.owned-crafting-diagnostic'),'crafting-readonly-v1')
 $report=[ordered]@{checkedUTC=[DateTime]::UtcNow.ToString('o');gameDirectory=$GameDirectory;studioDirectory=$StudioFolder;gameBuild=$null;selection=(Read-CraftSelection $config);recipes=@();archives=$before;processes=@(Read-GameProcesses);log=$null;handoff=$null;parserSHA256=$parserHash;sourceArchivesUnchanged=$null;error=$null;cleanupError=$null}
 try{
  try{$report.log=Read-LogEvidence $GameDirectory $prefix}catch{}
  try{$report.handoff=Read-HandoffEvidence $GameDirectory}catch{}
  $copied=Join-Path $bin 'kfc-parser.exe';[IO.File]::Copy($parser,$copied,$false)
  if((Get-FileHash -LiteralPath $copied -Algorithm SHA256).Hash.ToLowerInvariant() -cne $parserHash){throw 'Parserkopie stimmt nicht mit dem geprueften Werkzeug ueberein.'}
  $start=New-Object Diagnostics.ProcessStartInfo;$start.FileName=$copied;$start.WorkingDirectory=$bin;$start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
  $start.Arguments='unpack --game-directory "'+$GameDirectory+'" --file-name '+$prefix+' --output "'+$unpacked+'" --filter tkeen::RecipeRegistryResource'
  $process=New-Object Diagnostics.Process;$process.StartInfo=$start
  try{if(-not $process.Start()){throw 'Diagnoseparser konnte nicht starten.'};$stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync();if(-not $process.WaitForExit(180000)){$process.Kill();$process.WaitForExit();throw 'Zeitlimit des eigenen Diagnoseparsers erreicht.'};$out=$stdout.Result+$stderr.Result;if($process.ExitCode -ne 0 -or $out -match '\b[1-9]\d* failed\b|error:|panicked'){throw 'Der gepruefte Parser konnte den Rezeptkatalog nicht fehlerfrei lesen.'}}finally{$process.Dispose()}
  $reflection=Join-Path $bin 'reflection_data.json';if(Test-Path -LiteralPath $reflection){$reader=[IO.StreamReader]::new($reflection);try{$buffer=New-Object char[] 2048;$n=$reader.Read($buffer,0,2048);$head=-join $buffer[0..($n-1)];$match=[regex]::Match($head,'"version"\s*:\s*"([^"\r\n]{1,200})"');if($match.Success){$report.gameBuild=$match.Groups[1].Value}}finally{$reader.Dispose()}}
  $files=@(Get-ChildItem -LiteralPath (Join-Path $unpacked 'RecipeRegistryResource') -File -Filter '*.json');if($files.Count -ne 1){throw 'Ein einzelner erwarteter Rezeptkatalog fehlt.'}
  $registry=Read-SmallJSON $files[0].FullName 67108864;$report.recipes=@(Read-RecipeAnalysis $registry $report.selection $report.gameBuild)
 }catch{$report.error=$_.Exception.Message}
 finally{
  try{$after=@(Read-ArchiveEvidence $GameDirectory $prefix);$report.sourceArchivesUnchanged=($before.Count -eq $after.Count -and @($before|Where-Object{$b=$_;-not @($after|Where-Object{$_.name -ceq $b.name -and $_.sha256 -ceq $b.sha256}).Count}).Count -eq 0)}catch{$report.sourceArchivesUnchanged=$false;$report.error='Archivstand konnte nach der Diagnose nicht erneut bestaetigt werden.'}
  try{Remove-OwnedDiagnosticWork $work $job}catch{$report.cleanupError=$_.Exception.Message}
 }
 $text=Format-CraftReport ([pscustomobject]$report);$file=Join-Path $job 'Herstellung-Bericht.txt'
 [IO.File]::WriteAllText($file,$text,[Text.UTF8Encoding]::new($false));[IO.File]::WriteAllText((Join-Path $job 'Herstellung-Bericht.json'),($report|ConvertTo-Json -Depth 7),[Text.UTF8Encoding]::new($false))
 Write-Output $text;Write-Output ('Bericht gespeichert: '+$file)
}
if($MyInvocation.InvocationName -ne '.'){
 try{Invoke-CraftingDiagnostic $StudioFolder $GameDirectory}catch{Write-Output ('DIAGNOSE ABGEBROCHEN: '+$_.Exception.Message);exit 1}
}
