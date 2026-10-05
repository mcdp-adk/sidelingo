//! The native half of the look module (`src/look/`): what every sidelingo webview takes
//! from Windows rather than from the browser engine.
use tauri::webview::ScrollBarStyle;
use tauri::{Manager, Runtime, WebviewWindowBuilder};

/// Fluent overlay scrollbars, as in Edge, and no browser autofill popups under text fields.
/// Both windows must go through this, since WebView2 fixes the scrollbar style per environment.
pub fn webview_defaults<'a, R: Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    builder
        .scroll_bar_style(ScrollBarStyle::FluentOverlay)
        .general_autofill_enabled(false)
}
