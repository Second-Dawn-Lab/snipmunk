# Manual tests: Phase 3 (capture and tabbed settings)

Run these with `pnpm tauri dev` (or `run-snipmunk.bat`) on Windows 10/11. Tick each box. Where a step says "two monitors", use a
second display, ideally with a different scaling (for example 100 % and 150 %: Settings, System, Display, Scale).

Tip: `set SNIPMUNK_TRACE=1` before starting prints how long each capture step took (`[capture] t=... overlay 0 visible ... ms`).

## 1. The shortcut

- [ ] Press **Ctrl+Alt+PrintScreen** with any app in front: the overlay appears (screen frozen, slightly dimmed).
- [ ] The same while Snipmunk's own window is in front, and while it is hidden in the tray.
- [ ] Press the shortcut twice quickly: only one capture starts.
- [ ] Settings, Capture, Change: record **Ctrl+Shift+F8**, Save. The new shortcut works at once, the old one does nothing.
- [ ] Record **Alt+PrintScreen**: the dialog warns that Windows uses it too. (Windows copies the active window to the clipboard as well; with "Copy each capture to the clipboard" on, Snipmunk's capture replaces it.)
- [ ] Try to record **PrintScreen** alone, or Ctrl with an arrow key: Save stays disabled and the dialog says why.
- [ ] "Use the default" puts **Ctrl+Alt+PrintScreen** back.
- [ ] In the settings file (`%AppData%\SecondDawn\snipmunk\settings.json`) set `"captureHotkey": "nonsense"` and restart: a notice appears in the main window and on the Capture page; Add capture still works.
- [ ] Windows 11, Settings, Accessibility, Keyboard, "Use the Print screen key to open screen capture" ON, then press Ctrl+Alt+PrintScreen: note whether the Snipping Tool also opens (see the Phase 3 report).

## 2. Add capture button and tray

- [ ] The **Add capture** button starts a capture in the chosen mode.
- [ ] The ▾ menu: choosing Rectangle, Window, Full screen or Freeform starts a capture in that mode.
- [ ] Tray icon, **Add capture** (right click): starts a capture. The entry is no longer greyed out.
- [ ] After a capture in a mode, the next capture starts in the same mode (`captureMode` is remembered).

## 3. Modes

Rectangle
- [ ] Drag any direction: red border, outside dimmed, size readout next to the selection (for example `640 × 360`), release captures.
- [ ] A click without dragging (or under 4 pixels) does not capture and the overlay stays.
- [ ] The readout shows physical pixels: on a 150 % monitor, a 400 × 300 CSS-pixel drag reads `600 × 450`.

Window
- [ ] Moving the pointer highlights the window under it (not Snipmunk's own windows, no invisible or tool windows).
- [ ] Click captures that window (without the invisible resize border); the capture is named after the window title.
- [ ] A window half off the screen is captured only where it is visible.

Full screen
- [ ] The monitor under the pointer is highlighted; click captures it. With two monitors, each monitor captures only itself.

Freeform
- [ ] Draw a lasso and release: the capture is the bounding box, the outside of the lasso is transparent (open the PNG in `%AppData%\SecondDawn\snipmunk\sessions\<id>\images`).
- [ ] A tiny scribble captures nothing.

Mode bar
- [ ] Top centre of the monitor the pointer was on, with Rectangle, Window, Full screen, Freeform and a close button.
- [ ] Keys **1 to 4** switch the mode; the mode is remembered for next time.
- [ ] The close button, **Esc** and a **right click** cancel; nothing is added.

Magnifier
- [ ] A zoomed loupe follows the pointer with a pixel grid and a red centre; it flips to the other side near the screen edges.
- [ ] Settings, Capture, "Show the magnifier" off: no loupe.

## 4. Delay

- [ ] Delay 3 s: a red badge with 3, 2, 1 appears next to the pointer, then the overlay.
- [ ] The badge is not in the capture. Open a menu or hover a tooltip in another app during the countdown: it is captured as it is at the end.
- [ ] **Esc** during the countdown cancels; the shortcut works again afterwards.
- [ ] Delay 5 and 10 work.

## 5. After a capture

- [ ] The capture appears in the **active group** (switch to Group 2, capture again: it lands in Group 2), selected in the preview, with a thumbnail and its name.
- [ ] Name: the window title (Window mode, or the window under the middle of the selection); " - Google Chrome" style suffixes are cut; with no window, "Screenshot 10:42".
- [ ] **After a capture: Bring Snipmunk to the front**: the main window comes forward with the new capture selected.
- [ ] **Stay in the background**: a small toast appears bottom-right with the thumbnail and "Added to Group 1" (and "Copied to the clipboard"), without taking the keyboard focus; **Open** brings Snipmunk forward; it disappears after about 4 seconds.
- [ ] **Copy each capture to the clipboard** on: Ctrl+V into Paint pastes the latest capture. Off: the clipboard is left alone.
- [ ] Quit Snipmunk and start it again: all captures are still there (also after killing the process in Task Manager).

## 6. Snipmunk's own windows are never in a capture

- [ ] Main window open on top of other content, capture a rectangle that covers it: the capture shows what is behind, not Snipmunk.
- [ ] The same with the Settings window, with the countdown badge (delay) and with the toast (take two captures in a row in background mode).

## 7. Two monitors with different scaling

- [ ] The overlay covers each monitor exactly, with the frozen screenshot of that monitor (no offset, no blur).
- [ ] The mode bar is on the monitor the pointer was on, the keyboard works there.
- [ ] A rectangle on the 150 % monitor and one on the 100 % monitor are cropped exactly where you dragged (compare the edges with the screen).
- [ ] The readout is in physical pixels on both.
- [ ] A window that spans both monitors is captured completely in Window mode (stitched).
- [ ] Unplug or add a monitor while Snipmunk runs, then capture: it still works (the first capture after the change may be slower).

## 8. Settings window

- [ ] Pages on the left: General, Capture, Sessions, Copy & paste, About; each shows its settings.
- [ ] Type in the search box ("clip", "magn", "retention"): matching settings appear grouped by page; clicking one opens its page, scrolls to it and highlights it for about 2 seconds.
- [ ] The search works in the current language (switch to German and search "Zwischenablage").
- [ ] About: name, version, GitHub and License open in the browser, "Help translate" opens the issues page, Check for updates is greyed out.
- [ ] Changes apply at once and are still there after a restart.

## 9. Arabic (right to left)

- [ ] Language: العربية. The settings sidebar is on the right.
- [ ] Start a capture: the mode bar is mirrored (buttons in right-to-left order), texts are Arabic, the keys 1 to 4 still work.
- [ ] The toast and the notice are mirrored and readable.

## 10. Clean up

- [ ] Delete `%AppData%\SecondDawn\snipmunk` if you want a fresh start.
