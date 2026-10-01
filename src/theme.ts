import { useEffect, useMemo, useState } from "react";
import { createDarkTheme, createLightTheme, type BrandVariants, type Theme } from "@fluentui/react-components";

const SEGOE_UI_VARIABLE = "'Segoe UI Variable Text', ";

/** Mixes two `#rrggbb` colours, `t` of the way from `from` to `to`. */
function mix(from: string, to: string, t: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `#${[0, 1, 2]
    .map((i) => Math.round(channel(from, i) + (channel(to, i) - channel(from, i)) * t))
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Fluent's brand ramp around an accent colour, which takes Fluent's own primary slot, 80. */
function brandOf(accent: string): BrandVariants {
  const ramp: Record<number, string> = {};
  for (let shade = 10; shade <= 160; shade += 10) {
    ramp[shade] = shade < 80 ? mix(accent, "#000000", (80 - shade) / 80) : mix(accent, "#ffffff", (shade - 80) / 90);
  }
  return ramp as BrandVariants;
}

function themeOf(accent: string, dark: boolean): Theme {
  const theme = dark ? createDarkTheme(brandOf(accent)) : createLightTheme(brandOf(accent));
  return { ...theme, fontFamilyBase: SEGOE_UI_VARIABLE + theme.fontFamilyBase };
}

const darkQuery = matchMedia("(prefers-color-scheme: dark)");

/** The Windows 11 look: the system accent colour, and the system's light or dark theme as it changes. */
export function useSystemTheme(accent: string): Theme {
  const [dark, setDark] = useState(darkQuery.matches);
  useEffect(() => {
    const onChange = () => setDark(darkQuery.matches);
    darkQuery.addEventListener("change", onChange);
    return () => darkQuery.removeEventListener("change", onChange);
  }, []);
  return useMemo(() => themeOf(accent, dark), [accent, dark]);
}
