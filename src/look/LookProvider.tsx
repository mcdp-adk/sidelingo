import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { FluentProvider } from "@fluentui/react-components";
import { lookVariables, winuiTheme, type Scheme } from "./winui";
import "./baseline.css";

/** Windows' default accent, for when the system's can't be read. */
const DEFAULT_ACCENT = "#0078d4";

const darkQuery = matchMedia("(prefers-color-scheme: dark)");

/** The system's light or dark theme, as it changes. */
function useScheme(): Scheme {
  const [dark, setDark] = useState(darkQuery.matches);
  useEffect(() => {
    const onChange = () => setDark(darkQuery.matches);
    darkQuery.addEventListener("change", onChange);
    return () => darkQuery.removeEventListener("change", onChange);
  }, []);
  return dark ? "dark" : "light";
}

const editable = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest("input, textarea, [contenteditable]:not([contenteditable=false])") !== null;

/** Browser shortcuts a native window doesn't have: reload, find, print, save, view source, history, navigation. */
function browserShortcut(e: KeyboardEvent): boolean {
  if (["F3", "F5", "F7", "BrowserBack", "BrowserForward", "BrowserRefresh", "BrowserSearch"].includes(e.key)) {
    return true;
  }
  if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return true;
  if (!e.ctrlKey || e.altKey) return false;
  const key = e.key.toLowerCase();
  // Developer tools stay reachable in dev builds.
  if (e.shiftKey && ["i", "j", "c"].includes(key)) return !import.meta.env.DEV;
  return ["r", "f", "g", "p", "s", "u", "j", "h", "o", "n", "t", "w"].includes(key);
}

/**
 * The one place sidelingo's look is decided: WinUI 3's values on Fluent UI, the system theme and accent, the
 * baseline every element starts from, the overlay rule, the component overrides, and the browser behaviours a
 * native window doesn't have. Everything inside renders on Mica.
 */
export function LookProvider({ accent, children }: { accent: string | null; children: ReactNode }) {
  const scheme = useScheme();
  const theme = useMemo(() => winuiTheme(accent ?? DEFAULT_ACCENT, scheme), [accent, scheme]);

  // On the root rather than the provider, so Fluent's portalled overlays see them too.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.colorScheme = scheme;
    for (const [name, value] of Object.entries(lookVariables(scheme))) root.style.setProperty(name, value);
  }, [scheme]);

  useEffect(() => {
    // No spelling squiggles under URLs, keys and model names; the attribute inherits to every field.
    document.documentElement.spellcheck = false;
    // No page menu (Back, Reload, Save as, Print); text fields keep cut, copy and paste.
    const onContextMenu = (e: MouseEvent) => {
      if (!editable(e.target)) e.preventDefault();
    };
    // Only the browser's default is prevented, at capture, so the app's own handlers still see the key:
    // the Pin window regenerates on F5 and Ctrl+R.
    const onKeyDown = (e: KeyboardEvent) => {
      if (browserShortcut(e)) e.preventDefault();
    };
    window.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  return (
    // Transparent, so the window's Mica shows through.
    <FluentProvider theme={theme} style={{ background: "transparent" }}>
      {children}
    </FluentProvider>
  );
}
