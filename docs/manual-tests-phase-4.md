# Manual tests: Phase 4 (session gallery and groups)

Run these with `pnpm tauri dev` (or `run-snipmunk.bat`) on Windows 10/11. Tick each box. Sections 1 to 8 follow the Phase 4 items; section 9
is the 300-capture session and section 10 is Arabic (right to left).

Test data: a development build has a debug command that starts a **new session full of generated captures** (release builds refuse it).
Open the DevTools console of the main window (a dev build has it: F12 is disabled, so start with
`set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` and open `http://127.0.0.1:9222`) and run:

```js
// 300 captures, 2 groups, 1280 x 720 (takes about a minute in a debug build: every capture is a real PNG on disk)
await window.__TAURI_INTERNALS__.invoke("debug_seed_session", { count: 300, groups: 2 });
// everything in one group: groups: 1.  Other size: width: 1920, height: 1080.
```

The generated session is an ordinary session (retention removes it after 30 days); it does not replace your real ones on disk. To get
rid of it at once, start a new session with **Delete them** or delete its folder in `%AppData%\SecondDawn\snipmunk\sessions`.

## 1. View toggle and thumbnails

- [ ] At the top of the capture list there are three buttons (List, Medium thumbnails, Large thumbnails), each with an icon and a tooltip.
- [ ] **List**: one card per row (picture, name, time, check box), as before.
- [ ] **Medium**: a grid of 160 px pictures with the name under each; the left panel is a little wider and shows two columns.
- [ ] **Large**: 260 px pictures with name and time under each, one column.
- [ ] The choice is remembered after closing and starting Snipmunk (`galleryView` in `settings.json`).
- [ ] Settings, Sessions, **Capture list view** shows the same choice, and changing it there changes the window at once (and the other way round).
- [ ] Searching the settings for "view" (or "thumbnail") finds it.
- [ ] Large thumbnails are sharp (look at text in a screenshot) at 100 %, 150 % and 200 % display scaling.
- [ ] A session saved by an earlier version (thumbnails 192 px): after about two seconds the thumbnails sharpen by themselves, the window stays responsive,
      and `thumbs\<id>.png` files in the session folder are now about 520 px wide.

## 2. Selection

- [ ] Click a card: only it is selected (check box on) and it is shown in the preview. "1 selected" at the bottom.
- [ ] **Ctrl+click** adds or removes one card; a removed card stays out, the preview keeps its capture.
- [ ] **Shift+click** selects the range from the last clicked card to this one, in both directions; a second Shift+click moves the end of the range.
- [ ] **Ctrl+Shift+click** adds the range to what was selected.
- [ ] The check box toggles one card (like Ctrl+click) without changing the preview.
- [ ] **Ctrl+A** selects every capture of the group (also with the focus on the tab bar, not while typing in a text box). "n selected" is right.
- [ ] **Esc** clears the selection. Esc inside a dialog or menu only closes that.
- [ ] Select two cards in Group 1, switch to Group 2 and select one there, switch back: each group still has its own selection and shown capture.
- [ ] Delete a selected card, move one to another group, start a new session: the count at the bottom stays correct.
- [ ] Select all, then switch the view (List, Medium, Large): the selection and the shown capture stay.

## 3. Reorder and move (drag)

- [ ] Press on a card and move more than a few pixels: a small picture follows the pointer, the dragged card dims, a red-brown line shows where it will land.
- [ ] Drop between two cards: the order changes and the sort box now reads **Custom order**. Close and restart Snipmunk: the order is still there.
- [ ] Drop where it already is: nothing happens (no line, no change).
- [ ] Select 3 cards (not next to each other) and drag one of them: all three move together, in their order, with a number badge on the picture.
- [ ] Drag a card that is **not** part of the selection: only that card moves; the selection is not changed.
- [ ] In the Medium and Large views the mark is a vertical bar between tiles; dropping before the first tile and after the last one both work.
- [ ] Hold the pointer near the top or bottom edge of the list while dragging: the list scrolls (faster the nearer the edge). In a 300 capture list, drag from the top to the bottom.
- [ ] **Esc** during a drag cancels it; so does letting go outside the window or pressing Alt+Tab. Nothing changes.
- [ ] A short click (no movement) still selects; right after a drag no click is registered on the card under the pointer.
- [ ] Drag cards onto another **group tab**: the tab gets a dashed frame while you hover it; dropping moves them there (added at the end of that group). The source group's selection is cleared and it shows the next capture.
- [ ] Dropping on the tab of the group they are already in does nothing.
- [ ] Drag a **group tab** left or right: a bar shows where it will go; after the drop the tabs (and the order after a restart) are in the new order.
- [ ] While dragging captures along the tab strip near its edge, the tabs scroll.

## 4. Context menus and keyboard

Card menu (right click, or the Menu key / Shift+F10 on the focused list)
- [ ] The menu shows Rename, Duplicate, Move to ▸, Copy (greyed out, tooltip "Coming soon"), Save (greyed out, tooltip "Coming soon"), Delete.
- [ ] Right-click on a card that is **not** selected: it becomes the only selected card, the menu acts on it. Right-click on a selected card: the selection stays and the menu acts on all of it.
- [ ] With several selected, **Rename** is greyed out; Duplicate, Move to and Delete work on all of them.
- [ ] **Rename**: an edit box replaces the name. Enter saves, Esc cancels, clicking elsewhere saves. Typing nothing and pressing Enter shows a red box and does not save; leaving the box empty cancels.
- [ ] **Duplicate**: a copy named `<name> copy` appears right after the original (also with "Newest first" or "Oldest first"), and the copies are selected. The original is unchanged; deleting the copy keeps the original's picture.
- [ ] **Move to ▸** lists every other group and **New group**; choosing one moves the captures there. New group creates the tab and moves them into it.
- [ ] **Delete** asks first (the existing "Delete n captures?" dialog), then deletes all of them.
- [ ] Esc, a click outside, scrolling the wheel, or resizing the window closes the menu. The arrow keys move through it, Enter chooses.

Keyboard (click a card first so the list has the focus)
- [ ] **↑ / ↓** move to the previous / next capture: the preview follows and the selection becomes just that capture. The list scrolls to keep it in view.
- [ ] **← / →** do the same in the Medium and Large views (and do nothing in the List). **↑ / ↓** move by a row in the grids.
- [ ] **Shift + arrow** extends the selection from where it started; going back shrinks it.
- [ ] **Page Up / Page Down** move by a page; **Home / End** go to the first / last capture.
- [ ] **Enter** shows the capture and selects only it. **F2** renames it. **Del** asks to delete the selection (or the shown capture).
- [ ] The keys work after clicking a check box, too.

## 5. Dragging images in

Use some real files: a PNG, a JPG, a WebP, a BMP, a GIF (animated, if you have one), a text file, and a PDF.

- [ ] While dragging files over the window a frame appears with "Drop images to add them to *Group name*". The text names the group under the pointer: the shown group over the list, the hovered group over a tab (and that tab gets a dashed frame). Coloured groups use their colour.
- [ ] Drop the images on the **list**: they are added to the shown group, in the order of the files, named after the file without its extension. A notice says how many were added.
- [ ] Drop on another **group tab**: they go to that group; the shown tab does not change.
- [ ] Drop several files at once (also 20 or more): all of them are added, in order.
- [ ] The text file and the PDF are skipped. One notice says how many files were skipped ("1 file skipped: it is not a supported image.").
- [ ] A GIF is added as its first frame. A large photo (say 20 megapixels) is added without freezing the window.
- [ ] The original files are untouched (same size and date). The copies are in the session folder (`images\<id>.png`, `thumbs\<id>.png`).
- [ ] An imported capture behaves like a screenshot: select, drag, rename, duplicate, delete, shown in the preview at its real size.
- [ ] Dragging files onto the Settings window or any other window does nothing harmful (no navigation, no file opens).
- [ ] An image that does not decode (rename a text file to `x.png`) is skipped and counted.

From a browser (drag a picture from a web page into the capture list) - note for each browser what happened:
- [ ] Chrome: ___________________________
- [ ] Edge: ___________________________
- [ ] Firefox: ___________________________

Expected: a browser that hands over the picture as a file (Chrome and Edge normally do) adds it; if only a web address comes along, Snipmunk
downloads nothing and shows "Save the image first, then drag it in."

## 6. Groups

- [ ] Right-click a group tab (or press the Menu key on it): Rename group, Colour ▸, Emoji ▸, Delete group.
- [ ] **Colour**: "none" and 8 colours. The tab gets a stripe of that colour (stronger on the shown tab), also when you switch the Windows theme between light and dark. The colour persists after a restart.
- [ ] **Emoji**: "none" and 12 emoji. The emoji shows before the name. It persists after a restart.
- [ ] The colour also frames the drop area when you drag files over that group, and the swatches show the same colours.
- [ ] A group file written by an older version (no colour, no emoji) opens normally.
- [ ] **Delete a group with captures**: a dialog asks "Move the captures to [group]" (preselected: the next tab) or "Delete them too". Moving keeps every capture at the end of the other group; deleting removes the files from disk.
- [ ] Delete an empty group: no question.
- [ ] With only one group left, the ✕ on the tab is gone and the menu's "Delete group" is greyed out with the tooltip "The last group cannot be deleted."
- [ ] **Many groups**: add 10 groups. The tab strip scrolls sideways (mouse wheel too); a fade shows at an edge with more tabs; a **▾** button lists all groups with their capture counts. Choosing one shows it and scrolls its tab into view. The + button stays visible.
- [ ] Rename with a double click or F2 on the tab; an empty name is not accepted.

## 7. New session

- [ ] Settings, Sessions, New session = **Ask me**: New session opens a dialog with **Keep the current captures** and **Start fresh**, the number of captures, how long they stay on disk, and the hint that exporting arrives later.
- [ ] Keep the current captures: nothing changes. Start fresh: an empty session with one group; the old session folder is still in `%AppData%\SecondDawn\snipmunk\sessions`.
- [ ] New session = **Delete them**: no question; the old session folder is deleted.
- [ ] New session = **Export automatically**: still behaves like Ask me, without the question (the old session is kept), until export arrives in Phase 8.
- [ ] With 0 captures the button starts a new session without asking.

## 8. Every change is saved at once

For each of these, kill Snipmunk in Task Manager right after the change (no clean exit) and start it again: the change is there.
- [ ] Reorder captures, move to another group, duplicate, rename a capture, delete a capture.
- [ ] Rename a group, colour, emoji, reorder tabs, delete a group (both ways), add a group.
- [ ] Drop in images.

## 9. A session with 300 captures

Seed 300 captures in one group (see the top) and also try the "2 groups" seed.

- [ ] Starting Snipmunk with that session shows the list at once (well under a second).
- [ ] Scroll the list with the mouse wheel and by dragging the scroll bar in all three views: smooth, no blank areas, pictures appear as they come into view.
- [ ] Select all (Ctrl+A) and click a card: the change is immediate.
- [ ] Reorder by dragging from the top of the list to the bottom (auto-scroll), and move 100 selected captures to another group.
- [ ] Task Manager: Snipmunk and its WebView2 processes do not grow without bound while scrolling up and down several times.
- [ ] Delete 100 captures with one confirmation: the window stays responsive.

## 10. Arabic (right to left)

Settings, General, Language: العربية.

- [ ] The left panel moves to the right side, the group tabs start at the right, the colour stripe and emoji stay on the tab.
- [ ] The three view buttons keep their order meaning (List, Medium, Large reading from the right); tiles fill from the right.
- [ ] ← / → in the Medium and Large views are mirrored: → goes to the previous capture, ← to the next.
- [ ] The insertion mark when reordering is at the correct side of a tile, in the grid views too.
- [ ] Dragging a tab: the bar sits at the right place (tabs run from the right).
- [ ] The tab strip fade edges are on the correct sides, and the ▾ list opens inside the window.
- [ ] Context menus open to the left of the pointer when there is no room, with the ▸ mirrored; the Colour swatches and the emoji grid read correctly.
- [ ] The drop frame text, the notices and the new dialogs are in Arabic and do not overflow. The delete-group dialog's drop-down is usable.
- [ ] Repeat the check for Urdu.

## 11. Clean up

- [ ] Delete the generated session folders in `%AppData%\SecondDawn\snipmunk\sessions` (or start a new session with "Delete them").
- [ ] Set the language back and the capture list view to List if you changed them.
