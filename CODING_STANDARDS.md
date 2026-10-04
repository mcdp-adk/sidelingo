# Coding standards

Read during review. Each rule is a judgement call no automated check can make.

## Tests

Tests come in five layers, and each contract has one owning test at the layer that proves it best (ADR 0006). Every new or changed test passes the `test-audit` skill's authoring gate: it names the behaviour it protects and the regression that would break it, no test elsewhere already owns that, and it needs no production seam that no production caller needs.

- Every assertion can go red today: name the break in the app that would fail it. An assertion that compares two empty values, or guards a feature that doesn't exist yet, waits for the ticket that brings the feature.
- A test's name promises only what its assertions check.
- Expected values come from the spec or a worked example, never from the code under test.
- A test drives its layer's interface the way that layer's caller does, and checks only what that caller can observe. The app carries no code that exists only for tests.
- Fakes sit only at process edges: the Provider (over HTTP, or the transport in the core), the Rust side (in the core), and the other programs that write the clipboard.
- A contract moving to its owner deletes the tests it replaces, and the PR lists each one with what it could detect and its new owner. A test with no owner stays until it gets one.

### User tasks (`pnpm test:e2e`)

- One test per user task, walking it start to finish. Behaviour visible only in a real webview, such as the split orientation or synced scrolling, is a step in the task where a user meets it.
- Each test launches the app itself (`relaunch`), so it passes alone and in any order. It starts from an empty data folder and configures sidelingo through its UI. It seeds `settings.json` only when the task is about that document, such as a broken file.
- A test observes what a user sees on screen, what lands on the clipboard, and what the Provider receives when the task is about the request.
- Tests find elements as a user does: by role (`[role=toolbar]`, a paragraph), accessible name, or visible text, never by class or component structure. Finding one by its position (the toolbar's last button) is fine when the test's name promises that position.
- The older spec files in `e2e/specs/` predate these rules. They are retired as their contracts find owners, and new tests go to their owning layer instead.

### Webview core (`pnpm test`)

- Tests start the core with `startCore` (`src/testing/core.ts`): the settings store and one Session, as the Pin webview starts them. The Rust side is played through Tauri's IPC mocks and the network through `FakeTransport`. No test mocks an app module or a plugin.
- A test observes only the Session's published state, the requests the fake transport received, and the Rust commands the core invoked.
- Each rule is a row in a table-driven case (`it.each`). A new rule adds a row rather than a test of its own.
- A test never depends on the machine's locale. The setup file sets `navigator.language` to `en-US`, and a test about another locale stubs it and re-imports the modules.
- Test files sit beside the module whose rules they prove, named `*.test.ts`.

### Rust modules (`cargo test`)

- `#[cfg(test)]` tests cover only logic that is already pure. No function is split out to make it testable.

### Real Provider (`pnpm test:real`)

- A real-Provider check runs only through its own script, never through `pnpm test` or CI. It reads its key from the environment and never enters, prints or writes it.

### Desktop checklist

- What needs real input, or shows only outside the webview, is a checklist item run with computer-use, not a test. Each release runs the whole checklist, and each PR runs the items it touches.
