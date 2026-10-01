import { execFileSync } from "node:child_process";

/** Quotes a value as a PowerShell single-quoted string literal. */
export function psString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** Runs a Windows PowerShell script in a single-threaded apartment, as the clipboard requires. */
export function runPowerShell(script: string, input = ""): string {
  return execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-STA",
      "-EncodedCommand",
      // Progress records would reach the test log as CLIXML.
      Buffer.from(`$ProgressPreference = 'SilentlyContinue'\n${script}`, "utf16le").toString("base64"),
    ],
    { input, encoding: "utf8" },
  );
}
