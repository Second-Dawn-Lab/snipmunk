# Manual tests: Phase 5 (annotation tools) and the Phase 4.1 fixes

Run these with `pnpm tauri dev` (or `run-snipmunk.bat`) on Windows 10/11. Tick each box.

Items marked **[REAL INPUT]** can only be checked with a real mouse, keyboard, pen tablet or display setup. The automatic checks
(unit tests and a test instance driven with synthetic events inside the web view) cannot cover them, so please do these by hand.

Test data: a development build has a debug command that makes a session full of generated captures (see `manual-tests-phase-4.md`).
For the 4K test (section 14) use
`await window.__TAURI_INTERNALS__.invoke("debug_seed_session", { count: 1, groups: 1, width: 3840, height: 2160 })`.

## 1. Fix A1: submenus are flyouts

Applies to the card menu (Move to ▸), the group tab menu (Colour ▸, Emoji ▸) and the More menu (Zoom ▸).

- [ ] **[REAL INPUT]** Rest the pointer on "Move to ▸": after about a third of a second the flyout opens beside the entry. A quick pass over the entry opens nothing.
- [ ] Click the entry: the flyout opens at once.
- [ ] **→** on the entry opens it and puts the focus on its first item; **↑ / ↓** move inside it; **←** closes it and the focus is back on "Move to".
- [ ] **Esc** with a flyout open closes only the flyout; a second Esc closes the menu.
- [ ] **[REAL INPUT]** Move the pointer from "Move to" diagonally towards the flyout, across the entries below ("Copy", "Save"): the flyout stays open. Move the pointer somewhere else: it closes after a moment.
- [ ] Right-click a card near the right edge of the window: the flyout opens to the left of the menu. Near the bottom: it shifts up and stays inside the window.
- [ ] Group tab menu: Colour ▸ shows "none" and nine colours; Emoji ▸ shows "none" and twelve emoji; choosing one closes the whole menu.
- [ ] More menu (⋯ at the top right), Zoom ▸: the zoom entries open as a flyout and work.
- [ ] Arabic: the flyout opens to the **left** of its entry, **←** opens it and **→** closes it, the ▸ is mirrored.
- [ ] Tab through the page afterwards: nothing is left focused inside a closed flyout.

## 2. Fix A2: yellow group colour

- [ ] The group colour menu has "none" plus **nine** colours; Yellow is between Amber and Green.
- [ ] Yellow is a readable stripe on a tab in the light theme (olive-yellow) and a light yellow in the dark theme; switch the theme and look at both.
- [ ] Choosing Yellow also colours the drop frame when you drag files over that group.
- [ ] A session file with an older group colour still opens.

## 3. Fix A3: names of new groups

- [ ] Group 1 exists: **+** makes "Group 2". Make Group 3, delete Group 2, press **+**: it makes "Group 2" again.
- [ ] Rename Group 2 to "Notes": **+** makes "Group 2" (a renamed group does not count). Rename it to "Group 7 old": the number is not counted either.
- [ ] Move to ▸ New group uses the same rule.
- [ ] German: the new group is "Gruppe 2", "Gruppe 3", ... Switch to English: "Group 1" (made by English) and "Gruppe 2" both still count, so the next is "Group 3".
- [ ] Arabic: the new group is named in Arabic ("المجموعة 2"); Urdu likewise.
- [ ] New session: its first group is named in the interface language.

## 4. The editor and zoom

- [ ] Selecting a capture shows it on a canvas; the zoom badge shows the percentage; **Fit**, **100 %**, Ctrl+0, Ctrl+1, Ctrl+plus and Ctrl+minus still work.
- [ ] With no capture shown (empty group) the tools are greyed out and their tooltips say "Select a capture to use the tools."
- [ ] **[REAL INPUT]** **Ctrl + mouse wheel** zooms at the pointer: the point under the pointer stays where it is. The badge follows.
- [ ] **[REAL INPUT]** **Space + drag** and **middle-button drag** pan the picture. Drawing after panning puts marks where the pointer is (at 25 %, 100 % and 400 %).
- [ ] **[REAL INPUT]** On a display with 125 % or 150 % scaling (and with two monitors of different scaling, moving the window between them) marks land exactly under the pointer and stay sharp.
- [ ] Rotating or cropping re-fits the picture.

## 5. Select

- [ ] **V** (or the arrow button) selects. Click a mark: handles appear (8 handles, a round rotation handle for shapes, text and emoji; two end handles for lines and arrows).
- [ ] Drag a mark to move it; drag a handle to resize; drag the round handle to turn it (**Shift** snaps to 15°).
- [ ] **Ctrl+click** or **Shift+click** adds a mark to the selection; dragging on empty picture draws a selection box.
- [ ] Moving several selected marks moves them together. **Arrow keys** nudge by 1 px (10 px with Shift) on the screen, also when the picture is rotated.
- [ ] **Delete** or **Backspace** removes the selection. **Esc** deselects, then goes back to Select.
- [ ] Select a pen stroke and change the pen colour or size in its popover: the stroke changes. The same for a highlighter stroke (highlighter popover), a rectangle or ellipse (Fill and Outline), a line or arrow (Outline) and text (Text popover).
- [ ] One undo step undoes a whole colour change, not each shade the slider passed.

## 6. Pen

- [ ] **P**: drag draws a smooth stroke in the colour and size of the pen popover; slow wiggles are smoothed, a click makes a dot.
- [ ] **Shift** while drawing makes a straight line from the start to the pointer; letting go of Shift mid-stroke returns to the free stroke.
- [ ] **[REAL INPUT]** With a pen tablet, pressing harder makes the stroke thicker; a mouse draws an even stroke.
- [ ] A 4 px stroke at 30 % zoom is thin but visible; the size slider changes it.

## 7. Highlighter

- [ ] **H**: a semi-transparent wide stroke; the text underneath stays readable.
- [ ] Draw a stroke that crosses itself: where it crosses it is **not** darker (one stroke is one layer). Two separate strokes over each other do get darker.
- [ ] **Shift** draws a straight line (for highlighting a line of text).

## 8. Eraser

- [ ] **E**: dragging over a mark removes the **whole** mark (not a piece of it); the marks that will go are shown with a red dashed box while you drag, and are removed when you let go. One undo restores them all.
- [ ] The eraser also removes redactions, text and emoji.
- [ ] Eraser ▾ → **Erase all mark-ups** removes all marks (crop and rotation stay) and can be undone with Ctrl+Z. It is greyed out when there are no marks.

## 9. Shapes and emoji

- [ ] **S** opens the shapes row: Emoji, Rectangle, Circle, Line, Arrow, Fill, Outline.
- [ ] Rectangle and circle with Fill "none" and with a colour and opacity; Outline "none", colour, opacity and size.
- [ ] **Shift** makes a square or a circle; with Line and Arrow, Shift snaps to 45° steps.
- [ ] The arrow head grows with the stroke size and a short arrow still looks like an arrow.
- [ ] A tiny drag (a click) does not make a shape.
- [ ] Emoji: pick one in the ▾ grid, click on the picture to place it; it is selected so it can be moved, resized and turned at once.

## 10. Text

- [ ] **T**, click on the picture, type: a text box appears where you clicked. Enter makes a new line. **Esc**, **Ctrl+Enter** or clicking elsewhere finishes. Empty text leaves nothing behind.
- [ ] **[REAL INPUT]** Type with a real keyboard: letters, an emoji from the emoji panel (Win+.), Chinese through an IME, Arabic and Hebrew.
- [ ] Arabic or Hebrew text is drawn right to left, from its right edge; a mixed line starting with Latin letters is left to right.
- [ ] The Text ▾ popover: colour palette, size slider, "Label background" (a white label behind dark text, black behind light text).
- [ ] **Double-click** a text with Select (or click it with the Text tool) edits it again. Changing size or colour of a selected text keeps the selection box around the text.
- [ ] Emoji and Chinese characters in text use a font that has them (no empty squares).

## 11. Crop

- [ ] **C** shows the whole picture dimmed outside a frame with 8 handles and thirds lines; a bar offers the aspect (Free, 1:1, 4:3, 16:9), **Reset crop**, ✕ and ✓.
- [ ] Drag the handles and the inside of the frame; the frame stays inside the picture. With an aspect chosen, the frame keeps it.
- [ ] **Enter** or ✓ applies; **Esc** or ✕ cancels. After applying, the picture shows only the crop and the size is smaller.
- [ ] Marks outside the crop are not drawn but come back when the crop is reset or changed.
- [ ] Crop again: the frame starts at the current crop and can be enlarged. **Reset crop** (also while cropping) removes it. Undo / redo work for the crop.
- [ ] Crop after a rotation or a flip: the crop is where you drew it on the screen.

## 12. Rotate and flip

- [ ] **R** or the button turns the picture 90° clockwise; marks turn with it. ▾ has Rotate left, Flip horizontal, Flip vertical.
- [ ] Flip: the picture and the marks are mirrored, but **text and emoji stay readable**.
- [ ] Rotate, then crop, then rotate again: the crop stays on the same part of the picture.

## 13. Blur and redact

- [ ] **B**: drag a rectangle. The ▾ menu chooses **Pixelate** (default), **Blur** or **Black box**; the choice is kept.
- [ ] Pixelate and Blur make the area unreadable (try text), not just softer. A redaction can be selected (a dashed outline shows where it is), moved, resized and deleted.
- [ ] Copy the capture with the Phase 6 Copy later and paste it into an image editor: the original pixels are **gone** in the area. (Until Phase 6 you can check the card thumbnail and the picture saved on disk is unchanged: `images\<id>.png` is the original; the redaction exists only in the annotations. See "What is stored" below.)
- [ ] A redaction partly outside the picture is clipped.

## 14. Undo, redo, switching captures

- [ ] Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z, and the toolbar buttons (greyed out when nothing can be done), work for every kind of change (marks, moves, colour, crop, rotate, erase all).
- [ ] Switch to another capture and back: the undo history of the first one is still there. After restarting Snipmunk the marks are there but the history starts empty.
- [ ] Start a stroke and, without letting go, click another capture: the stroke is kept on the first capture; nothing is lost. The same while typing text.
- [ ] Tool shortcuts **V P H E S T C R B** work when the picture has the focus, not while typing in a text box or a rename field; they are shown in the tooltips.
- [ ] **Esc** goes back to Select.

## 15. What is stored

- [ ] After editing, `session.json` has `annotations` with `"version": 1` for that capture, `null` for captures nobody edited.
- [ ] `images\<id>.png` is **unchanged** (same size and date as before editing).
- [ ] The card thumbnail shows the annotated picture a second after the last edit, in all three gallery views.
- [ ] Duplicate a capture with annotations: the copy has the same marks; editing the copy does not change the original.
- [ ] Kill Snipmunk in Task Manager right after an edit: the edit is there after the restart.
- [ ] A session file from Phase 4 (annotations `null`) opens and edits fine.

## 16. A 4K capture with many annotations

- [ ] Seed a 3840 x 2160 capture (see the top), then run this in the console of the main window to add 203 generated marks (120 strokes, shapes, arrows, highlighter, text, emoji and 3 redactions) to the first capture of the session, and reload the page with F5 or by restarting Snipmunk:

```js
(async()=>{const s=await window.__TAURI_INTERNALS__.invoke('get_current_session'); const c=s.groups[0].captures[0]; const W=c.width,H=c.height; const rnd=(a,b)=>a+Math.random()*(b-a); let id=0; const nid=()=>'p'+(id++); const items=[]; const colors=['#E53935','#1E88E5','#43A047','#FDD835','#8E24AA'];
 for(let i=0;i<120;i++){ let x=rnd(100,W-100), y=rnd(100,H-100); const pts=[]; for(let k=0;k<80;k++){ x+=rnd(-14,14); y+=rnd(-14,14); pts.push(x,y,0.5);} items.push({type:'pen',id:nid(),points:pts,color:colors[i%5],size:rnd(3,10)}); }
 for(let i=0;i<30;i++){ items.push({type:'rect',id:nid(),x:rnd(50,W-400),y:rnd(50,H-300),w:rnd(80,360),h:rnd(60,260),rotation:rnd(-0.5,0.5),fill:i%3?'none':'#FDD835',fillOpacity:40,stroke:colors[i%5],strokeOpacity:100,strokeWidth:4}); }
 for(let i=0;i<20;i++){ items.push({type:'ellipse',id:nid(),x:rnd(50,W-400),y:rnd(50,H-300),w:rnd(80,300),h:rnd(60,200),rotation:0,fill:'none',fillOpacity:100,stroke:colors[i%5],strokeOpacity:100,strokeWidth:5}); }
 for(let i=0;i<15;i++){ items.push({type:'arrow',id:nid(),x1:rnd(50,W-50),y1:rnd(50,H-50),x2:rnd(50,W-50),y2:rnd(50,H-50),stroke:colors[i%5],strokeOpacity:100,strokeWidth:6}); }
 for(let i=0;i<5;i++){ const pts=[]; let x=rnd(100,W-600),y=rnd(100,H-100); for(let k=0;k<40;k++){x+=12;y+=rnd(-3,3);pts.push(x,y,0.5);} items.push({type:'highlighter',id:nid(),points:pts,color:'#FFEB3B',size:34}); }
 for(let i=0;i<5;i++){ items.push({type:'text',id:nid(),x:rnd(50,W-500),y:rnd(50,H-200),w:300,h:70,text:'Note '+i+' مرحبا',fontSize:48,color:'#000000',background:i%2===0,rotation:0}); }
 for(let i=0;i<5;i++){ items.push({type:'emoji',id:nid(),x:rnd(50,W-200),y:rnd(50,H-200),size:120,char:'🔥',rotation:0}); }
 for(let i=0;i<3;i++){ items.push({type:'redact',id:nid(),x:rnd(100,W-700),y:rnd(100,H-400),w:600,h:200,mode:['pixelate','blur','box'][i]}); }
 await window.__TAURI_INTERNALS__.invoke('set_annotations',{captureId:c.id,annotations:{version:1,crop:null,rotation:0,flipH:false,flipV:false,items}}); return {id:c.id,w:W,h:H,count:items.length}})()
```

- [ ] **[REAL INPUT]** Pan with Space+drag and zoom with Ctrl+wheel: smooth, no visible stutter. Draw a new stroke: it follows the pointer without lag.
- [ ] Changing the colour of a selection of 50 marks is immediate.
- [ ] The memory of Snipmunk does not keep growing while you edit for several minutes.

## 17. Arabic (right to left)

- [ ] The toolbar is mirrored; the tool order reads from the right; the popovers open inside the window.
- [ ] Text tool: typing Arabic; the text box, the drawn text and the label are right to left; Latin words inside Arabic text stay readable.
- [ ] The crop bar, the aspect list and the ✓ ✕ buttons are mirrored sensibly.
- [ ] Menus and flyouts: see section 1.
- [ ] All new strings (crop bar, tool tooltips, redact modes, group names) are in Arabic and Urdu.

## 18. Clean up

- [ ] Delete the generated sessions in `%AppData%\SecondDawn\snipmunk\sessions` (or start a new session with "Delete them").
