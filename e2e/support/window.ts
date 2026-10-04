import { psString, runPowerShell } from "./powershell";

export interface WindowStyles {
  visible: boolean;
  topmost: boolean;
  /** Windows keeps an owned window, or a tool window, out of the taskbar and Alt+Tab unless it is an app window. */
  owned: boolean;
  toolWindow: boolean;
  appWindow: boolean;
  minimizeBox: boolean;
  maximizeBox: boolean;
}

/** A PowerShell fragment that finds the top-level windows titled `title` that belong to the running `exe`, as `$windows`. */
function findWindowsScript(exe: string, title: string): string {
  return `
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class TopLevel {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left, top, right, bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, ref Rect rect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd, ref Rect rect);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct MinMaxInfo { public int rx, ry, maxW, maxH, maxX, maxY, minTrackW, minTrackH, maxTrackW, maxTrackH; }
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr wParam, ref MinMaxInfo info);
  public static MinMaxInfo Minimum(IntPtr hwnd) {
    var info = new MinMaxInfo();
    SendMessage(hwnd, 0x24, IntPtr.Zero, ref info);
    return info;
  }
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
  public static readonly IntPtr PerMonitorAwareV2 = new IntPtr(-4);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  public static List<IntPtr> All() {
    var all = new List<IntPtr>();
    EnumWindows((hwnd, _) => { all.Add(hwnd); return true; }, IntPtr.Zero);
    return all;
  }
}
'@
$pids = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ${psString(exe)} } | ForEach-Object { [uint32]$_.Id })
$windows = @(foreach ($hwnd in [TopLevel]::All()) {
  $pid_ = [uint32]0
  [void][TopLevel]::GetWindowThreadProcessId($hwnd, [ref]$pid_)
  if ($pids -notcontains $pid_) { continue }
  $text = New-Object System.Text.StringBuilder 256
  [void][TopLevel]::GetWindowText($hwnd, $text, 256)
  if ($text.ToString() -eq ${psString(title)}) { $hwnd }
})
`;
}

/** Inspects the top-level windows titled `title` that belong to the running `exe`, from outside the app. */
export function inspectWindows(exe: string, title: string): WindowStyles[] {
  const json = runPowerShell(`${findWindowsScript(exe, title)}
$found = @(foreach ($hwnd in $windows) {
  $style = [TopLevel]::GetWindowLongPtr($hwnd, -16).ToInt64()
  $exStyle = [TopLevel]::GetWindowLongPtr($hwnd, -20).ToInt64()
  [pscustomobject]@{
    visible = [TopLevel]::IsWindowVisible($hwnd)
    topmost = ($exStyle -band 0x8) -ne 0
    owned = [TopLevel]::GetWindow($hwnd, 4) -ne [IntPtr]::Zero
    toolWindow = ($exStyle -band 0x80) -ne 0
    appWindow = ($exStyle -band 0x40000) -ne 0
    minimizeBox = ($style -band 0x20000) -ne 0
    maximizeBox = ($style -band 0x10000) -ne 0
  }
})
ConvertTo-Json -InputObject $found -Compress
`);
  return JSON.parse(json);
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MonitorBounds extends WindowBounds {
  primary: boolean;
}

/** Reads the current physical monitor rectangles and identifies Windows' primary monitor. */
export function monitorBounds(): MonitorBounds[] {
  const json = runPowerShell(`
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class DisplayMonitors {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left, top, right, bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Info { public uint size; public Rect monitor; public Rect work; public uint flags; }
  public delegate bool EnumProc(IntPtr monitor, IntPtr hdc, ref Rect rect, IntPtr data);
  public static readonly IntPtr PerMonitorAwareV2 = new IntPtr(-4);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll", SetLastError = true)] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, EnumProc callback, IntPtr data);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetMonitorInfoW", SetLastError = true)] static extern bool GetMonitorInfo(IntPtr monitor, ref Info info);
  public static List<Info> All() {
    var previous = SetThreadDpiAwarenessContext(PerMonitorAwareV2);
    if (previous == IntPtr.Zero) throw new InvalidOperationException("Couldn't set monitor measurement DPI awareness.");
    try {
      var monitors = new List<Info>();
      EnumProc callback = (IntPtr monitor, IntPtr hdc, ref Rect rect, IntPtr data) => {
        var info = new Info();
        info.size = (uint)Marshal.SizeOf(typeof(Info));
        if (!GetMonitorInfo(monitor, ref info)) throw new InvalidOperationException("Couldn't read monitor bounds.");
        monitors.Add(info);
        return true;
      };
      if (!EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, callback, IntPtr.Zero)) throw new InvalidOperationException("Couldn't enumerate monitors.");
      return monitors;
    } finally {
      SetThreadDpiAwarenessContext(previous);
    }
  }
}
'@
$found = @([DisplayMonitors]::All() | ForEach-Object {
  [pscustomobject]@{
    x = $_.monitor.left
    y = $_.monitor.top
    width = $_.monitor.right - $_.monitor.left
    height = $_.monitor.bottom - $_.monitor.top
    primary = ($_.flags -band 1) -ne 0
  }
})
ConvertTo-Json -InputObject $found -Compress
`);
  return JSON.parse(json);
}

/** Measures the actual top-level window, independently of WebView2's child viewport. */
export function windowBounds(exe: string, title: string): WindowBounds[] {
  return JSON.parse(
    runPowerShell(`${findWindowsScript(exe, title)}
$previous = [TopLevel]::SetThreadDpiAwarenessContext([TopLevel]::PerMonitorAwareV2)
if ($previous -eq [IntPtr]::Zero) { throw "Couldn't set the measurement thread's DPI awareness." }
try {
  $found = @(foreach ($hwnd in $windows) {
    $rect = New-Object TopLevel+Rect
    if (-not [TopLevel]::GetWindowRect($hwnd, [ref]$rect)) { throw "Couldn't read the native window rectangle." }
    @{ x = $rect.left; y = $rect.top; width = $rect.right - $rect.left; height = $rect.bottom - $rect.top }
  })
  ConvertTo-Json -InputObject $found -Compress
} finally { [void][TopLevel]::SetThreadDpiAwarenessContext($previous) }
`),
  );
}

/** Moves/resizes only this executable's named top-level window through the OS window API. */
export function setWindowBounds(exe: string, title: string, bounds: WindowBounds): void {
  runPowerShell(`${findWindowsScript(exe, title)}
$previous = [TopLevel]::SetThreadDpiAwarenessContext([TopLevel]::PerMonitorAwareV2)
if ($previous -eq [IntPtr]::Zero) { throw "Couldn't set the geometry thread's DPI awareness." }
try {
  if ($windows.Count -ne 1) { throw "Expected exactly one native window." }
  # Keep its topmost state and avoid activation; only position and size change.
  if (-not [TopLevel]::SetWindowPos($windows[0], [IntPtr]::Zero, ${bounds.x}, ${bounds.y}, ${bounds.width}, ${bounds.height}, 0x14)) {
    throw "Couldn't move/resize the native window."
  }
} finally { [void][TopLevel]::SetThreadDpiAwarenessContext($previous) }
`);
}

/** The OS minimum outer tracking size, in physical pixels, for a real user resize. */
export function minimumTrackingSizes(exe: string, title: string): { width: number; height: number }[] {
  return JSON.parse(
    runPowerShell(`${findWindowsScript(exe, title)}
$previous = [TopLevel]::SetThreadDpiAwarenessContext([TopLevel]::PerMonitorAwareV2)
if ($previous -eq [IntPtr]::Zero) { throw "Couldn't set the measurement thread's DPI awareness." }
try {
  $found = @(foreach ($hwnd in $windows) {
    $info = [TopLevel]::Minimum($hwnd)
    if ($info.minTrackW -le 0 -or $info.minTrackH -le 0) { throw "Couldn't read the native minimum tracking size." }
    @{ width = $info.minTrackW; height = $info.minTrackH }
  })
  ConvertTo-Json -InputObject $found -Compress
} finally { [void][TopLevel]::SetThreadDpiAwarenessContext($previous) }
`),
  );
}

/**
 * The minimum client size, in logical pixels, of the windows titled `title` belonging to `exe`.
 * Windows' WM_GETMINMAXINFO gives the outer tracking size, so subtract the measured nonclient area.
 */
export function minimumSizes(exe: string, title: string): { width: number; height: number }[] {
  const json = runPowerShell(`${findWindowsScript(exe, title)}
# Read physical geometry, matching Windows' tracking size rather than DPI-virtualized coordinates.
$previousDpiContext = [TopLevel]::SetThreadDpiAwarenessContext([TopLevel]::PerMonitorAwareV2)
if ($previousDpiContext -eq [IntPtr]::Zero) {
  throw "Couldn't set the measurement thread's DPI awareness."
}
try {
  $found = @(foreach ($hwnd in $windows) {
    $info = [TopLevel]::Minimum($hwnd)
    $outer = New-Object TopLevel+Rect
    $client = New-Object TopLevel+Rect
    if (-not [TopLevel]::GetWindowRect($hwnd, [ref]$outer) -or -not [TopLevel]::GetClientRect($hwnd, [ref]$client)) {
      throw "Couldn't read the window or client rectangle."
    }
    $nonclientWidth = ($outer.right - $outer.left) - ($client.right - $client.left)
    $nonclientHeight = ($outer.bottom - $outer.top) - ($client.bottom - $client.top)
    $scale = [TopLevel]::GetDpiForWindow($hwnd) / 96
    [pscustomobject]@{
      width = ($info.minTrackW - $nonclientWidth) / $scale
      height = ($info.minTrackH - $nonclientHeight) / $scale
    }
  })
  ConvertTo-Json -InputObject $found -Compress
} finally {
  [void][TopLevel]::SetThreadDpiAwarenessContext($previousDpiContext)
}
`);
  return JSON.parse(json);
}
