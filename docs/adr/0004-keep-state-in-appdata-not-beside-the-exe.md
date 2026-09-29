# Keep state in AppData, not beside the exe

sidelingo's portable build means one exe with no installer, not state that travels with the exe. Settings and the Pin window's position and size live in `%APPDATA%\io.github.mcdp-adk.sidelingo`, and the WebView2 user data folder in `%LOCALAPPDATA%\io.github.mcdp-adk.sidelingo`, both Tauri's defaults. Nothing is written beside the exe, because a truly portable layout isn't reachable anyway: Microsoft advises against the exe folder for WebView2 data since it may not be writable, and the official window-state plugin only writes under `app_config_dir()`.

## Considered Options

- **Everything beside the exe, falling back to AppData when the folder isn't writable**: promises portability it can't keep, and needs our own window-state storage and two sets of paths.
- **A marker file beside the exe switches to that layout** (as VS Code and Notepad++ do): a second mode nobody asked for.

## Consequences

- Secrets (API keys and proxy passwords) are encrypted with DPAPI for the current user, inside the same settings file. A copied settings file, another Windows user, or a forced password reset cannot decrypt them, so they surface as missing and ask to be entered again. Keys taken from environment variables are never written to disk.
- The identifier names both folders, so changing it later strands existing users' state; it was chosen once, by convention, for that reason.
- Removing sidelingo means deleting the exe and both folders, so settings show the data folder with a button to open it, and the README documents removal.
