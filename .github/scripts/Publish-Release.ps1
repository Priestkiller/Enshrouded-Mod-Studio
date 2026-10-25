$ErrorActionPreference = 'Stop'
$releaseRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$releaseSpec = Get-Content -LiteralPath (Join-Path $releaseRoot '.github\release.json') -Raw | ConvertFrom-Json
$releaseProof = Get-Content -LiteralPath (Join-Path $releaseRoot 'artifacts\package.json') -Raw | ConvertFrom-Json
if ($env:GITHUB_REPOSITORY -ne 'Priestkiller/Enshrouded-Mod-Studio' -or $releaseSpec.version -ne $releaseProof.version) { throw 'Unexpected repository or version.' }
$releaseRepo = $env:GITHUB_REPOSITORY
$releaseTag = 'v' + $releaseSpec.version
$releaseZip = Join-Path (Join-Path $releaseRoot 'artifacts') $releaseProof.archive
if ((Get-FileHash -LiteralPath $releaseZip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $releaseProof.sha256) { throw 'Archive changed after validation.' }
function GetRelease {
    $raw = & gh api ('repos/' + $releaseRepo + '/releases?per_page=100')
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect existing releases.' }
    $all = $raw | ConvertFrom-Json
    $found = @($all | Where-Object { $_.tag_name -eq $releaseTag })
    if ($found.Count -gt 1) { throw 'Duplicate release tags.' }
    if ($found.Count -eq 1) { return $found[0] }
    return $null
}
$current = GetRelease
if ($null -ne $current -and -not $current.draft) { Write-Output ('Release already published: ' + $current.html_url); exit 0 }
if ($null -ne $current -and $current.target_commitish -ne $env:GITHUB_SHA) { throw 'Existing draft points to another commit.' }
if ($null -eq $current) {
    & gh release create $releaseTag --repo $releaseRepo --target $env:GITHUB_SHA --draft --title $releaseSpec.name --notes-file (Join-Path $releaseRoot '.github\release-notes.md')
    if ($LASTEXITCODE -ne 0) { throw 'Cannot create release draft.' }
}
& gh release upload $releaseTag $releaseZip ($releaseZip + '.sha256') --repo $releaseRepo --clobber
if ($LASTEXITCODE -ne 0) { throw 'Cannot upload release assets.' }
$verified = $false
for ($attempt=0;$attempt -lt 6;$attempt++) {
    $current = GetRelease
    $asset = @($current.assets | Where-Object { $_.name -eq $releaseProof.archive })
    if ($asset.Count -eq 1 -and $asset[0].state -eq 'uploaded' -and $asset[0].size -eq $releaseProof.bytes -and $asset[0].digest -eq ('sha256:' + $releaseProof.sha256)) { $verified=$true; break }
    Start-Sleep -Seconds 5
}
if (-not $verified) { throw 'GitHub asset size/digest verification failed; draft remains unpublished.' }
$publishFile = Join-Path $releaseRoot 'artifacts\publish.json'
[IO.File]::WriteAllText($publishFile,(@{draft=$false;prerelease=[bool]$releaseSpec.prerelease;make_latest='true'} | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
$raw = & gh api --method PATCH ('repos/' + $releaseRepo + '/releases/' + $current.id) --input $publishFile
if ($LASTEXITCODE -ne 0) { throw 'Cannot publish verified draft.' }
$published = $raw | ConvertFrom-Json
if ($published.draft) { throw 'Release remained a draft.' }
Write-Output ('Published ' + $published.html_url)
if ($env:GITHUB_STEP_SUMMARY) { [IO.File]::AppendAllText($env:GITHUB_STEP_SUMMARY,('Published [' + $releaseTag + '](' + $published.html_url + ') with verified ZIP SHA-256 `' + $releaseProof.sha256 + '`.' + [Environment]::NewLine),[Text.UTF8Encoding]::new($false)) }
