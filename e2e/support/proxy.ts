import { createServer, request, type ClientRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { once } from "node:events";
import { lookup } from "node:dns/promises";
import { connect, createServer as createTcpServer, isIP, type AddressInfo, type Socket } from "node:net";
import { getProxyForUrl } from "proxy-from-env";
import type { Duplex } from "node:stream";

/** The username and password a proxy requires. */
export interface ProxyCredentials {
  username: string;
  password: string;
}

const defaultCredentials: ProxyCredentials = { username: "proxy-user", password: "proxy-password" };

/** The `Proxy-Authorization` value that carries `credentials`. */
export function basicAuthorization({ username, password }: ProxyCredentials): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

/** Opens an opaque GitHub TLS tunnel through the runner's configured egress. */
function connectUpdater(
  downstream: Duplex,
  pending: Set<ClientRequest>,
  track: (socket: Socket) => void,
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    let upstream: Socket | undefined;
    let outgoing: ClientRequest | undefined;
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      if (outgoing) pending.delete(outgoing);
      downstream.off("close", cancel);
      outgoing?.destroy();
      upstream?.destroy();
      reject(new Error("Local updater upstream connection failed"));
    };
    const cancel = () => {
      outgoing?.destroy();
      upstream?.destroy();
      fail();
    };
    const ready = (socket: Socket, head = Buffer.alloc(0)) => {
      if (settled || downstream.destroyed) {
        socket.destroy();
        fail();
        return;
      }
      upstream = socket;
      settled = true;
      if (outgoing) pending.delete(outgoing);
      outgoing = undefined;
      track(socket);
      socket.on("error", () => downstream.destroy());
      socket.on("close", () => downstream.destroy());
      socket.pause();
      if (head.length) socket.unshift(head);
      resolve(socket);
    };
    downstream.once("close", cancel);
    if (downstream.destroyed) {
      fail();
      return;
    }
    try {
      const selected = getProxyForUrl("https://github.com:443");
      if (!selected) {
        upstream = connect(443, "github.com");
        upstream.once("error", fail);
        upstream.once("close", fail);
        upstream.once("connect", () => ready(upstream!));
        return;
      }
      const proxy = new URL(selected);
      if (proxy.protocol !== "http:" && proxy.protocol !== "https:") {
        fail();
        return;
      }
      const headers: Record<string, string> = { Host: "github.com:443" };
      if (proxy.username || proxy.password) {
        const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
        headers["Proxy-Authorization"] = `Basic ${Buffer.from(credentials).toString("base64")}`;
        proxy.username = "";
        proxy.password = "";
      }
      const proxyHost = proxy.hostname.replace(/^\[|\]$/g, "");
      outgoing = (proxy.protocol === "https:" ? httpsRequest : request)(proxy, {
        method: "CONNECT",
        path: "github.com:443",
        headers,
        agent: false,
        ...(proxy.protocol === "https:" ? { servername: isIP(proxyHost) ? "" : proxyHost } : {}),
      });
      pending.add(outgoing);
      outgoing.once("error", fail);
      outgoing.once("close", fail);
      outgoing.once("connect", (response, socket, head) => {
        if (response.statusCode !== 200) {
          socket.destroy();
          fail();
          return;
        }
        ready(socket, head);
      });
      outgoing.once("response", (response) => {
        response.destroy();
        fail();
      });
      outgoing.end();
    } catch {
      fail();
    }
  });
}

/** A credential-required CONNECT tunnel to the real updater host, without TLS interception. */
export class UpdaterProxy {
  readonly attempts: { authenticated: boolean; destinationMatches: boolean }[] = [];
  upstreamConnected = false;
  upstreamBytesReceived = false;
  private readonly sockets = new Set<Socket>();
  private readonly pending = new Set<ClientRequest>();
  private readonly server = createServer((_request, response) => response.writeHead(405).end());

  private constructor(username: string, password: string) {
    const expected = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    this.server.on("connection", (socket) => this.track(socket));
    this.server.on("connect", (request, socket, head) => {
      const authenticated = request.headers["proxy-authorization"] === expected;
      const destinationMatches = request.url === "github.com:443";
      this.attempts.push({ authenticated, destinationMatches });
      if (!authenticated || !destinationMatches) {
        socket.end("HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n");
        return;
      }
      socket.on("error", () => socket.destroy());
      void connectUpdater(socket, this.pending, (upstream) => this.track(upstream))
        .then((upstream) => {
          this.upstreamConnected = true;
          upstream.on("data", () => (this.upstreamBytesReceived = true));
          socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length) upstream.write(head);
          socket.pipe(upstream);
          upstream.pipe(socket);
        })
        .catch(() => socket.destroy());
    });
  }

  static async start(username: string, password: string): Promise<UpdaterProxy> {
    const proxy = new UpdaterProxy(username, password);
    proxy.server.listen(0, "127.0.0.1");
    await once(proxy.server, "listening");
    return proxy;
  }

  get url(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  private track(socket: Socket): void {
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
  }

  async close(): Promise<void> {
    for (const request of this.pending) request.destroy();
    for (const socket of this.sockets) socket.destroy();
    this.server.close();
    await once(this.server, "close");
  }
}

/** An authenticating local HTTP forward proxy, with the actual traffic retained. */
export class HttpProxy {
  readonly requests: { method: string; url: string; headers: IncomingHttpHeaders }[] = [];
  private readonly sockets = new Set<Socket>();
  private readonly server = createServer((incoming, outgoing) => {
    this.requests.push({ method: incoming.method!, url: incoming.url!, headers: incoming.headers });
    if (incoming.headers["proxy-authorization"] !== basicAuthorization(this.credentials)) {
      outgoing.writeHead(407, { "proxy-authenticate": "Basic realm=local-test" });
      outgoing.end("Proxy credentials required");
      return;
    }
    const headers = { ...incoming.headers };
    delete headers["proxy-authorization"];
    const upstream = request(incoming.url!, { method: incoming.method, headers }, (response) => {
      outgoing.writeHead(response.statusCode!, response.headers);
      response.pipe(outgoing);
    });
    upstream.on("error", () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end("Local upstream unavailable");
    });
    outgoing.on("close", () => upstream.destroy());
    incoming.pipe(upstream);
  });

  private constructor(private readonly credentials: ProxyCredentials) {}

  static async start(credentials = defaultCredentials): Promise<HttpProxy> {
    const proxy = new HttpProxy(credentials);
    proxy.server.on("connection", (socket) => {
      proxy.sockets.add(socket);
      socket.on("close", () => proxy.sockets.delete(socket));
    });
    proxy.server.listen(0, "127.0.0.1");
    await once(proxy.server, "listening");
    return proxy;
  }

  get url(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.server.close();
    await once(this.server, "close");
  }
}

/** RFC1928 CONNECT with mandatory RFC1929 username/password authentication. */
export class SocksProxy {
  readonly connections: { username: string; password: string; host: string; port: number }[] = [];
  private readonly sockets = new Set<Socket>();
  private readonly server = createTcpServer((socket) => {
    this.track(socket);
    void this.forward(socket).catch(() => socket.destroy());
  });

  private constructor(private readonly credentials: ProxyCredentials) {}

  static async start(credentials = defaultCredentials): Promise<SocksProxy> {
    const proxy = new SocksProxy(credentials);
    proxy.server.listen(0, "127.0.0.1");
    await once(proxy.server, "listening");
    return proxy;
  }

  get url(): string {
    return `socks5://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  private track(socket: Socket): void {
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
  }

  private async forward(socket: Socket): Promise<void> {
    const request = await socksRequest(socket, this.credentials.username, this.credentials.password);
    if (!request) return;
    const { username, password, host, port } = request;
    const upstream = connect(port, host);
    this.track(upstream);
    socket.once("close", () => upstream.destroy());
    upstream.once("close", () => socket.destroy());
    await once(upstream, "connect");
    this.connections.push({ username, password, host, port });
    socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
    socket.pipe(upstream);
    upstream.pipe(socket);
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.server.close();
    await once(this.server, "close");
  }
}

/** A real authenticated SOCKS5 tunnel restricted to the updater's GitHub host. */
export class UpdaterSocksProxy {
  connected = false;
  authenticated = false;
  destinationMatches = false;
  upstreamConnected = false;
  upstreamBytesReceived = false;
  private readonly sockets = new Set<Socket>();
  private readonly pending = new Set<ClientRequest>();
  private readonly server;

  private constructor(username: string, password: string, addresses: string[]) {
    this.server = createTcpServer((socket) => {
      this.connected = true;
      this.track(socket);
      socket.on("error", () => socket.destroy());
      void this.forward(socket, username, password, addresses).catch(() => socket.destroy());
    });
  }

  static async start(username: string, password: string): Promise<UpdaterSocksProxy> {
    const addresses = (await lookup("github.com", { all: true })).map(({ address }) => address);
    const proxy = new UpdaterSocksProxy(username, password, addresses);
    proxy.server.listen(0, "127.0.0.1");
    await once(proxy.server, "listening");
    return proxy;
  }

  get url(): string {
    return `socks5://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  private track(socket: Socket): void {
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
  }

  private async forward(socket: Socket, username: string, password: string, addresses: string[]): Promise<void> {
    const request = await socksRequest(socket, username, password);
    if (!request) return;
    this.authenticated = true;
    this.destinationMatches =
      request.port === 443 && (request.host === "github.com" || addresses.includes(request.host));
    if (!this.destinationMatches) {
      socket.end(Buffer.from([5, 2, 0, 1, 127, 0, 0, 1, 0, 0]));
      return;
    }
    const upstream = await connectUpdater(socket, this.pending, (upstream) => this.track(upstream));
    this.upstreamConnected = true;
    upstream.on("data", () => (this.upstreamBytesReceived = true));
    socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
    socket.pipe(upstream);
    upstream.pipe(socket);
  }

  async close(): Promise<void> {
    for (const request of this.pending) request.destroy();
    for (const socket of this.sockets) socket.destroy();
    this.server.close();
    await once(this.server, "close");
  }
}

async function socksRequest(socket: Socket, expectedUsername: string, expectedPassword: string) {
  const greeting = await readBytes(socket, 2);
  const methods = await readBytes(socket, greeting[1]);
  if (greeting[0] !== 5 || !methods.includes(2)) {
    socket.end(Buffer.from([5, 255]));
    return null;
  }
  socket.write(Buffer.from([5, 2]));
  const auth = await readBytes(socket, 2);
  const username = (await readBytes(socket, auth[1])).toString();
  const passwordLength = (await readBytes(socket, 1))[0];
  const password = (await readBytes(socket, passwordLength)).toString();
  if (auth[0] !== 1 || username !== expectedUsername || password !== expectedPassword) {
    socket.end(Buffer.from([1, 1]));
    return null;
  }
  socket.write(Buffer.from([1, 0]));
  const request = await readBytes(socket, 4);
  if (request[0] !== 5 || request[1] !== 1) throw new Error("Local SOCKS fixture supports CONNECT only");
  let host: string;
  if (request[3] === 1) host = [...(await readBytes(socket, 4))].join(".");
  else if (request[3] === 3) host = (await readBytes(socket, (await readBytes(socket, 1))[0])).toString();
  else if (request[3] === 4) {
    const address = await readBytes(socket, 16);
    const ipv6 = Array.from({ length: 8 }, (_, index) => address.readUInt16BE(index * 2).toString(16)).join(":");
    host = new URL(`http://[${ipv6}]`).hostname.slice(1, -1);
  } else throw new Error("Local SOCKS fixture expects an IP address or a domain");
  const port = (await readBytes(socket, 2)).readUInt16BE();
  return { username, password, host, port };
}

/** Accepts the TCP connection but never replies to proxy negotiation. */
export class StalledProxy {
  connectedAt: number | null = null;
  closedConnections = 0;
  private readonly sockets = new Set<Socket>();
  private readonly server = createTcpServer((socket) => {
    this.connectedAt = Date.now();
    this.sockets.add(socket);
    // Discard negotiation bytes so a peer's timeout/close remains observable.
    socket.resume();
    socket.on("close", () => {
      this.sockets.delete(socket);
      ++this.closedConnections;
    });
  });

  static async start(): Promise<StalledProxy> {
    const proxy = new StalledProxy();
    proxy.server.listen(0, "127.0.0.1");
    await once(proxy.server, "listening");
    return proxy;
  }

  get url(): string {
    return `socks5://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.server.close();
    await once(this.server, "close");
  }
}

async function readBytes(socket: Socket, length: number): Promise<Buffer> {
  if (length === 0) return Buffer.alloc(0);
  while (true) {
    const bytes = socket.read(length) as Buffer | null;
    if (bytes) return bytes;
    if (socket.destroyed || socket.readableEnded) throw new Error("Local SOCKS connection closed");
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        socket.off("readable", ready);
        socket.off("close", closed);
        socket.off("error", closed);
      };
      const ready = () => {
        cleanup();
        resolve();
      };
      const closed = () => {
        cleanup();
        reject(new Error("Local SOCKS connection closed"));
      };
      socket.once("readable", ready);
      socket.once("close", closed);
      socket.once("error", closed);
    });
  }
}
