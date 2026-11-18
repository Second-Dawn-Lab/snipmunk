# Snipmunk roadmap

Status: Phases 1, 2 and 2.1 are done. Phase 3 (capture and tabbed settings) is the current one.

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

## Phase 3: Capture and tabbed settings (in progress)
- **Capture flow**: the screen is grabbed first, then one overlay per monitor shows the frozen screenshot, dimmed outside the selection, with a red selection border, the red crosshair and a mode bar
- **Modes**: rectangle (live size in physical pixels), window (the window under the pointer), full screen and freeform (lasso, transparent outside the path); keys 1 to 4, Esc or right click cancels
- **Delay** (0, 3, 5, 10 seconds) with a countdown badge; Esc cancels
- **Global hotkey**, default **Ctrl+Alt+PrintScreen**, changeable in the settings with conflict warnings; also the Add capture button (with its mode menu) and the tray item
- Magnifier loupe, multi-monitor and mixed-DPI math in tested pure modules
- Result: PNG and thumbnail in the session folder, added to the active group, named after the window, optionally copied to the clipboard; Snipmunk comes to the front or shows a small toast
- Snipmunk's own windows are left out of every capture
- **Settings tabs + search**: General, Capture, Sessions, Copy & paste, About, with a search box that jumps to a setting
- Still to verify with real hardware: two monitors with different scaling, and what Windows does with the PrtScn combo (see `docs/manual-tests-phase-3.md`)

## Phase 4: Session gallery and groups
- Collect the session's screenshots in the widget window; select, reorder and delete
- **Groups**: organize captures into groups, rename, move captures between groups

## Phase 5: Annotation tools
Pen and highlighter with their palettes, shapes, emoji stickers, fill and outline, eraser, text, crop, rotate and blur, with undo and redo. The tool popovers and their remembered colors and sizes exist since Phase 2.1.

## Phase 5.5: Text recognition
Local and offline, with `dawn-ocr`:
- Copy all text
- Select text on the screenshot by dragging, then Ctrl+C or right-click to copy
- Copy as table
- Quick redact: email addresses and phone numbers
- Show the supported OCR languages in the settings

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
