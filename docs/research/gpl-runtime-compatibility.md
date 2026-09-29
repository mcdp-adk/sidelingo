# GPL-3.0 compatibility of the UI stack runtimes

Research for [#12](https://github.com/mcdp-adk/sidelingo/issues/12), under the map [#1](https://github.com/mcdp-adk/sidelingo/issues/1). Facts as of 2026-09-29. It asks whether each runtime or library left in the [UI stack comparison](https://github.com/mcdp-adk/sidelingo/blob/research/windows-ui-stacks/docs/research/windows-ui-stacks.md) can ship with a GPL-3.0-only sidelingo ([ADR 0001](../adr/0001-gpl-3-0-only-to-reuse-read-frog-prompts.md)), both (a) when the runtime is already on the machine and (b) inside the portable zip. It does not pick a stack, and it is not legal advice.

## Method and labels

- Licenses were read from the files that ship with each package (NuGet packages in the local cache, built on this machine for the stack comparison), from the npm and NuGet registries, and from the upstream repos at the cited tags. GPL rules come from the [GPLv3 text](https://www.gnu.org/licenses/gpl-3.0.txt), the [FSF GPL FAQ](https://www.gnu.org/licenses/gpl-faq.html), the [FSF license list](https://www.gnu.org/licenses/license-list.html), and the FSF's [GPLv3 first discussion draft rationale](https://gplv3.fsf.org/gpl-rationale-2006-01-16.pdf).
- Each verdict carries one label:
  - **Settled**: follows directly from the license texts; nothing is left to interpret.
  - **Derived**: an inference from the cited texts that this note considers sound, but that no source states in so many words.
  - **Lawyer**: depends on a contested reading (what "combined work" or "System Library" covers, or which of two conflicting sources wins). This note gives the arguments, not an answer.

## Summary

| Component | License of what ships | (a) Depend on it when preinstalled | (b) Bundle in the zip |
| --- | --- | --- | --- |
| **WebView2 SDK** (`Microsoft.Web.WebView2`: Core/WPF/WinForms DLLs, `WebView2Loader`) | BSD-3-Clause-style | Yes. **Settled** | Yes. **Settled** |
| **WebView2 Evergreen Runtime** | Microsoft proprietary; part of Windows 11 | Yes: an OS component in separate processes. **Derived** | Not applicable (it is the OS's copy) |
| **WebView2 Fixed Version Runtime** | Microsoft proprietary terms (current text not verified) | Not applicable | Unclear: separate processes, but not an OS copy. **Lawyer** |
| **.NET runtime, framework-dependent** (.NET 10) | Not ours to distribute | Yes: the CLR is the interpreter; the libraries are MIT. **Derived** (but .NET 10 is not preinstalled on Windows 11) | Not applicable |
| **.NET runtime, self-contained** | MIT, except `coreclr.dll` under the proprietary .NET Library License (Microsoft's own sources disagree, see below) | Not applicable | Unclear, worse for single-file. **Lawyer** |
| **.NET NativeAOT runtime** | MIT | Not applicable | Yes. **Derived** |
| **.NET Framework 4.8.1** (WPF variant) | Microsoft proprietary; part of Windows 11 | Yes: a System Library. **Derived** | Not applicable (nothing to bundle) |
| **WPF on .NET 10** (`Microsoft.WindowsDesktop.App`) | Managed parts MIT; 3 native DLLs under the .NET Library License, `D3DCompiler_47_cor3.dll` under the Windows SDK license | Unclear. **Lawyer** | Unclear. **Lawyer** |
| **WPF-UI** 4.3.0 | MIT (does not bundle Segoe Fluent Icons) | Yes. **Settled** | Yes. **Settled** |
| **Windows App SDK / WinUI 3** (both deployment modes) | Microsoft Software License Terms (proprietary) | Not without an exception from Read Frog's copyright holders, on the FSF's reading. **Lawyer** | Same, with more proprietary code in-process. **Lawyer** |
| **Avalonia 12, FluentAvalonia 3, SkiaSharp, HarfBuzzSharp, ANGLE** | MIT / BSD | Yes. **Settled** | Yes. **Settled** (the .NET runtime row still applies) |
| **Markdown libraries** named in the comparison | MIT, BSD-2-Clause, Apache-2.0 | Yes. **Settled** | Yes. **Settled** (check bundled grammar sets) |
| **Tauri 2, wry, tao, webview2-com, windows-rs** | Apache-2.0 and/or MIT | Yes. **Settled** | Yes. **Settled** (full crate tree not audited) |
| **MSVC C runtime** (static in Tauri; `vcruntime140_cor3.dll` in WPF) and **UCRT** | Microsoft proprietary | UCRT: an OS component. **Settled** | Static or bundled compiler runtime: the FSF FAQ contradicts itself. **Lawyer** |
| **Fluent UI Web Components**, React, Streamdown and the other web libraries | MIT / Apache-2.0 | Yes. **Settled** | Yes. **Settled** |

The overall picture:

- Every open-source library in the four stacks is GPLv3-compatible.
- Only Microsoft's proprietary binaries raise questions: the Windows App SDK runtime, the WPF native DLLs, the Windows-licensed `coreclr.dll`, a Fixed Version WebView2, and the MSVC runtime.
- Of those, only the Windows App SDK has no MIT, OS-component or separate-process route around it.

## The GPL rules that decide each case

**1. A GPL-compatible license can be combined and bundled.** Combining two programs needs permission under both licenses. If both allow it, they are compatible ([FAQ #WhatIsCompatible](https://www.gnu.org/licenses/gpl-faq.html#WhatIsCompatible)). The FSF lists the Expat ("MIT") license, the Modified (3-clause) and FreeBSD (2-clause) BSD licenses, zlib, ISC, Boost, the Unicode data license, and MPL-2.0 as GPL-compatible. It lists Apache-2.0 as compatible with GPLv3 but not GPLv2, which is fine for GPL-3.0-only ([license list](https://www.gnu.org/licenses/license-list.html#apache2)). **Settled.**

**2. A proprietary library can join a GPL program in only three ways:**

- It is a **System Library** (below).
- It stays a **separate program**, so the zip is an "aggregate". GPLv3 section 5 says an aggregate "does not cause this License to apply to the other parts". The FSF says the line depends on the mechanism and the semantics of communication. Modules in the same executable are "definitely combined"; modules linked into a shared address space are "almost surely" combined; pipes, sockets and command-line arguments normally mean separate programs, "but if the semantics of the communication are intimate enough … that too could be a basis to consider the two parts as combined", which "ultimately judges will decide" ([FAQ #MereAggregation](https://www.gnu.org/licenses/gpl-faq.html#MereAggregation)).
- The **copyright holders grant an additional permission** under section 7.

**3. sidelingo cannot grant that permission for the part that matters.** Only a program's copyright holders can add a linking exception: "if you want to use parts of other GPL-covered programs by other authors in your code, you cannot authorize the exception for them" ([FAQ #GPLIncompatibleLibs](https://www.gnu.org/licenses/gpl-faq.html#GPLIncompatibleLibs); likewise [#InterpreterIncompat](https://www.gnu.org/licenses/gpl-faq.html#InterpreterIncompat)). GPLv3 section 7 adds that when additional permissions cover only part of a program, "the entire Program remains governed by this License without regard to the additional permissions". Read Frog's [LICENSE](https://github.com/mengxi-ream/read-frog/blob/b4a45b9455eb0f63b450cb9610d87ac33883f0e9/LICENSE) is the plain GPLv3 text with no added permissions. Its [README](https://github.com/mengxi-ream/read-frog/blob/b4a45b9455eb0f63b450cb9610d87ac33883f0e9/README.md) says it is "dual-licensed under GPLv3 and a commercial license". **Settled.** The owner can grant exceptions for sidelingo's own code, but the verbatim Read Frog prompts would stay under plain GPLv3.

**4. What counts as a System Library.** GPLv3 section 1 defines System Libraries as "anything, other than the work as a whole, that (a) is included in the normal form of packaging a Major Component, but which is not part of that Major Component, and (b) serves only to enable use of the work with that Major Component, or to implement a Standard Interface for which an implementation is available to the public in source code form." A Major Component is "a major essential component (kernel, window system, and so on) of the specific operating system … or a compiler used to produce the work, or an object code interpreter used to run it." The "Corresponding Source" that must be offered "does not include the work's System Libraries, or general-purpose tools or generally available free programs which are used unmodified". The FAQ says the system library exception covers GPL-incompatible libraries that meet these criteria ([#SystemLibraryException](https://www.gnu.org/licenses/gpl-faq.html#SystemLibraryException)). The FSF rationale adds: "The more low-level the functionality provided by the library, the more likely it is to be qualified for this exception" ([rationale, p. 9](https://gplv3.fsf.org/gpl-rationale-2006-01-16.pdf)).

**5. Whether a System Library may be *bundled* is where the FSF contradicts itself.** This is the key judgement call for a portable zip.

- **For bundling:**
  - GPLv3 section 6 says: "A separable portion of the object code, whose source code is excluded from the Corresponding Source as a System Library, need not be included in conveying the object code work". It regulates *whether* such a portion must be included, not whether it may be.
  - The FSF rationale says GPLv3 "removes the words 'unless that component itself accompanies the executable'" that GPLv2 had ([rationale, p. 9](https://gplv3.fsf.org/gpl-rationale-2006-01-16.pdf)).
  - FAQ #SystemLibraryException says the source requirement does not include System Libraries "even if you distribute a linked executable containing them".
- **Against bundling:** [FAQ #WindowsRuntimeAndGPL](https://www.gnu.org/licenses/gpl-faq.html#WindowsRuntimeAndGPL) calls the Visual C++ runtime a System Library under GPLv3, then says "You may not distribute these libraries in compiled DLL form with the program". It justifies this by claiming "the GPL says that libraries can only qualify as System Libraries as long as they're not distributed with the program itself". That is the GPLv2 rule which the rationale says GPLv3 removed.

**Derived:** the license text and the rationale favour allowing bundled System Libraries, and the #WindowsRuntimeAndGPL answer looks like an unrevised GPLv2-era entry. **Lawyer:** because the FSF publishes both positions, a lawyer should confirm before relying on bundling any Microsoft binary as a System Library.

**6. Microsoft's redistribution terms share one pattern.** The Windows App SDK terms, the .NET Library License and the Windows SDK terms all allow redistributing their binaries inside your application. For any code you distribute, all three require you to:

- add significant primary functionality to it;
- require distributors and end users to agree to terms that protect it at least as much as Microsoft's terms;
- indemnify Microsoft.

All three also forbid distributing the *source code* of the distributable code so that it becomes subject to a license requiring source disclosure or modification rights (the "Excluded License" clause). Sources: the Windows App SDK `license.txt` (below), the [.NET Library License](https://dotnet.microsoft.com/dotnet_library_license.htm) section 3.a, and the [Windows SDK license](https://learn.microsoft.com/legal/windows-sdk/license) section 2.a.

**Derived:** sidelingo never holds or distributes Microsoft's source, so Microsoft's side is satisfied. The conflict is on the GPL side. If a Microsoft binary becomes part of the GPL-covered work, the GPL requires the whole work, including that binary, to be conveyed under the GPL. Section 10 says "You may not impose any further restrictions", and section 12 says that if both sets of obligations can't be met, "you may not convey it at all". A System Library or a separate program falls outside the covered work, so for these binaries everything turns on rules 2, 4 and 5.

## Per-component findings

### Windows App SDK / WinUI 3

**License.**

- Every Windows App SDK component package in the local cache ships the same `license.txt`: "MICROSOFT SOFTWARE LICENSE TERMS / MICROSOFT WINDOWS APP SDK". This covers `Microsoft.WindowsAppSDK` 2.5.1, `.Runtime` 2.5.1, `.WinUI` 2.3.9, `.Foundation` 2.3.12, `.Base` 2.0.4, `.DWrite` 2.1.0 and `.InteractiveExperiences` 2.1.9. See for example the [NuGet page](https://www.nuget.org/packages/Microsoft.WindowsAppSDK.Runtime/2.5.1).
- Section 3.a.i: "Any files that are binplaced with your application by the WindowsAppSDK NuGet package are, by definition, permitted to be redistributed. This applies to both framework package dependent and self-contained deployments." Sections 3.b and 3.c carry the pattern in rule 6.
- The `.ML` package pulled in by the metapackage has a longer license that adds a "Third Party Materials" clause. The comparison notes that referencing only the `.WinUI` component package keeps `.ML` out.

**Is it open source?**

- The [microsoft-ui-xaml](https://github.com/microsoft/microsoft-ui-xaml) and [WindowsAppSDK](https://github.com/microsoft/WindowsAppSDK) repos are MIT-licensed. But the WinUI build guide says "The WinUI OSS effort is still in progress", the XAML compiler "isn't buildable", and `Microsoft.UI.Xaml.Internal.dll` "will not be OSS" ([GettingStarted.md](https://github.com/microsoft/microsoft-ui-xaml/blob/main/GettingStarted.md)).
- The composition, windowing and input binaries come from `Microsoft.WindowsAppSDK.InteractiveExperiences`, which has no source repo: `dcompi.dll`, `CoreMessagingXP.dll`, `Microsoft.UI.Windowing.Core.dll`, `Microsoft.Internal.FrameworkUdk.dll` and others.
- **Settled:** what ships today is Microsoft-licensed binaries, and some of them have no public source.

**Is it a System Library?**

- The deployment guide says developers of unpackaged apps "are responsible for deploying required Windows App SDK runtime packages to their end users", either by running the installer or by installing the MSIX packages ([deploy-unpackaged-apps](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/deploy-unpackaged-apps)). It is not part of the normal packaging of Windows.
- It is a whole UI framework, not something that "serves only to enable use of the work with" Windows, and WinUI's API is not a Standard Interface as GPLv3 defines one.
- **Derived:** it is not a System Library.

**(a) Framework-dependent, runtime already installed.**

- WinUI still loads into sidelingo's process.
- The zip still carries Microsoft-licensed files from the NuGet packages: `Microsoft.WindowsAppRuntime.Bootstrap.dll`, `Microsoft.WindowsAppRuntime.Bootstrap.Net.dll`, and projection assemblies such as `Microsoft.WinUI.dll` and `Microsoft.Windows.*.Projection.dll`. This file list is from the package contents.
- The target framework `net10.0-windows10.0.x` also brings `Microsoft.Windows.SDK.NET.dll`. Its package (`Microsoft.Windows.SDK.NET.Ref`) points to the Windows SDK license ([sdk_license.rtf](https://aka.ms/WinSDKLicenseURL)).
- **Lawyer.** On the FSF's reading (rules 2 and 3), a GPL program linked in-process with a proprietary non-System Library is a combined work, and only the copyright holders of *all* GPL code in it can permit that. For sidelingo that includes Read Frog's.

**(b) Self-contained.** The same analysis applies, with the whole framework bundled and in-process. **Lawyer**, and the weaker of the two cases.

### WebView2 (used by Tauri, and by the WebView options of WinUI, WPF and Avalonia)

**SDK binaries.**

- The `Microsoft.Web.WebView2` 1.0.3719.77 package carries a BSD-3-Clause-style `LICENSE.txt`: "Redistribution and use in source and binary forms, with or without modification, are permitted provided that …". It has three conditions: retain the notice in source, reproduce it in binary distributions, and don't use Microsoft's name for endorsement ([NuGet](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.3719.77/License)).
- That covers `Microsoft.Web.WebView2.Core.dll`, the WPF/WinForms wrappers, and `WebView2Loader.dll` / `WebView2LoaderStatic.lib`. The FSF lists the Modified BSD license as GPL-compatible.
- **Settled:** it can be linked and bundled.
- Correction to the comparison note: its licensing aside said the WebView2 SDK binaries were under Microsoft Software License Terms. The shipped license is BSD-style.

**Evergreen Runtime.**

- "The Evergreen Runtime is preinstalled onto all Windows 11 devices as a part of the Windows 11 operating system" ([evergreen vs fixed](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/evergreen-vs-fixed-version)).
- It runs as its own process group: a browser process, renderer processes and helpers ([process model](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model)). The app talks to it only through the BSD-licensed SDK.
- **Derived:** (a) is fine. It is an OS component that runs as a separate program, so it is not part of the covered work by either route (System Library or aggregate).
- Microsoft still recommends checking that the runtime is present ([distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)). That is a robustness point, not a license one.

**Fixed Version Runtime.**

- Microsoft says you "download a specific version of the WebView2 Runtime and then package it with your WebView2 app", and the binaries "are over 250 MB" ([distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)).
- Its license ships with the download and was not read this session (downloading it needs approval).
- The only version seen is a 2021 Microsoft Edge WebView2 Runtime text quoted in Microsoft's feedback repo ([WebView2Feedback#907](https://github.com/MicrosoftEdge/WebView2Feedback/issues/907)). It has the usual Distributable Code terms, plus "You must acquire all code … directly from Microsoft". It is not current evidence.
- **Lawyer:**
  - For "separate program": it runs out of process, like the Evergreen copy.
  - Against: a browser engine is hardly something that "serves only to enable use of the work with" Windows. The app hosts it through a rich COM interface, which the FAQ's "intimate communication" test could catch. And a bundled copy is no longer the OS's own.
- Size already argues against it.

### .NET runtime

**License.**

- .NET source is MIT. [dotnet/core license-information.md](https://github.com/dotnet/core/blob/main/license-information.md) says product distributions on Windows (installers and runtime packs) use the [.NET Library License](https://dotnet.microsoft.com/dotnet_library_license.htm), a proprietary Distributable Code license.
- [license-information-windows.md](https://github.com/dotnet/core/blob/main/license-information-windows.md) narrows this to specific binaries:
  - Under the .NET Library License: "coreclr.dll and .NET runtimes included in binaries published as single-file (due to extra telemetry …)", `Microsoft.DiaSymReader.Native.*.dll`, `PresentationNative_cor3.dll`, `vcruntime140_cor3.dll` and `wpfgfx_cor3.dll`.
  - Under the Windows SDK license: `D3DCompiler_47_cor3.dll`.
  - "All other binaries and files are licensed with the MIT license."
- **Conflict (Lawyer).** The runtime packs sidelingo would actually ship carry `LICENSE.TXT` = MIT and NuGet metadata `MIT`. That holds for [`Microsoft.NETCore.App.Runtime.win-x64` 10.0.12](https://www.nuget.org/packages/Microsoft.NETCore.App.Runtime.win-x64/10.0.12) and [`Microsoft.WindowsDesktop.App.Runtime.win-x64` 10.0.12](https://www.nuget.org/packages/Microsoft.WindowsDesktop.App.Runtime.win-x64/10.0.12). But [licensing-assets.md](https://github.com/dotnet/runtime/blob/main/docs/project/licensing-assets.md) says on Windows "the license should be the .NET Library License" and that runtime packs "must contain the correct license". Microsoft's own sources disagree about the files in question.

**(a) Framework-dependent.**

- .NET 10 is not preinstalled on Windows 11 (see the comparison), so "preinstalled" means a user who installed it.
- The CLR is "an object code interpreter used to run" the IL, which makes it a Major Component. The FSF says running a program on an interpreter is fine when "the interpreter just interprets", and that bindings the interpreter provides count as linking ([FAQ #InterpreterIncompat](https://www.gnu.org/licenses/gpl-faq.html#InterpreterIncompat)).
- The class libraries that sidelingo binds to are MIT.
- **Derived:** yes for plain .NET. WPF is the exception, see below.

**(b) Self-contained, JIT.**

- The zip carries `coreclr.dll`, which is under the .NET Library License according to license-information-windows.md.
- Arguments for "not part of the covered work":
  - The CLR is the interpreter itself, not a library the work links to.
  - Its source is MIT, so nothing would be missing from Corresponding Source.
- Arguments against: with `PublishSingleFile` the runtime sits in the same executable as sidelingo, and the FAQ calls that "definitely combined".
- **Lawyer.** The folder layout is weaker than framework-dependent; single-file is weaker still.

**(b) NativeAOT.**

- The NativeAOT runtime comes from [`runtime.win-x64.Microsoft.DotNet.ILCompiler` 10.0.12](https://www.nuget.org/packages/runtime.win-x64.Microsoft.DotNet.ILCompiler/10.0.12), which is licensed `MIT`.
- NativeAOT does not use `coreclr.dll`, which is the file the Windows license list names.
- The build forces the UCRT to be linked dynamically: `/NODEFAULTLIB:libucrt.lib /DEFAULTLIB:ucrt.lib` ([Microsoft.NETCore.Native.Windows.targets](https://github.com/dotnet/runtime/blob/release/10.0/src/coreclr/nativeaot/BuildIntegration/Microsoft.NETCore.Native.Windows.targets)). The UCRT "is a Microsoft Windows operating system component" ([UCRT deployment](https://learn.microsoft.com/en-us/cpp/windows/universal-crt-deployment)), so it is a System Library.
- How the rest of the MSVC runtime is linked was not verified; see [MSVC runtime](#msvc-c-runtime-and-ucrt).
- **Derived:** NativeAOT is the cleanest way to ship .NET without a prerequisite. One ambiguity remains: whether the license list's words "binaries published as single-file" were meant to reach NativeAOT output. The stated reason is telemetry in `coreclr/vm`, which NativeAOT does not contain.

**.NET Framework 4.8.1.**

- It is installed by default on every current Windows 11 release, and ".NET Framework will continue to be included with Windows" ([versions and dependencies](https://learn.microsoft.com/en-us/dotnet/framework/install/versions-and-dependencies)).
- **Derived:** it meets the System Library definition, and a zip that targets it bundles no Microsoft runtime at all.
- WPF-UI targets .NET Framework 4.6.2+ (per the comparison). This is a licensing observation only; the comparison did not evaluate this variant.

### WPF on .NET 10

**License.** The managed WPF assemblies are MIT. Four native DLLs are not, per the list above: `PresentationNative_cor3.dll`, `wpfgfx_cor3.dll` and `vcruntime140_cor3.dll` are under the .NET Library License, and `D3DCompiler_47_cor3.dll` is under the Windows SDK license. All four sit in `runtimes/win-x64/native` of the WindowsDesktop runtime pack.

**(a) Framework-dependent, .NET Desktop Runtime installed.**

- WPF's native renderer loads into sidelingo's process.
- It is packaged with the .NET Desktop Runtime, not with Windows. As a UI framework, it does more than "serve only to enable use of the work with" the CLR.
- `vcruntime140_cor3.dll` is a compiler runtime, which the FAQ treats as a System Library.
- **Lawyer.**

**(b) Self-contained.** The zip carries all four DLLs plus `coreclr.dll`. WPF can't use NativeAOT, so `coreclr.dll` can't be avoided. **Lawyer.**

**WPF-UI.**

- MIT ([NuGet](https://www.nuget.org/packages/WPF-UI/4.3.0)). The package contains no font files.
- Its `ThirdPartyNotices.txt` quotes the Segoe Fluent Icons terms, which allow use only "to design, develop and test your programs" and grant no right "to distribute or sublicense". WPF-UI relies on the copy of that font that comes with Windows 11.
- **Settled:** (a) and (b) are fine, as long as sidelingo doesn't bundle the font either.

### Avalonia 12 + FluentAvalonia 3

**Licenses.** All of these are GPLv3-compatible. **Settled.**

| Package | License |
| --- | --- |
| `Avalonia`, `Avalonia.Win32`, `Avalonia.Skia`, `Avalonia.HarfBuzz` 12.1.3 | MIT |
| `Avalonia.Controls.WebView` 12.1.0 | MIT |
| `FluentAvaloniaUI` 3.1.0 | MIT ([repo](https://github.com/amwx/FluentAvalonia)) |
| `SkiaSharp` 3.119.4, `HarfBuzzSharp` 8.3.1.3 | MIT |
| `Avalonia.Angle.Windows.Natives` (`av_libglesv2.dll`) | ANGLE's BSD-3-Clause license |

**Notes.**

- The native SkiaSharp package's `THIRD-PARTY-NOTICES.txt` also lists BSD, zlib, IJG, Apache-2.0, FreeType and LGPL components.
  - FreeType is dual-licensed with GPLv2 "or any later version".
  - LGPL code may be conveyed under the GPL.
- FluentAvalonia embeds `FluentAvalonia.ttf`. Its symbol enum says the glyphs are "derived from the FluentUI Icons font" ([FASymbol.cs](https://github.com/amwx/FluentAvalonia/blob/master/src/FluentAvalonia/UI/Controls/IconElement/FASymbol.cs)), and [Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons) is MIT. **Derived** from that source comment; the font file's own metadata was not checked.

**Verdict.**

- (a) and (b) are fine for the Avalonia libraries. **Settled.**
- The .NET runtime still decides the zip: a trimmed self-contained build carries `coreclr.dll` (**Lawyer**), while NativeAOT does not (**Derived** fine).
- Avalonia's WebView falls under the WebView2 rules.

### Markdown libraries named in the comparison

All of these are GPLv3-compatible. Licenses are from the NuGet and npm registries, latest versions as of today. **Settled.**

| Library | License |
| --- | --- |
| Markdig 1.4.0 | BSD-2-Clause |
| CommunityToolkit Labs `MarkdownTextBlock` 0.1.x | MIT |
| MdXaml | MIT |
| AvalonEdit | MIT |
| LiveMarkdown.Avalonia 2.4.3 | Apache-2.0 |
| TextMateSharp, TextMateSharp.Grammars, Onigwrap (LiveMarkdown.Avalonia dependencies) | MIT |
| Markdown.Avalonia 12.0.0-a3 | MIT |
| CSharpMath.Avalonia | MIT |
| Streamdown 2.6.0 | Apache-2.0 |
| react-markdown 10.1.0 | MIT |
| KaTeX | MIT |
| Shiki | MIT |
| Mermaid | MIT |
| marked | MIT |
| markdown-it | MIT |

One caveat is **Derived** and was not checked: grammar bundles (TextMateSharp.Grammars, Shiki's language grammars) collect grammars from many upstream projects. Check the licenses of the subset sidelingo ships.

### Tauri 2 and its main crates

**Licenses.** All are compatible. **Settled.**

| Crate or package | License |
| --- | --- |
| `tauri` workspace at `tauri-v2.12.0` | `Apache-2.0 OR MIT` ([Cargo.toml](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.0/Cargo.toml)) |
| `wry` (0.57.0 on the default branch) | `Apache-2.0 OR MIT` ([Cargo.toml](https://github.com/tauri-apps/wry/blob/dev/Cargo.toml)) |
| `tao` (0.37.1 on the default branch) | `Apache-2.0` ([Cargo.toml](https://github.com/tauri-apps/tao/blob/dev/Cargo.toml)) |
| `windows` (windows-rs) | `MIT OR Apache-2.0` |
| `webview2-com` 0.39.1 | MIT ([repo](https://github.com/wravery/webview2-rs)) |
| `@tauri-apps/api` 2.12.0 | `Apache-2.0 OR MIT` |

**Notes.**

- `webview2-com-sys` statically links Microsoft's `WebView2LoaderStatic.lib` by default on MSVC targets ([README](https://github.com/wravery/webview2-rs), `link(name = "WebView2LoaderStatic", kind = "static")`). That library comes from the BSD-licensed WebView2 SDK, so it is fine.
- By default, `tauri-build` statically links the MSVC compiler runtime and dynamically links the UCRT. `staticVCRuntime` defaults to true ([config.rs](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.0/crates/tauri-utils/src/config.rs)), and the link arguments are `/DEFAULTLIB:libcmt.lib`, `/DEFAULTLIB:libvcruntime.lib` and `/DEFAULTLIB:ucrt.lib` ([static_vcruntime.rs](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.0/crates/tauri-build/src/static_vcruntime.rs)). See the next section.
- Not audited: the full transitive crate tree, because Rust isn't installed here. **Derived:** a license checker such as `cargo deny check licenses` on the real `Cargo.lock` should confirm that everything is in the compatible set (MIT, Apache-2.0, BSD, ISC, zlib, Unicode, MPL-2.0).
- Fluent UI Web Components 3.1.3 and Fluent UI React v9 (`@fluentui/react-components` 9.74.9) are MIT, and React 19 is MIT (npm). **Settled.**

**Verdict:** (a) and (b) are fine for everything Tauri itself ships. WebView2 follows its own rules.

### MSVC C runtime and UCRT

This affects every stack: static in Tauri, possibly in NativeAOT, as a bundled DLL in WPF (`vcruntime140_cor3.dll`), and as a prerequisite of framework-dependent Windows App SDK apps ([deploy-unpackaged-apps](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/deploy-unpackaged-apps)).

- **UCRT:** an OS component on Windows 10 and later ([UCRT deployment](https://learn.microsoft.com/en-us/cpp/windows/universal-crt-deployment)). It is a System Library. NativeAOT and Tauri link it dynamically (see above); the other stacks' linking was not checked. **Settled.**
- **Compiler runtime (`vcruntime`, `libcmt`):** the FSF says the Visual C++ runtime libraries "are 'System Libraries' as GPLv3 defines them" ([FAQ #WindowsRuntimeAndGPL](https://www.gnu.org/licenses/gpl-faq.html#WindowsRuntimeAndGPL)). That settles (a).
- Shipping it inside the exe or next to it runs into the FAQ contradiction in [rule 5](#the-gpl-rules-that-decide-each-case). **Lawyer**, though this is the situation of every MSVC-built GPL program for Windows.

## Questions for a lawyer

1. Under GPLv3, may a System Library be bundled in the same zip or statically linked into the same exe? The GPLv3 text and rationale say yes; FAQ #WindowsRuntimeAndGPL says no. This covers the MSVC runtime in every stack.
2. Is a GPL-3.0-only program that dynamically loads Microsoft's Windows App SDK runtime (framework-dependent or self-contained) a combined work that needs permission from Read Frog's copyright holders?
3. Is a self-contained .NET app's `coreclr.dll` part of the covered work? It is .NET Library License per dotnet/core, but MIT per the runtime pack itself. Does single-file change the answer?
4. Are WPF's native DLLs (`wpfgfx_cor3.dll`, `PresentationNative_cor3.dll`, `D3DCompiler_47_cor3.dll`) acceptable, whether bundled or from an installed .NET Desktop Runtime?
5. Is a bundled Fixed Version WebView2 Runtime a separate program? And what do its current license terms say?
6. Does it matter how the Read Frog text is embedded? For example, prompts compiled into the binary versus a separate GPL data file read at runtime. If it does, owner-granted section 7 exceptions for sidelingo's own code could cover the proprietary runtimes.
7. The alternatives the FAQ points to: a linking exception from Read Frog's copyright holders, or Read Frog's commercial license.
