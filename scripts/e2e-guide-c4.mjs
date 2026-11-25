// End-to-end check of the paged canvas of 7.5-C4 in a DEVELOPMENT test instance: real pages, the same page breaks as the PDF,
// header, footer and background on every sheet, live template styling, tables over pages, zoom, the print preview, cover and
// contents designs, and typing speed in a long guide. Generated pictures only: nothing of the desktop is read.
// It refuses to do anything unless the instance was started with SNIPMUNK_NO_REAL_CAPTURE (it asks before the first click).
//   node scripts/e2e-guide-c4.mjs <scratch folder> [section ...]     (sections: pages style designs preview speed shots)
import { writeFileSync } from "node:fs";
import path from "node:path";

const [out, ...only] = process.argv.slice(2);
if (!out) throw new Error("usage: node scripts/e2e-guide-c4.mjs <scratch folder> [section ...]");
const folder = path.resolve(out).replace(/\\/g, "/");
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
const problems = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.method === "Runtime.exceptionThrown") problems.push(String(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).slice(0, 300));
  if (d.method === "Runtime.consoleAPICalled" && (d.params.type === "error" || d.params.type === "warning")) problems.push(`${d.params.type}: ${d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300)}`);
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
await send("Runtime.enable");

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
const key = async (k, code = 0, modifiers = 0) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k, windowsVirtualKeyCode: code, modifiers });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k, windowsVirtualKeyCode: code, modifiers });
};
const rect = (selector, i = 0) => ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(selector)})[${i}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; })()`);
const clickOn = async (selector, i = 0, modifiers = 0) => {
  const r = await rect(selector, i);
  if (!r) throw new Error("nothing at " + selector);
  await press(r.x + Math.min(r.w / 2, 40), r.y + Math.min(r.h / 2, 14), modifiers);
  await sleep(350);
};
const read = () => inv("doc_read").then((r) => r.document);
const written = async () => {
  await sleep(700);
  return read();
};
const settings = (patch) => inv("set_settings", { patch });
const reopen = async () => {
  await ev("location.reload()");
  await sleep(3000);
  await ev("(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.startsWith('Recover guide')); if (b) b.click(); })()");
  await until("!!document.querySelector('.gpage')");
  await sleep(2000);
};
/** Select step `i` by a click on its number. */
const selectStep = async (i) => {
  await ev(`document.querySelectorAll('article.gstep')[${i}].scrollIntoView({ block: 'center' })`);
  await sleep(500);
  await clickOn("article.gstep .badge", i);
  await sleep(400);
};
/** Write a changed copy of the open guide and open it again. */
const rewrite = async (change) => {
  const doc = await written();
  change(doc);
  await inv("doc_write", { document: doc });
  await reopen();
};

const para = (text, marks) => ({ type: "paragraph", content: [{ type: "text", text, ...(marks ? { marks } : {}) }] });
const heading = (text, level = 1) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const cell = (text, header = false) => ({ type: header ? "tableHeader" : "tableCell", content: [para(text)] });
const table = (rows, align = "start", widths = null) => ({
  type: "table",
  attrs: { align },
  content: [
    { type: "tableRow", content: ["Setting", "Value", "Note"].map((t, i) => ({ ...cell(t, true), ...(widths ? { attrs: { colwidth: [widths[i]] } } : {}) })) },
    ...Array.from({ length: rows }, (_, i) => ({ type: "tableRow", content: [cell(`Option ${i + 1}`), cell(String(i * 7)), cell("A note that is long enough to be read")] })),
  ],
});
const words = "The printer is set up in the office network and every desk reaches it over the same name. ";
const content = (id, nodes) => ({ id, type: "content", doc: { type: "doc", content: nodes } });

/** A guide with steps, texts and a long table, in a template with a cover, contents, header, footer and page numbers. */
const seed = async (steps = 8, template = {}) => {
  await inv("doc_close").catch(() => undefined);
  await inv("dev_guide_seed", { count: steps });
  await reopen();
  await rewrite((doc) => {
    doc.template = {
      id: "e2e",
      name: "E2E",
      contents: true,
      cover: { on: true, subtitle: "A subtitle", author: "Support", date: true, design: "classic", align: "auto" },
      header: { left: "title", center: "none", right: "text", texts: { left: "", center: "", right: "Internal" } },
      footer: { left: "date", center: "none", right: "page", texts: { left: "", center: "", right: "" } },
      ...template,
    };
    doc.blocks.splice(0, 0, content("intro", [heading("Before you start"), para(words.repeat(4)), table(38), para(words.repeat(3))]));
    doc.blocks.splice(4, 0, content("middle", [heading("Halfway", 2), ...Array.from({ length: 16 }, (_, i) => para(`${i + 1}. ${words.repeat(2)}`))]));
    doc.blocks[2].desc = { type: "doc", content: [para("A description under the picture. " + words)] };
  });
};

/** What the canvas shows: for every block (and part of it) the sheet it stands on. */
const canvas = () =>
  ev(`(() => {
    const column = document.querySelector('.gpage');
    const sheets = [...column.querySelectorAll('.gsheet')];
    const k = column.getBoundingClientRect().width / column.offsetWidth;
    const top = column.getBoundingClientRect().top;
    const boxes = sheets.map((s) => { const r = s.getBoundingClientRect(); return { top: (r.top - top) / k, bottom: (r.bottom - top) / k }; });
    const margin = parseFloat(getComputedStyle(sheets.at(-1).querySelector('.gsheet__in') ?? sheets.at(-1)).paddingBottom) || 0;
    const where = (el) => { const r = el.getBoundingClientRect(); const a = (r.top - top) / k; const b = (r.bottom - top) / k; const i = boxes.findIndex((s) => a >= s.top - 1 && a < s.bottom); return { sheet: i, over: i < 0 ? 0 : b - (boxes[i].bottom - margin), top: i < 0 ? 0 : a - boxes[i].top, h: b - a }; };
    const out = [];
    for (const el of column.querySelectorAll('[data-pg="title"]')) out.push({ id: 'title', ...where(el) });
    for (const el of column.querySelectorAll('[data-pg^="toc:"]')) out.push({ id: el.dataset.pg, ...where(el) });
    for (const a of column.querySelectorAll('article[data-block]')) {
      if (a.classList.contains('gstep')) out.push({ id: a.dataset.block, step: true, ...where(a) });
      else [...a.querySelector('.ProseMirror').children].filter((c) => !c.matches('.pm-gap')).forEach((c, i) => {
        if (c.matches('.tableWrapper')) { let row = 0; for (const tr of c.querySelectorAll('tbody>tr')) { if (tr.matches('.pm-gap-row,.pm-gap-head')) continue; out.push({ id: a.dataset.block + ':' + i + ':' + row++, ...where(tr) }); } }
        else out.push({ id: a.dataset.block + ':' + i, ...where(c) });
      });
    }
    return { count: sheets.length, items: out, pages: Number(column.dataset.pages), ms: Number(column.dataset.layoutMs), bars: sheets.map((s) => s.querySelector('.gsheet__in')?.textContent ?? null), bg: sheets.map((s) => !!s.querySelector('.page__bg')), heads: column.querySelectorAll('.pm-gap-head').length, tools: !!column.querySelector('.toolgrid') };
  })()`);

/** The same guide as the PDF has it (the export's own code, with the real pictures). */
const exported = () =>
  ev(`(async () => {
    const [run, paginateModule, apply] = await Promise.all([import('/src/docs/export/run.ts'), import('/src/docs/export/paginate.ts'), import('/src/docs/template/apply.ts')]);
    const all = await window.__TAURI_INTERNALS__.invoke('doc_read');
    const steps = new Map((all.steps ?? []).map((s) => [s.n, s]));
    const doc = all.document;
    const t = apply.templateOf(doc);
    const locale = { lang: 'en', rtl: false, contents: 'Contents', pagePattern: 'Page {n} of {of}', stepPattern: 'Step {n}', date: new Date().toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' }) };
    const choices = { ...run.DEFAULT_CHOICES, format: 'pdf', cover: t.cover.on, toc: t.contents, numbers: true, descriptions: true, jpeg: 0.8 };
    const data = await run.buildData({ doc, steps }, doc, choices, locale);
    const p = await paginateModule.paginate(data);
    return { count: p.pages.length, contents: p.contents, html: paginateModule.printHtml(data, p).length };
  })()`);

/** The sheet of every item by the export: unit ids are b-<block>, b-<block>+<part>, heading ids, .r<row> for rows. */
function expected(pdf, items) {
  const sheetOf = new Map();
  pdf.contents.forEach((ids, sheet) => ids.forEach((id) => sheetOf.set(id, sheet)));
  return items.map((it) => {
    if (it.id === "title") return sheetOf.get("title");
    if (it.id.startsWith("toc:")) return sheetOf.get(it.id === "toc:0" ? "toc" : `toc-${Number(it.id.slice(4)) - 1}`);
    const [block, part, row] = it.id.split(":");
    if (part === undefined) return sheetOf.get(`b-${block}`);
    const ids = Number(part) === 0 ? [`b-${block}`, `b-${block}-0`] : [`b-${block}+${part}`, `b-${block}-${part}`];
    const base = ids.find((id) => sheetOf.has(id));
    if (row === undefined || Number(row) === 0) return sheetOf.get(base);
    // (rows held together by a span have their group's sheet)
    for (let r = Number(row); r > 0; r--) if (sheetOf.has(`${base}.r${r}`)) return sheetOf.get(`${base}.r${r}`);
    return sheetOf.get(base);
  });
}

const compare = async (name) => {
  const c = await canvas();
  const pdf = await exported();
  const want = expected(pdf, c.items);
  const wrong = c.items.map((it, i) => ({ id: it.id, canvas: it.sheet, pdf: want[i] })).filter((x) => x.canvas !== x.pdf);
  check(c.count === pdf.count, `${name}: as many sheets as the PDF has pages`, `${c.count} / ${pdf.count}`);
  check(wrong.length === 0, `${name}: every block, paragraph and table row on the same page as in the PDF (${c.items.length})`, JSON.stringify(wrong.slice(0, 8)));
  const over = c.items.filter((x) => x.over > 2);
  check(over.length === 0, `${name}: nothing reaches into the bottom margin`, JSON.stringify(over.slice(0, 6)));
  return { c, pdf };
};

await size(1366, 900);
await settings({ captureKind: "documents", language: "en", docZoom: 100, docFit: "auto", docPageWidth: "normal", docPanelWidth: 300, docPanelCollapsed: false, docTemplate: "basic" });
const run = (name) => only.length === 0 || only.includes(name);

if (run("pages")) {
  await seed();
  await shot("c4-canvas.png");
  const { c } = await compare("A4 with cover and contents");
  check(c.bars[0] === null && c.bars.slice(1).every((t, i) => t.includes("Internal") && t.includes(`Page ${i + 1} of ${c.count - 1}`)), "header, footer and page numbers on every sheet after the cover", JSON.stringify(c.bars.slice(1, 3)));
  check(c.heads >= 1, "a table that goes on shows its header row again", String(c.heads));
  check(c.items.filter((x) => x.step).every((x) => x.over <= 2), "no step is split");
  console.log("INFO  layout took", c.ms, "ms for", c.count, "sheets");
}

/** Bring a sheet to the top of the view. */
const toSheet = async (i, offset = -8) => {
  await ev(`(() => { const l = document.querySelector('.glist'); const s = document.querySelectorAll('.gsheet')[${i}]; l.scrollTop += s.getBoundingClientRect().top - l.getBoundingClientRect().top + ${offset}; })()`);
  await sleep(600);
};

if (run("shots")) {
  await settings({ docFit: "page" });
  await sleep(1200);
  for (const i of [0, 1, 2, 3, 4]) {
    await toSheet(i);
    await shot(`c4-sheet-${i}.png`);
  }
  await settings({ docFit: "auto" });
  await sleep(1000);
  await toSheet(3, 520);
  await shot("c4-page-break.png");
  await ev("document.querySelector('article.gstep .gstep__head').scrollIntoView({ block: 'center' })");
  await sleep(500);
  await clickOn("article.gstep .badge", 0);
  await sleep(700);
  await shot("c4-selected.png");
  await key("Escape", 27);
}

// --- the tools, editing on the pages ------------------------------------------------------------------------------------------------
if (run("edit")) {
  await seed(8);
  const tops = () => ev("(() => { const c = document.querySelector('.gpage'); return [...c.querySelectorAll('.gsheet')].length + '|' + [...c.querySelectorAll('article[data-block]')].map((a) => { let y = 0; for (let e = a; e && e !== c; e = e.offsetParent) y += e.offsetTop; return Math.round(y); }).join(); })()");
  await ev("document.querySelectorAll('article.gstep')[1].scrollIntoView({ block: 'center' })");
  await sleep(500);
  const before = (await tops()).split("|");
  const head = await rect("article.gstep .gstep__head", 1);
  await clickOn("article.gstep .badge", 1);
  await sleep(700);
  const grid = await ev("document.querySelectorAll('#gpanel-step .toolgrid [data-tool]:not(:disabled)').length");
  check(grid > 12, "selecting a step switches on the tool grid of the Step tab", String(grid));
  check(Math.abs((await rect("article.gstep .gstep__head", 1)).y - head.y) < 1.5, "selecting does not move the clicked step");
  const after = (await tops()).split("|");
  const [a, b] = [before[1].split(",").map(Number), after[1].split(",").map(Number)];
  const moved = a.map((v, i) => b[i] - v).filter((d) => Math.abs(d) > 1);
  check(before[0] === after[0] && moved.length === 0, "the pages stay: selecting a step moves nothing", JSON.stringify(a.map((v, i) => b[i] - v)));
  await shot("c4-tools.png");
  await ev("document.querySelector('#gpanel-step .toolgrid [aria-label=\"Color\"], #gpanel-step .toolgrid [aria-label=\"Colour\"]').click()");
  await sleep(500);
  const pop = await ev(`(() => { const b = document.querySelector('#gpanel-step .toolgrid [aria-expanded="true"]').getBoundingClientRect(); const p = document.querySelector('.pop__panel'); if (!p) return null; const r = p.getBoundingClientRect(); const top = document.elementFromPoint(r.x + 20, r.y + 20); return { dx: Math.abs(r.x - b.x), dy: Math.min(Math.abs(r.y - b.bottom), Math.abs(b.y - r.bottom)), onTop: !!top?.closest('.pop__panel') }; })()`);
  check(!!pop && pop.dx < 320 && pop.dy < 20 && pop.onTop, "a menu of the grid opens at its button and on top", JSON.stringify(pop));
  await ev("document.querySelector('.pop__panel button')?.click()");
  await sleep(300);
  check(await ev("!!document.querySelector('.gstep.gblock--sel')"), "using the menu keeps the step selected");
  await key("Escape", 27);
  await sleep(300);
  await key("Escape", 27);
  await sleep(600);
  check((await tops()) === before.join("|"), "taking the selection away puts everything back");

  // typing in a text block moves the pages along, and undo brings them back
  const count = () => ev("document.querySelectorAll('.gsheet').length");
  const was = await count();
  await ev("(() => { const p = document.querySelector('article.gcontent .ProseMirror > p'); p.scrollIntoView({ block: 'center' }); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); p.closest('.ProseMirror').focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()");
  await sleep(300);
  const caret = () => ev("(() => { const s = getSelection(); const r = s.getRangeAt(0).getClientRects()[0] ?? s.anchorNode.parentElement.getBoundingClientRect(); return r.y; })()");
  const y = await caret();
  for (let i = 0; i < 30; i++) {
    await send("Input.insertText", { text: "And another sentence about the printer in the office. " });
    if (i % 5 === 4) await sleep(150);
  }
  await sleep(1500);
  check(Math.abs((await caret()) - y) < 500, "the view stays with what is being written", `${y} -> ${await caret()}`);
  await compare("after typing");
  for (let i = 0; i < 40; i++) {
    await key("Enter", 13);
  }
  await sleep(1500);
  const grown = await count();
  check(grown > was, "more text gives more pages", `${was} -> ${grown}`);
  await compare("after new paragraphs");
  await ev("document.activeElement.blur()");
  await sleep(600);
  await ev("(() => { const b = document.querySelector('.headrow [aria-label=\"Undo\"]'); for (let i = 0; i < 80; i++) b.click(); })()");
  await sleep(1800);
  // inserting a block by the "+" between blocks
  const blocks = (await written()).blocks.length;
  await ev("document.querySelectorAll('.ginsert__plus')[2].click()");
  await sleep(300);
  await ev("[...document.querySelectorAll('.ginsert__item')].find((b) => b.textContent === 'Text block').click()");
  await sleep(900);
  check((await written()).blocks.length === blocks + 1, "the '+' between blocks inserts on the page");
}

// --- the live look of the template ----------------------------------------------------------------------------------------------
if (run("style")) {
  await seed(4);
  const look = () =>
    ev(`(() => { const q = (s) => document.querySelector('.gpage ' + s); const cs = (s) => getComputedStyle(q(s)); return { step: parseFloat(cs('article.gstep .step__text .ProseMirror p').fontSize), body: parseFloat(cs('article.gcontent .ProseMirror > p').fontSize), headFont: cs('article.gcontent .ProseMirror h1').fontFamily.split(',')[0], head: parseFloat(cs('article.gcontent .ProseMirror h1').fontSize), badge: cs('article.gstep .badge').borderRadius, badgeBg: cs('article.gstep .badge').backgroundColor, border: cs('article.gstep .gpic').borderTopWidth, radius: cs('article.gstep .gpic').borderTopLeftRadius, shadow: cs('article.gstep .gpic').boxShadow !== 'none', picW: Math.round(q('article.gstep .gpic').offsetWidth), gap: cs('article.gstep').marginBottom, th: cs('article.gcontent th').backgroundColor, desc: cs('article.gstep .step__desc').backgroundColor, table: (() => { const t = q('article.gcontent table'); const w = t.closest('.tableWrapper'); return { left: Math.round(t.offsetLeft), w: t.offsetWidth, of: w.offsetWidth }; })() }; })()`);
  const change = async (fn) => {
    const doc = await written();
    fn(doc.template, doc);
    await inv("doc_write", { document: doc });
    await reopen();
    return look();
  };
  const a = await look();
  const b = await change((t, doc) => {
    doc.badge = "square";
    t.fonts = { heading: "Cambria", body: "Calibri", size: 13, headingSize: 30 };
    t.steps = { textScale: 1.4, badge: "square", badgeBg: "#0F7B4F", spacing: 40, description: "boxed" };
    t.picture = { borderColor: "#1F3A5F", borderWidth: 4, radius: 14, shadow: true };
    t.frame = { ratio: "4:3", maxWidth: 70 };
    t.table = { header: "main", borders: true, zebra: true };
  });
  check(Math.abs(b.body - 13 * (96 / 72)) < 0.1 && Math.abs(b.step - 13 * 1.4 * (96 / 72)) < 0.1, "text and step text have the sizes of the template in pt", `${a.step} -> ${b.step}, body ${b.body}`);
  check(b.headFont.includes("Cambria") && Math.abs(b.head - 40) < 0.1, "heading font and size", `${b.headFont} ${b.head}`);
  check(b.badge === "4px" && b.badgeBg === "rgb(15, 123, 79)", "step number style and colour", `${b.badge} ${b.badgeBg}`);
  check(b.border === "4px" && b.radius === "14px" && b.shadow, "picture border, radius and shadow", JSON.stringify([b.border, b.radius, b.shadow]));
  check(b.picW < a.picW * 0.75 && b.gap === "40px", "picture width of the frame and the space between steps", `${a.picW} -> ${b.picW}, ${b.gap}`);
  check(b.th !== a.th && b.desc !== a.desc, "table style and description style", `${b.th} ${b.desc}`);
  await compare("another template");
  await shot("c4-style.png");
  for (const align of ["center", "end", "start"]) {
    const l = await change((t, doc) => {
      doc.blocks[0].doc.content.find((x) => x.type === "table").attrs.align = align;
    });
    const free = l.table.of - l.table.w;
    const want = align === "center" ? free / 2 : align === "end" ? free : 0;
    check(Math.abs(l.table.left - want) <= 2 && (align === "start" || free > 100), `table aligned ${align} on the page`, JSON.stringify(l.table));
    const html = await ev(`(async () => { const [run, p, apply] = await Promise.all([import('/src/docs/export/run.ts'), import('/src/docs/export/paginate.ts'), import('/src/docs/template/apply.ts')]); const all = await window.__TAURI_INTERNALS__.invoke('doc_read'); const steps = new Map(all.steps.map((s) => [s.n, s])); const data = await run.buildData({ doc: all.document, steps }, all.document, { ...run.DEFAULT_CHOICES, cover: true, toc: true }, { lang: 'en', rtl: false, contents: 'Contents', pagePattern: 'Page {n} of {of}', stepPattern: 'Step {n}', date: 'today' }); const doc = await p.paginate(data); const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;left:-9000px;width:900px;height:900px'; await new Promise((r) => { f.onload = r; f.srcdoc = p.printHtml(data, doc); document.body.appendChild(f); }); const t = f.contentDocument.querySelector('table'); const box = t.parentElement; const out = { left: Math.round(t.getBoundingClientRect().left - box.getBoundingClientRect().left), w: Math.round(t.getBoundingClientRect().width), of: Math.round(box.getBoundingClientRect().width) }; f.remove(); return out; })()`);
    check(Math.abs(html.left - (align === "center" ? (html.of - html.w) / 2 : align === "end" ? html.of - html.w : 0)) <= 2 && Math.abs(html.w - l.table.w) <= 2, `table aligned ${align} in preview, print and PDF, as wide as in the editor`, JSON.stringify(html));
  }
}

// --- cover and contents designs ----------------------------------------------------------------------------------------------------
/** A picture drawn here: a wide gradient with a frame, so that its place on a page shows. */
const picture = (w, h, from, to, label) =>
  ev(`(async () => { const c = document.createElement('canvas'); c.width = ${w}; c.height = ${h}; const g = c.getContext('2d'); const f = g.createLinearGradient(0, 0, ${w}, ${h}); f.addColorStop(0, '${from}'); f.addColorStop(1, '${to}'); g.fillStyle = f; g.fillRect(0, 0, ${w}, ${h}); g.strokeStyle = '#FFD54F'; g.lineWidth = 24; g.strokeRect(12, 12, ${w} - 24, ${h} - 24); g.fillStyle = '#FFFFFF'; g.font = 'bold ${Math.round(h / 5)}px Segoe UI'; g.fillText('${label}', 60, ${h} - 60); return (await window.__TAURI_INTERNALS__.invoke('doc_add_image', { base64Data: c.toDataURL('image/png').split(',')[1] })).name; })()`);

/** Where the parts of the cover stand on page 1, in pixels of the page. */
const coverParts = (scope) => `(() => { const root = ${scope}; const page = root.querySelector('.cover'); const base = page.getBoundingClientRect(); const k = base.width / page.offsetWidth; const at = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round((r.left - base.left) / k), Math.round((r.top - base.top) / k), Math.round(r.width / k), Math.round(r.height / k)]; }; const q = (s) => at(page.querySelector(s)); const title = page.querySelector('.cover__title p, .cover__title .ProseMirror p'); const range = page.ownerDocument.createRange(); range.selectNodeContents(title); const t = range.getBoundingClientRect(); const date = page.querySelectorAll('.cover__text'); const last = date[date.length - 1]?.querySelector('p'); let d = null; if (last) { const r2 = page.ownerDocument.createRange(); r2.selectNodeContents(last); const x = r2.getBoundingClientRect(); d = [Math.round((x.left - base.left) / k), Math.round((x.top - base.top) / k)]; } return { page: [Math.round(base.width / k), Math.round(base.height / k)], title: [Math.round((t.left - base.left) / k), Math.round((t.top - base.top) / k)], date: d, logo: q('.cover__logo'), art: q('.cover__art'), classes: page.className }; })()`;
const onCanvas = () => ev(coverParts("document.querySelector('.gpage')"));
const openPreview = async () => {
  await ev("document.querySelector('.gbar__preview').click()");
  await until("!!document.querySelector('iframe.pageview')?.contentDocument?.querySelector('.page')", 30000);
  await sleep(800);
};
const closePreview = async () => {
  await ev("document.querySelector('.gbar__preview').click()");
  await sleep(600);
};
const inPreview = () => ev(coverParts("document.querySelector('iframe.pageview').contentDocument"));
const close = (a, b, d = 3) => !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) <= d);

if (run("designs")) {
  await seed(3);
  const background = await picture(1600, 1000, "#0D47A1", "#26A69A", "BACKGROUND");
  const logo = await picture(300, 100, "#6A1B9A", "#EF6C00", "LOGO");
  await settings({ docFit: "page" });
  const set = (cover, more = {}) =>
    rewrite((doc) => {
      doc.template = { ...doc.template, logo, ...more, cover: { ...doc.template.cover, image: background, logo: true, title: "Printer guide", dateText: "25 November 2026", ...cover } };
    });
  for (const design of ["classic", "band", "banner", "image", "minimal", "split"]) {
    await set({ design, align: "auto", vertical: "auto" }, { background: { apply: "cover", size: "fill", opacity: design === "classic" || design === "minimal" || design === "banner" || design === "band" ? 25 : 100 } });
    await toSheet(0);
    const c = await onCanvas();
    await shot(`c4-cover-${design}.png`);
    await openPreview();
    const p = await inPreview();
    await shot(`c4-cover-${design}-preview.png`);
    await closePreview();
    check(close(c.page, p.page, 2) && close(c.title, p.title) && close(c.date, p.date) && close(c.logo, p.logo) && (c.art === p.art || close(c.art, p.art)), `cover "${design}": the same on the canvas and in the preview`, JSON.stringify({ c, p }));
    check(c.logo[1] < c.title[1], `cover "${design}": the logo stands above the title`, JSON.stringify([c.logo, c.title]));
  }
  await set({ design: "classic", align: "auto", vertical: "auto" });
  const centred = await onCanvas();
  const mid = centred.page[0] / 2;
  check(Math.abs(centred.logo[0] + centred.logo[2] / 2 - mid) <= 2, "Classic: the logo is centred", JSON.stringify(centred.logo));
  const places = {};
  for (const vertical of ["top", "center", "bottom"]) {
    await set({ vertical });
    places[vertical] = (await onCanvas()).title[1];
  }
  check(places.top < places.center && places.center < places.bottom, "the texts stand at the top, the middle or the bottom", JSON.stringify(places));
  await set({ vertical: "auto", align: "start", dateAlign: "center", logoPlace: "top", logoAlign: "end", logoSize: 60 });
  const mixed = await onCanvas();
  check(mixed.title[0] <= 50 && mixed.date[0] > mid - 140 && mixed.date[0] < mid, "title at the start, the date centred on its own", JSON.stringify(mixed));
  check(mixed.logo[1] === 32 && Math.abs(mixed.logo[0] + mixed.logo[2] - (mixed.page[0] - 32)) <= 2 && mixed.logo[3] === 60, "logo in the top corner, at the end, in its size", JSON.stringify(mixed.logo));
  await set({ logoPlace: "bottom", logoAlign: "center" });
  const low = await onCanvas();
  check(low.logo[1] + low.logo[3] >= low.page[1] - 35 && Math.abs(low.logo[0] + low.logo[2] / 2 - mid) <= 2, "logo in the bottom corner, centred", JSON.stringify(low.logo));
  // the date centred by the paragraph toolbar of the cover itself (no setting)
  await set({ align: "start", dateAlign: "auto", logoPlace: "title", logoAlign: "auto" });
  const dateLine = await rect(".gcover__text--dateText .ProseMirror p");
  await press(dateLine.x + 20, dateLine.y + dateLine.h / 2);
  await sleep(600);
  const had = (await onCanvas()).date[0];
  await ev("document.querySelector('.gcover__text--dateText .rich__bar [aria-label=\"Centre\"]').click()");
  await sleep(900);
  const centredDate = (await onCanvas()).date[0];
  check(centredDate > had + 150, "the date can be centred on the cover itself", `${had} -> ${centredDate}`);
  // right to left: the band is mirrored
  await set({ design: "band", align: "auto" });
  const ltr = await ev("getComputedStyle(document.querySelector('.gpage .cover'), '::after').left");
  await settings({ language: "ar" });
  await sleep(2500);
  const rtl = await ev("(() => { const s = getComputedStyle(document.querySelector('.gpage .cover'), '::after'); return { left: s.left, right: s.right, dir: document.documentElement.dir }; })()");
  await toSheet(0);
  await shot("c4-cover-band-rtl.png");
  check(ltr === "0px" && rtl.dir === "rtl" && rtl.right === "0px" && rtl.left !== "0px", "right to left: the side band is on the right", JSON.stringify([ltr, rtl]));
  const c = await canvas();
  check(c.items.every((x) => x.sheet >= 0 && x.over <= 2) && c.bars[1]?.includes("Internal"), "right to left: the pages hold their blocks, header and footer", String(c.count));
  await settings({ language: "en" });
  await sleep(2000);

  // the table of contents
  const toc = () => ev(`(() => { const parts = [...document.querySelectorAll('.gpage [data-pg^="toc:"] nav')]; const first = parts[1]?.querySelector('li'); const num = first?.querySelector('.toc__num'); const a = first?.querySelector('a'); const lead = first?.querySelector('.toc__lead'); return { classes: parts[0]?.className, title: parts[0]?.querySelector('h2')?.textContent, entries: parts.length - 1, num: !!num, gap: num && a ? Math.round(num.getBoundingClientRect().left - a.getBoundingClientRect().right) : null, lead: lead ? getComputedStyle(lead).borderBottomStyle + ' ' + getComputedStyle(lead).display : null, size: a ? parseFloat(getComputedStyle(a).fontSize) : 0 }; })()`);
  const setToc = (more) => rewrite((doc) => (doc.template = { ...doc.template, toc: { ...doc.template.toc, ...more } }));
  for (const [style, leader] of [["classic", "dots"], ["modern", "dashes"], ["formal", "line"], ["simple", "none"]]) {
    await setToc({ style, leader, numbers: true, right: true, title: "", size: 0, spacing: 1.5, steps: true, headings: true });
    await toSheet(1);
    await shot(`c4-toc-${style}.png`);
    const t = await toc();
    const want = { dots: "dotted", dashes: "dashed", line: "solid", none: "none" }[leader];
    check(t.classes.includes(`toc--${style}`) && t.lead.startsWith(want) && t.num && t.gap > 100, `contents "${style}" with leader "${leader}"`, JSON.stringify(t));
  }
  const full = (await toc()).entries;
  await setToc({ right: false, title: "What is inside", size: 14, headings: false });
  let t = await toc();
  check(t.gap < 20 && t.title === "What is inside" && Math.abs(t.size - 14 * (96 / 72)) < 0.1 && t.entries < full, "own title and size, numbers after the entry, without headings", JSON.stringify(t));
  await setToc({ numbers: false, headings: true, steps: false });
  t = await toc();
  check(!t.num && t.entries === 2, "without page numbers, headings only", JSON.stringify(t));
  await compare("contents of headings only");
  const word = await ev(`(async () => { const [run, docx, apply, zip] = await Promise.all([import('/src/docs/export/run.ts'), import('/src/docs/export/docx.ts'), import('/src/docs/template/apply.ts'), import('/node_modules/.vite/deps/fflate.js').catch(() => null)]); const all = await window.__TAURI_INTERNALS__.invoke('doc_read'); const steps = new Map(all.steps.map((s) => [s.n, s])); const out = {}; for (const design of ['classic','band','banner','image','minimal','split']) { const doc = { ...all.document, template: { ...all.document.template, cover: { ...all.document.template.cover, design } } }; const data = await run.buildData({ doc, steps }, doc, { ...run.DEFAULT_CHOICES, format: 'docx', cover: true, toc: true }, { lang: 'en', rtl: false, contents: 'Contents', pagePattern: 'Page {n} of {of}', stepPattern: 'Step {n}', date: 'today' }); const b64 = await docx.exportDocx(data, { pagePattern: 'Page {n} of {of}' }); out[design] = b64.length; await window.__TAURI_INTERNALS__.invoke('export_write', { path: ${JSON.stringify(folder)} + '/cover-' + design + '.docx', base64: b64 }); } return out; })()`);
  check(Object.keys(word).length === 6, "Word files of all six designs are written", JSON.stringify(word));
  await settings({ docFit: "auto" });
}

// --- print preview, print, zoom ---------------------------------------------------------------------------------------------------
if (run("preview")) {
  await seed(6);
  await ev("document.querySelectorAll('article.gstep')[3].scrollIntoView({ block: 'start' })");
  await sleep(600);
  const at = await ev("document.querySelector('.glist').scrollTop");
  await openPreview();
  const pv = await ev("(() => { const d = document.querySelector('iframe.pageview').contentDocument; return { pages: d.querySelectorAll('.page').length, scripts: d.querySelectorAll('script').length, print: !!document.querySelector('.gbar__print'), title: document.querySelector('.gbar__preview').textContent }; })()");
  const sheets = await ev("document.querySelectorAll('.gsheet').length");
  check(pv.pages === sheets && pv.scripts === 0 && pv.print && pv.title === "Print preview", "Print preview: as many pages as the editor has, with a Print button", JSON.stringify({ ...pv, sheets }));
  await shot("c4-preview.png");
  // printing is caught before the dialog: what would be printed is looked at
  await ev(`(() => { window.__printed = []; new MutationObserver((list) => { for (const m of list) for (const node of m.addedNodes) if (node.classList?.contains('printframe')) node.addEventListener('load', () => { node.contentWindow.print = () => { const d = node.contentDocument; window.__printed.push({ pages: d.querySelectorAll('.page').length, size: /@page\\{size:([0-9.]+)mm ([0-9.]+)mm;margin:0\\}/.exec(d.querySelector('style').textContent)?.slice(1), sandbox: node.getAttribute('sandbox'), bars: d.querySelectorAll('.page__slot').length }); }; }); }).observe(document.body, { childList: true }); })()`);
  await ev("document.querySelector('.gbar__print').click()");
  await until("window.__printed.length === 1");
  const printed = await ev("window.__printed[0]");
  check(printed.pages === sheets && printed.size.join() === "210,297" && printed.bars === 2 * (sheets - 1), "Print… sends the same pages to the print dialog, with the paper of the template, header and footer", JSON.stringify(printed));
  await closePreview();
  await sleep(500);
  check(Math.abs((await ev("document.querySelector('.glist').scrollTop")) - at) <= 2, "closing the preview comes back to the same place", String(at));
  await rewrite((doc) => (doc.template = { ...doc.template, page: { size: "letter", orientation: "landscape", margin: 20 } }));
  await ev("(() => { window.__printed = []; new MutationObserver((list) => { for (const m of list) for (const node of m.addedNodes) if (node.classList?.contains('printframe')) node.addEventListener('load', () => { node.contentWindow.print = () => window.__printed.push(/@page\\{size:([0-9.]+)mm ([0-9.]+)mm/.exec(node.contentDocument.querySelector('style').textContent).slice(1).join()); }); }).observe(document.body, { childList: true }); })()");
  await key("p", 80, 2);
  await until("window.__printed.length === 1");
  check((await ev("window.__printed[0]")) === "279.4,215.9", "Ctrl+P prints too, Letter landscape", await ev("window.__printed[0]"));
  await compare("Letter landscape");
  // zoom
  const state = () => ev("(() => { const c = document.querySelector('.gpage'); const l = document.querySelector('.glist'); const r = c.getBoundingClientRect(); return { k: r.width / c.offsetWidth, w: r.width, room: l.clientWidth, pageH: document.querySelector('.gsheet').getBoundingClientRect().height, h: l.clientHeight, select: document.querySelector('.gzoom__fit').value, label: document.querySelector('.gzoom__fit').selectedOptions[0].textContent, sideways: l.scrollWidth > l.clientWidth + 1 }; })()");
  const choose = async (v) => {
    await ev(`(() => { const s = document.querySelector('.gzoom__fit'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '${v}'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await sleep(900);
    return state();
  };
  let z = await choose("width");
  check(Math.abs(z.room - z.w - 28) <= 3, "Fit page width", JSON.stringify(z));
  z = await choose("page");
  // (the room under the page keeps it clear of the zoom control)
  check(z.pageH <= z.h && z.pageH > z.h - 130, "Whole page", JSON.stringify(z));
  z = await choose("100");
  check(Math.abs(z.k - 1) < 0.001 && z.label === "100%", "100%", JSON.stringify(z));
  for (let i = 0; i < 14; i++) await mouse("mouseWheel", 400, 500, { deltaX: 0, deltaY: -120, modifiers: 2, button: "none" });
  await sleep(1200);
  z = await state();
  check(Math.abs(z.k - 2) < 0.001 && z.sideways, "Ctrl+wheel zooms to 200%, where the page scrolls sideways", JSON.stringify(z));
  for (let i = 0; i < 20; i++) await mouse("mouseWheel", 400, 500, { deltaX: 0, deltaY: 120, modifiers: 2, button: "none" });
  await sleep(1200);
  z = await state();
  check(Math.abs(z.k - 0.5) < 0.001, "and down to 50%", JSON.stringify(z));
  await compare("at 50%");
  await choose("100");
  await settings({ docFit: "auto" });
  // the free canvas of a template without pages keeps its widths
  await rewrite((doc) => (doc.template = { ...doc.template, page: { size: "screen", orientation: "portrait", margin: 16 } }));
  const screen = await ev("({ sheets: document.querySelectorAll('.gsheet').length, width: !!document.querySelector('.gzoom__width'), fit: !!document.querySelector('.gzoom__fit'), max: getComputedStyle(document.querySelector('.gpage')).maxWidth })");
  check(screen.sheets === 0 && screen.width && !screen.fit && screen.max === "920px", "without a page size: the free canvas with Narrow, Normal, Wide", JSON.stringify(screen));
  await shot("c4-screen.png");
  // no step of a guide is shown as higher than a page: a tall one is scaled as in print
  await rewrite((doc) => {
    doc.template = { ...doc.template, page: { size: "a4", orientation: "landscape", margin: 30 }, steps: { ...doc.template.steps, textScale: 1 } };
    doc.blocks.find((b) => b.type === "step").desc = { type: "doc", content: Array.from({ length: 12 }, () => para(words)) };
  });
  const tall = await ev("(() => { const a = document.querySelector('article.gstep'); return { zoom: a.style.zoom, w: Math.round(a.getBoundingClientRect().width), page: Math.round(document.querySelector('.gflow').getBoundingClientRect().width) }; })()");
  check(Number(tall.zoom) > 0 && Number(tall.zoom) < 1 && Math.abs(tall.w - tall.page * Number(tall.zoom)) <= 3, "a step higher than a page is scaled down to fit it", JSON.stringify(tall));
  await compare("a tall step");
  // the PDF's sheet holds it too
  const fits = await ev(`(async () => { const [run, p] = await Promise.all([import('/src/docs/export/run.ts'), import('/src/docs/export/paginate.ts')]); const all = await window.__TAURI_INTERNALS__.invoke('doc_read'); const steps = new Map(all.steps.map((s) => [s.n, s])); const data = await run.buildData({ doc: all.document, steps }, all.document, { ...run.DEFAULT_CHOICES, cover: true, toc: true }, { lang: 'en', rtl: false, contents: 'Contents', pagePattern: 'Page {n} of {of}', stepPattern: 'Step {n}', date: 'today' }); const pages = await p.paginate(data); const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;left:-9000px;width:1600px;height:900px'; await new Promise((r) => { f.onload = r; f.srcdoc = p.printHtml(data, pages); document.body.appendChild(f); }); await Promise.all([...f.contentDocument.images].map((i) => i.decode().catch(() => 0))); const out = [...f.contentDocument.querySelectorAll('.page__body')].map((b) => Math.round(b.scrollHeight - b.clientHeight)).filter((v) => v > 2); f.remove(); return out; })()`);
  check(fits.length === 0, "no page of the print document holds more than fits it", JSON.stringify(fits));
  // scrolling through the pages moves nothing
  const map = () => ev("(() => { const c = document.querySelector('.gpage'); return [...c.querySelectorAll('article[data-block], .gsheet')].map((a) => { let y = 0; for (let e = a; e && e !== c; e = e.offsetParent) y += e.offsetTop; return Math.round(y) + ':' + a.offsetHeight; }).join(); })()");
  await ev("(() => { document.querySelector('.glist').scrollTop = 0; window.__shifts = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__shifts += e.value; }).observe({ type: 'layout-shift', buffered: false }); })()");
  await sleep(500);
  const still = await map();
  for (let i = 0; i < 40; i++) {
    await ev("document.querySelector('.glist').scrollTop += 420");
    await sleep(60);
  }
  await sleep(600);
  check((await map()) === still && (await ev("window.__shifts")) < 0.001, "no layout shift while scrolling", String(await ev("window.__shifts")));
}

// --- the same sizes and the same background on the canvas, in the preview and in the PDF ------------------------------------------
if (run("same")) {
  await seed(2);
  const background = await picture(1600, 1000, "#0D47A1", "#26A69A", "BACKGROUND");
  await rewrite((doc) => {
    doc.template = { ...doc.template, steps: { ...doc.template.steps, textScale: 1.2 }, cover: { ...doc.template.cover, image: background, title: "Printer guide" }, background: { apply: "all", size: "fill", opacity: 35, x: "center", y: "center" } };
  });
  await settings({ docFit: "page" });
  await sleep(1200);
  const sizes = (scope) => `(() => { const d = ${scope}; const page = d.querySelectorAll('.page, .gsheet')[3]; const step = d.querySelector('.step .step__head p'); const r = step.ownerDocument.defaultView.getComputedStyle(step); const bg = d.querySelector('.page__bg'); const b = bg.getBoundingClientRect(); const s = bg.closest('.page, .gsheet').getBoundingClientRect(); return { stepPx: parseFloat(r.fontSize), bg: [Math.round(100 * (b.left - s.left) / s.width), Math.round(100 * (b.top - s.top) / s.height), Math.round(100 * b.width / s.width), Math.round(100 * b.height / s.height)], size: bg.ownerDocument.defaultView.getComputedStyle(bg).backgroundSize, page: Math.round(s.height / s.width * 1000) }; })()`;
  await toSheet(2);
  const a = await ev(sizes("document.querySelector('.gpage')"));
  await shot("c4-same-canvas.png");
  await openPreview();
  await ev("(() => { const f = document.querySelector('iframe.pageview'); f.contentDocument.querySelectorAll('.page')[2].scrollIntoView(); })()");
  await sleep(800);
  const b = await ev(sizes("document.querySelector('iframe.pageview').contentDocument"));
  await shot("c4-same-preview.png");
  await closePreview();
  const pt = 11 * 1.2 * (96 / 72);
  check(Math.abs(a.stepPx - pt) < 0.05 && Math.abs(b.stepPx - pt) < 0.05, "step text: the same size on the canvas and in the preview, as set (pt at 96 per inch)", `${a.stepPx} ${b.stepPx} ${pt.toFixed(2)}`);
  check(a.bg.join() === "0,0,100,100" && b.bg.join() === "0,0,100,100" && a.size === "cover" && b.size === "cover" && Math.abs(a.page - b.page) <= 2, "background 'Fill' covers the whole page in both", JSON.stringify([a, b]));
  await ev(`(async () => { const [run, p] = await Promise.all([import('/src/docs/export/run.ts'), import('/src/docs/export/paginate.ts')]); const all = await window.__TAURI_INTERNALS__.invoke('doc_read'); const steps = new Map(all.steps.map((s) => [s.n, s])); const date = new Date().toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' }); const data = await run.buildData({ doc: all.document, steps }, all.document, { ...run.DEFAULT_CHOICES, format: 'pdf', cover: true, toc: true, jpeg: 0.92 }, { lang: 'en', rtl: false, contents: 'Contents', pagePattern: 'Page {n} of {of}', stepPattern: 'Step {n}', date }); const pages = await p.paginate(data); await window.__TAURI_INTERNALS__.invoke('export_pdf', { html: p.printHtml(data, pages), path: ${JSON.stringify(folder + "/same.pdf")}, widthMm: pages.box.w, heightMm: pages.box.h }); window.__pdfPages = pages.pages.length; })()`);
  console.log("INFO  PDF written with", await ev("window.__pdfPages"), "pages:", folder + "/same.pdf");
  await settings({ docFit: "auto" });
}

// --- typing and settings in a long guide -------------------------------------------------------------------------------------------
if (run("speed")) {
  await inv("doc_close").catch(() => undefined);
  await inv("dev_guide_seed", { count: 150 });
  await reopen();
  await rewrite((doc) => {
    doc.template = { id: "e2e", name: "E2E", contents: true, cover: { on: true }, header: { left: "title" }, footer: { right: "page" } };
    for (let i = 30; i > 0; i--) doc.blocks.splice(i * 5 - 1, 0, content(`t${i}`, [heading(`Part ${i}`, 2), para(words.repeat(2)), ...(i % 6 === 0 ? [table(6)] : []), para(words)]));
  });
  await until("document.querySelectorAll('.gsheet').length > 50", 120000);
  await sleep(4000);
  const c = await canvas();
  console.log("INFO  long guide:", c.count, "sheets;", await ev("document.querySelectorAll('article.gstep').length"), "steps,", await ev("document.querySelectorAll('article.gcontent').length"), "texts; first layout", c.ms, "ms");
  const typing = async (selector, i, label) => {
    await ev(`(() => { const p = document.querySelectorAll(${JSON.stringify(selector)})[${i}]; p.scrollIntoView({ block: 'center' }); const pm = p.closest('.ProseMirror'); pm.focus(); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); window.__key = []; window.__long = []; if (!window.__timed) { window.__timed = true; document.addEventListener('beforeinput', () => { const from = performance.now(); requestAnimationFrame(() => { const painted = new MessageChannel(); painted.port1.onmessage = () => window.__key.push(performance.now() - from); painted.port2.postMessage(0); }); }, true); new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask' }); } })()`);
    await sleep(1500);
    await ev("window.__key = []; window.__long = []");
    const text = "the quick brown fox jumps over the lazy dog and prints a page of it ";
    for (let k = 0; k < 120; k++) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: text[k % text.length], text: text[k % text.length], unmodifiedText: text[k % text.length] });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: text[k % text.length] });
      await sleep(70);
    }
    await sleep(2000);
    const r = await ev("(() => { const k = [...window.__key].sort((a, b) => a - b); return { n: k.length, median: +k[Math.floor(k.length / 2)].toFixed(1), p95: +k[Math.floor(k.length * 0.95)].toFixed(1), max: +k[k.length - 1].toFixed(1), long: window.__long.slice().sort((a, b) => b - a).slice(0, 6), longCount: window.__long.length }; })()");
    console.log(`INFO  typing ${label}: key to next frame, ms`, JSON.stringify(r));
    return r;
  };
  const inText = await typing("article.gcontent .ProseMirror > p", 20, "in a text block in the middle");
  const inStep = await typing("article.gstep .step__text .ProseMirror p", 75, "in a step's text");
  check(inText.median < 30 && inStep.median < 30, "typing in 150 steps and 30 texts: half of the keys are on screen within 30 ms", `${inText.median} / ${inStep.median}`);
  // a setting change: from the change in the sidebar until the pages are laid out and placed anew
  await ev("(() => { document.querySelector('.glist').scrollTop = 0; document.querySelector('[data-tab=\"guide\"]').click(); document.querySelectorAll('#gpanel-guide details').forEach((d) => (d.open = true)); })()");
  await sleep(1500);
  const setting = (label, value) =>
    ev(`new Promise((resolve) => { const i = document.querySelector('#gpanel-guide input[aria-label="${label}"]'); const column = document.querySelector('.gpage'); const from = performance.now(); let shown = 0; requestAnimationFrame(() => { const m = new MessageChannel(); m.port1.onmessage = () => (shown = performance.now() - from); m.port2.postMessage(0); }); const watch = new MutationObserver(() => { watch.disconnect(); requestAnimationFrame(() => { const m = new MessageChannel(); m.port1.onmessage = () => resolve({ shown: Math.round(shown), pages: Math.round(performance.now() - from), layout: Number(column.dataset.layoutMs), count: Number(column.dataset.pages) }); m.port2.postMessage(0); }); }); const stamp = column.dataset.layoutMs; const target = column.querySelector('.gsheets'); watch.observe(column, { attributes: true, attributeFilter: ['data-layout-ms', 'data-pages'] }); setTimeout(() => resolve({ shown: Math.round(shown), pages: -1 }), 8000); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '${value}'); i.dispatchEvent(new Event('input', { bubbles: true })); })`);
  const results = [];
  for (const [label, value] of [["Space between steps", 30], ["Text size (pt)", 12], ["Margins (mm)", 20], ["Space between steps", 12], ["Text size (pt)", 11]]) {
    results.push({ label, value, ...(await setting(label, value)) });
    await sleep(2500);
  }
  for (const r of results) console.log("INFO  setting", JSON.stringify(r));
  const times = results.map((r) => r.pages).sort((a, b) => a - b);
  console.log("INFO  setting change to new pages, ms: median", times[Math.floor(times.length / 2)], "worst", times[times.length - 1]);
  check(times[0] >= 0, "every setting change laid the pages out anew");
  // (a built frontend has no source modules to compare with)
  if (await ev("fetch('/src/docs/export/run.ts').then((r) => r.ok && (r.headers.get('content-type') ?? '').includes('javascript')).catch(() => false)")) await compare("long guide");
  else {
    const after = await canvas();
    check(after.items.every((x) => x.sheet >= 0 && x.over <= 2), "long guide: every block inside its page", String(after.count));
  }
}

// --- the small fixes ------------------------------------------------------------------------------------------------------------
if (run("fixes")) {
  await seed(5);
  const tabs = await ev("[...document.querySelectorAll('.gpanel__tab')].map((b) => b.textContent).join()");
  check(tabs === "Guide,Step,Tree", "the third tab is called Tree", tabs);
  const badges = () => ev("[...document.querySelectorAll('article.gstep')].map((a) => a.querySelector('.gstep__area')?.textContent ?? '')");
  const none = await badges();
  check(none.every((t) => t === ""), "no 'Guide default' label on the steps", JSON.stringify(none));
  const sizes = new Map((await inv("doc_read")).steps.map((s) => [s.n, s.imageSize]));
  await rewrite((doc) => {
    const steps = doc.blocks.filter((b) => b.type === "step");
    steps[1].crop = [0, 0, ...sizes.get(steps[1].n)];
    steps[2].crop = [20, 20, 320, 180];
  });
  const some = await badges();
  check(some[0] === "" && some[1] === "Full screen" && some[2] === "Custom crop", "a badge only on a step with a picture area of its own", JSON.stringify(some));
  await selectStep(1);
  await ev("document.querySelector('.gpanel__tab[data-tab=\"step\"]').click()");
  await sleep(600);
  const widths = await ev("[...document.querySelectorAll('#gpanel-step .fxpanel__group button')].filter((b) => /Quick redact|OCR debug/.test(b.textContent)).map((b) => [b.textContent, Math.round(b.getBoundingClientRect().width), Math.round(b.closest('.fxpanel__group').getBoundingClientRect().width)])");
  check(widths.length === 2 && widths[0][1] === widths[1][1] && widths[0][1] >= widths[0][2] - 2, "'Quick redact this step' is as wide as 'OCR debug'", JSON.stringify(widths));
  await ev("document.querySelectorAll('article.gstep')[1].scrollIntoView({ block: 'start' })");
  await sleep(400);
  await shot("c4-step-tab.png");
  // the default drawing colour: what a new box gets
  const draw = async (index) => {
    await ev("document.querySelector('.gblock--sel').scrollIntoView({ block: 'center' })");
    await sleep(500);
    await ev("document.querySelector('#gpanel-step [data-tool=\"rect\"]').click()");
    await sleep(300);
    const p = await rect(".gblock--sel .gpic");
    const from = [p.x + 80 + index * 60, p.y + 60];
    await mouse("mouseMoved", from[0], from[1], { button: "none" });
    await mouse("mousePressed", from[0], from[1], { buttons: 1 });
    for (let i = 1; i <= 6; i++) await mouse("mouseMoved", from[0] + i * 12, from[1] + i * 9, { buttons: 1 });
    await mouse("mouseReleased", from[0] + 72, from[1] + 54);
    await sleep(600);
    const block = (await written()).blocks.filter((b) => b.type === "step")[1];
    return block.annotations?.at(-1);
  };
  await ev("document.querySelector('.gpanel__tab[data-tab=\"guide\"]').click()");
  await rewrite((doc) => (doc.template = { ...doc.template, colors: { ...doc.template.colors, main: "#0F7B4F", auto: true }, annotation: "main" }));
  await selectStep(1);
  const first = await draw(0);
  check(first?.kind === "rect" && first.color === "#0F7B4F", "a new box takes the default drawing colour of the template", JSON.stringify(first));
  await key("Escape", 27);
  await key("Escape", 27);
  const hint = await ev("(() => { const s = [...document.querySelectorAll('#gpanel-guide details')]; s.forEach((d) => (d.open = true)); return { label: [...document.querySelectorAll('#gpanel-guide .fxrow__label')].map((l) => l.textContent).filter((t) => /colour/i.test(t)), hint: document.querySelector('#gpanel-guide').textContent.includes('The colour new arrows, boxes and texts get.'), old: document.querySelector('#gpanel-guide').textContent.includes('Annotation colour') }; })()");
  check(hint.label.includes("Default drawing colour") && hint.hint && !hint.old, "the setting is 'Default drawing colour', with its hint", JSON.stringify(hint));
  await ev("document.querySelector('.covgallery').scrollIntoView({ block: 'start' })");
  await sleep(700);
  check((await ev("document.querySelectorAll('.covgallery__item').length")) === 6, "the cover gallery shows six designs");
  await shot("c4-gallery.png");
  await ev("[...document.querySelectorAll('.covgallery__item')].find((b) => b.title === 'Side band').click()");
  await sleep(900);
  check((await written()).template.cover.design === "band", "a click in the gallery changes the cover (one undo step)");
  await ev("document.activeElement.blur(); document.querySelector('.headrow [aria-label=\"Undo\"]').click()");
  await sleep(900);
  check((await written()).template.cover.design !== "band", "undo takes it back");
  // reorder by dragging on the pages
  const order = async () => (await written()).blocks.map((b) => b.id);
  const was = await order();
  await ev("(() => { const dt = new DataTransfer(); const from = document.querySelectorAll('article.gstep .gblock__handle')[3]; from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })); const bar = document.querySelectorAll('.ginsert')[1]; bar.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); bar.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); })()");
  await sleep(900);
  const now = await order();
  check(now.join() !== was.join() && now.length === was.length, "dragging a step to another place works on the pages", `${was.indexOf(now[1])} -> 1`);
  await compare("after reorder");
  // the empty guide: a page to put the first block on, and the cover can be written on
  await rewrite((doc) => (doc.template = { ...doc.template, contents: false }));
  await ev("(() => { const all = [...document.querySelectorAll('article[data-block]')]; const at = (e, more) => e.dispatchEvent(new MouseEvent('click', { bubbles: true, ...more })); at(all[0], {}); at(all.at(-1), { shiftKey: true }); })()");
  await sleep(400);
  await key("Delete", 46);
  await sleep(1200);
  const bare = await ev("({ sheets: document.querySelectorAll('.gsheet').length, plus: (() => { const b = document.querySelector('.ginsert__plus'); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); b.parentElement.querySelector('.ginsert__plus').focus(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return hit === b; })() })");
  check(bare.sheets === 2 && bare.plus, "a guide that is only a cover has a page for the first block", JSON.stringify(bare));
  await ev("document.querySelector('.glist').scrollTop = 0");
  await sleep(500);
  const title = await rect(".gcover__text--title .ProseMirror p");
  await press(title.x + title.w / 2, title.y + title.h / 2);
  await sleep(400);
  await send("Input.insertText", { text: "My own title" });
  await sleep(900);
  check((await written()).template.cover.title === "My own title", "the cover's title is written in place");
  await shot("c4-cover-editing.png");
}

// --- every kind of text is as high on the canvas as in print ----------------------------------------------------------------------
if (run("nodes")) {
  await seed(3);
  const image = await picture(1200, 500, "#33691E", "#8D6E63", "PICTURE");
  const item = (text) => ({ type: "listItem", content: [para(text)] });
  const shot2 = (attrs) => ({ type: "image", attrs: { file: image, alt: "", nw: 1200, nh: 500, align: "start", ...attrs } });
  await rewrite((doc) => {
    doc.blocks[0].doc.content = [
      heading("Everything"),
      heading("Second level", 2),
      heading("Third level", 3),
      para(words.repeat(3)),
      { type: "paragraph" },
      { type: "paragraph", attrs: { textAlign: "center" }, content: [{ type: "text", text: "Centred, with  two  spaces", marks: [{ type: "italic" }] }] },
      { type: "paragraph", content: [{ type: "text", text: "Large", marks: [{ type: "textStyle", attrs: { fontSize: "28px", fontFamily: "Georgia" } }] }, { type: "hardBreak" }, { type: "text", text: "marked", marks: [{ type: "highlight", attrs: { color: "#fff59d" } }] }] },
      { type: "bulletList", content: [item("one"), item(words), item("three")] },
      { type: "orderedList", content: [item("first"), item("second")] },
      { type: "blockquote", content: [para(words)] },
      { type: "codeBlock", content: [{ type: "text", text: "snipmunk --help\nsnipmunk --version" }] },
      { type: "horizontalRule" },
      shot2({}),
      shot2({ width: 300, align: "center" }),
      shot2({ width: 400, height: 90, align: "end" }),
      shot2({ align: "full", crop: [0.25, 0.25, 0.5, 0.5] }),
      table(4, "center", null),
      table(3, "start", [120, 200, 260]),
      para("The end."),
    ];
    doc.blocks.find((b) => b.type === "step").desc = { type: "doc", content: [{ type: "bulletList", content: [item("in a step"), item("as well")] }, para(words)] };
  });
  await sleep(1500);
  const diff = await ev(`(async () => {
    const [flow, measure, pm, html] = await Promise.all([import('/src/docs/pageflow.ts'), import('/src/docs/export/measure.ts'), import('/src/docs/export/paginate.ts'), import('/src/docs/export/html.ts')]);
    const all = await window.__TAURI_INTERNALS__.invoke('doc_read');
    const steps = new Map(all.steps.map((s) => [s.n, s]));
    const data = flow.layoutData(all.document, steps, { lang: 'en', rtl: false, contents: 'Contents', pagePattern: 'Page {n} of {of}', stepPattern: 'Step {n}', date: 'today' });
    const m = measure.createMeasurer();
    const layout = await pm.layoutPages(data, m);
    m.dispose();
    const units = layout.pages.flatMap((p) => p.units);
    const column = document.querySelector('.gpage');
    const out = [];
    const block = all.document.blocks[0].id;
    const dom = [...column.querySelector('article[data-block="' + block + '"] .ProseMirror').children].filter((c) => !c.matches('.pm-gap'));
    dom.forEach((el, i) => { const mine = units.filter((u) => u.block === block && u.child === i); const want = mine.reduce((a, u) => a + u.height * u.scale, 0); const kind = all.document.blocks[0].doc.content[i].type; const rows = el.querySelectorAll('.pm-gap-row, .pm-gap-head'); const extra = [...rows].reduce((a, r) => a + r.offsetHeight, 0); out.push([kind, Math.round(el.offsetHeight - extra), Math.round(want)]); });
    for (const b of all.document.blocks.filter((x) => x.type === 'step')) { const el = column.querySelector('article[data-block="' + b.id + '"]'); const u = units.find((x) => x.block === b.id); out.push(['step', Math.round(el.offsetHeight + parseFloat(getComputedStyle(el).marginBottom)), Math.round(u.height)]); }
    return out;
  })()`);
  const wrong = diff.filter(([, a, b]) => Math.abs(a - b) > 2);
  check(wrong.length === 0, `every paragraph, heading, list, quote, code, rule, picture, table and step is as high on the canvas as in print (${diff.length})`, JSON.stringify(wrong));
  await compare("every kind of text");
  // a picture is resized by its corner at the size of the page, whatever the zoom
  await settings({ docFit: "none", docZoom: 150 });
  await sleep(1200);
  await ev("document.querySelectorAll('article.gcontent .gimg__box')[1].scrollIntoView({ block: 'center' })");
  await sleep(400);
  const box = await rect("article.gcontent .gimg__box", 1);
  await press(box.x + box.w / 2, box.y + box.h / 2);
  await sleep(400);
  const corner = await rect("article.gcontent .gimg__box .gimg__h--se", 0);
  const from = [corner.x + corner.w / 2, corner.y + corner.h / 2];
  await mouse("mouseMoved", from[0], from[1], { button: "none" });
  await mouse("mousePressed", from[0], from[1], { buttons: 1 });
  for (let i = 1; i <= 6; i++) await mouse("mouseMoved", from[0] + i * 25, from[1], { buttons: 1 });
  await mouse("mouseReleased", from[0] + 150, from[1]);
  await sleep(900);
  const width = (await written()).blocks[0].doc.content.filter((x) => x.type === "image")[1].attrs.width;
  check(Math.abs(width - 400) <= 4, "dragging a picture's corner by 150 pixels at 150% makes it 100 wider", String(width));
  await settings({ docFit: "auto", docZoom: 100 });
}

// --- the real print dialog, last: it stays open until the instance is closed; nothing is sent to a printer -----------------------
if (run("dialog") && only.includes("dialog")) {
  await seed(2);
  await openPreview();
  send("Runtime.evaluate", { expression: "document.querySelector('.gbar__print').click()" });
  await sleep(9000);
  const list = await (await fetch("http://127.0.0.1:9222/json")).json();
  console.log("INFO  open views:", JSON.stringify(list.map((x) => x.url.slice(0, 60))));
  check(list.some((x) => /^edge:\/\/print|^chrome:\/\/print/.test(x.url)), "Print… opens the print dialog of the web view");
}

if (problems.length) console.log("CONSOLE", JSON.stringify([...new Set(problems)].slice(0, 12), null, 1));
console.log(failed ? `${failed} check(s) FAILED` : "all checks passed");
process.exit(failed ? 1 : 0);
