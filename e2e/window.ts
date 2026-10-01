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
  [StructLayout(LayoutKind.Sequential)] public struct MinMaxInfo { public int rx, ry, maxW, maxH, maxX, maxY, minTrackW, minTrackH, maxTrackW, maxTrackH; }
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr wParam, ref MinMaxInfo info);
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
    $info = New-Object TopLevel+MinMaxInfo
    [void][TopLevel]::SendMessage($hwnd, 0x24, [IntPtr]::Zero, [ref]$info)
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
