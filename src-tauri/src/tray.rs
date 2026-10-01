use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::AppHandle;

use crate::ui_language::UiLanguage;
use crate::{pin_window, settings_window};

const SHOW: &str = "show";
const SETTINGS: &str = "settings";
const QUIT: &str = "quit";

struct Labels {
    show: &'static str,
    settings: &'static str,
    quit: &'static str,
}

fn labels(language: UiLanguage) -> Labels {
    match language {
        UiLanguage::ZhHans => Labels {
            show: "显示",
            settings: "设置",
            quit: "退出",
        },
        UiLanguage::En => Labels {
            show: "Show",
            settings: "Settings",
            quit: "Quit",
        },
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let labels = labels(UiLanguage::current());
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, SHOW, labels.show, true, None::<&str>)?,
            &MenuItem::with_id(app, SETTINGS, labels.settings, true, None::<&str>)?,
            &MenuItem::with_id(app, QUIT, labels.quit, true, None::<&str>)?,
        ],
    )?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("tray icon".into()))?;
    TrayIconBuilder::new()
        .icon(icon)
        .tooltip("sidelingo")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            SHOW => pin_window::show(app),
            SETTINGS => {
                // WebView2 window creation cannot run in a synchronous event handler.
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = settings_window::show(&app) {
                        eprintln!("failed to open Settings: {error}");
                    }
                });
            }
            QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                pin_window::show(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}
