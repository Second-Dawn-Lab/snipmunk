# Manual tests: Phase 7 (screen recording) and the Phase 6.1 retest fixes

Items marked **[REAL INPUT]** need a real mouse, keyboard, camera, microphone, second monitor or another program.

Status of this phase: Part A (A1 to A5) is built. Part B (screen recording) is **not built yet**: only its pure, unit-tested logic
exists (`src/recording/`: cursor track and click effects, webcam overlay layout, trim and pause timeline, disk-space levels, render
cache key, GIF plan and size estimate). The B tests below are for when the native recorder exists.

## A. Fixes from the Phase 6.1 retest

### A1. Copy ▾ in the bottom bar (removed again in 7-A.1: see below)

### A2. Right-click menu in the text layer
- [ ] **[REAL INPUT]** Select words in Text actions, right-click: **Redact only this** covers just the selection (one Ctrl+Z removes it) and does not touch the word list; **Always redact this** still adds the word.

### A3. Save dialog folder
- [ ] The dialog shows the folder path: the export folder if set, else the last used folder, else Pictures. **Change…** opens the folder picker (**[REAL INPUT]**) and the choice is used and remembered.

### A4. Marks lock (like the Snipping Tool)
- [ ] A new pen stroke, highlighter stroke, shape, arrow, text, emoji or black box can be moved, resized (handles), rotated and restyled (popover) right after it is made.
- [ ] A click elsewhere, another tool, another capture, Esc or Enter commits it: it cannot be selected, moved or edited any more (also not with the Select tool; old captures' marks count as committed).
- [ ] Undo / Redo, the Eraser and "Erase all mark-ups" still remove committed marks. "Apply redactions permanently" and Quick redact's "Remove all redactions" still work.
- [ ] The Text tool: the box stays editable while you type; when finished the tool goes back to Select with the box selected; double-click a committed text does nothing.

### A5. Hold to shape
- [ ] Pen: draw a line, an arrow (shaft and two barbs), a circle or ellipse, a rectangle or square, a triangle and a star, then keep the pen still for about a second before releasing: the stroke becomes a clean shape in the pen's colour and size with a short flash.
- [ ] A scribble, a letter, an open curve and a tiny stroke stay freehand. The Highlighter snaps too (the shape stays see-through).
- [ ] The new shape can be moved, resized and rotated until you click elsewhere (A4).

## B. Screen recording (not built yet)

- [ ] B1 The 📷/🎥 switch, Record split button (Rectangle / Window / Full screen), Countdown, recording options (frame rate, quality, system sound, microphone, webcam, cursor, click effect); Ctrl+Alt+R and the tray item.
- [ ] B2 Overlay, countdown, red frame, floating bar (timer, pause, stop, discard, sound toggles) with RTL layout; Snipmunk windows are not in the recording.
- [ ] B3 **[REAL INPUT]** 10-minute recording: audio and video stay in sync; 60 fps; pause and resume without gaps; microphone denied in Windows privacy settings (clear message and link); webcam on and off; kill the process while recording and recover the recording at the next start; low disk space (warning, safe stop); two monitors with different scaling.
- [ ] B4 A recording is a card with a 🎥 icon and its duration; annotation tools, text recognition, Stack/Grid, Edit in Paint and Print are disabled for it.
- [ ] B5 Player: cursor, halo, click effects and webcam drawn live, Space, seek, volume, full screen, side panel, trim handles.
- [ ] B6 Render (progress, cancel, cache), Copy, Save MP4, Convert to GIF (Low / High, size information, warning when very large).
- [ ] B7 Recording goes on with the window hidden; the hotkey works from any app; monitor or webcam unplugged mid-recording keeps what was recorded.

## 7-A.1: fixes from testing Part A

1. **No "Copy as files".**
   - [ ] The bottom-bar Copy is a plain button (no ▾), the card menu has Copy and Save only, and Settings → Copy & paste has no "Also copy the pictures as files".
2. **Copy and Save with nothing selected.**
   - [ ] Nothing selected: the button reads **Copy** and copies the capture shown in the preview (right after a capture that is the new one). Bottom-bar **Save** saves that capture too.
   - [ ] With 3 selected it reads **Copy 3** and copies those three in the chosen mode. **Select all** (Ctrl+A) then Copy copies the whole group.
3. **Copy each capture to the clipboard defaults to ON.**
   - [ ] Delete the settings file (`%AppData%\SecondDawn\snipmunk\settings.json`) and start Snipmunk: Settings → Copy & paste shows it on, and a new screenshot is on the clipboard.
4. **Save dialog folder row.**
   - [ ] Label, the path and **Change…** sit on one line; a long path is cut with an ellipsis and the full path is the tooltip. Check in English, German and Arabic (right to left).
5. **Move a new mark by its body.**
   - [ ] Right after drawing a rectangle, ellipse, arrow, line, black box, pasting an emoji or a text, and right after a pen stroke snapped to a shape: press on the mark's body or border and drag: it moves (the cursor shows the move cursor). The handles still resize and rotate. A freehand pen stroke is not moved by pressing next to it (the pen draws).
6. **Cursors on the canvas.**
   - [ ] Select: arrow. Over the mark just made: move cursor. On its corner / side handles: the matching resize cursor (a rotated mark uses the nearest direction); on the rotate handle: a rotate cursor.
   - [ ] Pen and Highlighter: a ring the size the stroke has on the screen, in the tool's colour (change size and colour in the popover and zoom). Eraser: a dashed ring. Text: I-beam. Shapes, Blur, Crop: a thin crosshair. Space or middle button: hand, closed hand while dragging.
   - [ ] At 25 %, 100 % and 400 % zoom, at 125 % / 150 % display scaling, and in Arabic. The red screenshot crosshair appears only in the capture overlay.

## 7-B1 (recording core): what exists and what to test

Built in this step: the 📷/🎥 mode switch, the red **Record** split button (Rectangle / Window / Full screen), the countdown (None / 3 / 5 / 10 s), the ⚙ recording options (frame rate 30 / 60, quality, system sound, microphone; webcam, cursor and click effect are listed as "Coming in the next update"), the tray item **Start recording**, the settings and the data model (a capture of kind "video" with a duration, a 🎥 badge and duration on the card, no editor for videos). **Starting a recording says that the recorder is not part of this version yet**: Windows.Graphics.Capture, Media Foundation H.264, WASAPI audio, the cursor track, the floating bar, the player, MP4 render, crash recovery and Ctrl+Alt+R are not built (see the report of this step).

- [ ] The switch changes the top bar: Record button, Countdown, ⚙ (and back). The choice is remembered after a restart. Arabic: the bar is mirrored.
- [ ] ⚙ options are remembered (frame rate, quality, sound, microphone). The webcam / cursor / click effect rows are greyed out with the "Coming in the next update" hint.
- [ ] Record (or an area from the ▾ menu, or the tray item) shows an error toast that the recorder is missing; nothing else happens.

### Text box frame (7-A.1)
- [ ] **[REAL INPUT]** While a text box is being edited it has a visible border with a grab zone of about 8 px around it: pressing and dragging there moves the box (move cursor on hover); inside the text the I-beam and caret work as before; the handles still resize and rotate. Check at 25 %, 100 % and 400 % zoom, with a rotated text, and in Arabic.

## 7-B1 native recorder: M0 and M1 (done), M2 to M9 (not built)

- [ ] **M0** Text tool: while a text is being edited its frame and handles look like those of a selected shape (thin blue frame, white square handles, round rotate handle; no red border). **[REAL INPUT]** Dragging the frame, a handle or the rotate handle moves, resizes or turns the box live (frame, text and caret follow the pointer), also at 25 % and 400 % zoom and rotated.
- [ ] **M1** **[REAL INPUT]** Switch to 🎥, press Record: the monitor under the pointer is recorded (no mouse cursor in the picture); the red bar shows the time and **Stop recording**; after Stop a card "Recording <date>" with 🎥 and the duration appears in the active group; the preview says the recording cannot be played yet. Deleting the card removes its folder `sessions\<id>\recordings\<rec>\` (screen.mp4, first.png, recording.json).
- Checked in the test instance (own window only): 6.0 s of a 1056x708 window with a moving counter gave a valid MP4 (`ftyp mp42`, Windows reads a length of 6 s), 357 frames, 861 KB; recording.json written.
- Not built yet: areas and countdown (M2), floating bar, pause, discard (M3), audio (M4), cursor track (M5), crash recovery, disk checks (M6), player (M7), render / save / copy (M8), Ctrl+Alt+R (M9).
