param(
 [Parameter(Mandatory=$true)][string]$StudioAssembly,
 [string]$AppRoot,
 [string]$OutputFile,
 [string]$SandboxParent
)
$ErrorActionPreference='Stop'
if(-not $AppRoot){$AppRoot=Split-Path -Parent $PSScriptRoot}
$AppRoot=[IO.Path]::GetFullPath($AppRoot)
$StudioAssembly=[IO.Path]::GetFullPath($StudioAssembly)
if(-not [IO.File]::Exists($StudioAssembly)){throw 'The freshly compiled Studio assembly is missing.'}
if(-not $SandboxParent){
 if($env:RUNNER_TEMP){$SandboxParent=$env:RUNNER_TEMP}
 else{$SandboxParent=Join-Path $AppRoot 'tests'}
}
$SandboxParent=[IO.Path]::GetFullPath($SandboxParent)
if($SandboxParent.Length -gt [IO.Path]::GetPathRoot($SandboxParent).Length){$SandboxParent=$SandboxParent.TrimEnd([IO.Path]::DirectorySeparatorChar)}
function Assert-PlainPath([string]$Path){
 $current=[IO.Path]::GetFullPath($Path)
 while($current){
  if(Test-Path -LiteralPath $current){
   $entry=Get-Item -LiteralPath $current -Force
   if($entry.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked migration-test paths are not allowed.'}
  }
  $parent=[IO.Path]::GetDirectoryName($current)
  if($parent -eq $current){break};$current=$parent
 }
}
function Remove-OwnedSandbox([string]$Directory,[string]$Parent){
 $full=[IO.Path]::GetFullPath($Directory).TrimEnd([IO.Path]::DirectorySeparatorChar)
 $expected=[IO.Path]::GetFullPath($Parent)
 if($expected.Length -gt [IO.Path]::GetPathRoot($expected).Length){$expected=$expected.TrimEnd([IO.Path]::DirectorySeparatorChar)}
 if(-not [string]::Equals([IO.Path]::GetDirectoryName($full),$expected,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($full) -cnotmatch '^um-[a-f0-9]{8}$'){throw 'Refusing to remove an unowned migration-test directory.'}
 if(-not(Test-Path -LiteralPath $full)){return}
 Assert-PlainPath $full
 $pending=New-Object 'Collections.Generic.Stack[string]';$pending.Push($full)
 while($pending.Count -gt 0){
  foreach($entry in Get-ChildItem -LiteralPath $pending.Pop() -Force){
   if($entry.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'A linked test descendant prevents automatic cleanup.'}
   if($entry.PSIsContainer){$pending.Push($entry.FullName)}
  }
 }
 Remove-Item -LiteralPath $full -Recurse -Force
}
Assert-PlainPath $SandboxParent
Assert-PlainPath $StudioAssembly
[IO.Directory]::CreateDirectory($SandboxParent)|Out-Null
$owned=Join-Path $SandboxParent ('um-'+[guid]::NewGuid().ToString('N').Substring(0,8))
if(Test-Path -LiteralPath $owned){throw 'The owned migration-test directory already exists.'}
[IO.Directory]::CreateDirectory($owned)|Out-Null
$sandbox=Join-Path $owned 's'
[IO.Directory]::CreateDirectory($sandbox)|Out-Null
$checks=New-Object 'Collections.Generic.List[string]'
try{
 # Load metadata and call the offline fixture API; never launch the EXE.
 Add-Type -AssemblyName System.Web.Extensions
 Add-Type -AssemblyName System.IO.Compression
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 $expectedAssemblyName=[Reflection.AssemblyName]::GetAssemblyName($StudioAssembly)
 $assembly=[Reflection.Assembly]::LoadFrom($StudioAssembly)
 if($assembly.FullName -cne $expectedAssemblyName.FullName){throw 'Run this harness in a fresh PowerShell process; a different Studio assembly was already loaded.'}
 $installer=$assembly.GetType('EnshroudedStudio.UpdateInstaller',$true)
 $method=$installer.GetMethod('SelfTest',[Reflection.BindingFlags]'Public,Static')
 if($null -eq $method){throw 'The public offline update migration self-test API is missing.'}
 $callback=[Action[bool,string]]{
  param([bool]$Condition,[string]$Description)
  if(-not $Condition){throw ('Migration regression failed: '+$Description)}
  $checks.Add($Description)
 }
 # Reflection must receive CLR values rather than PowerShell argument wrappers.
 $arguments=[Array]::CreateInstance([object],3)
 $arguments[0]=$callback.PSObject.BaseObject
 $arguments[1]=$AppRoot.PSObject.BaseObject
 $arguments[2]=$sandbox.PSObject.BaseObject
 $null=$method.Invoke($null,$arguments)
 if($checks.Count -lt 1){throw 'The migration regression suite produced no assertions.'}
 $result=[ordered]@{passed=$true;version=$assembly.GetName().Version.ToString();checks=$checks.Count;names=$checks.ToArray();fixtureOnly=$true;gameStarted=$false;serverStarted=$false;uiOpened=$false;installerStarted=$false;realProfilesRead=$false;realProfilesModified=$false}
 if($OutputFile){
  $destination=[IO.Path]::GetFullPath($OutputFile)
  Assert-PlainPath $destination
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination))|Out-Null
  [IO.File]::WriteAllText($destination,($result|ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
 }
 $result|ConvertTo-Json -Depth 4
}
finally{Remove-OwnedSandbox $owned $SandboxParent}
