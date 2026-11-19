# Snipmunk roadmap

Status: Phases 1 to 5.5 (including the 3.1 and 4.1 fixes) are done. Phase 6 (copy and share, gallery search, fixes from Phase 5.5 testing) is the current one.

## Phase 1: Repo setup ✅
Project folder, README, license, `.gitignore`, roadmap and icon placeholder.

## Phase 2: App shell ✅
- Widget-style window with a custom title bar, remembered size and position
- Start with Windows, tray icon, close behaviour (keep running, quit or ask)
- Desktop shortcut and Start menu shortcut from the installer
- Settings window
- Session storage foundation: sessions, groups and captures are kept on disk automatically (`%AppData%\SecondDawn\snipmunk\sessions`), so nothing is lost when the app closes or crashes; the UI is wired to it
- Main window layout (no real capture or editing yet): group tabs, capture list, preview, annotation toolbar, copy bar

## Phase 2.1: Layout, theme, languages and right-to-left ✅
UI and UI state only: buttons for later features are in their final place, with icons, tooltips, menus and translations, but disabled or marked "Coming soon".
- Top bar like the Snipping Tool's: Add capture with a mode menu (rectangle, window, full screen, freeform), delay, screenshot/recording switch, New session, Edit in Paint, Save, Copy, Share, Zoom and a More menu
- Annotation toolbar with pen, highlighter and eraser popovers, a shapes sub-toolbar (emoji, shapes, fill, outline), text, crop, rotate, blur, text actions (OCR) and undo/redo
- Delete asks first and deletes all selected captures
- Neutral light and dark theme with the Snipmunk colors as accents only, checked against WCAG AA
- 12 languages (English, German, Spanish, French, Italian, Dutch, Polish, Turkish, Simplified and Traditional Chinese, Arabic, Urdu), with the system language as the default and correct plurals
- Right-to-left layout for Arabic and Urdu (Persian and Hebrew are ready for later)

## Phase 3: Capture and tabbed settings ✅ (with the 3.1 fixes)
- **Capture flow**: the screen is grabbed first, then one overlay per monitor shows the frozen screenshot, dimmed outside the selection, with a red selection border, the red crosshair and a mode bar
- **Modes**: rectangle (live size in physical pixels), window (the window under the pointer), full screen and freeform (lasso, transparent outside the path); keys 1 to 4, Esc or right click cancels
- **Delay** (0, 3, 5, 10 seconds) with a countdown badge, also chosen in the overlay's mode bar (the screen is grabbed after the countdown); Esc cancels
- **Global hotkey**, default **Ctrl+Alt+PrintScreen**, changeable in the settings with conflict warnings, and working inside Snipmunk's own windows too; also the Add capture button (with its mode menu) and the tray item
- Magnifier loupe, multi-monitor and mixed-DPI math in tested pure modules
- Result: PNG and thumbnail in the session folder, added to the active group, named after the window, optionally copied to the clipboard; Snipmunk comes to the front or shows a small toast
- Snipmunk's own windows are left out of Snipmunk's captures (the main and settings windows only while the screen is grabbed, so other tools can still capture Snipmunk)
- **Settings tabs + search**: General, Capture, Sessions, Copy & paste, About, with a search box that jumps to a setting
- Still to verify with real hardware: two monitors with different scaling, and what Windows does with the PrtScn combo (see `docs/manual-tests-phase-3.md`)

## Phase 4: Session gallery and groups ✅ (with the 4.1 fixes)
- **Views**: the capture list as a list, medium thumbnails (160 px) or large thumbnails (260 px), remembered (`galleryView`, also in Settings, Sessions). Thumbnails are made at 520 px; thumbnails of earlier versions are upgraded in the background. The list is virtualized, so a group with hundreds of captures stays smooth.
- **Selection**: click, Ctrl+click, Shift+click (range), Ctrl+A, Esc, the check boxes; each group keeps its own selection.
- **Reorder and move by dragging** (pointer events, so they work next to the native file drop): reorder inside a group (switches the sort to Custom order and saves it: this is the copy order of Phase 6), drag onto a group tab to move, drag group tabs to reorder them, auto-scroll at the edges.
- **Context menu and keyboard**: Rename (inline, F2), Duplicate, Move to, Delete (Copy and Save are there, greyed out until Phase 6); arrow keys (mirrored in right-to-left), Shift+arrows, Page Up / Down, Home / End, Enter, Del.
- **Drag images in**: PNG, JPG, WebP, BMP and GIF (first frame) from Explorer onto the list or a group tab; images dragged from a browser when it hands over a file (a bare web address only shows a hint, nothing is downloaded). Imported captures are copied into the session folder like screenshots.
- **Groups**: colour (9, yellow since 4.1) and emoji (12) per group, rename, delete with the choice to move or delete the captures (the last group stays), tab strip with scrolling, fading edges and a list of all groups.
- **New session**: "Ask me" offers *Keep the current captures* or *Start fresh*; "Delete them" starts fresh without asking.
- **4.1 fixes**: submenus are real flyouts (open on hover after about 300 ms, on click and with → / ←; flip or shift when there is no room; a safe triangle keeps them open while the pointer crosses other entries; keyboard and RTL aware); a ninth group colour, yellow; new groups get the lowest free "Group N" number in the user's language (renamed groups do not count).
- Not in this phase: dragging captures out into other apps (Phase 6, a native drag with tauri-plugin-drag; the internal drags do not use HTML5 drag and drop, so nothing blocks it), export (Phase 8). See `docs/manual-tests-phase-4.md`.

## Phase 5: Annotation tools ✅
- **Non-destructive**: the original image file is never changed. Marks, crop and rotation are editable objects in the capture's `annotations` (versioned schema, old captures load fine, duplicates copy them), saved to disk at once.
- **One renderer** (`src/annotate/render.ts`) draws original + annotations + crop/rotation for the preview, the card thumbnails (regenerated after an edit) and, in Phase 6, copy and export.
- **Tools**: Select (move, resize, rotate, multi-select, restyle from the popovers), Pen (smoothed, pressure aware, Shift = straight), Highlighter (one layer per stroke), object Eraser and "Erase all mark-ups", Shapes (rectangle, ellipse, line, arrow, with Fill and Outline), emoji stickers, Text (right-to-left aware, label background), Crop (aspect presets, reset), Rotate and flip, Blur / redact (pixelate, blur, black box: pixels are really replaced), undo and redo per capture, Ctrl+wheel zoom and Space / middle-button pan, tool shortcuts V P H E S T C R B.
- Plain canvas, no drawing library: the renderer is pure and tested.
- Still to come: copy and share of the annotated picture (Phase 6), text recognition and quick redact (Phase 5.5). See `docs/manual-tests-phase-5.md`.

## Phase 5.5: Text recognition and Phase 5 fixes ✅ (with the fixes of Phase 6, part A)
Fixes to Phase 5:
- **Text boxes resize properly**: corner handles scale the text (font size, box and size popover together), left and right handles change the width and the text wraps again, the height always fits; works rotated, at any zoom, with a label background, right-to-left and CJK; one undo step per resize.
- **Mouse wheel**: the wheel zooms at the pointer (also Ctrl + wheel and a touchpad pinch), Shift + wheel pans sideways, Space + drag and middle-button drag still pan. Setting "Mouse wheel": Zoom (default) or Scroll (the wheel pans, Ctrl + wheel zooms). Zoom steps are smooth, and the first zoom no longer stalls (the window is told about the new zoom once the movement has settled).
- **Group names** at startup and for a fresh session are in the interface language.
- **Blur ▾ → Apply redactions permanently**: burns the redactions into the stored picture (atomic write, new thumbnail, redaction marks removed, other marks, crop and rotation stay). Undo and redo bring the earlier picture back from memory only; nothing of it is kept on disk or in temp files, and after quitting the burn-in is final.
- **README privacy notes** about the clipboard copy and about redactions in copies versus the stored original.

Text recognition, local and offline:
- **Engine**: the Windows text recognition (`Windows.Media.Ocr`): word boxes, no model, no download, works offline, uses the languages Windows has the "Optical character recognition" feature for. (`dawn-ocr` has no word boxes and no model engine yet, so it is not used; a model engine such as RapidOCR can be added behind the same functions later.) Languages the machine does not have must be added in Windows; the settings page says so and links to the Windows language settings.
- It reads the capture *with* crop, rotation, flip and redactions applied and *without* the other marks; the result (words with boxes, lines, reading order, direction) is cached per capture and read again when any of those change. A low-priority background worker reads each new capture ("Recognize text automatically after capturing", on by default).
- **Text actions** toolbar: an invisible text layer over the picture (drag to select, double-click a word, Ctrl+C, right-click: Copy / Copy all text / Select all; hover highlight; right-to-left and CJK reading order), **Copy all text**, **Copy as table** (HTML and tab-separated text on the clipboard; disabled when no table is found), **Quick redact** (email addresses and phone numbers, black boxes, one undo step, "Remove all redactions" removes only the Quick redact ones).
- **Settings → Text recognition**: engine, installed languages, language choice, automatic recognition, model state ("none needed"), Quick redact defaults.
- See `docs/manual-tests-phase-5.5.md`.

Fixes from Phase 5.5 testing (done in Phase 6, part A):
- **Text actions look like the Snipping Tool**: the picture is dimmed and the recognized text lines stay bright with a light outline; the selection is on top.
- **Quick redact with more types** (all remembered in the settings): e-mail addresses, phone numbers, credit card numbers (13 to 19 digits, Luhn check), IBANs (country, length, mod-97), passwords and secrets (only the value after a label, labels in all interface languages and common English ones), and the user's own words (Settings, Text recognition; also "Always redact this" in the text layer's menu). No address detection.
- **Text tool rework**: click on empty canvas makes a box at a normal size with a cursor; a click elsewhere finishes it and starts the next; a click on an existing text edits it, a drag moves it; handles scale, rewrap and rotate; Esc / Ctrl+Enter / another tool finish; empty boxes disappear (a small state machine in `src/annotate/textTool.ts`).
- **Screen-based sizes for every tool**: the size popovers mean what is seen on the screen at the current zoom; marks get picture pixels when they are made; existing marks do not change.
- **Apply redactions permanently**: tooltip hint, "n redactions applied permanently", a short flash on the baked areas, "Redactions restored" on undo.

## Phase 6: Copy and share, gallery search ✅ (with 6.1 and the 7 retest fixes)
Everything that leaves the app uses the shared renderer (marks, crop, rotation, flip, redactions with destroyed pixels), in the group's current order. Temp files live only in `%AppData%\SecondDawn\snipmunk\temp` and are deleted at the next copy of that kind and at quit.
- **Copy** (bottom bar: "Copy all (n)" or "Copy 3"; top bar: the capture shown; card menu): Separate (files + HTML + PNG + bitmap on the clipboard), Stack (one picture, 16 px gap, white, centred) and Grid (2 / 3 / 4 columns by count, 16 px gap, white, cells as big as the largest capture of the row). Extremely large pictures (over 16k pixels a side or 200 megapixels) are refused with an offer to copy separately.
- **Drag out**: dragging a card out of the window starts a native drag of the rendered PNG files (the `drag` crate); internal reorder and move drags are unchanged.
- **Save**: PNG, JPEG, WebP (quality), BMP, ZIP; file names by capture name, group + number + name, or date and time; Windows-safe names; never overwrites; remembers format, naming, quality and folder; "Open folder" in the notice.
- **Share** (Windows share sheet), **Edit in Paint** (rendered temp PNG, default editor as fallback), **Print** (Ctrl+P, one capture per page), **Open file** (Ctrl+O, several files), **Open screenshots folder**.
- **Gallery search** (Ctrl+F): capture name, window title and recognized text; accent, case and Arabic-spelling insensitive, CJK substrings, all words must match; "This group" or "All groups" with group badges; the matching words are marked in the preview.
- **6.1 fixes** (from the Phase 6 manual tests): Grid pastes in Word and Paint (24-bit padded clipboard bitmap), an option to leave the file list off the clipboard so Outlook gets the pictures inline, the Text tool makes one box per activation and goes back to Select, small and monospace text is read again enlarged and lines only one pass found are kept, card and IBAN detection tolerates O/l/S/B read for digits (checksums still decide), the Quick redact main button redacts at once, the text layer's right-click menu works, "Open folder" opens the real folder, the list view's check box and trash no longer overlap, every notice is a toast, a clear page when the dev server is gone, the caret goes where the user clicked, and `tauri-plugin-dialog` replaces `rfd`.
- See `docs/manual-tests-phase-6.md`.

## Phase 7: Screen recording (in progress)
Done (Part A, fixes from the 6.1 retest): Copy ▾ with "Copy as files" (replaces the 6.1 setting), "Redact only this" in the text layer's menu, the Save dialog's folder row with "Change…", marks that lock like the Snipping Tool's (only the mark just made is editable; Undo, Eraser and "Erase all mark-ups" remove committed ones), hold-to-shape for the pen and highlighter (line, arrow, ellipse, rectangle, triangle, star).

Scope of Part B (screen recording, Windows first, behind a platform abstraction so macOS ScreenCaptureKit can follow in Phase 9):
- The screen is recorded **without the cursor** (Windows.Graphics.Capture); system audio (WASAPI loopback), microphone, webcam and the cursor track (positions, shapes, buttons) are separate tracks; cursor effects, webcam overlay and trim are applied when playing and rendering, so everything can be changed afterwards.
- Hardware H.264 through Media Foundation, written to disk as it goes in a crash-safe layout; recovery offered at the next start.
- A recording is a "video" capture in the group (cards with a 🎥 icon and the duration); a player with live effects and a side panel; trim; render, copy, save as MP4; convert to GIF.
- Built so far: the pure logic in `src/recording/` (cursor track and click effects, webcam layout, trim and pause timeline, disk space levels, render cache key, GIF plan). The native recorder, the recording UI, the player, render and GIF export are not built yet. See `docs/manual-tests-phase-7.md`.

## Phase 7.5: Snipmunk Studio and copy options
- **Snipmunk Studio**: auto-zoom on clicks, cursor smoothing, more effects, an editor for recordings (Windows and macOS).
- Stack and Grid options: numbers and labels on the captures, the gap, the background colour, the number of columns.

## Phase 8: Polish, installer and the first release
- **Auto-keep sessions**: every change is saved at once (storage foundation: Phase 2)
- **New session** behaviour: ask, export automatically or clear
- **Clear on exit** and **retention** (delete old sessions after N days, default 30)
- Export folder, save and export
- Installer
- **v0.1.0**: first Windows release

## Phase 9: macOS
**v0.2.0**: macOS support.
