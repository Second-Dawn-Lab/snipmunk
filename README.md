<h1 align="center">Snipmunk</h1>
<p align="center"><b>Grab, mark up and share everything on your screen, all in one place.</b></p>

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

- **Screenshots:** rectangle, window, full screen and freeform capture, with an optional delay, started with a global hotkey (default Ctrl+Alt+PrintScreen), a red selection pointer, and support for multiple monitors and high-DPI screens.
- **Screen recording:** record your screen, next to the screenshot tools.
- **Annotation:** pen and highlighter with color palettes, shapes, emoji stickers, text, crop, rotate, blur, eraser, undo and redo.
- **Text recognition:** copy all the text of a screenshot, select text on it, copy it as a table, or quickly redact email addresses and phone numbers. It all runs locally and works offline.
- **Groups:** organize the screenshots of a session into groups.
- **Multi-copy:** copy several screenshots at once, as separate pictures, as one stacked picture, or as a grid.
- **Auto-kept sessions:** every change is saved at once, so nothing is lost when the app closes or crashes. You decide whether a session is cleared on exit or kept for a number of days.
- **12 languages, including right-to-left:** English, German, Spanish, French, Italian, Dutch, Polish, Turkish, Simplified and Traditional Chinese, Arabic and Urdu.
- **Start with Windows:** optional, so it is always ready.

Translations are AI-generated for now; native speaker review is very welcome.

## Platforms

- **Windows:** first.
- **macOS:** planned, soon after the first Windows release.

See the [roadmap](docs/ROADMAP.md) for the phases.

## Privacy and offline use

Snipmunk is built to work entirely on your computer. Screenshots are kept in `%AppData%\SecondDawn\snipmunk` so a crash or restart never loses them, and you choose how long they stay (settings: clear on exit, or delete sessions after N days). There is no telemetry, no account and no upload. The only network access will be the update check against this repository's GitHub releases (not active yet).

### Two things to know about redactions and the clipboard

- **"Copy each capture to the clipboard"** (settings, Capture): when it is on, the capture goes to the clipboard *right after it is taken*, before you have edited it. Anything you blur or cover afterwards is not in that clipboard copy. Turn the setting off if you want to redact first, or copy again after editing.
- **Redactions are applied to copies and exports, not to the stored original.** Snipmunk never changes the picture file it keeps; blur, pixelate and black boxes are marks on top of it, and the copy or export you make from the capture has the pixels really replaced. The stored original therefore still contains the pixels under a redaction. To remove them from the stored picture as well, use **Blur ▾ → Apply redactions permanently**: the redactions are burned into the file, nothing of the covered area is kept on disk, and after you close Snipmunk that cannot be undone. (Until then, Undo can bring the original back; that earlier picture is held in memory only, never in a file.)

Text recognition (Text actions) runs on your computer with the text recognition that comes with Windows. Nothing is uploaded and no model is downloaded. The recognized text of a capture is kept in the session folder next to it and is deleted when the capture is deleted, when its redactions change, or when its picture is replaced.

## Build from source

Snipmunk uses the shared code in [`dawn-core`](https://github.com/Second-Dawn-Lab/dawn-core), which must sit **next to** this folder (the version in `dawn-core.ref`).

```text
SecondDawn/
  dawn-core/
  snipmunk/     <- this repo
```

You need Node.js 20+, [pnpm](https://pnpm.io), Rust (stable) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
cd dawn-core && pnpm install
cd ../snipmunk && pnpm install
pnpm tauri dev      # or run-snipmunk.bat on Windows
pnpm dev            # UI alone in a browser with a mock backend (src/ipc.mock.ts); add ?window=settings
pnpm lint && pnpm typecheck && pnpm test
cargo fmt --all --check && cargo clippy --workspace --all-targets && cargo test --workspace
```

Release process: [docs/releasing.md](docs/releasing.md).

## Part of Second Dawn

Snipmunk is a [Second Dawn](https://github.com/Second-Dawn-Lab) app. Second Dawn builds free, open-source desktop apps that run on your own computer. The first is [Owl-L](https://github.com/Second-Dawn-Lab/owll), an offline translator. Later, all Second Dawn apps will be installable from one shared Second Dawn launcher.

## License

Snipmunk is MIT licensed. See [LICENSE](LICENSE).

## Copy, save and share: where files go

Copying, dragging out, printing, sharing and "Edit in Paint" render the capture (marks, crop, rotation and redactions applied) into temporary PNG files in `%AppData%\SecondDawn\snipmunk\temp`. Nothing is written anywhere else unless you save. The temporary files of a kind are deleted at the next copy of that kind and when Snipmunk quits. The clipboard holds the file list, an HTML fragment and the first picture; other programs may read the files from the temp folder until then.
