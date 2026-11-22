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
