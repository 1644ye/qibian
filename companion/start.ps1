$ErrorActionPreference = 'Stop'
$nodePath = Join-Path $PSScriptRoot 'runtime\node.exe'
if (!(Test-Path -LiteralPath $nodePath -PathType Leaf)) {
  throw '缺少随包运行时 runtime\node.exe。请完整解压 Windows x64 便携包后启动，不要只复制启动脚本。'
}
if (![Environment]::Is64BitOperatingSystem) { throw '此便携包需要 64 位 Windows。' }
if ($env:QIBIAN_AUTO_UPDATE -ne '0') { & (Join-Path $PSScriptRoot 'update.ps1') -Automatic }
& $nodePath (Join-Path $PSScriptRoot 'server.cjs')
exit $LASTEXITCODE
