$ErrorActionPreference = 'Stop'
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'QibianSync' -ErrorAction SilentlyContinue
Write-Output '已取消自动启动，不删除任何同步数据。当前服务在退出 Windows 后停止。'
