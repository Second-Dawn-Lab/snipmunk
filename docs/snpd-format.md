# The `.snpd` format (Snipmunk guide)

Version **1.2** (`version` = 1; `minor` = 2 when the guide's template uses something that came with 7.5-C2, else 1 when it has a
template or a framed step, else 0). Written by Snipmunk 0.x. The code is `src-tauri/src/snpd.rs` on the container of `src-tauri/src/package.rs`;
the container, the append-only saves and the repair of a cut-off file are the same as for `.snpr` (see `docs/snpr-format.md`, sections 1, 4
and 5) with another `format`. The media type is `application/x-snipmunk-document`.

## 1. Container

One ZIP file, every entry **stored without compression**. Entry names use `/`, never `..` or a leading `/`.

`manifest.json` (first entry):

| field | meaning |
|---|---|
| `format` | `"snipmunk.document"`. A reader of another kind (for example a `.snpr`) refuses the file. |
| `version` | 1. A reader that only knows a lower major version refuses the file. |
| `minor` | 0, 1 or 2 (see above). Only adds things. |
| `appVersion` | the program that wrote the file last |
| anything else | unknown fields are ignored by readers and **kept by writers** |

## 2. Entries

| entry | content |
|---|---|
| `manifest.json` | see 1 |
| `document.json` | the guide (section 3). Newer versions of it are appended under `meta/document.json.<n>`; the highest `<n>` wins. |
| `pic/<n>-<signature>.png` | the picture of a step. `<n>` is the step number, `<signature>` a short hash of the crop and the burned-in redactions, so the same picture is never stored twice and a changed picture is a new entry. |
| `pic/<n>-m<signature>.png` | the pixels of a magnified area that the step picture does not hold (7.5-D, see `patch`). |
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
  `arrow`, `line`, `rect`, `ellipse`, `highlight`, `pen`, `text`, `callout`, `badge`, and since 7.5-D `spot` and `magnify`.
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

### Template, picture frame and masked text (7.5-C, minor 1)

- `template` (optional, in `document.json`): the guide's template, embedded as JSON (`docs/templates.md`). Its images (`logo`,
  `cover.image`) are inserted images (`m-*.png` entries) of the file, so the guide looks the same without the template installed. A reader
  that only knows minor 0 shows the guide without it. `badge` may be `pill` (added with templates).
- `frame` (optional, in a step block): `{ "cx": 640, "cy": 360, "w": 1280 }`, the step's place in the template's picture frame, in the
  pixels of the stored picture. With a framed template every step gets one when the file is written, and the stored picture is the part
  of the screenshot the frame shows (clipped to the screen; the rest is padding in the background colour). `keepFull` keeps the whole
  picture instead.
- `maskTyped` (optional, in a step block): the typed text of this typing step was masked with "Quick redact": `step.typed` is left
  out of the file and `step.text` shows dots.

### Cover, header, background, numbers (7.5-C2, minor 2)

All of it lives in `template` (`docs/templates.md`): `cover.rich` and `cover.dateText`, `background`, `contents`,
`steps.badgeBg` / `steps.badgeText`, and the header and footer places `text` (with `texts`) and `author`. A file that uses any of
them asks for minor 2; a reader of minor 1 shows the guide with the plain cover words, without those header places, and with the
background picture only on the cover.

### Cover and contents designs (7.5-C4, no version change)

New optional fields of `template`: `cover.design`, `cover.vertical`, `cover.align`, `cover.dateAlign`, `cover.logoPlace`,
`cover.logoAlign`, `cover.logoSize`, `cover.overlay` and `toc` (`docs/templates.md`). A guide without them opens as it looked; an
older Snipmunk ignores them and shows its own cover and contents. A table's `align` and column widths are as before (a table that
is centred or at the end and has no widths is now drawn only as wide as its columns need).

### Zoom without a frame, steps without a number (7.5-C3, no version change)

- `frame.own` (optional, in a step block's `frame`): `true` for a zoom made in a guide without a picture frame. `cx`, `cy`, `w`
  are in the pixels of the stored picture; the height follows the shape of the step's area. The stored picture is the whole area (the
  zoom is not cut out). A reader that does not know it shows the area; under a framed template such a `frame` is ignored.
- `numberHidden` (optional, in a step block): the step shows no number and is not counted. A reader that does not know it numbers
  every step.

### Callouts, magnifiers and spotlights (7.5-D, no version change)

All of it is optional: new fields of entries of `annotations`, two new kinds, and `spotlight`. A file without them opens as before;
a callout without `box` is drawn as it always was, and is only turned into the new form when it is edited.

**Frame units.** The boxes that may stand beside a picture are not stored in picture pixels: the shown part of the picture (after
crop, zoom and picture frame) is **700 units wide**, its top left corner is `0, 0`, and its height is `700 × height / width`. So a
box keeps its place and size on the page when the picture is zoomed or put into another frame, and may be negative or larger than
700 (beside, above or below the picture). What a mark points at is in picture pixels, so it stays on its piece of the screen. Frame
units are **not** moved when the writer cuts a picture (picture pixels are, as for every mark).

**Callout** (`"kind": "callout"`):

```json
{ "id": "a2", "kind": "callout", "x": 120, "y": 90, "x2": 420, "y2": 310, "text": "Click here\nto add it",
  "box": { "x": -80.9, "y": 90.3, "w": 190, "h": 62.5 }, "shape": "speech",
  "fill": "#FFFFFF", "color": "#D62828", "width": 3, "textColor": "#111111", "size": 18, "bold": false }
```

| field | meaning |
|---|---|
| `box` | frame units; **present = a callout of 7.5-D**. `h` is never lower than the wrapped text needs. |
| `x2`, `y2` | the tip of the pointer, picture pixels |
| `x`, `y` | the box's top left corner in picture pixels when it was last edited: where a reader that does not know `box` shows it |
| `text` | may hold line breaks; it wraps to the box |
| `shape` | `rounded`, `rect`, `speech`, `oval`, `cloud`, `label` |
| `fill`, `color`, `width` | inner colour; border and pointer colour; border width in frame units (0–12) |
| `textColor`, `size`, `bold` | the text; `size` is the font size in frame units (10–48) |

**Text** (`"kind": "text"`): `text` may now hold line breaks.

**Magnifier** (`"kind": "magnify"`): `x, y, x2, y2` is the magnified square (picture pixels); `at` = `{x, y}` is the centre of the
bubble in frame units; `zoom` 2–4 (the bubble is the area as the picture shows it, times this); `shape` `circle` or `square`;
`line` (a line from the area to the bubble); `color`, `width` (border, frame units).

- `patch` (written only when needed): `{ "file": "pic/1-m5c0e9a1f.png", "x": -40, "y": -10, "x2": -20, "y2": 10 }`. When the area is not
  inside the picture the step stores (it was marked on a larger area, and the step was then cut), the writer stores **exactly the
  pixels of the area**, with the step's redactions burned in, as a small entry of its own and names it here with its rectangle (in
  the same pixels as the mark). Nothing else outside the stored picture is added. A reader draws the area from the step picture while
  it lies inside it, else from `patch`. Entries no mark names are removed with the next save, like superseded pictures.
- The bubble itself is never burned into a stored picture.

**Spotlight** (`"kind": "spot"`): `x, y, x2, y2` (picture pixels) and `shape` `rect`, `round` or `ellipse`. Everything outside all
spotlights of a step is dimmed once. How: `spotlight` = `{ "dim": 55, "tone": "dark", "soft": false }` (`dim` 20–80 percent, `tone`
`dark` or `light`) in `document.json` for the guide, and optionally in a step block for that step (any of the three fields).

**Zoom into the click.** `zoom` of a step block is its own setting; without it the step follows `zoomDefault`. The zoom lies inside
the step's picture area (`zoomRect`, a drawn area, cut to it; else the recorded zoom around the click, at most 60 % of the area).

Older programs: they show a new callout at `x, y` with its words on one line and without its options, and nothing for `spot` and
`magnify`. A program from before 7.5-D that saves such a file again does not know `patch` and drops those small pictures.

### Hidden texts (7.5-C2)

"Quick redact" also hides what is found in texts: the matching characters of `text`, `desc`, content blocks and the cover are
replaced by `••••••` in the document itself, so the originals are in no saved or exported file.

- `masked` (optional, in a step block): something of this step was hidden. The writer then stores `block.text` as `step.text`, and
  leaves `step.element.name`, `step.element.parents` and `step.window.title` empty (they may hold what was hidden).
- `maskTyped`: as above; set when the hidden text was typed text.

Snipmunk offers no "Reset to generated text" on a masked step. A reader needs to know nothing of `masked`: the data it
protects is not in the file. The working folder (not the file) keeps the recorded step, the unredacted pictures and the text
readings of the pictures (`ocr\\`) until the guide is closed.

## 4. Privacy: what a picture contains

- **Crop.** A step picture is stored cropped to what the step shows: the **active window** (`picture: "window"`), or the **whole monitor**
  (`picture: "screen"`). A step can override this by a crop of its own. With "Keep full screenshots in guide files" (default **off**) the whole
  screenshot is kept instead.
- **Magnified areas.** A magnifier whose area lies outside the stored picture adds that area alone, as a small entry with the same
  redactions burned in (section 3, `patch`).
- **Burned-in redactions.** Blur, pixelate and black box (also those made by the OCR quick redact) are painted into the stored picture. The
  unredacted original **is not in the file**, so a redaction cannot be taken away again by opening the file in another program.
  Because of that the editor keeps the original only in the working folder, until the guide is closed.

## 5. Saving

- *Save as…* writes a **compact** new file (no `meta/` entries) and makes it the current file.
- *Save* appends: the new `document.json` version and only the pictures that are new (another signature) go to the end of the file, then
  the central directory is written again. **Except when the save hides something** (a step picture is replaced, because it was cut or
  redacted anew or its step is gone, or texts were masked): then the file is written again without the earlier versions (since
  7.5-C2; an appended save would keep the earlier picture and text inside the file). *Save as…* never carries earlier versions. The cost does not depend on the size of the guide. A save that was cut off by a crash leaves a
  `.tail` file next to it; the next open repairs the file as for `.snpr`.
- Opening copies the file into the working folder (`%TEMP%\Snipmunk\guide-current\`), so the open file is never changed by editing until Save.

## 6. Compatibility

A reader must refuse a file whose `format` is not `snipmunk.document` or whose `version` is higher than it knows, ignore unknown entries and
unknown JSON fields, and a writer must keep them. 7.5-C will export from this file to PDF, Word, Markdown and HTML; those never change a `.snpd`.
