# Windows UI stacks for sidelingo

Research for [#2](https://github.com/mcdp-adk/sidelingo/issues/2), under the map [#1](https://github.com/mcdp-adk/sidelingo/issues/1). Facts as of 2026-09-29. This note compares options and does not pick the stack; a later decision ticket does that.

## What sidelingo v1 needs from a UI stack

- A Fluent look on Windows 11: Mica or Acrylic, native-feeling controls, light and dark.
- Structured Markdown (headings, lists, tables, code, maybe math) that updates while an LLM response streams in, in three Display modes (source only, translation only, side-by-side).
- A borderless, always-on-top pin window that can be dragged from any non-button area, closes on double-click, and reopens at its last position and size.
- A global hotkey, plus a notification when the clipboard changes (text and image).
- A small portable build that runs on a clean Windows 11. WebView2 comes with Windows 11; the .NET runtime does not.
- An actively maintained stack and Fluent library.

## Method

- Claims come from official docs, source code at tagged releases, release notes, and package registries (NuGet, npm, pub.dev, GitHub releases). Each claim links its source.
- Sizes in [Measured sizes](#measured-sizes) come from minimal apps built on this machine on 2026-09-29. No published figure was found for WinUI 3, WPF or Avalonia sizes. Rust and the MSVC linker are not installed here, so Tauri and .NET NativeAOT could not be built; for those, published figures are given instead.
- Lines marked **Derived** are inferences drawn from the cited facts, not statements made by the source.

## Summary

| | WinUI 3 (Windows App SDK 2.x) | WPF + WPF-UI | Avalonia 12 + FluentAvalonia 3 | Tauri 2 + WebView2 + Fluent web components |
| --- | --- | --- | --- | --- |
| Latest stable | WinAppSDK 2.5.1 (2026-09-16) | .NET 10 WPF; WPF-UI 4.3.0 (2026-05-04) | Avalonia 12.1.3 (2026-09-22); FluentAvalonia 3.1.0 (2026-08-22) | Tauri 2.12.0 (2026-09-26); Fluent UI Web Components 3.1.3 (2026-08-25) |
| Fluent fidelity | The Fluent reference implementation: native WinUI controls, `MicaBackdrop`/`DesktopAcrylicBackdrop`, light/dark | WPF-UI restyles WPF controls in the Windows 11 style and adds Mica/Acrylic/Tabbed backdrops through DWM; .NET 9+ also has a built-in Fluent theme that is "still in progress" | FluentAvalonia ports WinUI controls and styles onto Avalonia; the window can request `Mica`/`AcrylicBlur` transparency | Fluent 2 *web* components (`webLightTheme`/`webDarkTheme`); Mica/Acrylic/Tabbed window effects on Windows 11 |
| Markdown while streaming | Labs `MarkdownTextBlock` (experimental 0.1.x; re-renders the whole document on each change; no math) or the built-in `WebView2` control | MdXaml (last stable 1.27.0, Feb 2024) or WebView2 (`WebView2CompositionControl` avoids airspace) | LiveMarkdown.Avalonia (Apache-2.0, built for LLM streaming: append-only updates, tables, code, LaTeX) or Avalonia's WebView, open source since 12.0 | Any JS renderer, for example Streamdown (Apache-2.0, built for streaming: unterminated blocks, KaTeX, Shiki, CJK plugin) |
| Pin window | `OverlappedPresenter.IsAlwaysOnTop`, `SetBorderAndTitleBar`; dragging goes through non-client caption regions, which have no built-in double-click hook | `Topmost`, `WindowStyle=None`, `DragMove()`, `ClickCount` | `Topmost`, `BeginMoveDrag(e)`, `ClickCount` | `alwaysOnTop`, `decorations:false`, `data-tauri-drag-region="deep"`; a double-click on a drag region toggles maximize by default |
| Hotkey / clipboard notification | Win32 `RegisterHotKey`; WinRT `Clipboard.ContentChanged` | Win32 through `HwndSource.AddHook`; `Clipboard.GetImage` | Win32 through `Win32Properties.AddWndProcHookCallback`; `TryGetBitmapAsync` | Official global-shortcut plugin; the official clipboard plugin reads text and images but has **no change event** |
| Portable build, clean Win 11 (measured, minimal app) | Self-contained and trimmed: 77.6 MB folder, 274 files, 31.5 MB zipped | Self-contained: 145.8 MB, or a 64.2 MB compressed single-file exe (WPF can't be trimmed); framework-dependent 6.4 MB but needs the .NET Desktop Runtime | Self-contained and trimmed: 44.6 MB folder, or a 20.2 MB compressed single-file exe; NativeAOT supported (not measured) | Tauri documents "less than 600KB" for a minimal app; WebView2 is part of Windows 11 (not measured) |
| Maintenance | Microsoft, 6-month major releases, 2.0 supported to 2027-04-29 | .NET 10 LTS to 2028-11-14; WPF-UI: mostly one lead author, no commits since 2026-06-27 | Company-backed core, releases monthly; FluentAvalonia: mostly one maintainer, active | Large project; v2 stable, v3 in alpha |

No candidate among the four is ruled out by a hard fact. The hard facts that do constrain the choice:

- WPF can't be trimmed or compiled with NativeAOT, so a no-prerequisite WPF build carries the whole .NET runtime.
- A framework-dependent WinUI 3 build needs two runtimes that a clean Windows 11 lacks: the Windows App Runtime and .NET.
- Tauri's official clipboard plugin has no change notification. Sidelingo would need a community plugin or its own Rust code.
- Electron is effectively ruled out on size. See [Other contenders](#other-contenders).

## WinUI 3 (Windows App SDK)

**Status.** Windows App SDK moved to semantic versioning with 2.0 (2026-04-29). The current stable release is 2.5.1 (2026-09-16), and Microsoft services 2.0 until 2027-04-29. Stable major releases come "no more than every six months", and 1.8 reached end of servicing on 2026-09-24 ([release channels](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/release-channels)). The repos are MIT-licensed and active: [microsoft-ui-xaml](https://github.com/microsoft/microsoft-ui-xaml) had 2,408 open issues and [WindowsAppSDK](https://github.com/microsoft/WindowsAppSDK) 426, both with pushes on 2026-09-29.

**Fluent fidelity.** WinUI is the Fluent reference implementation, and its controls are the ones Windows 11 uses ([README](https://github.com/microsoft/microsoft-ui-xaml)). 2.0.1 added `SystemBackdropElement`, which places Mica or Acrylic anywhere in the XAML layout ([2.x release notes](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/release-notes/windows-app-sdk-2-0?pivots=stable)).

**Markdown.**

- There is no Markdown control in WinUI or in the Windows App SDK 2.x release notes.
- The Community Toolkit's `MarkdownTextBlock` lives in Labs and is marked `experimental: true`. Its NuGet package `CommunityToolkit.Labs.WinUI.Controls.MarkdownTextBlock` has only 0.1.x preview builds, the latest from 2025-12-17. It parses with Markdig and renders headings, lists, tables, code, quotes, images and task lists ([source](https://github.com/CommunityToolkit/Labs-Windows/tree/main/components/MarkdownTextBlock/src/TextElements)). It has no math element.
- Every change to `Text` re-parses and re-renders the whole document (`ApplyText` → `Markdown.Parse(Text, …)` → `_renderer.Render(…)`, [source](https://github.com/CommunityToolkit/Labs-Windows/blob/main/components/MarkdownTextBlock/src/MarkdownTextBlock.xaml.cs)).
- The alternative is WinUI's built-in `WebView2` control running a JS Markdown renderer. Its background can be made transparent: only alpha 0 or 255 is supported, and "choosing a transparent color will result in showing hosting app content" ([DefaultBackgroundColor](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2controller.defaultbackgroundcolor)).

**Pin window.**

- `OverlappedPresenter` has `IsAlwaysOnTop`, `IsMaximizable`, `IsResizable` and `SetBorderAndTitleBar(bool, bool)` ([API](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.windowing.overlappedpresenter)).
- WinUI has no `DragMove`. Dragging works by marking caption regions through `InputNonClientPointerSource.SetRegionRects(NonClientRegionKind.Caption, …)`, which exposes `PointerPressed`, `CaptionTapped` and move-size events ([API](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.input.inputnonclientpointersource)).
- Since 2.1.3, the `TitleBar` control automatically leaves interactive controls out of its drag region, and `TitleBar.IsDragRegion` can override that per element ([2.x release notes](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/release-notes/windows-app-sdk-2-0?pivots=stable)).
- **Derived:** The docs list no double-click event for caption regions. Close-on-double-click therefore needs either Win32 subclassing (for example of `WM_NCLBUTTONDBLCLK`) or a drag that starts from XAML `PointerPressed` through Win32 (`WM_NCLBUTTONDOWN` with `HTCAPTION`). Either way it needs a prototype.
- Position and size: `AppWindow.Move`/`Resize`.

**Hotkey and clipboard.**

- There's no global-hotkey API; the route is Win32 [`RegisterHotKey`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey) plus window subclassing to receive `WM_HOTKEY`.
- The clipboard has a WinRT event, [`Clipboard.ContentChanged`](https://learn.microsoft.com/en-us/uwp/api/windows.applicationmodel.datatransfer.clipboard.contentchanged). Images are read through `StandardDataFormats.Bitmap`.

**Deployment.**

- **Framework-dependent unpackaged:** The app needs the Windows App Runtime (installed by its own installer, or MSIX packages deployed directly) and the Bootstrapper. The docs also list the Visual C++ Redistributable as a prerequisite and .NET 6+ for C# ([deploy-unpackaged-apps](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/deploy-unpackaged-apps)).
- **Self-contained:** Setting `WindowsAppSDKSelfContained=true` extracts the framework into the output folder so it can be xcopy-deployed ([self-contained guide](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/self-contained-deploy/deploy-self-contained-apps)). .NET must also be published self-contained, and the docs say this "significantly increases output size" ([unpackage-winui-app](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/unpackage-winui-app)).
- **Single file:** `PublishSingleFile` works only when the app is both unpackaged and self-contained, and "dependencies are extracted to a temp directory at first launch" ([unpackage-winui-app](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/unpackage-winui-app)).
- **Trimming and AOT:** `PublishAot` has been supported since 1.6, with CsWinRT 2.1.1+ and the developer responsible for rooting reflection-bound types ([1.6 release notes](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/release-notes/windows-app-sdk-1-6)).
- **Package choice (measured):** The `Microsoft.WindowsAppSDK` 2.5.1 metapackage pulls in AI, ML and Search packages; the ML package alone adds `onnxruntime.dll` (20.7 MB) and `DirectML.dll` (17.8 MB). Referencing only the component package `Microsoft.WindowsAppSDK.WinUI` 2.3.9 avoids them.
- **Unpackaged limits:** An unpackaged app has no package identity, so it can't use manifest-based features ([unpackage-winui-app](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/unpackage-winui-app)).

## WPF + WPF-UI (or WPF's built-in Fluent theme)

**Status.**

- WPF ships with every .NET release. .NET 10 is the current LTS and is supported until 2028-11-14; .NET 8 and 9 reach end of support on 2026-11-10 ([.NET support policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core)).
- [WPF-UI](https://github.com/lepoco/wpfui) is MIT-licensed and has about 9.7k stars and 453 open issues. Its lead author has 1,369 commits; the next contributor has 238 ([contributors](https://github.com/lepoco/wpfui/graphs/contributors)).
- WPF-UI's releases: 4.2.0 (2026-01-10), 4.2.1 (2026-04-23), 4.3.0 (2026-05-04). Its last commit was 2026-06-27. It targets net8/9/10-windows and .NET Framework 4.6.2+ ([NuGet](https://www.nuget.org/packages/WPF-UI)).

**Fluent fidelity.**

- WPF-UI restyles the base WPF controls and adds Fluent controls such as `NavigationView`, `NumberBox` and `Snackbar` ([README](https://github.com/lepoco/wpfui)).
- `FluentWindow.WindowBackdropType` supports `Mica`, `Acrylic` and `Tabbed` through `DWMWA_SYSTEMBACKDROP_TYPE` ([source](https://github.com/lepoco/wpfui/blob/main/src/Wpf.Ui/Controls/Window/WindowBackdropType.cs)).
- WPF-UI doesn't ship Segoe Fluent Icons (EULA), but that font comes with Windows 11 ([README](https://github.com/lepoco/wpfui)).
- WPF's own Fluent theme (`ThemeMode` Light/Dark/System, plus accent colors) arrived in .NET 9. Setting `ThemeMode` from code is still experimental (error WPF0001) ([.NET 9](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/whats-new/net90)). In .NET 10 the theme styles more controls, and Microsoft says "Fluent UI style support is still in progress" ([.NET 10](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/whats-new/net100)).

**Markdown.**

- [MdXaml](https://github.com/whistyun/MdXaml) (MIT) converts Markdown into a WPF `FlowDocument`, with tables (row and column span) and code highlighting through AvalonEdit. Its last stable release is 1.27.0 (2024-02-06); 1.28.0 and 2.0.0 previews appeared on 2026-03-08 ([NuGet index](https://api.nuget.org/v3-flatcontainer/mdxaml/index.json)).
- **Derived:** MdXaml's API turns a whole string into a document (`engine.Transform(markdownTxt)`), so streaming means re-transforming the accumulated text each time.
- WebView2: the classic WPF control is hosted in an HWND and "is always the top-most control". `WebView2CompositionControl`, public since SDK 1.0.3065.39, fixes that airspace problem ([spec](https://github.com/MicrosoftEdge/WebView2Feedback/blob/main/specs/WPF_WebView2CompositionControl.md), [WPF docs](https://learn.microsoft.com/en-us/microsoft-edge/webview2/platforms/wpf)).

**Pin window.** WPF has these directly: `Window.Topmost`, `WindowStyle=None`, [`Window.DragMove()`](https://learn.microsoft.com/en-us/dotnet/api/system.windows.window.dragmove), `MouseButtonEventArgs.ClickCount` for double-click, and `Left/Top/Width/Height`/`RestoreBounds` for position and size.

**Hotkey and clipboard.** Both go through Win32: [`HwndSource.AddHook`](https://learn.microsoft.com/en-us/dotnet/api/system.windows.interop.hwndsource.addhook) receives `WM_HOTKEY` and [`WM_CLIPBOARDUPDATE`](https://learn.microsoft.com/en-us/windows/win32/dataxchg/wm-clipboardupdate) (after [`AddClipboardFormatListener`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-addclipboardformatlistener)). Images are read with `Clipboard.GetImage`. In .NET 10, WPF and WinForms share one clipboard API, and some `BinaryFormatter`-based methods are obsolete ([.NET 10](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/whats-new/net100)).

**Deployment.**

- "Trimming support for WPF is currently disabled in the .NET SDK" ([trimming incompatibilities](https://learn.microsoft.com/en-us/dotnet/core/deploying/trimming/incompatibilities)). NativeAOT requires trimming and rules out built-in COM ([Native AOT](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/)), so WPF can't use it.
- The choices are therefore a framework-dependent build, which needs the .NET Desktop Runtime installed, or a self-contained build carrying the untrimmed runtime.

## Avalonia + FluentAvalonia

**Status.**

- Avalonia is MIT-licensed, has about 31.6k stars, and is actively maintained. 12.0.0 shipped 2026-04-07, targets .NET 10 and SkiaSharp 3.0, and open-sourced the WebView control ([release](https://github.com/AvaloniaUI/Avalonia/releases/tag/12.0.0), [blog](https://avaloniaui.net/blog/avalonia-12)). Releases continue on both 12.1.x and 11.3.x (12.1.3 on 2026-09-22, 11.3.22 on 2026-09-11).
- [FluentAvalonia](https://github.com/amwx/FluentAvalonia) (MIT) is mostly one maintainer's work: 1,248 commits, against 44 from the next contributor. 3.0.0 came out 2026-06-20 and 3.1.0 on 2026-08-22; it targets `net10.0` and requires Avalonia 12.1+ ([NuGet](https://www.nuget.org/packages/FluentAvaloniaUI)). The library is marked `IsAotCompatible` ([csproj](https://github.com/amwx/FluentAvalonia/blob/main/src/FluentAvalonia/FluentAvalonia.csproj)).

**Fluent fidelity.**

- FluentAvalonia brings WinUI controls and styles to Avalonia ([README](https://github.com/amwx/FluentAvalonia)).
- Controls draw through Skia, so they are look-alikes rather than native Windows controls.
- The window backdrop is set with `TransparencyLevelHint`. `WindowTransparencyLevel.Mica` "will only work on Windows 11", and there is also `AcrylicBlur` ([source](https://github.com/AvaloniaUI/Avalonia/blob/12.1.3/src/Avalonia.Controls/WindowTransparencyLevel.cs)).

**Markdown.**

- [LiveMarkdown.Avalonia](https://github.com/DearVa/LiveMarkdown.Avalonia) (Apache-2.0) was built for streaming LLM output. It parses with Markdig and supports tables, TextMate code highlighting, LaTeX through CSharpMath, Mermaid, and text selection across elements. Content can only be appended or cleared, "which is enough for LLM streaming scenarios".
- It targets Avalonia 12, released v2.4.3 on 2026-09-19, and has 176 stars and 10 contributors. It is a small project for sidelingo's core view to depend on.
- Alternatives: [Markdown.Avalonia](https://github.com/whistyun/Markdown.Avalonia) (MIT), whose Avalonia 12 builds are still alphas (12.0.0-a3), or the WebView (`Avalonia.Controls.WebView`, which uses WebView2 on Windows) ([blog](https://avaloniaui.net/blog/the-avalonia-webview-is-going-open-source), [docs](https://docs.avaloniaui.net/docs/app-development/embedding-web-content)).

**Pin window.** `Window.Topmost`; `BeginMoveDrag(PointerPressedEventArgs)` "should be called from left mouse button press event handler" ([source](https://github.com/AvaloniaUI/Avalonia/blob/12.1.3/src/Avalonia.Controls/Window.cs)); `PointerPressedEventArgs.ClickCount`; `Position`/`Width`/`Height`.

**Hotkey and clipboard.**

- There's no built-in global hotkey or clipboard-change event. `Win32Properties.AddWndProcHookCallback(TopLevel, …)` lets the app receive `WM_HOTKEY` and `WM_CLIPBOARDUPDATE` ([source](https://github.com/AvaloniaUI/Avalonia/blob/12.1.3/src/Avalonia.Controls/Platform/Win32Properties.cs)).
- The clipboard API has `TryGetTextAsync` and `TryGetBitmapAsync` (`DataFormat.Bitmap`) ([docs](https://docs.avaloniaui.net/docs/services/clipboard)).

**Deployment.**

- Avalonia supports trimming and NativeAOT. NativeAOT needs compiled bindings and no runtime XAML loading ([Avalonia Native AOT](https://docs.avaloniaui.net/docs/deployment/native-aot)).
- On Windows, NativeAOT needs Visual Studio's C++ workload at build time ([.NET Native AOT](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/)).
- **Derived (from the measured output):** Some native DLLs stay separate files whatever the publish mode: `libSkiaSharp.dll` 11.1 MB, `av_libglesv2.dll` 5.1 MB and `libHarfBuzzSharp.dll` 1.7 MB, about 18 MB before any app code.

## Tauri 2 + WebView2 + a Fluent web component library

**Status.**

- Tauri is Apache-2.0/MIT licensed, has about 111k stars, and released 2.12.0 on 2026-09-26.
- A 3.0 alpha is in progress (3.0.0-alpha.3 on 2026-09-26), including a `tauri-runtime-cef` crate ([releases](https://github.com/tauri-apps/tauri/releases)).
- [Fluent UI Web Components](https://github.com/microsoft/fluentui/tree/master/packages/web-components) 3.0.0 reached stable on 2026-06-29, and the current version is 3.1.3 (MIT). It covers about 40 components, including button, menu, dialog, dropdown, switch, tabs, tooltip and tree ([source tree](https://github.com/microsoft/fluentui/tree/master/packages/web-components/src)). Its themes are `webLightTheme` and `webDarkTheme` ([README](https://github.com/microsoft/fluentui/blob/master/packages/web-components/README.md)). **Derived:** These follow Fluent 2 for the web, not the WinUI control templates, so the result is Fluent-like rather than identical to Windows 11.
- The alternative is Fluent UI React v9 (`@fluentui/react-components` 9.74.9, published 2026-09-29).

**Fluent fidelity (window).** `windowEffects` supports `mica`/`micaDark`/`micaLight` and `tabbed*`, all "Windows 11 Only". `acrylic` and `blur` carry a warning of "bad performance when resizing/dragging the window" on some Windows builds ([source at 2.12.0](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.0/crates/tauri-utils/src/lib.rs)).

**Markdown.**

- Any JS library works. [Streamdown](https://github.com/vercel/streamdown) (Apache-2.0, 2.6.0) is "designed for AI-powered streaming". It handles "incomplete or unterminated Markdown blocks", GFM tables, KaTeX math, Shiki code highlighting and Mermaid, and has a CJK plugin. It is a drop-in replacement for `react-markdown`, which Read Frog already uses. Read Frog's [package.json](https://github.com/mengxi-ream/read-frog/blob/main/package.json) lists React 19, `react-markdown` 10 and the Vercel AI SDK.
- **Derived:** In this stack, Read Frog's TypeScript code (prompt assembly, AI SDK calls) could be reused as code, not only as copied prompt text.
- Streaming from Rust to the page uses Channels, which "are designed to be fast and deliver ordered data" ([calling the frontend](https://v2.tauri.app/develop/calling-frontend/)).

**Pin window.**

- `decorations: false`, `transparent`, `alwaysOnTop`, `shadow` ([config](https://v2.tauri.app/reference/config/)).
- In 2.12.0, `data-tauri-drag-region` accepts `"deep"` (the whole subtree drags) and `"false"`. Buttons, links, inputs, `tabindex` elements and interactive ARIA roles block dragging automatically ([drag.js at 2.12.0](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.0/crates/tauri/src/window/scripts/drag.js)).
- A double-click on a drag region calls `internal_toggle_maximize` (same file). For close-on-double-click, sidelingo would write its own mousedown handler, for example with `startDragging()` from the window API.
- The open issue [#10767](https://github.com/tauri-apps/tauri/issues/10767) reports that on Windows, clicking a drag region toggles focus and drops the mouse-up event.
- The official [window-state plugin](https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/window-state) saves `.window-state.json` under `app_config_dir()`, which is outside the exe folder ([source](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/window-state/src/lib.rs)).

**Hotkey and clipboard.**

- The official [global-shortcut plugin](https://v2.tauri.app/plugin/global-shortcut/) covers Windows, macOS and Linux.
- The official [clipboard-manager plugin](https://v2.tauri.app/plugin/clipboard/) reads and writes text, images and HTML, but has no change listener.
- The community [tauri-plugin-clipboard](https://github.com/CrossCopy/tauri-plugin-clipboard) (MIT) adds monitoring for text, HTML and images. Its last release was v2.1.9 (2024-10-03).
- Otherwise, Rust code can call `AddClipboardFormatListener` directly, for example through [clipboard-master](https://github.com/DoumanAsh/clipboard-master) (MIT).

**Deployment.**

- "A minimal Tauri app can be less than 600KB in size" ([Tauri start](https://v2.tauri.app/start/)).
- "On Windows 10 (April 2018 release or later) and Windows 11, the WebView2 runtime is distributed as part of the operating system" ([Windows installer](https://v2.tauri.app/distribute/windows-installer/)).
- Microsoft still advises that apps check the runtime is present ([WebView2 distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)). Bundling a Fixed Version runtime instead adds "over 250 MB" (same page).
- Tauri documents `.msi` and NSIS installers. A portable exe is not a documented bundle target, but when `frontendDist` is a path, the assets are bundled into the app ([config.rs](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.0/crates/tauri-utils/src/config.rs)).
- On Windows, Tauri forces WebView2's data folder to `app_local_data_dir()` (`%LOCALAPPDATA%\<identifier>`) unless the app sets another ([webview.rs](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.0/crates/tauri/src/manager/webview.rs)).

## Other contenders

| Stack | Relevant facts | Assessment |
| --- | --- | --- |
| **Electron** | The Windows x64 runtime zip for v44.4.5 (2026-09-23) is 150 MB before app code ([release](https://github.com/electron/electron/releases/tag/v44.4.5)). | Offers the same web UI as Tauri at more than 250× Tauri's documented minimum size. Effectively ruled out on size. |
| **.NET MAUI** | On Windows it runs on WinUI 3, so deployment is the same as WinUI 3. | No advantage over WinUI 3 for a Windows-only app. |
| **Uno Platform** | Offers the WinUI API on a Skia renderer, with a Win32 shell on Windows and NativeAOT supported on desktop ([docs](https://platform.uno/docs/articles/features/using-skia-desktop.html)). Apache-2.0. No Mica statement found for Skia Desktop. | A cross-platform WinUI look-alike. Its Windows-only case is weaker than native WinUI or Avalonia. |
| **Qt Quick (Qt 6.8+)** | The `FluentWinUI3` style is designed for Windows 11, but "is not a native style" and is still "under development"; unsupported controls fall back to Fusion ([docs](https://doc.qt.io/qt-6/qtquickcontrols-fluentwinui3.html)). `Text.MarkdownText` renders Markdown ([Text](https://doc.qt.io/qt-6/qml-qtquick-text.html#textFormat-prop)). LGPLv3/GPL is compatible with GPL-3.0. | Serious, but it brings a C++/QML toolchain and its Fluent style is incomplete. Size not measured. |
| **Flutter + fluent_ui** | [fluent_ui](https://pub.dev/packages/fluent_ui) 4.16.1 (2026-08-03, BSD-3). `flutter_markdown` is discontinued in favour of `flutter_markdown_plus` ([pub.dev](https://pub.dev/packages/flutter_markdown)). The window effect package `flutter_acrylic` was last published 2024-06-11. | Possible; the window-effects plugin is stale. |
| **Slint** | 1.18.1 (2026-09-21), GPLv3 available. Markdown in `StyledText` is partial: full syntax, headings, images and math are open work ([#12675](https://github.com/slint-ui/slint/issues/12675), [#12648](https://github.com/slint-ui/slint/issues/12648)). | Markdown rendering is not ready for sidelingo's needs. |

## Measured sizes

These are minimal apps with one window, one `TextBlock` and a Mica request. The dependencies are WPF + WPF-UI 4.3.0; Avalonia 12.1.3 + FluentAvalonia 3.1.0; and WinUI with `Microsoft.WindowsAppSDK` 2.5.1 or the `Microsoft.WindowsAppSDK.WinUI` 2.3.9 component only. All were built with .NET SDK 10.0.401 for `win-x64` in Release; `.pdb` files are excluded and zips use `Compress-Archive -CompressionLevel Optimal`. "Runs" means the exe was still running 5–6 s after launch on this Windows 11 machine.

| Build | Folder | Files | Zip | Needs on clean Win 11 | Runs |
| --- | --- | --- | --- | --- | --- |
| WPF, framework-dependent | 6.4 MB | 6 | 2.5 MB | .NET 10 Desktop Runtime | not tested |
| WPF, self-contained | 145.8 MB | 401 | 64.5 MB | nothing | yes (single-file variant) |
| WPF, self-contained single-file, compressed | 64.2 MB | 1 | — | nothing | yes |
| Avalonia, framework-dependent | 30.5 MB | 35 | — | .NET 10 Runtime | not tested |
| Avalonia, self-contained | 107.1 MB | 222 | — | nothing | not tested |
| Avalonia, self-contained trimmed | 44.6 MB | 63 | 19.0 MB | nothing | yes (single-file variant) |
| Avalonia, self-contained trimmed single-file, compressed | 20.2 MB | 1 | — | nothing | yes |
| WinUI (full metapackage), framework-dependent | 76.6 MB | 48 | — | Windows App Runtime + .NET 10 | not tested |
| WinUI (full metapackage), self-contained | 226.0 MB | 517 | 90.4 MB | nothing | not a valid test* |
| WinUI (`.WinUI` component only), self-contained | 168.4 MB | 450 | 66.5 MB | nothing | yes |
| WinUI (`.WinUI` component only), self-contained trimmed | 77.6 MB | 274 | 31.5 MB | nothing | yes |
| WinUI (`.WinUI` component only), trimmed single-file, compressed | 32.4 MB | 1 | — | nothing | **crashed** (0xE0434352)** |

\* The full-metapackage builds had no compiled `App.xaml` (`XamlControlsResources` was added in code), which crashes at startup (0xC000027B). The component-only builds were redone with a compiled `App.xaml` and run. The metapackage sizes still show how much payload it adds.
\** Not investigated. Single-file WinUI extracts to a temp directory anyway ([docs](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/unpackage-winui-app)).

Not measured here: Avalonia or WinUI NativeAOT (needs the MSVC toolchain), and Tauri (needs Rust). A real app adds a Markdown renderer, an HTTP client and settings. For Tauri, the bundled front end (Fluent UI Web Components, Streamdown, Shiki, KaTeX) adds to its documented "less than 600KB" minimum.

## Constraints that apply to every stack

- **Drag-anywhere vs. text selection.** **Derived:** If every non-button area starts a window drag, the rendered Markdown can't be selected with a mouse drag, whichever stack is used. The pin window interaction ticket has to decide between them.
- **Win32 is the common path for hotkeys and clipboard.** [`RegisterHotKey`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey) and [`AddClipboardFormatListener`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-addclipboardformatlistener) / [`WM_CLIPBOARDUPDATE`](https://learn.microsoft.com/en-us/windows/win32/dataxchg/wm-clipboardupdate) work from every stack. What differs is how hard it is to receive window messages: WPF (`HwndSource.AddHook`) and Avalonia (`AddWndProcHookCallback`) have hooks, WinUI needs subclassing, and Tauri needs Rust code or a plugin.
- **Portable settings and WebView data.** Any WebView2-based renderer needs a writable user data folder. By default WPF, WinForms and Win32 create it beside the exe (`<exe>.WebView2`), and Microsoft recommends a custom location because the default fails where the exe folder isn't writable ([UDF docs](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/user-data-folder)). This affects the open "config beside the exe vs `%APPDATA%`" question in #1.
- **Licensing note (not researched further).** The Windows App SDK runtime and the WebView2 SDK binaries are redistributed under Microsoft Software License Terms, not an open-source license. For example, the Windows App SDK terms allow redistributing "any files that are binplaced with your application by the WindowsAppSDK NuGet package" (`license.txt` in the `Microsoft.WindowsAppSDK.Runtime` 2.5.1 package). Whether shipping them next to GPL-3.0-only code is fine is a question for the license work, not for this note. Avalonia, FluentAvalonia, WPF-UI, SkiaSharp, .NET, Tauri, Fluent UI and Streamdown are all MIT or Apache-2.0.

## Open questions for a prototype

1. Close-on-double-click alongside drag-anywhere, per stack: the WinUI caption regions, the Tauri drag-region override and #10767, and whether WPF's `DragMove`/`ClickCount` and Avalonia's `BeginMoveDrag`/`ClickCount` cooperate.
2. How smooth streaming Markdown is in LiveMarkdown.Avalonia, Streamdown, and a WebView2 page inside WinUI or WPF, including CJK text and tables.
3. Real portable sizes for Tauri and for Avalonia/WinUI NativeAOT with a Markdown renderer and HTTP client included.
