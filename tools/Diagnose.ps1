[CmdletBinding()]
param([string]$AppRoot, [switch]$OpenReport)
$ErrorActionPreference = 'Stop'

function Get-NormalizedDirectory([string]$Path, [string]$BaseDirectory) {
    if ([string]::IsNullOrWhiteSpace($Path)) { throw 'Installationspfad fehlt.' }
    if (-not [IO.Path]::IsPathRooted($Path)) { $Path = [IO.Path]::Combine($BaseDirectory, $Path) }
    $full = [IO.Path]::GetFullPath($Path)
    $rootPart = [IO.Path]::GetPathRoot($full)
    if ($full.Length -gt $rootPart.Length) { $full = $full.TrimEnd([char[]]@('\','/')) }
    return $full
}
function Get-StudioTargetId([string]$Directory) {
    $builder = New-Object Text.StringBuilder
    [void]$builder.Append('"')
    foreach ($character in $Directory.ToLowerInvariant().ToCharArray()) {
        if ($character -eq [char]92) { [void]$builder.Append('\\') }
        elseif ($character -eq [char]34) { [void]$builder.Append('\"') }
        elseif ([int]$character -lt 32) { [void]$builder.Append(('\u{0:x4}' -f [int]$character)) }
        else { [void]$builder.Append($character) }
    }
    [void]$builder.Append('"')
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($builder.ToString())))).Replace('-','').ToLowerInvariant().Substring(0,20) }
    finally { $sha.Dispose() }
}
function Get-DiagnosticHash([string]$Path) {
    try {
        if (-not [IO.File]::Exists($Path)) { return [pscustomobject]@{ value=$null; status='missing' } }
        return [pscustomobject]@{ value=(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant(); status='read' }
    } catch { return [pscustomobject]@{ value=$null; status='unknown_access_or_file_changed' } }
}
function Get-GameProcessSnapshots {
    foreach ($name in @('enshrouded','enshrouded_server')) {
        foreach ($process in [Diagnostics.Process]::GetProcessesByName($name)) {
            $exePath=$null; $start=$null; $pathStatus='read'; $startStatus='read'
            try { $exePath=$process.MainModule.FileName; if ([string]::IsNullOrWhiteSpace($exePath)) { $pathStatus='unknown' } } catch { $pathStatus='unknown_access_or_process_ended' }
            try { $start=$process.StartTime.ToUniversalTime().ToString('o') } catch { $startStatus='unknown_access_or_process_ended' }
            [pscustomobject]@{ name=$name; id=$process.Id; startTimeUtc=$start; startTimeStatus=$startStatus; exePath=$exePath; pathStatus=$pathStatus }
            $process.Dispose()
        }
    }
}
function Convert-GameProcessDiagnosis([object[]]$Snapshots, [string]$Target) {
    foreach ($snapshot in $Snapshots) {
        if ($snapshot.name -notin @('enshrouded','enshrouded_server')) { continue }
        $matches=$null; $exePath=$null; $pathStatus=[string]$snapshot.pathStatus
        if (-not [string]::IsNullOrWhiteSpace([string]$snapshot.exePath)) {
            try { $exePath=[IO.Path]::GetFullPath([string]$snapshot.exePath); $directory=Get-NormalizedDirectory ([IO.Path]::GetDirectoryName($exePath)) $Target; $matches=[string]::Equals($directory,$Target,[StringComparison]::OrdinalIgnoreCase) } catch { $pathStatus='unknown_invalid_path' }
        } else { $pathStatus='unknown_access_or_process_ended' }
        [pscustomobject]@{ name=[string]$snapshot.name; id=$snapshot.id; startTimeUtc=$snapshot.startTimeUtc; startTimeStatus=[string]$snapshot.startTimeStatus; exePath=$exePath; pathStatus=$pathStatus; selectedDirectoryMatches=$matches }
    }
}
function Get-FilteredGameLog([string]$Target) {
    $candidates=@()
    foreach ($folder in @($Target, (Join-Path $Target 'logs'))) {
        if ([IO.Directory]::Exists($folder)) { $candidates += @(Get-ChildItem -LiteralPath $folder -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -eq '.log' -or ($_.Extension -eq '.txt' -and $_.Name -match 'enshrouded') }) }
    }
    $latest=$candidates | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if ($null -eq $latest) { return [pscustomobject]@{ status='missing'; path=$null; lastWriteTimeUtc=$null; entries=@(); lastLoadedKfc=$null; selectedDirectoryMatches=$null } }
    $entries=@(); $loaded=$null; $directoryMatches=$null
    try {
        foreach ($line in @(Get-Content -LiteralPath $latest.FullName -Tail 2000 -Encoding UTF8 -ErrorAction Stop)) {
            if ($line -match '(?i)Loaded\s+kfc\s+file') {
                $match=[regex]::Match($line,'(?i)(?<path>(?:[a-z]:[\\/]|\\\\)[^"\r\n]*?\.kfc)\b')
                if ($match.Success) { $loaded=$match.Groups['path'].Value; $entries += [pscustomobject]@{ kind='loaded_kfc'; path=$loaded } }
            } elseif ($line -match '(?i)Game\s+Version') {
                $match=[regex]::Match($line,'(?i)Game\s+Version.*?\b(?<version>\d{4,})\b')
                if ($match.Success) { $entries += [pscustomobject]@{ kind='game_version'; version=$match.Groups['version'].Value } }
            } elseif ($line -match '(?i)wrong\s+size') {
                $nameMatch=[regex]::Match($line,'(?i)enshrouded(?:_server)?(?:_\d+\.dat|\.kfc(?:_resources)?)')
                $actual=[regex]::Match($line,'(?i)wrong\s+size\s+(?<number>[0-9'']+)')
                $expected=[regex]::Match($line,'(?i)expected\s*:\s*(?<number>[0-9'']+)')
                $entries += [pscustomobject]@{ kind='wrong_size'; file=$(if($nameMatch.Success){$nameMatch.Value}else{'unknown'}); actual=$(if($actual.Success){$actual.Groups['number'].Value.Replace("'",'')}else{$null}); expected=$(if($expected.Success){$expected.Groups['number'].Value.Replace("'",'')}else{$null}) }
            }
        }
        if ($loaded) { $directoryMatches=[string]::Equals((Get-NormalizedDirectory ([IO.Path]::GetDirectoryName($loaded)) $Target),$Target,[StringComparison]::OrdinalIgnoreCase) }
        return [pscustomobject]@{ status='read'; path=$latest.FullName; lastWriteTimeUtc=$latest.LastWriteTimeUtc.ToString('o'); entries=@($entries | Select-Object -Last 30); lastLoadedKfc=$loaded; selectedDirectoryMatches=$directoryMatches }
    } catch { return [pscustomobject]@{ status='unknown_access_or_changed'; path=$latest.FullName; lastWriteTimeUtc=$latest.LastWriteTimeUtc.ToString('o'); entries=@(); lastLoadedKfc=$null; selectedDirectoryMatches=$null } }
}
function Invoke-StudioDiagnostic {
    param([Parameter(Mandatory=$true)][string]$Root, [object[]]$ProcessSnapshots)
    $Root=Get-NormalizedDirectory $Root $PSScriptRoot
    $engine=Join-Path $Root 'engine'
    if (-not [IO.Directory]::Exists($engine)) { throw 'Bitte den Mod-Studio-Ordner mit dem Unterordner engine verwenden.' }
    $notes=New-Object 'Collections.Generic.List[string]'; $target=$null; $targetId=$null; $role=$null; $stateStatus='not_checked'; $state=$null; $files=@(); $gameBuildMatches=$null; $archiveMatches=$null; $processes=@(); $log=$null
    try {
        $config=Get-Content -LiteralPath (Join-Path $engine 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($config.gameDirectory -isnot [string]) { throw 'Target missing' }
        $target=Get-NormalizedDirectory $config.gameDirectory $engine; $targetId=Get-StudioTargetId $target
    } catch { $notes.Add('Installationsordner konnte nicht aus engine/config.json gelesen werden. Im Tool das gewünschte Profil speichern und die Diagnose erneut starten.') }
    if ($target) {
        $client=[IO.File]::Exists((Join-Path $target 'enshrouded.exe')); $server=[IO.File]::Exists((Join-Path $target 'enshrouded_server.exe'))
        if ($client -eq $server) { $notes.Add('Client-/Serverrolle fehlt oder ist mehrdeutig. Den gewählten Ordner im Tool prüfen.') }
        else {
            $role=$(if($server){'server'}else{'client'}); $prefix=$(if($server){'enshrouded_server'}else{'enshrouded'})
            $statePath=Join-Path $Root ('Data\patches\targets\' + $targetId + '\state.json')
            if ([IO.File]::Exists($statePath)) { try { $state=Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json; $stateStatus='read' } catch { $stateStatus='invalid'; $notes.Add('Der zuletzt angewendete Stand konnte nicht gelesen werden.') } } else { $stateStatus='missing'; $notes.Add('Keine state.json für diesen Ordner vorhanden. Ein erfolgreicher Patch ist in diesem Tool-Ordner nicht belegt.') }
            foreach ($extension in @('.exe','.kfc','.kfc_resources')) {
                $name=$prefix+$extension; $current=Get-DiagnosticHash (Join-Path $target $name); $expected=$null
                if ($state) { if ($extension -eq '.exe') { $expected=$state.exeHash } elseif ($state.currentArchives) { $property=$state.currentArchives.PSObject.Properties[$name]; if ($property) { $expected=$property.Value } } }
                if ($expected -isnot [string] -or $expected -notmatch '\A[0-9a-fA-F]{64}\z') { $expected=$null }
                $matches=$null; if ($current.value -and $expected) { $matches=[string]::Equals($current.value,$expected,[StringComparison]::OrdinalIgnoreCase) }
                $files += [pscustomobject]@{ name=$name; currentSha256=$current.value; readStatus=$current.status; lastAppliedSha256=$expected; matchesLastApplied=$matches }
            }
            $gameBuildMatches=$files[0].matchesLastApplied
            $archiveStates=@($files | Select-Object -Skip 1)
            if (@($archiveStates | Where-Object { $null -eq $_.matchesLastApplied }).Count -eq 0) { $archiveMatches=@($archiveStates | Where-Object { -not $_.matchesLastApplied }).Count -eq 0 }
            if (-not $PSBoundParameters.ContainsKey('ProcessSnapshots')) { $ProcessSnapshots=@(Get-GameProcessSnapshots) }
            $processes=@(Convert-GameProcessDiagnosis $ProcessSnapshots $target)
            $log=Get-FilteredGameLog $target
        }
    }
    $notes.Add('Prozesspfad nicht lesbar bedeutet unbekannt, nicht automatisch passend. Es werden keine Prozess-Kommandozeilen gelesen.')
    $notes.Add('Die letzte gefundene Logdatei ist kein Live-Nachweis. Der Bericht enthält nur gefilterte Versions-, KFC-Ladepfad- und Dateigrößenhinweise, keine Spieler-/IP-Zeilen.')
    $notes.Add('SHA-Vergleich belegt Dateigleichheit mit dem gespeicherten Stand; er bestätigt nicht die Wirkung einer Option im Spiel.')
    $report=[ordered]@{ format=1; operation='runtime-diagnosis'; utc=[DateTime]::UtcNow.ToString('o'); targetDir=$target; targetId=$targetId; targetRole=$role; stateStatus=$stateStatus; gameExeMatchesLastApplied=$gameBuildMatches; archivesMatchLastApplied=$archiveMatches; files=@($files); processes=@($processes); latestLog=$log; notes=@($notes.ToArray()) }
    $directory=Join-Path $Root 'Data\diagnostics'; [IO.Directory]::CreateDirectory($directory) | Out-Null
    $stamp=[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')+'-'+[guid]::NewGuid().ToString('N').Substring(0,6)
    $json=Join-Path $directory ($stamp+'.json'); $text=Join-Path $directory ($stamp+'.txt')
    $lines=New-Object 'Collections.Generic.List[string]'
    $lines.Add('ENSHROUDED MOD STUDIO - LADEPFAD UND PATCHSTAND'); $lines.Add('UTC: '+$report.utc); $lines.Add('Installation: '+$target); $lines.Add('Rolle: '+$role+' | gespeicherter Stand: '+$stateStatus)
    $label={param($value) if($null -eq $value){'unbekannt'}elseif($value){'gleich'}else{'ABWEICHEND'}}
    $lines.Add('Spiel-EXE gegen letzten angewendeten Stand: '+(& $label $gameBuildMatches)); $lines.Add('Beide Archive gegen letzten angewendeten Stand: '+(& $label $archiveMatches))
    foreach ($file in $files) { $lines.Add(''); $lines.Add($file.name+' ['+(& $label $file.matchesLastApplied)+']'); $lines.Add('Aktuell: '+$file.currentSha256+' ('+$file.readStatus+')'); $lines.Add('Zuletzt angewendet: '+$file.lastAppliedSha256) }
    $lines.Add(''); $lines.Add('LAUFENDE SPIELPROZESSE')
    if ($processes.Count -eq 0) { $lines.Add('Kein passender Prozess zum Zeitpunkt der Abfrage gefunden oder Zielrolle unbekannt.') }
    foreach ($process in $processes) { $lines.Add($process.name+' | PID '+$process.id+' | Start UTC '+$process.startTimeUtc); $lines.Add('EXE: '+$process.exePath+' ['+$process.pathStatus+']'); $lines.Add('Ordnervergleich: '+(& $label $process.selectedDirectoryMatches)) }
    $lines.Add(''); $lines.Add('LETZTE LOGDATEI - KEIN LIVE-NACHWEIS')
    if ($log) { $lines.Add('Datei: '+$log.path+' | UTC '+$log.lastWriteTimeUtc+' ['+$log.status+']'); $lines.Add('Zuletzt geladene KFC: '+$log.lastLoadedKfc); $lines.Add('Log-Ladeordnervergleich: '+(& $label $log.selectedDirectoryMatches)); foreach ($entry in $log.entries) { $lines.Add(($entry | ConvertTo-Json -Compress)) } }
    foreach ($note in $notes) { $lines.Add(''); $lines.Add($note) }
    $utf8=New-Object Text.UTF8Encoding($false); [IO.File]::WriteAllText($json,($report | ConvertTo-Json -Depth 8),$utf8); [IO.File]::WriteAllLines($text,$lines.ToArray(),$utf8)
    return [pscustomobject]@{ textPath=$text; jsonPath=$json; report=$report }
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        if ([string]::IsNullOrWhiteSpace($AppRoot)) { $AppRoot=Split-Path -Parent $PSScriptRoot }
        $diagnosis=Invoke-StudioDiagnostic -Root $AppRoot
        Write-Output $diagnosis.textPath
        if ($OpenReport) { Invoke-Item -LiteralPath $diagnosis.textPath }
    } catch { Write-Error 'Die Diagnose konnte nicht erstellt werden. Mod-Studio-Ordner und Schreibzugriff auf Data/diagnostics prüfen.'; exit 1 }
}
