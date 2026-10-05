import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { fetch } from "@tauri-apps/plugin-http";
import "./global.css";
import { strings, uiLanguage } from "./i18n";
import { LookProvider } from "./look/LookProvider";
import { PinWindow } from "./pin-window/PinWindow";
import { SettingsWindow } from "./settings-window/SettingsWindow";
import { createSession, type Session } from "./session/session";
import { currentSettings, startSettingsStore } from "./settings/settings-store";
import { startUpdateChecks, startUpdateStatus } from "./updates/updates";

document.documentElement.lang = uiLanguage;

function App({ accent, session }: { accent: string | null; session: Session | null }) {
  return (
    <LookProvider initialAccent={accent}>{session ? <PinWindow session={session} /> : <SettingsWindow />}</LookProvider>
  );
}

const accent = await invoke<string | null>("accent_color");
await startSettingsStore();
// The Round, and so the Session, runs only in the Pin webview; the settings window has none.
const session = getCurrentWindow().label === "settings" ? null : createSession(fetch);
if (!session) await startUpdateStatus();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App accent={accent} session={session} />
  </StrictMode>,
);

if (session) {
  const hotkey = currentSettings().hotkey;
  await invoke("register_hotkey", { hotkey }).catch((reason) => {
    console.error(reason);
    void invoke("show_native_notification", {
      title: strings.hotkeyRegistrationFailed,
      body: `${hotkey}\n${String(reason)}`,
      target: "hotkey",
    }).catch((error) => console.error("Could not show hotkey registration notification:", error));
  });
  await session.start();
  await startUpdateChecks();
}
