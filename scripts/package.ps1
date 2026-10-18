param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
  $version = (Get-Content -LiteralPath 'manifest.json' -Encoding UTF8 -Raw | ConvertFrom-Json).version
  if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid release version' }
  $outputDirectory = Join-Path $projectRoot 'dist'
  New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
  if (!$SkipBuild) {
    node scripts/build.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Extension build failed' }
    node scripts/build-sync.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Sync build failed' }
  }
  $extension = Join-Path $outputDirectory "qibian-edge-$version"
  $sync = Join-Path $outputDirectory "qibian-sync-$version"
  if (!(Test-Path -LiteralPath (Join-Path $sync 'runtime\node.exe'))) { throw 'Portable runtime is missing' }
  $rights = Join-Path $projectRoot 'docs\RIGHTS.md'
  Copy-Item -LiteralPath $rights -Destination (Join-Path $extension 'RIGHTS.md') -Force
  Copy-Item -LiteralPath $rights -Destination (Join-Path $sync 'RIGHTS.md') -Force
  $bundle = Join-Path $outputDirectory "qibian-$version-windows-x64"
  if (Test-Path -LiteralPath $bundle) {
    $resolvedBundle = [IO.Path]::GetFullPath($bundle)
    if ([IO.Path]::GetDirectoryName($resolvedBundle) -ne [IO.Path]::GetFullPath($outputDirectory) -or !(Test-Path -LiteralPath (Join-Path $bundle '.qibian-build'))) { throw 'Refusing to replace an unrecognized output directory' }
    Remove-Item -LiteralPath $resolvedBundle -Recurse -Force
  }
  New-Item -ItemType Directory -Path $bundle | Out-Null
  Set-Content -LiteralPath (Join-Path $bundle '.qibian-build') -Value $version -Encoding utf8
  Copy-Item -LiteralPath $extension -Destination (Join-Path $bundle 'extension') -Recurse
  Copy-Item -LiteralPath $sync -Destination (Join-Path $bundle 'sync') -Recurse
  Copy-Item -LiteralPath 'docs\USER-GUIDE.md' -Destination (Join-Path $bundle 'README.md')
  Copy-Item -LiteralPath $rights -Destination (Join-Path $bundle 'RIGHTS.md')
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $packages = @(
    @{ Source=$bundle; Name="qibian-$version-windows-x64.zip" },
    @{ Source=$extension; Name="qibian-extension-$version.zip" },
    @{ Source=$sync; Name="qibian-sync-$version-windows-x64-portable.zip" }
  )
  $sums = @()
  foreach ($package in $packages) {
    $destination = Join-Path $outputDirectory $package.Name
    if (Test-Path -LiteralPath $destination) { throw "Package already exists: $destination. Use a fresh build output directory or a new version; published assets must never be overwritten." }
    [IO.Compression.ZipFile]::CreateFromDirectory($package.Source, $destination, [IO.Compression.CompressionLevel]::SmallestSize, $false)
    $hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
    $sums += "$hash  $($package.Name)"
    Write-Output $destination
  }
  [IO.File]::WriteAllText((Join-Path $outputDirectory 'SHA256SUMS.txt'), ($sums -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
  Write-Output (Join-Path $outputDirectory 'SHA256SUMS.txt')
} finally { Pop-Location }
