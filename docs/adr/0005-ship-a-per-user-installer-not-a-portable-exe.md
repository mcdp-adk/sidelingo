# Ship a per-user installer, not a portable exe

sidelingo ships as Tauri's NSIS installer in its default `currentUser` mode, installing to `%LOCALAPPDATA%\sidelingo` without administrator rights, and updates itself through `tauri-plugin-updater`. The owner's brief asked for a portable build, but once state moved to AppData (ADR 0004) "portable" only meant skipping the install step, while it cost self-update (the updater handles only MSI and NSIS on Windows, and treats any `.exe` as an NSIS installer), a Start menu entry, a stable path to launch at sign-in from, and uninstall cleanup.

## Considered Options

- **Portable exe with a new-version notice**: the user downloads and swaps the exe by hand, and there's no fixed install path or uninstaller.
- **Installer plus a portable exe**: two distribution forms and two update paths for a need nobody has named.

## Consequences

- Updates are found through `latest.json` on the latest GitHub Release, which is a plain download rather than a GitHub API call. They install only when the user chooses "Update to x.y.z", in the updater's `passive` mode, which quits and relaunches sidelingo.
- Update artifacts carry the updater's own signature, separate from Authenticode. Its private key and password live in GitHub Secrets with an offline backup kept by the owner: losing the key strands every installed copy on its current version.
- The uninstaller's "delete application data" option removes both AppData folders from ADR 0004.
- v1 is not Authenticode-signed. SignPath Foundation, the only free option, signs only projects with an existing release, so the installer and updater artifacts get signed from CI once it accepts sidelingo. Until then the README tells users how to get past SmartScreen and that Smart App Control blocks the installer.
