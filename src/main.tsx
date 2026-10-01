import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { FluentProvider } from "@fluentui/react-components";
import "./global.css";
import { uiLanguage } from "./i18n";
import { PinWindow } from "./PinWindow";
import { useSystemTheme } from "./theme";

/** Windows' default accent, for when the system's can't be read. */
const DEFAULT_ACCENT = "#0078d4";

document.documentElement.lang = uiLanguage;

function App({ accent }: { accent: string }) {
  const theme = useSystemTheme(accent);
  return (
    // Transparent, so the window's Mica shows through.
    <FluentProvider theme={theme} style={{ background: "transparent" }}>
      <PinWindow />
    </FluentProvider>
  );
}

const accent = (await invoke<string | null>("accent_color")) ?? DEFAULT_ACCENT;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App accent={accent} />
  </StrictMode>,
);
