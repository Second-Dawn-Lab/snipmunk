# Manual tests: Phase 5.5 (text recognition and the Phase 5 fixes)

Run these with `pnpm tauri dev` (or `run-snipmunk.bat`) on Windows 10/11. Tick each box.

Items marked **[REAL INPUT]** can only be checked with a real mouse, keyboard, touchpad or display setup. The automatic checks
(unit tests, and a test instance driven with synthetic events inside the web view) cannot cover them, so please do these by hand.

## Test images

Make these once and import them (drop the files on the gallery, or **Add capture** and capture a window that shows them).

1. **Text page**: a Word or Notepad window with a heading, two paragraphs, an email address (`anna.schmidt@example.com`), a phone number (`+49 30 1234567`, `(555) 123-4567`) and these that must **not** be redacted: `Version 2.4.1`, `12.03.2024`, `14:30`, `$19.99`.
2. **Table**: an Excel or Word table with a header row and 3 to 5 rows of 3 columns, also once as a small table in the middle of a page of text.
3. **Rotated text**: a photo or screenshot of a page turned by 90° (to test rotate and flip).
4. **Languages**: a page each in German and English (installed on this machine), and, **only if the language packs are installed in Windows**, Arabic, Chinese and Urdu. Windows text recognition only reads languages whose "Optical character recognition" feature is installed (Settings → Time & language → Language & region → the language → Language options). Windows may not offer some scripts at all (Urdu, for example); then the text is not recognized and that is expected, not a bug in Snipmunk.
5. **Big screenshot**: a 1080p and a 4K (3840 × 2160) screenshot full of text.

## A1. Text box resizing

- [ ] Add a text, select it: corner handles scale the whole text (the font size changes, the box follows, the Text popover's size slider shows the new size).
- [ ] Drag the left or right handle: only the width changes and the text wraps again; the height always fits the text. No top / bottom handles on a text.
- [ ] The same with the text **rotated** (rotate it with the top handle first) and at 25 %, 100 % and 400 % zoom.
- [ ] With "Label background" on: the label stays tight around the text while scaling and wrapping.
- [ ] Arabic or Urdu text: wraps right to left and the handles work.
- [ ] Chinese or Japanese text: wraps between characters.
- [ ] One resize is **one** undo step (Ctrl+Z restores size, width and wrapping in one go; Ctrl+Y redoes it).
- [ ] Double-click a wrapped text: the edit box has the same width and wraps the same way as the rendered text.

## A2. Mouse wheel

- [ ] **[REAL INPUT]** Plain wheel over the picture zooms in and out **at the pointer** (the point under the pointer stays where it is).
- [ ] **[REAL INPUT]** Ctrl + wheel zooms the same way; the page itself does not zoom.
- [ ] **[REAL INPUT]** Touchpad pinch zooms at the pointer (it arrives as Ctrl + wheel).
- [ ] **[REAL INPUT]** Shift + wheel pans sideways. Space + drag and middle-button drag still pan.
- [ ] Settings → General → **Mouse wheel** → Scroll: the wheel pans (vertical, and sideways with two-finger scrolling), Ctrl + wheel and pinch zoom. Back to Zoom: the wheel zooms again.
- [ ] Zooming is smooth (no jumps), and the **first** zoom after opening a capture does not stall.
- [ ] The zoom shown at the top right of the preview follows the wheel.

## A3. Group names in the interface language

- [ ] Settings → Language → German, then **New session**: the first group is called "Gruppe 1". "+" adds "Gruppe 2".
- [ ] Do the same in Arabic and Chinese (Simplified): the names use the language's own word and numbers.
- [ ] Start Snipmunk with the language already German and no earlier session: the group is "Gruppe 1".

## A4. Apply redactions permanently

- [ ] A capture without redactions: Blur ▾ → "Apply redactions permanently" is greyed out and its tooltip says why.
- [ ] Add two or three redactions (box, pixelate, blur) and another mark (an arrow), then crop and rotate. Choose Blur ▾ → Apply redactions permanently: a dialog explains it; **Cancel** changes nothing.
- [ ] **Apply permanently**: the redactions turn into plain pixels, the thumbnail shows them, the arrow, the crop and the rotation are still editable objects, no redaction mark can be selected any more.
- [ ] **Undo** brings the redaction marks and the original picture back; **Redo** burns them in again. This works repeatedly.
- [ ] Close Snipmunk completely (not just the window to the tray: use the tray menu → Quit) and open it again with "clear on exit" off: the redacted areas are final, Undo cannot bring them back.
- [ ] Find the file `%AppData%\SecondDawn\snipmunk\sessions\<id>\images\<capture>.png`: open it in an image viewer: the redacted area has no readable pixels. Search the session folder for other copies of the picture (`*.png`, `*.tmp`, `*.swap`): only the image and its thumbnail exist.
- [ ] Take a capture with text, run Text actions (the recognized text is saved), add a redaction over a word and apply it permanently: the word is no longer in `sessions\<id>\ocr\*.json`.

## A5. README privacy notes

- [ ] The README has a section about "Copy each capture to the clipboard" (the unedited capture goes to the clipboard right after capturing) and about redactions (applied in copies and exports; the stored original keeps its pixels unless "Apply redactions permanently" is used).
- [ ] With the setting on, take a capture, redact something and paste: the pasted picture is the unedited capture (as documented).

## B1. Text layer (select and copy)

- [ ] Open the **Text actions** button (the T in a frame, right of Blur). A spinner shows on it while the text is read; for a new capture the text is usually ready at once.
- [ ] Hover over words: they get a light highlight.
- [ ] **[REAL INPUT]** Drag across words and lines: a selection appears; **Ctrl+C** copies it; paste into Notepad: the words are in reading order, separated by spaces, lines by line breaks.
- [ ] **[REAL INPUT]** Double-click a word: that word is selected. Right-click: **Copy**, **Copy all text**, **Select all** (Select all selects every word; Copy copies the selection).
- [ ] The selection stays on the right words at 25 %, 100 % and 400 % zoom, after cropping, after rotating by 90° and after flipping, and on a 125 % / 150 % display.
- [ ] Text mark-ups, arrows and so on are not read as text.
- [ ] Right-to-left page (Arabic, only with the language installed): the selection runs right to left and the copied text is in reading order. Chinese: no spaces are added between characters.

## B2. Copy all text

- [ ] **Copy all text** copies everything in reading order (paragraph breaks kept) and shows "Text copied".
- [ ] A capture without text (a photo): "No text found in this capture."

## B3. Copy as table

- [ ] On the Table image: **Copy as table** copies; paste into Excel / Word: a table with the same cells (HTML), and into Notepad: tab separated lines.
- [ ] A small table in the middle of a page of text is found without the text around it.
- [ ] On a page without a table the button is greyed out and its tooltip says no table was found.

## B4. Quick redact

- [ ] Quick redact ▾ shows two checkboxes, "Email addresses" and "Phone numbers" (both on), "Redact now" and "Remove all redactions". The checkboxes are remembered after restarting (also in Settings → Text recognition).
- [ ] **Redact now** on the Text page: the email address and both phone numbers get black boxes; "Version 2.4.1", the date, the time and the price are untouched. "4 redactions added" is shown.
- [ ] One Ctrl+Z removes all of them; Ctrl+Y puts them back.
- [ ] Phone formats: `+44 20 7946 0958`, `0171 1234567`, `(212) 555-0199`, `+81 3-1234-5678` are found; `3.14159`, `2024-03-12`, `10:45:30`, `1.2.3.4` are not.
- [ ] Draw a redaction yourself, then **Remove all redactions**: only the Quick redact ones go; your own stays.
- [ ] Works after rotating and cropping (the boxes land on the text).

## B5. Settings → Text recognition

- [ ] The page lists the engine (Windows text recognition), the languages installed for it, a language choice ("Automatic" or one language), "Recognize text automatically after capturing" (on), "Models: None needed", and the Quick redact defaults.
- [ ] "Open Windows settings" opens the Windows language settings.
- [ ] The text explains that other languages need the Windows language pack with "Optical character recognition" and that some scripts (Urdu) may not be supported by Windows.
- [ ] Turn the automatic setting off: a new capture is not read until you open Text actions (it is then read at once).
- [ ] Settings search finds "recognize", "redact", "wheel", "Windows" and the localized words in another language.

## B6. Progress and errors

- [ ] A spinner replaces the icon of the Text actions button while text is read, and its tooltip says "Recognizing text…". On the 4K image the spinner is visible and the window stays responsive.
- [ ] With no OCR language installed in Windows (or in a Windows without the feature) the error is a readable notice ("Text recognition failed: …"), not a crash.

## Languages and layout

- [ ] All of the above in German, Arabic (right to left: the Text actions bar, the menus and the settings page are mirrored) and Chinese (Traditional).
