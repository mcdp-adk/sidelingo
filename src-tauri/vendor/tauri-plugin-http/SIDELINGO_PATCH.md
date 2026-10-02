# Pending response-read cancellation

This is the Rust portion of the published `tauri-plugin-http` 2.8.0 crate,
including its required global API build script, original permissions and license files. Its public JavaScript API,
native commands, request scope checks, proxy behavior, and features are unchanged.

The local change in `src/commands.rs` makes closing a response resource signal a
pending body read. The read races cancellation against the next chunk and drops
the native response on cancellation. A mutex replaces the upstream raw-pointer
mutation while retaining the response's resource-table identity.

Without the latch, `fetch_cancel_body` removes the table entry but a pending
`fetch_read_body` retains an `Arc` and the HTTP connection stays open until more
data arrives. Sidelingo ticket 48's real-clipboard/fake-Provider test catches this
by holding an old Structuring response while a new Input finishes Translation,
then requiring the old response to close before the server completes it.

Source: <https://crates.io/crates/tauri-plugin-http/2.8.0>

Recheck this patch when upgrading the HTTP plugin. Remove the path patch once an
upstream version cancels pending native reads and the same test passes unchanged.
