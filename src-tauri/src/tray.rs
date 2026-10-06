use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::look;
use crate::ui_language::UiLanguage;
use crate::{pin_window, settings_window};

const SHOW: &str = "show";
const SETTINGS: &str = "settings";
const UPDATE: &str = "update";
const QUIT: &str = "quit";

struct Labels {
    show: &'static str,
    settings: &'static str,
    quit: &'static str,
    update_to: &'static str,
}

fn labels(language: UiLanguage) -> Labels {
    match language {
        UiLanguage::ZhHans => Labels {
            show: "显示",
            settings: "设置",
            quit: "退出",
            update_to: "更新至",
        },
        UiLanguage::En => Labels {
            show: "Show",
            settings: "Settings",
            quit: "Quit",
            update_to: "Update to",
        },
    }
}

#[tauri::command]
pub fn set_update_offer(
    app: AppHandle,
    version: Option<String>,
    enabled: bool,
) -> Result<(), String> {
    let menu = app.state::<Menu<tauri::Wry>>();
    let existing = menu.get(UPDATE);
    match version {
        Some(version) => {
            let text = format!("{} {version}", labels(UiLanguage::current()).update_to);
            if let Some(existing) = existing {
                let item = existing
                    .as_menuitem()
                    .ok_or_else(|| "update menu item has an unexpected type".to_string())?;
                item.set_text(text).map_err(|error| error.to_string())?;
                item.set_enabled(enabled)
                    .map_err(|error| error.to_string())?;
            } else {
                let item = MenuItem::with_id(&app, UPDATE, text, enabled, None::<&str>)
                    .map_err(|error| error.to_string())?;
                menu.insert(&item, 2).map_err(|error| error.to_string())?;
            }
        }
        None => {
            if let Some(existing) = existing {
                menu.remove(&existing).map_err(|error| error.to_string())?;
            }
        }
    }
    Ok(())
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
    app.manage(menu.clone());

    TrayIconBuilder::new()
        .icon(look::SMALL_ICON)
        .tooltip("Sidelingo")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            SHOW => pin_window::show(app),
            SETTINGS => settings_window::show_from_event_handler(app),
            QUIT => app.exit(0),
            UPDATE => {
                if let Err(error) = app.emit_to(pin_window::LABEL, "update-install-requested", ()) {
                    eprintln!("failed to request update installation: {error}");
                }
            }
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
