# sidelingo look

PROTOTYPE (branch `prototype/winui-look`): the design under review. Once approved it folds into `main` with the module.

sidelingo should look like a Windows 11 app built with WinUI 3. It is built on Fluent UI React v9, which looks like Fluent 2 on the web, so this module maps WinUI's values onto Fluent. Values come from [microsoft-ui-xaml](https://github.com/microsoft/microsoft-ui-xaml/tree/main/controls/dev): `CommonStyles/Common_themeresources_any.xaml`, `CornerRadius_themeresources.xaml`, `TextBlock_themeresources.xaml`, `ContentDialog_themeresources.xaml`, and `Materials/Acrylic/AcrylicBrush_themeresources.xaml`.

## The rule

Every visual decision lives in `src/look/`: colour, transparency, corner radius, stroke, shadow, font, type size, focus ring, selection, scrollbar, and the browser behaviours a native window doesn't have. Other components use Fluent controls and `look`'s interface, and their own styles cover layout only: size, gap, padding, position. They may name Fluent tokens, never literal colours, radii, shadows or fonts.

Inside the module, in order of preference:

1. what Windows or WebView2 already provides;
2. a Fluent token carrying WinUI's value;
3. a per-component override, listed in `baseline.css` § 3 and nowhere else.

## Interface

| Piece | Callers | What it hides |
| --- | --- | --- |
| `<LookProvider accent>` | `main.tsx`, around both windows | system light/dark and accent; WinUI → Fluent token map; element baseline; overlay rule; component overrides; context menu, browser shortcuts, spellcheck |
| `<Markdown text muted?>` | the Pin window, for Source and Translated text | Streamdown and its configuration; one style for every Markdown element; code blocks, tables, task marks and links drawn with Fluent |
| `webview_defaults(builder)` | both Rust window builders | WebView2's Fluent overlay scrollbar; autofill off |

## Layers

| Layer | What | Fill | Boundary |
| --- | --- | --- | --- |
| Window | both windows' backgrounds | Mica (transparent page) | the window frame |
| Page | text, MessageBars, controls placed on the page | controls opaque: `#2C2C2C` dark, `#F9F9F9` light | control stroke |
| Card | code blocks | CardBackgroundFillColorDefault (translucent: only Mica is under it) | card stroke, 8 px corners |
| Overlay | Pin toolbar, menus, dropdown lists, tooltips, dialogs | opaque: toolbar on the base (`#202020` / `#F3F3F3`), the rest raised (`#2C2C2C` / `#F9F9F9`) | flyout stroke and Fluent's shadow; the toolbar a divider |
| Smoke | behind a dialog | `rgba(0,0,0,0.3)` | — |

Only the window layer is transparent. A WinUI control's translucent fill over Mica composites to almost exactly the opaque values above (ControlFillColorDefault `#0FFFFFFF` over `#202020` ≈ `#2D2D2D`), so making them opaque costs nothing visible and means nothing that floats can ever show what is under it. Strokes, subtle hover fills and text stay translucent: they never cover content.

## Colour

| Role | Dark | Light | WinUI resource |
| --- | --- | --- | --- |
| Text primary | `#FFFFFF` | `#E4000000` | TextFillColorPrimary |
| Text secondary | `#C5FFFFFF` | `#9E000000` | TextFillColorSecondary |
| Text tertiary | `#87FFFFFF` | `#72000000` | TextFillColorTertiary |
| Text disabled | `#5DFFFFFF` | `#5C000000` | TextFillColorDisabled |
| Link | accent Light3 | accent Dark2 | AccentTextFillColorPrimary |
| Accent | system accent | system accent | SystemAccentColor |
| Control stroke | `#18FFFFFF` | `#29000000` | ControlStrokeColorSecondary |
| Divider | `#15FFFFFF` | `#0F000000` | DividerStrokeColorDefault |
| Flyout stroke | `#33000000` | `#0F000000` | SurfaceStrokeColorFlyout |
| Caution / critical / success | `#FCE100` / `#FF99A4` / `#6CCB5F` | `#9D5D00` / `#C42B1C` / `#0F7B0F` | SystemFillColor* |
| Selection | accent fill, white text | accent fill, white text | text selection highlight |

## Shape

| Thing | Radius | WinUI resource |
| --- | --- | --- |
| Controls (buttons, fields, chips, inline code) | 4 px | ControlCornerRadius |
| Overlays (menus, lists, tooltips, dialogs) and cards | 8 px | OverlayCornerRadius |
| Pills (selected tab marker) | full | — |

Strokes are 1 px. Shadows are Fluent's per component (tooltip, flyout, dialog), which follow the same depth order as WinUI's.

## Type

UI text: Segoe UI Variable Text. Monospace: Cascadia Mono, then Consolas, everywhere code, keys or paths appear; never the browser's monospace, which is SimSun on Chinese Windows.

| Style | Size / line | Weight | Used for |
| --- | --- | --- | --- |
| Caption | 12 / 16 | regular | footnotes, code |
| Body | 14 / 20 | regular | everything by default |
| BodyStrong | 14 / 20 | semibold | Markdown h3–h6, table headers, selected tab |
| BodyLarge | 18 / 24 | semibold | Markdown h2 |
| Subtitle | 20 / 28 | semibold | Markdown h1, settings sections |
| Title | 28 / 36 | semibold | settings page title |

Buttons and tabs are regular weight, as in WinUI; Fluent 2's semibold buttons are overridden.

## Space

A 4 px grid, using Fluent's spacing tokens.

| Where | Value |
| --- | --- |
| Pin content padding | 12 vertical, 16 horizontal |
| Settings page padding | 24 |
| Settings: title to first section, between sections | 24, 32 |
| Settings: between fields in a section | 16 |
| Markdown: between blocks | 12 |
| Markdown: above / below a heading | 20 / 8 |
| Markdown: list indent, between items | 20, 4 |
| Table cells | 8 vertical, 16 between columns, first column on the text edge |
| Code block padding | 8 vertical, 12 left, 40 right (room for the copy button) |

## Icons

Fluent System Icons (`@fluentui/react-icons`), the web counterpart of Segoe Fluent Icons. Regular style by default; 16 px in small buttons, 20 px in medium ones, as Fluent sizes them. A toggled-on state is shown by the button's fill, as WinUI's ToggleButton does, not by swapping to a filled icon.

## States and focus

Hover, pressed, selected and disabled come from the token map. Focus uses WinUI's focus colours (FocusStrokeColorOuter, FocusStrokeColorInner): Fluent controls draw their own ring in those tokens, and anything else focusable, such as the Pin window's panes, gets the two-tone ring from the baseline. Fluent's motion durations and curves stay as they are.

## Markdown

| Element | Treatment |
| --- | --- |
| h1 / h2 / h3–h6 | Subtitle / BodyLarge / BodyStrong; h5–h6 secondary colour |
| Paragraph, soft and hard breaks | Body, 12 below |
| Bold, italic, strikethrough | semibold; italic; strikethrough in tertiary colour |
| Inline code, `<kbd>` | mono 12 on a subtle 4 px chip; kbd adds a control stroke |
| Link, autolink | Fluent Link in the link colour, underline on hover, URL in a tooltip; opens in the default browser |
| Lists, nested lists | 20 indent, 4 between items, tertiary markers |
| Task list | Fluent checkbox icons, read-only |
| Quote, nested quote | 3 px stroke on the left, secondary colour |
| Code block | card, mono 12/20, scrolls inside itself up to 400 px, one Fluent copy button; no line numbers, download or language bar |
| Table | no frame; semibold secondary header; dividers between rows; scrolls sideways inside itself; no copy or download |
| Horizontal rule | divider, 16 above and below |
| Footnotes | Caption, secondary, after a divider |
| `<mark>`, `<sub>`, `<sup>`, `<details>` | caution-background highlight; small; small; BodyStrong summary |
| Image | fits the pane, 4 px corners, no download control |
| Mermaid | shown as a code block |

## Browser behaviours removed

| Behaviour | How |
| --- | --- |
| Classic scrollbars with arrows and a track | WebView2 Fluent overlay scrollbar, as in Edge (Runtime ≥ 125.0.2535.41) |
| Page context menu (Back, Reload, Save as, Print, Inspect) | suppressed except in text fields, which keep cut, copy and paste; the Pin window keeps its own Copy selection menu |
| Reload, find, print, save, view source, history, Alt+arrow navigation | suppressed; developer tools stay in dev builds |
| Spelling squiggles under URLs, keys and model names | `spellcheck=false` on the document |
| Autofill suggestions under text fields | WebView2 general autofill off |
| Edge's own password reveal button | hidden; SecretField has its own |
| Browser select popups (white in dark mode) | no native `<select>`; Fluent Dropdown everywhere |
| Browser monospace (SimSun) | monospace token everywhere |
| Browser focus ring | Fluent's ring |
| Browser text selection colour | accent |
| Streamdown's link-safety modal, code and table chrome | replaced by Fluent pieces in `<Markdown>` |

## Decided in review

- Clicking a link opens it in the default browser at once, as WinUI's Hyperlink does; the URL shows on hover. A confirming Fluent dialog was tried and dropped (2026-10-05).
