// End-to-end check of the guide editor of 7.5-C3 in a DEVELOPMENT test instance: the tabbed sidebar, the tools row of the
// selected step, zoom without a frame, the Blank template, and Quick redact on generated editor screenshots. (The pages,
// the cover and the background are checked by e2e-guide-c4.mjs.) Generated pictures only: nothing of the desktop is read.
// It refuses to do anything unless the instance was started with SNIPMUNK_NO_REAL_CAPTURE (it asks before the first click).
//   node scripts/e2e-guide-c3.mjs <scratch folder> [<folder of pictures made by gen-editor-fixture.ps1>]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [out, pictures] = process.argv.slice(2);
if (!out) throw new Error("usage: node scripts/e2e-guide-c3.mjs <scratch folder> [<folder of editor pictures>]");
const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
let ws = null;
for (const t of targets.filter((x) => x.type === "page")) {
  const w = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (w.onopen = r));
  const kind = await new Promise((r) => {
    w.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id === 1) r(d.result?.result?.value);
    };
    w.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "document.documentElement.dataset.window", returnByValue: true } }));
  });
  if (kind === "main") {
    ws = w;
    break;
  }
  w.close();
}
if (!ws) throw new Error("no main window of a test instance on port 9222");
let n = 10;
const pending = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  pending.get(d.id)?.(d);
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const id = n++;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
const ev = async (expression) => {
  const d = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (d.result?.exceptionDetails) throw new Error(JSON.stringify(d.result.exceptionDetails).slice(0, 700));
  return d.result?.result?.value;
};
const inv = (command, args = {}) => ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`);

// THE GUARD FIRST: without it nothing is clicked.
if ((await inv("dev_capture_guard").catch(() => false)) !== true) {
  console.error("STOP: the test instance does not have the no-real-capture guard (SNIPMUNK_NO_REAL_CAPTURE).");
  process.exit(2);
}
console.log("PASS  the no-real-capture guard is active");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (expression, ms = 60000) => {
  const start = Date.now();
  for (;;) {
    if (await ev(expression)) return Date.now() - start;
    if (Date.now() - start > ms) throw new Error("timed out: " + expression);
    await sleep(100);
  }
};
let failed = 0;
const check = (ok, what, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${extra ? "  " + extra : ""}`);
  if (!ok) failed++;
};
const shot = async (name) => writeFileSync(path.join(out, name), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
const size = (width, height) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
const mouse = (type, x, y, more = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...more });
const press = async (x, y, modifiers = 0) => {
  await mouse("mouseMoved", x, y, { button: "none", modifiers });
  await mouse("mousePressed", x, y, { buttons: 1, modifiers });
  await mouse("mouseReleased", x, y, { modifiers });
};
const drag = async (from, to) => {
  await mouse("mouseMoved", from[0], from[1], { button: "none" });
  await mouse("mousePressed", from[0], from[1], { buttons: 1 });
  for (let i = 1; i <= 8; i++) await mouse("mouseMoved", from[0] + ((to[0] - from[0]) * i) / 8, from[1] + ((to[1] - from[1]) * i) / 8, { buttons: 1 });
  await mouse("mouseReleased", to[0], to[1]);
};
const key = async (k, code = 0, modifiers = 0) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k, windowsVirtualKeyCode: code, modifiers });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k, windowsVirtualKeyCode: code, modifiers });
};
const rect = (selector, i = 0) => ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(selector)})[${i}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; })()`);
const clickOn = async (target, i = 0, modifiers = 0) => {
  // (a step is selected by a click on its number: the line beside it is its text)
  const selector = target === ".gstep .gstep__head" ? ".gstep .gstep__badge" : target;
  if (selector !== target) await ev(`(() => { const e = document.querySelectorAll('${selector}')[${i}]; const r = e.getBoundingClientRect(); const l = document.querySelector('.glist').getBoundingClientRect(); if (r.top < l.top || r.bottom > l.bottom - 60) e.scrollIntoView({ block: 'center' }); })()`);
  await sleep(150);
  const r = await rect(selector, i);
  if (!r) throw new Error("nothing at " + selector);
  await press(r.x + Math.min(r.w / 2, 40), r.y + Math.min(r.h / 2, 14), modifiers);
  await sleep(350);
};
const button = (text, scope = "document") => ev(`(() => { const b = [...${scope}.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`);
const read = () => inv("doc_read").then((r) => r.document);
/** Wait until the document was written (it is written a moment after a change). */
const written = async () => {
  await sleep(700);
  return read();
};
const reopen = async () => {
  await ev("location.reload()");
  await sleep(3000);
  await ev("(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.startsWith('Recover guide')); if (b) b.click(); })()");
  await until("!!document.querySelector('.gpage')");
  await sleep(1500);
};
const settings = (patch) => inv("set_settings", { patch });

await size(1366, 900);
await settings({ captureKind: "documents", language: "en", docZoom: 100, docPageWidth: "normal", docPanelWidth: 300, docPanelCollapsed: false, docTemplate: "basic", quickRedactEmail: true, quickRedactPhone: false, quickRedactCard: true, quickRedactIban: true, quickRedactSecret: true, quickRedactWords: [] });
await inv("doc_close").catch(() => undefined);
await inv("dev_guide_seed", { count: 5 });
await reopen();

// --- the sidebar ----------------------------------------------------------------------------------------------------------------
const side = await ev(`(() => ({ tabs: [...document.querySelectorAll('.gpanel__tab')].map((b) => b.textContent), sections: [...document.querySelectorAll('#gpanel-guide summary')].map((s) => s.textContent), choose: [...document.querySelectorAll('.gpanel button')].some((b) => /Choose template|Customize/.test(b.textContent)), colourRows: [...document.querySelectorAll('#gpanel-guide .fxrow__label')].filter((l) => /^Number (background|text)$/.test(l.textContent)).length }))()`);
check(side.tabs.join() === "Guide,Step,Tree", "three tabs", side.tabs.join());
check(side.sections.length === 14 && !side.choose, "the Guide tab has the template's sections and no 'Choose template' button", side.sections.join(" | "));
check(side.colourRows === 2, "number background and text appear once", String(side.colourRows));
await shot("c3-guide-tab.png");
await clickOn('.gpanel__tab[data-tab="step"]');
check(await ev("document.querySelector('#gpanel-step').textContent.includes('Select a step')"), "the Step tab asks for a step");
await clickOn('.gpanel__tab[data-tab="guide"]');

// resize and fold
const before = await rect(".gpanel");
const edge = await rect(".gpanel__edge");
await drag([edge.x + 4, edge.y + 200], [edge.x - 96, edge.y + 200]);
await sleep(600);
const wider = await rect(".gpanel");
check(Math.abs(wider.w - before.w - 100) <= 2, "dragging the inner edge makes the sidebar wider", `${before.w} -> ${wider.w}`);
check((await inv("get_settings")).docPanelWidth === Math.round(wider.w), "the width is remembered");
await clickOn(".gpanel__fold");
const folded = await rect(".gpanel");
check(folded.w <= 40 && (await inv("get_settings")).docPanelCollapsed === true, "it folds to a strip of tabs and that is remembered", String(folded.w));
await shot("c3-folded.png");
await clickOn(".gstep .gstep__head", 0);
check((await rect(".gpanel")).w <= 40, "selecting a step leaves a folded sidebar folded");
await clickOn('.gpanel__tab[data-tab="step"]');
check(await ev("!document.querySelector('#gpanel-step').hidden"), "a tab of the strip opens it again");
await key("Escape", 27);
await sleep(400);

// --- the tools (a grid in the Step tab; nothing is put into the pages) -------------------------------------------------------
await clickOn('.gpanel__tab[data-tab="guide"]');
const headTop = (i) => rect(".gstep .gstep__head", i).then((r) => r.y);
const heights = () => ev("[...document.querySelectorAll('.gstep')].map((x) => Math.round(x.getBoundingClientRect().height))");
const h0 = await heights();
const y0 = await headTop(0);
await clickOn(".gstep .gstep__head", 0);
const grid = await ev(`(() => { const g = document.querySelector('#gpanel-step .toolgrid'); return g ? { on: g.querySelectorAll('[data-tool]:not(:disabled)').length, groups: [...g.querySelectorAll('h4')].map((h) => h.textContent).join(), inPages: !!document.querySelector('.glist .toolgrid') } : null; })()`);
check(grid && grid.on > 12 && grid.groups === "Draw,Text,Hide,Picture" && !grid.inPages, "the Step tab has the tool grid, and nothing is in the pages", JSON.stringify(grid));
check(Math.abs((await headTop(0)) - y0) < 1, "the selected step's header did not move");
const h1 = await heights();
check(h1.every((v, i) => Math.abs(v - h0[i]) <= 1), "no step changed its height", JSON.stringify([h0, h1]));
check(await ev("!document.querySelector('#gpanel-step').hidden"), "selecting a step opens the Step tab");
await ev("document.querySelectorAll('.gstep .gstep__badge')[1].scrollIntoView({ block: 'center' })");
await sleep(500);
const y1 = await headTop(1);
await clickOn(".gstep .gstep__head", 1);
check(Math.abs((await headTop(1)) - y1) < 1, "selecting the next step at the top of the guide does not make the view jump", `${y1} -> ${await headTop(1)}`);
await ev("(() => { const l = document.querySelector('.glist'); l.scrollTop += document.querySelectorAll('.gstep__head')[2].getBoundingClientRect().top - 420; })()");
await sleep(500);
const third = await headTop(2);
await clickOn(".gstep .gstep__head", 2);
check(Math.abs((await headTop(2)) - third) < 1, "nor further down", `${third} -> ${await headTop(2)}`);
await clickOn(".gstep .gstep__head", 2);
check(await ev("document.querySelectorAll('.gblock--sel').length === 1 && document.querySelectorAll('.gstep')[2].classList.contains('gblock--sel')"), "the clicked step is selected, and a second click keeps it");
await shot("c3-step-selected.png");
// the menus of the row open where their buttons are, also when the page is zoomed
for (const zoom of [100, 150]) {
  await settings({ docZoom: zoom, docFit: "none" });
  await sleep(900);
  await ev("document.querySelector('.gblock--sel').scrollIntoView({ block: 'start' })");
  await sleep(400);
  await ev("document.querySelector('#gpanel-step .toolgrid [aria-label=\"Color\"], #gpanel-step .toolgrid [aria-label=\"Colour\"]').click()");
  await sleep(500);
  const pop = await ev(`(() => { const b = document.querySelector('#gpanel-step .toolgrid [aria-expanded="true"]').getBoundingClientRect(); const p = document.querySelector('.pop__panel').getBoundingClientRect(); const top = document.elementFromPoint(p.x + 20, p.y + 20); return { dx: Math.abs(p.x - b.x), dy: Math.min(Math.abs(p.y - b.bottom), Math.abs(b.y - p.bottom)), inView: p.right <= innerWidth + 1 && p.bottom <= innerHeight + 1 && p.x >= 0 && p.y >= 0, onTop: !!top?.closest('.pop__panel') }; })()`);
  check(pop.dx < 320 && pop.dy < 20 && pop.inView && pop.onTop, `the colour menu opens at its button and on top (zoom ${zoom}%)`, JSON.stringify(pop));
  if (zoom === 150) await shot("c3-color-menu-150.png");
  await key("Escape", 27);
  await sleep(300);
}
await settings({ docZoom: 100, docFit: "auto" });
await size(760, 800);
await sleep(900);
await ev("document.querySelector('.gblock--sel').scrollIntoView({ block: 'start' })");
await sleep(300);
const narrow = await ev(`(() => { const g = document.querySelector('#gpanel-step .toolgrid'); const d = g.getBoundingClientRect(); const out = [...g.querySelectorAll('button')].filter((e) => { const x = e.getBoundingClientRect(); return x.width > 0 && (x.right > d.right + 1 || x.left < d.left - 1); }).length; return { out }; })()`);
check(narrow.out === 0, "narrow: every tool stays inside the sidebar", JSON.stringify(narrow));
await shot("c3-tools-narrow.png");
await size(1366, 900);
await sleep(700);

// --- zoom without a frame -------------------------------------------------------------------------------------------------------
await ev("document.querySelector('.gblock--sel').scrollIntoView({ block: 'center' })");
await sleep(400);
const chosen = await ev("document.querySelector('.gblock--sel').dataset.block");
const stepBlock = async () => (await written()).blocks.find((x) => x.id === chosen);
const slider = async (value) => ev(`(() => { const i = document.querySelector('#gpanel-step .gpanel__zoom input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${value}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
check(await ev("[...document.querySelectorAll('#gpanel-step button')].find((b) => b.textContent.trim() === 'Fill').disabled"), "without a frame 'Fill' is off");
await slider(50);
let b = await stepBlock();
check(b.frame?.own === true && b.frame.w < 1000, "the slider zooms a picture without a frame", JSON.stringify(b.frame));
const pic = await rect(".gblock--sel .gpic");
await drag([pic.x + pic.w / 2, pic.y + pic.h / 2], [pic.x + pic.w / 2 - 120, pic.y + pic.h / 2 - 60]);
const moved = (await stepBlock()).frame;
check(moved.cx > b.frame.cx && moved.cy > b.frame.cy && moved.w === b.frame.w, "dragging moves the zoomed picture", JSON.stringify([b.frame, moved]));
await mouse("mouseWheel", pic.x + pic.w / 2, pic.y + pic.h / 2, { deltaX: 0, deltaY: -240, modifiers: 1, button: "none" });
const wheeled = (await stepBlock()).frame;
check(wheeled.w < moved.w, "Alt and the wheel zoom on the picture", `${moved.w} -> ${wheeled.w}`);
await shot("c3-zoomed.png");
await button("Fit", "document.querySelector('#gpanel-step')");
check((await stepBlock()).frame == null, "'Fit' takes the zoom away");

// --- several steps, the outline ---------------------------------------------------------------------------------------------------
await clickOn('.gpanel__tab[data-tab="steps"]');
const outline = await ev("[...document.querySelectorAll('.goutline [data-outline]')].map((b) => b.querySelector('.goutline__words').textContent)");
check(outline.length === 5 && (await ev("document.querySelectorAll('.goutline__thumb img').length >= 3")), "the outline lists the steps with small pictures", outline.join(" | "));
await shot("c3-outline.png");
await clickOn(".goutline [data-outline]", 4);
check(await ev("(() => { const s = document.querySelectorAll('.gstep')[4].getBoundingClientRect(); const l = document.querySelector('.glist').getBoundingClientRect(); return s.top < l.bottom && s.bottom > l.top && document.querySelectorAll('.gstep')[4].classList.contains('gblock--sel'); })()"), "a click in the outline selects and shows the step");
check(await ev("!document.querySelector('#gpanel-steps').hidden"), "and the outline stays open");
const order = async () => (await written()).blocks.map((x) => x.n);
await ev(`(() => { const dt = new DataTransfer(); const items = document.querySelectorAll('.goutline__item'); const from = items[4].querySelector('button'); from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })); const r = items[0].getBoundingClientRect(); items[0].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: r.y + 2 })); window.__dt = dt; })()`);
await sleep(200);
await ev(`(() => { const items = document.querySelectorAll('.goutline__item'); items[0].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__dt })); })()`);
check((await order()).join() === "5,1,2,3,4", "dragging in the outline reorders", (await order()).join());
await clickOn(".goutline [data-outline]", 1);
await clickOn(".goutline [data-outline]", 2, 2);
await key("Delete", 46);
check((await order()).join() === "5,3,4", "Delete removes the selected steps", (await order()).join());
await key("z", 90, 2);
check((await order()).join() === "5,1,2,3,4", "and one undo brings them back", (await order()).join());
await ev("document.querySelector('.glist').scrollTop = 0");
await sleep(500);
await clickOn(".gstep .gstep__head", 0);
await ev("(() => { const l = document.querySelector('.glist'); l.scrollTop += document.querySelectorAll('.gstep__head')[1].getBoundingClientRect().top - 300; })()");
await sleep(300);
await clickOn(".gstep .gstep__head", 1, 8);
const multi = await ev(`(() => { const p = document.querySelector('#gpanel-step'); return { text: p.textContent, slider: !!p.querySelector('.gpanel__zoom input'), adjust: p.textContent.includes('Adjust zoom area'), tools: p.querySelectorAll('.toolgrid [data-tool]:not(:disabled)').length }; })()`);
check(multi.text.includes("2 selected") && !multi.slider && !multi.adjust && multi.tools === 0 && multi.text.includes("Quick redact these steps"), "with several steps only what all can do", JSON.stringify({ ...multi, text: multi.text.slice(0, 80) }));
await ev("[...document.querySelectorAll('#gpanel-step .dw-switch')].find((s) => s.getAttribute('aria-label') === 'Show step number').click()");
const hidden = await written();
check(hidden.blocks[0].numberHidden && hidden.blocks[1].numberHidden, "the step number can be switched off for both");
check(await ev("document.querySelector('.gstep__badge').textContent === '1' && document.querySelectorAll('.gstep__badge').length === 3"), "the steps after them count from 1");
await key("z", 90, 2);
await key("Escape", 27);

// --- templates, page size, page breaks ------------------------------------------------------------------------------------------
await clickOn('.gpanel__tab[data-tab="guide"]');
const template = async (name) => {
  await ev("document.querySelector('.headrow .gsplit__more').click()");
  await sleep(400);
  const names = await ev("[...document.querySelectorAll('.tplmenu [role=menuitemradio]')].map((b) => b.textContent.trim())");
  await ev(`[...document.querySelectorAll('.tplmenu button')].find((b) => b.textContent.trim() === ${JSON.stringify(name)}).click()`);
  await sleep(900);
  return names;
};
const names = await template("Corporate");
check(names[0] === "Blank", "Blank is the first template of the menu", names.join());
await ev(`(async () => { const r = await window.__TAURI_INTERNALS__.invoke('doc_read'); const apply = await import('/src/docs/template/apply.ts'); const d = apply.changeTemplate(r.document, (t) => { t.cover.title = 'Printers for everyone'; }); await window.__TAURI_INTERNALS__.invoke('doc_write', { document: d }); })()`);
await reopen();

// --- Blank, and the template of new guides ------------------------------------------------------------------------------------------
const had = await written();
await template("Blank");
const blank = await written();
check(blank.template.id === "blank" && !blank.template.cover.on && JSON.stringify(blank.blocks) === JSON.stringify(had.blocks) && blank.template.cover.title === "Printers for everyone", "Blank removes the look and keeps the content");
check(await ev("!document.querySelector('.gcover') && !document.querySelector('.gcontents')"), "no cover and no contents on screen");
await shot("c3-blank.png");
await key("z", 90, 2);
check((await written()).template.id === "corporate", "one undo step");
await inv("doc_close");
await settings({ docTemplate: "training" });
await inv("dev_guide_seed", { count: 2 });
await reopen();
check((await written()).template?.id === "training", "a new guide starts with the template of the settings");
await settings({ docTemplate: "basic" });

// --- right to left ------------------------------------------------------------------------------------------------------------
await settings({ language: "ar" });
await sleep(1500);
await clickOn(".gstep .gstep__head", 0);
const rtl = await ev("(() => { const p = document.querySelector('.gpanel').getBoundingClientRect(); const m = document.querySelector('.geditor__main').getBoundingClientRect(); const e = document.querySelector('.gpanel__edge').getBoundingClientRect(); return { left: p.right <= m.left + 1, edge: e.x >= p.right - 12 }; })()");
check(rtl.left && rtl.edge, "right to left: the sidebar is mirrored", JSON.stringify(rtl));
await shot("c3-rtl.png");
await settings({ language: "en" });
await sleep(1000);

// --- quick redact on generated editor screenshots ---------------------------------------------------------------------------------
if (pictures && existsSync(pictures)) {
  const lines = process.env.C3_LINES
    ? readFileSync(process.env.C3_LINES, "utf8").split(/\r?\n/)
    : ["Name : Test Person", "email : k@example.com", "password: 8842kqzw771m", "Iban: DE89 3704 0044 0532 0130 00", "IBAN: DE89-1111-2222-3333-4444-55", "", "IBAN: DE89111122223333444455", "", "password : 47qrt$9191", "", "end"];
  const shots = [["cons-1920x1080-100-10pt", 100, 10, "cons"], ["cons-1920x1080-125-10pt", 125, 10, "cons"], ["cons-1920x1200-150-11pt", 150, 11, "cons"], ["cour-1920x1080-100-11pt", 100, 11, "cour"], ["cour-1920x1080-125-10pt", 125, 10, "cour"], ["cur-email-125", 125, 10, "cons"], ["dark-125", 125, 11, "cons"]];
  await inv("doc_close").catch(() => undefined);
  await inv("doc_new", { title: "Redact test" });
  const steps = [];
  for (const [name] of shots) steps.push(await inv("doc_add_step_image", { base64Data: readFileSync(path.join(pictures, `${name}.png`)).toString("base64") }));
  await ev(`(async () => { const model = await import('/src/docs/model.ts'); const doc = model.createDocument('Redact test', Date.now(), ${JSON.stringify(steps)}, { marker: { left: '#f00', right: '#00f', shape: 'circle', size: 'medium' }, badge: 'circle', picture: 'screen', keepFull: false, zoomDefault: false }); await window.__TAURI_INTERNALS__.invoke('doc_write', { document: doc }); })()`);
  await reopen();
  const covered = (doc, only) => {
    let missed = [];
    let total = 0;
    shots.forEach(([name, percent, points, face], s) => {
      if (only !== undefined && s !== only) return;
      const k = percent / 100;
      const px = (v) => {
        const x = v * k;
        const r = Math.round(x);
        return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
      };
      const height = px(Math.ceil(((points * 96) / 72) * 1.22));
      const letter = Math.round(Math.round(((points * 96) / 72) * k) * (face === "cons" ? 0.55 : 0.6));
      lines.forEach((line, i) => {
        const label = /^(?:email|password|iban)\s*:\s*/i.exec(line);
        if (!label) return;
        total++;
        const y = px(104) + px(1) + i * height + height / 2;
        const [x0, x1] = [px(66) + label[0].length * letter, px(66) + line.length * letter];
        const marks = (doc.blocks[s].redact ?? []).filter((m) => m.rect[1] <= y && m.rect[1] + m.rect[3] >= y).map((m) => [Math.max(x0, m.rect[0]), Math.min(x1, m.rect[0] + m.rect[2])]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
        let width = 0;
        let end = x0;
        for (const [a, b] of marks) {
          width += Math.max(0, b - Math.max(a, end));
          end = Math.max(end, b);
        }
        if (width < 0.85 * (x1 - x0)) missed.push(`${name} line ${i + 1} (${Math.round((width / (x1 - x0)) * 100)}%)`);
      });
    });
    return { missed, total };
  };
  // one step
  await clickOn(".gstep .gstep__head", 0);
  await button("Quick redact this step", "document.querySelector('#gpanel-step')");
  await sleep(500);
  const t0 = Date.now();
  await button("Quick redact", "document.querySelector('.pop__panel')");
  await until("true");
  await sleep(4000);
  const one = covered(await read(), 0);
  check(one.missed.length === 0, "quick redact of one step covers every secret line", JSON.stringify(one.missed));
  await key("z", 90, 2);
  await sleep(700);
  // the whole guide
  await ev("document.querySelector('.gpanel__tab[data-tab=\"guide\"]').click()");
  await sleep(200);
  await ev("[...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith('Quick redact whole guide')).click()");
  await sleep(400);
  const start = Date.now();
  await button("Scan", "document.querySelector('.dw-dialog')");
  await until("!!document.querySelector('.redact__sum')");
  const took = Date.now() - start;
  console.log(`TIME  whole-guide scan of ${shots.length} steps: ${took} ms (${Math.round(took / shots.length)} ms a step)${t0 ? "" : ""}`);
  await shot("c3-redact-list.png");
  await button("Apply", "document.querySelector('.dw-dialog')");
  const all = covered(await written());
  check(all.missed.length <= Math.ceil(all.total * 0.03), `whole guide: ${all.total - all.missed.length} of ${all.total} secret lines covered`, JSON.stringify(all.missed));
  await ev("document.querySelector('.glist').scrollTop = 0");
  await sleep(600);
  await shot("c3-redacted.png");
  // the OCR debug view
  await clickOn(".gstep .gstep__head", 0);
  await button("OCR debug", "document.querySelector('#gpanel-step')");
  await until("(document.querySelector('.ocrdbg__text')?.textContent.length ?? 0) > 100");
  await sleep(600);
  check(await ev("document.querySelectorAll('.ocrdbg__picture rect').length > 10"), "the OCR debug view shows boxes and lines", await ev("document.querySelector('.ocrdbg__text').textContent.split('\\n')[0]"));
  await shot("c3-ocr-debug.png");
  await button("OK", "document.querySelector('.dw-dialog')");
}

const errors = await ev("window.__e2eErrors ?? []");
if (errors.length) console.log("page errors:", errors);
await send("Emulation.clearDeviceMetricsOverride");
console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);
