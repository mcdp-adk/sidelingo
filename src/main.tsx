import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { fetch } from "@tauri-apps/plugin-http";
import { FluentProvider } from "@fluentui/react-components";
import "./global.css";
import { strings, uiLanguage } from "./i18n";
import { PinWindow } from "./pin-window/PinWindow";
import { SettingsWindow } from "./settings-window/SettingsWindow";
import { createSession, type Session } from "./session/session";
import { currentSettings, startSettingsStore } from "./settings/settings-store";
import { useSystemTheme } from "./theme";
import { startUpdateChecks, startUpdateStatus } from "./updates/updates";

/** Windows' default accent, for when the system's can't be read. */
const DEFAULT_ACCENT = "#0078d4";

document.documentElement.lang = uiLanguage;
const isSettingsWindow = getCurrentWindow().label === "settings";

function App({ accent, session }: { accent: string; session: Session | null }) {
  const theme = useSystemTheme(accent);
  return (
    // Transparent, so the window's Mica shows through.
    <FluentProvider theme={theme} style={{ background: "transparent" }}>
      {session ? <PinWindow session={session} /> : <SettingsWindow />}
    </FluentProvider>
  );
}

const accent = (await invoke<string | null>("accent_color")) ?? DEFAULT_ACCENT;
await startSettingsStore();
if (isSettingsWindow) await startUpdateStatus();
// The Round, and so the Session, runs only in the Pin webview.
const session = isSettingsWindow ? null : createSession(fetch);

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
