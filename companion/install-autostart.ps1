$ErrorActionPreference = 'Stop'
# Run this script explicitly to opt into starting the helper at Windows sign-in.
$startScript = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'start.ps1')).Path
$command = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $startScript + '"'
New-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'QibianSync' -Value $command -PropertyType String -Force | Out-Null
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $startScript + '"'))
Write-Output '已设置登录 Windows 自动启动。配对密钥保存在 %LOCALAPPDATA%\QibianSync\pairing-key.txt。'
