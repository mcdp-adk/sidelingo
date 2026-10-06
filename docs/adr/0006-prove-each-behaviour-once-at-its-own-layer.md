# Prove each behaviour once, at the layer that proves it best

sidelingo's tests form five layers, and each contract has exactly one owning test, at the layer that proves it best. This replaces v1's "end-to-end on the built app (the main seam)" (#29 → Testing Decisions). With e2e as the main seam, about 160 tests took 11–12 minutes before every code PR. Most of them replayed one branch of a small rule at the cost of an app launch, or asserted request shapes and settings fields. None of them walked a task from a fresh install, and the desktop check of PR #70 found six problems the suite had missed. The window's logic could only be reached by launching the app, because the Round bound Tauri's `fetch` when its module loaded and the Session kept its state in module globals.

| Layer | Proves | Runs |
| --- | --- | --- |
| User tasks | A user can complete each of the 13 tasks, start to finish, through the UI from an empty data folder | The built app on the real clipboard, against the fake Provider; locally before a code PR merges |
| Webview core | Every rule inside the window's logic: following Inputs, reuse, cancellation, pause, Structuring and Translation, errors and hints, configuration readiness, settings parsing, the Provider client | Vitest (`pnpm test`), in CI on every PR |
| Rust modules | Each Rust module's own rules, through its functions and commands: the settings document, notification links | `cargo test`, in CI on every PR |
| Real Provider | A real model still answers a Round through the Provider client | Locally, before a release and when the Provider client or a prompt changes |
| Desktop checklist | sidelingo works on the desktop: always on top, tray, hotkey, notifications, appearance, installer, updates | Computer-use, before each release, plus the items a PR touches |

- **One owner per contract.** A rule is a row in its layer's table-driven test. Another layer may exercise the same behaviour only for a risk the owner can't reach. For example, a core row owns "a 400 for an image Input shows the image hint", while the task layer proves only that an error shows, offers Open settings, and can be recovered from.
- **Fakes sit only at process edges.** The core creates a Session with a fetch-shaped transport, which is Tauri's HTTP `fetch` in the app and a scripted fake in tests. It plays the Rust side through Tauri's own IPC mocks. The task layer fakes only the Provider over HTTP and the other programs that write the clipboard. No production code exists only for tests.
- **CI runs every layer that needs no desktop and spends no tokens.** The task layer can't run in CI: WebView2 fails under GitHub's elevated hosted runners (tauri-apps/wry#1782).

## Considered Options

- **Keep e2e as the main seam and prune it**: each rule would still cost an app launch, and the suite would still prove the rules more than the tasks.
- **A React component-test layer**: control states derive from the Session's published state, which the core covers, and the task layer covers rendering. A third place to test the same behaviour would split ownership.
- **Mock `@tauri-apps/plugin-http` in the core**: it fakes a module rather than an edge, and leaves the Round's load-time binding in place. Passing the transport into the Session uses the seam the Provider client already has.

## Consequences

- Moving a contract to its owner deletes the tests it replaces. Each deleted test is recorded with what it could detect and which test owns that now. A test with no owner stays until it gets one.
- Structuring quality (#63) is judged by an eval script with no pass or fail, outside these layers.
- `CODING_STANDARDS.md` holds the testing rules for every layer.
