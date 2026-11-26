# Windows of the running TEST instance only: a process named snipmunk whose program file is in a folder "target-test".
# Another program's window is never listed, moved or changed. No mouse or keyboard input is sent.
#   -Action list                                   every visible window of the instance
#   -Action place -Title <t> [-X -Y -Width -Height] [-NewTitle <t>] [-Top]   move, size, rename and keep on top (client pixels)
#   -Action restore -Title <t>                     show a minimized window again (without taking the focus)
#   -Action show -Title <t>                        show a hidden window (without taking the focus)
#   -Action check -Points "x,y;x,y"                is every desktop point inside a window of the instance?
param([string]$Action = "list", [string]$Title = "", [string]$NewTitle = "", [int]$X = [int]::MinValue, [int]$Y = [int]::MinValue, [int]$Width = 0, [int]$Height = 0, [switch]$Top, [string]$Points = "")
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public static class OwnWindows {
  public delegate bool Each(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(Each f, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool SetWindowText(IntPtr h, string s);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  public static List<IntPtr> All() { var l = new List<IntPtr>(); EnumWindows((h, p) => { l.Add(h); return true; }, IntPtr.Zero); return l; }
}
"@
[void][OwnWindows]::SetProcessDPIAware()
$own = @(Get-Process -Name snipmunk -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*\target-test\*" } | ForEach-Object { [uint32]$_.Id })
if ($own.Count -eq 0) { throw "no test instance (a snipmunk process from a target-test folder) is running" }
function Get-Info($h) {
  $b = New-Object System.Text.StringBuilder 256; [void][OwnWindows]::GetWindowText($h, $b, 256)
  $c = New-Object OwnWindows+RECT; [void][OwnWindows]::GetClientRect($h, [ref]$c)
  $o = New-Object OwnWindows+POINT; [void][OwnWindows]::ClientToScreen($h, [ref]$o)
  [pscustomobject]@{ hwnd = $h.ToInt64(); title = $b.ToString(); visible = [OwnWindows]::IsWindowVisible($h); x = $o.X; y = $o.Y; w = $c.R; h = $c.B }
}
$mine = @([OwnWindows]::All() | Where-Object { $p = [uint32]0; [void][OwnWindows]::GetWindowThreadProcessId($_, [ref]$p); $own -contains $p })
if ($Action -eq "list") { ConvertTo-Json -Compress @($mine | ForEach-Object { Get-Info $_ } | Where-Object { $_.title }); return }
if ($Action -eq "check") {
  $all = foreach ($pair in $Points.Split(";")) {
    $xy = $pair.Split(","); $pt = New-Object OwnWindows+POINT; $pt.X = [int]$xy[0]; $pt.Y = [int]$xy[1]
    $root = [OwnWindows]::GetAncestor([OwnWindows]::WindowFromPoint($pt), 2)
    $p = [uint32]0; [void][OwnWindows]::GetWindowThreadProcessId($root, [ref]$p); $own -contains $p
  }
  ConvertTo-Json -Compress @{ own = (@($all) -notcontains $false) }; return
}
$win = $mine | Where-Object { (Get-Info $_).title -like $Title } | Select-Object -First 1   # a title or a pattern
if (-not $win) { throw "the test instance has no window titled '$Title'" }
$win = [IntPtr]$win
if ($Action -eq "restore") { [void][OwnWindows]::ShowWindow($win, 4) }   # SW_SHOWNOACTIVATE
if ($Action -eq "show") { [void][OwnWindows]::ShowWindow($win, 8) }      # SW_SHOWNA
if ($Action -eq "place") {
  $r = New-Object OwnWindows+RECT; [void][OwnWindows]::GetWindowRect($win, [ref]$r); $i = Get-Info $win
  $nx = if ($X -ne [int]::MinValue) { $X } else { $r.L }; $ny = if ($Y -ne [int]::MinValue) { $Y } else { $r.T }
  $nw = if ($Width -gt 0) { $Width + ($r.R - $r.L - $i.w) } else { $r.R - $r.L }; $nh = if ($Height -gt 0) { $Height + ($r.B - $r.T - $i.h) } else { $r.B - $r.T }
  $after = if ($Top) { [IntPtr](-1) } else { [IntPtr](-2) }
  [void][OwnWindows]::SetWindowPos($win, $after, $nx, $ny, $nw, $nh, 0x0010)   # SWP_NOACTIVATE
  if ($NewTitle) { [void][OwnWindows]::SetWindowText($win, $NewTitle) }
}
ConvertTo-Json -Compress (Get-Info $win)
