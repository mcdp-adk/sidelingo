import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";

/** Only synthetic test values are passed; the owner process environment is never changed. */
export type LaunchEnvironment = Partial<
  Record<
    | "HTTP_PROXY"
    | "HTTPS_PROXY"
    | "ALL_PROXY"
    | "NO_PROXY"
    | "OPENAI_API_KEY"
    | "OPENROUTER_API_KEY"
    | "DEEPSEEK_API_KEY"
    | "OLLAMA_API_KEY",
    string | null
  >
>;

export const driverDir = resolve(import.meta.dirname, "..", "node_modules", ".cache", "msedgedriver");
let driver: ChildProcess | undefined;
let isolated = false;

/** The driver spawns the real app, so its child environment is the application's launch environment. */
export async function startDriver(environment?: LaunchEnvironment): Promise<void> {
  const childEnvironment = { ...process.env };
  for (const [name, value] of Object.entries(environment ?? {})) {
    for (const existing of Object.keys(childEnvironment)) {
      if (existing.toLowerCase() === name.toLowerCase()) delete childEnvironment[existing];
    }
    if (value !== null) childEnvironment[name] = value;
  }
  const owned = (driver = spawn("tauri-driver", ["--native-driver", join(driverDir, "msedgedriver.exe")], {
    env: childEnvironment,
    stdio: [null, process.stdout, process.stderr],
  }));
  isolated = environment !== undefined;
  await once(owned, "spawn");
  const deadline = Date.now() + 5_000;
  while (true) {
    if (owned.exitCode !== null || owned.signalCode !== null) throw new Error("The E2E driver exited during startup");
    const socket = connect(4444, "127.0.0.1");
    try {
      await once(socket, "connect");
      return;
    } catch {
      if (Date.now() >= deadline) throw new Error("The E2E driver did not listen on its local port");
    } finally {
      socket.destroy();
    }
    await setTimeout(25);
  }
}

export async function stopDriver(): Promise<void> {
  const owned = driver;
  driver = undefined;
  isolated = false;
  if (!owned || owned.exitCode !== null || owned.signalCode !== null) return;
  const exited = once(owned, "exit");
  owned.kill();
  await exited;
}

/** Called only after ending the app session; ordinary relaunches restore inherited values. */
export async function useLaunchEnvironment(environment?: LaunchEnvironment): Promise<void> {
  if (environment === undefined && !isolated) return;
  await stopDriver();
  await startDriver(environment);
}
