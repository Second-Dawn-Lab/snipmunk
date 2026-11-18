# Snipmunk roadmap

Status: Phases 1 to 5 (including the 3.1 and 4.1 fixes) are done. Phase 5.5 (text recognition and the Phase 5 fixes) is the current one.

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

## Phase 5.5: Text recognition and Phase 5 fixes (in progress)
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

## Phase 6: Copy and share
- Copy / paste all or only the selected captures
- **Copy modes**: Separate (each screenshot is its own picture), Stack (one tall picture), Grid (one picture with a grid)
- Drag screenshots out into other apps
- Save, Share, Edit in Paint, Print and Open file

## Phase 7: Screen recording

## Phase 8: Polish, installer and the first release
- **Auto-keep sessions**: every change is saved at once (storage foundation: Phase 2)
- **New session** behaviour: ask, export automatically or clear
- **Clear on exit** and **retention** (delete old sessions after N days, default 30)
- Export folder, save and export
- Installer
- **v0.1.0**: first Windows release

## Phase 9: macOS
**v0.2.0**: macOS support.
