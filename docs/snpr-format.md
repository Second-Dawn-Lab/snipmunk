# The `.snpr` format (Snipmunk recording project)

Version **1.1** (`version` = 1, `minor` = 1; files without cuts and without a webcam sync are still written as 1.0, `minor` = 0). Written by Snipmunk 0.x; meant to be read and written by other Second Dawn programs (the
future video editor). The code that writes and reads it is `src-tauri/src/package.rs`; the same container will be used for `.snpd`
(documents) with another `format`.

## 1. Container

A `.snpr` file is **one ZIP file** (ZIP64 where needed: an entry may be larger than 4 GB) in which **every entry is stored without
compression** (method 0). That is what makes it cheap:

- opening a project reads only the central directory at the end of the file (kilobytes);
- a media entry can be read in place: its data starts at the offset the local header says and is `size` bytes long (no extraction, a
  video player can be given a byte range of the file);
- a small change can be appended without rewriting the media (see 4).

Entry names use `/` and are relative; no entry name contains `..` or starts with `/`. The extension is `.snpr`; the media type is
`application/x-snipmunk-recording`.

## 2. `manifest.json`

The first entry. UTF-8 JSON object:

| field | type | meaning |
|---|---|---|
| `format` | string | `"snipmunk.recording"`. A reader of another kind refuses the file. |
| `version` | integer | Major version of the layout (1). A reader that knows a lower major version **refuses** the file ("made by a newer version"). |
| `minor` | integer, default 0 | Minor version. Only adds things; a reader of the same major version **opens** a newer minor version. 1.1 (`minor` = 1) is written when `effects.cuts` is not empty or `effects.webcam.syncMs` is not 0. |
| `appVersion` | string | The version of the program that wrote the file last (informational). |
| anything else | any | Unknown fields: readers ignore them, **writers keep them** (see 5). |

The name, the effects and the other settings of the recording are in `recording.json` (not in the manifest), because they change
with every save.

## 3. Entries

| entry | required | content |
|---|---|---|
| `manifest.json` | yes | see 2 |
| `recording.json` | yes | see 3.1. May have newer versions under `meta/` (see 4). |
| `screen.mp4` | yes | The screen, **recorded without the cursor**: H.264 in MP4 (Media Foundation), `width` x `height` pixels, `fps` frames per second, no audio track. Time 0 is the first picture. A pause is cut out: the video is continuous. |
| `system.wav` | no | The sound of the computer (WASAPI loopback of the chosen output). 16-bit PCM WAV, stereo, the sample rate of the device (usually 48000 or 44100). Same time base as `screen.mp4` (kept in step while recording: silence is filled in, drift corrected). |
| `mic.wav` | no | The microphone. Same format and time base. |
| `cursor.jsonl` | no | The cursor track (3.2). |
| `cursors/<id>.png` | with `cursor.jsonl` | The cursor pictures named by the track (RGBA PNG). |
| `webcam.mp4` | no | The webcam as a video of its own (H.264 in MP4, no audio, usually 30 fps). Its time 0 is `recording.json` → `webcamStartMs` of the screen's time. |
| `thumbnail.png` | no | The first picture of the screen as PNG (the card picture). |
| `meta/<name>.<n>` | no | Newer versions of a small item (see 4). |

Files that are not in this table may be present: readers ignore them, writers keep them.

### 3.1 `recording.json`

UTF-8 JSON object. Unknown fields are kept. Fields (all optional for a reader, which supplies the defaults shown):

| field | type | meaning |
|---|---|---|
| `version` | integer | Layout of this file (1). |
| `name` | string | Display name of the project (not the file name). Absent: the file's name without `.snpr`. |
| `screenFile` | string | `"screen.mp4"` |
| `width`, `height` | integer | Pixels of the screen video. |
| `fps` | integer | Frames per second of the screen video (30 or 60). |
| `quality` | string | `"standard"` or `"high"`: the quality it was recorded at (used for the default export). |
| `durationMs` | integer | Length of the screen video. |
| `frames` | integer | Number of pictures. |
| `startedAt` | integer | Unix time (ms) when the recording started. |
| `source` | string | `"monitor"` or `"window"`. |
| `systemFile`, `micFile`, `cursorFile`, `webcamFile` | string or null | Names of the entries that exist. |
| `webcamStartMs` | integer, default 0 | Where in the recording (ms, pauses cut out) the webcam video begins. |
| `effects` | object | How the recording looks when played and exported (below). Absent: defaults. |

`effects` (every field optional, invalid values are replaced by the defaults):

```json
{
  "cursor": { "show": true, "size": "1", "halo": false, "haloColor": "#FFD60A" },
  "click":  { "kind": "ripple", "left": "#3B82F6", "right": "#F97316", "size": "medium" },
  "webcam": { "show": true, "shape": "circle", "size": "m", "position": "bottom-right",
              "x": 0.85, "y": 0.85, "border": "thin", "borderColor": "#FFFFFF", "syncMs": 0 },
  "trim":   { "startMs": 0, "endMs": null },
  "cuts":   [ { "startMs": 4000, "endMs": 6500 } ]
}
```

- `cursor.size`: `"1"`, `"1.5"`, `"2"` (times the cursor's own size). `click.kind`: `"off"`, `"ripple"`, `"burst"`. `click.size`: `"small"`,
  `"medium"`, `"large"` (3%, 5%, 8% of the picture height).
- `webcam.shape`: `"circle"`, `"rounded"`, `"rect"` (16:9). `size`: `"s"`, `"m"`, `"l"` = 14%, 20%, 28% of the picture width. `position`: a corner
  (`"top-left"` ... `"bottom-right"`, 2% margin) or `"free"` (then `x`, `y` is the centre as fractions of the picture, clamped inside).
  `border`: `"off"`, `"thin"`, `"medium"`, `"thick"` (2%, 4%, 7% of the bubble's shorter side, at least 2 px; older files have a boolean:
  true = thin). `borderColor`: `#RRGGBB`.
- `webcam.syncMs` (**1.1**, integer -500..500, default 0): lip sync; the webcam is shown this many ms later (positive) or earlier (negative)
  than where `webcamStartMs` puts it. Applied when playing and exporting. A 1.0 reader ignores it (the webcam is where it was recorded).
- `cuts` (**1.1**, default none): parts of the recording that are cut out, `[{startMs, endMs}]` in ms of the screen video (`startMs` in, `endMs`
  out), sorted, merged when they touch or overlap, clamped to the video; the key is left out when there are none. Nothing is cut from the media:
  playing skips them, and export, Copy, Share and drag-out leave them out (the sound is faded for 15 ms before and after a cut). Cuts apply
  inside the trim; the exported length is the trim minus the cuts. A **1.0 reader plays the full video** (it does not know `cuts`).
- `trim`: the kept part in ms of the screen video; `endMs` null = to the end. Nothing is cut from the media: the trim is applied when playing and exporting.

### 3.2 `cursor.jsonl`

One JSON object per line (a line that cannot be read, such as the last one after a crash, is skipped):

```text
{"type":"header","version":1,"width":1920,"height":1080,"fps":30}
{"t":0,"shape":"s1","hx":3,"hy":3,"w":32,"h":32,"file":"cursors/s1.png"}   a cursor picture, defined where it is first seen
{"t":0,"x":812,"y":440,"v":1,"s":"s1"}                                      a position
{"t":240,"b":"l","d":1}                                                     button l (left) or r (right): d 1 = down, 0 = up
```

`t` is recorded milliseconds (pauses do not count) = the time of `screen.mp4`. `x`, `y` are pixels of the recording (origin: top left
of the recorded area). `v` 0 = hidden or outside the area. `s` names the cursor picture (written when it changes); `hx`, `hy` is its
hot spot. Between two positions the cursor is interpolated; the click effects start at a button-down line.

## 4. Saving: append-only for small changes

Small items (`recording.json`, `thumbnail.png`, and any item a writer chooses) are **never rewritten in place**. A save appends a new
version as the entry `meta/<name>.<n>` (`n` = 1, 2, ... rising) and writes a new central directory after it; the media entries do
not move. A reader takes the highest `n` of `meta/<name>.<n>` and falls back to the plain entry `<name>` when there is none.
Stale versions stay until the file is written anew ("Save as" copies the newest version of each item as the plain entry and drops the
stale ones).

A **new file** is written next to its target (`<file>.part<pid>`), flushed, and renamed: there is never a half-written project.

### The manifest of a saved project (1.1)
The manifest is the first entry and is not rewritten in place. When a save needs a higher `minor` than the file's manifest has (the effects now
hold cuts or a webcam sync), the save also appends the new manifest as `meta/manifest.json.<n>` (like any small item); a reader takes the newest
version as the manifest, and a 1.0 reader (which only reads the first entry) still opens the file. "Save as" writes the newest manifest as the first entry.

### Crash safety of an append

Before an append, the old tail of the file (everything from the start of the old central directory) is copied to `<file>.tail` as
`[8 bytes: little-endian offset of the old central directory][the old tail bytes]`. After the append is complete the side file is
deleted. When a program opens a package and finds a `<file>.tail`, the previous save was cut off: it truncates the file to that offset,
writes the old tail back, and deletes the side file, which restores the project as it was before that save.

## 5. Compatibility rules

- **Readers** ignore unknown manifest fields, unknown `recording.json` fields, unknown entries and unknown `meta/` items.
- **Writers keep them**: a save or "Save as" carries every unknown manifest field and the `minor` of the file, every unknown entry and
  every unknown small item over unchanged (the reference code does this; `unknown_manifest_fields_and_unknown_entries_survive_a_save_and_a_save_as` tests it). A writer may raise `minor` only when it
  writes something that a reader of the lower minor version would miss.
- A **newer major version** is refused with a clear message; a **newer minor version** is opened.
- Adding an entry, a manifest field or a `recording.json` field is a minor change. Changing the meaning or the format of an existing
  one, or removing it, is a major change.
- Times are milliseconds unless the name says otherwise; sizes are pixels.
