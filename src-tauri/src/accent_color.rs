use windows::UI::ViewManagement::{UIColorType, UISettings};

/// The system accent colour as `#rrggbb`, or none when Windows can't say. The
/// WebView's CSS `AccentColor` is Chromium's own blue, not the system's.
#[tauri::command]
pub fn accent_color() -> Option<String> {
    let color = UISettings::new()
        .ok()?
        .GetColorValue(UIColorType::Accent)
        .ok()?;
    Some(format!("#{:02x}{:02x}{:02x}", color.R, color.G, color.B))
}
