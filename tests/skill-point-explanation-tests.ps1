param(
 [Parameter(Mandatory=$true)][string]$StudioAssembly,
 [string]$AppRoot,
 [string]$OutputFile
)
$ErrorActionPreference='Stop'
if(-not $AppRoot){$AppRoot=Split-Path -Parent $PSScriptRoot}
$assembly=[Reflection.Assembly]::LoadFrom([IO.Path]::GetFullPath($StudioAssembly))
$ui=$assembly.GetType('EnshroudedStudio.SkillPointUi',$true)
$checks=[Collections.Generic.List[string]]::new()
function Check([bool]$Condition,[string]$Description){if(-not $Condition){throw $Description};$checks.Add($Description)}
function Text([string]$Name){return [string]$ui.GetField($Name).GetRawConstantValue()}
function Notes([string]$Key,[string]$Original){return [string]$ui.GetMethod('NotesFor').Invoke($null,@($Key,$Original))}
$schema=Get-Content -LiteralPath (Join-Path $AppRoot 'assets\schema.json') -Raw|ConvertFrom-Json
$rootDefinition=($schema|Where-Object Key -eq player).Mods|Where-Object Key -eq adjustSkillPointsPerRoot
$rootNotes=Notes 'player.adjustSkillPointsPerRoot' $rootDefinition.Notes
Check ($rootNotes -ceq (Text 'RootNotes') -and $rootNotes -cne $rootDefinition.Notes) 'The root card replaces the retained legacy future-only schema note'
Check ($rootNotes -notmatch 'nur k.nftig' -and $rootNotes -match 'Bereits bekannte' -and $rootNotes -match 'Neuberechnung') 'Root guidance includes already-known rewards and removes the future-only claim'
Check ((Text 'RootExplanation') -match 'bereits bekannte' -and (Text 'RootExplanation') -match 'erneut freigeschaltet') 'The visible root explanation separates budget revaluation from unlocking roots again'
Check ((Notes 'player.adjustSkillPointsPerLevel' 'old') -ceq (Text 'Notes')) 'The level card keeps its dedicated explanation'
Check ((Notes 'inventory.adjustSlotCount' 'unchanged') -ceq 'unchanged') 'Other setting notes are unchanged'
Check ((Text 'Explanation') -match 'ersten Neuberechnung' -and (Text 'Explanation') -match 'fr.heren Leveln' -and (Text 'Explanation') -match 'Wurzelbelohnungen') 'The first recalculation explains both previous levels and known root rewards'
Check ((Text 'Notes') -match 'keine Diagnose' -and (Text 'Notes') -match 'nicht bewiesen' -and (Text 'Notes') -match '104 freie Punkte') 'The conditional example is not presented as measured character data'
$spent=(28-1)*2+14;$free29=(29-1)*4+4*14-$spent;$free30=(30-1)*4+4*14-$spent
Check ($spent -eq 68 -and $free29 -eq 100 -and $free30 -eq 104 -and $free30-$free29 -eq 4) 'The stated conditional first-level +100 and later +4 example follows the documented budget formula'
$result=[ordered]@{passed=$true;version=$assembly.GetName().Version.ToString();checks=$checks.Count;names=$checks.ToArray();gameStarted=$false;uiOpened=$false;saveFilesRead=$false;engineOrSchemaChanged=$false}
if($OutputFile){[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputFile),($result|ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))}
$result|ConvertTo-Json -Depth 4
