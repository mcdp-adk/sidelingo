import { createServer, request, type IncomingHttpHeaders } from "node:http";
import { once } from "node:events";
import { connect, createServer as createTcpServer, type AddressInfo, type Socket } from "node:net";

/** An authenticating local HTTP forward proxy, with the actual traffic retained. */
export class HttpProxy {
  readonly requests: { method: string; url: string; headers: IncomingHttpHeaders }[] = [];
  private readonly sockets = new Set<Socket>();
  private readonly server = createServer((incoming, outgoing) => {
    this.requests.push({ method: incoming.method!, url: incoming.url!, headers: incoming.headers });
    if (
      incoming.headers["proxy-authorization"] !== `Basic ${Buffer.from("proxy-user:proxy-password").toString("base64")}`
    ) {
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

  static async start(): Promise<HttpProxy> {
    const proxy = new HttpProxy();
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

  static async start(): Promise<SocksProxy> {
    const proxy = new SocksProxy();
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
    const greeting = await readBytes(socket, 2);
    const methods = await readBytes(socket, greeting[1]);
    if (greeting[0] !== 5 || !methods.includes(2)) {
      socket.end(Buffer.from([5, 255]));
      return;
    }
    socket.write(Buffer.from([5, 2]));
    const auth = await readBytes(socket, 2);
    const username = (await readBytes(socket, auth[1])).toString();
    const passwordLength = (await readBytes(socket, 1))[0];
    const password = (await readBytes(socket, passwordLength)).toString();
    if (auth[0] !== 1 || username !== "proxy-user" || password !== "proxy-password") {
      socket.end(Buffer.from([1, 1]));
      return;
    }
    socket.write(Buffer.from([1, 0]));
    const request = await readBytes(socket, 4);
    if (request[0] !== 5 || request[1] !== 1) throw new Error("Local SOCKS fixture supports CONNECT only");
    let host: string;
    if (request[3] === 1) host = [...(await readBytes(socket, 4))].join(".");
    else if (request[3] === 3) host = (await readBytes(socket, (await readBytes(socket, 1))[0])).toString();
    else throw new Error("Local SOCKS fixture expects an IPv4 address or a domain");
    const port = (await readBytes(socket, 2)).readUInt16BE();
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

/** Accepts the TCP connection but never completes the SOCKS proxy negotiation. */
export class StalledProxy {
  connectedAt: number | null = null;
  private readonly sockets = new Set<Socket>();
  private readonly server = createTcpServer((socket) => {
    this.connectedAt = Date.now();
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
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
