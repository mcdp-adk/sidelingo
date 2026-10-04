import { relaunch } from "../support/app";
import { clearClipboard, writeClipboardText } from "../support/clipboard";
import { StalledProxy } from "../support/proxy";
import { openSettings, expectShownOption } from "../support/settings";

describe("Provider keys", () => {
  it("shows the named launch key source without exposing its value", async () => {
    const incompleteOpenAI = {
      schemaVersion: 1,
      automaticUpdates: false,
      activePreset: "openai",
      presets: { openai: { model: "" } },
    };
    // Task 10 (e2e/tasks/keys.e2e.ts) owns the "set" and "unset" cases; this one checks that the harness
    // keeps the worker's own launch key out of the app.
    const cases = [
      {
        name: "inherited",
        environment: {},
        workerEnvironment: { OPENAI_API_KEY: "synthetic-inherited-launch-key" },
        placeholder: "No key; environment variable changes take effect after restart.",
      },
    ];

    for (const item of cases) {
      const proxy = await StalledProxy.start();
      const previousOpenAIKey = process.env.OPENAI_API_KEY;
      try {
        Object.assign(process.env, item.workerEnvironment);
        clearClipboard();
        await relaunch({
          settings: {
            ...incompleteOpenAI,
            proxy: { mode: "manual", url: proxy.url },
          },
          environment: item.environment,
        });
        await expect($("body")).toHaveText("Copy text or an image to see it here.", { containing: true });
        expect(proxy.connectedAt).toBeNull();

        writeClipboardText(`OpenAI placeholder ${item.name} ${Date.now()}`);
        await $("button[aria-label='Regenerate (Ctrl+R / F5)']").waitForEnabled();
        await expect($("[role=group]")).toHaveText("Enter a model", { containing: true });
        expect(proxy.connectedAt).toBeNull();

        await openSettings();
        await expectShownOption($("select[aria-label='Preset']"), "OpenAI");
        const key = $("input[aria-label='Key']");
        await expect(key).toHaveValue("");
        await expect(key).toHaveAttribute("placeholder", item.placeholder);
        expect(proxy.connectedAt).toBeNull();
      } finally {
        if (previousOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = previousOpenAIKey;
        await proxy.close();
      }
    }
  });
});
