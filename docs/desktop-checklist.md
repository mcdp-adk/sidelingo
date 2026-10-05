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

- [ ] Mica, the light and dark themes, and the accent colour.
- [ ] The pause border.
- [ ] The toolbar fade.
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
