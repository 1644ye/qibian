$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
node (Join-Path $PSScriptRoot 'build.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Extension build failed' }
$packageVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'manifest.json') -Encoding UTF8 -Raw | ConvertFrom-Json).version
$packagePath = Join-Path $outputDirectory ('qibian-edge-' + $packageVersion + '.zip')
$buildDirectory = Join-Path $outputDirectory ('qibian-edge-' + $packageVersion)
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path -LiteralPath $packagePath) { Remove-Item -LiteralPath $packagePath }
[IO.Compression.ZipFile]::CreateFromDirectory($buildDirectory, $packagePath, [IO.Compression.CompressionLevel]::SmallestSize, $false)
Write-Output $packagePath
node (Join-Path $PSScriptRoot 'build-sync.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Sync helper build failed' }
$syncPackagePath = Join-Path $outputDirectory ('qibian-sync-' + $packageVersion + '.zip')
if (Test-Path -LiteralPath $syncPackagePath) { Remove-Item -LiteralPath $syncPackagePath }
[IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $outputDirectory ('qibian-sync-' + $packageVersion)), $syncPackagePath, [IO.Compression.CompressionLevel]::SmallestSize, $false)
Write-Output $syncPackagePath
