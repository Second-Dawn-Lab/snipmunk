# Manual tests, Phase 7.5 (Documents mode)

## 7-5-A: the step recorder, the guide storage and the read-only guide view

Everything below the line "tested" was tested with the dev-only paths: the generated frames, test windows made by the test instance (a
WebView2 page and a native window) and events injected into the recorder after the hook stage (`dev_guide_scenario`, `dev_guide_inject`).
Nothing read the real screen, keyboard, mouse, microphone or camera. The hooks were only installed and removed again (paused: no event is
even copied).

### Tested (automatic and live in the test instance)
- Step text rules (`steptext.rs`, unit tests): English, German, Arabic order of bold parts, all 12 languages have every template, names are cleaned.
- Storage (`guides.rs`, unit tests): steps in order, delete/restore as appended lines, a line cut off by a crash is ignored, recovery, default zoom, file names cannot leave the folder.
- The picture is the newest one that arrived before the click (unit test); with the generated 60 ms frame source the measured age was 2–39 ms for eight steps (one picture is at most 60 ms old). With a real screen that does not change, the newest picture is old, which is right: it is the screen as it was.
- Native test window (button, edit, check box, list box), Auto mode: `Click Save in Guide test window` (first step in a window says where), `Click in Guide test window` (an unnamed edit), a typing step with German characters `Type 'Hamburg äöß@'` (grouped, AltGr, dead-key-free layout), `Check Remember me`, `Select Berlin`, two clicks 120 ms apart = ONE `Double-click Save`, `Right-click Berlin`, `Press Ctrl+S`; while paused nothing was recorded (8 steps before, 8 while paused). German run: `Klicke auf Save in Guide test window`, `Gib „Hamburg äöß@“ ein`, `Aktiviere Remember me`, `Wähle Berlin`, `Doppelklicke auf Save`, `Klicke mit rechts auf Berlin`, `Drücke Ctrl+S`.
- WebView2 test page (UI Automation through the browser): `Click Save in Guide test page`, `Click Learn more` (link), `Check Remember me`, `Select Berlin` (radio), `Click the City field`, `Type 'Hamburg' in City`, `Open the Advanced tab`, `Select File › Open` (menu path), `Click the Country field` (select).
- Manual mode: a click is ignored, two "Take step" at the pointer made two steps.
- Crash recovery: a guide with 2 steps, the program killed, restarted: `guides_unfinished` lists it with 2 steps, recovering finalizes it.
- A guide of 150 steps: the list renders at 60 fps while scrolling hard; pictures load when a step comes near the screen (37 of 150 were loaded after scrolling through).
- The floating bar renders (step counter, Take step, Pause, Stop, Cancel).

### You must test by hand (real apps, real input)
- [ ] **Explorer, Notepad, Chrome/Edge, Office (Word/Excel), Windows Settings**: start a guide (button, Ctrl+Alt+G, tray "New guide"), click through a task. Are the texts right (menu paths, tabs, check boxes), is each picture the screen BEFORE the app reacted (a menu that opens on click must not be open in the picture), is the click marker at the click?
- [ ] **An app running as administrator**: the bar shows "Steps in apps running as administrator can't be recorded." once; no steps are made there.
- [ ] **German keyboard typing**: ä ö ü ß, AltGr+Q (@), AltGr+E (€), a dead key (^ then e), Shift and Caps Lock; one typing step per field; Backspace edits the text; Tab/Enter end the group.
- [ ] **Multi-monitor and different DPI scales**: click on each monitor; the picture is that monitor, the marker is right.
- [ ] **Auto and Manual modes**; the step shortcut (Ctrl+Alt+S) also takes a step in Auto mode; the warning about shortcuts with a single modifier in Settings → Documents.
- [ ] Double click and right click; middle click; clicks on the bar and on Snipmunk's own windows never become steps; Pause really stops everything; Cancel asks and deletes; Stop opens the guide.
- [ ] Settings → Documents: every setting (also found by the settings search), the click marker colour, "Active window / Full screen", "Zoom into the click".
- [ ] Quit (tray) while a guide is recording: "Stop and keep the recording?" and the guide is kept.
- [ ] Kill Snipmunk while recording a guide and start it again: "Recover guide (N steps)".
- [ ] Light/dark theme and Arabic (mirrored) for the guide list, the guide view and the bar.

## 7.5-B: the guide editor and the `.snpd` files

Tested automatically or live in the test instance (generated data only; no real screen, keyboard, mouse or clipboard was read):
- Rust unit tests: `.snpd` create / append / Save as (compact) / open again in another folder; a save that was cut off is repaired; a changed crop adds exactly one picture; the stored picture is cropped to the window and the redaction is burned in (no pixel outside the window, none of the unredacted area); "Keep full screenshots"; unknown fields kept; the own-window filter, the app display names, the German step texts and key names, the start/step shortcut registration.
- A guide of **100 steps** (1600×900 pictures with noise, debug build): Save as 27.7 s (a release build is much faster; the file was 120 MB because of the noise), a later **append save 21 ms**.
- JS tests: block operations (insert, remove, move, multi-move, duplicate, sync of recorded steps), the undo/redo history (merge of typing, clear on close), TSV → table, URL detection.
- Live (test instance): the Documents home; recovery dialog after a restart ("Recover guide (12 steps)"), then the editor with 12 and with **150 steps** (all blocks rendered, hard scrolling 30 frames in ~0.5 s, typing in a step text 16 ms per keystroke); inserting a text block with the "+" button and its toolbar (font, size, headings, B/I/U/S, colour, highlight, lists, alignment, link, table, clear); pasted HTML sanitized (script, event handlers, `javascript:` links removed, remote images replaced by a placeholder, data images kept) and the step text keeping only bold.

You must test by hand:
- [ ] **Ctrl+Alt+G** on your machine: it starts a guide. If another program has the shortcut, Settings shows "is taken" and the tray "New guide" still works.
- [ ] Record a guide in real apps (Explorer, Notepad, Chrome, Word/Excel, Settings): your own Snipmunk window, the bar and the start/stop/pause clicks never become steps; the countdown shows on screen; German keyboard typing; German texts use "Sie" forms and key names (Strg, Umschalt, Eingabe …).
- [ ] **Save as…** (Ctrl+Shift+S), close, **Open guide…** (Ctrl+O), edit, **Save** (Ctrl+S) — the status chip goes Not saved → Saved → Edited. Open the `.snpd` in a ZIP tool: no uncropped picture, the redacted area is black/blurred.
- [ ] **Double-click a `.snpd`** after installing: Snipmunk opens in Documents mode (also when it is already running). The icon has the document badge. (The installer was not built in this phase.)
- [ ] **Quit with an unsaved guide**: the dialog lists it, "Save" saves it, "Don't save" quits. Then kill Snipmunk (Task Manager) with an unsaved guide: the next start offers "Recover guide (N steps)".
- [ ] **Record more steps** in an open guide (File menu or the toolbar button), after a selected block and at the end; Cancel keeps the guide as it was.
- [ ] **Paste** into a text block: a range from Excel (table), from Word (table, bold, lists), from Chrome (rich text, a table, an image: remote images become a placeholder), an image copied in Explorer, a screenshot (Win+Shift+S), tab-separated text, a URL. Drag image files from Explorer onto the guide. Inside a step text only bold stays.
- [ ] Reorder by drag and Alt+Up/Down, multi-select (Ctrl/Shift click), Delete, Ctrl+Z / Ctrl+Y across text, steps and settings; step picture tools (arrow, rectangle, text, badge, blur, pixelate, black box, crop, zoom area, marker move/hide) and per-guide settings (marker shape/colours/size, badge style).
- [ ] RTL (Arabic, Urdu): header, toolbar alignment buttons, insert menu, the marker and badge placement.
- [ ] Settings → Documents: marker colours, shape, size, badge, "Keep full screenshots", guides folder; found by the settings search.

## 7.5-B2: grey pictures, step texts and the Documents layout

### A. What was broken (every step picture was a grey box with the click marker)
- **Root cause (frontend, not the recorder):** the editor loaded step pictures with `<img loading="lazy">`. A picture of a step is laid out by percentages inside a clipped box (`width`, `left`, `top` in %, `height: auto`), so before it loads it is 0 × 0 and, for a picture that shows the window or a crop (`vy` > 0), it sits at a negative offset **outside** the clipped box. The browser never counts such an image as visible, so it never loaded. Every guide recorded with the default "Active window" area (the window never starts at the screen's top-left) was affected; the seeded and test-window guides of 7.5-B had no window crop and loaded.
- The files, the `snipmunk-img` handler (`guide/current/<file>` → the working folder; `proj/` → package offsets) and the crop rectangles were all correct (checked link by link in the test instance: PNG written before the step line, 200 `image/png`, decoded size = `imageSize`).
- **Fix:** our own observer (`useNear` in `StepPicture.tsx`) puts the `<img>` in when the box is near the screen (900 px margin); the boxes have their size from `aspect-ratio`, so the observer works. A picture that does not load (or loads empty) shows a **"Picture missing"** placeholder (the reason is logged in development builds); the step stays usable. Every failure on the way in the recorder (frame size, PNG encoding, writing) is logged now (`[guide] step N: …`).
- **A second bug found on the way:** the working folder always uses the same file names (`step-0001.png`), and the web view keeps decoded images by address, so a new guide could show the pictures of the guide that was open before. The address of a step picture now carries a generation that changes with every load of the guide.
- **Test:** `scripts/e2e-guide-pictures.mjs` (run against a development test instance, see the header of the script): an own native test window (generated content) captured live → steps through the dev injection path → PNG in the working folder → each picture fetched through the real `snipmunk-img` handler and decoded (status 200, `image/png`, size = the step's) → the editor shows N loaded images → the same with every step CROPPED (the case that failed) → Save as → close → open the `.snpd` → loaded images again → the thumbnail in "Recent". Run against the old lazy code it fails the cropped check (all images stay `complete = false`, width 0); with the fix it passes. Nothing of the real desktop is read.
- Also checked the same way: recovered guides, opened `.snpd` files, the Recent thumbnails (data in the list). Inserted images, pictures from a file/clipboard/the screenshot list use the same `StepPicture` and the same working folder.

### B. Step texts
- Unit tests (`steptext.rs`, `steprec.rs`): taskbar names (`Snipping Tool - 1 running window pinned` → `Snipping Tool`), "in the taskbar / the Start menu / the system tray / on the desktop" (English and formal German), the shell classification by window class, process and UI Automation class (Windows 10 and 11 taskbar), caption buttons (`Maximise` from Windows → "Maximize"/"Maximieren" from our language table), the page-title fallback (`Click in <page title> (Google Chrome)`), the app name chain (package → FileDescription → ProductName → short window title → exe name) with the Store-app case (`SnippingTool.exe` is not a name).
- Packaged apps: the display name comes from `GetApplicationUserModelId` of the process and the shell item `shell:AppsFolder\<AUMID>` (the name the Start menu shows, localized), on a short-lived single-threaded thread with an 800 ms limit, cached per exe.
- Chromium (Chrome, Edge, Electron, web view apps): `Uia::prime` sends `WM_GETOBJECT` with `UiaRootObjectId` to every `Chrome_RenderWidgetHostHWND` of the window, reads the root element and its first child (this makes the renderer build its accessibility tree) once per window: at the start of a guide and whenever a Chromium window comes to the front (polled once a second on the recorder's thread; never in the tests), and before the first click in a window that was not asked yet (up to 400 ms). Our own WebView2 test page already gave names before the priming (`dev_uia_probe`: `Save` / `Button` before and after, 1 render host asked), so the improvement for Chrome itself can only be seen in the real browser.

### C. Layout (checked in the test instance in English, Polish and Arabic)
- The mode switch is in the middle of the top toolbar in all three modes (a grid; under 1000 px it moves next to the left group); ⋯ stays on the right in every mode (in Recording and Documents it only has Settings).
- Documents: header (File ▾ + button / name, chip, steps), then ONE tab with `Name*` when unsaved, × / middle click / Ctrl+W close with the same question as File → Close guide; the toolbar row has the selection actions on the left and Undo, Redo and Record more steps on the right; a sidebar like the Effects panel (Guide: marker, step numbers, pictures, files; Step: picture area, zoom on/off and Adjust zoom area, show marker, Reset to generated text).
- The quick settings button has its own icon (document with a gear).
- Effects/guide sidebar rows wrap: the label keeps at least 96 px and the control moves under it when there is no room ("Border" is no longer cut off).

### You must test by hand
- [ ] **A guide recorded in real apps**: Chrome, Edge, File Explorer, Snipping Tool, Notepad, Office: every step shows its picture (cropped to the window or the screen as chosen); close and open the guide, Save as and open it again; "Record more steps".
- [ ] **Chrome and Edge pages**: the first click already has names ("Click Sign in", not "Click in Google Chrome"); a page without names says "Click in <page title> (Google Chrome)". Also an Electron app (Teams, VS Code, Slack) and a WebView2 app.
- [ ] **Taskbar** (Windows 11 and, if you have it, 10): a button (`Click Snipping Tool in the taskbar`), Start, Search, a tray icon, the clock, the hidden-icons arrow; **Start menu** (an app, Settings, Power); **desktop** (an icon, the Recycle Bin); a second monitor's taskbar.
- [ ] **Store apps**: Snipping Tool, Calculator, Settings, Photos: `in Snipping Tool`, and the caption buttons `Click Maximize` (German: Maximieren).
- [ ] The tab, the sidebar and the centred mode switch in light and dark theme and in Arabic; narrow window (the switch moves next to the left group).
- [ ] Recording mode: the Effects panel, "Border" and the other labels in German, Polish and Arabic.

## 7.5-B3: bars, editor polish, images and tables, step tools, picture area, New-guide area

### Tested (automatic and live in the test instance; generated data only)
- **Bars (A):** the guide bar and the selection overlay's mode bar now use the one bar style of the recording bar (theme surface and text colour, a thin border, no shadow, the same buttons); the recording bar's place is the top centre of the recorded monitor whatever area is recorded (`recording.rs`, unit test).
- **"+" bug (B1):** the insert menu was cut off. The blocks had `content-visibility: auto`, which implies paint containment and clipped everything that sticks out of a block, so the menu of every "+" except the first one (which is outside any block) was invisible. The menu also opens upwards when there is no room below. `scripts/e2e-guide-editor.mjs` opens the menu of the bar between blocks 3 and 4 and of the last one, checks the menu is on top (`elementFromPoint`) and that the text block lands at the right index; `model.test.ts` tests the insert positions.
- **Scroll jumping (B3):** the same `content-visibility` with an estimated size (`contain-intrinsic-size: 560px`) made the real heights differ from the estimate as blocks were rendered, so the scroll height changed while dragging the scrollbar. It is removed; the picture boxes get their size from `aspect-ratio` before the picture loads; the text editor toolbar and the step toolbar float over the content (no height change). The script scrolls a 150-step guide top → bottom → top in 120 steps: scroll height 76813 px before and after, layout shift 0.0000, 0 jumps (the position is what was set).
- **Alt+Up/Down (B2):** the list has `overflow-anchor: none` (the browser followed the moved block), the scroll position is put back after the move and the list is scrolled by the minimum ("nearest") only when the block is no longer on screen. Checked: a short block that stays in view does not change the scroll position at all; a tall step that leaves the view comes back flush with the edge, not centred.
- **Selection (B4, B5):** the frame is inside the block (an inset border, all four sides); a click anywhere on a block selects it, Ctrl/Shift for several; the ⋮ handle only drags.
- **Text blocks (B6):** theme surface with a border, a focus ring, placeholder "Write something…".
- **Images and tables (C):** `ImageNode.tsx`: resize with corner handles (Shift = free), alignment (start/centre/end/full width), non-destructive crop with handles, alt text, delete; tables: column resizing (TipTap), alignment, a table toolbar (rows and columns above/below/left/right, delete, header row, merge/split, alignment). `snpd.rs` test: every attribute survives Save as, an appended save and opening again; a node without the new attributes stays as it was.
- **Step tools (D):** `GuideTools.tsx` in the style of the screenshot annotator (`annobar` / `tool` classes, the same icons where they exist, `tools.tip` tooltips with the letter): Draw (arrow A, line L, rectangle R, ellipse E, highlight H, pen P), Text (text T, callout O, number N), Hide (blur B, pixelate X, black box K), Picture (crop C, zoom area Z, expand area W, move marker M, hide marker), colour and stroke popovers (the screenshot palette plus a custom colour), delete selected, area select, Undo/Redo (the document history). It floats over the top of the selected step's picture, one at a time. Deviation: the guide keeps its own SVG annotation layer; the toolbar components of the screenshot annotator are tied to its canvas store, so the look, the palette, icons, tooltips and tool letters are shared, not the component.
- **Picture area (E):** *Expand area* shows the whole frame with the shown area on it; drag the edges or corners outwards or inwards, or use +25% / +50% / Whole window / Whole screen; stored as the step's `crop`; `an_expanded_or_reduced_area_is_what_is_stored` (the stored picture has the size of the new area, the click moved with it); `areas.test.ts` for the choices. The tool is disabled with "The full screenshot isn't kept in this file" when the picture is smaller than its monitor. Guide default / Active window / Full screen / Custom area are in the sidebar and in the step toolbar; the current choice is a small label on the step; changing the guide default only changes steps set to "Guide default".
- **Shell steps (E2):** `shell_crop` (`steprec.rs`, unit test on rectangles): taskbar and tray = the taskbar window plus 96 px of margin (a "taskbar" that fills the whole picture is not trusted: the clicked button plus margin), Start menu = its window plus 24 px, desktop = the clicked icon plus a generous margin (at least 640 × 400), never the desktop (wallpaper) window; without a usable rectangle the whole picture.
- **New guide area (F):** `AreaMode` Active / Screen / Window / Region; the menu next to "New guide", the choice is remembered (`docArea`) and in the quick settings; Choose window and Select area use the selection overlay of the recording (window and rectangle modes); clicks outside the window or region are ignored and counted, the bar shows the area and "Click outside the area ignored (N)"; a region is also the crop of every step; "Record more steps" uses the area the guide was recorded with (stored in `guide.json`). Live: the dev scenario `region` (own test window): 3 clicks, 1 outside the region → 2 steps, 1 ignored, each step's window rectangle = the region. The window filter is tested as a pure function (`in_area`); the live window path needs real windows (below). The quick settings show "Manual (Ctrl+Alt+S)", following the step shortcut.

### You must test by hand
- [ ] The guide bar, the recording bar and the screenshot overlay bar on your screen in light and dark theme; the recording bar at the top centre of the monitor being recorded (second monitor too), draggable, not in the video.
- [ ] A long real guide (100+ steps): drag the scrollbar, wheel-scroll fast, no jumping; Alt+Up/Down on steps; click on a step's picture, header or empty area to select; Ctrl/Shift click.
- [ ] Pasting from Excel, Word and Chrome into a text block, then resizing, aligning and cropping an image, resizing table columns, the table toolbar (merge/split), saving, closing and opening the file.
- [ ] The step toolbar with the real tools on real steps (cursors, colours, stroke, delete, the letters), RTL (Arabic).
- [ ] Expand area on a real step; Save as; open the `.snpd`: the picture has the new area; with "Keep full screenshots" on, expand after reopening.
- [ ] Taskbar, tray, Start menu and desktop steps now show the shell element, not the wallpaper (Windows 11 and 10 if you have it; second monitor).
- [ ] New guide → Choose window: only that window's clicks are steps, pictures show the window; Select area: pictures cropped to the area, outside clicks ignored with the hint; Record more steps into such a guide; Full screen.

## 7.5-C: fixes, templates, export, quick redact

### Tested (automatic and live in the test instance; generated data only)
- **Drag auto-scroll (A1):** `view.test.ts` (speed by distance from the edge), `moveBlocksTo` (a selection moves together). Live on 150 steps (`scripts/e2e-guide-redact.mjs`, synthetic drag events): nothing in the middle, slowly near the bottom edge zone (about 60 px in a second), about 1600 px in a second at the edge, up at the top, stops with the drag, about 9800 px in 6 s.
- **Page width and zoom (A2):** Narrow / Normal / Wide / Fit window and 50–200 % (control in the corner, Ctrl+wheel, Ctrl+0), stored as `docPageWidth` / `docZoom`; the scroll position follows the new height.
- **Frame of a guide's area (A3):** a click-through window left out of the pictures around the chosen region or window; a window's frame follows it and hides while it is minimized; dimmed and dashed while paused; closed with the guide. Only the placement is unit tested.
- **Recording mode untouched (A4):** the overlay of a guide's pick has its own mode (never written to the settings); unit test.
- **Templates (B):** `template.test.ts` (WCAG contrast of derived colours, the six templates, frame geometry, ratio change keeps centre and zoom, apply and change), `snpd.rs` (a framed step stores what its frame shows, minor version 1), `templates.rs` (the `.snpt` file).
- **Export (C):** `export.test.ts` (HTML self-contained and escaped, clipboard fragment, Markdown links and tables, Word read back from the zip: styles, numbering, pictures, table with header row, TOC field, header/footer with PAGE and NUMPAGES, `w:bidi` / `w:rtl`; page filling), `docexport.rs` (cut, redacted, padded pictures; only export files are written). Live (`scripts/e2e-guide-export.mjs`): a generated guide with a 16:9 corporate template → HTML, Word, Markdown, ZIP, PDF through the app's own code; every pixel under a redaction is black; the PDF has one sheet per page (counted in the file), no step on two pages, embedded fonts with text maps, links; the `.snpd` opens again with the template and frames; own template save / export / import / delete; the page view shows pages.
- **50 steps, debug build:** HTML 5.8 s / 1.25 MB, Word 5.7 s / 624 KB, Markdown 6.0 s, ZIP 5.7 s / 929 KB, PDF 7.5 s / 920 KB (28 pages), PDF with JPEG 6.7 s / 1.1 MB (flat generated pictures compress better as PNG).
- **Quick redact (D):** `redact.test.ts` (e-mail, IBAN, card, custom words, one set of marks, masked typed text), `snpd.rs` (masked typed text is not in the file). Live: Windows OCR on a generated picture finds the e-mail address, the IBAN (read with "OO" for "00") and the card; each is covered in the exported picture; other text is not.
- Note: Windows OCR did not return a generated line "Card number 4111 1111 1111 1111" at all (another test card number on the same picture was read). Check cards on your real pictures.

### You must test by hand
- [ ] Open the exports: **Word** (the TOC asks to update; styles in the Styles pane; edit text, tables, header/footer; landscape; Arabic guide right-to-left), **Acrobat / Edge** (page breaks, header, footer, "Page n of N", contents with page numbers, copy text, links), a **Markdown viewer** (pictures, tables), a **browser** (HTML offline, print preview).
- [ ] **Copy as → Rich text** into Word, Outlook and Confluence (pictures and bold must arrive); Markdown and plain text. (Not run automatically: it would replace your clipboard.)
- [ ] The export dialog with the real save dialog: Export…, Cancel during a long PDF, "Open after exporting", Show in File Explorer.
- [ ] Templates: the six built-ins in light and dark theme and in Arabic; Customize (colours, logo, fonts, frame, header/footer, cover image); Save as my template, rename, duplicate, delete, export, import on another PC; a saved guide on another PC.
- [ ] Picture frame: drag the picture of a selected step, Alt+wheel, the slider, Fit and Fill; save and reopen.
- [ ] **Select area / Choose window**: the red frame on the right monitor, following a moved and resized window, minimized and restored, dimmed while paused, gone after Stop, not in the pictures; the recording area setting unchanged afterwards.
- [ ] Dragging steps near the top and bottom edge of a long real guide (also several selected steps); page width and zoom on a large screen.
- [ ] Quick redact on real screenshots (selected steps and the whole guide), removing a mark (click it, then the trash button), typed-text masking.

## 7.5-C2: fixes after the hand test of 7.5-C

### Tested (automatic and live in the test instance; generated data only)
- **Quick redact on editor windows (A1):** generated pictures drawn like Notepad++ (GDI text, Consolas 11 pt, line numbers; 800x400 to 3840x2160, 100 to 150 %, light and dark). `scripts/e2e-guide-scan.mjs` (removed in 8-D: `e2e-guide-c3.mjs` checks a whole-guide scan): on all seven the e-mail address, the password and the three IBANs (spaces, hyphens, none) are covered, in a whole-guide scan; the saved `.snpd` holds none of the hidden texts. `redact.test.ts` holds the real readings (slashed zero read as O, Ø, e, s; hyphens; split lines).
- **Speed (A2):** seven steps 0.7 s in the debug build (about 0.1 s a step; before: 7 to 40 s a picture). The second scan reuses the kept readings (0.1 s).
- **Texts (A3):** sentences, typed text (also when only the field's name says it is a password), descriptions, content blocks, tables, link addresses and the cover (`redact.test.ts`); a masked step is saved without its original words, control names and window title (`snpd.rs`).
- **Saving after hiding (found this session):** a Save that replaces a picture or masks texts rewrites the `.snpd` without the earlier versions (before, they stayed inside the file); `snpd.rs`.
- **Names (B):** `steptext.rs` (what a text control holds is never its name; "the editor" / "the text field"), `steprec.rs` (a long file description gives way to the product name; the window title is not used when there is an exe name).
- **Toolbar, templates, cover, export dialog (C, D, E):** `scripts/e2e-guide-c2.mjs` and `options.test.ts`: one docked toolbar, block heights unchanged, "⋯" in a narrow window; template menu, update in place, export of several files, import; cover edited in place; background on every page; header texts; contents in the page view; the export dialog at 100, 125 and 150 %.
- **Not run live:** anything that starts a real recording: "Record more steps" with another area, the countdown of the area overlay (unit tests only), and the new step names against real applications.

### Card numbers
Windows text recognition returns nothing for digit groups that are runs of ones ("4111 1111 1111 1111", "6011 1111 1111 1117"), at any size or contrast; the label before them is read. Other test cards (4012 …, 4539 …, 5105 …, 5555 …, Amex 3782 …) are read and covered. Check cards on your real pictures.

### You must test by hand (English first)
- [ ] **Notepad++** with your six lines: record a click into the editor: the step says "Click in the editor in Notepad++" (also after typing: "Type '…' in the editor"), never the text. Also Windows Notepad, Word, a browser textarea, a web form (labelled and unlabelled fields), a password field.
- [ ] **Quick redact** on that step and on the whole guide: e-mail, password and IBAN in the picture and in the texts; how long a scan of a real guide takes; untick items; Undo; save, reopen, export and search the files for the secrets.
- [ ] Save a guide, then Quick redact it, Save again: search the file for a hidden text (guides saved with an earlier version after a redaction still hold the earlier picture inside: use **Save as** on them once).
- [ ] A typing step into a password field: the item "typed text" appears and the export shows dots.
- [ ] **Toolbar**: select steps with a taskbar strip; letters; colour and size; the "⋯" menu at your window sizes.
- [ ] **Template menu**: quick switch; save, update; export one and several (real folder dialog); import several; Manage.
- [ ] Number background and text colours; header and footer places (title, custom text, logo, author); background picture with each option in Page view, PDF, HTML (screen and print) and **Word** (picture behind the text, cover and other pages).
- [ ] The **cover in the editor**: write and format title, subtitle, author, date; logo and background; compare with PDF and Word. Table of contents in Page view and in the PDF.
- [ ] **Record more steps ▾**: each choice, on the other monitor too; the new steps show the chosen area; "Same as before" afterwards uses the last choice; change the countdown in the area overlay and check that Settings → Recording is unchanged.
- [ ] The export dialog on your screen at your scale.
- [ ] `scripts\clean-build.bat` (stop `tauri dev` first).


## 7.5-C3: layout rework and fixes

### Tested (automatic and live in the test instance with `SNIPMUNK_NO_REAL_CAPTURE=1`; generated data only)
- **Quick redact (A):** editor screenshots drawn with smoothed (ClearType) type by `scripts/gen-editor-fixture.ps1` (Consolas and
  Courier New, 100 to 175 %, light and dark, highlighted line). Guarded by `editorShots.test.ts` (real readings of eight
  pictures) and by a real-recognition test in `ocr.rs` on `src-tauri/test-data/editor-cleartype.png`. Live: one step and the whole
  guide over seven pictures covered all 42 secret lines. The OCR debug view opens with boxes and the matches.
- **Quick redact on a real guide (A1, from the hand test):** a Notepad++ guide with Courier New at 100 % (not part of the
  repository). Windows reads "8" as "S", "E" or "B", "0" as "S" or "o" and "l" as "±i" in that thin type, so the check digits of an
  IBAN fail and an address is no address. After the fixes every labelled secret line of its five editor steps is covered, in a
  whole-guide scan and step by step, nothing else is covered, and the saved file holds none of the values. The typed password of a
  typing step is masked too, although its label was split over two steps. Guarded by `editorShots.test.ts` (the reading of
  `thin-cour-100`, drawn by the same script) and `redact.test.ts`.
- **A secret read on a picture is hidden in the texts too** (a value of five letters or more; a password only if it mixes letters
  with other signs).
- **Sidebar, tools, zoom (B, C, E):** `scripts/e2e-guide-c3.mjs`: three tabs, thirteen sections, resize and fold remembered,
  right-to-left; the tools row between text and picture, the clicked step does not move, menus at 100 and 150 % zoom, "⋯" when
  narrow; zoom, drag, Alt+wheel and Fit without a frame; outline select, reorder, delete, undo; several steps.
- **Templates and pages (D):** Blank keeps the content in one undo step; a new guide takes the template of the settings; the column
  at A4 and fitted when narrow; the cover in the page's shape; contents with page numbers; the editor's page breaks match the page
  view; cover and contents alone on their pages; background Custom, Fill and Fit behind the title.
- **Not run live:** printing or saving the PDF from this build, opening the Word file, real file dialogs, a real recording.

### Known limits
- Windows text recognition still drops some lines of smoothed small type completely (2 of 168 on the generated pictures). A line
  whose label and value are both not read cannot be covered: check the picture after Quick redact.
- A line whose label is read but whose value is not is covered from the label to the next wide gap.

### You must test by hand (English first)
- [ ] **Quick redact** on your Notepad++ steps (single and whole guide), then look at every picture and step text. If anything is
  left: Step tab → **OCR debug** → Copy report. A value typed in pieces ("pas", then the rest) leaves its harmless first piece.
- [ ] Ordinary screenshots with labels ("Password:" on a form, "E-mail:" in a window): is too much covered?
- [ ] **Sidebar:** tabs, fold, drag the edge, restart (remembered); select steps in the editor and in the outline; drag in the
  outline with the mouse; Delete there; several steps.
- [ ] **Tools row:** select steps all over a long guide: nothing jumps; all tools and letters; "⋯".
- [ ] **Zoom:** slider, Alt+wheel, drag, Fit, with "Original" and with a 16:9 frame; export and compare.
- [ ] **Blank** and "Template for new guides" (Settings → Documents), then record a guide.
- [ ] **Pages:** A4 and Letter, portrait and landscape: editor lines against Page view, the PDF and **Word** (cover alone, contents
  on own pages, first step on a new page; a long contents list).
- [ ] **Background picture** on the cover with each size, in the editor, Page view, PDF, HTML and Word.
- [ ] A step with "Show step number" off, in PDF, Word and Markdown.
- [ ] German and Arabic afterwards.

## 7.5-C4: the paged canvas, cover and contents designs

### Tested (automatic and live in the test instance with `SNIPMUNK_NO_REAL_CAPTURE=1`; generated data only)
- The test instance keeps its web view data in `E:\SecondDawn\_scratch\wv2` (`WEBVIEW2_USER_DATA_FOLDER`); the start script stops
  it unless every web view process uses that folder.
- **Pages (A):** `scripts/e2e-guide-c4.mjs`. The canvas has as many sheets as the PDF has pages, and every step, paragraph, list,
  picture, table row and contents entry stands on the same page (A4 with cover and contents, after typing and reordering, another
  template, Letter landscape, 50%, a step higher than a page, 150 steps with 30 texts); every kind of text element is as high on the
  canvas as in print; nothing reaches into the bottom margin; header, footer and page numbers on every sheet after the cover; a
  table's header row again on the next page; no layout shift while scrolling; the tools row, the menus, the "+" and dragging work
  on the sheets; fit width, whole page, 100%, Ctrl+wheel; the free canvas of "Screen (no pages)"; Print preview comes back to the
  same place; Print… and Ctrl+P give the print document the same pages, paper and orientation (the call to print was caught), and
  once the real print dialog was opened (nothing was sent to a printer).
- **Speed** (150 steps, 30 texts, 99 pages): key to next frame, median / 95%: development build 13 / 24 ms, built frontend 10 / 21 ms.
  A settings change until the pages are laid out and placed: development build about 450 ms, built frontend 153 ms (worst 190). The
  layout itself takes about 25 ms; the first layout 390 ms (built: 65 ms). In the development build only, a pause in typing costs
  one task of about 130 ms.
- **Cover and contents (B):** the six designs, canvas against preview; vertical and horizontal place, date, logo place, size and
  alignment; right to left; the four contents styles with leaders, numbers, title, size and entries; Word files written (their XML
  is checked by unit tests).
- **Fixes (C):** table alignment on the canvas and in print; button widths; "Tree"; "Default drawing colour" and a new box in that
  colour; the picture-area badge.
- **Sizes and background (D):** canvas, preview and a real PDF (rendered by Windows) show the step text at the set size in pt and
  "Fill" over the whole page.
- The live checks of 7.5-C3 (without its page-break part), `e2e-guide-redact.mjs` and `e2e-guide-export.mjs` passed again.
- **Not run:** a print to paper or through a print driver, opening the Word files in Word, the installer build.

### Known limits
- The cover has no header or footer (as Word's cover pages), and page numbers count the pages after it; Word's "of N" also counts
  the cover.
- A list is not split between pages.
- While a table column is dragged at a zoom other than 100%, the border does not follow the pointer exactly.
- An empty subtitle or author shows on the cover only after a click on the cover.
- The tools row of the selected step takes room on its page while it is open: what stands below it on that page moves down, and on a
  full page it reaches into the bottom margin until the step is unselected.

### You must test by hand (English first)
- [ ] **Pages:** work in a real guide: type, paste, insert images and tables, drag steps, undo and redo, scroll: do pages break
  where you expect, and does anything jump? A4 and Letter, portrait and landscape.
- [ ] **Zoom:** Ctrl+wheel, fit page width, whole page, 100%; selecting text and drawing on pictures while zoomed.
- [ ] **Print preview and Print:** compare preview, a saved PDF and a real printout (or "Microsoft Print to PDF"): margins, header,
  footer, background, page count.
- [ ] **Cover designs** with your logo and picture, each design, with the layout controls; then the PDF, HTML and **Word**.
- [ ] **Contents:** each style and leader, your own title; in **Word** update the field and compare.
- [ ] **Tables:** left, centre, right on the canvas, preview, PDF and Word; a long table over two pages.
- [ ] An older guide with a cover: does it look as before?
- [ ] German and Arabic afterwards.

## 7.5-C5: one File menu, matching headers and bottom bars

### What moved where
| Before | Now |
| --- | --- |
| Settings icon in the window title bar | gone; ⋯ → Settings |
| Save and Edit in Paint icons at the top right (Screenshots) | **File** icon (before ⋯): Save…, Edit in Paint |
| ⋯ → Print…, Open screenshots folder | File (Screenshots); "Open file" stays in ⋯ |
| "File ▾" and the Save button in the Recording and Documents headers | File icon at the top right, the same place in all three modes |
| Documents File menu: Export…, Copy as, Quick redact whole guide, Record more steps | bottom bar (Export, Copy as ▾), the Guide tab, the row above the pages |
| Documents: header row and toolbar row | one row: name, status, steps; Print preview, Template ▾, zoom, Undo, Redo, Record more steps ▾ |
| Zoom pill at the bottom right of the pages | in that row |
| "1 selected ↑ ↓ 🗑" in the toolbar row | over the top start corner of the pages |
| "Delete" under an own template (did not ask) | trash icon on its picture (hover or focus), asks first |

Every File menu ends with **Close Snipmunk**, which does what the window's X does (the close setting decides). "New guide" has the
red of "Record" and "Add capture". Ctrl+O and Ctrl+P act only in the mode they belong to; Ctrl+O also opens a guide from the
Documents home; F2 renames a recording.

### Tested (unit tests and one visual check in the test instance, generated data only)
- The entries of the three File menus and when they can be used; the template for new guides after a delete (unit tests).
- Screenshots of the three modes: title bar, top bar, headers, File menus, one red for the three main buttons, bottom bars of one
  height, the Documents row wrapping at 760 px without overlap, Arabic mirrored, the trash icon and its question.
- **Not run:** end-to-end suites, exports, OCR, measurements. The older `scripts/e2e-*.mjs` still look for removed elements
  (`.recheader__file`, `.gbar`) and need new selectors before their next run.

### You must test by hand
- [ ] Every File menu entry in each mode, and the shortcuts Ctrl+O, Ctrl+S, Ctrl+Shift+S, Ctrl+P, Ctrl+W, F2.
- [ ] File → Close Snipmunk with each close setting (keep running, quit, ask), with an unsaved guide or recording too.
- [ ] A recording that is not saved yet: "Save as project…" and "Discard recording…".
- [ ] Delete an own template that a guide uses: the guide keeps its look.

## 7.5-D: guide edit tools and UI consistency

### What changed
- **Top bar:** the **File** button (☰) is at the far left (far right in Arabic and Urdu), behind a divider the main button of the mode.
  Screenshots: Edit in Paint, Share, Zoom, ⋯ at the end; the top Copy icon is gone (Copy is in the bottom bar).
- **One header** for Recording and Documents: the white card, one row and the tabs (the Recording style, which Screenshots'
  panels share).
- **Documents:** "1 selected ↑ ↓ 🗑" is at the start of the bottom bar.
- **Step tools:** a grid at the top of the Step tab (Draw, Text, Hide, Picture, then colour, size, Delete selected). Nothing is put
  above the picture any more. The letters work on the selected step also with the sidebar folded: A L R E H P, T O N, B X K,
  C Z W S G M. Delete takes away the selected mark; Escape puts away the tool, then the mark, then the selection.
- **Callout (O):** click (box beside the tip) or drag (from the tip to the box); type in place (Enter: new line; Esc or a click
  outside: done; double-click: again). Six shapes, fill, border, width, text colour, font size, bold; handles for the box, the
  round handle for the tip. The box may stand beside, above or below the picture, inside the step. The Text tool types in place too.
- **Spotlight (S)** and **magnifier (G):** drag an area; options under the grid; the spotlight's style also in the Guide tab, with
  "Apply to all steps".
- **Zoom into the click** is inside the picture area; the Step tab says whether the step follows the guide or has its own setting,
  with "Use the guide default".
- The link address of a text block is typed in its toolbar (no browser prompt is left in the app).

### Tested (automatic and live in the test instance with `SNIPMUNK_NO_REAL_CAPTURE=1`; generated data only)
- Unit tests: `marks.test.ts` (callout options, six shapes, frame units, outside positions, zoom, old callouts, handles, magnifier,
  spotlight, tool letters, remembered options, HTML), `zoom.test.ts` (zoom inside the area, guide default and own setting); Rust:
  save and open of callout, spotlight and magnifier, the redacted piece of a magnified area outside the stored picture.
- Live: the three modes, the two headers compared, placing, typing, dragging and resizing a callout, spotlight, magnifier,
  Delete / Ctrl+Z, letters with a folded sidebar, zoom setting, Text tool, an old callout, "Apply to all steps", Escape, link,
  print preview (layer on the picture, same page count), saved and opened again, narrow window, Arabic.
- Exported pictures, by their pixels: dimmed outside the spotlight, the magnifier's bubble shows its area enlarged.
- Old scripts updated and passed again: `e2e-guide-editor`, `-c2`, `-c3`, `-export`, `-redact`, the `edit` section of `-c4`.
  `-scan` was only checked for its elements; the other sections of `-c4` and `-pictures` were not run.

### Known limits
- Arrows, boxes, texts and other drawn marks cannot be moved or resized (not part of this phase).
- A callout or bubble beside a picture that is as wide as the text makes the picture smaller, so that everything fits the step.
- A box can stand at most half a picture width beside and 300 frame units above or below the picture.
- Word, Markdown and "Copy as" get one picture of everything (page colour or transparent around it); PDF and HTML keep the
  picture with its frame and lay a transparent layer over it.
- The Tree's small pictures show no marks. Quick redact does not read or mask the words of callouts (it does since 8-A).
- A version from before 7.5-D that saves a file again drops the small pieces of magnified areas (`docs/snpd-format.md`).
- Found, not fixed (older than this phase): a step set to "Full screen" or an expanded area shows the active window again after
  saving and reopening the guide (the larger picture is in the file). Fixed in 8-A.

### You must test by hand (English first)
- [ ] **Callouts** in a real guide: each shape; type long text, Arabic and German; drag the box far outside, on a framed template
  and with steps beside the picture; then Print preview, a saved PDF, HTML, **Word** and Markdown.
- [ ] **Old guide** with callouts: unchanged on opening; double-click one and move it.
- [ ] **Spotlight**: two on one picture, each shape, light and dark, soft edge; export.
- [ ] **Magnifier**: on small text (is it sharp?), over a blurred area (it must stay hidden), then crop or switch the picture area so
  the source falls outside, save, reopen, export.
- [ ] **Zoom**: with Active window, Full screen and a custom area; with a picture frame; the guide default on and off.
- [ ] The letter keys, Delete and Undo while typing in texts and fields (no tool should react).
- [ ] German and Arabic afterwards.
