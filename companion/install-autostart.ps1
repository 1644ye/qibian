$ErrorActionPreference = 'Stop'
# Run this script explicitly to opt into starting the helper at Windows sign-in.
$nodePath = Join-Path $PSScriptRoot 'runtime\node.exe'
if (!(Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw '请先完整解压 Windows x64 便携包，再设置自动启动。' }
$startScript = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'start.ps1')).Path
$command = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $startScript + '"'
New-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'QibianSync' -Value $command -PropertyType String -Force | Out-Null
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $startScript + '"'))
Write-Output '已设置登录 Windows 自动启动。配对密钥保存在 %LOCALAPPDATA%\QibianSync\pairing-key.txt。'
