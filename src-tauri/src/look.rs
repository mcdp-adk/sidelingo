// PROTOTYPE (branch prototype/winui-look): the native half of the look module, to be folded into main once reviewed.
use tauri::webview::ScrollBarStyle;
use tauri::{Manager, Runtime, WebviewWindowBuilder};

/// What every sidelingo webview takes from Windows rather than from the browser engine:
/// Fluent overlay scrollbars like Edge's, and no browser autofill popups under text fields.
/// Both windows must agree, since WebView2 fixes the scrollbar style per environment.
pub fn webview_defaults<'a, R: Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    builder
        .scroll_bar_style(ScrollBarStyle::FluentOverlay)
        .general_autofill_enabled(false)
}
