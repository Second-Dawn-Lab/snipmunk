# Manual tests, Phase 8 (polish and the first release)

## 8-A: two fixes, close = quit, lightweight

### Tested automatically
- Unit tests: a step set to Full screen, a custom area, Active window, the default and a framed step show the same pixels after
  saving and reopening (twice); a file saved by an earlier version shows its larger stored picture whole; masked words of callouts
  are in no saved version; Quick redact finds and masks matches in callouts and Text marks.
- Unit tests: the settings change once to "Quit"; the tray icon is wanted only with "Keep running in the tray" or while the window is
  put away there; quitting deletes the web view's cache folders and keeps local storage; every window names the same web view
  options; the page's caches are dropped only after a while out of sight.
- In the release measurement build (generated data only): start-up and quit times, no process left after Quit, memory per state, the
  selection overlay's timing, five exports and five project open/close rounds (`docs/performance.md`).

### You must test by hand
- [ ] **A guide with "Full screen" and "Expand area" steps**: save, close the guide, reopen: every step shows what it showed. Also open
  a guide saved before this version that had such a step.
- [ ] **Quick redact** with an email address or a password typed into a callout and into a Text mark, on one step and on the whole
  guide: listed as "Step N callout" / "Step N text mark", masked, one Ctrl+Z brings it back; the saved file and exports.
- [ ] **Close**: with the default setting the window's X quits (nothing in the tray, nothing left in Task Manager); with an unsaved
  recording or guide the question comes first. "Keep running in the tray": the icon appears with the choice, the X hides to it,
  opening from the icon brings the window back; changing the setting back removes the icon. "Ask": both answers.
- [ ] **Quit from the tray**, and quit while the settings window is open.
- [ ] **Start Snipmunk again right after closing it** (within a second): it opens.
- [ ] **Start-up feel**: no white flash, light and dark theme, from the Start menu, a double click on a `.snpr` and a `.snpd` file.
- [ ] **Start with Windows** (off by default): switch it on, sign out and in: Snipmunk is minimized on the taskbar, or only in the tray
  with "Keep running in the tray".
- [ ] **First capture speed**: the first capture after starting, a second one right after it, and one a few minutes later; with all
  your monitors. Delayed capture (3 s): the countdown shows. "After capture: stay in the background": the notice shows its picture and
  "Open" works.
- [ ] **Recording** (area, window, full screen) with countdown, webcam bubble, floating bar and red frame; then a **guide recording**
  with its bar and area frame: each appears and goes away.
- [ ] **Minimize** for a minute, then restore: the window draws at once, the player and the guide pages are as before. Minimize while a
  video export and while a guide export run: they finish.
- [ ] **Task Manager** (development build and, in 8-B, an installed build): one "Snipmunk" entry that expands to its WebView2
  processes.
- [ ] Settings window: opens and closes quickly; German and Arabic.

## 8-B: release setup

### Tested automatically or in a test copy
- Unit tests: the daily check schedule, download progress, the kinds of a failed check, the "started by an update" mark, the notice
  and its "Later", template files waiting their turn, the name asked about before an import, the Store build's task name,
  manifest declarations and ordinary folders.
- A guarded test copy with a pretended update (no network): double-click on a `.snpt` file with Snipmunk closed (question, import),
  a broken file from a second start (message), Settings → About check, the notice, Later, progress, the unsaved-work question
  before the restart, Cancel, and the restart.
- The installer, silently into a folder on E: (never launched): files, the three file types with their icons and "Open with
  Snipmunk", the uninstall entry, desktop and Start menu shortcuts with the application id `lab.seconddawn.snipmunk`; an update
  install over it; a silent uninstall left no registry entry, shortcut or file, and left the app's data unchanged.
- The Store variant compiles and passes clippy; the MSIX packs (`makeappx` accepts the manifest). It was not signed or installed.

### You must test by hand
- [ ] The release list in `docs/releasing.md`, section 8, with the installer from the draft release (finish page with the desktop
      box, Task Manager, double-clicks, uninstall with the data box unticked and, on a test profile, ticked).
- [ ] The update test 0.1.0 → 0.1.1 (`docs/releasing.md`, section 5a).
- [ ] The notice and About page in German and Arabic.
- [ ] The Store package sideload test (`docs/store.md`, section 2): data folders, "Show in Explorer", drag out, start-up task,
      file types, microphone and webcam.

## 8-B, added: passwords stay out of guides

A typing step for a password field shows `••••••••` and the picture from before the first key. A field counts as secret when it
says it is a password field, when a text field is named like one, when it cannot be checked within 0.4 s of the key, or when the
click before the typing was on such a field (`secret.rs`).

### Tested
- Unit tests: the rule, the verdict when the check fails or comes late, a group with one secret key keeps nothing, and a real
  Windows password box and ordinary box in a hidden window of the test, asked through UI Automation.
- A guarded debug copy with injected keys on a generated screen: ordinary text is in the guide's files, secret text in none.
- Not tested: real keyboard input, so the stage between the keyboard hook and the recorder has not run with real keys.

### You must test by hand (record a guide, use made-up passwords)
- [ ] A sign-in page in Edge and in Chrome: user name readable, password as dots; also typing it right after Tab, and right after
      opening the page.
- [ ] The same with "show password" switched on, and a Windows or app dialog with a password box.
- [ ] A password manager's auto-type: no part of the password in any step.
- [ ] Ordinary typing in Notepad, Word, a browser search box and a terminal is still readable (not dots). If it shows dots, say
      where.
