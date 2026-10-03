//! Best-effort Windows desktop notifications using the app's installed identity.
//!
//! Desktop toasts require a Start menu shortcut with a matching AppUserModelID;
//! Tauri's NSIS bundle supplies the configured application identifier. See
//! https://learn.microsoft.com/en-us/windows/win32/shell/quickstart-sending-desktop-toast.

use std::sync::mpsc::{self, Sender};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use windows::core::{IInspectable, Interface, HSTRING};
use windows::Data::Xml::Dom::{XmlDocument, XmlElement};
use windows::Foundation::TypedEventHandler;
use windows::Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED};
use windows::UI::Notifications::{ToastNotification, ToastNotificationManager, ToastNotifier};

use crate::settings_window;

enum Message {
    Show {
        title: String,
        body: String,
        target: Option<NotificationTarget>,
    },
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NotificationTarget {
    Hotkey,
}

pub struct NotificationState {
    sender: Mutex<Option<Sender<Message>>>,
    pending_target: Mutex<Option<NotificationTarget>>,
}

impl NotificationState {
    pub fn start(app: &AppHandle) {
        let (sender, receiver) = mpsc::channel();
        app.manage(Self {
            sender: Mutex::new(Some(sender)),
            pending_target: Mutex::new(None),
        });

        let app = app.clone();
        let worker_app = app.clone();
        if let Err(error) = std::thread::Builder::new()
            .name("sidelingo-notifications".into())
            .spawn(move || run(worker_app, receiver))
        {
            eprintln!("failed to start native notification worker: {error}");
            if let Some(state) = app.try_state::<Self>() {
                if let Ok(mut sender) = state.sender.lock() {
                    *sender = None;
                }
            }
        }
    }
}

#[tauri::command]
pub fn show_native_notification(
    state: State<'_, NotificationState>,
    title: String,
    body: String,
    target: Option<NotificationTarget>,
) {
    let Ok(sender) = state.sender.lock() else {
        eprintln!("native notification sender state is unavailable");
        return;
    };
    if let Some(sender) = sender.as_ref() {
        if sender
            .send(Message::Show {
                title,
                body,
                target,
            })
            .is_err()
        {
            eprintln!("native notification worker is unavailable");
        }
    }
}

#[tauri::command]
pub fn take_notification_target(state: State<'_, NotificationState>) -> Option<NotificationTarget> {
    state
        .pending_target
        .lock()
        .ok()
        .and_then(|mut target| target.take())
}

fn run(app: AppHandle, receiver: mpsc::Receiver<Message>) {
    if let Err(error) = unsafe { RoInitialize(RO_INIT_MULTITHREADED) } {
        eprintln!("failed to initialize the Windows notification apartment: {error}");
        return;
    }

    let app_id = HSTRING::from(app.config().identifier.clone());
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&app_id);
    let notifier = match notifier {
        Ok(notifier) => notifier,
        Err(error) => {
            eprintln!("failed to create the Windows notification sender: {error}");
            unsafe { RoUninitialize() };
            return;
        }
    };

    // Keep each toast and activation handler alive while Windows can deliver its callback.
    let mut active = Vec::new();
    while let Ok(Message::Show {
        title,
        body,
        target,
    }) = receiver.recv()
    {
        match show(&app, &notifier, &title, &body, target) {
            Ok((toast, handler, token)) => active.push((toast, handler, token)),
            Err(error) => eprintln!("failed to show Windows notification: {error}"),
        }
    }

    for (toast, _, token) in active {
        let _ = toast.RemoveActivated(token);
    }
    unsafe { RoUninitialize() };
}

fn show(
    app: &AppHandle,
    notifier: &ToastNotifier,
    title: &str,
    body: &str,
    target: Option<NotificationTarget>,
) -> windows::core::Result<(
    ToastNotification,
    TypedEventHandler<ToastNotification, IInspectable>,
    i64,
)> {
    let document = XmlDocument::new()?;
    document.LoadXml(&HSTRING::from(
        "<toast><visual><binding template=\"ToastGeneric\"/></visual></toast>",
    ))?;
    let binding = document
        .GetElementsByTagName(&HSTRING::from("binding"))?
        .Item(0)?
        .cast::<XmlElement>()?;
    for value in [title, body] {
        let element = document.CreateElement(&HSTRING::from("text"))?;
        element.AppendChild(&document.CreateTextNode(&HSTRING::from(value))?)?;
        binding.AppendChild(&element)?;
    }

    let toast = ToastNotification::CreateToastNotification(&document)?;
    let app = app.clone();
    let handler = TypedEventHandler::<ToastNotification, IInspectable>::new(move |_, _| {
        if let Some(target) = target {
            let app = app.clone();
            let dispatch_app = app.clone();
            if let Err(error) = app.run_on_main_thread(move || {
                if let Some(state) = dispatch_app.try_state::<NotificationState>() {
                    if let Ok(mut pending) = state.pending_target.lock() {
                        *pending = Some(target);
                    }
                }
                if let Err(error) = settings_window::show(&dispatch_app) {
                    eprintln!("failed to open Settings from a notification: {error}");
                }
            }) {
                eprintln!("failed to dispatch notification activation: {error}");
            }
        }
        Ok(())
    });
    let token = toast.Activated(&handler)?;
    notifier.Show(&toast)?;
    Ok((toast, handler, token))
}
