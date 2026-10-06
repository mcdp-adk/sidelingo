# sidelingo

sidelingo is a Windows 11 tray app that translates what you copy. Copy text or an image, and its Pin window shows the content laid out to read, its translation, or both side by side.

## Installation

Download the `*-setup.exe` installer and its `.sha256` file from the [latest release](https://github.com/mcdp-adk/sidelingo/releases/latest). In PowerShell, from the download folder, check the installer before running it:

```powershell
$installer = Get-ChildItem sidelingo_*-setup.exe | Select-Object -Last 1
$expected = ((Get-Content "$($installer.Name).sha256") -split '\s+')[0]
if ((Get-FileHash $installer -Algorithm SHA256).Hash -ne $expected) { throw 'Checksum mismatch: do not run this installer.' }
```

The installer needs no administrator rights and installs into `%LOCALAPPDATA%\sidelingo`, with a Start menu entry and an optional desktop shortcut. It speaks Simplified Chinese on a Chinese Windows display language, and English otherwise.

The installer is not Authenticode-signed. If Microsoft Defender SmartScreen shows "Windows protected your PC", choose **More info → Run anyway** after checking the download. **Smart App Control blocks this unsigned installer**, so a PC enforcing it cannot install sidelingo.

## Getting started

1. On first launch, open **Settings** from the tray icon, choose a Provider (OpenAI, OpenRouter, DeepSeek, Ollama Cloud, or any OpenAI-compatible endpoint), and enter its key and a model.
2. While the Pin window is visible, copy any text or image. sidelingo lays it out and translates it into your Target language, which starts as your Windows language.
3. Press **Ctrl+Shift+Q** to show or hide the Pin window, or double-click its content to hide it. Copies made while it's hidden are left alone.
4. Choose **Source**, **Translation** or **Side-by-side** from the window's Display mode.

Settings also hold the hotkey, the proxy, the Target language, starting with Windows, and updates.

## Updates and uninstalling

sidelingo checks for updates at startup and once a day, and installs one only when you choose **Update to x.y.z** in the tray menu or in Settings → About. Updates are signed, and sidelingo refuses one whose signature doesn't verify.

Settings are stored in `%APPDATA%\io.github.mcdp-adk.sidelingo`, and WebView2 data in `%LOCALAPPDATA%\io.github.mcdp-adk.sidelingo`. Uninstalling with **delete application data** removes both; leave it unchecked to keep your settings.

## License

sidelingo is licensed under the [GNU General Public License v3.0 only](LICENSE). Its translation prompt comes from [Read Frog](https://github.com/mengxi-ream/read-frog). Third-party notices ship with the app and are linked from Settings → About.

To build or work on sidelingo, see [CONTRIBUTING.md](CONTRIBUTING.md).
