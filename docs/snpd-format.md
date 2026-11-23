# The `.snpd` format (Snipmunk guide)

Version **1** (`version` = 1). Written by Snipmunk 0.x. The code is `src-tauri/src/snpd.rs` on the container of `src-tauri/src/package.rs`;
the container, the append-only saves and the repair of a cut-off file are the same as for `.snpr` (see `docs/snpr-format.md`, sections 1, 4
and 5) with another `format`. The media type is `application/x-snipmunk-document`.

## 1. Container

One ZIP file, every entry **stored without compression**. Entry names use `/`, never `..` or a leading `/`.

`manifest.json` (first entry):

| field | meaning |
|---|---|
| `format` | `"snipmunk.document"`. A reader of another kind (for example a `.snpr`) refuses the file. |
| `version` | 1. A reader that only knows a lower major version refuses the file. |
| `minor` | 0. Only adds things. |
| `appVersion` | the program that wrote the file last |
| anything else | unknown fields are ignored by readers and **kept by writers** |

## 2. Entries

| entry | content |
|---|---|
| `manifest.json` | see 1 |
| `document.json` | the guide (section 3). Newer versions of it are appended under `meta/document.json.<n>`; the highest `<n>` wins. |
| `pic/<n>-<signature>.png` | the picture of a step. `<n>` is the step number, `<signature>` a short hash of the crop and the burned-in redactions, so the same picture is never stored twice and a changed picture is a new entry. |
| `m-<id>.png` (also `.jpg`, `.gif`) | an image that was inserted into a text block or pasted. |
| `thumbnail.png` | the first step picture (or the first image), about 480 px wide, for the "Recent" list and for Explorer. |

## 3. `document.json`

```json
{ "version": 1, "title": "Set up the printer", "created": 1763766814000,
  "marker": { "left": "#FF5A36", "right": "#2563EB", "shape": "ring", "size": "medium" },
  "badge": "circle", "picture": "window", "keepFull": false, "zoomDefault": false,
  "blocks": [ ... ] }
```

`blocks` is the ordered list of the guide. Every block has an `id` (unique inside the file) and a `type`.

**Content block** — rich text (TipTap / ProseMirror JSON in `doc`):

```json
{ "id": "bk3", "type": "content", "doc": { "type": "doc", "content": [ { "type": "paragraph", "content": [ { "type": "text", "text": "Hello" } ] } ] } }
```

The nodes used are `paragraph`, `heading` (1–3), `bulletList`, `orderedList`, `listItem`, `table`, `tableRow`, `tableCell`, `tableHeader`,
`image` (`src` is the name of an `m-*.png` entry), `hardBreak`; marks `bold`, `italic`, `underline`, `strike`, `link` (`href`; `javascript:` links are removed when pasting), `textStyle` (`color`, `fontFamily`, `fontSize`) and `highlight` (`color`); `textAlign` as attribute of paragraphs
and headings (`start`, `center`, `end`, so it follows the writing direction). A reader that does not know a node shows its text.

**Images and tables (7.5-B3, no version change: all attributes are optional, so older files open as before).**
- `image` nodes: `src`, `alt`, `file` (the `m-*.png` entry) as before, and `width` / `height` (shown size in CSS pixels; `height` only for a free resize),
  `align` (`start`, `center`, `end`, `full`), `crop` (`[x, y, w, h]` as fractions 0..1 of the original; the original stays in the file) and
  `nw` / `nh` (the natural size, so the height is known before the picture loads).
- `table` nodes: `align` (`start`, `center`, `end`); the cells keep `colwidth` (pixels per column, set by dragging the column borders), `colspan`, `rowspan`.

**Step block** — a step with its picture and everything that belongs to it:

```json
{ "id": "bk1", "type": "step", "n": 1,
  "step": { "n": 1, "kind": "click", "t": 1763766900000, "image": "pic/1-3fa9c2.png", "imageSize": [1100, 700],
            "click": [420, 310], "window": { "rect": [0, 0, 1100, 700], "title": "Printers", "process": "SystemSettings" },
            "element": { "name": "Add device", "controlType": "Button" }, "text": [ { "t": "Click " }, { "t": "Add device", "b": true } ] },
  "text": [ { "t": "Click the " }, { "t": "plus", "b": true } ],
  "desc": { "type": "doc", "content": [] },
  "zoom": true, "zoomRect": [300, 200, 400, 250], "markerHidden": false, "markerPos": [430, 320],
  "marker": { "shape": "arrow" },
  "annotations": [ { "id": "a1", "kind": "arrow", "color": "#d62828", "width": 3, "points": [[100, 100], [200, 150]] } ] }
```

- `step` is the recorder's step as in `steps.jsonl` (`docs/documents-storage.md`; `kind` is `click`, `rightClick`, `doubleClick`, `type` or `key`), as stored in the file: `image` is the entry of the (already cropped) picture and **every rectangle and
  point (`imageSize`, `click`, `window.rect`, `zoom`) is in the pixels of that stored picture**. Duplicated steps share a picture.
- `text` (parts with `b` = bold) overrides the generated text; without it `step.text` is shown ("Reset to generated text" removes it).
  `desc` is the optional description under the picture (rich text, like a content block).
- `zoom`, `zoomRect`, `markerHidden`, `markerPos`, `marker`, `annotations` are the per-step edits. The click marker is **drawn when the guide
  is shown or exported, never burned into the picture**; annotations are vectors, also drawn at view time. `annotations[].kind` is one of
  `arrow`, `line`, `rect`, `ellipse`, `highlight`, `pen`, `text`, `callout`, `badge`.
- The picture area of a step is its `crop` (a rectangle in the pixels of the picture kept in the working folder): "Guide default" is no crop,
  "Active window" the window's rectangle, "Full screen" the whole picture, "Custom area" any other rectangle (also one that is larger than the
  window: *Expand area*). On save the stored picture is cut to that area, so only the shown area is in the file (unless "Keep full
  screenshots" is on), and a step whose full frame is not in the file (its picture is smaller than its monitor) cannot be expanded.
- Not stored: `crop` and `redact`. They are applied when the file is written (section 4) and only the result is in the file.

Unknown fields — at any level — are kept by Snipmunk when it saves a file again.

`guide.json` of the working folder (not in the `.snpd`) has `settings.area` (`active`, `screen`, `window`, `region`), `settings.region`
(`[x, y, w, h]` on the desktop) and `settings.hwnd`: what the guide was recorded with, so "Record more steps" uses the same area. Steps of a
shell element (taskbar, tray, Start menu, desktop) have the shell element's rectangle (with a margin) as their window rectangle, never the
desktop window.

## 4. Privacy: what a picture contains

- **Crop.** A step picture is stored cropped to what the step shows: the **active window** (`picture: "window"`), or the **whole monitor**
  (`picture: "screen"`). A step can override this by a crop of its own. With "Keep full screenshots in guide files" (default **off**) the whole
  screenshot is kept instead.
- **Burned-in redactions.** Blur, pixelate and black box (also those made by the OCR quick redact) are painted into the stored picture. The
  unredacted original **is not in the file**, so a redaction cannot be taken away again by opening the file in another program.
  Because of that the editor keeps the original only in the working folder, until the guide is closed.

## 5. Saving

- *Save as…* writes a **compact** new file (no `meta/` entries) and makes it the current file.
- *Save* appends: the new `document.json` version and only the pictures that are new (another signature) go to the end of the file, then
  the central directory is written again. The cost does not depend on the size of the guide. A save that was cut off by a crash leaves a
  `.tail` file next to it; the next open repairs the file as for `.snpr`.
- Opening copies the file into the working folder (`%TEMP%\Snipmunk\guide-current\`), so the open file is never changed by editing until Save.

## 6. Compatibility

A reader must refuse a file whose `format` is not `snipmunk.document` or whose `version` is higher than it knows, ignore unknown entries and
unknown JSON fields, and a writer must keep them. 7.5-C will export from this file to PDF, Word, Markdown and HTML; those never change a `.snpd`.
