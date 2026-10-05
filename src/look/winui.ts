// PROTOTYPE (branch prototype/winui-look): the look module's token layer, to be folded into main once reviewed.
// Values come from microsoft-ui-xaml (controls/dev): CommonStyles/Common_themeresources_any.xaml,
// CornerRadius_themeresources.xaml, TextBlock_themeresources.xaml and Materials/Acrylic/AcrylicBrush_themeresources.xaml.
import { createDarkTheme, createLightTheme, type BrandVariants, type Theme } from "@fluentui/react-components";

/** The opaque colours a WinUI control or flyout ends up as over Mica; translucent WinUI fills composited once here. */
const SURFACES = {
  dark: {
    // SolidBackgroundFillColorBase: the window's own base, used where something must hide what is under it.
    base: "#202020",
    // AcrylicInAppFillColorDefault's fallback, and ControlFillColorDefault #0FFFFFFF over the base.
    raised: "#2c2c2c",
    // ControlFillColorSecondary #15FFFFFF over the base.
    raisedHover: "#323232",
    // ControlFillColorTertiary #08FFFFFF over the base.
    raisedPressed: "#272727",
  },
  light: {
    base: "#f3f3f3",
    raised: "#f9f9f9",
    raisedHover: "#f6f6f6",
    raisedPressed: "#f5f5f5",
  },
};

/** Strokes and text stay translucent: a hairline or a glyph never hides content. */
const INK = {
  dark: {
    textPrimary: "#ffffff",
    textSecondary: "rgba(255, 255, 255, 0.773)", // #C5FFFFFF
    textTertiary: "rgba(255, 255, 255, 0.529)", // #87FFFFFF
    textDisabled: "rgba(255, 255, 255, 0.365)", // #5DFFFFFF
    controlStroke: "rgba(255, 255, 255, 0.071)", // ControlStrokeColorDefault #12FFFFFF
    controlStrokeStrong: "rgba(255, 255, 255, 0.094)", // ControlStrokeColorSecondary #18FFFFFF
    divider: "rgba(255, 255, 255, 0.082)", // DividerStrokeColorDefault #15FFFFFF
    flyoutStroke: "rgba(0, 0, 0, 0.2)", // SurfaceStrokeColorFlyout #33000000
    cardFill: "rgba(255, 255, 255, 0.051)", // CardBackgroundFillColorDefault #0DFFFFFF
    subtleHover: "rgba(255, 255, 255, 0.059)", // SubtleFillColorSecondary #0FFFFFFF
    subtlePressed: "rgba(255, 255, 255, 0.039)", // SubtleFillColorTertiary #0AFFFFFF
    focusOuter: "#ffffff", // FocusStrokeColorOuter
    focusInner: "rgba(0, 0, 0, 0.702)", // FocusStrokeColorInner #B3000000
    caution: "#fce100",
    cautionBackground: "#433519",
    critical: "#ff99a4",
    criticalBackground: "#442726",
    success: "#6ccb5f",
    successBackground: "#393d1b",
  },
  light: {
    textPrimary: "rgba(0, 0, 0, 0.894)", // #E4000000
    textSecondary: "rgba(0, 0, 0, 0.62)", // #9E000000
    textTertiary: "rgba(0, 0, 0, 0.447)", // #72000000
    textDisabled: "rgba(0, 0, 0, 0.361)", // #5C000000
    controlStroke: "rgba(0, 0, 0, 0.059)", // #0F000000
    controlStrokeStrong: "rgba(0, 0, 0, 0.161)", // #29000000
    divider: "rgba(0, 0, 0, 0.059)", // #0F000000
    flyoutStroke: "rgba(0, 0, 0, 0.059)", // #0F000000
    cardFill: "rgba(255, 255, 255, 0.702)", // #B3FFFFFF
    subtleHover: "rgba(0, 0, 0, 0.035)", // #09000000
    subtlePressed: "rgba(0, 0, 0, 0.024)", // #06000000
    focusOuter: "rgba(0, 0, 0, 0.894)",
    focusInner: "rgba(255, 255, 255, 0.702)",
    caution: "#9d5d00",
    cautionBackground: "#fff4ce",
    critical: "#c42b1c",
    criticalBackground: "#fde7e9",
    success: "#0f7b0f",
    successBackground: "#dff6dd",
  },
};

export type Scheme = "dark" | "light";

/** CSS custom properties the baseline and Markdown styles read; the only colours outside Fluent's tokens. */
export function lookVariables(scheme: Scheme): Record<string, string> {
  const s = SURFACES[scheme];
  const i = INK[scheme];
  return {
    "--look-base": s.base,
    "--look-raised": s.raised,
    "--look-card": i.cardFill,
    "--look-card-stroke": i.controlStroke,
    "--look-divider": i.divider,
    "--look-flyout-stroke": i.flyoutStroke,
    "--look-text-secondary": i.textSecondary,
    "--look-subtle-hover": i.subtleHover,
    "--look-mark": i.cautionBackground,
  };
}

/** Mixes two `#rrggbb` colours, `t` of the way from `from` to `to`. */
function mix(from: string, to: string, t: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `#${[0, 1, 2]
    .map((i) => Math.round(channel(from, i) + (channel(to, i) - channel(from, i)) * t))
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Fluent's brand ramp around the system accent, which takes Fluent's own primary slot, 80. */
function brandOf(accent: string): BrandVariants {
  const ramp: Record<number, string> = {};
  for (let shade = 10; shade <= 160; shade += 10) {
    ramp[shade] = shade < 80 ? mix(accent, "#000000", (80 - shade) / 80) : mix(accent, "#ffffff", (shade - 80) / 90);
  }
  return ramp as BrandVariants;
}

/** Fluent's theme with WinUI's values: one place maps every WinUI role onto the Fluent token that carries it. */
export function winuiTheme(accent: string, scheme: Scheme): Theme {
  const brand = brandOf(accent);
  const base = scheme === "dark" ? createDarkTheme(brand) : createLightTheme(brand);
  const s = SURFACES[scheme];
  const i = INK[scheme];
  // AccentTextFillColorPrimary is SystemAccentColorLight3 in dark and SystemAccentColorDark2 in light.
  const link = scheme === "dark" ? brand[130] : brand[60];
  const linkHover = scheme === "dark" ? brand[120] : brand[70];
  return {
    ...base,
    fontFamilyBase: "'Segoe UI Variable Text', 'Segoe UI', " + base.fontFamilyBase,
    fontFamilyMonospace: "'Cascadia Mono', Consolas, " + base.fontFamilyMonospace,
    // ControlCornerRadius 4 for controls; OverlayCornerRadius 8 for flyouts, dialogs and cards.
    borderRadiusSmall: "2px",
    borderRadiusMedium: "4px",
    borderRadiusLarge: "8px",
    borderRadiusXLarge: "8px",
    // Text.
    colorNeutralForeground1: i.textPrimary,
    colorNeutralForeground1Hover: i.textPrimary,
    colorNeutralForeground1Pressed: i.textPrimary,
    colorNeutralForeground2: i.textSecondary,
    colorNeutralForeground2Hover: i.textPrimary,
    colorNeutralForeground2Pressed: i.textPrimary,
    colorNeutralForeground3: i.textTertiary,
    colorNeutralForeground4: i.textTertiary,
    colorNeutralForegroundDisabled: i.textDisabled,
    colorBrandForegroundLink: link,
    colorBrandForegroundLinkHover: linkHover,
    colorBrandForegroundLinkPressed: link,
    // Surfaces: every Fluent background a control or overlay draws on is opaque.
    colorNeutralBackground1: s.raised,
    colorNeutralBackground1Hover: s.raisedHover,
    colorNeutralBackground1Pressed: s.raisedPressed,
    colorNeutralBackground1Selected: s.raisedHover,
    colorNeutralBackground2: s.raised,
    colorNeutralBackground3: s.base,
    colorNeutralBackground4: s.base,
    colorNeutralBackgroundAlpha: s.raised,
    colorNeutralBackgroundAlpha2: s.raised,
    // Subtle fills sit on an opaque surface, so they may stay translucent.
    colorSubtleBackgroundHover: i.subtleHover,
    colorSubtleBackgroundPressed: i.subtlePressed,
    colorSubtleBackgroundSelected: i.subtleHover,
    // Strokes.
    colorNeutralStroke1: i.controlStrokeStrong,
    colorNeutralStroke1Hover: i.controlStrokeStrong,
    colorNeutralStroke1Pressed: i.controlStrokeStrong,
    colorNeutralStroke2: i.divider,
    colorNeutralStroke3: i.divider,
    colorNeutralStrokeSubtle: i.divider,
    // Focus: WinUI's two-tone ring.
    colorStrokeFocus1: i.focusInner,
    colorStrokeFocus2: i.focusOuter,
    // Status.
    colorStatusWarningBorder2: i.caution,
    colorStatusWarningForeground1: i.caution,
    colorStatusWarningBackground1: i.cautionBackground,
    colorStatusDangerForeground1: i.critical,
    colorStatusDangerBackground1: i.criticalBackground,
    colorStatusSuccessForeground1: i.success,
    colorStatusSuccessBackground1: i.successBackground,
  };
}
