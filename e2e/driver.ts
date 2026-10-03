import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { connect, createServer, type AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";

const providerKeyNames = ["OPENAI_API_KEY", "OPENROUTER_API_KEY", "DEEPSEEK_API_KEY", "OLLAMA_API_KEY"] as const;

/** Only synthetic test values are passed; the owner process environment is never changed. */
export type LaunchEnvironment = Partial<
  Record<(typeof providerKeyNames)[number] | "HTTP_PROXY" | "HTTPS_PROXY" | "ALL_PROXY" | "NO_PROXY", string | null>
>;

export const driverDir = resolve(import.meta.dirname, "..", "node_modules", ".cache", "msedgedriver");

interface DriverState {
  process?: ChildProcess;
  isolated: boolean;
}

// WDIO loads this file from its ESM config and again from Mocha's CJS-transformed specs.
// Those loaders have separate module caches but share the worker's globalThis.
const driverStateKey = Symbol.for("sidelingo.e2e.driver-state");
const workerGlobals = globalThis as typeof globalThis & { [driverStateKey]?: DriverState };
const driverState = (workerGlobals[driverStateKey] ??= { isolated: false });

/** Returns the process IDs currently listening on a local TCP port. */
function listeningProcessIds(port: number): number[] {
  const output = execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true });
  const processIds = new Set<number>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
    if (match && Number(match[1]) === port) processIds.add(Number(match[2]));
  }
  return [...processIds];
}

function assertPortsFree(): void {
  for (const port of [4444, 4445]) {
    const owners = listeningProcessIds(port);
    if (owners.length > 0) {
      throw new Error(`E2E port ${port} is already owned by process ${owners.join(", ")}`);
    }
  }
}

/** A real closed loopback endpoint keeps ordinary update checks off the public network. */
async function defaultProxyEnvironment(): Promise<LaunchEnvironment> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  const proxy = `http://127.0.0.1:${port}`;
  return { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, ALL_PROXY: proxy, NO_PROXY: "127.0.0.1,localhost" };
}

/** The driver spawns the real app, so its child environment is the application's launch environment. */
export async function startDriver(environment?: LaunchEnvironment): Promise<void> {
  if (driverState.process) {
    throw new Error(`The E2E driver is already owned by process ${driverState.process.pid ?? "unknown"}`);
  }
  assertPortsFree();
  const childEnvironment = { ...process.env };
  for (const name of providerKeyNames) {
    for (const existing of Object.keys(childEnvironment)) {
      if (existing.toLowerCase() === name.toLowerCase()) delete childEnvironment[existing];
    }
  }
  for (const [name, value] of Object.entries({ ...(await defaultProxyEnvironment()), ...environment })) {
    for (const existing of Object.keys(childEnvironment)) {
      if (existing.toLowerCase() === name.toLowerCase()) delete childEnvironment[existing];
    }
    if (value !== null) childEnvironment[name] = value;
  }
  const owned = (driverState.process = spawn("tauri-driver", ["--native-driver", join(driverDir, "msedgedriver.exe")], {
    env: childEnvironment,
    stdio: [null, process.stdout, process.stderr],
  }));
  driverState.isolated = environment !== undefined;
  try {
    await once(owned, "spawn");
    const deadline = Date.now() + 5_000;
    while (true) {
      if (owned.exitCode !== null || owned.signalCode !== null) {
        throw new Error("The E2E driver exited during startup");
      }
      const owners = listeningProcessIds(4444);
      if (owners.length > 0) {
        if (owners.length !== 1 || owners[0] !== owned.pid) {
          throw new Error(`E2E port 4444 is owned by unexpected process ${owners.join(", ")}`);
        }
        const socket = connect(4444, "127.0.0.1");
        try {
          await once(socket, "connect");
          return;
        } finally {
          socket.destroy();
        }
      }
      if (Date.now() >= deadline) throw new Error("The E2E driver did not listen on its local port");
      await setTimeout(25);
    }
  } catch (error) {
    if (owned.pid === undefined) {
      driverState.process = undefined;
      driverState.isolated = false;
      throw error;
    }
    try {
      await stopDriver();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "The E2E driver failed to start and could not be cleaned up");
    }
    throw error;
  }
}

export async function stopDriver(): Promise<void> {
  const owned = driverState.process;
  if (!owned) return;

  if (owned.exitCode === null && owned.signalCode === null) {
    if (owned.pid === undefined) throw new Error("The owned E2E driver has no process ID");
    const exited = once(owned, "exit");
    // Killing only tauri-driver can leave its native driver holding the port during a relaunch.
    const stopped = spawn("taskkill", ["/pid", String(owned.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    const [code] = await once(stopped, "exit");
    if (code !== 0 && owned.exitCode === null && owned.signalCode === null) {
      owned.kill();
    }
    await exited;
  }

  const deadline = Date.now() + 5_000;
  while (true) {
    const owners = [4444, 4445].flatMap((port) => listeningProcessIds(port).map((pid) => ({ port, pid })));
    if (owners.length === 0) {
      driverState.process = undefined;
      driverState.isolated = false;
      return;
    }
    if (Date.now() >= deadline) throw new Error("The owned E2E driver ports were not released");
    await setTimeout(25);
  }
}

/** Called only after ending the app session; ordinary relaunches restore the default child environment. */
export async function useLaunchEnvironment(environment?: LaunchEnvironment): Promise<void> {
  if (environment === undefined && !driverState.isolated) return;
  await stopDriver();
  await startDriver(environment);
}
