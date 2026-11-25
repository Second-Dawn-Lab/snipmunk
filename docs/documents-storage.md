# Documents mode: how a guide is stored (internal, version 1)

This is the storage of the step recorder and of the open guide (7.5-A, 7.5-B). The file format for sharing (`.snpd`, on the package
container of `.snpr`) is described in `docs/snpd-format.md`; it is made from the working folder below. The format is versioned
(`guide.json` → `version`), so a later reader can tell.

## 7.5-B: one open guide, in a working folder

Since 7.5-B only **one guide is open at a time**, and it lives in a working folder in temp, not in the app data:
`%TEMP%\Snipmunk\guide-current\` (`SNIPMUNK_TEMP_DIR` replaces `%TEMP%` in development builds). The layout is the one below plus:

| file | meaning |
|---|---|
| `document.json` | the blocks and the edits (see `snpd-format.md`), written atomically after every change (350 ms after typing stops) |
| `dirty` | exists while there are changes that are not in a `.snpd` |
| `saved.txt` | the path of the `.snpd` the guide was opened from or saved to |
| `m-<id>.png` | images pasted or inserted into text blocks |
| `ocr\<picture>.json` | the text Windows read on a step picture for Quick redact, kept while the picture and the area stay the same (7.5-C2; since 7.5-C3 with the pieces that were read a second time); never part of a `.snpd`, gone with the folder |

The web view addresses the working folder as `snipmunk-img://…/guide/current/<file>`; step pictures get `?g=<generation>` (changed at every load of the guide) because the file names repeat from guide to guide and the web view caches decoded images by address.

A normal exit (Quit, after the question about unsaved changes) deletes the folder; closing the guide does too. **If the program dies or
Windows shuts down, the folder stays** and the next start offers "Recover guide (N steps)" (a guide that was never saved, was being
recorded, or had unsaved edits) or opens a saved, unchanged guide again. The step pictures here are the full monitor frames: the cropping
and the burning-in of redactions happen when a `.snpd` is written. Guides of 7.5-A in `<app data>\documents\guides\` are not read any more.

## Where

`<app data>\documents\guides\<id>\` where `<app data>` is `%APPDATA%\SecondDawn\snipmunk` (`dawn_core::app_dir("snipmunk")`) and `<id>` is
`g<creation time in hex>`. For tests `SNIPMUNK_GUIDES_DIR` moves the whole `guides` folder.

```
<id>\
  guide.json        title, created, state, the settings used, version
  steps.jsonl       one line per step, appended and flushed as each step is taken
  step-0001.png     the picture of step 1 ...
```

## `guide.json`

```json
{ "version": 1, "id": "g1a2002c0fe5", "title": "Guide 2026-11-21 23:13", "created": 1763766814000,
  "state": "recording", "settings": { "stepMode": "auto", "typing": true, "shortcuts": true, "enterTab": false, "zoom": false, "lang": "en" } }
```

`state` is `"recording"` until the guide is stopped, then `"done"`. A guide that is still `"recording"` at the next start is offered for recovery
("Recover guide (N steps)"); recovering sets it to `"done"`, discarding deletes the folder. The file is written to `guide.json.tmp` and renamed.

## `steps.jsonl`

One JSON object per line. A line that a crash cut off is ignored when reading, so at most the step that was being written is lost. Every step
line is written after its picture is on disk. Fields (camelCase; all rectangles `[x, y, w, h]` and points `[x, y]` are in the **pixels of the
step picture**, so a later editor can crop and annotate without touching the picture):

| field | meaning |
|---|---|
| `n` | step number (1, 2, ...), unique |
| `kind` | `click`, `rightClick`, `doubleClick`, `type`, `key` |
| `t` | Unix time in ms |
| `monitor` | `[x, y, w, h]` of the monitor on the desktop (physical pixels) and `scale` its DPI scale |
| `image`, `imageSize` | the picture file and its size (the whole monitor, physical pixels) |
| `click` | where the click was (none for `type` and `key`) |
| `window` | `{ rect, title, process }` of the window the step happened in |
| `element` | the UI Automation element: `name`, `controlType`, `localizedControlType`, `automationId`, `toggle` (state at the click), `selected`, `rect`, `parents` (nearest named menu/dialog/tab names) |
| `typed` / `keys` | the text of a typing step / the shortcut of a key step (`Ctrl+S`) |
| `zoom` | a default zoom area around the click (about 640 x 400, inside the window and the picture); shown only when the setting is on |
| `text` | the step text as parts `[{ "t": "Click ", "b": false }, { "t": "Save", "b": true }]` in the language of the program at the time |
| `frameAgeMs` | how long before the mouse went down the picture arrived (see below) |

Changing a step later appends a line with `"op": "delete"` or `"op": "restore"` and the step number (nothing is removed from disk; the later
line wins). 7.5-B will add other operations (edit text, reorder) the same way.

## The pictures

PNG with fast compression, the whole monitor of the click as it was before the app reacted (see `steprec.rs`). Lossless on purpose: the text
in a screenshot stays sharp for annotations and redaction, and JPEG would add artifacts around it. A 1080p window of a normal app is 20–300 KB, a
4K screen 0.3–1.5 MB; a guide of 100 steps is a few tens of MB. The pages show a step cropped to the active window (or the zoom area) and draw the
click marker on top at view time; nothing is burned into the file.
