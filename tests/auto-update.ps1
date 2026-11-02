$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $project 'manifest.json') -Raw | ConvertFrom-Json).version
$fixtureArchive = Join-Path $project "dist\qibian-$version-windows-x64.zip"
$testRoot = Join-Path $project ('artifacts\auto-update-' + [guid]::NewGuid().ToString('N'))
$install = Join-Path $testRoot '安装的 栖边'
$data = Join-Path $testRoot 'user-data'
New-Item -ItemType Directory -Path $install,$data -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory($fixtureArchive,$install)
$manifestPath = Join-Path $install 'extension\manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Encoding UTF8 -Raw | ConvertFrom-Json
$manifest.version='1.6.0'
[IO.File]::WriteAllText($manifestPath,($manifest | ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
Set-Content -LiteralPath (Join-Path $install 'sync\version.json') -Value '{"version":"1.6.0"}'
Set-Content -LiteralPath (Join-Path $data 'workspace.json') -Value 'keep-user-playlists'
$env:QIBIAN_SYNC_DATA=$data; $env:QIBIAN_SYNC_PORT='0'
$global:qibianUpdateFixture=@{archive=$fixtureArchive;version=$version;downloads=0;offline=$false;badSize=$true;failInstall=$false}
function Invoke-RestMethod {
  $fixture=$global:qibianUpdateFixture; $v=$fixture.version
  if ($fixture.offline) { throw 'offline fixture' }
  return @{tag_name="v$v";draft=$false;prerelease=$false;assets=@(@{name="qibian-$v-windows-x64.zip";size=(Get-Item -LiteralPath $fixture.archive).Length + [int]$fixture.badSize;browser_download_url="https://github.com/1644ye/qibian/releases/download/v$v/qibian-$v-windows-x64.zip"})}
}
function Invoke-WebRequest { param($Uri,$OutFile,$TimeoutSec,[switch]$UseBasicParsing) $global:qibianUpdateFixture.downloads++; Copy-Item -LiteralPath $global:qibianUpdateFixture.archive -Destination $OutFile }
function Copy-Item {
  param($LiteralPath,$Destination,[switch]$Recurse,[switch]$Force)
  if ($global:qibianUpdateFixture.failInstall -and $Destination -eq $manifestPath) { $global:qibianUpdateFixture.failInstall=$false; throw 'write failure fixture' }
  Microsoft.PowerShell.Management\Copy-Item -LiteralPath $LiteralPath -Destination $Destination -Recurse:$Recurse -Force:$Force
}
$updater=Join-Path $install 'sync\update.ps1'
& $updater -Automatic
if ((Get-Content -LiteralPath $manifestPath -Encoding UTF8 -Raw | ConvertFrom-Json).version -ne '1.6.0') { throw 'Incomplete package changed the installed extension' }
$global:qibianUpdateFixture.badSize=$false
$global:qibianUpdateFixture.failInstall=$true
& $updater -Automatic
if ((Get-Content -LiteralPath $manifestPath -Encoding UTF8 -Raw | ConvertFrom-Json).version -ne '1.6.0' -or (Get-Content -LiteralPath (Join-Path $install 'sync\version.json') -Raw | ConvertFrom-Json).version -ne '1.6.0') { throw 'Failed installation was not rolled back' }
& $updater -Automatic
if ((Get-Content -LiteralPath $manifestPath -Encoding UTF8 -Raw | ConvertFrom-Json).version -ne $version) { throw 'Extension was not updated' }
if ((Get-Content -LiteralPath (Join-Path $install 'sync\version.json') -Raw | ConvertFrom-Json).version -ne $version) { throw 'Service was not updated' }
if ((Get-Content -LiteralPath (Join-Path $data 'workspace.json') -Raw).Trim() -ne 'keep-user-playlists') { throw 'User data changed' }
$backups = @(Get-ChildItem -LiteralPath (Join-Path $data 'updates') -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'backup\extension\manifest.json') })
if ($backups.Count -ne 2) { throw 'Original programs were not backed up' }
if ((Get-Content -LiteralPath (Join-Path $backups[0].FullName 'backup\extension\manifest.json') -Encoding UTF8 -Raw | ConvertFrom-Json).version -ne '1.6.0') { throw 'Backup version mismatch' }
& $updater -Automatic
if ($global:qibianUpdateFixture.downloads -ne 3) { throw 'Automatic update did not honor its daily check interval' }
$global:qibianUpdateFixture.offline=$true
& $updater
if ((Get-Content -LiteralPath $manifestPath -Encoding UTF8 -Raw | ConvertFrom-Json).version -ne $version) { throw 'Offline check damaged the installation' }
Write-Output 'PASS real ZIP updates both extension and service, preserves user data and backups, rejects partial downloads, rolls back a failed install, checks once daily and keeps the installed version offline'
