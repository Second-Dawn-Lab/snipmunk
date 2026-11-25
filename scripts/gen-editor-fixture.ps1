# Draws pictures that look like a screenshot of a code editor (for the tests of Quick redact): GDI text with ClearType (coloured
# fringes), a line-number margin, a change bar and the highlighted current line. Everything is drawn into memory; nothing of the
# desktop is read. The default lines hold made-up values.
#
#   powershell -ExecutionPolicy Bypass -File scripts\gen-editor-fixture.ps1 -Out E:\SecondDawn\_scratch\tmp\ocr
#
# -Lines <file>: other lines (UTF-8, one per line).
param(
  [string]$Out = "E:\SecondDawn\_scratch\tmp\ocr",
  [string]$Lines = ""
)
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Gdi {
  [DllImport("gdi32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr CreateFontW(int h, int w, int e, int o, int weight, uint i, uint u, uint s, uint charset, uint outp, uint clip, uint quality, uint pitch, string face);
  [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr dc, IntPtr o);
  [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr o);
  [DllImport("gdi32.dll", CharSet = CharSet.Unicode)] public static extern bool TextOutW(IntPtr dc, int x, int y, string s, int n);
  [DllImport("gdi32.dll")] public static extern int SetTextColor(IntPtr dc, int color);
  [DllImport("gdi32.dll")] public static extern int SetBkMode(IntPtr dc, int mode);
}
"@
New-Item -ItemType Directory -Force $Out | Out-Null

$text = if ($Lines) { Get-Content -LiteralPath $Lines -Encoding UTF8 } else {
  @(
    "Name : Test Person",
    "email : k@example.com",
    "password: 8842kqzw771m",
    "Iban: DE89 3704 0044 0532 0130 00",
    "IBAN: DE89-1111-2222-3333-4444-55",
    "",
    "IBAN: DE89111122223333444455",
    "",
    "password : 47qrt`$9191",
    "",
    "end"
  )
}

function Draw-Editor([string]$Name, [int]$W, [int]$H, [double]$Scale, [string]$Font, [double]$Points, [int]$Current, [switch]$Dark) {
  $bmp = New-Object System.Drawing.Bitmap $W, $H, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $px = { param($v) [int][math]::Round($v * $Scale) }
  $brush = { param($r, $gr, $b) New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($r, $gr, $b)) }
  $g.Clear([System.Drawing.Color]::FromArgb(240, 240, 240))
  $top = & $px 104
  $bottom = $H - (& $px 70)
  $paper = if ($Dark) { & $brush 30 30 30 } else { & $brush 255 255 255 }
  $g.FillRectangle($paper, 0, $top, $W, $bottom - $top)
  # line numbers, symbol margin with the change bar, fold margin
  $g.FillRectangle((& $brush 228 228 228), 0, $top, (& $px 40), $bottom - $top)
  $g.FillRectangle((& $brush 242 242 242), (& $px 40), $top, (& $px 22), $bottom - $top)
  $lh = & $px ([math]::Ceiling($Points * 96 / 72 * 1.22))
  $first = $top + (& $px 1)
  if ($Current -ge 0) {
    $c = if ($Dark) { & $brush 40 40 60 } else { & $brush 232 232 255 }
    $g.FillRectangle($c, (& $px 62), $first + $Current * $lh, $W - (& $px 62), $lh)
  }
  for ($i = 0; $i -lt $text.Count; $i++) {
    $g.FillRectangle((& $brush 255 128 0), (& $px 46), $first + $i * $lh, (& $px 3), $lh)
  }
  $dc = $g.GetHdc()
  $rgb = { param($r, $gr, $b) [int]($r -bor ($gr -shl 8) -bor ($b -shl 16)) }
  $mk = { param($face, $height) [Gdi]::CreateFontW(-$height, 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 5, 0, $face) }   # 5: ClearType
  $mono = & $mk $Font ([int][math]::Round($Points * 96 / 72 * $Scale))
  $ui = & $mk "Segoe UI" (& $px 12)
  [void][Gdi]::SetBkMode($dc, 1)
  $put = { param($s, $f, $x, $y, $color) [void][Gdi]::SelectObject($dc, $f); [void][Gdi]::SetTextColor($dc, $color); [void][Gdi]::TextOutW($dc, [int]$x, [int]$y, [string]$s, ([string]$s).Length) }
  $black = & $rgb 0 0 0
  $ink = if ($Dark) { & $rgb 212 212 212 } else { $black }
  & $put "*new 3 - Notepad++" $ui (& $px 34) (& $px 7) $black
  & $put "File   Edit   Search   View   Encoding   Language   Settings   Tools   Macro   Run   Plugins   Window   ?" $ui (& $px 8) (& $px 32) $black
  & $put "new 3" $ui (& $px 14) (& $px 82) $black
  for ($i = 0; $i -lt $text.Count; $i++) {
    $y = $first + $i * $lh
    & $put ([string]($i + 1)) $mono (& $px 20) $y (& $rgb 128 128 128)
    & $put $text[$i] $mono (& $px 66) $y $ink
  }
  & $put "Normal text file        length : 225    lines : 14       Ln : 12   Col : 1   Pos : 220       Windows (CR LF)    UTF-8    INS" $ui (& $px 8) ($H - (& $px 66)) $black
  & $put "Type here to search" $ui (& $px 60) ($H - (& $px 30)) $black
  [void][Gdi]::DeleteObject($mono)
  [void][Gdi]::DeleteObject($ui)
  $g.ReleaseHdc($dc)
  $g.Dispose()
  $bmp.Save((Join-Path $Out "$Name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

foreach ($font in @(@("Consolas", "cons"), @("Courier New", "cour"))) {
  foreach ($s in @(@(1920, 1080, 1.0), @(1920, 1080, 1.25), @(1920, 1200, 1.5), @(2560, 1440, 1.0), @(2560, 1440, 1.25), @(3840, 2160, 1.75))) {
    foreach ($pt in @(10, 11)) {
      $tag = "{0}-{1}x{2}-{3}-{4}pt" -f $font[1], $s[0], $s[1], [int]($s[2] * 100), $pt
      Draw-Editor $tag $s[0] $s[1] $s[2] $font[0] $pt 11
    }
  }
}
# the current line on one of the secrets, a small window, a dark theme
Draw-Editor "cur-email-125" 1920 1080 1.25 "Consolas" 10 1
Draw-Editor "cur-iban-100" 1920 1080 1.0 "Consolas" 10 4
Draw-Editor "small-100" 820 460 1.0 "Consolas" 10 11
Draw-Editor "dark-125" 1920 1080 1.25 "Consolas" 11 3 -Dark

# The thin type of an editor at 100 % (Courier New 10 pt, 8 px letters, 17 px lines) drawn with ClearType into a 32 bit picture:
# recognition reads its "8" as "B" or "S", "5" as "S" and a final "00" as "oo", so check digits are wrong.
function Draw-Thin([string]$Name) {
  $thin = if ($Lines) { $text } else {
    @(
      "Name : Test Person",
      "email : k@qmail.com",
      "password: 8842kqzw771m",
      "Iban: DE89 3704 0044 0532 0130 00",
      "IBAN: DE89-8888-1188-0888-2288-00",
      "",
      "IBAN: DE89888800008888555588",
      "",
      "IBAN: DE89888800008888555588",
      "",
      "",
      "end"
    )
  }
  $bmp = New-Object System.Drawing.Bitmap 700, 420, ([System.Drawing.Imaging.PixelFormat]::Format32bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::White)
  $fill = { param($r, $gr, $b, $x, $y, $w, $h) $g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($r, $gr, $b))), $x, $y, $w, $h) }
  & $fill 228 228 228 12 104 38 316
  & $fill 224 224 224 50 104 18 316
  & $fill 255 128 0 63 104 3 220
  & $fill 232 232 255 68 (104 + 9 * 17) 632 17
  $dc = $g.GetHdc()
  $font = [Gdi]::CreateFontW(-13, 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 5, 0, "Courier New")
  [void][Gdi]::SelectObject($dc, $font)
  [void][Gdi]::SetBkMode($dc, 1)
  for ($i = 0; $i -lt $thin.Count; $i++) {
    $y = 104 + $i * 17 + 1
    [void][Gdi]::SetTextColor($dc, 0x808080)
    [void][Gdi]::TextOutW($dc, 34, $y, [string]($i + 1), ([string]($i + 1)).Length)
    [void][Gdi]::SetTextColor($dc, 0)
    [void][Gdi]::TextOutW($dc, 69, $y, $thin[$i], $thin[$i].Length)
  }
  $g.ReleaseHdc($dc)
  [void][Gdi]::DeleteObject($font)
  $g.Dispose()
  $bmp.Save((Join-Path $Out "$Name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
Draw-Thin "thin-cour-100"
(Get-ChildItem $Out -Filter *.png).Count
