# Manual tests: Phase 6 (copy and share, gallery search, fixes from Phase 5.5 testing)

Run these with `pnpm tauri dev` (or `run-snipmunk.bat`) on Windows 10/11. Tick each box.

Items marked **[REAL INPUT]** need a real mouse or keyboard, a real second program or the real desktop (a native drag, the share sheet, a print
dialog, pasting into another app). The automatic checks (unit tests, and a test instance driven with synthetic events inside the web view)
cannot cover them, so please do these by hand.

## Test material

- A group with 5 captures of different sizes (a wide one, a tall one, a small one), one with text (a German page with `Straße`, an e-mail
  address, a phone number, a card number `4111 1111 1111 1111`, an IBAN `DE89 3704 0044 0532 0130 00`, `Password: hunter2`) and some with
  marks, a crop and a rotation.
- A second group with 2 captures.
- A very large capture (4K) for the "too large" case: Stack of 5 of them is over 16k pixels.

## A. Fixes from Phase 5.5 testing

### A1. Text actions look
- [ ] Open **Text actions**: the whole picture is dimmed and the lines of recognized text are bright with a light outline. Selecting words shows the selection on top.
- [ ] The same at 25 %, 100 % and 400 % zoom, after crop, rotate 90° and flip, and on an Arabic page (needs the Windows language pack).
- [ ] Closing the toolbar removes the dimming.

### A2. Quick redact with more types
- [ ] Quick redact ▾ lists Email addresses, Phone numbers, Credit card numbers, IBAN numbers, Passwords and secrets, My words (all on) and Redact now / Remove all redactions. The checkboxes are remembered after a restart.
- [ ] **Redact now** covers: the e-mail address, the phone numbers, the card number (`4111 1111 1111 1111`, not `4111 1111 1111 1112`), the IBAN (with and without spaces), and only the **value** after `Password:`, `Passwort:`, `PIN:`, `API key:`, `Token:`, `密码：`, `كلمة المرور:` and so on (the label stays).
- [ ] It does not cover dates (`12.03.2024`), times, prices, version numbers (`2.4.1`), order numbers that fail the Luhn check, IP addresses.
- [ ] One Ctrl+Z removes everything Redact now added; **Remove all redactions** removes only Quick redact ones and keeps your own.
- [ ] Settings → Text recognition → **Words to always redact**: add a word, press Enter, remove it, turn "Whole words only" on and off; Quick redact then covers these words (case-insensitive).
- [ ] **[REAL INPUT]** In Text actions select a word with the mouse → right-click → **Always redact this**: the notice appears and the word is in the settings list.
- [ ] Note: it can only cover what the text recognition reads. If the engine reads `00` as `OO` in an IBAN, that IBAN is not found.

### A3. Text tool
- [ ] Text tool, click on empty canvas: a text box appears at a normal size with a cursor; type.
- [ ] Click on empty canvas again: the first box is finished and a new one starts (the first one does not move). Clicking inside the box you type in only moves the cursor.
- [ ] Click an existing text (without dragging): it is edited. Drag it: it moves and is not edited.
- [ ] With the Text tool or Select: corner handles scale, side handles change the width and rewrap, the top handle rotates. The Text popover changes colour, size and background of the selected box.
- [ ] Esc, Ctrl+Enter, another tool or a click elsewhere finish the box; an empty box is removed.
- [ ] The cursor lands at the end of the text when you click an existing text (not exactly where you clicked).

### A4. Screen-based sizes
- [ ] Text size 16 in the Text popover looks 16 px tall on the screen at any zoom and for a small (347 px) and a 4K capture. The same for pen, highlighter, outline width and emoji.
- [ ] Marks that already exist do not change when the zoom changes. The size popovers show on-screen sizes.
- [ ] On a 125 % / 150 % display the sizes look the same as at 100 % (relative to the interface).

### A5. Apply redactions permanently
- [ ] With no redactions the menu item is greyed out and its tooltip says "Draw redactions first, then apply them permanently".
- [ ] After applying: the notice says "2 redactions applied permanently", the baked areas flash yellow for a moment and can no longer be selected. Ctrl+Z shows "Redactions restored".

## B. Copy and share

General: everything that leaves the app is rendered with the shared renderer (marks, crop, rotation, flip; redactions with destroyed pixels), in the group's current order. Temp files are only in `%AppData%\SecondDawn\snipmunk\temp` and are deleted at the next copy of that kind and at quit.

### B1. Copy (bottom bar)
- [ ] Nothing selected: the button reads **Copy all (n)** and copies the whole group. With 3 selected it reads **Copy 3**.
- [ ] The mode dropdown (Separate / Stack / Grid) is remembered after a restart.
- [ ] **Separate**: the clipboard holds the files, an HTML fragment and the first image (see the compatibility table).
- [ ] **Stack**: one picture, captures top to bottom, 16 px gap, white background, each centred at its own width. (Automatic check: 3 captures of 1200×160, 600×220, 900×400 gave 1200×812.)
- [ ] **Grid**: rows of 2 (2 to 4 captures), 3 (5 to 9) or 4 (more), 16 px gap, white background, cells as big as the largest capture of the row, captures centred. (Automatic check: the same 3 captures gave 2416×636.)
- [ ] A Stack of five 4K captures shows "A combined picture would be … px, which is too large" and offers **Copy separately**; nothing crashes.
- [ ] The notice reads "3 captures copied" (also in a language with other plural forms).

### B2. Top bar Copy and card menu
- [ ] The top bar Copy copies the capture shown in the preview (with its marks). The card menu **Copy** copies the card's selection in the chosen mode.

### B3. Drag out
- [ ] **[REAL INPUT]** Press on a card, drag out of the Snipmunk window onto Explorer, a chat window, Word, a mail: the rendered PNG(s) are dropped as files. The drag of one card or of the whole selection works.
- [ ] **[REAL INPUT]** Inside the window, reorder and move-to-group drags still work as before. The native drag starts only when the pointer leaves the window.

### B4. Save
- [ ] Top bar Save (current capture), bottom bar Save and card menu Save (selection, or the whole group when nothing is selected) open the Save dialog: format PNG, JPEG, WebP, BMP, ZIP; file names Capture name / Group, number and name / Date and time; a quality slider for JPEG and WebP.
- [ ] With an export folder set (Settings) the files go there; without one a folder picker opens (**[REAL INPUT]**) and starts at the last folder.
- [ ] Names: `Document21.png`, `Group 1 - 01 - Document21.png` (numbers padded to the count), `Screenshot 2026-11-18 205928.png` (capture time). Invalid characters and reserved names (CON, NUL) are replaced.
- [ ] Saving twice never overwrites: `name (2).png`. JPEG and BMP show transparency on white. ZIP holds all pictures as PNG.
- [ ] The last format, naming and quality are remembered. The notice has **Open folder**.

### B5. Share
- [ ] **[REAL INPUT]** Share opens the Windows share sheet with the rendered PNG(s). Where sharing is not supported the button is disabled and its tooltip says so.

### B6. Edit in Paint
- [ ] **[REAL INPUT]** Edit in Paint opens the rendered capture in Paint. Nothing comes back into Snipmunk. Without Paint the default image editor opens.

### B7. Print (Ctrl+P)
- [ ] **[REAL INPUT]** Ctrl+P (or More ▾ → Print) opens the print dialog for the capture shown, or the selection: one capture per page, fitted, aspect ratio kept, wide captures on a landscape page.

### B8. Open file (Ctrl+O)
- [ ] **[REAL INPUT]** Ctrl+O opens a file picker; several PNG/JPG/WebP/BMP/GIF files can be chosen and land in the active group (the same import as dropping files).

### B9. Open screenshots folder
- [ ] More ▾ → Open screenshots folder opens the export folder, or the images folder of the current session when no export folder is set.

### B10. Card menu
- [ ] Copy and Save are no longer "Coming soon".

### Compatibility table (fill in)

Paste: Ctrl+V in the target. Drag: drag from a Snipmunk card into the target. Write what happens (all images / first image only / nothing) in each cell.

| Target | Separate paste | Separate drag | Stack paste | Grid paste |
|---|---|---|---|---|
| ChatGPT (web) | | | | |
| Claude (web) | | | | |
| Teams | | | | |
| Slack (web) | | | | |
| Slack (desktop) | | | | |
| Word | | | | |
| Outlook | | | | |
| Gmail (web) | | | | |
| Google Docs | | | | |
| Explorer (paste files) | | | | |
| Paint | | | | |
| WhatsApp desktop | | | | |
| Discord | | | | |

What the clipboard holds after a Separate copy (checked in the test instance): `CF_HDROP` (the files), `HTML Format` (all pictures), `PNG`, `CF_DIB` and `CF_BITMAP`/`CF_DIBV5` (the first picture). After Stack or Grid: the same, with the one composed picture.

## C. Gallery search

- [ ] **Ctrl+F** focuses the search box above the list; **Esc** clears it. The list filters while you type (after a short pause).
- [ ] It searches the capture name, the window title and the recognized text. `strasse` finds a text with `Straße`; `creme` finds `crème`; `muller` finds `Müller`.
- [ ] Arabic: `احمد` finds `أحمد`; spelling variants (alef/hamza, tatweel, diacritics) do not matter. Chinese: `发票` finds a text containing it (substring). Several words: all must match.
- [ ] Scope **This group** / **All groups**. With all groups the results show a badge with the group's colour and emoji; clicking a result switches to that group.
- [ ] Opening a result shows the capture with the matching words marked in yellow until the search is cleared.
- [ ] No results: "No captures match “…”". While captures are still being read: "Some captures are still being read".
- [ ] 300+ captures (`debug_seed_session` in a development build): typing stays smooth.
- [ ] While a search filters the list, dragging cards to reorder does nothing (moving to a group tab still works).

## Phase 6.1: retest after the fixes

Retest the compatibility table above (Ctrl+A on 4 captures, Copy, Ctrl+V, columns Separate / Stack / Grid) and write the new results there.

1. **Grid in Word and Paint.** The clipboard bitmap is now a 24-bit bottom-up bitmap with padded rows (unit-tested for 1×1, 3×5, 2417×637, 2416×636 and more); the PNG format is unchanged.
   - [ ] Grid pasted into Word, Paint, Teams, ChatGPT, Claude and Explorer shows the whole grid. Also try Grid of 4 large (4K) captures.
2. **Outlook.** A Separate copy puts the files on the clipboard (chats and Explorer take every picture from them); Outlook turns files into attachments. Settings → Copy & paste → **Also copy the pictures as files**:
   - [ ] On (default): ChatGPT, Claude, Teams, Explorer show all pictures as before; Outlook shows 1 inline + attachments.
   - [ ] Off: Outlook shows all pictures in the body of the message (Word the same); ChatGPT, Claude, Teams and Explorer then take only the first picture or nothing from a Separate copy (they need the files). Stack and Grid are not affected.
3. **Text tool, one box per activation.**
   - [ ] Text tool, click on the picture, type; Esc, Ctrl+Enter or a click elsewhere finishes it. The tool goes back to Select and the box stays selected (border and handles: move, resize, rotate; the Text popover changes colour, size, background).
   - [ ] Clicking elsewhere on the picture does not make a second box; click the Text tool again for another one. Double-click a text with Select edits it.
4. **OCR small and monospace text.**
   - [ ] A Notepad screenshot with `Card: 4111 1111 1111 1111` in a small monospace font: Text actions → Quick redact covers the card line (small text is read again enlarged and the lines only that pass found are kept).
   - [ ] A card or IBAN read with `O` for `0`, `l` for `1`, `S` for `5`, `B` for `8` in its digit groups is still covered; a number that fails the Luhn check or mod-97 check after the repair is not.
5. **Quick redact button.**
   - [ ] The main button redacts at once with the checked types (tooltip says so); the arrow opens the checkboxes and Remove all redactions. There is no "Redact now" item.
6. **Right-click menu in the text layer.**
   - [ ] **[REAL INPUT]** Select words, right-click: Copy, Copy all text, Select all and Always redact this all work with the mouse and with the arrow keys + Enter; Always redact this adds the text to Settings → Text recognition → Words to always redact and shows a toast.
7. **Show in folder.**
   - [ ] Save into Pictures (or a folder with spaces in its name): the toast's **Open folder** opens that folder with the first saved file selected. More ▾ → Open screenshots folder opens the export folder or the session's images folder.
8. **List view.**
   - [ ] The check box and the trash icon sit side by side on a card (selected and not selected), in the list, medium and large views, and in Arabic (right to left).
9. **Toasts.**
   - [ ] Copy, Save, Redact, delete errors etc. show a toast bottom right (bottom left in Arabic/Urdu) over the content; nothing moves. Notices go after about 4 seconds, errors stay until ✕. Several stack. **Open folder** is a button in the toast. Screen readers announce them (aria-live); the focus is not taken.
10. **Settings window.**
    - [ ] Opens in a dev session and in a release build. Root cause of the "localhost refused to connect" page: see the report; in a dev build, when the Vite server is gone the settings window now shows a short page that says so.
11. **Caret and dialogs.**
    - [ ] Clicking into an existing text puts the caret where you clicked (also in a wrapped text and in Arabic).
    - [ ] The folder picker (Save without an export folder) and Open file (Ctrl+O) work (now `tauri-plugin-dialog`).
