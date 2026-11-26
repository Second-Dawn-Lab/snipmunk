# Documentation pictures

The screenshots (PNG) and short films (GIF) of the [README](../../README.md) and the [user guide](../user-guide/index.md) are
made by a script, so they can be made again after the interface changes.

**What is in them:** Snipmunk's own windows from a test instance, with invented demo content only ("Acme Notes", invented
people, `.example` addresses, fictional 555-01xx phone numbers, the example IBAN of the specification, a public test card
number, a drawn "test camera"). Folders shown are `C:\Users\Demo\...`.

## What the script will and will not do

- It runs only against a development test instance started with `SNIPMUNK_NO_REAL_CAPTURE=1` and stops otherwise
  (`dev_capture_guard`). Such an instance reads no real screen, sound or camera and installs no keyboard or mouse hook.
- Calls that would leave the instance (clipboard, share, drag out, file and folder pickers, opening programs or web pages) are
  answered by the script, so nothing happens on your computer. It sends no physical mouse or keyboard input.
- Pictures are taken of a window's own web content (DevTools), never of the screen.
- Before each picture it reads the text of the window and refuses it if it holds your user name, the computer's name, a path of
  the workspace or a user folder other than `Demo`. Names of sound devices and cameras are replaced by "Speakers",
  "Microphone" and "Camera". This check reads text only: **look at every picture yourself before you commit it.**
- Most windows are moved off screen. While guides are recorded, a window titled "Acme Notes" and the guide bar appear on your
  desktop for a minute or two, on top; leave that part of the screen alone (the script stops if another window covers a click
  point). A synthetic recording shows its frame and bar for a few seconds.

## Needed

Windows, Node.js 22 or later, Python 3 with [Pillow](https://pypi.org/project/pillow/), Snipmunk set up to build from source,
an English text recognition language in Windows, and 100 % display scaling on the main monitor (the guide films assume it).

## Run it

Keep every folder of the test instance away from your own data. The commands below use a scratch folder `..\_scratch` next to
the repository.

1. Start a dev server of your own:

   ```powershell
   node node_modules/vite/bin/vite.js --port 1431 --strictPort
   ```

2. In a second PowerShell, set the folders and switches of the test instance, then build and start it:

   ```powershell
   $s = "$((Resolve-Path ..).Path)\_scratch"
   $env:CARGO_TARGET_DIR = "$PWD\target-test"
   $env:TAURI_CONFIG = '{"identifier":"lab.seconddawn.snipmunk.test","build":{"devUrl":"http://localhost:1431"}}'
   cargo build --manifest-path src-tauri\Cargo.toml
   $env:SNIPMUNK_NO_REAL_CAPTURE = "1"
   $env:APPDATA = "$s\rt\Roaming"; $env:LOCALAPPDATA = "$s\rt\Local"; $env:TEMP = "$s\rt\temp"; $env:TMP = $env:TEMP
   $env:SNIPMUNK_TEMP_DIR = $env:TEMP; $env:SNIPMUNK_TEMPLATES_DIR = "$s\rt\templates"
   $env:WEBVIEW2_USER_DATA_FOLDER = "$s\wv2"; $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
   New-Item -ItemType Directory -Force $env:TEMP, $env:WEBVIEW2_USER_DATA_FOLDER | Out-Null
   & "$env:CARGO_TARGET_DIR\debug\snipmunk.exe"
   ```

   The build **must** have the test identity (`TAURI_CONFIG`): an executable built without it counts as the installed app.
   Use a fresh `rt` folder so that no older test data shows up in the pictures.

3. In a third PowerShell, take the pictures (several minutes), then write `docs\media`:

   ```powershell
   node scripts/make-docs-media.mjs ..\_scratch\docs
   ```

   ```powershell
   python -B scripts/docs-media/images.py ..\_scratch\docs
   ```

4. Look through every changed picture and every frame sheet (`..\_scratch\docs\sheet-*.png`), then close the test instance and
   delete the scratch folders.

## One part again

```powershell
node scripts/make-docs-media.mjs ..\_scratch\docs recording
```

```powershell
python -B scripts/docs-media/images.py ..\_scratch\docs recording-effects
```

| Section | Pictures | Needs first |
|---|---|---|
| `assets` | the demo pages used by the others | |
| `screenshots` | the list, annotation, copy, save, search, text recognition, Quick redact | `assets` |
| `overlay` | the selection overlay; the GIF capture, annotate, copy | `assets` |
| `recording` | the recording mode, effects, split, export, options, the floating bar | `assets` |
| `films` | Documents home; the GIFs guide recording and Quick redact on a guide | |
| `editor` | the guide editor, templates, cover, step tools, preview, export | |
| `settings` | the settings pages | |

| File | Part |
|---|---|
| `scripts/make-docs-media.mjs` | Runs the sections |
| `scripts/docs-media/lib.mjs` | Drives the instance, with the guard and the blocked calls |
| `scripts/docs-media/context.mjs` | Takes pictures and checks them for private text |
| `scripts/docs-media/demo.mjs` | The invented demo content |
| `scripts/docs-media/recorder.mjs`, `pointer.mjs` | Guide recording on the demo window; the drawn pointer of the films |
| `scripts/docs-media/win.ps1` | Places the instance's own windows |
| `scripts/docs-media/images.py` | Optimises PNG files (without loss) and builds the GIFs |

These helpers are development tools: nothing of them is part of the app.
