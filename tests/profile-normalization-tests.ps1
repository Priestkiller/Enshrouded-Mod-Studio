param(
 [Parameter(Mandatory=$true)][string]$StudioAssembly,
 [string]$AppRoot,
 [string]$OutputFile,
 [ValidateNotNullOrEmpty()][string]$LegacyStudioAssembly
)
$ErrorActionPreference='Stop'
if(-not $AppRoot){$AppRoot=Split-Path -Parent $PSScriptRoot}
# A source checkout may retain a genuine 0.4.27 EXE, while a release build has
# already replaced it with a newer release. Never infer an old reader from the filename.
if(-not $LegacyStudioAssembly){
 $candidate=Join-Path $AppRoot 'Enshrouded Mod Studio.exe'
 if([IO.File]::Exists($candidate) -and [Reflection.AssemblyName]::GetAssemblyName($candidate).Version.ToString() -ceq '0.4.27.0'){$LegacyStudioAssembly=$candidate}
}
if($LegacyStudioAssembly){
 $LegacyStudioAssembly=[IO.Path]::GetFullPath($LegacyStudioAssembly)
 if([Reflection.AssemblyName]::GetAssemblyName($LegacyStudioAssembly).Version.ToString() -cne '0.4.27.0' -or [Diagnostics.FileVersionInfo]::GetVersionInfo($LegacyStudioAssembly).FileVersion -cne '0.4.27.0'){throw 'The explicit legacy updater assembly must be Studio 0.4.27.'}
}
Add-Type -AssemblyName System.Web.Extensions
Add-Type -TypeDefinition 'public sealed class LegacyStudioFieldMaximum { public double Minimum { get; set; } public double Maximum { get; set; } }'
$null=[Reflection.Assembly]::LoadFrom([IO.Path]::GetFullPath($StudioAssembly))
# Construction reads schema/defaults only. No Store.Load/Save or UI is invoked.
$store=New-Object EnshroudedStudio.StudioStore -ArgumentList ([IO.Path]::GetFullPath($AppRoot)),([IO.Path]::Combine([IO.Path]::GetFullPath($AppRoot),'not-written-normalization-test-data'))
$checks=[Collections.Generic.List[string]]::new()
function Check([bool]$Condition,[string]$Description){if(-not $Condition){throw $Description};$checks.Add($Description)}
function Config([string]$Text){return [EnshroudedStudio.Json]::Object([EnshroudedStudio.Json]::Serializer().DeserializeObject($Text),'test profile')}
function Enabled($Value){$ids=@();foreach($category in $store.Schema){foreach($mod in $category.Mods){if($Value[$category.Key][$mod.Key]['enabled']){$ids+=($category.Key+'.'+$mod.Key)}}};return ,$ids}
$fieldJSON='{"Minimum":1,"Maximum":1000000000,"NativeMaximum":255}'
$oldField=[EnshroudedStudio.Json]::Serializer().Deserialize($fieldJSON,[LegacyStudioFieldMaximum])
$newField=[EnshroudedStudio.Json]::Serializer().Deserialize($fieldJSON,[EnshroudedStudio.FieldDef])
Check ($oldField.Maximum -eq 1000000000 -and $newField.Maximum -eq 255 -and $newField.LegacyMaximum -eq 1000000000) 'The old-style field reader ignores the new native extension while the current editor applies its tighter limit'
$chestDef=($store.Schema|Where-Object{$_.Key -ceq 'gameplay'}).Mods|Where-Object{$_.Key -ceq 'adjustChestRandomSlots'}
foreach($bound in @('min','max')){
 $definition=$chestDef.Fields|Where-Object{$_.Key -ceq $bound}
 Check ($definition.NativeMaximum -eq 255 -and $definition.Maximum -eq 255 -and $definition.LegacyMaximum -eq 1000000000) ('Chest '+$bound+' preserves the legacy updater maximum while exposing its native uint8 limit')
}
$inactiveChest=$store.Baseline();$inactiveChest['gameplay']['adjustChestRandomSlots']['min']=1000;$inactiveChest['gameplay']['adjustChestRandomSlots']['max']=1000
Check ($store.Validate($inactiveChest).Count -eq 0 -and $store.Normalize($inactiveChest)['gameplay']['adjustChestRandomSlots']['max'] -eq 1000) 'Inactive legacy chest bounds of 1000 remain preserved and do not block unrelated options'
$inactiveChest['gameplay']['adjustChestRandomSlots']['enabled']=$true
Check ($store.Validate($inactiveChest).Count -gt 0 -and $store.NormalizeForEditing($inactiveChest)['gameplay']['adjustChestRandomSlots']['max'] -eq 1000) 'Active legacy chest bounds of 1000 remain editable but fail strict native validation'
$empty=$store.Normalize((Config '{}'))
Check ((Enabled $empty).Count -eq 0) 'An empty imported configuration enables no mods'
$partial=$store.Normalize((Config '{"player":{"adjustSkillPointsPerLevel":{"enabled":true,"value":4}}}'))
Check ((Enabled $partial).Count -eq 1 -and (Enabled $partial)[0] -ceq 'player.adjustSkillPointsPerLevel') 'A points-only partial import does not enable unrelated default mods'
Check ($partial['player']['adjustSkillPointsPerLevel']['value'] -eq 4) 'The explicit four-point setting remains four'
Check (-not $partial['player']['adjustPlayerMaxLevel']['enabled'] -and $partial['player']['adjustPlayerMaxLevel']['value'] -eq 100) 'The separate default level cap of 100 does not become a points value or activate itself'
$missingFlag=$store.Normalize((Config '{"inventory":{"adjustStackSize":{"value":123}}}'))
Check (-not $missingFlag['inventory']['adjustStackSize']['enabled'] -and $missingFlag['inventory']['adjustStackSize']['value'] -eq 123) 'A supplied numeric setting without an enabled flag remains disabled'
$old=$store.Normalize((Config '{"player":{"adjustFoodBuffReapply":{"enabled":true}},"world":{"unblockBuildLimit":{"enabled":false}}}'))
Check ((Enabled $old).Count -eq 1 -and $old['player']['adjustFoodBuffReapply']['enabled']) 'An older profile retains its one explicit enabled mod'
Check (-not $old['world']['unblockBuildLimit']['enabled']) 'An explicit disabled old option stays disabled'
$preserved=$store.Normalize((Config '{"gameDirectory":"H:/chosen-game","outputDirectory":"H:/chosen-output","settings":{"keepTempFiles":true,"keepModdedFiles":true,"futureSetting":"retained"},"player":{"adjustSkillPointsPerLevel":{"enabled":true,"value":4,"futureField":{"flag":true,"amount":77}},"futureMod":{"enabled":true,"value":99}},"futureCategory":{"futureMod":{"enabled":true,"text":"retained"}}}'))
Check ($preserved['gameDirectory'] -ceq 'H:/chosen-game' -and $preserved['outputDirectory'] -ceq 'H:/chosen-output') 'Configured game and output paths are preserved in memory'
Check ($preserved['settings']['keepTempFiles'] -and $preserved['settings']['keepModdedFiles'] -and $preserved['settings']['futureSetting'] -ceq 'retained') 'Explicit settings and unknown future settings survive normalization'
Check ($preserved['player']['adjustSkillPointsPerLevel']['futureField']['amount'] -eq 77 -and $preserved['player']['adjustSkillPointsPerLevel']['futureField']['flag']) 'Future fields inside a known mod survive normalization'
Check ($preserved['player']['futureMod']['enabled'] -and $preserved['player']['futureMod']['value'] -eq 99 -and $preserved['futureCategory']['futureMod']['text'] -ceq 'retained') 'Unknown future mods and categories survive normalization'
$encoded=[EnshroudedStudio.Json]::Encode($preserved)
$roundTrip=$store.Normalize((Config $encoded))
Check ($roundTrip['player']['adjustSkillPointsPerLevel']['value'] -eq 4 -and (Enabled $roundTrip).Count -eq 1) 'Import and export round-trip retains four points and exactly one known enabled mod'
Check ($roundTrip['futureCategory']['futureMod']['text'] -ceq 'retained' -and $roundTrip['settings']['futureSetting'] -ceq 'retained') 'Import and export round-trip retains unknown future data'
$modCount=0;$fieldCount=0;$bindings=@()
foreach($category in $store.Schema){foreach($mod in $category.Mods){
 $modCount++
 $explicit=$store.Baseline();$explicit[$category.Key][$mod.Key]['enabled']=$true
 $explicit=$store.Normalize($explicit)
 Check ($explicit[$category.Key][$mod.Key]['enabled'] -and (Enabled $explicit).Count -eq 1) ('Explicit activation survives without unrelated activation: '+$category.Key+'.'+$mod.Key)
 foreach($field in $mod.Fields){
  $fieldCount++;$key=$category.Key+'.'+$mod.Key+'.'+$field.Key
  Check ($partial[$category.Key][$mod.Key][$field.Key] -ceq $store.Normalize((Config ([EnshroudedStudio.Json]::Encode($partial))))[$category.Key][$mod.Key][$field.Key]) ('Serialized field retains its keyed value: '+$key)
  $bindings+=[ordered]@{key=$key;boolean=$field.Boolean;integer=$field.Integer;minimum=$field.Minimum;maximum=$field.Maximum;default=$store.Defaults[$category.Key][$mod.Key][$field.Key];roundTripPreserved=$true}
 }
}}
foreach($bad in @('{"player":{"adjustSkillPointsPerLevel":{"enabled":"true","value":4}}}','{"player":{"adjustSkillPointsPerLevel":{"enabled":true,"value":"4"}}}')){
 $rejected=$false;try{$null=$store.Normalize((Config $bad))}catch{$rejected=$true}
 Check $rejected 'Invalid explicitly supplied types are rejected rather than silently replaced'
}
Check ([EnshroudedStudio.SkillPointUi]::Explanation.Contains('(Level - 1)') -and [EnshroudedStudio.SkillPointUi]::Explanation.Contains('bereits erreichte Level')) 'The points card explains the global level contribution including previously reached levels'
Check ([EnshroudedStudio.SkillPointUi]::Explanation.Contains('ersten Neuberechnung') -and [EnshroudedStudio.SkillPointUi]::Notes.Contains('keine Diagnose') -and [EnshroudedStudio.SkillPointUi]::Notes.Contains('100 freie Punkte') -and [EnshroudedStudio.SkillPointUi]::Notes.Contains('104 freie Punkte') -and [EnshroudedStudio.SkillPointUi]::Notes.Contains('also nur 4 neue')) 'The conditional first recalculation example distinguishes a possible actual hundred-point jump from later four-point level gains'
Check ([EnshroudedStudio.SkillPointUi]::Synchronization.Contains('jeder Mitspieler') -and [EnshroudedStudio.SkillPointUi]::Synchronization.IndexOf('Synchronisieren') -lt [EnshroudedStudio.SkillPointUi]::Synchronization.IndexOf('Spiel starten')) 'The current manager/client workflow synchronizes each player before the separate game start'
Check ([EnshroudedStudio.SkillPointUi]::TargetHint('Dedicated Server erkannt').Contains('Synchronisieren') -and [EnshroudedStudio.SkillPointUi]::Scope.Contains('Serverpatch')) 'Dedicated points instructions use package synchronization instead of claiming no transfer mechanism exists'
$compatibilityKey='gameplay.enableGatherLootMultipliers.patchGameSettings'
Check ([EnshroudedStudio.StudioWindow]::IsReadOnlyCompatibilityField($compatibilityKey)) 'The proven ineffective old game settings flag is marked read-only'
Check (-not [EnshroudedStudio.StudioWindow]::IsReadOnlyCompatibilityField('gameplay.enableAutoLoot.keepLootSparks')) 'The working loot spark option remains editable'
$readOnly=@($bindings|Where-Object{[EnshroudedStudio.StudioWindow]::IsReadOnlyCompatibilityField($_.key)})
Check ($readOnly.Count -eq 1 -and $readOnly[0].key -ceq $compatibilityKey) 'Exactly one of all known fields is retained as an inactive compatibility control'
$compatibility=$store.Baseline();$compatibility['gameplay']['enableGatherLootMultipliers']['patchGameSettings']=$true
$compatibilityRoundTrip=$store.Normalize((Config ([EnshroudedStudio.Json]::Encode($compatibility))))
Check ($compatibilityRoundTrip['gameplay']['enableGatherLootMultipliers']['patchGameSettings']) 'The read-only compatibility flag stays serialized without silently changing its saved value'
$fixtureParent=if($OutputFile){[IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($OutputFile))}else{[IO.Path]::GetTempPath()}
if(-not [IO.Directory]::Exists($fixtureParent)){[IO.Directory]::CreateDirectory($fixtureParent)|Out-Null}
$fixtureRoot=Join-Path $fixtureParent ('skill-readback-test-'+[Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($fixtureRoot)|Out-Null
try {
 $fixtureTarget=Join-Path $fixtureRoot 'unopened-game';$fixtureFile=Join-Path $fixtureRoot 'readback.json'
 $document=[ordered]@{stage='complete';message='isolated fixture';outcome='success';progress=100;result=[ordered]@{operation='inspect-skill-points';targetDir=$fixtureTarget;targetRole='client';build='fixture';requested=4;enabled=$true;tableCount=1;matchingRequested=0;allMatch=$false;resources=@([ordered]@{guid='82706b40-61b1-4b8f-8b23-dcec6971bda1';value=2})}}
 [IO.File]::WriteAllText($fixtureFile,($document|ConvertTo-Json -Depth 7),[Text.UTF8Encoding]::new($false))
 $description=[EnshroudedStudio.SkillReview]::Describe($fixtureFile,$fixtureTarget,4,$true)
 Check ($description.Contains('Installierter Wert: 2') -and $description.Contains('Profilwert: 4') -and $description.Contains('weicht vom Profil ab')) 'Readback keeps actual installed value distinct from the requested profile value'
 Check ($description.Contains('(Level - 1)') -and $description.Contains('ersten Neuberechnung') -and $description.Contains('Wurzelbelohnungen') -and $description.Contains('Differenz bei einem neuen Levelaufstieg')) 'Readback explains first recalculation of prior level and root rewards and requests a separate in-game difference check'
 $legacyData=Join-Path $fixtureRoot 'legacy-profile-data';$legacyProfiles=Join-Path $legacyData 'profiles'
 [IO.Directory]::CreateDirectory($legacyProfiles)|Out-Null
 $legacyStore=New-Object EnshroudedStudio.StudioStore -ArgumentList ([IO.Path]::GetFullPath($AppRoot)),$legacyData
 # Model an installed old value and a newly tightened schema without editing
 # source assets or requiring a second real installation.
 $water=($legacyStore.Schema|Where-Object{$_.Key -ceq 'gameplay'}).Mods|Where-Object{$_.Key -ceq 'adjustWaterSourcePerFlameLevel'}
 $waterField=$water.Fields|Where-Object{$_.Key -ceq 'cap'};$waterField.Maximum=1000000000;$waterField.NativeMaximum=255
 $inactive=$legacyStore.Baseline();$inactive['gameplay']['adjustWaterSourcePerFlameLevel']['cap']=1000
 Check ($legacyStore.Validate($inactive).Count -eq 0 -and $legacyStore.Normalize($inactive)['gameplay']['adjustWaterSourcePerFlameLevel']['cap'] -eq 1000) 'An inactive old water cap of 1000 remains valid and unchanged without blocking unrelated patches'
 $legacy=$legacyStore.Baseline();$legacy['gameplay']['adjustWaterSourcePerFlameLevel']['enabled']=$true;$legacy['gameplay']['adjustWaterSourcePerFlameLevel']['cap']=1000
 $legacy['futureCategory']=(Config '{"kept":true}')
 $legacyID=[Guid]::NewGuid().ToString('N');$legacyFile=Join-Path $legacyProfiles ($legacyID+'.json')
 [IO.File]::WriteAllText($legacyFile,([ordered]@{formatVersion=1;name='Legacy numeric setting';config=$legacy}|ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
 [IO.File]::WriteAllText((Join-Path $legacyData 'ui.json'),('{"lastProfile":"'+$legacyID+'"}'),[Text.UTF8Encoding]::new($false))
 $originalProfile=[Convert]::ToBase64String([IO.File]::ReadAllBytes($legacyFile))
 $legacyStore.Load()
 Check ($legacyStore.LoadErrors.Count -eq 0 -and $legacyStore.Profiles.Count -eq 1 -and $legacyStore.Profiles[0].Id -ceq $legacyID -and $legacyStore.LastId -ceq $legacyID) 'An older out-of-range numeric profile loads as the same selected editable profile instead of being dropped or replaced'
 Check ($legacyStore.Profiles[0].Config['gameplay']['adjustWaterSourcePerFlameLevel']['cap'] -eq 1000 -and $legacyStore.Profiles[0].Config['futureCategory']['kept']) 'A tightened active limit never silently clamps the old value or removes unknown future data'
 Check ($legacyStore.LoadWarnings.Count -eq 1 -and $legacyStore.Validate($legacyStore.Profiles[0].Config).Count -gt 0) 'The retained legacy profile exposes actionable validation warnings'
 $saveBlocked=$false;try{$legacyStore.Save($legacyStore.Profiles[0])}catch{$saveBlocked=$true}
 $patchBlocked=$false;try{$null=$legacyStore.ExportEngine($legacyStore.Profiles[0].Config)}catch{$patchBlocked=$true}
 Check ($saveBlocked -and $patchBlocked) 'Out-of-range legacy values remain blocked before profile saving or engine export'
 Check ([Convert]::ToBase64String([IO.File]::ReadAllBytes($legacyFile)) -ceq $originalProfile) 'Loading and rejecting invalid values leaves the original profile file byte-identical'
 $legacyStore.Profiles[0].Config['gameplay']['adjustWaterSourcePerFlameLevel']['cap']=255
 Check ($legacyStore.Validate($legacyStore.Profiles[0].Config).Count -eq 0) 'The retained profile becomes valid when its value is explicitly corrected to 255'
 $legacyEvidence=$null
 if($LegacyStudioAssembly){
  # LoadFile keeps the old identity separate from the current same-name EXE.
  # All calls below use its exact reflection types, not PowerShell type lookup.
  $oldAssembly=[Reflection.Assembly]::LoadFile($LegacyStudioAssembly)
  if($oldAssembly.GetName().Version.ToString() -cne '0.4.27.0'){throw 'Wrong explicit legacy updater version.'}
  $oldStoreType=$oldAssembly.GetType('EnshroudedStudio.StudioStore',$true)
  if($oldAssembly.GetType('EnshroudedStudio.FieldDef',$true).GetProperty('NativeMaximum')){throw 'The old updater already knows the native extension.'}
  $oldData=Join-Path $fixtureRoot 'actual-old27-data';$oldProfiles=Join-Path $oldData 'profiles'
  [IO.Directory]::CreateDirectory($oldProfiles)|Out-Null
  $constructor=$oldStoreType.GetConstructor([type[]]@([string],[string]))
  $oldStore=$constructor.Invoke([object[]]@([string][IO.Path]::GetFullPath($AppRoot),[string]$oldData))
  $oldBounds=0;foreach($category in $oldStore.Schema){foreach($mod in $category.Mods){foreach($field in $mod.Fields){if(($mod.Key -ceq 'adjustWaterSourcePerFlameLevel' -and $field.Key -ceq 'cap') -or ($mod.Key -ceq 'adjustChestRandomSlots' -and $field.Key -in @('min','max'))){if($field.Maximum -ne 1000000000){throw 'The actual old reader did not retain its legacy maximum.'};$oldBounds++}}}}
  if($oldBounds -ne 3){throw 'The actual old reader did not expose all three legacy bounds.'}
  $originalBytes=@{};$oldIDs=@()
  foreach($mode in @('water-active','water-inactive','chest-active','chest-inactive')){
   $oldConfig=$oldStore.Baseline();$oldConfig['player']['adjustSkillPointsPerLevel']['enabled']=$true;$oldConfig['player']['adjustSkillPointsPerLevel']['value']=4
   if($mode.StartsWith('water')){$oldOption=$oldConfig['gameplay']['adjustWaterSourcePerFlameLevel'];$oldOption['cap']=1000}else{$oldOption=$oldConfig['gameplay']['adjustChestRandomSlots'];$oldOption['min']=1000;$oldOption['max']=1000}
   $oldOption['enabled']=$mode.EndsWith('-active');$oldID=[Guid]::NewGuid().ToString('N');$oldIDs+=$oldID;$oldFile=Join-Path $oldProfiles ($oldID+'.json')
   [IO.File]::WriteAllText($oldFile,([ordered]@{formatVersion=1;name=$mode;config=$oldConfig}|ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
   $originalBytes[$oldFile]=(Get-FileHash -LiteralPath $oldFile -Algorithm SHA256).Hash
  }
  [IO.File]::WriteAllText((Join-Path $oldData 'ui.json'),('{"lastProfile":"'+$oldIDs[0]+'"}'),[Text.UTF8Encoding]::new($false))
  $method=$oldAssembly.GetType('EnshroudedStudio.UpdateInstaller',$true).GetMethod('ValidateProfiles',[Reflection.BindingFlags]'Static,NonPublic')
  $oldCount=$method.Invoke($null,[object[]]@([string][IO.Path]::GetFullPath($AppRoot),[string]$oldData))
  foreach($oldFile in $originalBytes.Keys){if((Get-FileHash -LiteralPath $oldFile -Algorithm SHA256).Hash -cne $originalBytes[$oldFile]){throw 'The actual old updater rewrote a profile.'}}
  Check ($oldCount -eq 4) 'The actual 0.4.27 updater accepts enabled and disabled old water/chest values without rewriting their profiles'
  $legacyEvidence=[ordered]@{passed=$true;version='0.4.27';assemblySHA256=(Get-FileHash -LiteralPath $LegacyStudioAssembly -Algorithm SHA256).Hash.ToLowerInvariant();acceptedProfiles=$oldCount;legacyBounds=$oldBounds;originalBytesUnchanged=$true}
 }
} finally {
 $resolved=[IO.Path]::GetFullPath($fixtureRoot)
 if([IO.Path]::GetDirectoryName($resolved) -cne [IO.Path]::GetFullPath($fixtureParent).TrimEnd([IO.Path]::DirectorySeparatorChar) -or -not [IO.Path]::GetFileName($resolved).StartsWith('skill-readback-test-',[StringComparison]::Ordinal)){throw 'Unexpected readback fixture cleanup path'}
 if((Get-Item -LiteralPath $resolved).Attributes -band [IO.FileAttributes]::ReparsePoint -or (Get-ChildItem -LiteralPath $resolved -Recurse -Force -Attributes ReparsePoint)){throw 'Linked readback fixture remains untouched'}
 Remove-Item -LiteralPath $resolved -Recurse -Force
}
$report=[ordered]@{passed=$true;checks=$checks.Count;mods=$modCount;fields=$fieldCount;readOnlyCompatibilityFields=@($compatibilityKey);legacyUpdaterProof=$legacyEvidence;tests=@($checks);bindings=$bindings;guiStarted=$false;gameStarted=$false;liveProfilesModified=$false;fixtureProfilesWritten=$true}
if($OutputFile){$file=[IO.Path]::GetFullPath($OutputFile);$parent=[IO.Path]::GetDirectoryName($file);if(-not [IO.Directory]::Exists($parent)){[IO.Directory]::CreateDirectory($parent)|Out-Null};[IO.File]::WriteAllText($file,($report|ConvertTo-Json -Depth 7),[Text.UTF8Encoding]::new($false))}
[pscustomobject]@{passed=$true;checks=$checks.Count;mods=$modCount;fields=$fieldCount;guiStarted=$false;gameStarted=$false;liveProfilesModified=$false;fixtureProfilesWritten=$true}|ConvertTo-Json -Compress
