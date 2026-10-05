# sidelingo look

sidelingo should look like a Windows 11 app built with WinUI 3. It is built on Fluent UI React v9, which looks like Fluent 2 on the web, so this module maps WinUI's values onto Fluent's tokens (ADR 0007). Values come from [microsoft-ui-xaml](https://github.com/microsoft/microsoft-ui-xaml/tree/main/controls/dev): `CommonStyles/Common_themeresources_any.xaml`, `CornerRadius_themeresources.xaml`, `TextBlock_themeresources.xaml`, `HyperlinkButton_themeresources.xaml`, `ContentDialog_themeresources.xaml` and `Materials/Acrylic/AcrylicBrush_themeresources.xaml`. `winui.ts` cites the resource behind each value.

## The rule

Every visual decision lives in `src/look/` (and its native half, `src-tauri/src/look.rs`): colour, transparency, corner radius, stroke, shadow, font, type size, focus ring, selection, scrollbar, and the browser behaviours a native window doesn't have. Other components use Fluent controls and this module's interface. Their own styles cover layout only: size, gap, padding, position. They may name Fluent tokens, never literal colours, radii, shadows or fonts.

Inside the module, in order of preference:

1. what Windows or WebView2 already provides;
2. a Fluent token carrying WinUI's value (`winui.ts`);
3. a per-component override, listed in `baseline.css` § 3 and nowhere else. An entry is added only when no token reaches the difference.

## Interface

| Piece | Callers | What it hides |
| --- | --- | --- |
| `<LookProvider accent>` | `main.tsx`, around both windows | system light/dark and accent; the WinUI → Fluent token map; the element baseline; the overlay rule; the component overrides; the context menu, browser shortcuts and spellcheck |
| `<Markdown text muted>` | the Pin window, for Source and Translated text | Streamdown and its configuration; one style for every Markdown element; code blocks, tables, task marks and links drawn with Fluent. No other component imports Streamdown |
| `webview_defaults(builder)` | both Rust window builders | WebView2's Fluent overlay scrollbar; autofill off. Both windows must agree, because WebView2 fixes the scrollbar style per environment |

| File | Holds |
| --- | --- |
| `LookProvider.tsx` | the theme, the root variables, and the browser behaviours |
| `winui.ts` | WinUI's values by resource name, the opaque surfaces, and the token map |
| `baseline.css` | the element baseline (§ 1), the overlay rule (§ 2) and the component overrides (§ 3) |
| `Markdown.tsx` | Streamdown's configuration and the pieces that replace its web chrome: code block, table, task mark, link, image |
| `markdown.css` | the style of every Markdown element |

## Layers

| Layer | What | Fill | Boundary |
| --- | --- | --- | --- |
| Window | both windows' backgrounds | Mica (the page is transparent) | the window frame |
| Page | text, MessageBars, controls placed on the page | controls opaque, raised: `#2C2C2C` dark, `#F9F9F9` light | control stroke |
| Card | code blocks | CardBackgroundFillColorDefault (translucent: only Mica is under it) | card stroke, 8 px corners |
| Toolbar | the Pin window's toolbar, over the results | opaque on the base: `#202020` dark, `#F3F3F3` light | a divider below, no blur |
| Overlay | menus, dropdown lists, tooltips, dialogs | opaque, raised | flyout stroke, 8 px corners, Fluent's shadow |
| Smoke | behind a dialog | SmokeFillColorDefault, `#4D000000` | — |

Only the window layer is transparent. Fluent draws controls and popover surfaces from one family of background tokens (`colorNeutralBackground1` and its siblings), so a translucent control fill makes every overlay translucent too. The token map therefore sets every Fluent background a control or overlay draws on to an opaque value: what WinUI's translucent fill composites to over the window's base.

| Role | Dark | Light | From |
| --- | --- | --- | --- |
| base (window base, toolbar) | `#202020` | `#F3F3F3` | SolidBackgroundFillColorBase |
| raised (controls, overlays) | `#2C2C2C` | `#F9F9F9` | AcrylicInAppFillColorDefault fallback; ControlFillColorDefault over base |
| raised hover | `#323232` | `#F6F6F6` | ControlFillColorSecondary over base |
| raised pressed | `#272727` | `#F5F5F5` | ControlFillColorTertiary over base |

Strokes, subtle hover fills and text stay translucent: they never cover content.

## Colour

| Role | Dark | Light | WinUI resource | Fluent token |
| --- | --- | --- | --- | --- |
| Text primary | `#FFFFFF` | `#E4000000` | TextFillColorPrimary | `colorNeutralForeground1` |
| Text secondary | `#C5FFFFFF` | `#9E000000` | TextFillColorSecondary | `colorNeutralForeground2` |
| Text tertiary | `#87FFFFFF` | `#72000000` | TextFillColorTertiary | `colorNeutralForeground3`, `4` |
| Text disabled | `#5DFFFFFF` | `#5C000000` | TextFillColorDisabled | `colorNeutralForegroundDisabled` |
| Link | accent Light3 | accent Dark2 | AccentTextFillColorPrimary | `colorBrandForegroundLink` |
| Accent | system accent | system accent | SystemAccentColor | the brand ramp, accent at 80 |
| Control stroke | `#18FFFFFF` | `#29000000` | ControlStrokeColorSecondary | `colorNeutralStroke1` |
| Field and checkbox edge | `#8BFFFFFF` | `#72000000` | ControlStrongStrokeColorDefault | `colorNeutralStrokeAccessible` |
| Divider | `#15FFFFFF` | `#0F000000` | DividerStrokeColorDefault | `colorNeutralStroke2`, `3`, `Subtle` |
| Card fill | `#0DFFFFFF` | `#B3FFFFFF` | CardBackgroundFillColorDefault | `--look-card` |
| Card stroke | `#19000000` | `#0F000000` | CardStrokeColorDefault | `--look-card-stroke` |
| Flyout stroke | `#33000000` | `#0F000000` | SurfaceStrokeColorFlyout | `--look-flyout-stroke` |
| Subtle hover / pressed | `#0FFFFFFF` / `#0AFFFFFF` | `#09000000` / `#06000000` | SubtleFillColorSecondary / Tertiary | `colorSubtleBackgroundHover` / `Pressed` |
| Focus outer / inner | `#FFFFFF` / `#B3000000` | `#E4000000` / `#B3FFFFFF` | FocusStrokeColorOuter / Inner | `colorStrokeFocus2` / `1` |
| Caution | `#FCE100` on `#433519` | `#9D5D00` on `#FFF4CE` | SystemFillColorCaution(Background) | `colorStatusWarning*` |
| Critical | `#FF99A4` on `#442726` | `#C42B1C` on `#FDE7E9` | SystemFillColorCritical(Background) | `colorStatusDanger*` |
| Success | `#6CCB5F` on `#393D1B` | `#0F7B0F` on `#DFF6DD` | SystemFillColorSuccess(Background) | `colorStatusSuccess*` |
| Selection | accent fill, on-brand text | accent fill, on-brand text | text selection highlight | `::selection` in the baseline |

Windows gives sidelingo only the accent itself, not its Light1–3 and Dark1–3 variants, so the brand ramp's steps stand in for them: 110/120/130 for Light1–3 and 70/60/50 for Dark1–3. A link is AccentTextFillColorPrimary at rest, Secondary on hover and Tertiary pressed, as HyperlinkButton is.

## Shape

| Thing | Radius | WinUI resource | Fluent token |
| --- | --- | --- | --- |
| Controls (buttons, fields, chips, inline code, images) | 4 px | ControlCornerRadius | `borderRadiusMedium` |
| Overlays (menus, lists, tooltips, dialogs) and cards | 8 px | OverlayCornerRadius | `borderRadiusLarge`, `XLarge` |
| Pills (the selected tab's marker) | full | — | `borderRadiusCircular` |

Strokes are 1 px. Shadows are Fluent's per component (tooltip, flyout, dialog), which follow the same depth order as WinUI's.

## Type

UI text is Segoe UI Variable Text, WinUI's XamlAutoFontFamily on Windows 11. Monospace is Cascadia Mono, then Consolas, wherever code, keys or paths appear; never the browser's monospace, which is SimSun on Chinese Windows.

Fluent's type ramp already matches WinUI's sizes (TextBlock_themeresources.xaml), so components use Fluent's `Text` presets and typography tokens.

| WinUI style | Size / line | Weight | Fluent | Used for |
| --- | --- | --- | --- | --- |
| Caption | 12 / 16 | regular | `Caption1` | footnotes |
| Body | 14 / 20 | regular | `Body1` | everything by default |
| BodyStrong | 14 / 20 | semibold | `Body1Strong` | Markdown h3–h6, table headers, the selected tab |
| BodyLarge | 18 / 24 | semibold | none: Fluent's ramp has no 18, so `markdown.css` names it | Markdown h2 |
| Subtitle | 20 / 28 | semibold | `Subtitle1` | Markdown h1, Settings section headings |
| Title | 28 / 36 | semibold | `Title2` | the Settings page title |

Code is mono 12/20. Buttons and tabs are regular weight, as in WinUI; Fluent 2's semibold buttons are overridden.

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
| Markdown: around a horizontal rule | 16 above and below |
| Table cells | 8 vertical, 16 between columns, first column on the text edge |
| Code block padding | 8 vertical, 12 left, 40 right (room for the copy button) |

## Icons

Fluent System Icons (`@fluentui/react-icons`), the web counterpart of Segoe Fluent Icons. Regular style by default; 16 px in small buttons, 20 px in medium ones, as Fluent sizes them. A toggled-on state is shown by the button's fill, as WinUI's ToggleButton does, not by swapping to a filled icon.

## States and focus

Hover, pressed, selected and disabled come from the token map. Focus uses WinUI's focus colours (FocusStrokeColorOuter, FocusStrokeColorInner): Fluent controls draw their own ring in those tokens, and anything else focusable, such as the Pin window's panes, gets the two-tone ring from the baseline, drawn inside so a pane that fills the window still shows it. Fluent's motion durations and curves stay as they are.

## Overlays

One treatment for every Fluent surface that floats over content, listed in `baseline.css` § 2: the menu popover, popover surface, listbox, tooltip and dialog surface. Each is the raised fill with a SurfaceStrokeColorFlyout outline and 8 px corners, over Fluent's shadow. A dialog has SmokeFillColorDefault behind it.

## Component overrides

The whole list, in `baseline.css` § 3:

| Component | Fluent 2 | WinUI |
| --- | --- | --- |
| Button, MenuButton, ToggleButton | semibold, 96 px minimum width | regular weight, sized to the content |
| Tab | a full-width underline under the selected tab, semibold labels | a 16 px accent pill under the label; regular weight, semibold when selected |

## Markdown

| Element | Treatment |
| --- | --- |
| h1 / h2 / h3–h6 | Subtitle 20/28 / BodyLarge 18/24 / BodyStrong 14/20; h5–h6 in the secondary colour |
| Paragraph, soft and hard breaks | Body 14/20, 12 between blocks |
| Bold, italic, strikethrough | semibold; italic; strikethrough in the tertiary colour |
| Inline code, `<kbd>` | mono 12 on a subtle 4 px chip; `kbd` adds a control stroke |
| Link, autolink | Fluent Link in the link colour, underlined on hover, in the type of the text around it, URL in a description tooltip; a click or Enter opens it in the default browser and does nothing else. Only `http` and `https` links are links, and only those the Pin window may open (`src-tauri/capabilities/links.json`); an email address, a footnote reference or a link still streaming stays text. The element carries no `href`, so WebView2 shows no status bar URL and opens no window on Ctrl+click or middle-click |
| Lists, nested lists | 20 indent, 4 between items, tertiary markers |
| Task list | Fluent's checkbox icons in the marker's place, in the secondary colour; exposed as read-only checkboxes, not inputs |
| Quote, nested quote | a 3 px control stroke (ControlStrokeColorSecondary) on the left, 12 before the text, secondary text |
| Code block | a card (CardBackgroundFillColorDefault, card stroke, 8 px corners), mono 12/20, scrolling inside itself sideways and beyond 400 px tall; one subtle Fluent copy button, whose copy goes through the app's own copy command and starts no Round; no line numbers, download button or language bar |
| Table | plain table elements in a sideways scroller, no frame or fill; a semibold header in the secondary colour; dividers between rows; no copy, download or fullscreen controls |
| Horizontal rule | a divider, 16 above and below |
| Footnotes | Caption 12, secondary, after a divider with 16 above and below; the section's heading is for screen readers only, and back-references are dropped |
| `<mark>`, `<sub>`, `<sup>`, `<details>` | the caution background; small; small; a BodyStrong summary |
| Image | fits the pane, 4 px corners, no download control |
| Mermaid | shown as a code block, as its source |
| Muted Source text | the same layout in the tertiary colour |

## Browser behaviours removed

| Behaviour | How |
| --- | --- |
| Classic scrollbars with arrows and a track | WebView2's Fluent overlay scrollbar, as in Edge (`webview_defaults`). A press within 16 px of a scrollable pane's right edge counts as a scrollbar press, not a window drag, because the overlay scrollbar takes no layout width |
| Page context menu (Back, Reload, Save as, Print, Inspect) | suppressed except in inputs, textareas and editable content, which keep cut, copy and paste; the Pin window keeps its own Copy selection menu |
| F3, F5, F7, Ctrl + R/F/G/P/S/U/J/H/O/N/T/W, Alt+Left/Right and the browser keys | the default is prevented at capture, so the app's own handlers still run: the Pin window regenerates on F5 and Ctrl+R |
| Ctrl+Shift+I/J/C (developer tools) | suppressed outside dev builds |
| Spelling squiggles under URLs, keys and model names | `spellcheck` off on the document |
| Autofill suggestions under text fields | WebView2's general autofill off (`webview_defaults`) |
| Edge's own password reveal and clear buttons | hidden; SecretField has its own |
| Browser select popups (white in dark mode) | no native `<select>`; Fluent Dropdown everywhere |
| Browser monospace (SimSun) | the monospace token on `code`, `kbd`, `pre` and `samp` |
| Browser focus ring | Fluent's ring, and the baseline's two-tone ring elsewhere |
| Browser margins on headings, paragraphs, lists, quotes and `pre` | none, outside Markdown |
| Browser text selection colour | the accent |
| Streamdown's link-safety modal, code and table chrome | replaced by Fluent pieces in `<Markdown>`; its controls and line numbers are off |
| Streamdown's utility classes | inert: sidelingo loads no Tailwind, so `markdown.css` is the only style a Markdown element has |
| WebView2's status bar URL and new windows from links | links carry no `href` |

## Decided in review

The prototype on branch `prototype/winui-look` settled these, reviewed by the owner on the desktop on 2026-10-05:

- **Toolbar reveal.** The Pin window's toolbar shows while the pointer is within the toolbar's height plus 16 px of the top, over the toolbar itself, or while keyboard focus is in it (`:focus-visible`), so reading never shows it, wheel-scrolling with the pointer mid-window included. This top band was chosen over showing it while the pointer is anywhere over the window and over showing it on pointer movement.
- **Toolbar layer.** The toolbar is opaque on the base colour with a divider below. A translucent, blurred (acrylic) layer let the toolbar and the text show through each other, and neither was readable.
- **Content and theme.** WinUI's values on Fluent, as above, over Fluent 2's defaults and the earlier web chrome.
- **Links.** Clicking a link opens it in the default browser at once, as WinUI's Hyperlink does; the URL shows on hover. A confirming Fluent dialog was tried and dropped.
- **Translucent control fills.** Tried, as WinUI uses them: Fluent shares their token with overlays, which then showed the content beneath. Over Mica the opaque values look the same.
