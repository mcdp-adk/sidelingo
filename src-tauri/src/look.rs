//! The native half of the look module (`src/look/`): what every sidelingo webview takes
//! from Windows rather than from the browser engine.
use tauri::image::Image;
use tauri::webview::ScrollBarStyle;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindowBuilder};
use windows::core::{IInspectable, Ref};
use windows::Foundation::TypedEventHandler;
use windows::UI::ViewManagement::{UIColorType, UISettings};

/// The event every webview receives with the new accent when Windows' accent changes.
const ACCENT_CHANGED: &str = "accent-changed";

/// The tray's and the windows' icon, which Windows only shows at 16–24 px: the simplified
/// `icons/icon-small.svg`, since the full icon's lettering blurs together at those sizes.
pub const SMALL_ICON: Image<'static> = tauri::include_image!("icons/icon-small.png");

/// Fluent overlay scrollbars, as in Edge, no browser autofill popups under text fields, and the
/// small icon. Both windows must go through this, since WebView2 fixes the scrollbar style per
/// environment.
pub fn webview_defaults<'a, R: Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> tauri::Result<WebviewWindowBuilder<'a, R, M>> {
    builder
        .scroll_bar_style(ScrollBarStyle::FluentOverlay)
        .general_autofill_enabled(false)
        .icon(SMALL_ICON)
}

/// The system accent colour as `#rrggbb`, or none when Windows can't say. The
/// WebView's CSS `AccentColor` is Chromium's own blue, not the system's.
#[tauri::command]
pub fn accent_color() -> Option<String> {
    accent_of(&UISettings::new().ok()?)
}

fn accent_of(settings: &UISettings) -> Option<String> {
    let color = settings.GetColorValue(UIColorType::Accent).ok()?;
    Some(format!("#{:02x}{:02x}{:02x}", color.R, color.G, color.B))
}

/// Keeps the `UISettings` whose colour changes sidelingo follows; dropping it would end them.
struct AccentFollower(#[allow(dead_code)] UISettings);

/// Tells every webview the new accent whenever Windows' colours change, as the browser engine
/// already does for light and dark.
pub fn follow_accent(app: &AppHandle) -> windows::core::Result<()> {
    let settings = UISettings::new()?;
    let handle = app.clone();
    settings.ColorValuesChanged(&TypedEventHandler::new(
        move |sender: Ref<UISettings>, _: Ref<IInspectable>| {
            if let Some(accent) = sender.as_ref().and_then(accent_of) {
                if let Err(error) = handle.emit(ACCENT_CHANGED, accent) {
                    eprintln!("failed to send the new accent: {error}");
                }
            }
            Ok(())
        },
    ))?;
    app.manage(AccentFollower(settings));
    Ok(())
}
