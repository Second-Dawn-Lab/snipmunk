# Snipmunk privacy policy

Snipmunk is a free, open-source (MIT) app for screenshots, screen recordings and step-by-step guides, by Second Dawn. It works on
your computer. There is no account, no telemetry, no analytics, no advertising, no crash reporting and no upload.

## The only network access

| What | When | Where to | What is sent |
|---|---|---|---|
| **Update check** (not in the Microsoft Store version) | After a start, at most once a day, while "Check for updates automatically" is on (Settings, About); and when you press "Check for updates" | [GitHub Releases](https://github.com/Second-Dawn-Lab/snipmunk/releases) of this project (`latest.json`) | A plain HTTPS download. Nothing about you, your files or your use of the app is sent; GitHub sees what any download shows (your IP address and the request). |
| **Update download** | Only when you choose "Update and restart" | The installer file of that release on GitHub | The same: a plain HTTPS download. The file's signature is checked before it is installed. |

The Microsoft Store version has no updater of its own: the Store updates it. Buttons that open a web page (for example "GitHub" in
Settings) open your web browser. Windows' own share window, when you use it, hands the picture to the app you pick there.

## What stays on your computer

- **Screenshots, recordings and guides** you make, in `%AppData%\SecondDawn\snipmunk` (Store version: the app's own package
  folder), in temporary folders while a recording or an export runs, and wherever you save them yourself.
- **Settings** and the list of recently opened files, in the same app folder.
- **Text recognition** uses Windows' built-in recognition on your computer.

## What the app reads, and when

- **Your screen**, only when you take a screenshot or record a video or a guide. **Microphone, system sound and webcam**, only
  while you record with them switched on.
- **Keyboard shortcuts:** a keyboard hook watches for Snipmunk's shortcuts. While you record a **guide**, mouse clicks and typing
  are noted to write the steps (and, for the step text, the names of the buttons and fields you click). **What you type into a
  password field is not stored**: the step shows dots, and its picture is the one from before you typed. This also applies when
  Snipmunk cannot check the field in time. A password typed where there is no password field to recognize (a terminal prompt, a
  program that does not describe its fields, a "shown" password in an unnamed box) is recorded like other text, and other pictures
  can show what is on screen: check a guide before you share it, or switch "Record typing" off (Settings, Documents). Nothing of
  this leaves your computer.
- **The clipboard**, only to copy what you ask it to copy, or when you paste into Snipmunk.

## Keeping and deleting

You decide how long screenshots are kept (Settings, Sessions: clear on exit, or after a number of days). Uninstalling keeps your
data unless you tick "Delete the application data" (installer version); uninstalling the Store version removes the app's package
data. Files you saved to your own folders are never deleted by Snipmunk.

## Contact

Questions or problems: [open an issue](https://github.com/Second-Dawn-Lab/snipmunk/issues), or see [SECURITY.md](SECURITY.md) for
security reports.
