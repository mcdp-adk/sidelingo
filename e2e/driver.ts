import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { connect, createServer, type AddressInfo } from "node:net";
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
  const childEnvironment = { ...process.env };
  for (const [name, value] of Object.entries({ ...(await defaultProxyEnvironment()), ...environment })) {
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
  // Killing only tauri-driver can leave its native driver holding the port during a relaunch.
  const stopped = spawn("taskkill", ["/pid", String(owned.pid), "/t", "/f"], {
    stdio: "ignore",
    windowsHide: true,
  });
  const [code] = await once(stopped, "exit");
  if (code !== 0 && owned.exitCode === null && owned.signalCode === null) {
    owned.kill();
    await exited;
    throw new Error("Could not stop the owned E2E driver process tree");
  }
  await exited;
  const deadline = Date.now() + 5_000;
  while (true) {
    // tauri-driver 2.1.0 defaults: intermediary 4444, native driver 4445.
    const listening = await Promise.all(
      [4444, 4445].map(async (port) => {
        const socket = connect(port, "127.0.0.1");
        try {
          await once(socket, "connect");
          return true;
        } catch {
          return false;
        } finally {
          socket.destroy();
        }
      }),
    );
    if (listening.every((open) => !open)) return;
    if (Date.now() >= deadline) throw new Error("The owned E2E driver ports were not released");
    await setTimeout(25);
  }
}

/** Called only after ending the app session; ordinary relaunches restore the default child environment. */
export async function useLaunchEnvironment(environment?: LaunchEnvironment): Promise<void> {
  if (environment === undefined && !isolated) return;
  await stopDriver();
  await startDriver(environment);
}
