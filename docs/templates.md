# Guide templates (7.5-C)

A template says how a guide looks in the editor, in the print preview, in print and in every export. The code:
`src/docs/template/` (`model.ts` the fields and the built-ins, `apply.ts`, `frame.ts`, `css.ts`, `CoverSettings.tsx`),
`src/docs/export/` (`html.ts`, `paginate.ts`, `measure.ts`, `docx.ts`, `docxCover.ts`), `src/docs/canvas.ts` (the editor's pages)
and `src-tauri/src/templates.rs` (own templates and files).

## The three levels

1. **Basic** (`id` `basic`): used when a guide has no template of its own. A4, Segoe UI.
2. **Built-in**: `blank` (first in every list), `clean`, `corporate`, `training`, `compact`, `dark`. They are defined in `model.ts` as changes of Basic; their names are
   translated (`template.builtin.<id>`). Changing colours, logo, fonts, frame (or anything else) in the sidebar changes **the guide's copy**,
   no own template is needed.
3. **Own** (`id` `own-<hex time>`): "Save as my template", rename, duplicate, delete, import, export (the template gallery).

**Blank** (7.5-C3) takes a look away: no cover, contents, header, footer, background picture or frame; Segoe UI, a dark grey, no
picture border, A4. Choosing a template (any template) keeps what was written: the blocks, and the cover's texts and the logo
where the new template brings none (one undo step).

**New guides** start with the template chosen in Settings → Documents ("Template for new guides", default Basic). With Basic no
template is embedded, and the guide takes the click marker and number style of the settings; another template brings its own.

## Template JSON (`version` 1)

| field | meaning |
|---|---|
| `id`, `name` | |
| `page` | `size` `a4` \| `letter` \| `screen` (no pages; a PDF of it uses A4), `orientation` `portrait` \| `landscape`, `margin` mm (0–40) |
| `fonts` | `heading`, `body` (family names of fonts on the system; fallbacks are added), `size` pt, `headingSize` pt |
| `colors` | `main`, `background`, `auto`; with `auto` the others are derived from the main colour and the background, otherwise `accent` (links), `light` (fills), `dark` (headings), `text` are used. Derived text colours meet WCAG AA on the background and on the light fill (unit tested). |
| `cover` | `on`, `title` (empty: the guide's), `subtitle`, `author`, `date` (show it), `dateText` (empty: the date of the day), `logo` (show it), `background` colour, `image` (an `m-*.png`: the background picture, also the picture of the designs `image` and `split`), `rich` (a text as formatted on the cover, by field: ProseMirror JSON; the plain field holds its words) |
| `cover` (7.5-C4) | `design` `classic` \| `band` \| `banner` \| `image` \| `minimal` \| `split`; `vertical` `auto` \| `top` \| `center` \| `bottom`; `align` `auto` \| `start` \| `center` \| `end` (the group of texts); `dateAlign` and `logoAlign` `auto` \| `start` \| `center` \| `end`; `logoPlace` `title` (above the title) \| `top` \| `bottom` (a corner); `logoSize` the logo's height in pixels of the page, 24–240; `overlay` `dark` \| `light` (design `image`) |
| `background` | how `cover.image` is drawn: `apply` `cover` \| `all` \| `notCover`; `size` `original` \| `fit` \| `fill` \| `custom` with `scale` (% of the page width, 5–200); `x` `left` \| `center` \| `right`; `y` `top` \| `center` \| `bottom`; `opacity` 0–100; `grey` |
| `contents` | a table of contents after the cover (the export switch starts from it) |
| `toc` (7.5-C4) | `style` `classic` \| `modern` \| `formal` \| `simple`; `leader` `dots` \| `dashes` \| `line` \| `none`; `numbers` (page numbers); `right` (at the far side of the line, else after the entry); `title` (empty: "Contents"); `size` pt (0: the text size); `spacing` line spacing 1–2.5; `steps` and `headings` (what is listed; headings of level 1 and 2) |
| `header`, `footer` | `left`, `center`, `right`: `none` \| `title` (the cover title, else the guide's) \| `text` (`texts.left` …) \| `logo` (scaled to the bar) \| `page` ("Page n of N") \| `date` \| `author` (`cover.author`) |
| `steps` | `badge` `circle` \| `square` \| `pill` \| `none`, `badgeColor` `main` \| `accent` \| `dark` (used while the next two are `null`), `badgeBg` and `badgeText` (colours of their own for the number's background and text), `layout` `above` \| `right` \| `left` (text beside the picture), `spacing` px, `description` `normal` \| `muted` \| `boxed`, `onePerPage`, `textScale` |
| `frame` | `ratio` `original` \| `16:9` \| `4:3` \| `3:2` \| `1:1` \| `custom` (with `w`, `h`), `maxWidth` % of the text width |
| `picture` | `borderColor`, `borderWidth`, `radius`, `shadow` |
| `annotation` | "Default drawing colour": the colour role new arrows, boxes and texts get, until another colour is picked in the tools row |
| `table` | `header` `main` \| `light` \| `none`, `borders`, `zebra` |
| `marker` | `left`, `right` colours, `shape`, `size` (becomes the guide's click marker when the template is applied) |
| `logo` | an `m-*.png` image of the guide, or `null` |

A template that lacks fields (or has values of the wrong type) is completed with Basic's values when it is read (`normalizeTemplate`).

## In a guide

Applying a template copies it into `document.json` as `template` (one undo step); its images are inserted images of the guide, so they
are in the `.snpd` and the guide looks the same on a computer that does not have the template. See `docs/snpd-format.md`.

## The cover and the contents in the editor

With `cover.on` the cover is page 1 of the editor (not a block of `document.json`: it is drawn from the template). Its texts are
written in place with font, size, colour and alignment; everything else is in the sidebar's **Guide** tab. A text without an
alignment of its own stands as the design (or the sidebar) places it; choosing a design or an alignment in the sidebar takes the
alignments set in place away again. An empty subtitle or author comes into view when the cover is clicked, and takes no room
otherwise. While the cover is off, the section offers the title and author fields if a header or footer shows them. A date left
empty shows the day of the export.

With `contents` a read-only list stands after the cover; it follows the guide, shows the page numbers and a click on an entry goes
to it.

## Cover designs (7.5-C4)

Chosen from a small gallery under Guide → Cover page. Each uses the template's colours, fonts, logo and pictures; "start" is the
side where lines begin, so a right-to-left guide mirrors them.

| `design` | the cover | texts, unless chosen otherwise |
|---|---|---|
| `classic` | everything centred on the cover colour and background picture | centre, middle |
| `band` | a band of the main colour at the start side, 42% wide, with the logo and texts in it | start, middle |
| `banner` | the title (and a logo above it) in a block of the main colour; the other texts below | start, top |
| `image` | the picture fills the page, darkened or lightened, the texts on it | centre, middle |
| `minimal` | a smaller title under a short rule | start, bottom |
| `split` | texts on the start half, the picture on the other | start, middle |

A cover saved before 7.5-C4 has no `design`: it is read as `classic` with `align` `start`, which is how it looked.

**Word.** Colour blocks and pictures are pictures behind the text, placed on the page from the first page's header; texts are
paragraphs indented and spaced to their place. What Word does not reproduce:

- the vertical place of the texts is estimated (the height of a line is not known), so it is close, not exact; the block of
  `banner` and the logo may stand a little differently around them;
- a picture is placed as it is: `image` and `split` pictures are cut to their place beforehand and the overlay is part of the
  picture; the rule of `minimal` is a paragraph border across the text width;
- a custom background picture position follows the same boxes as before; text in the band does not shrink to fit.

## Table of contents (7.5-C4)

Guide → Table of contents. The canvas, preview, print, PDF and HTML draw the same list (HTML has no page numbers: it has no
pages). In Word it is a real contents field with the switches of what is chosen (`\o "1-2"` headings, `\t` steps, `\n` without
page numbers, `\p " "` numbers after the entry, the tab leader), and Word's styles **TOC 1** and **TOC 2** carry the size, bold or
capitals, indentation, line spacing and leader; the title has its own style. Word fills the field itself when the document is
opened (it may ask to update fields). Word cannot show the accent bar of `modern` around the entries or coloured page numbers.

## Pages (7.5-C4)

With a page size (`a4` or `letter`) the editor shows the pages themselves: sheets on a grey ground, each with the page colour, the
background picture (as `background.apply` says), and, after the cover, header and footer with page numbers. The cover is page 1 and
has no header or footer. Everything is edited in place on the sheets.

One layout (`export/paginate.ts`, measured in a hidden frame with the document's own style sheet) decides which block stands on
which page for the canvas, the print preview, printing and the PDF:

- the contents start on a new page and have as many pages as they need; nothing else stands on them (without a cover the title
  stands above them);
- what follows the contents starts on a new page; "One step per page" starts each step on one;
- a step is never split; a text block breaks between its paragraphs, and a table between its rows (rows that a cell spans stay
  together), repeating its header row; a list is one piece;
- a heading stays with what follows it;
- anything higher than a page is shrunk to fit it.

In the editor the blocks are then moved to the head of their pages (`canvas.ts`); the text editors get their page breaks as
decorations (`pageGaps.ts`), so the stored text is not touched. After a change only what is new is measured again.

The page numbers count the pages after the cover (Word's "of" total also counts the cover). Zoom: 50 to 200% (Ctrl+wheel, Ctrl+0),
**Fit page width**, **Whole page**, 100%; until one is chosen, 100% or smaller where the page does not fit. `screen` (no pages)
keeps the free column with Narrow, Normal, Wide and Fit.

**Print preview** shows the finished pages, read only; **Print…** (or Ctrl+P) sends the same document to the system's print dialog
(WebView2), with the template's paper size and orientation. In printed HTML the cover and the contents end with a page break.

## Where the background picture shows and how large

| `size` | the picture |
|---|---|
| `fill` | covers the whole page, centred (the edges that do not fit are cut) |
| `fit` | all of it is visible, centred |
| `custom` | `scale` % of the page width, at `x` / `y` |
| `original` | its own size, at `x` / `y` |

It is always behind the text and the logo. Opacity and grey are baked into the picture before it is used. The editor, print
preview, print and PDF put it on the chosen pages; HTML keeps it behind the cover and, for the pages, in place while the text
scrolls; Word gets it as a picture behind the text in the first-page header (cover) and in the page header (other pages).
Markdown has none.

## The picture frame

With a ratio other than `original`, every step picture is shown inside a frame of that ratio. A step's own place is
`block.frame = { cx, cy, w }` (centre and width of the shown part, in the pixels of the step picture); the height follows the ratio, so a
change of ratio keeps centre and zoom. Without a stored place the frame **fills** itself around the step's area with the real screen
around it (the full picture of the working folder, as *Expand area* does). "Fit" shows the whole area; where the screen ends the rest
is padded with the template's background. On save every step gets its `frame`, and the stored picture is the part the frame shows.

With `original` (no frame) a step can still be zoomed and moved inside its picture area (7.5-C3): `block.frame` then has
`"own": true`, its shape is the area's, and it never leaves the area. "Fit" removes it. It is a view of the step: the saved file
keeps the whole area, so the zoom can be undone after reopening. To cut content out of the file use the picture area. A place in
a frame and a zoom without one are not applied to each other.

The controls are in the sidebar's **Step** tab (Fit, Fill, zoom) and on the selected step's picture (Alt+wheel, dragging).

## The "Template" button

The button opens the panel; its menu switches templates and has "Save as my template…", "Update my template" (overwrites the own
template the guide uses; not for built-in ones), "Export templates…" (one chosen: a save dialog; several: a folder that gets one
`.snpt` file each, named after the template, never overwriting), "Import templates…" (several files at once) and "Manage
templates…". The panel has the same actions.

## Own templates and the file format (`.snpt`)

Own templates are one file each in `<app data>\templates\<id>.snpt` (`SNIPMUNK_TEMPLATES_DIR` in development builds). The same file is
what "Export" writes and "Import…" reads. It is the stored-ZIP package of `.snpr` / `.snpd` (`package.rs`) with
`format = "snipmunk.template"`, version 1:

| entry | content |
|---|---|
| `manifest.json` | as for the other packages |
| `template.json` | the template |
| `m-*.png` | the images it names (`logo`, `cover.image`) |

Import checks the kind and the size (at most 40 MB), takes only images with those names, and stores the template under a new id.

**Extension.** `.snpt` was checked on 2026-11-25: no association for `.snpt` (nor `.sntpl`) in the registry of the development
machine, and a web search found no program using `.snpt` (only the unrelated `.snp`). The installer does not register it yet
(double-click import can come later).
