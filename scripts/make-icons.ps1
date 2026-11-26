# Pictures made from the app logo (assets\icon\Snipmunk_logo.png):
#
#   powershell -ExecutionPolicy Bypass -File scripts\make-icons.ps1 -TemplateIcon
#       src-tauri\icons\snpt.ico, the icon of template files: the logo with a badge (a page layout) in the corner, like the
#       badges of snpr.ico (recordings) and snpd.ico (guides). Committed; run again only when the logo changes.
#
#   powershell -ExecutionPolicy Bypass -File scripts\make-icons.ps1 -MsixAssets <folder>
#       every picture the Store package needs (scripts\build-msix.ps1 calls it; nothing of this is committed).
param(
  [switch]$TemplateIcon,
  [string]$MsixAssets = ""
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$repo = Split-Path -Parent $PSScriptRoot
$icons = Join-Path $repo "src-tauri\icons"
$logo = [System.Drawing.Image]::FromFile((Join-Path $repo "assets\icon\Snipmunk_logo.png"))

function New-Canvas([int]$width, [int]$height) {
  $bitmap = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bitmap)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  return @($bitmap, $g)
}

# A picture drawn in the middle, `Share` of the smaller side large.
function Add-Centered($g, $picture, [int]$width, [int]$height, [double]$share) {
  $side = [math]::Round([math]::Min($width, $height) * $share)
  $x = [math]::Round(($width - $side) / 2)
  $y = [math]::Round(($height - $side) / 2)
  $attributes = [System.Drawing.Imaging.ImageAttributes]::new()
  $attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
  $target = [System.Drawing.Rectangle]::new($x, $y, $side, $side)
  $g.DrawImage($picture, $target, 0, 0, $picture.Width, $picture.Height, [System.Drawing.GraphicsUnit]::Pixel, $attributes)
}

# The template badge: a violet disc with a white ring and a small page layout (a heading over two boxes).
function Add-TemplateBadge($g, [double]$size) {
  $cx = $size * 0.73; $cy = $size * 0.73; $r = $size * 0.255
  $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
  $violet = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 111, 66, 193))
  $ring = $r + $size * 0.025
  $g.FillEllipse($white, [single]($cx - $ring), [single]($cy - $ring), [single](2 * $ring), [single](2 * $ring))
  $g.FillEllipse($violet, [single]($cx - $r), [single]($cy - $r), [single](2 * $r), [single](2 * $r))
  $w = $r * 1.08; $left = $cx - $w / 2; $top = $cy - $r * 0.56
  $g.FillRectangle($white, [single]$left, [single]$top, [single]$w, [single]($r * 0.28))
  $boxTop = $top + $r * 0.40; $boxW = ($w - $r * 0.12) / 2; $boxH = $r * 0.72
  $g.FillRectangle($white, [single]$left, [single]$boxTop, [single]$boxW, [single]$boxH)
  $g.FillRectangle($white, [single]($left + $boxW + $r * 0.12), [single]$boxTop, [single]$boxW, [single]$boxH)
}

function Get-PngBytes($bitmap) {
  $stream = [System.IO.MemoryStream]::new()
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  return , $stream.ToArray()
}

# The logo with the badge of a file kind at `size` pixels: drawn large and scaled down, so small sizes stay clean.
function New-FileIcon([string]$kind, [int]$size) {
  $big, $bg = New-Canvas 512 512
  Add-Centered $bg $logo 512 512 1.0
  if ($kind -eq "snpt") { Add-TemplateBadge $bg 512 }
  else {
    $ico = [System.Drawing.Icon]::new((Join-Path $icons "$kind.ico"), 256, 256)
    $bg.Clear([System.Drawing.Color]::Transparent)
    $picture = $ico.ToBitmap()
    Add-Centered $bg $picture 512 512 1.0
  }
  $small, $g = New-Canvas $size $size
  Add-Centered $g $big $size $size 1.0
  $g.Dispose(); $bg.Dispose(); $big.Dispose()
  return $small
}

function Write-Ico([string]$file, [object[]]$pictures) {
  $stream = [System.IO.File]::Create($file)
  $out = [System.IO.BinaryWriter]::new($stream)
  $out.Write([uint16]0); $out.Write([uint16]1); $out.Write([uint16]$pictures.Count)
  $offset = 6 + 16 * $pictures.Count
  foreach ($p in $pictures) {
    $side = if ($p.Size -ge 256) { 0 } else { $p.Size }
    $out.Write([byte]$side); $out.Write([byte]$side); $out.Write([byte]0); $out.Write([byte]0)
    $out.Write([uint16]1); $out.Write([uint16]32)
    $out.Write([uint32]$p.Bytes.Length); $out.Write([uint32]$offset)
    $offset += $p.Bytes.Length
  }
  foreach ($p in $pictures) { $out.Write([byte[]]$p.Bytes) }
  $out.Close()
}

if ($TemplateIcon) {
  $pictures = foreach ($size in 16, 24, 32, 48, 64, 128, 256) {
    $bitmap = New-FileIcon "snpt" $size
    [pscustomobject]@{ Size = $size; Bytes = (Get-PngBytes $bitmap) }
    $bitmap.Dispose()
  }
  $file = Join-Path $icons "snpt.ico"
  Write-Ico $file @($pictures)
  Write-Host "written: $file"
}

if ($MsixAssets) {
  New-Item -ItemType Directory -Force $MsixAssets | Out-Null
  $MsixAssets = (Resolve-Path $MsixAssets).Path
  function Save-Logo([string]$name, [int]$width, [int]$height, [double]$share) {
    $bitmap, $g = New-Canvas $width $height
    Add-Centered $g $logo $width $height $share
    $bitmap.Save((Join-Path $MsixAssets "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bitmap.Dispose()
  }
  # name, base width, base height, how much of it the logo fills
  $tiles = @(
    @("StoreLogo", 50, 50, 1.0),
    @("Square44x44Logo", 44, 44, 1.0),
    @("SmallTile", 71, 71, 0.8),
    @("Square150x150Logo", 150, 150, 0.7),
    @("Wide310x150Logo", 310, 150, 0.75),
    @("LargeTile", 310, 310, 0.65)
  )
  foreach ($tile in $tiles) {
    $name, $width, $height, $share = $tile
    foreach ($scale in 100, 125, 150, 200, 400) {
      Save-Logo "$name.scale-$scale" ([math]::Round($width * $scale / 100)) ([math]::Round($height * $scale / 100)) $share
    }
  }
  # The taskbar, Start's list and Alt+Tab take exact sizes, without a plate behind them.
  foreach ($size in 16, 24, 32, 48, 256) {
    Save-Logo "Square44x44Logo.targetsize-$size" $size $size 1.0
    Save-Logo "Square44x44Logo.targetsize-${size}_altform-unplated" $size $size 1.0
    Save-Logo "Square44x44Logo.targetsize-${size}_altform-lightunplated" $size $size 1.0
  }
  # File types.
  foreach ($kind in "snpr", "snpd", "snpt") {
    foreach ($size in 16, 24, 32, 48, 256) {
      $bitmap = New-FileIcon $kind $size
      $bitmap.Save((Join-Path $MsixAssets "file-$kind.targetsize-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
      $bitmap.Dispose()
    }
    $bitmap = New-FileIcon $kind 44
    $bitmap.Save((Join-Path $MsixAssets "file-$kind.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()
  }
  Write-Host "written: $(@(Get-ChildItem $MsixAssets -Filter *.png).Count) pictures in $MsixAssets"
}
$logo.Dispose()
