import { createServer, type IncomingHttpHeaders } from "node:http";
import { once } from "node:events";
import { e2eConfig } from "./config";

/** The update endpoint the e2e build checks, from its own config, in place of the latest GitHub Release. */
const endpoint = new URL(e2eConfig.plugins.updater.endpoints[0]);

/** A local update endpoint that finds no newer release, recording every check. */
export class FakeUpdateEndpoint {
  readonly requests: { method: string; path: string; headers: IncomingHttpHeaders }[] = [];
  private readonly server = createServer((request, response) => {
    this.requests.push({ method: request.method!, path: request.url!, headers: request.headers });
    // The updater reads 204 No Content as "no update".
    response.writeHead(204).end();
  });

  static async start(): Promise<FakeUpdateEndpoint> {
    const fake = new FakeUpdateEndpoint();
    fake.server.listen(Number(endpoint.port), endpoint.hostname);
    await once(fake.server, "listening");
    return fake;
  }

  /** The URL the app requests, as a forward proxy sees it. */
  get url(): string {
    return endpoint.href;
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    this.server.close();
    await once(this.server, "close");
  }
}
