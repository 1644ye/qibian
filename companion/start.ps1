$ErrorActionPreference = 'Stop'
$runtime = Get-Command node -ErrorAction SilentlyContinue
if (!$runtime) {
  $bundled = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
  if (Test-Path -LiteralPath $bundled) { $nodePath = $bundled }
  else { throw '请先安装 Node.js 20 或更新版本，然后重新运行。https://nodejs.org/' }
} else { $nodePath = $runtime.Source }
& $nodePath (Join-Path $PSScriptRoot 'server.cjs')
