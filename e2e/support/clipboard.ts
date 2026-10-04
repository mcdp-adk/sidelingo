import { spawn } from "node:child_process";
import { once } from "node:events";
import { psString, runPowerShell } from "./powershell";

// Text crosses the process boundary as base64 of UTF-8, so no console code page can mangle it.

/** Another program, such as Windows' clipboard history, can hold the clipboard open; wait up to 2 s for it. */
const RETRIES = 40;
const RETRY_DELAY_MS = 50;

const nativeClipboardWriter = `using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class SidelingoClipboardWriter {
  private const uint CF_UNICODETEXT = 13;
  private const uint GMEM_MOVEABLE = 0x0002;
  private const uint GMEM_ZEROINIT = 0x0040;
  [DllImport("user32.dll", SetLastError = true)] private static extern bool OpenClipboard(IntPtr owner);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateWindowExW(uint exStyle, string className, string windowName, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
  [DllImport("user32.dll", SetLastError = true)] private static extern bool DestroyWindow(IntPtr window);
  [DllImport("user32.dll", SetLastError = true)] private static extern bool EmptyClipboard();
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern uint RegisterClipboardFormatW(string format);
  [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetClipboardData(uint format, IntPtr memory);
  [DllImport("user32.dll", SetLastError = true)] private static extern bool CloseClipboard();
  [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr GlobalAlloc(uint flags, UIntPtr bytes);
  [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr GlobalLock(IntPtr memory);
  [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GlobalUnlock(IntPtr memory);
  [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr GlobalFree(IntPtr memory);
  [DllImport("kernel32.dll", EntryPoint = "GetModuleHandleW", SetLastError = true)] private static extern IntPtr GetModuleHandle(IntPtr moduleName);
  private static IntPtr ownerWindow;

  private static IntPtr OwnerWindow() {
    if (ownerWindow == IntPtr.Zero) {
      ownerWindow = CreateWindowExW(0, "STATIC", "sidelingo-e2e-clipboard-owner", 0, 0, 0, 0, 0, IntPtr.Zero, IntPtr.Zero, GetModuleHandle(IntPtr.Zero), IntPtr.Zero);
      if (ownerWindow == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    return ownerWindow;
  }

  private static void Put(uint format, byte[] bytes) {
    IntPtr memory = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, new UIntPtr((uint)bytes.Length));
    if (memory == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
    IntPtr target = GlobalLock(memory);
    if (target == IntPtr.Zero) {
      int error = Marshal.GetLastWin32Error();
      GlobalFree(memory);
      throw new Win32Exception(error);
    }
    Marshal.Copy(bytes, 0, target, bytes.Length);
    GlobalUnlock(memory);
    if (SetClipboardData(format, memory) == IntPtr.Zero) {
      int error = Marshal.GetLastWin32Error();
      GlobalFree(memory);
      throw new Win32Exception(error);
    }
  }

  private static void OpenWithRetry() {
    for (int attempt = 0; !OpenClipboard(OwnerWindow()); attempt++) {
      if (attempt >= ${RETRIES}) throw new Win32Exception(Marshal.GetLastWin32Error());
      Thread.Sleep(${RETRY_DELAY_MS});
    }
  }

  public static void Write(string text, string marker, uint historyValue) {
    OpenWithRetry();
    try {
      if (!EmptyClipboard()) throw new Win32Exception(Marshal.GetLastWin32Error());
      Put(CF_UNICODETEXT, Encoding.Unicode.GetBytes(text + "\\0"));
      if (!String.IsNullOrEmpty(marker)) {
        uint markerFormat = RegisterClipboardFormatW(marker);
        if (markerFormat == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
        byte[] markerData = marker == "CanIncludeInClipboardHistory" ? BitConverter.GetBytes(historyValue) : new byte[] { 1 };
        Put(markerFormat, markerData);
      }
    } finally {
      CloseClipboard();
    }
  }

  public static void WriteBitmap(byte[] dib, uint format, string text) {
    OpenWithRetry();
    try {
      if (!EmptyClipboard()) throw new Win32Exception(Marshal.GetLastWin32Error());
      Put(format, dib);
      if (text != null) Put(CF_UNICODETEXT, Encoding.Unicode.GetBytes(text + "\\0"));
    } finally {
      CloseClipboard();
    }
  }

  public static void WriteTextAndHold(string text, int durationMs) {
    OpenWithRetry();
    try {
      if (!EmptyClipboard()) throw new Win32Exception(Marshal.GetLastWin32Error());
      Put(CF_UNICODETEXT, Encoding.Unicode.GetBytes(text + "\\0"));
    } finally {
      CloseClipboard();
    }
    OpenWithRetry();
    try {
      Console.Out.WriteLine("clipboard-held");
      Console.Out.Flush();
      Thread.Sleep(durationMs);
    } finally {
      CloseClipboard();
    }
  }

  public static void DestroyOwnerWindow() {
    if (ownerWindow != IntPtr.Zero) {
      DestroyWindow(ownerWindow);
      ownerWindow = IntPtr.Zero;
    }
  }
}`;

function withNativeClipboardWriter(script: string): string {
  return `$ErrorActionPreference = 'Stop'\nAdd-Type @'\n${nativeClipboardWriter}\n'@\ntry {\n${script}\n} finally { [SidelingoClipboardWriter]::DestroyOwnerWindow() }`;
}

/** Puts text on the real Windows clipboard, as another program's copy would. */
export function writeClipboardText(text: string): void {
  runPowerShell(
    withNativeClipboardWriter(`
$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd()))
[SidelingoClipboardWriter]::Write($text, $null, 0)`),
    Buffer.from(text, "utf8").toString("base64"),
  );
}

/** A synthetic packed DIB: red at its top-left, blue at its bottom-right. */
export function writeClipboardBitmap(
  width: number,
  height: number,
  { format = "dib", text, noise = false }: { format?: "dib" | "dibv5"; text?: string; noise?: boolean } = {},
): void {
  const v5 = format === "dibv5";
  const headerSize = v5 ? 124 : 40;
  const channels = v5 ? 4 : 3;
  const stride = Math.ceil((width * channels) / 4) * 4;
  const dib = Buffer.alloc(headerSize + stride * height);
  dib.writeUInt32LE(headerSize, 0);
  dib.writeInt32LE(width, 4);
  dib.writeInt32LE(height, 8);
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(channels * 8, 14);
  dib.writeUInt32LE(v5 ? 3 : 0, 16);
  dib.writeUInt32LE(stride * height, 20);
  if (v5) {
    dib.writeUInt32LE(0x00ff0000, 40);
    dib.writeUInt32LE(0x0000ff00, 44);
    dib.writeUInt32LE(0x000000ff, 48);
    dib.writeUInt32LE(0xff000000, 52);
    dib.writeUInt32LE(0x73524742, 56); // LCS_sRGB
  }
  let random = 42;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = headerSize + (height - 1 - y) * stride + x * channels;
      for (let channel = 0; channel < 3; channel++) {
        random ^= random << 13;
        random ^= random >>> 17;
        random ^= random << 5;
        dib[offset + channel] = noise ? random & 255 : channel === (y < height / 2 ? 2 : 0) ? 255 : 0;
      }
      if (v5) dib[offset + 3] = 255;
    }
  }
  // Keep independent color/orientation checks possible even for the noisy payload fixture.
  dib.set([0, 0, 255], headerSize + (height - 1) * stride);
  dib.set([255, 0, 0], headerSize + (width - 1) * channels);
  const script = withNativeClipboardWriter(
    `$dib = [Convert]::FromBase64String([Console]::In.ReadToEnd())\n[SidelingoClipboardWriter]::WriteBitmap($dib, ${v5 ? 17 : 8}, ${text === undefined ? "$null" : psString(text)})`,
  );
  runPowerShell(script, dib.toString("base64"));
}

/** Decodes the received PNG through Windows' image library, independently of the app's codec. */
export function inspectPng(base64: string): { width: number; height: number; topLeft: string; bottomRight: string } {
  return JSON.parse(
    runPowerShell(
      `Add-Type -AssemblyName System.Drawing
$bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd())
$stream = New-Object IO.MemoryStream(,$bytes)
$image = [Drawing.Bitmap]::FromStream($stream)
try {
  @{ width = $image.Width; height = $image.Height; topLeft = $image.GetPixel(0, 0).Name; bottomRight = $image.GetPixel($image.Width - 1, $image.Height - 1).Name } | ConvertTo-Json -Compress
} finally { $image.Dispose(); $stream.Dispose() }`,
      base64,
    ),
  );
}

/** Puts text and a private-content marker on the real Windows clipboard. */
export function writeClipboardTextWithMarker(marker: string, historyValue: 0 | 1 = 0): void {
  const script = withNativeClipboardWriter(
    `$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd()))
[SidelingoClipboardWriter]::Write($text, ${psString(marker)}, [uint32]${historyValue})`,
  );
  runPowerShell(script, Buffer.from(`private copy ${marker}`, "utf8").toString("base64"));
}

/** Puts one non-text clipboard format on the real Windows clipboard. */
function writeClipboardFormat(format: string, value: string): void {
  runPowerShell(
    `Add-Type -AssemblyName System.Windows.Forms
$value = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd()))
$data = New-Object Windows.Forms.DataObject
$data.SetData(${psString(format)}, $false, $value)
[Windows.Forms.Clipboard]::SetDataObject($data, $true, ${RETRIES}, ${RETRY_DELAY_MS})`,
    Buffer.from(value, "utf8").toString("base64"),
  );
}

/** Puts HTML without Unicode text on the real Windows clipboard. */
export function writeClipboardHtml(): void {
  writeClipboardFormat("HTML Format", "<html><body>HTML only</body></html>");
}

/** Puts RTF without Unicode text on the real Windows clipboard. */
export function writeClipboardRtf(): void {
  writeClipboardFormat("Rich Text Format", "{\\rtf1 RTF only}");
}

/** Puts a file list without text on the real Windows clipboard. */
export function writeClipboardFiles(): void {
  runPowerShell(`Add-Type -AssemblyName System.Windows.Forms
$data = New-Object Windows.Forms.DataObject
$files = New-Object Collections.Specialized.StringCollection
$files.Add([IO.Path]::Combine($PSHOME, 'powershell.exe'))
$data.SetFileDropList($files)
[Windows.Forms.Clipboard]::SetDataObject($data, $true, ${RETRIES}, ${RETRY_DELAY_MS})`);
}

/** Writes a copy then immediately holds the real Windows clipboard open in that process. */
export function writeClipboardTextAndHold(
  text: string,
  durationMs: number,
): { ready: Promise<void>; finished: Promise<void> } {
  if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
    throw new RangeError("Clipboard hold duration must be a non-negative integer.");
  }
  const script = withNativeClipboardWriter(
    `$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd()))
[SidelingoClipboardWriter]::WriteTextAndHold($text, ${durationMs})`,
  );
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", encoded], {
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: true,
  });
  child.stdin?.end(Buffer.from(text, "utf8").toString("base64"));

  let isReady = false;
  let output = "";
  const ready = new Promise<void>((resolve, reject) => {
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.includes("clipboard-held")) {
        isReady = true;
        resolve();
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!isReady) reject(new Error(`Clipboard holder exited before opening it (code ${code}).`));
    });
  });
  const finished = once(child, "exit").then(([code]) => {
    if (code !== 0) throw new Error(`Clipboard holder failed with exit code ${code}.`);
  });
  return { ready, finished };
}

/** Empties the real Windows clipboard, so it holds nothing to show. */
export function clearClipboard(): void {
  runPowerShell(`Add-Type -AssemblyName System.Windows.Forms
for ($attempt = 1; ; $attempt++) {
  try { [Windows.Forms.Clipboard]::Clear(); break }
  catch { if ($attempt -ge ${RETRIES}) { throw }; Start-Sleep -Milliseconds ${RETRY_DELAY_MS} }
}`);
}

/** Reads the real Windows clipboard's text, or "" when it holds none. */
export function readClipboardText(): string {
  const base64 = runPowerShell(
    `Add-Type -AssemblyName System.Windows.Forms
[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([Windows.Forms.Clipboard]::GetText())))`,
  );
  return Buffer.from(base64, "base64").toString("utf8");
}
