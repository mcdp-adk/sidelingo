// PROTOTYPE (branch prototype/winui-look): the look module's entry, to be folded into main once reviewed.
import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { FluentProvider } from "@fluentui/react-components";
import { lookVariables, winuiTheme, type Scheme } from "./winui";
import "./baseline.css";

const darkQuery = matchMedia("(prefers-color-scheme: dark)");

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
  target instanceof Element && target.closest("input, textarea, [contenteditable=true]") !== null;

/** Browser shortcuts a native window doesn't have: reload, find, print, save, view source, history, navigation. */
function browserShortcut(e: KeyboardEvent): boolean {
  const key = e.key.toLowerCase();
  if (e.key === "F5" || e.key === "F3" || e.key === "F7") return true;
  if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return true;
  if (e.key === "BrowserBack" || e.key === "BrowserForward" || e.key === "BrowserRefresh") return true;
  if (!e.ctrlKey || e.altKey) return false;
  if (["r", "f", "g", "p", "s", "u", "j", "h", "o", "n", "t", "w"].includes(key)) return true;
  // Developer tools stay reachable while developing.
  if (!import.meta.env.DEV && e.shiftKey && ["i", "j", "c"].includes(key)) return true;
  return false;
}

/**
 * The one place sidelingo's look is decided: WinUI 3 values on Fluent UI, the system theme and accent,
 * the baseline every element starts from, and the browser behaviours a native window doesn't have.
 * Everything inside renders on Mica; nothing else in the app sets a colour, radius, shadow or font.
 */
export function LookProvider({ accent, children }: { accent: string; children: ReactNode }) {
  const scheme = useScheme();
  const theme = useMemo(() => winuiTheme(accent, scheme), [accent, scheme]);

  // On the root, not the provider, so Fluent's portalled overlays see them too.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.colorScheme = scheme;
    for (const [name, value] of Object.entries(lookVariables(scheme))) root.style.setProperty(name, value);
  }, [scheme]);

  useEffect(() => {
    // No spelling squiggles under URLs, keys and model names; the attribute inherits to every field.
    document.documentElement.spellcheck = false;
    // A page menu (Back, Reload, Save as, Print) has no place here; text fields keep cut, copy and paste.
    const onContextMenu = (e: MouseEvent) => {
      if (!editable(e.target)) e.preventDefault();
    };
    // Capture runs first, so the app's own handlers for the same keys (Ctrl+R regenerates) still see them.
    const onKeyDown = (e: KeyboardEvent) => {
      if (browserShortcut(e)) e.preventDefault();
    };
    document.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  return (
    <FluentProvider
      theme={theme}
      // Transparent, so the window's Mica shows through.
      style={{ background: "transparent" }}
    >
      {children}
    </FluentProvider>
  );
}
