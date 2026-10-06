import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

/** The programs a run itself writes the clipboard through: the tests' PowerShell helpers, the app and its WebView. */
const RUN_WRITERS = new Set(["powershell", "sidelingo", "msedgewebview2"]);

/** A clipboard write by a program outside the run, such as the owner copying while it runs. */
export interface OutsideWrite {
  at: Date;
  writer: string;
}

const watcher = `using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public class SidelingoClipboardWatcher : NativeWindow {
  private const int WM_CLIPBOARDUPDATE = 0x031D;
  [DllImport("user32.dll", SetLastError = true)] private static extern bool AddClipboardFormatListener(IntPtr window);
  [DllImport("user32.dll")] private static extern IntPtr GetClipboardOwner();
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

  public SidelingoClipboardWatcher() {
    // A message-only window: it receives clipboard updates and never shows.
    CreateHandle(new CreateParams { Parent = new IntPtr(-3) });
    if (!AddClipboardFormatListener(Handle)) throw new Win32Exception(Marshal.GetLastWin32Error());
    Console.Out.WriteLine("watching");
    Console.Out.Flush();
  }

  protected override void WndProc(ref Message message) {
    if (message.Msg == WM_CLIPBOARDUPDATE) {
      uint processId = 0;
      IntPtr owner = GetClipboardOwner();
      if (owner != IntPtr.Zero) GetWindowThreadProcessId(owner, out processId);
      string name = "";
      if (processId != 0) {
        try { name = Process.GetProcessById((int)processId).ProcessName; } catch (ArgumentException) { }
      }
      Console.Out.WriteLine(processId + "\\t" + name);
      Console.Out.Flush();
    }
    base.WndProc(ref message);
  }
}`;

/**
 * Watches which program writes the Windows clipboard, so a failing task can name another program that wrote it
 * mid-run. A write whose owner window is unknown can't be told apart, so it isn't counted.
 */
export async function watchClipboardWriters(): Promise<{
  outsideWritesSince(time: Date): OutsideWrite[];
  stop(): void;
}> {
  const script = `$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
${watcher}
'@
$watcher = New-Object SidelingoClipboardWatcher
[System.Windows.Forms.Application]::Run()`;
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { stdio: ["ignore", "pipe", "inherit"], windowsHide: true },
  );
  const writes: OutsideWrite[] = [];
  const lines = createInterface({ input: child.stdout! });
  await new Promise<void>((resolve, reject) => {
    lines.on("line", (line) => {
      if (line === "watching") return resolve();
      const [processId, name] = line.split("\t");
      if (processId !== "0" && !RUN_WRITERS.has(name.toLowerCase())) {
        writes.push({ at: new Date(), writer: name ? `${name} (process ${processId})` : `process ${processId}` });
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`The clipboard watcher exited before watching (code ${code}).`)));
  });
  return {
    outsideWritesSince: (time) => writes.filter(({ at }) => at >= time),
    stop: () => void child.kill(),
  };
}
