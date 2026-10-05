# Desktop checklist

What needs real input, or shows only outside the webview, is checked here with computer-use rather than by a test (ADR 0006). Each release runs the whole checklist. A PR that touches an item runs that item, and the PR shows the result.

## How to run it

- Use the regular application build for the final verdict on topmost, taskbar, Alt+Tab and tray behaviour. Desktop development mode (`pnpm dev:desktop`) is for implementation and UI debugging only.
- Use isolated test application data and synthetic clipboard content. A virtual machine or sandbox isn't needed.
- Before starting, check that the available automation can perform each action. Leave security prompts and Windows-key shortcuts it can't perform to a focused manual check; never bypass a safety restriction. Product requirements, such as the default hotkey, don't change to suit the automation.
- Tell apart an app restart, an Autostart-argument launch and an actual Windows sign-in; one doesn't prove another. Record conditional hardware cases, such as a second monitor, as unexercised when unavailable.
- When the Windows display language isn't switched, name the static or automated language checks as substitute evidence instead of claiming a desktop run.
- Keep screenshots, recordings, raw logs, local paths and personal information local. Record sanitized text in the PR or issue, telling apart automated results, manual desktop observations and untested items. An item passes only on the stated method; absence of evidence is not a pass.

## The Pin window

- [ ] A plain drag moves the window only after the pointer travels past the drag threshold, and selects nothing. A plain click leaves it in place.
- [ ] A double-click on the content hides the window; a double-click on the toolbar doesn't.
- [ ] Ctrl+drag selects a passage and Ctrl+double-click selects a word, without hiding the window or starting a Round. An error's detail can be selected the same way and copied.
- [ ] The right-click menu appears only over a selection and holds only Copy selection. Copy selection copies the selected text and starts no Round. Esc closes only the menu, and a click on empty space clears the selection.
- [ ] The window stays on top, and is absent from the taskbar and Alt+Tab, with no minimize or maximize button.
- [ ] The window reopens at its last position and size after a hide and after a restart. A position that is off every monitor falls back onto the primary one, keeping the size.
- [ ] Side by side, the two panes scroll in step from the keyboard (PageDown and Home in the focused pane, in either pane) and from a held pointer dragging either pane's scrollbar.
- [ ] At the native minimum width, the compact toolbar's controls all fit without overlapping, in English and in Simplified Chinese.
- [ ] A refresh never takes focus.

## Hotkey and tray

- [ ] The hotkey shows the window, brings it to the front, and hides it.
- [ ] A tray click and each tray menu item do what they say.
- [ ] Tray notifications appear and clicking them works. A stored hotkey that another program holds before sidelingo starts gives a notification, and Settings then shows the hotkey flagged with the system's reason, still holding the stored combination.

## Appearance

Run every item in the light theme and again in the dark theme, against the look sample. Start it with `pnpm look:sample` (or `pnpm look:sample <port>`); it plays the Provider at the Base URL it prints, with no key and no tokens. In Settings, choose the Custom Preset, enter that Base URL, leave the key empty and choose a model from the list. The script prints what to copy for each state:

- any other text: Structuring returns a Markdown kitchen sink, and Translation a CJK sample;
- any image: an image without text;
- `sample:open-settings-error`: an HTTP error that offers Open settings;
- `sample:error`: an HTTP error that doesn't;
- `sample:partial`: a partial stream followed by an error.

Then check:

- [ ] Both windows show Mica behind their content, selected tabs, primary buttons, links and selections use the system accent, and switching the Windows theme or accent while sidelingo runs changes both windows at once.
- [ ] Overlays are opaque, with a thin outline and 8 px corners, and never show the content beneath them: the Pin window's Copy selection menu (select over the kitchen sink); the dropdown lists of Preset, Reasoning effort, Proxy mode, Target language and Model in Settings, and of Display mode in the narrow toolbar (narrow the Pin window until the tabs give way to a dropdown); the toolbar's tooltips (hover a Display mode tab and the pause button); and a dialog, which dims what is behind it.
- [ ] Panes, code blocks, tables and dropdown lists scroll with the Fluent overlay scrollbar, with no arrows and no track (copy any text, then scroll the panes, the tall and the wide code blocks, the wide table, and an open dropdown list). Pressing or dragging the scrollbar of a pane, a code block (down and sideways) or a wide table scrolls it and never moves the Pin window.
- [ ] The toolbar always shows above the text, opaque on the window's base colour with a divider below it, and nothing sits under it: the text, the MessageBars, the empty-window hint and the status line start below its divider, at every width and in each Display mode. Its controls are readable in both themes. Its Display mode tabs show a subtle fill on hover, with no line under a hovered or pressed tab, and a short accent pill under the selected one.
- [ ] Every Markdown element of the kitchen sink, side by side and in each pane alone, while it streams and once it's done: headings h1 to h6 on the type ramp, emphasis, strikethrough, inline code, every link form, the long URL and long word wrapping, nested and ordered lists, task lists as checkbox marks that can't be toggled, nested quotes, labelled, unlabelled, long and tall code blocks as cards with one copy button and no line numbers, download button or language bar, the mermaid fence as a code block, aligned and wide tables without a frame, the rule, the footnote, `kbd`, `sub`, `sup`, `mark`, `details` and the image fitting the pane. The CJK sample in the Translation pane mixes scripts, with its code in Cascadia Mono rather than SimSun. A code block's copy button copies its code and starts no Round. With Translation only, the muted Source text shown before the Translation starts uses the same layout in the tertiary colour.
- [ ] Every Pin window state: `sample:open-settings-error` shows an error with Open settings; `sample:error` shows one without; `sample:partial` keeps the streamed part of the kitchen sink above its error; an image shows the no-text notice. The empty-window hint, the status line and the MessageBars share the look's colours, type and corners.
- [ ] Settings: the page title and section headings on WinUI's Title and Subtitle, 24 px page padding, 32 px between sections and 16 px between fields, the data folder path in monospace, and Preset, Reasoning effort and Proxy mode as Fluent dropdowns, Preset reading "Choose a Provider" on a fresh data folder.
- [ ] Right-clicking outside a field shows no page menu (Back, Reload, Save as, Print or Inspect), in either window. A Settings text field keeps its cut, copy and paste menu.
- [ ] In Settings, F5, Ctrl+F and Ctrl+P do nothing. In the Pin window, F5 regenerates the shown Round.
- [ ] Settings fields show no spelling squiggles under a typed URL, key or model name, no browser autofill suggestions, and in a secret field only sidelingo's own show-password button, never Edge's reveal button.
- [ ] A link in the kitchen sink shows its URL on hover, and a click opens it in the default browser, with no "Open external link?" page.
- [ ] The pause border, shown in the caution colour while the toolbar's pause button pauses clipboard monitoring.
- [ ] No pane shows a horizontal scrollbar for ordinary text at 150 % display scaling.

## Settings window

- [ ] The settings window stays above the Pin window, and only above it.
- [ ] Start at sign-in starts off. Turning it on and off registers and removes sidelingo for sign-in, and Settings shows a registration changed outside sidelingo after a restart or on reopening.
- [ ] An Autostart launch stays in the tray, sending nothing to the Provider, until the user shows the window.
- [ ] About shows the running version, and its License, Source code and Third-party notices links open the installed license, the repository and the bundled notices.

## Installing and updating

- [ ] The installer, including the SmartScreen notes in the README.
- [ ] The uninstaller's option to delete application data removes both data folders, and leaving it unchecked keeps them.
- [ ] The update flow end to end against a test release.
