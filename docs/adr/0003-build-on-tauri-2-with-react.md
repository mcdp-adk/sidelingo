# Build on Tauri 2 with React

sidelingo v1 is a Tauri 2 app with a React front end, Fluent UI React v9 components, and Streamdown for Markdown. Rust is limited to OS integration: the Pin window, tray, hotkey, a small clipboard listener of our own (`AddClipboardFormatListener`, with format filtering through windows-rs), and model requests sent through `tauri-plugin-http` so HTTP and SOCKS5 proxies with credentials work. The Round pipeline and all UI are TypeScript, which keeps Read Frog's React and TypeScript code directly readable as the reference for wording and pipeline design. We accepted Fluent 2 web controls on a Mica window instead of native WinUI controls, because Windows 11 look and feel is the bar, not identical control templates, and in return got the strongest streaming Markdown, the smallest portable build (one exe, MSVC runtime linked statically), and no Microsoft runtime inside the process.

## Considered Options

- **WinUI 3**: the most faithful Fluent, but the weakest streaming Markdown, no double-click hook on drag regions, and the Windows App SDK is the runtime least compatible with GPL-3.0-only.
- **WPF + WPF-UI**: cannot be trimmed (a 64 MB single-file exe), and MdXaml has had no stable release since 2024.
- **Avalonia 12 + FluentAvalonia via NativeAOT**: one language and closer WinUI styling, but its streaming Markdown and Fluent library each rest on one small project, and the AOT compatibility of the Markdown stack is unverified. It is the fallback.
- **WebView `fetch` for model requests**: Chromium cannot authenticate to SOCKS5 proxies.

## Consequences

The first implementation slice is the Pin window shell: plain drag moves the window (starting only once the pointer passes a threshold, to avoid Tauri's lost mouse-up on drag regions), double-click hides it, and Ctrl+drag selects text. If that cannot be made reliable, sidelingo switches to Avalonia before building further.
