//! Best-effort Windows desktop notifications using the app's installed identity.
//!
//! Desktop toasts require a Start menu shortcut with a matching AppUserModelID;
//! Tauri's NSIS bundle supplies the configured application identifier. See
//! https://learn.microsoft.com/en-us/windows/win32/shell/quickstart-sending-desktop-toast.
//!
//! A click on the banner never reached this unpackaged app's `Activated` handler, so a
//! notification with a target opens a `sidelingo:` link instead. Windows starts sidelingo with
//! it, and the single-instance plugin hands it to the running one.

use std::sync::mpsc::{self, Sender};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_deep_link::DeepLinkExt;
use windows::core::{Interface, HSTRING};
use windows::Data::Xml::Dom::{XmlDocument, XmlElement};
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

impl NotificationTarget {
    const ALL: [Self; 1] = [Self::Hotkey];

    const fn link(self) -> &'static str {
        match self {
            Self::Hotkey => "sidelingo://settings/hotkey",
        }
    }

    fn from_link(link: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|target| target.link() == link)
    }
}

/// Whether a launch argument is a notification's link, which opens Settings rather than the Pin.
pub fn is_link(argument: &str) -> bool {
    NotificationTarget::from_link(argument).is_some()
}

/// Opens Settings at a clicked notification's target, whether the click started sidelingo or
/// reached it running.
pub fn handle_links(app: &AppHandle) {
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        open_link(app, &urls);
    }
    let handle = app.clone();
    app.deep_link()
        .on_open_url(move |event| open_link(&handle, &event.urls()));
}

fn open_link(app: &AppHandle, urls: &[impl AsRef<str>]) {
    let Some(target) = urls
        .iter()
        .find_map(|url| NotificationTarget::from_link(url.as_ref()))
    else {
        return;
    };
    if let Some(state) = app.try_state::<NotificationState>() {
        if let Ok(mut pending) = state.pending_target.lock() {
            *pending = Some(target);
        }
    }
    settings_window::show_from_event_handler(app);
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

    while let Ok(Message::Show {
        title,
        body,
        target,
    }) = receiver.recv()
    {
        if let Err(error) = show(&notifier, &title, &body, target) {
            eprintln!("failed to show Windows notification: {error}");
        }
    }
    unsafe { RoUninitialize() };
}

fn show(
    notifier: &ToastNotifier,
    title: &str,
    body: &str,
    target: Option<NotificationTarget>,
) -> windows::core::Result<()> {
    let document = XmlDocument::new()?;
    document.LoadXml(&HSTRING::from(
        "<toast><visual><binding template=\"ToastGeneric\"/></visual></toast>",
    ))?;
    if let Some(target) = target {
        let toast = document.DocumentElement()?;
        toast.SetAttribute(&HSTRING::from("activationType"), &HSTRING::from("protocol"))?;
        toast.SetAttribute(&HSTRING::from("launch"), &HSTRING::from(target.link()))?;
    }
    let binding = document
        .GetElementsByTagName(&HSTRING::from("binding"))?
        .Item(0)?
        .cast::<XmlElement>()?;
    for value in [title, body] {
        let element = document.CreateElement(&HSTRING::from("text"))?;
        element.AppendChild(&document.CreateTextNode(&HSTRING::from(value))?)?;
        binding.AppendChild(&element)?;
    }

    notifier.Show(&ToastNotification::CreateToastNotification(&document)?)
}
