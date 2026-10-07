# Changelog

## v0.2.1

- After you change a Preset you aren't using, or the proxy address while the System proxy is selected, opening the Pin window on the same text still shows the last result instead of translating it again. A proxy address that isn't in use no longer makes Settings reload the model list.

## v0.2.0

- Sidelingo has its own icon in the tray, the taskbar, the title bar and the installer, and its name is now written Sidelingo.
- Regenerate right after changing a key or model in Settings uses the new settings, instead of sometimes failing with the old ones.
- A change is never saved over a `settings.json` that Sidelingo can't read, or that holds settings this version can't use and couldn't move aside. The file is left as it was, and Settings, or a notification from the Pin window, says why the change wasn't saved.

## v0.1.1

- A failed **Check now** shows only why it failed, instead of also saying sidelingo is up to date.
- Updates download from the release's own links, so they no longer fail on a shared network that has used up GitHub's API limit.

## v0.1.0

- First release.
