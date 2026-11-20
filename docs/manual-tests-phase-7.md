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

## R0 and M2 (done; M3 to M9 not built)

### R0: separate recording UI
- [ ] The 📷/🎥 switch changes the whole window. In 🎥: Record ▾ / Countdown / ⚙ / New session, a list of recordings on the left (tabs, rename, colour, emoji, reorder, delete with move/delete, search by name), a placeholder on the right (thumbnail, size, duration). No annotation toolbar, no Separate/Stack/Grid, no Edit in Paint / Open file / Print; Save, Copy and Share are greyed out ("Coming soon") until the rendered video exists.
- [ ] Screenshots never show in the 🎥 list and recordings never show in the 📷 list. Each kind has its own "Group N" numbering and its own last group that cannot be deleted. The first recording group is made when you enter 🎥 mode.
- [ ] An old session with a recording inside a screenshot group: after the update the recording is in a recording group (Rust test: `recordings_in_a_screenshot_group_move_to_a_recording_group_when_the_session_is_opened`).
- [ ] Context menu in 🎥: Rename, Move to, Delete (no Duplicate); selection, Ctrl+A, arrow keys and the three gallery views work.
- Not done: the group on show in each mode is remembered while the app runs, not across restarts.

### M2: areas and setup
- [ ] **[REAL INPUT]** Record ▾ → **Rectangle**: the selection overlay opens with the modes Rectangle / Window / Full screen only (no freeform, key 4 does nothing) and the countdown dropdown (it changes the recording countdown, not the screenshot delay). Drag a rectangle: only that area is recorded (check the size of the video and the picture).
- [ ] **[REAL INPUT]** **Window**: click a window: that window is recorded (its handle is used).
- [ ] **[REAL INPUT]** **Full screen**: the monitor under the pointer, after the countdown. Countdown None / 3 / 5 / 10 with the badge; Esc cancels and nothing is recorded.
- [ ] **[REAL INPUT]** A thin red frame is around the recorded area during recording and is not in the video; Snipmunk's main and settings windows are not in the video (also if they overlap the area); both are back to normal after Stop.
- Checked in the test instance (own window only): a window recording of 10 s gave 281 frames (28 fps, limit 30) and 1.07 MB for 1056x708; a rectangle recording (the monitor cut to the test window's area) gave 323 frames in 11.6 s (28 fps), 0.78 MB, source "region", 1056x708. The two recordings landed in the recording group, the screenshot stayed in the screenshot group.
- Bitrate: Standard is about 0.02 bits per pixel and frame (3440x1440 at 30 fps: 3 Mbit/s, at most ~22 MB a minute), High twice that. **[REAL INPUT]** Measure MB per minute on your monitor at 30 and 60 fps (the real size depends on how much changes on the screen).
- [ ] The first picture of a region recording (the card's thumbnail) is the recorded area only, not the whole screen (fixed at the end of this step; not checked in the test instance).

## F1 to F4 and M3 (partly): done in this step

- [ ] **F1** **[REAL INPUT]** Rectangle recording: the video is the right way up (it was flipped: a raw buffer given to the Media Foundation encoder is read bottom-up, so the cropped frames are now sent with their rows reversed; Rust test `a_cropped_frame_is_sent_bottom_up`). Window and Full screen are unchanged.
- [ ] **F2** The ⚙ of the recording bar is a camera with a small gear (the title bar keeps its sliders icon); both have tooltips.
- [ ] **F3** Medium and Large views in the recording list: the card is not cut off; the 🎥 duration is a badge on the thumbnail. Also in Arabic (badge on the other side) and in the List view.
- [ ] **F4** **[REAL INPUT]** When the recording starts (after the countdown) the main window minimizes (a hidden or minimized window stays that way); at Stop the main window comes back to the front in the 🎥 mode with the new recording selected.
- [ ] **M3 (partly)** **[REAL INPUT]** A small always-on-top bar appears at the top centre of the recorded monitor: red dot, timer, Discard (asks "Discard? Discard / Keep") and Stop; it is not in the video; drag it anywhere by its background. The tray item reads "Stop recording" while recording and stops it. The bar is closed with the red frame when the recording ends. Not built: pause / resume, the system sound and microphone toggles on the bar.
- Checked in the test instance: the bar and the red frame windows appear when a recording starts and are gone after Stop; recordings stop and make a card. The player can load the MP4 through `snipmunk-img` with range requests (a `<video>` element decoded it).
- **Privacy note:** a test of the rectangle path recorded the monitor behind my test window (my window was not on top), which showed the real desktop. That test data was deleted at once and the development shortcut for rectangle tests was removed. Region recordings can only be checked by hand.

## H1 and H2 (freeze fix, focus after minimize)

**Root cause of the freeze.** `start_now` held the recorder's mutex for the whole start, including `announce`, `is_visible()` and `minimize()` of the main window. Those calls make the thread wait for the main thread. The floating bar (new) loads its page about a second later and calls the synchronous command `recording_state`, which runs on the main thread and wanted the same mutex: the main thread waited for a lock held by a thread that waited for the main thread, so the whole app froze ("Not responding"). Before the bar and the minimize call the lock was held only while the capture started, so it never happened. Fix: whether a recording runs, and since when, is in atomics (`recording_state` and `is_recording` never wait); the start claims the recorder with an atomic, does its work without any lock, puts the recording in under a short lock, and only then updates the tray, emits the event and minimizes the window (on a separate thread). A development-build watchdog asks the main thread for a sign of life every 250 ms while recording and prints `[recording] the main thread has not answered for 500 ms` to the console if it does not answer.

Verified in the test instance **without any screen capture**: a generated-frame recording (`start_recording` with the development source `__synthetic__`: moving test pattern, 640x360) goes through the real start, red frame window, floating bar window, tray update, minimize, watchdog and stop. During 6 s the page asked `recording_state` 20 times: the slowest answer took 31 ms (average 4 ms); no watchdog line; Stop made the card. The decoded video is upright (red square top left, blue bottom right), which also verifies the F1 row reversal. Per-frame crop-path work (row reversal and copy) of a 3440x1440 frame takes 11.8 ms in a debug build (test `the_crop_and_flip_of_an_ultrawide_frame_are_fast`).

- [ ] **[REAL INPUT]** Record Full screen, Window and Rectangle: Snipmunk stays responsive for the whole recording (also while the floating bar is dragged), Stop works from the bar, the tray and the app. If a freeze ever shows again, the console of a development build has the watchdog lines.
- [ ] **[REAL INPUT]** H2: when the recording starts and Snipmunk minimizes, the keyboard is in the recorded window (Window mode), the window in front at the centre of the area (Rectangle), or the window in front on the monitor (Full screen); you can type there at once. (Windows may refuse to move the focus to a program that was not used last; then the window that Windows activates after the minimize keeps it.)

Not built in this step: M6 (segments, join, recovery, disk checks), the rest of M3 (pause, sound and mic toggles, bar placement), M4 audio, M5 cursor track, M7 player, M8 render, M9 Ctrl+Alt+R.

## B1 to B4, M6 (crash-safe segments) and pause/resume

Done in code, gates green (cargo fmt, clippy -D warnings, cargo test 158, tsc, eslint, vitest 792). Then checked live in a test instance with the generated-frame source only (no screen capture): a recording with 3 s segments and a 2.3 s pause made one `screen.mp4` (segments deleted, plays in the web view at 640x360, 10.5 s); the timer stood still while paused (2181 ms) and went on after the resume. The test instance was killed during a recording: after the restart the dialog "Recover an interrupted recording?" appeared, Recover made a card (10.8 s, plays), and no unfinished folder was left. The bar window is transparent (body rgba 0,0,0,0), 313x52 for a 308 px capsule, with the pause button. Not checked live: disk-full, monitor unplugged, long recordings.

- Rust tests (generated frames, no screen): `segments_of_generated_frames_join_into_one_video_with_all_the_pictures` writes 5 s at 30 fps as 1 s segments with a 300 ms pause in the middle, joins them without re-encoding: 150 samples, 4997 ms, the **join took 5 ms**. `a_segment_cut_off_by_a_crash_is_left_out_and_the_rest_is_recovered` cuts the last segment short and recovers the rest.
- How it works: the video is written as ~10 s segments `screen-000.mp4` ...; each is a finished MP4 as soon as its encoder is finished; Stop joins them (a remux with the `mp4` crate) into `screen.mp4` and deletes the segments. A pause ends the segment, the resume starts the next. `recording.json` is written at the start.
- [ ] **[REAL INPUT]** Record 35 s (3 or 4 segments): the card plays in one piece without a jump at the segment borders; the length matches the timer.
- [ ] **[REAL INPUT]** Pause (⏸ on the bar): the timer stands still, the red dot stops pulsing; Resume (▶): it goes on. The video has no frozen part for the pause time.
- [ ] **Crash recovery** (use only a recording of a window you do not mind, or the dev source): start a recording, wait 25 s, kill Snipmunk in the Task Manager, start it again: a dialog "Recover an interrupted recording?" offers Recover / Delete. Recover gives a card with the video up to about 10 s before the kill (at most the last segment is lost); Delete removes the folder.
- [ ] **Disk**: with less than 300 MB free the recording does not start and the message says so; while recording, below 150 MB the recording is stopped and saved with a message.
- [ ] **[REAL INPUT]** Unplug the recorded monitor (or close the recorded window) during a recording: it is stopped and saved, with a message.
- [ ] B1 to B4 (bar transparent around the capsule and as big as its content, no growth on hover, countdown on the bar with the ✕, the discard question on the same line, the video icon in the badge): look at them once with a real recording.

Not built in this stretch: sound/mic toggles on the bar and bar placement outside the area (M3 rest), M4 audio, M5 cursor track, M7 player, M8 render, M9 hotkeys.

## Session 7-B1b: P1, S1, S2, S3, M3 rest, M4, M5, M7, M8, M9

Gates are green (cargo fmt, clippy -D warnings, cargo test 186, tsc, eslint, vitest 795). Everything below was tested with the development source `__synthetic__` (generated frames, a generated cursor movement, generated tones) in a test instance whose storage folders were under `E:\SecondDawn\_scratch`; **nothing was captured from the real screen, the real cursor, the real system sound or the microphone.**

### P1 One bar
- Checked live: the bar is one layout in the countdown and in the recording; the buttons are disabled while counting and the last one is Cancel, then Stop. The time cell now has a fixed width (before, the bar was 423 px wide while counting and 401 px while recording). New trash icon at full contrast.
- [ ] **[REAL INPUT]** Start a recording with a countdown: the bar does not change size or jump when the recording starts; pause, trash (asks "Discard? Discard / Keep"), speaker and microphone buttons are greyed during the countdown and work after it. Light and dark theme, Arabic (mirrored).

### S1 Recording storage
- Layout `<recordings folder>\<Group>\<Recording>\` (default: the Windows Videos folder + `\Snipmunk`, found with the Known Folder API). Checked live: a recording lands in `rec\Group 1\Recording ...\`; renaming the group renamed the folder (`Demo_ clips`, the `:` made safe); the video plays through `snipmunk-img`; changing the folder in the settings offered 1 recording to move and `move_recordings` moved it; a killed recording was found and recovered in its new place.
- Unit tests: safe names, " (2)" names, rename and move between groups move the folders, deleting removes them, new session / retention / clear on exit keep recordings, migration of recordings of earlier versions, cards of deleted folders are removed.
- [ ] Settings → Capture: "Save recordings to" shows the Videos folder by default; Choose… and Default work; after a change a row offers "Move them / Leave them" with progress.
- [ ] Delete a recording or a group of recordings in Snipmunk: the folders are gone in Explorer. Delete or move a recording folder in Explorer: its card is gone the next time the recording tab is shown or Snipmunk starts. New folders that appear are not imported.
- [ ] "Start fresh" with "Delete them", retention and clear on exit: screenshots go, **recordings and their folders stay**.
- [ ] First start after the update: recordings from `%AppData%\SecondDawn\snipmunk\sessions\...\recordings` are in the Videos folder and the old copies are gone.

### S2 Automatic saving of screenshots
- Unit test of the file: `<folder>\<Group>\<name>.png` with the naming option of the Save dialog, never replaces a file. **The capture itself needs the real screen, so the whole flow is yours to test.**
- [ ] Settings → Capture → "Save each screenshot automatically" (default off): take screenshots; files appear in `Pictures\Snipmunk\<Group>\`. Edits made later stay in Snipmunk. "Start fresh", retention and delete never delete these files. The copy temp folder is emptied on the next copy, on quit and on start.

### S3 Show in File Explorer
- [ ] Right-click a recording: "Show in File Explorer" opens its folder with `screen.mp4` selected. Right-click a screenshot that was saved automatically: the item shows that file; a screenshot without a file has no such item. With several cards selected it opens the folder of the first.

### M3 rest and M4 audio
- Bar: system sound and microphone buttons (they change the settings, also while recording). Placement: below the recorded area when it fits on the monitor, else above, else top centre inside the area (left out of the picture); unit tested with several monitors.
- Audio: `system.wav` (WASAPI loopback of the default output) and `mic.wav` (default input) are separate 16 bit WAV files next to the video, in step with the recording clock (silence is filled in, a fast or slow device is corrected, a pause writes nothing; the clocks of the tracks and of the cursor start with the first picture). The microphone is never opened while it is off. Live (generated tones): both tracks 9.08 s for a 9.03 s video; a track switched on in the middle has silence before it; muting writes silence and keeps the length.
- Drift (generated input, simulated device clock): 10 minutes with a device 100 ppm fast and 100 ppm slow end within 20 ms of the recorded time (one correction of 40 ms).
- [ ] **[REAL AUDIO]** Play music, record 1 minute with system sound on: `system.wav` has it. Switch the microphone on in the bar and speak: `mic.wav` has your voice and the music is only in `system.wav`. Pause and resume in the middle: sound and picture stay in step (clap test at the start and after the pause). Record 10 minutes and check the end for drift.
- [ ] **[REAL AUDIO]** Windows privacy settings → Microphone off for desktop apps → record with the microphone on: a message "The microphone is blocked" with the button "Open Windows settings" appears and the recording goes on without it. With no microphone plugged in: "No microphone was found".

### M5 Cursor track
- `cursor.jsonl` next to the video (format in `src-tauri/src/cursor.rs`): positions in recording pixels, shape changes with the cursor pictures in `cursors/`, visibility, left/right button down/up, about 120 readings a second (a position is written when it changed, at least every 500 ms), a pause is cut out of its time. It only reads the cursor and the state of the mouse buttons (no hook), so it cannot delay or swallow input. Unit tests with generated movements; live with the generated movement.
- [ ] **[REAL INPUT]** Record a window, move the mouse, click both buttons, hover a link and a text field: `cursor.jsonl` has the positions (compare with where you moved), the clicks and the changing shapes, and `cursors/*.png` are the real cursor pictures. Pause and resume while moving.

### M7 Player
- In the recording tab: play/pause (button and Space), seek bar with the time, a volume per track (system / microphone, shown when the track exists), full screen, the cursor drawn on the video from the track at normal size, "Open in Snipmunk Studio" disabled ("Coming soon"). Checked live with generated media: the video plays, both tracks load, the generated cursor is drawn at the right place.
- [ ] **[REAL INPUT]** Play a real recording: cursor and clicks line up with the picture, the sound is in step, seeking and full screen work, Space plays and pauses (not while typing in a field).

### M8 Rendered file
- `final.mp4` (H.264 + AAC) is made in the recording's folder from the screen, the cursor and the mixed tracks (48 kHz stereo, tracks of other rates are resampled), with `final.key` (what it was made from): Save, Copy (as a file), drag out and Share use it, and it is used again until the video, a track or the cursor track changes. Progress bar with Cancel; a cancelled render leaves no partial file.
- Speed (generated input, release build, this PC): 6 s of 1920x1080 at 30 fps rendered in about 5.3 s (about 1.1x real time; decoding and the software encoder are the limit, not the drawing); 640x360 in 1.45 s (4.2x). In the app (debug build, 640x360) a 9 s recording took 1.6 s and the second call took no time.
- [ ] **[REAL INPUT]** Save: pick a folder, the file plays in another player with picture, cursor and sound. Copy: paste into Explorer and into a chat. Share: the Windows share sheet. Drag a card out into Explorer or a chat (the first drag of a recording waits for the render; do Copy or Save first for an instant drag). Cancel during a long render.
- [ ] Measure the render speed of a real 1080p recording.

### M9 Recording shortcut
- Ctrl+Alt+R (editable in Settings → Capture, with the same checks as the capture shortcut and a refusal when both use the same keys) starts the recording flow from any program and stops a running recording; inside Snipmunk's windows the page reports it and the backend runs each press once (per shortcut).
- [ ] **[REAL INPUT]** Press Ctrl+Alt+R in another program: the area selection opens; press it again while recording: the recording stops and the card appears. Press it inside Snipmunk: it works once. Set it to the keys of the capture shortcut: the dialog refuses it.
