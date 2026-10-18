Add-Type -AssemblyName System.Drawing
$iconRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'icons'
New-Item -ItemType Directory -Force -Path $iconRoot | Out-Null
foreach ($size in @(16, 32, 48, 128)) {
  $bitmap = New-Object System.Drawing.Bitmap($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $fill = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#547665'))
  $white = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#F5F5EF'))
  $graphics.FillRectangle($fill, 0, 0, $size, $size)
  $margin = [single]($size * 0.22)
  $stroke = [single]([Math]::Max(1, $size * 0.07))
  $pen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#F5F5EF'), $stroke)
  $graphics.DrawRectangle($pen, $margin, $margin, [single]($size * 0.56), [single]($size * 0.56))
  $graphics.FillRectangle($white, [single]($size * 0.55), $margin, [single]($size * 0.23), [single]($size * 0.56))
  $bitmap.Save((Join-Path $iconRoot "icon$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $pen.Dispose()
  $fill.Dispose()
  $white.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}
