// WinUI 3's published values, mapped onto Fluent UI's tokens. Each key below is the microsoft-ui-xaml resource
// its value comes from (github.com/microsoft/microsoft-ui-xaml, controls/dev):
// - CommonStyles/Common_themeresources_any.xaml: colours;
// - HyperlinkButton_themeresources.xaml: the link's colours by state;
// - CornerRadius_themeresources.xaml: ControlCornerRadius, OverlayCornerRadius;
// - TextBlock_themeresources.xaml: the type ramp and its font;
// - ContentDialog_themeresources.xaml: the smoke behind a dialog;
// - Materials/Acrylic/AcrylicBrush_themeresources.xaml: AcrylicInAppFillColorDefault's fallback colour.
import { createDarkTheme, createLightTheme, type BrandVariants, type Theme } from "@fluentui/react-components";

export type Scheme = "dark" | "light";

/** WinUI's colours, by resource name. Text, strokes and subtle fills stay translucent: they never cover content. */
const WINUI = {
  dark: {
    TextFillColorPrimary: "#ffffff",
    TextFillColorSecondary: "rgba(255, 255, 255, 0.773)", // #C5FFFFFF
    TextFillColorTertiary: "rgba(255, 255, 255, 0.529)", // #87FFFFFF
    TextFillColorDisabled: "rgba(255, 255, 255, 0.365)", // #5DFFFFFF
    ControlStrokeColorDefault: "rgba(255, 255, 255, 0.071)", // #12FFFFFF
    ControlStrokeColorSecondary: "rgba(255, 255, 255, 0.094)", // #18FFFFFF
    ControlStrongStrokeColorDefault: "rgba(255, 255, 255, 0.545)", // #8BFFFFFF
    DividerStrokeColorDefault: "rgba(255, 255, 255, 0.082)", // #15FFFFFF
    CardStrokeColorDefault: "rgba(0, 0, 0, 0.098)", // #19000000
    CardBackgroundFillColorDefault: "rgba(255, 255, 255, 0.051)", // #0DFFFFFF
    SurfaceStrokeColorFlyout: "rgba(0, 0, 0, 0.2)", // #33000000
    SubtleFillColorSecondary: "rgba(255, 255, 255, 0.059)", // #0FFFFFFF
    SubtleFillColorTertiary: "rgba(255, 255, 255, 0.039)", // #0AFFFFFF
    FocusStrokeColorOuter: "#ffffff",
    FocusStrokeColorInner: "rgba(0, 0, 0, 0.702)", // #B3000000
    SmokeFillColorDefault: "rgba(0, 0, 0, 0.302)", // #4D000000
    SystemFillColorCaution: "#fce100",
    SystemFillColorCautionBackground: "#433519",
    SystemFillColorCritical: "#ff99a4",
    SystemFillColorCriticalBackground: "#442726",
    SystemFillColorSuccess: "#6ccb5f",
    SystemFillColorSuccessBackground: "#393d1b",
  },
  light: {
    TextFillColorPrimary: "rgba(0, 0, 0, 0.894)", // #E4000000
    TextFillColorSecondary: "rgba(0, 0, 0, 0.62)", // #9E000000
    TextFillColorTertiary: "rgba(0, 0, 0, 0.447)", // #72000000
    TextFillColorDisabled: "rgba(0, 0, 0, 0.361)", // #5C000000
    ControlStrokeColorDefault: "rgba(0, 0, 0, 0.059)", // #0F000000
    ControlStrokeColorSecondary: "rgba(0, 0, 0, 0.161)", // #29000000
    ControlStrongStrokeColorDefault: "rgba(0, 0, 0, 0.447)", // #72000000
    DividerStrokeColorDefault: "rgba(0, 0, 0, 0.059)", // #0F000000
    CardStrokeColorDefault: "rgba(0, 0, 0, 0.059)", // #0F000000
    CardBackgroundFillColorDefault: "rgba(255, 255, 255, 0.702)", // #B3FFFFFF
    SurfaceStrokeColorFlyout: "rgba(0, 0, 0, 0.059)", // #0F000000
    SubtleFillColorSecondary: "rgba(0, 0, 0, 0.035)", // #09000000
    SubtleFillColorTertiary: "rgba(0, 0, 0, 0.024)", // #06000000
    FocusStrokeColorOuter: "rgba(0, 0, 0, 0.894)", // #E4000000
    FocusStrokeColorInner: "rgba(255, 255, 255, 0.702)", // #B3FFFFFF
    SmokeFillColorDefault: "rgba(0, 0, 0, 0.302)", // #4D000000
    SystemFillColorCaution: "#9d5d00",
    SystemFillColorCautionBackground: "#fff4ce",
    SystemFillColorCritical: "#c42b1c",
    SystemFillColorCriticalBackground: "#fde7e9",
    SystemFillColorSuccess: "#0f7b0f",
    SystemFillColorSuccessBackground: "#dff6dd",
  },
};

/**
 * The opaque surfaces. WinUI draws controls with translucent fills over the window's base; these are what those
 * fills composite to over it, so an opaque control looks the same and nothing that floats ever shows what it covers.
 */
const SURFACES = {
  dark: {
    // SolidBackgroundFillColorBase.
    base: "#202020",
    // AcrylicInAppFillColorDefault's fallback; ControlFillColorDefault #0FFFFFFF over the base.
    raised: "#2c2c2c",
    // ControlFillColorSecondary #15FFFFFF over the base.
    raisedHover: "#323232",
    // ControlFillColorTertiary #08FFFFFF over the base.
    raisedPressed: "#272727",
  },
  light: {
    // SolidBackgroundFillColorBase.
    base: "#f3f3f3",
    // AcrylicInAppFillColorDefault's fallback; ControlFillColorDefault #B3FFFFFF over the base.
    raised: "#f9f9f9",
    // ControlFillColorSecondary #80F9F9F9 over the base.
    raisedHover: "#f6f6f6",
    // ControlFillColorTertiary #4DF9F9F9 over the base.
    raisedPressed: "#f5f5f5",
  },
};

/** The roles Fluent has no token for, as CSS custom properties on the document root; read only inside the module. */
export function lookVariables(scheme: Scheme): Record<string, string> {
  const winui = WINUI[scheme];
  return {
    "--look-raised": SURFACES[scheme].raised,
    "--look-flyout-stroke": winui.SurfaceStrokeColorFlyout,
    "--look-smoke": winui.SmokeFillColorDefault,
    "--look-card": winui.CardBackgroundFillColorDefault,
    "--look-card-stroke": winui.CardStrokeColorDefault,
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

/** Fluent's brand ramp around the system accent (SystemAccentColor), which takes Fluent's own primary slot, 80. */
function brandOf(accent: string): BrandVariants {
  const ramp: Record<number, string> = {};
  for (let shade = 10; shade <= 160; shade += 10) {
    ramp[shade] = shade < 80 ? mix(accent, "#000000", (80 - shade) / 80) : mix(accent, "#ffffff", (shade - 80) / 90);
  }
  return ramp as BrandVariants;
}

/** Fluent's theme carrying WinUI's values: the one place each WinUI role is mapped onto the Fluent token that draws it. */
export function winuiTheme(accent: string, scheme: Scheme): Theme {
  const brand = brandOf(accent);
  const base = scheme === "dark" ? createDarkTheme(brand) : createLightTheme(brand);
  const winui = WINUI[scheme];
  const surface = SURFACES[scheme];
  // SystemAccentColorLight1-3 and Dark1-3 are read only as the accent itself, so the ramp's steps stand in for them:
  // 110/120/130 for Light1-3 and 70/60/50 for Dark1-3.
  const accentText =
    scheme === "dark"
      ? // AccentTextFillColorPrimary, Secondary and Tertiary are Light3, Light3 and Light2 in dark,
        { primary: brand[130], secondary: brand[130], tertiary: brand[120] }
      : // and Dark2, Dark3 and Dark1 in light.
        { primary: brand[60], secondary: brand[50], tertiary: brand[70] };
  return {
    ...base,

    // TextBlock_themeresources.xaml: XamlAutoFontFamily, which is Segoe UI Variable on Windows 11. WinUI names no
    // monospace; Cascadia Mono is Windows 11's own code font, and naming it keeps the browser's (SimSun) out.
    fontFamilyBase: "'Segoe UI Variable Text', 'Segoe UI', " + base.fontFamilyBase,
    fontFamilyMonospace: "'Cascadia Mono', Consolas, " + base.fontFamilyMonospace,

    // CornerRadius_themeresources.xaml: ControlCornerRadius 4, OverlayCornerRadius 8.
    borderRadiusMedium: "4px",
    borderRadiusLarge: "8px",
    borderRadiusXLarge: "8px",

    // TextFillColor*.
    colorNeutralForeground1: winui.TextFillColorPrimary,
    colorNeutralForeground1Hover: winui.TextFillColorPrimary,
    colorNeutralForeground1Pressed: winui.TextFillColorPrimary,
    colorNeutralForeground1Selected: winui.TextFillColorPrimary,
    colorNeutralForeground2: winui.TextFillColorSecondary,
    colorNeutralForeground2Hover: winui.TextFillColorPrimary,
    colorNeutralForeground2Pressed: winui.TextFillColorPrimary,
    colorNeutralForeground2Selected: winui.TextFillColorPrimary,
    colorNeutralForeground3: winui.TextFillColorTertiary,
    colorNeutralForeground4: winui.TextFillColorTertiary,
    colorNeutralForegroundDisabled: winui.TextFillColorDisabled,

    // HyperlinkButton_themeresources.xaml: AccentTextFillColorPrimary at rest, Secondary on hover, Tertiary pressed.
    colorBrandForegroundLink: accentText.primary,
    colorBrandForegroundLinkHover: accentText.secondary,
    colorBrandForegroundLinkPressed: accentText.tertiary,
    colorBrandForegroundLinkSelected: accentText.primary,

    // The opaque surfaces: every Fluent background a control or overlay draws on.
    colorNeutralBackground1: surface.raised,
    colorNeutralBackground1Hover: surface.raisedHover,
    colorNeutralBackground1Pressed: surface.raisedPressed,
    colorNeutralBackground1Selected: surface.raisedHover,
    colorNeutralBackground2: surface.raised,
    colorNeutralBackground2Hover: surface.raisedHover,
    colorNeutralBackground2Pressed: surface.raisedPressed,
    colorNeutralBackground2Selected: surface.raisedHover,
    colorNeutralBackground3: surface.base,
    colorNeutralBackground3Hover: surface.raisedHover,
    colorNeutralBackground3Pressed: surface.raisedPressed,
    colorNeutralBackground3Selected: surface.raisedHover,
    colorNeutralBackground4: surface.base,
    colorNeutralBackground4Hover: surface.raisedHover,
    colorNeutralBackground4Pressed: surface.raisedPressed,
    colorNeutralBackground4Selected: surface.raisedHover,
    colorNeutralBackground5: surface.base,
    colorNeutralBackground5Hover: surface.raisedHover,
    colorNeutralBackground5Pressed: surface.raisedPressed,
    colorNeutralBackground5Selected: surface.raisedHover,
    colorNeutralBackground6: surface.base,
    colorNeutralBackgroundAlpha: surface.raised,
    colorNeutralBackgroundAlpha2: surface.raised,

    // SubtleFillColor*: hover and pressed fills for subtle controls, drawn on an opaque surface.
    colorSubtleBackgroundHover: winui.SubtleFillColorSecondary,
    colorSubtleBackgroundPressed: winui.SubtleFillColorTertiary,
    colorSubtleBackgroundSelected: winui.SubtleFillColorSecondary,

    // ControlStrokeColorSecondary for controls, ControlStrongStrokeColorDefault for a field's bottom edge and
    // a checkbox's frame, DividerStrokeColorDefault for dividers.
    colorNeutralStroke1: winui.ControlStrokeColorSecondary,
    colorNeutralStroke1Hover: winui.ControlStrokeColorSecondary,
    colorNeutralStroke1Pressed: winui.ControlStrokeColorSecondary,
    colorNeutralStroke1Selected: winui.ControlStrokeColorSecondary,
    colorNeutralStrokeAccessible: winui.ControlStrongStrokeColorDefault,
    colorNeutralStroke2: winui.DividerStrokeColorDefault,
    colorNeutralStroke3: winui.DividerStrokeColorDefault,
    colorNeutralStrokeSubtle: winui.DividerStrokeColorDefault,

    // FocusStrokeColorOuter and FocusStrokeColorInner: Fluent draws Focus2 outside Focus1.
    colorStrokeFocus1: winui.FocusStrokeColorInner,
    colorStrokeFocus2: winui.FocusStrokeColorOuter,

    // SystemFillColorCaution, Critical and Success, and their backgrounds.
    colorStatusWarningForeground1: winui.SystemFillColorCaution,
    colorStatusWarningForeground3: winui.SystemFillColorCaution,
    colorStatusWarningBorder2: winui.SystemFillColorCaution,
    colorStatusWarningBackground1: winui.SystemFillColorCautionBackground,
    colorStatusDangerForeground1: winui.SystemFillColorCritical,
    colorStatusDangerForeground3: winui.SystemFillColorCritical,
    colorStatusDangerBackground1: winui.SystemFillColorCriticalBackground,
    colorStatusSuccessForeground1: winui.SystemFillColorSuccess,
    colorStatusSuccessForeground3: winui.SystemFillColorSuccess,
    colorStatusSuccessBackground1: winui.SystemFillColorSuccessBackground,
  };
}
