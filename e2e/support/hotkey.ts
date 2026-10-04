import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export interface NativeRegistration {
  registered: boolean;
  error: number;
  /** Ends only this fixture process and releases the hotkey it registered. */
  close(): Promise<void>;
}

/** Another process genuinely reserves a Windows hotkey; no input is injected. */
export async function reserveHotkey(modifiers: number, virtualKey: number): Promise<NativeRegistration> {
  if (!Number.isInteger(modifiers) || !Number.isInteger(virtualKey)) {
    throw new Error("Native hotkey fixture needs integer modifiers and a virtual key.");
  }
  const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NativeHotkey {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool RegisterHotKey(IntPtr hwnd, int id, uint modifiers, uint key);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool UnregisterHotKey(IntPtr hwnd, int id);
}
'@
$registered = [NativeHotkey]::RegisterHotKey([IntPtr]::Zero, 1, ${modifiers | 0x4000}, ${virtualKey})
$errorCode = if ($registered) { 0 } else { [System.Runtime.InteropServices.Marshal]::GetLastWin32Error() }
try {
  [Console]::WriteLine((@{ registered = $registered; error = $errorCode } | ConvertTo-Json -Compress))
  if ($registered) { [void][Console]::ReadLine() }
} finally {
  if ($registered -and -not [NativeHotkey]::UnregisterHotKey([IntPtr]::Zero, 1)) {
    throw "Could not release the native hotkey fixture registration."
  }
}
`;
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { windowsHide: true },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += String(chunk)));
  const closed = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Native hotkey fixture exited ${code}: ${stderr}`));
    });
  });
  // Observe failure now, even while waiting for the fixture's ready response.
  void closed.catch(() => {});
  const lines = createInterface({ input: child.stdout });
  let result: { registered: boolean; error: number };
  try {
    result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Native hotkey fixture did not become ready.")), 15_000);
      lines.once("line", (line) => {
        clearTimeout(timeout);
        try {
          resolve(JSON.parse(line));
        } catch (error) {
          reject(error);
        }
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", () => {
        clearTimeout(timeout);
        reject(new Error(`Native hotkey fixture exited before readiness: ${stderr}`));
      });
    });
  } catch (error) {
    child.kill();
    await closed.catch(() => {});
    throw error;
  }
  return {
    ...result,
    async close() {
      if (!child.stdin.destroyed) child.stdin.end();
      await closed;
      lines.close();
    },
  };
}
