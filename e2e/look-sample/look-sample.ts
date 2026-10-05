// The look sample: the task layer's fake Provider, run standalone with fixed replies, so one desktop check can see
// every Markdown element and every Pin window state without spending tokens (docs/desktop-checklist.md → Appearance).
// A dev tool only: nothing here ships with the app. Run `pnpm look:sample [port]`, and stop it with Ctrl+C.
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import {
  FakeProvider,
  isStructuring,
  type HttpReply,
  type RecordedRequest,
  type Script,
  type Step,
} from "../support/provider.ts";

const port = Number(process.argv[2] ?? 8399);
const read = (name: string) => readFileSync(join(import.meta.dirname, name), "utf8");

// Markdown images take only http(s) sources, so the image is served beside the Provider.
const image = createServer((_, response) => {
  response.writeHead(200, { "content-type": "image/svg+xml" }).end(read("image.svg"));
});
image.listen(0, "127.0.0.1");
await once(image, "listening");
const imageUrl = `http://127.0.0.1:${(image.address() as AddressInfo).port}/image.svg`;

const kitchenSink = read("kitchen-sink.md").replace("{{imageUrl}}", imageUrl);
const cjkSample = read("cjk-sample.md");

/** Streams `text` in small chunks a few milliseconds apart, so streaming looks as it does with a real model. */
function streamed(text: string): Step[] {
  const steps: Step[] = [];
  for (let at = 0, chunk = 0; at < text.length; at += 24, chunk++) {
    steps.push({ wait: new Promise((resolve) => setTimeout(resolve, chunk * 10)) });
    steps.push({ delta: { content: text.slice(at, at + 24) } });
  }
  return steps;
}

/** The text Inputs that each make Structuring fail the way one Pin window state shows, with that state. */
const markers: Record<string, { state: string; reply: () => Step[] | HttpReply }> = {
  "sample:open-settings-error": {
    state: "an HTTP error that offers Open settings",
    reply: () => ({ status: 401, message: "Incorrect API key provided." }),
  },
  "sample:error": {
    state: "an HTTP error that doesn't",
    reply: () => ({ status: 429, message: "Rate limit reached. Try again in 20 s." }),
  },
  "sample:partial": {
    state: "a partial stream followed by an error",
    reply: () => [
      ...streamed(kitchenSink.slice(0, kitchenSink.indexOf("## Lists"))),
      { error: { message: "The model stopped generating." } },
    ],
  },
};

const reply: Script = (request: RecordedRequest) => {
  if (!isStructuring(request)) return streamed(cjkSample);
  const parts: { type: string; text?: string }[] = request.body.messages.at(-1).content;
  const text = parts.find((part) => part.type === "text")?.text;
  if (text === undefined) return [{ delta: { content: "NO_TEXT" } }];
  const marker = Object.keys(markers).find((marker) => text.includes(marker));
  return marker ? markers[marker].reply() : streamed(kitchenSink);
};

const provider = await FakeProvider.start(port);
provider.reset(reply);

console.log(`The look sample is playing the Provider at ${provider.baseUrl}

In Settings, choose the Custom Preset, set its Base URL to the address above, leave the key empty,
and choose any model from the list. Then copy:

  any other text              Structuring's Markdown kitchen sink, then Translation's CJK sample
  any image                   an image without text
${Object.entries(markers)
  .map(([marker, { state }]) => `  ${marker.padEnd(28)}${state}`)
  .join("\n")}

Press Ctrl+C to stop.`);
