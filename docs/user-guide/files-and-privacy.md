# Files and privacy

[Guide overview](index.md)

Snipmunk works entirely on your computer. There is no account, no telemetry, no analytics, no advertising, no crash reporting
and no upload. The full statement is the [privacy policy](../../PRIVACY.md).

## What goes over the network

Only the **update check**: after a start, at most once a day (and when you press "Check for updates"), Snipmunk downloads a
small version file from this project's GitHub releases. Nothing about you, your files or your use of the app is sent; GitHub
sees what it sees for any download, such as your IP address. A new installer is downloaded only when you choose **Update and
restart**, and its signature is checked before it is installed. Switch the check off in Settings → About. The Microsoft Store
version has no updater of its own.

Links in Settings open your web browser, and the Windows share window hands a file to the app you choose there.

## Where your data is

Paste a path into the File Explorer address bar to open it.

| Folder | Holds | When it goes |
|---|---|---|
| `%AppData%\SecondDawn\snipmunk\sessions` | Your screenshots, their marks and recognized text | When you delete them, or on exit if "Clear the session on exit" is on |
| `%AppData%\SecondDawn\snipmunk` | Settings, your templates, window size, lists of recent projects and guides | With "Delete the application data" at uninstall |
| `%AppData%\SecondDawn\snipmunk\temp` | Pictures prepared for copy, drag, print, share and "Edit in Paint" | At the next copy of that kind and when Snipmunk quits |
| `%Temp%\Snipmunk` | The recording that is not saved yet, the guide that is open, unsaved project edits, export caches | When saved, replaced, closed or quit; kept after a crash so it can be recovered |
| `%LocalAppData%\lab.seconddawn.snipmunk` | The data of the built-in web view (WebView2); its caches are cleared on quit | With "Delete the application data" at uninstall |

Files you save yourself go where you choose. The folders offered first are:

| What | Folder |
|---|---|
| Recording projects and exports | `Videos\Snipmunk` |
| Guides | `Documents\Snipmunk` |
| Automatically saved screenshots (if switched on) | `Pictures\Snipmunk` |

The Microsoft Store version keeps its data in the app's own package folder.

## What is inside each file type

All three are ZIP files with a published format.

| File | Contains | Specification |
|---|---|---|
| `.snpr` recording project | The screen video (without the cursor), the sound tracks and webcam video you recorded, the pointer's path and clicks, your effects, trim and cuts, a preview picture | [.snpr](../snpr-format.md) |
| `.snpd` guide | The steps with their pictures (cut to what each step shows), the texts, marks and template; for a step also the names of the clicked button or field, the window title and program, and what you typed (not in password fields) | [.snpd](../snpd-format.md) |
| `.snpt` template | The look of a guide and its pictures (logo, background); no guide content | [Templates](../templates.md#own-templates-and-the-file-format-snpt) |

**Before you share a file:**

- A **recording project** contains the original recording, including parts you trimmed or cut out. Share an **exported** MP4 or
  GIF if others should see only the result.
- In a **guide**, hidden areas are burned into the saved pictures and masked words are left out. With **Keep full screenshots**
  on, the file holds more of the screen than the pages show.
- A guide saved before you redacted it: use **Save as**, so nothing earlier stays inside the old file.

## What Snipmunk reads, and when

- **Your screen** only when you take a screenshot, or record a video or a guide.
- **Microphone, system sound and webcam** only while you record with them switched on.
- **Keyboard:** Snipmunk watches for its shortcuts. While you record a **guide**, clicks and typing are noted to write the steps.
  [Text typed into password fields is not stored](guides.md#typing-and-passwords).
- **Clipboard** only to copy what you ask for, or when you paste into Snipmunk.

## Uninstall

Windows **Settings → Apps → Installed apps → Snipmunk → Uninstall**.

The uninstaller asks whether to **delete the application data** (not ticked at first). Ticked, it removes your kept
screenshots, settings, templates and working files. Either way, **files you saved to your own folders are never touched**, and
the shared Second Dawn model folder (`%AppData%\SecondDawn\models`) is left for other Second Dawn apps. Uninstalling the Store
version removes the app's package data.

Next: [FAQ](faq.md)
