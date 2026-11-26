# Performance: memory and start-up

Snipmunk must stay light. This is how it is measured, the targets, and the results.

## Measuring

```powershell
powershell -ExecutionPolicy Bypass -File scripts\measure-memory.ps1 -Work E:\SecondDawn\_scratch\tmp\measure -Label after
```

The script makes a **release** build with the cargo feature `measure-guard` and drives it over the web view's debugging port
(`scripts/measure-drive.mjs`, Node 22 or later). A build with that feature never grabs or records the real screen, sound or camera,
installs no keyboard or mouse hook and writes no autostart entry; it makes its test data itself. It runs with an identity
(`lab.seconddawn.snipmunk.measure`), settings, temp and web view folders of its own below `-Work`, and only the processes the script
started are looked at and stopped. **A release is never built with `measure-guard`.**

| Switch | What it does |
| --- | --- |
| (none) | The memory states S1 to S9, then Quit (writes `memory-<label>.md`, `processes-<label>.txt`) |
| `-Startup` | One first start (empty web view folder) and five warm starts (`startup-<label>.txt`) |
| `-Leaks` | Five PDF exports and five project open/close rounds (`leaks-<label>.md`) |
| `-Overlay` | The selection overlay's time to its picture, new and kept (`overlay-<label>.txt`) |
| `-Reopen` | Starting again while Snipmunk is quitting |
| `-Timing` | Where a warm start's page time goes |
| `-Quick` | S1 and S2 only, to compare web view options (`-BrowserArgs "..."`) |
| `-SkipBuild` | Measure the build that is there |
| `-Target`, `-WebView`, `-Port` | The cargo target folder, the web view's data folder (emptied each time) and the debugging port |

The build needs the folder named by `-Target` (default `E:\SecondDawn\snipmunk\target-test`). Do not use the computer's capture
shortcut or change the code while it runs.

**What the numbers are.** All processes of the instance are added up: the program and every WebView2 process it started.
*Private working set* is the memory in RAM that belongs only to them: it is what Task Manager shows, and what the targets are
about. *Working set* also counts shared pages once for every process (so it overstates the total); *commit* is memory reserved
for the processes, whether or not it is in RAM.

## Targets

| State | Target (private working set) |
| --- | --- |
| S1 just started | under 150 MB |
| S2 30 captures, S5 50-step guide | under 250 MB |
| S7, 60 s after an export | within about 20 % of the state before the export |
| S8 minimized | lower than the visible state |
| Warm start (process start to a painted, usable window) | under about 1 s |

## Results (Phase 8-A)

Measured on 2026-11-26, Windows 11 Pro, release builds of the measurement variant. "Before" is the state at the start of
Phase 8-A (with the two bug fixes), "after" the finished state. One machine and one run each: expect some MB and some tens of
milliseconds of spread between runs.

### Memory

| State | Private working set before → after (MB) | Working set before → after (MB) | Commit before → after (MB) |
| --- | ---: | ---: | ---: |
| S1 just started, Screenshots, empty | 181 → **85** | 598 → 355 | 383 → 192 |
| S2 30 captures, one in the editor | 190 → **100** | 628 → 388 | 400 → 220 |
| S3 Recording, a 60 s project in the player | 226 → **134** | 681 → 443 | 433 → 304 |
| S4 a recording has just ended | 235 → **136** | 722 → 451 | 452 → 319 |
| S5 Documents, a 50-step guide on pages | 260 → **177** | 755 → 507 | 515 → 395 |
| S6 right after a PDF export of it | 293 → **209** | 806 → 558 | 776 → 663 |
| S7 60 s after the export | 278 → **176** | 791 → 512 | 527 → 598 |
| S8 minimized for 30 s | 267 → **17** | 790 → 89 | 516 → 291 |
| S9 shown again (after 8 s) | 267 → **58** | 790 → 178 | 516 → 360 |

All targets are met: S1 under 150 MB, S2 and S5 under 250 MB, S7 back at the level before the export (S5), S8 far below the
visible state. S8 is low because Windows moves the pages of a web view with a low memory level out of RAM; it takes back what
it needs when the window is shown (S9). One figure is worse than before: 60 s after the export the commit is still 598 MB
(before: 527 MB). It is reserved memory, not memory in RAM, and the repeated exports below show it falling again rather than
growing.

Processes: **before 10** (the program, the browser, GPU, two utility, crash reporter and **4 renderers**: main window and the
pre-created overlay, countdown and notice), **after 7** (**1 renderer**).

### No growth over repeated actions

Private working set in MB, after: guide open 133; after each of five PDF exports 155, 160, 165, 162, 149; after each of five
project open/close rounds 175, 179, 180, 179, 183. (This run was not made on the "before" state.)

### Start-up (release build, milliseconds from process start)

| Start | Window shown before → after | Painted and usable before → after |
| --- | ---: | ---: |
| First start (empty web view folder) | 760 → 1106 | 1464 → 1095 |
| Warm, five starts | 743–759 → 1004–1047 | 1431–1462 → 990–1029 |

Before, the window appeared at 0.76 s and stayed empty until 1.45 s. Now it appears once, painted, at about **1.0 s** (warm).
The target "under about 1 s" is reached only just. About 0.72 s of it passes before the program's own set-up begins (Windows and
WebView2 making the window, the browser and renderer processes); the page then takes about 0.36 s. "First start" is the first one
with an empty web view folder, not a start right after booting the computer.

Quit: the windows are gone about **20 ms** after Quit; the web view has ended after about 0.31 s, the caches are removed and the
program is done at about 0.33 s; every process has ended within about 1.0 s (measured from outside, including the time to send
the request). One run after a long session needed 2.2 s for the last process (invisibly); a repeat needed 1.0 s. No process was
ever left. After Quit there are no cache folders left, local storage is there, and the web view folder holds about 7 MB.

### Selection overlay: from the start of a capture to its picture (ms, eight each)

| | Made anew | Kept from the capture before |
| --- | ---: | ---: |
| Main window visible | 336–349 | 93–108 |
| Main window minimized | 329–388 | 93–113 |

Measured with a generated 1920×1080 picture on an overlay off every monitor; grabbing the real screen comes on top and is
unchanged. The pre-created overlay of earlier builds corresponds to the "kept" column. Private working set with a kept overlay:
109 MB, after it is destroyed: 100 MB (30 MB apart in an earlier run).

### Size of the page's files (kB, minified; gzip in brackets)

| | Before | After |
| --- | ---: | ---: |
| First file (every window loads it) | 2364 (732) | **914 (277)** |
| Main window at start (first file + its parts) | 2364 | about 1191 |
| Documents mode with the text editor, when opened | in the first file | 912 (293) |
| Word writer, when a Word file is made | in the first file | 219 (64) |
| Video player, when a recording is shown | in the first file | 25 (8) |
| Settings window, when opened | in the first file | 14 (4) + shared parts |
| Style sheet | 107 (20) | 107 (20) |

Most of the first file is the twelve translations.

## What keeps it light

- **One web view environment, one page process.** Every window uses the same options (`webview::BROWSER_ARGS`), so there is one
  browser process; `--process-per-site` puts the pages of all windows into one renderer process. The other options are the three
  features Tauri's web view library switches off itself. The GPU stays on (video player, large canvases).
  Tried and not used (no measurable gain): switching off the spare renderer, background networking and component updates.
  `--renderer-process-limit=1` gained less than `--process-per-site`.
  What remains: the program, the browser process, one renderer, the GPU process, two utility processes (network and storage) and
  the crash reporter. These are WebView2's own.
- **Windows on demand.** At start only the main window exists. The overlays, the countdown, the notice, the recording bar and
  frame, the guide bar and area frame, the webcam bubble and the print window are made when needed and destroyed after use.
- **The overlay trade-off.** A new overlay needs about a quarter of a second more than a kept one, and a kept one holds some
  10 to 30 MB. The overlays are therefore kept for **60 seconds** after a capture (`capture::OVERLAY_KEEP`): captures taken one
  after another are fast, and the memory goes back afterwards. The first capture after a start, or after a minute's pause, pays
  the longer time.
- **Out of sight.** Minimized or in the tray, the main web view is marked invisible and asked for a low memory level
  (`MemoryUsageTargetLevel`); after 20 s the page drops the recognized texts it holds (they are on disk).
- **Code loaded when needed.** The main window, the settings window, Documents mode (with the text editor), the video player and
  the Word writer are separate files (`loadable.tsx`, not `React.lazy`: React holds a Suspense fallback for at least 300 ms).
- **Buffers.** The recorder's and the guide recorder's pictures end with the recording; the background text reader lets its
  engines go when it has nothing left to read; the player empties its media elements when it closes.
- **Quit** removes the web view's HTTP, code, GPU and shader caches (not local storage or settings).

## Task Manager grouping

Task Manager lists a program's helper processes under it when they belong to its process tree (and, for the taskbar, share its
application id). Snipmunk controls both: WebView2 is started by the Snipmunk process (the browser process is its child, all other
WebView2 processes are the browser's children; `processes-<label>.txt` shows the tree), and the program now sets its
**AppUserModelID** to the bundle identifier before any window exists, the same id the installer gives the Start menu shortcut.
How Task Manager draws the entry can only be checked by eye, in a development build and in an installed one
(`docs/manual-tests-phase-8.md`).
