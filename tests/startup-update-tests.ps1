param([Parameter(Mandatory=$true)][string]$StudioAssembly, [string]$SandboxParent)
$ErrorActionPreference='Stop'
$appRoot=Split-Path -Parent $PSScriptRoot
if(-not $SandboxParent){$SandboxParent=$PSScriptRoot}
$SandboxParent=[IO.Path]::GetFullPath($SandboxParent)
$owned=Join-Path $SandboxParent ('su-'+[guid]::NewGuid().ToString('N').Substring(0,8))
function Assert-True([bool]$condition,[string]$message){if(-not $condition){throw $message};$script:checks++}
function Assert-Rejected([scriptblock]$action,[string]$message){$rejected=$false;try{& $action|Out-Null}catch{$rejected=$true};Assert-True $rejected $message}
$checks=0
[IO.Directory]::CreateDirectory($owned)|Out-Null
try {
 Add-Type -AssemblyName System.Web.Extensions
 Add-Type -AssemblyName PresentationFramework
 $assembly=[Reflection.Assembly]::LoadFrom([IO.Path]::GetFullPath($StudioAssembly))
 $actual=[EnshroudedStudio.UpdateCheck]::DisplayVersion($assembly.GetName().Version)
 Assert-True ([EnshroudedStudio.UpdateCheck]::InstalledVersion -eq $actual) 'Installed version must be read from the executing assembly.'
 $repo='Owner/Studio';$tag='v9.8.7';$digest='a'*64
 $zip=[EnshroudedStudio.UpdateCheck]::ExpectedAssetName($tag)
 $setup=[EnshroudedStudio.UpdateCheck]::ExpectedInstallerName($tag)
 $prefix='https://github.com/'+$repo+'/releases/download/'+$tag+'/'
 $fixture=@{tag_name=$tag;draft=$false;prerelease=$false;body=('Change A'+[char]1+[char]0x202E+"`r`nChange B");assets=@(
  @{name=$zip;browser_download_url=$prefix+$zip;size=123;digest='sha256:'+$digest},
  @{name=$setup;browser_download_url=$prefix+$setup;size=456;digest='sha256:'+$digest})}
 function Parse-Fixture($value){[EnshroudedStudio.UpdateCheck]::ParseRelease(($value|ConvertTo-Json -Depth 10),$repo,'0.0.1')}
 $release=Parse-Fixture $fixture
 Assert-True ($release.IsNewer -and $release.AutomaticInstallAvailable -and $release.InstallerAvailable) 'Both verified release assets must be selected.'
 Assert-True ($release.ReleaseNotes -eq "Change A`nChange B") 'Release notes must remove control and direction characters.'
 Assert-True ([EnshroudedStudio.UpdateCheck]::IsAllowedInstallerUrl($repo,$tag,$setup,$prefix+$setup)) 'Exact Setup URL must be accepted.'
 foreach($bad in @('https://github.com.evil.test/'+$repo+'/releases/download/'+$tag+'/'+$setup, $prefix+$setup+'?x=1', $prefix+$setup+'#x', $prefix.Replace('Owner/Studio','Other/Studio')+$setup)){
  Assert-True (-not [EnshroudedStudio.UpdateCheck]::IsAllowedInstallerUrl($repo,$tag,$setup,$bad)) 'Unexpected installer origin or URL suffix must be rejected.'
 }
 $fixture.assets[1].digest=$null;$missing=Parse-Fixture $fixture
 Assert-True (-not $missing.InstallerAvailable) 'Setup without a SHA-256 digest must never install automatically.'
 Assert-True (-not [EnshroudedStudio.StartupUpdates]::MayInstallAutomatically($missing,$false,$false,$false,$true)) 'Installed mode must not silently use the portable ZIP.'
 $fixture.assets[1].digest='sha256:'+$digest
 $fixture.assets+=@($fixture.assets[1]);Assert-Rejected {Parse-Fixture $fixture} 'Duplicate Setup assets must be rejected.'
 $fixture.assets=$fixture.assets[0..1];$fixture.body=3
 Assert-Rejected {Parse-Fixture $fixture} 'Non-text release notes must be rejected.'
 $fixture.body=$null;Assert-True ((Parse-Fixture $fixture).ReleaseNotes.Length -gt 0) 'Missing notes require a visible fallback.'
 $fixture.body='x'*50000;Assert-True ((Parse-Fixture $fixture).ReleaseNotes.Length -lt 40100) 'Oversized notes must be bounded.'
 $data=Join-Path $owned 'Data';$warning=$null
 Assert-True ([EnshroudedStudio.StartupUpdates]::AutomaticEnabled($data,[ref]$warning)) 'Startup updates must default to enabled.'
 [EnshroudedStudio.StartupUpdates]::SetAutomatic($data,$false)
 Assert-True (-not [EnshroudedStudio.StartupUpdates]::AutomaticEnabled($data,[ref]$warning)) 'Opt-out must persist.'
 $stateFile=Join-Path $data 'updates/startup.json'
 $state=[EnshroudedStudio.Json]::Read($stateFile);$state['futurePreference']='keep'
 [EnshroudedStudio.Json]::Write($stateFile,$state,(Join-Path $data 'backups'))
 [EnshroudedStudio.StartupUpdates]::SetAutomatic($data,$true)
 Assert-True (([EnshroudedStudio.Json]::Read($stateFile))['futurePreference'] -eq 'keep') 'Unknown application settings must survive an update.'
 Assert-True ([EnshroudedStudio.StartupUpdates]::ShouldCheck($true,$false,$false,$false,$false,$false,$false)) 'Idle normal launch must check once.'
 foreach($position in 1..6){$args=@($true,$false,$false,$false,$false,$false,$false);$args[$position]=$true
  Assert-True (-not [EnshroudedStudio.StartupUpdates]::ShouldCheck($args[0],$args[1],$args[2],$args[3],$args[4],$args[5],$args[6])) 'Handoff, test, closed, busy, dirty and duplicate launches must skip.'}
 Assert-True (-not [EnshroudedStudio.StartupUpdates]::ShouldCheck($false,$false,$false,$false,$false,$false,$false)) 'Opt-out must skip startup checks.'
 $now=[DateTime]::UtcNow
 Assert-True ([EnshroudedStudio.StartupUpdates]::CanAttemptAutomatically($data,'9.8.7',$now)) 'First attempt must be allowed.'
 [EnshroudedStudio.StartupUpdates]::RecordAttempt($data,'9.8.7',$now)
 Assert-True (-not [EnshroudedStudio.StartupUpdates]::CanAttemptAutomatically($data,'9.8.7',$now.AddMinutes(29))) 'Failed/restarted attempt must not loop.'
 Assert-True ([EnshroudedStudio.StartupUpdates]::CanAttemptAutomatically($data,'9.8.7',$now.AddMinutes(31))) 'A later launch must retry after backoff.'
 Assert-True ([EnshroudedStudio.StartupUpdates]::CanAttemptAutomatically($data,'9.8.8',$now)) 'A different release must not be blocked.'
 [EnshroudedStudio.StartupUpdates]::RecordInstalled($data,$release)
 Assert-True (-not [EnshroudedStudio.StartupUpdates]::HasUnseenNotes($data,'0.0.1')) 'Prepared future release must not be shown as installed.'
 Assert-True ([EnshroudedStudio.StartupUpdates]::HasUnseenNotes($data,'9.8.7')) 'Completed release must show notes once.'
 [EnshroudedStudio.StartupUpdates]::MarkNotesSeen($data,'9.8.7')
 Assert-True (-not [EnshroudedStudio.StartupUpdates]::HasUnseenNotes($data,'9.8.7')) 'Already read notes must not repeat.'
 Assert-True ([EnshroudedStudio.StartupUpdates]::CanAttemptAutomatically($data,'9.8.7',$now)) 'Successful actual version clears retry state.'
 $setupPath=Join-Path $owned 'Studio Setup.exe'
 $start=[EnshroudedStudio.StartupUpdates]::InstallerStartInfo($setupPath,123,456)
 Assert-True ($start.FileName -eq $setupPath -and -not $start.UseShellExecute -and $start.Arguments -ceq '--update-existing --wait-pid 123 --wait-start 456 --restart') 'Installer handoff must use fixed flags and no external target.'
 Assert-Rejected {[EnshroudedStudio.StartupUpdates]::InstallerStartInfo('relative.exe',123,456)} 'Relative Setup paths must be rejected.'
 Assert-Rejected {[EnshroudedStudio.StartupUpdates]::InstallerStartInfo($setupPath,0,456)} 'Invalid parent identity must be rejected.'
 [IO.File]::WriteAllText($stateFile,'{bad')
 Assert-True (-not [EnshroudedStudio.StartupUpdates]::AutomaticEnabled($data,[ref]$warning)) 'Corrupt preferences must defer automatic updates without blocking the application.'
 Assert-True (([IO.File]::ReadAllText($stateFile)) -ceq '{bad') 'Reading corrupt preferences must not overwrite them.'
 [EnshroudedStudio.StartupUpdates]::SetAutomatic($data,$true)
 Assert-True ([EnshroudedStudio.StartupUpdates]::AutomaticEnabled($data,[ref]$warning)) 'An explicit preference must repair a malformed file.'
 Assert-True ((Get-ChildItem -LiteralPath (Join-Path $data 'backups') -File).Count -gt 0) 'Preference repair must retain the old file in backup.'
 $notesRoot=Join-Path $owned 'App';[IO.Directory]::CreateDirectory($notesRoot)|Out-Null
 [IO.File]::WriteAllText((Join-Path $notesRoot ('RELEASE-NOTES-'+$actual+'.txt')),'Bundled changes')
 [EnshroudedStudio.StartupUpdates]::EnsureBundledNotes($notesRoot,$data,$actual)
 Assert-True (([EnshroudedStudio.Json]::Read($stateFile))['installedUpdateNotes'] -ceq 'Bundled changes') 'Installer launches must load bundled release notes.'
 $callback=[Action[bool,string]]{param($ok,$message);Assert-True $ok $message}
 [EnshroudedStudio.UpdateCheck]::SelfTest($callback)
 Write-Output ('PASS: '+$checks+' startup/release checks; no network, windows, installer or game launched.')
} finally {
 $resolved=[IO.Path]::GetFullPath($owned).TrimEnd('\')
 if([IO.Path]::GetDirectoryName($resolved) -cne $SandboxParent.TrimEnd('\') -or [IO.Path]::GetFileName($resolved) -cnotmatch '^su-[a-f0-9]{8}$'){throw 'Refusing cleanup outside the owned sandbox.'}
 if(Test-Path -LiteralPath $resolved){Remove-Item -LiteralPath $resolved -Recurse -Force}
}
