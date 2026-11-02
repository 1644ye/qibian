param([switch]$Automatic)
$ErrorActionPreference = 'Stop'
$syncRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$extensionRoot = Join-Path (Split-Path -Parent $syncRoot) 'extension'
$dataRoot = if ($env:QIBIAN_SYNC_DATA) { $env:QIBIAN_SYNC_DATA } else { Join-Path $env:LOCALAPPDATA 'QibianSync' }
$updateRoot = Join-Path $dataRoot 'updates'
$stage = $null
try {
  if (!(Test-Path -LiteralPath (Join-Path $extensionRoot 'manifest.json'))) {
    if (!$Automatic) { Write-Output '自动安装需要完整包的 extension 和 sync 两个相邻文件夹。仅同步包请下载完整包，保持扩展原加载路径。' }
    return
  }
  $installed = Get-Content -LiteralPath (Join-Path $syncRoot 'version.json') -Raw | ConvertFrom-Json
  $oldManifest = Get-Content -LiteralPath (Join-Path $extensionRoot 'manifest.json') -Encoding UTF8 -Raw | ConvertFrom-Json
  if ($oldManifest.name -ne '栖边 · 自定义侧边栏' -or $installed.version -notmatch '^\d+\.\d+\.\d+$') { throw '无法识别栖边安装目录，未修改文件。' }
  # A second launcher must not replace programs used by an already running service.
  $servicePort = if ($env:QIBIAN_SYNC_PORT) { [int]$env:QIBIAN_SYNC_PORT } else { 17381 }
  if ($servicePort -gt 0) {
    $client = New-Object Net.Sockets.TcpClient
    try { $pending = $client.ConnectAsync('127.0.0.1', $servicePort); if ($pending.Wait(200) -and $client.Connected) { return } } catch {} finally { $client.Dispose() }
  }
  New-Item -ItemType Directory -Path $updateRoot -Force | Out-Null
  $lastCheck = Join-Path $updateRoot 'last-check.txt'
  if ($Automatic -and (Test-Path -LiteralPath $lastCheck) -and ((Get-Date) - (Get-Item -LiteralPath $lastCheck).LastWriteTime).TotalHours -lt 24) { return }
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/1644ye/qibian/releases/latest' -Headers @{ 'User-Agent'='Qibian-Updater'; 'Accept'='application/vnd.github+json' } -TimeoutSec 12
  $version = [string]$release.tag_name -replace '^v',''
  if ($release.draft -or $release.prerelease -or $version -notmatch '^\d+\.\d+\.\d+$') { throw '没有可用的正式版本。' }
  if ([version]$version -le [version]$installed.version -and [version]$version -le [version]$oldManifest.version) { Set-Content -LiteralPath $lastCheck -Value $version; return }
  if ([version]$version -lt [version]$installed.version -or [version]$version -lt [version]$oldManifest.version) { throw '更新版本低于已安装版本，未修改文件。' }
  $name = "qibian-$version-windows-x64.zip"
  $assets = @($release.assets | Where-Object { $_.name -eq $name })
  $expectedURL = "https://github.com/1644ye/qibian/releases/download/v$version/$name"
  if ($assets.Count -ne 1 -or $assets[0].browser_download_url -ne $expectedURL -or $assets[0].size -le 0) { throw '正式版完整包尚不可用。' }
  $stage = Join-Path $updateRoot ($version + '-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $stage | Out-Null
  $archive = Join-Path $stage 'package.zip'
  Write-Output "栖边正在下载 $version，完成后自动更新扩展和本机服务…"
  Invoke-WebRequest -UseBasicParsing -Uri $expectedURL -OutFile $archive -TimeoutSec 120
  if ((Get-Item -LiteralPath $archive).Length -ne $assets[0].size) { throw '更新包下载不完整。' }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $extracted = Join-Path $stage 'package'
  New-Item -ItemType Directory -Path $extracted | Out-Null
  $zip = [IO.Compression.ZipFile]::OpenRead($archive)
  try {
    foreach ($entry in $zip.Entries) {
      $entryName = $entry.FullName.Replace('\','/')
      $target = [IO.Path]::GetFullPath((Join-Path $extracted $entryName))
      if ($entryName.Contains(':') -or $entryName.StartsWith('/') -or !$target.StartsWith($extracted + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw '更新包包含非法路径。' }
      if ($entryName.EndsWith('/')) { New-Item -ItemType Directory -Path $target -Force | Out-Null; continue }
      New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $false)
    }
  } finally { $zip.Dispose() }
  $nextExtension = Join-Path $extracted 'extension'; $nextSync = Join-Path $extracted 'sync'
  $manifest = Get-Content -LiteralPath (Join-Path $nextExtension 'manifest.json') -Encoding UTF8 -Raw | ConvertFrom-Json
  $nextVersion = Get-Content -LiteralPath (Join-Path $nextSync 'version.json') -Raw | ConvertFrom-Json
  if ($manifest.version -ne $version -or $manifest.name -ne $oldManifest.name -or $manifest.manifest_version -ne 3 -or $nextVersion.version -ne $version -or (Get-Content -LiteralPath (Join-Path $extracted '.qibian-build') -Raw).Trim() -ne $version) { throw '更新包版本或内容不匹配。' }
  foreach ($path in @('sidepanel.html','music.html','rail.js',$manifest.background.service_worker)) { if (!(Test-Path -LiteralPath (Join-Path $nextExtension $path) -PathType Leaf)) { throw '扩展运行资源不完整。' } }
  foreach ($path in @('server.cjs','start.ps1','start.cmd','update.ps1','runtime/node.exe','runtime/LICENSE','ws-LICENSE.txt','THIRD-PARTY-NOTICES.txt')) { if (!(Test-Path -LiteralPath (Join-Path $nextSync $path) -PathType Leaf)) { throw '同步服务运行资源不完整。' } }
  $backup = Join-Path $stage 'backup'
  New-Item -ItemType Directory -Path $backup | Out-Null
  Copy-Item -LiteralPath $extensionRoot -Destination (Join-Path $backup 'extension') -Recurse
  Copy-Item -LiteralPath $syncRoot -Destination (Join-Path $backup 'sync') -Recurse
  function Copy-Programs($source, $destination, $marker) {
    foreach ($file in Get-ChildItem -LiteralPath $source -Recurse -File) {
      $relative = $file.FullName.Substring($source.Length + 1)
      if ($relative -eq $marker) { continue }
      $target = Join-Path $destination $relative
      New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
      Copy-Item -LiteralPath $file.FullName -Destination $target -Force
    }
    Copy-Item -LiteralPath (Join-Path $source $marker) -Destination (Join-Path $destination $marker) -Force
  }
  try {
    Copy-Programs $nextSync $syncRoot 'version.json'
    Copy-Programs $nextExtension $extensionRoot 'manifest.json'
  } catch {
    Copy-Programs (Join-Path $backup 'sync') $syncRoot 'version.json'
    Copy-Programs (Join-Path $backup 'extension') $extensionRoot 'manifest.json'
    throw '安装未完成，已恢复原版本。请稍后重新启动服务重试。'
  }
  Set-Content -LiteralPath $lastCheck -Value $version
  Write-Output "已安装栖边 $version。请在栖边设置中重新加载扩展，或重启浏览器。原目录与用户数据已保留。备份：$backup"
} catch {
  Write-Warning ("栖边自动更新未完成，继续启动当前版本：" + $_.Exception.Message)
}
