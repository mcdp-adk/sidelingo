// PROTOTYPE (branch prototype/winui-look): throwaway, never merge into main.
import { useSyncExternalStore } from "react";

export const AXES = {
  reveal: ["A window hover", "B top band", "C on movement"],
  bar: ["current", "solid layer", "acrylic layer"],
  content: ["current", "winui"],
  theme: ["current", "winui"],
  links: ["streamdown modal", "open directly", "fluent dialog"],
  sample: ["off", "on"],
} as const;

export type Axis = keyof typeof AXES;
export type Prototype = Record<Axis, number>;

/** The owner's picks so far (2026-10-05): B top band, solid layer, winui content and theme. */
const PICKED: Prototype = { reveal: 1, bar: 1, content: 1, theme: 1, links: 1, sample: 1 };

const listeners = new Set<() => void>();
let snapshot = read();

function read(): Prototype {
  const params = new URLSearchParams(location.search);
  const entries = (Object.keys(AXES) as Axis[]).map((axis) => {
    const value = Number(params.get(axis) ?? PICKED[axis]);
    return [axis, Number.isInteger(value) && value >= 0 && value < AXES[axis].length ? value : PICKED[axis]];
  });
  return Object.fromEntries(entries) as Prototype;
}

export function cycle(axis: Axis, step: number) {
  const params = new URLSearchParams(location.search);
  params.set(axis, String((snapshot[axis] + step + AXES[axis].length) % AXES[axis].length));
  history.replaceState(null, "", `${location.pathname}?${params}`);
  snapshot = read();
  document.documentElement.dataset.protoTheme = snapshot.theme === 1 ? "winui" : "";
  listeners.forEach((listener) => listener());
}

document.documentElement.dataset.protoTheme = snapshot.theme === 1 ? "winui" : "";

export function usePrototype(): Prototype {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}

/** WinUI-like Fluent token values, recalled from microsoft-ui-xaml's Common_themeresources_any.xaml; verify before folding in. */
export function winuiTokens(dark: boolean) {
  return dark
    ? {
        colorNeutralForeground1: "#ffffff",
        colorNeutralForeground2: "rgba(255,255,255,0.786)",
        colorNeutralForeground3: "rgba(255,255,255,0.544)",
        colorNeutralBackground1: "rgba(255,255,255,0.061)",
        colorNeutralBackground1Hover: "rgba(255,255,255,0.084)",
        colorNeutralBackground1Pressed: "rgba(255,255,255,0.033)",
        colorNeutralStroke1: "rgba(255,255,255,0.07)",
        colorNeutralStroke2: "rgba(255,255,255,0.084)",
        colorSubtleBackgroundHover: "rgba(255,255,255,0.061)",
        colorSubtleBackgroundPressed: "rgba(255,255,255,0.042)",
      }
    : {
        colorNeutralForeground1: "rgba(0,0,0,0.896)",
        colorNeutralForeground2: "rgba(0,0,0,0.62)",
        colorNeutralForeground3: "rgba(0,0,0,0.446)",
        colorNeutralBackground1: "rgba(255,255,255,0.7)",
        colorNeutralBackground1Hover: "rgba(249,249,249,0.5)",
        colorNeutralBackground1Pressed: "rgba(249,249,249,0.3)",
        colorNeutralStroke1: "rgba(0,0,0,0.0578)",
        colorNeutralStroke2: "rgba(0,0,0,0.0803)",
        colorSubtleBackgroundHover: "rgba(0,0,0,0.0373)",
        colorSubtleBackgroundPressed: "rgba(0,0,0,0.0241)",
      };
}
