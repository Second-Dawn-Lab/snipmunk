# FAQ

[Guide overview](index.md)

## Why does Windows warn me about the installer?

You may see **"Windows protected your PC"** or **"SmartScreen can't be reached"**. The installer is **not code-signed yet**, so
Windows does not know its publisher. Click **More info**, then **Run anyway**. The installer is built on GitHub from the source
code in this repository. Code signing is planned ([code signing policy](../CODE_SIGNING_POLICY.md)), and so is a Microsoft Store
version, which the Store signs.

## What is WebView2, and do I need it?

Snipmunk draws its windows with Microsoft's **WebView2**. Windows 11 includes it, and most Windows 10 computers have it too. If
it is missing, the installer downloads it (this needs an internet connection once). You can also install the
"Evergreen Runtime" yourself from [Microsoft's WebView2 page](https://developer.microsoft.com/microsoft-edge/webview2/).

## The PrintScreen key opens something else

Windows can use `PrintScreen` for its own Snipping Tool. Snipmunk's default shortcut is `Ctrl+Alt+PrintScreen`. If it does not
start a capture, choose another one in **Settings → Screenshots → Capture shortcut**, or use **Add capture**. To change what
Windows does with the plain PrintScreen key, look in Windows Settings → Accessibility → Keyboard.

## "This shortcut is taken"

Snipmunk only **watches** the keys; it does not reserve them. So:

- If Windows or another program uses the same keys, **both** react. The shortcut dialog warns you; pick another combination.
- The capture shortcut and the recording shortcut cannot be the same.
- If a notice says the shortcut could not be set up, Windows did not let Snipmunk watch the keyboard: use the buttons or the
  tray icon.
- For guide steps, avoid shortcuts with a single modifier such as `Alt+S`: other programs react to them (Outlook sends).

## A shortcut does nothing

Shortcuts work only while Snipmunk is running. Closing the window quits it by default; choose **Keep running in the tray** in
Settings → General if you want the shortcuts all the time.

## Text recognition does not read my language

Windows needs the language's **Optical character recognition** feature: see
[Other languages](text-recognition.md#other-languages). Windows does not offer it for every script.

## Quick redact missed a card number

Windows text recognition returns nothing for card numbers made of runs of ones, such as `4111 1111 1111 1111` (a common test
number). What Windows cannot read, Snipmunk cannot find. Always check the picture, and cover the rest with the **Blur** tool.

## The microphone or webcam is not recorded

- Windows Settings → **Privacy & security → Microphone** (or **Camera**): allow access, including **desktop apps**.
- Check the chosen device in Settings → Recording. If it is unplugged, Snipmunk uses the Windows default and tells you.
- The microphone is **off** at first: switch it on in the recording options or on the recording bar.

## Steps in some programs are missing

Programs **running as administrator** cannot be watched by a normal program, so their clicks do not become steps. The guide bar
tells you once. Run that program normally if you can, or add a step from a screenshot (**+ → Step from a Snipmunk screenshot…**).

Also not recorded: clicks on Snipmunk itself, clicks outside a chosen window or area, and everything while the guide is paused.

## Can I use Snipmunk offline?

Yes. Only the update check uses the network, and you can switch it off.

## Where did my recording go?

An unsaved recording is kept temporarily until you save it as a project, export it, or replace it. If Snipmunk closed
unexpectedly, it offers to recover it at the next start. Save anything you want to keep with **Save as project…**.

## Is there a Microsoft Store version?

Not yet. It is planned.

## Is there a macOS or Linux version?

Windows comes first. macOS is planned.

## A translation is wrong

Translations are AI-generated. Corrections from native speakers are very welcome: [open an issue](https://github.com/Second-Dawn-Lab/snipmunk/issues).

## How do I report a bug?

[Open an issue](https://github.com/Second-Dawn-Lab/snipmunk/issues) and tell us:

1. Your Snipmunk version (Settings → About) and Windows version.
2. What you did, what you expected and what happened.
3. A screenshot if it helps. **Check it for private information first**, and never attach files with real personal data.

For security problems, do not open a public issue: follow the [security policy](../../SECURITY.md).
