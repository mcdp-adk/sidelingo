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

/** Inspects the top-level windows titled `title` that belong to the running `exe`, from outside the app. */
export function inspectWindows(exe: string, title: string): WindowStyles[] {
  const json = runPowerShell(`
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
  public static List<IntPtr> All() {
    var all = new List<IntPtr>();
    EnumWindows((hwnd, _) => { all.Add(hwnd); return true; }, IntPtr.Zero);
    return all;
  }
}
'@
$pids = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ${psString(exe)} } | ForEach-Object { [uint32]$_.Id })
$found = @(foreach ($hwnd in [TopLevel]::All()) {
  $pid_ = [uint32]0
  [void][TopLevel]::GetWindowThreadProcessId($hwnd, [ref]$pid_)
  if ($pids -notcontains $pid_) { continue }
  $text = New-Object System.Text.StringBuilder 256
  [void][TopLevel]::GetWindowText($hwnd, $text, 256)
  if ($text.ToString() -ne ${psString(title)}) { continue }
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
