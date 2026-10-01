import { runPowerShell } from "./powershell";

// Text crosses the process boundary as base64 of UTF-8, so no console code page can mangle it.

/** Puts text on the real Windows clipboard, as another program's copy would. */
export function writeClipboardText(text: string): void {
  runPowerShell(
    `Add-Type -AssemblyName System.Windows.Forms
$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd()))
[Windows.Forms.Clipboard]::SetDataObject($text, $true, 10, 50)`,
    Buffer.from(text, "utf8").toString("base64"),
  );
}

/** Reads the real Windows clipboard's text, or "" when it holds none. */
export function readClipboardText(): string {
  const base64 = runPowerShell(
    `Add-Type -AssemblyName System.Windows.Forms
[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([Windows.Forms.Clipboard]::GetText())))`,
  );
  return Buffer.from(base64, "base64").toString("utf8");
}
