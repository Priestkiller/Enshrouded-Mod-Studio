$ErrorActionPreference = 'Stop'
$studioRoot = Split-Path -Parent $PSScriptRoot
$studioFramework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$studioCompiler = Join-Path $studioFramework 'csc.exe'
if (-not (Test-Path -LiteralPath $studioCompiler)) { throw '.NET Framework 4.x mit 64-Bit-Compiler wird benötigt.' }
$studioReferences = @(
    (Join-Path $studioFramework 'WPF\PresentationFramework.dll'),
    (Join-Path $studioFramework 'WPF\PresentationCore.dll'),
    (Join-Path $studioFramework 'WPF\WindowsBase.dll'),
    (Join-Path $studioFramework 'System.Xaml.dll'),
    (Join-Path $studioFramework 'System.Web.Extensions.dll'),
    (Join-Path $studioFramework 'System.IO.Compression.dll'),
    (Join-Path $studioFramework 'System.IO.Compression.FileSystem.dll'),
    (Join-Path $studioFramework 'System.Windows.Forms.dll'),
    (Join-Path $studioFramework 'System.Drawing.dll'),
    (Join-Path $studioFramework 'Microsoft.CSharp.dll')
)
$studioCompileArgs = @('/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/utf8output', ('/win32manifest:' + (Join-Path $PSScriptRoot 'app.manifest')), ('/out:' + (Join-Path $studioRoot 'Enshrouded Mod Studio.exe')))
$studioIcon = Join-Path $studioRoot 'assets\studio.ico'
if (Test-Path -LiteralPath $studioIcon) { $studioCompileArgs += '/win32icon:' + $studioIcon }
foreach ($studioReference in $studioReferences) { $studioCompileArgs += '/reference:' + $studioReference }
$studioCompileArgs += @((Join-Path $PSScriptRoot 'Core.cs'), (Join-Path $PSScriptRoot 'App.cs'), (Join-Path $PSScriptRoot 'SelfTests.cs'), (Join-Path $PSScriptRoot 'AssemblyInfo.cs'), (Join-Path $PSScriptRoot 'ServerReview.cs'), (Join-Path $PSScriptRoot 'SetupTransfer.cs'), (Join-Path $PSScriptRoot 'PatchRun.cs'), (Join-Path $PSScriptRoot 'ClientProfiles.cs'))
$studioCompileArgs += @((Join-Path $PSScriptRoot 'BasisStatus.cs'), (Join-Path $PSScriptRoot 'BasisReview.cs'))
$studioCompileArgs += @((Join-Path $PSScriptRoot 'StackStatus.cs'), (Join-Path $PSScriptRoot 'StackReview.cs'))
$studioCompileArgs += (Join-Path $PSScriptRoot 'UpdateCheck.cs')
$studioCompileArgs += (Join-Path $PSScriptRoot 'UpdateInstaller.cs')
$studioCompileArgs += (Join-Path $PSScriptRoot 'RuntimeImport.cs')
$studioCompileArgs += @((Join-Path $PSScriptRoot 'ToolHandoff.cs'), (Join-Path $PSScriptRoot 'SkillReview.cs'))
& $studioCompiler @studioCompileArgs
if ($LASTEXITCODE -ne 0) { throw 'Kompilieren fehlgeschlagen.' }
Write-Output 'Enshrouded Mod Studio.exe erstellt.'
