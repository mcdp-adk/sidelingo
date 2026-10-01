# sidelingo

## Development

On Windows 11, with Node.js 24, pnpm (the version in `package.json`'s `packageManager`), Rust, and the MSVC build tools:

```bash
pnpm install
pnpm typecheck
pnpm tauri dev
```

For interactive desktop development, including GUI automation, use:

```bash
pnpm dev:desktop
```

This mode uses an unowned window that appears in the taskbar and Alt+Tab and does not stay on top. It shares the regular UI and interactions, with a separate application identifier and independent application data. The `desktop-dev` Cargo feature is limited to debug builds.

Use regular mode (`pnpm tauri dev`) for the final verdict on always-on-top behavior, taskbar and Alt+Tab exclusion, and tray behavior. Desktop development mode does not replace those acceptance checks. The regular development, end-to-end test, and release commands keep their existing behavior.

### End-to-end tests

The suite drives a debug build through WebDriver. It needs two tools on `PATH`:

```bash
cargo install tauri-driver --locked
cargo install --git https://github.com/chippers/msedgedriver-tool --rev 8c4b34f5 --locked
```

```bash
pnpm test:e2e
```

It builds the app with its own identifier (`src-tauri/tauri.e2e.conf.json`) into `src-tauri/target/e2e`, so it never touches your own sidelingo's data or a running copy. It also writes the Windows clipboard.

A failing test leaves a screenshot and the page's HTML in `e2e/failures/`, cleared at the start of each run.
