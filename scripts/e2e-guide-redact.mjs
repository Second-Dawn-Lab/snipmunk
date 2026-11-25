// End-to-end check of Quick redact on step pictures and of drag auto-scroll, in a DEVELOPMENT test instance (generated pictures
// only: nothing of the desktop is read; the text recognition reads our own generated picture).
// Start the test instance with its data and temp folders in a scratch folder, then: node scripts/e2e-guide-redact.mjs <scratch folder>
import path from "node:path";

const out = process.argv[2];
if (!out) throw new Error("usage: node scripts/e2e-guide-redact.mjs <scratch folder>");
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
const ev = (expression) =>
  new Promise((res, rej) => {
    const id = n++;
    pending.set(id, (d) => (d.result?.exceptionDetails ? rej(new Error(JSON.stringify(d.result.exceptionDetails).slice(0, 700))) : res(d.result?.result?.value)));
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// (a test instance must never be able to capture the real desktop: asked before anything is clicked)
if ((await ev("window.__TAURI_INTERNALS__.invoke('dev_capture_guard').catch(() => false)")) !== true) throw new Error("STOP: the test instance has no no-real-capture guard");
let failed = 0;
const check = (ok, what, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${extra ? "  " + extra : ""}`);
  if (!ok) failed++;
};
const file = path.resolve(out, "redact.snpd").replace(/\\/g, "/");

await ev("window.__TAURI_INTERNALS__.invoke('set_settings', { patch: { captureKind: 'documents', quickRedactEmail: true, quickRedactPhone: false, quickRedactCard: true, quickRedactIban: true, quickRedactSecret: false } })");
const r = await ev(`(async () => {
  const inv = window.__TAURI_INTERNALS__.invoke;
  await inv('doc_new', { title: 'Redact test' });
  const c = document.createElement('canvas'); c.width = 1200; c.height = 520; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 1200, 520); x.fillStyle = '#111'; x.font = '34px Segoe UI, sans-serif';
  x.fillText('Contact: anna.muster@example.com', 60, 90);
  x.fillText('IBAN: DE89 3704 0044 0532 0130 00', 60, 190);
  x.fillText('Number: 4012 8888 8888 1881 ok', 60, 290);
  x.fillText('This line has nothing private in it', 60, 420);
  const step = await inv('doc_add_step_image', { base64Data: c.toDataURL('image/png').split(',')[1] });
  const redact = await import('/src/docs/redact.ts');
  const q = await import('/src/ocr/quickRedact.ts');
  const model = await import('/src/docs/model.ts');
  const settings = await inv('get_settings');
  const ocr = await inv('doc_ocr', { file: step.image });
  const found = redact.findInPicture('b1', ocr, q.optionsFromSettings(settings));
  let doc = model.createDocument('Redact test', Date.now(), [], { marker: { left: '#f00', right: '#00f', shape: 'circle', size: 'medium' }, badge: 'circle', picture: 'screen', keepFull: false, zoomDefault: false });
  doc = model.insertBlock(doc, 0, { id: 'b1', type: 'step', n: step.n });
  const steps = new Map([[step.n, step]]);
  doc = redact.applyRedactions(doc, steps, found, 'black');
  const pic = await import('/src/docs/export/pictures.tsx');
  const img = await pic.stepImage(step, doc.blocks[0], doc, { markers: false, annotations: false, jpeg: null });
  const i = new Image(); i.src = img.src; await i.decode();
  const k = document.createElement('canvas'); k.width = i.width; k.height = i.height; const y = k.getContext('2d'); y.drawImage(i, 0, 0);
  const dark = (rx, ry, rw, rh) => { const d = y.getImageData(rx, ry, rw, rh).data; let b = 0; for (let p = 0; p < d.length; p += 4) if (d[p] < 8) b++; return b / (d.length / 4); };
  const covered = doc.blocks[0].redact.map((m) => dark(...m.rect));
  await inv('doc_write', { document: doc });
  await inv('doc_save', { path: ${JSON.stringify(file)}, asNew: true, document: doc });
  return { kinds: found.map((f) => f.kind).sort(), texts: found.map((f) => f.text), rects: doc.blocks[0].redact.map((m) => m.rect), covered, plain: dark(60, 395, 400, 30) };
})()`);
check(r.kinds.join() === "card,email,iban", "the e-mail address, the IBAN and the card are found", JSON.stringify(r.texts));
check(r.covered.length === 3 && r.covered.every((v) => v > 0.999), "each is covered in the exported picture", JSON.stringify(r.covered));
check(r.plain < 0.5, "the other text is not covered", r.plain.toFixed(3));
check(r.rects.every((m) => m[0] >= 40 && m[2] > 150 && m[3] > 20 && m[3] < 80), "the boxes sit on their lines", JSON.stringify(r.rects));

// --- drag auto-scroll: a long guide, a drag held near the bottom edge scrolls, in the middle it does not -----------------------------
await ev("window.__TAURI_INTERNALS__.invoke('doc_close')");
await ev("window.__TAURI_INTERNALS__.invoke('dev_guide_seed', { count: 150 })");
await ev("location.reload()");
await sleep(3500);
await ev("(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.startsWith('Recover guide')); if (b) b.click(); })()");
await sleep(4000);
const drag = await ev(`(async () => {
  const list = document.querySelector('.glist');
  const rect = list.getBoundingClientRect();
  const dt = new DataTransfer(); dt.setData('application/x-snipmunk-block', 'x');
  const hold = async (y, ms) => { const t = performance.now(); while (performance.now() - t < ms) { list.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientY: y, clientX: rect.left + 50, dataTransfer: dt })); await new Promise((r) => setTimeout(r, 40)); } };
  const move = async (y, ms) => { const a = list.scrollTop; await hold(y, ms); return Math.round(list.scrollTop - a); };
  const middle = await move((rect.top + rect.bottom) / 2, 700);
  const slow = await move(rect.bottom - 70, 1000);
  const fast = await move(rect.bottom - 4, 1000);
  const up = await move(rect.top + 4, 600);
  window.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
  const a = list.scrollTop; await new Promise((r) => setTimeout(r, 400)); const after = Math.round(list.scrollTop - a);
  const long = await move(rect.bottom - 2, 6000);
  return { middle, slow, fast, up, after, long, height: list.scrollHeight };
})()`);
check(drag.middle === 0, "a drag in the middle of the list does not scroll it", JSON.stringify(drag));
check(drag.slow > 0 && drag.fast > drag.slow * 2, "it scrolls near the bottom edge, faster closer to the edge");
check(drag.up < 0 && drag.after === 0, "it scrolls up near the top and stops when the drag ends");
check(drag.long > 5000, "a step can be dragged far down a long guide", `${drag.long} px in 6 s`);
await ev("window.__TAURI_INTERNALS__.invoke('doc_close')");
console.log(failed ? `${failed} check(s) FAILED` : "all checks passed");
process.exit(failed ? 1 : 0);
