<h1 align="center">Snipmunk</h1>
<p align="center"><b>A free, open-source screenshot clipboard.<br />Collect several screenshots, then paste them all in one go.</b></p>

<p align="center"><sub>by Second Dawn</sub></p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue" /></a>
  <img alt="Status: early development" src="https://img.shields.io/badge/status-early%20development-orange" />
</p>

> **Status: Early development, not usable yet.** There is nothing to download. This repository currently holds the project plan only.

## The problem

Sharing more than one screenshot is clumsy. You capture one, paste it, switch back, capture the next, paste it again. Windows keeps a single image on the clipboard at a time, so every screenshot costs a round trip between the app you are capturing and the app you are pasting into. It is especially tedious when you are writing a document or a bug report, or giving an AI chat several screens of context.

## What Snipmunk will do

Take as many screenshots as you like in one session and annotate them like in Snipping Tool. They collect in a small widget-style window. When you are ready, paste **all** of them, or only the ones you selected, into any app in one go.

## Planned features

- **Capture modes:** region, window and full screen, started with a global hotkey, with a red selection pointer and support for multiple monitors and high-DPI screens.
- **Annotation tools:** mark up a screenshot right after capturing it (arrows, shapes, text, highlight and more).
- **Session gallery:** every screenshot of the session in a small widget window, where you can select, reorder and delete them.
- **Paste all / paste selected:** put everything, or only the selection, into any app in one go.
- **Drag and drop:** drag screenshots straight into documents, chats and folders.
- **Ask-to-save or auto-save sessions:** when you close the app or start a new session, Snipmunk asks whether to save the screenshots, or saves them automatically, depending on a setting.
- **Start with Windows:** optional, so it is always ready.

Screenshots only: there is no OCR and no text recognition.

## Platforms

- **Windows:** first.
- **macOS:** planned, soon after the first Windows release.

See the [roadmap](docs/ROADMAP.md) for the phases.

## Part of Second Dawn

Snipmunk is a [Second Dawn](https://github.com/Second-Dawn-Lab) app. Second Dawn builds free, open-source desktop apps that run on your own computer. The first is [Owl-L](https://github.com/Second-Dawn-Lab/owll), an offline translator. Later, all Second Dawn apps will be installable from one shared Second Dawn launcher.

## License

Snipmunk is MIT licensed. See [LICENSE](LICENSE).
