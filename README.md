# sidelingo

sidelingo is a Windows 11 desktop companion that structures text or images from your clipboard, translates them, and shows the results in a Pin window.

## Installation

Download the Windows `*-setup.exe` installer and its matching `.sha256` file from the [latest release](https://github.com/mcdp-adk/sidelingo/releases/latest). In PowerShell, from the download folder, verify the installer before running it:

```powershell
$checksum = Get-Content .\sidelingo_0.1.0_x64-setup.exe.sha256
$expected = ($checksum -split '\s+')[0]
$actual = (Get-FileHash .\sidelingo_0.1.0_x64-setup.exe -Algorithm SHA256).Hash
if ($actual -ne $expected) { throw 'Checksum mismatch: do not run this installer.' }
```

Replace the example filenames with the version you downloaded. The installer needs no administrator rights and installs into `%LOCALAPPDATA%\sidelingo`. It creates a Start menu entry and offers a desktop shortcut. The installer uses Simplified Chinese for a Chinese Windows display language, and English otherwise.

The installer is not Authenticode-signed. If Microsoft Defender SmartScreen displays “Windows protected your PC”, choose **More info → Run anyway** after checking the download. **Smart App Control blocks this unsigned installer**, so a PC enforcing it cannot install sidelingo. The updater's signature authenticates updates; it does not replace Windows Authenticode signing.

Settings and window state are stored in `%APPDATA%\io.github.mcdp-adk.sidelingo`; WebView2 data is in `%LOCALAPPDATA%\io.github.mcdp-adk.sidelingo`. During uninstall, the **delete application data** option removes both folders. Leave it unchecked to retain settings.

## Development

On Windows 11, with Node.js 24, pnpm (the version in `package.json`'s `packageManager`), Rust, and the MSVC build tools:

```bash
pnpm install
cargo install cargo-about --version 0.9.2 --locked --features cli
pnpm typecheck
pnpm tauri dev
```

### Repository layout

- `.github/`: the CI and release workflows.
- `docs/`: architecture decision records (`docs/adr/`), agent guides (`docs/agents/`), and the desktop checklist (`docs/desktop-checklist.md`).
- `e2e/`: the user task tests (`e2e/tasks/`, one file per task) and their harness (`e2e/support/`).
- `scripts/`: build and check scripts, such as the third-party notice generator and the task test check (`check-tasks.mjs`).
- `src/`: the front end. Its shared files (`main.tsx`, `global.css`, `i18n.ts`, `theme.ts`, `languages.ts`) sit at the top, and each concept from `GLOSSARY.md` has a folder:
  - `src/round/`: the Round pipeline and its prompts.
  - `src/session/`: following Inputs, reuse, cancellation and pause.
  - `src/provider/`: the Provider client, Presets and keys.
  - `src/settings/`: the settings document and its store.
  - `src/updates/`: update checks.
  - `src/pin-window/`: the Pin window UI.
  - `src/settings-window/`: the settings window and its sections.
  - `src/testing/`: the webview core's test harness: a fake transport for the Provider, and the Rust side played through Tauri's IPC mocks.
- `src-tauri/`: the Rust side, with its Tauri configurations, capabilities, icons and installer hooks.

Tests sit beside the module they test.

### Installer builds and releases

`pnpm tauri build` generates the frontend and Rust third-party license texts before building and packages `THIRD-PARTY-NOTICES.html` beside the installed executable. `pnpm notices` generates that file on its own. Debug builds also copy it to their resource directory, so About uses the same resource path in development and installed builds. New npm packages that omit license text fail the build until their upstream notice is supplied; the existing omissions are documented in `scripts/licenses/README.md`.

The owner selects each release version. Set that version in `package.json`, `src-tauri/Cargo.toml` (and its lockfile) and `src-tauri/tauri.conf.json` before pushing its `vX.Y.Z` tag. The release workflow checks that they match, builds the per-user NSIS installer, signs updater artifacts through the repository's `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets, and publishes a normal GitHub Release with the installer, signature, `latest.json` and SHA-256 checksum. No private updater key belongs in this repository.

Published-release acceptance still requires checking the downloaded checksum and verifying the updater signature against the configured public key. Installer and uninstall behavior require desktop verification.

For interactive desktop development, including GUI automation, use:

```bash
pnpm dev:desktop
```

This mode uses an unowned window that appears in the taskbar and Alt+Tab and does not stay on top. It shares the regular UI and interactions, with a separate application identifier and independent application data. The `desktop-dev` Cargo feature is limited to debug builds.

Use regular mode (`pnpm tauri dev`) for the final verdict on always-on-top behavior, taskbar and Alt+Tab exclusion, and tray behavior. Desktop development mode does not replace those acceptance checks. The regular development, end-to-end test, and release commands keep their existing behavior.

### Tests

Tests come in five layers, and each behaviour has one owning test at the layer that proves it best. ADR 0006 records why, and `CODING_STANDARDS.md` holds the rules for each layer.

| Layer | Command | Runs |
| --- | --- | --- |
| User tasks | `pnpm test:e2e` | Locally, before a PR that changes code merges |
| Webview core | `pnpm test` | In CI on every PR |
| Rust modules | `cargo test`, in `src-tauri/` | In CI on every PR |
| Real Provider | `pnpm test:real` | Locally, before a release and when a change touches the Provider client or a prompt |
| Desktop checklist | [`docs/desktop-checklist.md`](docs/desktop-checklist.md), with computer-use | Before each release, plus the items a PR touches |

CI also runs type-checking, `pnpm format:check`, `pnpm check:tasks`, `cargo fmt --check` and Clippy. It can't run the user tasks: GitHub-hosted Windows runners are elevated, and WebView2 ignores its `WEBVIEW2_*` environment variables under an elevated host, so the WebDriver debugging port never arrives ([tauri-apps/wry#1782](https://github.com/tauri-apps/wry/issues/1782)). Revisit once wry passes that setting through its own API.

#### Webview core

```bash
pnpm test
```

Vitest runs the webview core's rules in Node, without launching the app.

#### Rust modules

```bash
cd src-tauri
cargo test
```

It covers the Rust logic that is already pure: the settings document and notification links.

#### Real Provider

```bash
pnpm test:real
```

It runs one multi-line text Round and one image Round through the Provider client against OpenRouter (`~openai/gpt-luna-latest`, reasoning effort `low`), and passes when both finish with non-empty text. It reads the key from `OPENROUTER_API_KEY` and spends a few tokens. Neither `pnpm test` nor CI runs it.

#### User tasks

Each test walks one user task through a debug build, driven through WebDriver. They need two tools on `PATH`:

```bash
cargo install tauri-driver --locked
cargo install --git https://github.com/chippers/msedgedriver-tool --rev 8c4b34f5 --locked
```

```bash
pnpm test:e2e
```

It builds the app with its own identifier (`src-tauri/tauri.e2e.conf.json`) into `src-tauri/target/e2e`, so it never touches your own sidelingo's data or a running copy. `pnpm build:e2e` makes that build alone. That build checks for updates at a local endpoint the tests serve on port 47561, not on GitHub. It also writes the Windows clipboard, so only one run uses a machine at a time: a second run stops at once, naming the process that holds the run.

A failing test leaves a screenshot and the page's HTML in `e2e/failures/`, cleared at the start of each run.

`pnpm check:tasks`, which CI runs, refuses a task test or support helper that finds an element by class, `#id`, another attribute or XPath, and a task test that seeds or reads the settings document.

### Structuring eval

```bash
pnpm eval:structuring
```

It runs every synthetic fixture in `eval/structuring/fixtures.ts` through a whole Round against OpenRouter (`~openai/gpt-luna-latest`) and Ollama Cloud (`deepseek-v4.1-flash`), both at reasoning effort `low`. It reads the keys from `OPENROUTER_API_KEY` and `OLLAMA_API_KEY`. For each fixture and model it writes the Source text, the Translated text, the outcome and the time to the first Translated token into `eval/structuring/output/<label>/`, which git ignores. Each model's `summary.md` adds the median time to the first Translated token per group and for every single line. It has no pass or fail: read each output against its fixture's note. Neither `pnpm test` nor CI runs it.

- `EVAL_LABEL` names the run's folder (default `latest`). A run replaces only its own folder, so a `before` run stays beside an `after` run.
- `EVAL_ONLY` runs only the fixtures named, or in a group named, in a comma-separated list, such as `EVAL_ONLY=one-line,lone-url`. Run the whole set once before stating conclusions in a PR.
