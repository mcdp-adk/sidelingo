use windows::Win32::Globalization::GetUserDefaultUILanguage;

const LANG_CHINESE: u16 = 0x04;

/// sidelingo's UI language, following the Windows display language: any
/// Chinese gives Simplified Chinese, anything else English. The front end
/// applies the same rule to the WebView's language, which defaults to the
/// Windows display language.
#[derive(Clone, Copy)]
pub enum UiLanguage {
    ZhHans,
    En,
}

impl UiLanguage {
    pub fn current() -> Self {
        // The low 10 bits of a LANGID are its primary language.
        if unsafe { GetUserDefaultUILanguage() } & 0x3ff == LANG_CHINESE {
            Self::ZhHans
        } else {
            Self::En
        }
    }
}
