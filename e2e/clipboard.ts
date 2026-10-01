import { runPowerShell } from "./powershell";

// Text crosses the process boundary as base64 of UTF-8, so no console code page can mangle it.

/** Another program, such as Windows' clipboard history, can hold the clipboard open; wait up to 2 s for it. */
const RETRIES = 40;
const RETRY_DELAY_MS = 50;

/** Puts text on the real Windows clipboard, as another program's copy would. */
export function writeClipboardText(text: string): void {
  runPowerShell(
    `Add-Type -AssemblyName System.Windows.Forms
$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd()))
[Windows.Forms.Clipboard]::SetDataObject($text, $true, ${RETRIES}, ${RETRY_DELAY_MS})`,
    Buffer.from(text, "utf8").toString("base64"),
  );
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
