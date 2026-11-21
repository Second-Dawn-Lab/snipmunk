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

## Session 7-B2: fixes A1–A8 and effects, webcam, trim, export (B1–B7)

Gates are green (cargo fmt, clippy -D warnings, cargo test, tsc, eslint, vitest). Everything below was tested with the development source `__synthetic__`, generated tones, a generated cursor movement and a **generated test camera** (a moving pattern, `__synthetic__` in the camera list of debug builds), in a test instance whose storage folders were under `E:\SecondDawn\_scratch`. **Nothing was captured from the real screen, the real cursor, the real system sound, the microphone or a real camera.** Listing devices reads names only.

### A1 Rendered video is not distorted
- Cause: Media Foundation pads the rows of a decoded picture (to 64 bytes) and its height (to 16); the render read the picture as if rows were `width x 4` bytes. Now the picture is read as NV12 (the decoder's own format) with the real pitch worked out from the buffer, and converted here. Tested with generated recordings of 676x1182, 1052x802, 1366x768, 3440x1440 and 640x358 (the even size of 641x359): the decoded export matches the test pattern.
- [ ] **[REAL SCREEN]** Record a window of about 676x1182 (a tall one), Export and Copy: the video plays straight in another player, with no diagonal stripes.

### A2 One render per recording, named after it
- Cause: every recording rendered to the same file name (`final.mp4`) and the cache key did not contain the recording's folder, so a copied file or a stale key could be reused for another recording. Now the file is `<recording name>.mp4` in the recording's own folder, the key contains the folder, the name, the effects, the trim and the export settings, and the page refuses a file that was made for another recording.
- [ ] Save/Export recording A, then Copy recording B and paste into Explorer: the pasted file is `B's name.mp4` and shows B. Rename a recording: the next Copy makes a new file.

### A3 Show in File Explorer
- Cause: the path was built in the page with a broken template string (`\${...}` kept the text of the variable), so it never existed. The backend now works the path out from the current state when the item is clicked (also after a group rename, a move to another group, a new recordings folder, a migration).
- [ ] Right-click a recording after renaming its group, after moving it to another group and after changing the recordings folder (and moving them): Explorer opens with `screen.mp4` selected. Delete the folder in Explorer: the item reports that it is gone.

### A4 Player controls
- The browser's own video menu and controls are off (no `controls`, `controlsList`, no picture-in-picture, `contextmenu` prevented). The speaker and microphone buttons mute and unmute the track, the sliders set the volume, and the audio elements are forced back to that state if anything else changes them.
- [ ] Right-click the video: no browser menu. Click the speaker: sound stops, the icon shows it; click again: sound is back; drag the slider to 0: the icon shows muted. Switch to another recording and back: still in step.

### A5 Faster export
- The encoder is the hardware H.264 encoder through Media Foundation (the capture library's transcoder with hardware acceleration on; software is the fallback). What was slow was reading the video: the colour conversion of Media Foundation. The video is now read as NV12 and converted on all cores.
- Measured (generated input, release build, RTX 3060): 6 s of 1920x1080 at 30 fps in about 3.0 s (**2.0x** real time, before 1.1x); 6 s of 3440x1440 at 30 fps in about 5.7 s (**1.05x**: only just faster than real time, the CPU work of reading and the encoder's colour conversion are the limit).
- [ ] Export a real 1080p recording and a real 3440x1440 one: note the time.

### A6 No "New session"
- The button (both tabs), the setting, its dialog and its texts are gone. Deleting a group of screenshots keeps its question (move or delete); deleting a group of recordings asks once: "Delete 'Group 1' and its 5 recordings permanently? The files in `<folder>` will be deleted and cannot be restored."
- [ ] Delete a recording group with recordings: the dialog names the folder; after "Delete group" the folder is gone in Explorer. Delete an empty group: no question.

### A7 Settings: Screenshots and Recording tabs
- Screenshots: capture shortcut, default mode, delay, after capture, copy each capture, automatic saving (+ folder + naming), magnifier. Recording: recording shortcut, "Save recordings to" (+ move offer), microphone, sound of the computer, frame rate, quality, countdown, system sound and microphone defaults, cursor, click effect, webcam (+ device, shape, size, position, border). The gear menu of the recording bar keeps fps, quality, sound, microphone, webcam, cursor and click effect and has "More recording settings…" which opens the Recording page. The search finds every one of them.
- [ ] Open the settings: the two pages are there; search for "halo", "camera", "microphone", "frame": each jumps to its setting. In the recording top bar: gear -> "More recording settings…" opens the Recording page (also when the window is already open).

### A8 Device pickers
- Microphone (WASAPI capture endpoints) and sound of the computer (render endpoints, loopback): "Default (name)" first, then the devices; the list is read again every 3 s; a chosen device that is gone is shown as "(not connected)" and the recording falls back to the Windows default with a message. Checked with the enumeration only (this PC: 2 microphones, 3 outputs, 1 camera); no device was opened.
- [ ] **[REAL AUDIO]** Choose the second microphone and record with the microphone on: `mic.wav` has that microphone. Unplug the chosen device, start a recording: the message says the default is used. Plug a device in with the settings open: it appears within a few seconds.

### B1 Cursor appearance and B2 click effects
- Cursor on/off, size 1x / 1.5x / 2x, highlight halo with a colour; click effects Off / Ripple / Burst with a colour for the left and the right button and a size (small, medium, large). Drawn from the cursor track in the player and in every export; stored with the recording; defaults in Settings -> Recording.
- [ ] **[REAL INPUT]** Record with real clicks: the ripple is at the place and time of each click (left and right in their colours); the halo follows the cursor; 2x makes the cursor twice as big in the player and in an exported file.

### B3 Webcam
- A separate video (`webcam.mp4`, recorded as 10 s segments `webcam-000.mp4`, ... like the screen, joined at the end; recovered after a crash with `webcam.json` telling where it starts), kept in step by the clock of the first screen picture, cut at pauses. On the floating bar the webcam can be switched on in the middle (it then starts at that time: `webcamStartMs`) and off (one stretch per recording). Overlay: circle / rounded square / rectangle, size S / M / L, four corners or dragged anywhere in the player, thin border.
- Checked with the generated camera: 3 s of webcam across a pause, joined, drawn in the export; switched on after 2.1 s from the bar.
- [ ] **[REAL CAMERA]** Record with the webcam on (choose it in the settings): the picture is in step with the screen and the sound (clap test), also after a pause; Windows' camera privacy off gives the message; unplugging the chosen camera falls back to the first one.

### B4 Effects panel
- Next to the player: cursor, click effects, webcam (only for recordings that have a webcam). A change shows in the player at once and is saved in `recording.json`; "Reset to defaults" restores the defaults of the settings (the trim stays).
- [ ] Change the halo colour and the click effect, restart Snipmunk: the recording still has them. Export: the file has them.

### B5 Trim
- Two handles on the timeline (mouse or arrow keys, Shift = 1 s), saved with the recording; the preview plays only the kept part, the time shows the kept length; Export, Copy, drag out and Share use the kept part.
- [ ] Trim the start and the end, play: it starts and stops there. Export and Copy: the file has the kept length.

### B6 Export dialog
- Button "Export" (instead of Save): MP4 (H.264 + AAC) or GIF; quality High / Standard / Small (MP4) or Low / High (GIF); resolution Original / 1080p / 720p / 480p (the shorter side, never larger than the recording); aspect ratio Original / 16:9 / 9:16 / 1:1 with black bars or crop (a small drawing shows the result); file name and folder (default: the recording's group folder); the size of the picture, length, frame rate and size of the file are shown (a GIF is measured by encoding its first pictures); a warning for a GIF over 50 MB; progress with Cancel; a message with "Show in File Explorer" when done. GIF: 10 fps and at most 360 px (Low) or 15 fps and at most 720 px (High), no sound; only the changed part of each picture is stored.
- Measured (generated pattern, which is noisy and therefore a bad case for GIF): 2 s of 640x360 as GIF: Low 21 pictures, 1.08 MB in 0.41 s; High 28 pictures, 1.30 MB in 0.43 s (release build); the estimate was within 7 %.
- [ ] Export the same recording as MP4 (each quality and resolution), as 9:16 with bars and with crop, as 1:1, and as GIF Low and High: open each in another program; the GIF loops and has no sound; the file name and folder are used; Cancel in the middle leaves no file; the message opens Explorer on the file.

### B7
- "Open in Snipmunk Studio" stays disabled ("Coming soon").

## Session 7-B3: fixes A1–A5, A7, A8 and the first part of the model change (B1, B3 package)

Gates are green (cargo fmt, clippy -D warnings, cargo test, tsc, eslint, vitest). As before, only `__synthetic__`, generated tones and the generated camera were used; nothing real was captured.

### A1 Export "Original"
- Cause: the size estimate for an MP4 reused the GIF size plan (a GIF is limited to 720 px), so the dialog showed 1720×720 and a size estimate four times too small. The MP4 estimate is now worked out from the recording (size, trim, bitrate × length + 128 kbit/s of sound) and the resolution list only offers sizes not larger than the recording.
- [ ] Export your 3440×1440 recording as Original: the file is 3440×1440; the list offers 1080p, 720p, 480p; the estimate is within about 20% of the real size.

### A2 Export speed (NOT FULLY DONE)
- Reproduced with a generated 61 s 3440×1440 30 fps recording (with webcam, both sound tracks, 2× cursor and halo): 1.07× real time, 47 MB (not 4× slower: your PC is slower than this one, or its content is harder). Stage timings (release build, 61 s): waiting for pictures 37.4 s, webcam drawing 15.6 s, effects 2.5 s, flip 14.4 s (encoder thread), encoder 18.6 s, sound 0.3 s. The decoder is the limit: about 35 pictures a second at this size, whether the graphics card or the processor decodes (the pictures are read back from the card as NV12). After the changes (GPU decoding when available, NV12 conversion with two pixels per chroma pair, flip buffer reused, encoder thread): 51 s (1.19×).
- A real GPU path (decode, scale and colour-convert on the card and hand the surface to the encoder) needs an encoder that takes textures; the capture library's encoder only takes memory buffers, so it needs its own Media Foundation sink writer. Not done.
- [ ] Export a 61 s 3440×1440 recording on your PC and note the time; if it is still slow, send the `SNIPMUNK_PROFILE=1` output (set the variable before starting Snipmunk).

### A3 Trimmed exports
- The reader seeks to one second before the trim start (the pictures before it are dropped); a 2 s part at 36 s of a 40 s recording took 1.3 s against 12 s for the whole video; the first picture is the one of the trim start. An MP4 estimate reads nothing.
- [ ] Trim the last 5 s of a long recording and export: it starts at once and the file starts at the trim start.

### A4 Export dialog
- Elapsed time and time left next to the progress bar; when it is done the dialog shows "Export finished", the file name and size and the buttons "Show in File Explorer", "Open" and "Close" (Esc closes).
- [ ] Run an export and check the time and the three buttons; "Open" starts your video player.

### A5 Timeline
- The playhead is draggable (the picture follows), a click jumps, ← / → step one picture (Shift: one second) when the player has the focus, Space plays and pauses. The trim handles only show in trim mode (✂ button); the kept part stays highlighted as a band; trim stays non-destructive and saved.
- [ ] Drag the playhead, click the timeline, press ← → and Shift+← →, turn ✂ on and off.

### A6 Live webcam bubble during recording: NOT DONE
- Needs a camera preview session before and during the recording and a window that is left out of the capture; not built.

### A7 Edit webcam
- A button next to the timeline shows handles on the webcam bubble: drag it, resize from a corner (it snaps to S, M or L); the effects panel follows.

### A8 Quick menu pickers
- Microphone, sound output and webcam can be chosen in the recording options menu (same lists as in Settings → Recording).
- [ ] **[REAL AUDIO / CAMERA]** Choose each device in the quick menu and record.

### B1 Screenshots are one list
- No group tabs, no move-to-group, no "This group / All groups"; one list, newest first by default, custom order by dragging, "Delete all…" with a question. Old data with several screenshot groups is merged into one list sorted by capture time when the session loads (unit-tested). Automatic saving writes straight into the chosen folder (no group subfolders). The group engine (data model, `GroupTabs`, colours, emoji, move, reorder, naming) is still in the code, unused by the screenshot list, for Documents.
- [ ] Start with an old session that has several screenshot groups: one list with everything in time order; capture, copy, annotate, search and OCR work; "Delete all…" asks and deletes.

### B2 Current recording in the temp folder, project tabs: NOT DONE
- The recording groups, list and "Save recordings to" are still there (the recorder writes to `<Videos>\Snipmunk\<Group>`); the temp folder model, the tab strip, the save/discard/quit questions and the low-disk handling for the temp drive are the next session's work.

### B3 Project files (.snpr)
- Done: the package module `src-tauri/src/package.rs` and four commands (`project_save`, `project_info`, `project_set_effects`, `project_save_as`).
- Design: one ZIP file, every entry stored (no compression), `manifest.json` first (`format` = "snipmunk.recording", `version`, `appVersion`; documents will use another `format`), then `screen.mp4`, `system.wav`, `mic.wav`, `cursor.jsonl`, `cursors/*.png`, `webcam.mp4`, `recording.json`, `thumbnail.png`. ZIP64, so entries may be larger than 4 GB. Opening reads only the central directory (kilobytes): the media is read in place by offset (the entries' offset and length are returned by `project_info`), nothing is extracted; the player's `snipmunk-img` range requests can be pointed at those offsets (not wired yet).
- Costs: creating a project copies the media once (disk and time of the copy, no re-encoding; written to `<file>.part<pid>` next to the target and renamed, so there is never a half-written project). A small change (effects, trim) appends `meta/recording.json.<n>` and a new central directory: a few kilobytes however large the project is. "Save as" copies the media into a compact new file.
- Crash safety: before an append the old tail of the file (the central directory) is copied to `<file>.tail`; if the program dies during the save the next open puts it back and the project is as it was. Tested by cutting an append off.
- Not done: the dialogs and tabs (Save as project…, Save, Open, Recent projects), the journal of unsaved edits, serving the player from the package, the file association.
- [ ] (next session) Save a project, open it from Explorer, change effects, save, reopen.

### B4 Settings cleanup, B5 docs
- Roadmap rewritten (above). The Settings cleanup of B4 belongs to the recording model change and is not done.

### What you must test with real hardware
- Export times and sizes of your real 3440×1440 and 1080p recordings (A1, A2, A3).
- Choosing the microphone, speakers and webcam in the quick menu and recording with them (A8).
- Everything of the earlier sessions that is still unchecked: real cursor/click effects, real camera sync, real sound.

## Session 7-B4: small fixes, the recording model, project files (A5 live bubble not done)

Gates are green (cargo fmt, clippy -D warnings, the full cargo test, tsc, eslint, vitest). Tested with `__synthetic__`, generated tones and the generated camera only, in a test instance whose temp folder (`SNIPMUNK_TEMP_DIR`), projects and exports were under `E:\SecondDawn\_scratch`.

### A1–A4 small fixes
- A1 Save in the screenshot bar shows the count ("Save 3") with a selection, "Save" without. A2 the four list controls share one line (they wrap in long languages). A3 the playhead is 4 px wide, taller than the bar, in the strongest text colour with a ring, a round knob, a 22 px grab area and a hover / drag state. A4 the webcam frame has a colour and a thickness (Off / Thin / Medium / Thick) in the effects panel and Settings → Recording, drawn by the player and by the export (old files with the on/off value read as Thin).
- [ ] Check each in light and dark, and in German and Arabic.

### The recording model (C1–C9)
- The recording mode shows ONE thing: the current recording or one opened project. No list, groups or tabs. The current recording is kept in `%TEMP%\Snipmunk\current` (crash-safe segments as before, the recovery dialog after a crash is the same); a new recording replaces it. Header: name, "Not saved" / "Saved as a project", buttons Save as project… / Open project…; for a project: name, a dot for unsaved changes, Save, Save as…, Close project.
- Empty state: Record, Open project…, Recent projects (thumbnail, date, length; missing files greyed out with "Remove from list").
- Save as project… (default folder: the last one used, else the setting "Default folder for projects and exports", else Videos\Snipmunk) writes the `.snpr` (copying the media once) and opens it. Ctrl+S saves the edits of an open project (a few kilobytes are appended), Save as… makes a compact copy that has the edits and leaves the original alone, Ctrl+O opens a project. Edits of an open project are written to a journal in the temp folder at once; after a crash Snipmunk offers to restore them.
- The player reads a project straight from the file: the `snipmunk-img` address `<session>/proj/<id>/<entry>` is mapped to the offset and length of the stored entry and answered with range requests (checked live: a 206 answer with the first bytes of `screen.mp4` and a range inside `webcam.mp4`). Nothing is extracted to play. Export, Copy, drag and Share of a project extract the media into a cache folder in temp the first time (the export reads files); it is deleted when the project closes.
- Questions: starting a recording (button, shortcut, tray) while the current one is not saved: "Save the current recording as a project first?" [Save as project…] [Discard] [Cancel]; with unsaved edits in an open project it asks about those first. Opening a project asks the same. Quit (tray, close with "quit", ask dialog) with something unsaved shows one dialog listing it: Save… / Don't save / Cancel. Exported MP4 or GIF files do not count as saved. On Windows shutdown no dialog can be shown: the recording and the journal stay in temp and are found at the next start.
- Disk: below 1.5 GB free on the drive of the temp folder the floating bar and a toast say "Disk almost full: stop now or free space"; below the critical level the recording is stopped and finished safely as before.
- `.snpr` is registered by the installer (`fileAssociations` in `tauri.conf.json`); double-clicking one opens it, also when Snipmunk is running (single instance forwards the path; the same questions apply). The registration uses the app icon (the Tauri bundler has no per-extension icon): a video badge icon is not done. `.snpd` is not registered.
- Old data (Videos\Snipmunk\<Group>\… and recordings inside sessions) is neither shown nor imported nor changed.
- Settings → Recording: "Save recordings to" and its move offer are gone (the old setting is ignored in an existing settings file); "Default folder for projects and exports" is new.
- [ ] Record, check the header says "Not saved"; start another recording: the question appears; Discard starts it; Save as project…, then record again: no question. Open the project from Explorer by double-click (needs the installer; in development use "Open project…"). Edit effects in a project (dot appears), Ctrl+S (dot goes), close and reopen. Kill Snipmunk with unsaved edits and start it again: the restore question. Quit with an unsaved recording: the dialog. Fill the temp drive to see the warning (or use a small RAM disk as `TEMP`).

### A5 Live webcam bubble: NOT DONE
- Needs a camera preview session that starts with the countdown and a window that is left out of the capture; not built. The webcam still records and is placed afterwards (corners, dragging in the player, handles to resize).

### What you must test with real hardware
- Everything above with the real screen, camera, microphone and speakers; the installer's file association; Windows shutdown with a recording open.

## Session 7-B5: recording-flow fixes, the project header, the live webcam bubble, the .snpr icon and format spec

Gates are green (cargo fmt, clippy -D warnings, the full cargo test, tsc, eslint, vitest). Tested with `__synthetic__` frames, generated tones and the generated camera only, in a test instance with `SNIPMUNK_TEMP_DIR` and all folders under `E:\SecondDawn\_scratch`.

### A Recording flow
- A1: starting a recording while a project is open asks only when the project has unsaved edits (Save / Don't save / Cancel); then the project is closed and, after stopping, the NEW recording is shown as the current recording. All start paths end in the same backend check (button, area menu, shortcut, tray, floating bar). Checked live: open project "Flow" (Saved) → record → the view shows the new recording, "Not saved". Also fixed: Save as project now tells the page the recording is saved (before, the header stayed "Not saved").
- A2: File ▾ → "Discard recording…" (current recording only) asks "Delete this recording? This can’t be undone." and deletes it from temp.
- A3: Quit and restart share one path: tray Quit, close with "quit", and the new `restart_app` (for an updater) all show the unsaved-changes dialog first; Cancel forgets a pending restart. There is no update-restart button in the page yet (the updater plugin is registered only), so nothing else called `exit`.
- [ ] Open a project, edit it (dot), record: the question; Don't save closes it. Record again with a saved current recording: no question. Quit from the tray with an unsaved recording: the dialog.

### B Project header
- One bar: video icon, name (click or F2 renames: the current recording in temp, a project's display name inside the file, saved with the next save; the file on disk keeps its name), status chip (Not saved / Saved / Edited •), size and length once, File ▾ menu (Open project… Ctrl+O, Save as… / Save as project…, Close project, Discard recording…, Show in File Explorer, Recent projects), one main button (Save as project… → Save → "Saved" disabled). The second title above the player and the Open in Snipmunk Studio button are gone.
- In the recording mode the "0 selected" text and the screenshot-only toolbar icons (Save, Copy, Share, Zoom) are hidden; Export, Copy and now Share are at the bottom right. Screenshots mode is unchanged.
- [ ] Check the header in light and dark, German, Polish and Arabic (mirrored); rename with Enter/Escape/F2; the File menu with the keyboard.

### C Live webcam bubble
- Implementation: the camera thread keeps the newest picture, shrunk to 320 px wide (every n-th pixel), in memory. A small window ("webcambubble") shows it: it is transparent, always on top, a tool window (not in the taskbar or Alt+Tab), `WS_EX_NOACTIVATE` (never takes the focus), shown with `SW_SHOWNOACTIVATE`, and excluded from the capture with `WDA_EXCLUDEFROMCAPTURE`. Its page asks a custom address (`snipmunk-cam`) for the newest JPEG about 15 times a second and asks again only when the last one has been drawn; the JPEG is made when asked. No picture goes through a command or an event; the camera thread does nothing but the shrink; windows are made on their own thread. The bubble opens with the countdown (a preview-only camera thread), the recording takes the camera over when it starts, the window stays; the floating bar's webcam switch shows or hides it; it is closed with the red frame and the bar.
- Drag it by its picture; the round handle (shows on hover) resizes it around its centre. Its window events store its place; when the recording stops, the centre relative to the recorded area becomes the webcam overlay (free position as fractions, or the nearest corner when it is outside the area; size = the nearest of S, M, L).
- Checked live with the generated camera: during the countdown the window exists, is excluded from capture (affinity 0x11), tool window, no-activate, topmost; it shows the moving pattern in a circle; after `bubble_resize` and stop the recording's overlay is size L at x 0.88, y 0.79.
- CPU (debug build, generated pattern, whole process tree including WebView2): idle 2.6% of one core; countdown with the bubble 59%; recording without the webcam 75%; recording with webcam and bubble 189% (before throttling the generated pattern to what is used, the countdown with the bubble was 121%). A real camera and a release build are far lighter than this (no pattern generation, no debug code); measure with your camera.
- [ ] **[REAL CAMERA]** Webcam on: the bubble appears with the countdown, shows you live, drags and resizes, does not take the focus from the app you were in, is not in the recording (record a window and a region), is not in Alt+Tab. Toggle the webcam on the floating bar: the bubble hides and shows. Place it, stop: the overlay in the player is where the bubble was (region recording: relative to the region; bubble outside the region: nearest corner). Camera blocked by privacy: the message.

### D .snpr icon and the format spec
- Icon: `src-tauri/icons/snpr.ico` (the app icon with a red play badge, sizes 16–256). It is installed as `snpr.ico` (`bundle.resources`) and registered in `installer/hooks.nsh`: after install, `.snpr` → `Snipmunk.RecordingProject` with `DefaultIcon`, "Open with Snipmunk" (`"<exe>" "%1"`), `Content Type`, for the current user (SHCTX); the uninstaller removes the class and the extension key (only when `.snpr` still points to Snipmunk); both call `SHChangeNotify(SHCNE_ASSOCCHANGED)` so Explorer refreshes the icon. `bundle.fileAssociations` is no longer used (the Tauri bundler registers the exe icon and cannot be given another). The installer was NOT built here (building it downloads NSIS into the C: drive), so this is untested.
- Spec: `docs/snpr-format.md` (container, manifest, entries, `recording.json`, `cursor.jsonl`, append-only saves, the `.tail` repair, compatibility rules). `package.rs` now keeps unknown manifest fields, the file's `minor`, unknown entries and unknown small items on Save and Save as (test `unknown_manifest_fields_and_unknown_entries_survive_a_save_and_a_save_as`), refuses a newer major version with "made by a newer version of Snipmunk" and opens a newer minor version.
- [ ] **[INSTALLER]** Build the installer, install, look at a `.snpr` file in Explorer (badge icon, also after changing the icon cache), double-click it, right-click → Open with Snipmunk; uninstall and check the icon and association are gone.

### What you must test by hand
- The bubble, the header and the flow questions with the real screen and camera (above); the installer registration; the effects of a real camera on CPU.


## Session 7-B6: header, tabs, lip sync, split, scrolling screenshots, installer script

Tested with `__synthetic__` frames, generated tones, the generated camera and (scrolling) a development-only test window made by the test instance itself (its pictures come from that window alone, never from the screen). Nothing read the real screen, microphone, camera or system sound.

### A Header and live bubble
- Header: File ▾ and the main button on the left; icon, name (✎), status chip and "size · duration" on the right (mirrored in right-to-left languages). File menu: Open project…, Save as…, Show in File Explorer, Close project, Discard recording… (current recording only), then the recent projects.
- Live webcam bubble: the round handle (visible on hover, 16 px or more to grab) resizes it during the recording; the size at the end becomes the overlay size.
- [ ] Check the header in light/dark and Arabic; resize the bubble while recording with the **[REAL CAMERA]**.

### B Tabs
- Under the header: the current recording first (no ×; Discard is in the File menu; a new recording asks "save first?" and replaces it), then one tab per open project (dot = unsaved edits, × asks Save / Don't save / Cancel, middle click closes, Ctrl+Tab / Ctrl+Shift+Tab, Ctrl+W, tooltip = path, tabs shrink then scroll with arrows). Opening a project that is already open only switches to it. Only the active tab loads the player and its media (the other tabs keep only their effects, playhead and journal), so memory stays flat; the render caches of a project are removed when its tab is closed. Quit lists every unsaved tab; after a crash the current recording and each project's journal come back as tabs. There is no "project has unsaved edits" question when you start a recording (the project keeps its tab).
- [ ] Open three projects, edit two, switch, close with ×, middle click, Ctrl+Tab; start a recording with a project open; quit with two unsaved tabs; kill the app and start it again.

### C Lip sync
- Cause: the webcam's start was taken when the camera was *started* (a camera needs a moment to open, and it hands over frames 50–150 ms after taking them), the frames were dated by their arrival, and the camera was reopened at the countdown → recording hand-over. So the webcam was early or late against the microphone by the camera's start-up and delivery delay.
- Fix: every webcam picture is dated by the camera's own sample time (mapped to the recording clock, which is the QPC time of the first screen picture; pauses are cut out the same way as for the sound), `webcamStartMs` is the recorded time of the first picture that is kept and is written to disk at once, and the webcam keeps pictures only after the screen clock has started.
- Test `the_webcam_the_screen_and_the_sound_stay_in_step`: the generated camera flashes white and the generated tones beep at the same recorded times (the first 100 ms of every second); the camera is made 120 ms late like a real one; offsets are measured from the written files. **Webcam vs microphone: +27 ms after the fix** (one picture at 30 fps = 33 ms is the finest a camera can show), **+194 ms before** (arrival dating). Screen vs system sound: +29 ms (all within one picture).
- "Webcam sync" slider (−500 … +500 ms, step 10, double click or ↺ resets) in the effects panel: `effects.webcam.syncMs`, used by the player, the export, Copy and Share.
- [ ] **[REAL CAMERA + MICROPHONE]** Record yourself clapping with the webcam and the microphone on: the clap must be seen and heard together in the player and in the export; if a camera is still off, use the slider and tell me by how much.

### D Split and delete parts
- Scissors button → menu Trim / Split. In Split mode: "Split" (key S) at the playhead, click a segment to select it, Delete (or the button) cuts it out (hatched on the timeline), Delete on a hatched part brings it back; Ctrl+Z / Ctrl+Y (or the arrows) undo and redo. The kept length is shown. Stored as `effects.cuts` (format 1.1, see `docs/snpr-format.md`); the player skips cuts; export, Copy, Share and drag-out leave them out with a 15 ms sound fade. Tests: merging and time mapping, the faded sound, the manifest `minor`, and an export with two cuts is as long as what is left and the sound ends with the picture.
- [ ] Cut a part in the middle of a talk, play it back and export it; check the join does not click.

### E Scrolling screenshot
- Mode "Scrolling" (mode menu, overlay mode bar key 5, default mode setting, tooltip): click a window; a pill (excluded from the picture) shows the height, a thumbnail and Stop (Esc stops too). Settings → Screenshots: maximum height (default 20 000 px) and "Scroll back to the top afterwards".
- How: UI Automation `ScrollPattern` (a page per step) when the window has one; if a page leaves no overlap, the wheel (`WM_MOUSEWHEEL` posted to the window under the middle of the area, step size adjusted to about 60 % of the visible part); `WM_VSCROLL` page down when neither moves. After every step the area is grabbed until three grabs are equal. Own stitcher (`stitch.rs`): row hashes; the sticky header and footer are the rows that are equal in two pictures (kept once); the right-hand columns are not compared and the scrollbar columns that moved are cut off; the overlap is the shift that matches the most non-blank rows (a blank stretch uses the distance of the step before).
- Tall results: PNG, thumbnails (limited by height), OCR in overlapping tiles, Copy leaves out the bitmap above 256 MB and copies the PNG and the file, with a message.
- Tested on the test window (painted lines with a sticky header and footer and a moving scrollbar; and an Edit control for UI Automation): the UI Automation, wheel and scroll-bar ways all gave the exact page (7 323 px for 300 lines); the maximum height stopped at 3 150 px for a limit of 3 000; **the tallest tested is 33 723 px (1 400 lines, 124 steps)**. Unit tests: overlap, sticky bands, a blank stretch, a 40 000 px page, a scroll that went too far.
- [ ] **[REAL WINDOWS]** Try a browser page (Edge/Chrome, a long article), Notepad, Explorer, a Settings page and an app with a sticky header: is the result one clean image, the header once, no doubled lines? Try Esc and Stop while it runs, and a window that cannot scroll (message).

### F Installer script
- `scripts\build-installer.bat`: checks pnpm and cargo, warns under 10 GB free on E:, builds on E: (`target-release`), `pnpm tauri build --bundles nsis`, prints the installer path and opens the folder. The first run downloads NSIS once into `%LOCALAPPDATA%\tauri`. It was not run here.
- [ ] **[INSTALLER]** Run it, install, check the `.snpr` icon and the association (see 7-B5).
