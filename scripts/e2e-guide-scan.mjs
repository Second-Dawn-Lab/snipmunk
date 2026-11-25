// End-to-end check and timing of "Quick redact whole guide" on generated editor pictures, in a DEVELOPMENT test instance (nothing
// of the desktop is read; the text recognition reads our own pictures). The pictures are drawn by a script of the developer and
// named np-<size>-<scale>.png (an editor window with the six lines below).
// Start the test instance with its data and temp folders in a scratch folder, then:
//   node scripts/e2e-guide-scan.mjs <scratch folder> <folder of the pictures>
import { readFileSync } from "node:fs";
import path from "node:path";

const [out, pictures] = process.argv.slice(2);
if (!out || !pictures) throw new Error("usage: node scripts/e2e-guide-scan.mjs <scratch folder> <folder of the pictures>");
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
const send = (method, params) =>
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (expression, ms = 120000) => {
  const start = Date.now();
  for (;;) {
    if (await ev(expression)) return Date.now() - start;
    if (Date.now() - start > ms) throw new Error("timed out: " + expression);
    await sleep(100);
  }
};
// (a test instance must never be able to capture the real desktop: asked before anything is clicked)
if ((await ev("window.__TAURI_INTERNALS__.invoke('dev_capture_guard').catch(() => false)")) !== true) throw new Error("STOP: the test instance has no no-real-capture guard");
let failed = 0;
const check = (ok, what, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${extra ? "  " + extra : ""}`);
  if (!ok) failed++;
};
const click = (text, scope = "document") => ev(`(() => { const b = [...${scope}.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!b) return false; b.click(); return true; })()`);
const file = path.resolve(out, "scan.snpd").replace(/\\/g, "/");

// Seven steps: the editor window at several sizes and scales, in a light and a dark editor.
const shots = [
  ["np-1080-100", 1],
  ["np-1080-125", 1.25],
  ["np-1440-100", 1],
  ["np-1440-125", 1.25],
  ["np-2160-150", 1.5],
  ["np-1080-dark", 1],
  ["np-small-100", 1],
];
await ev("window.__TAURI_INTERNALS__.invoke('set_settings', { patch: { captureKind: 'documents', language: 'en', quickRedactEmail: true, quickRedactPhone: false, quickRedactCard: true, quickRedactIban: true, quickRedactSecret: true, quickRedactWords: [] } })");
await ev("window.__TAURI_INTERNALS__.invoke('doc_close').catch(() => undefined)");
await ev("window.__TAURI_INTERNALS__.invoke('doc_new', { title: 'Scan test' })");
const steps = [];
for (const [name] of shots) {
  const data = readFileSync(path.join(pictures, `${name}.png`)).toString("base64");
  steps.push(await ev(`window.__TAURI_INTERNALS__.invoke('doc_add_step_image', { base64Data: ${JSON.stringify(data)} })`));
}
await ev(`(async () => {
  const model = await import('/src/docs/model.ts');
  let doc = model.createDocument('Scan test', Date.now(), ${JSON.stringify(steps)}, { marker: { left: '#f00', right: '#00f', shape: 'circle', size: 'medium' }, badge: 'circle', picture: 'screen', keepFull: false, zoomDefault: false });
  doc.blocks[0].text = [{ t: 'Write to k@qmail.com about ' }, { t: 'password: 7741kqz558w', b: true }];
  doc.blocks.push({ id: 'c1', type: 'content', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Account IBAN: DE89 3704 0044 0532 0130 00' }] }] } });
  await window.__TAURI_INTERNALS__.invoke('doc_write', { document: doc });
})()`);
await ev("location.reload()");
await sleep(3000);
await click("Recover guide");
await until("!!document.querySelector('.headrow')");
await sleep(1500);

const scan = async () => {
  await ev("document.querySelector('.gpanel__tab[data-tab=\"guide\"]').click()");
  await sleep(200);
  if (!(await click("Quick redact whole guide"))) throw new Error("no button in the Guide tab");
  await sleep(300);
  const start = Date.now();
  if (!(await click("Scan", "document.querySelector('.dw-dialog')"))) throw new Error("no Scan button");
  await until("!!document.querySelector('.redact__sum')");
  return Date.now() - start;
};
const first = await scan();
console.log(`TIME  first scan of ${shots.length} steps: ${first} ms (${Math.round(first / shots.length)} ms a step)`);
check(first < 20000, "a whole-guide scan of seven steps takes seconds", `${first} ms`);
const dialog = await ev(`(() => { const d = document.querySelector('.dw-dialog'); const r = d.getBoundingClientRect(); const inner = document.querySelector('.redact');
  const out = [...d.querySelectorAll('*')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > r.right + 0.5 || b.left < r.left - 0.5); }).length;
  return { out, scrollW: inner.scrollWidth, w: inner.clientWidth, h: inner.clientHeight, scrollH: inner.scrollHeight, items: [...inner.querySelectorAll('.redact__item')].map((x) => x.textContent) }; })()`);
check(dialog.out === 0 && dialog.scrollW <= dialog.w, "nothing sticks out of the dialog", JSON.stringify({ ...dialog, items: dialog.items.length }));
check(dialog.scrollH > dialog.h && dialog.h <= 470, "the long list scrolls inside it");
check(dialog.items.some((i) => i.startsWith("Step 1 text:")) && dialog.items.some((i) => i.startsWith("Text block 1:")) && dialog.items.some((i) => i.startsWith("Step 3 picture:")), "pictures and texts are listed by their place", JSON.stringify(dialog.items.slice(0, 8)));
await send("Page.captureScreenshot", { format: "png" }).then(async (d) => (await import("node:fs")).writeFileSync(path.join(out, "scan-dialog.png"), Buffer.from(d.result.data, "base64")));
await click("Apply", "document.querySelector('.dw-dialog')");
await sleep(1200);
const doc = await ev("window.__TAURI_INTERNALS__.invoke('doc_read').then((r) => r.document)");

// Every value on every picture lies under redaction marks: the line (0-based) and its first and last column.
const lines = [
  ["email", 1, 8, 19],
  ["password", 2, 10, 21],
  ["IBAN with spaces", 3, 6, 33],
  ["IBAN with hyphens", 4, 6, 33],
  ["IBAN without separators", 5, 6, 28],
];
shots.forEach(([name, s], i) => {
  const marks = doc.blocks[i].redact ?? [];
  const missed = lines.filter(([, row, from, to]) => {
    const y = 104 * s + 2 * s + row * 18 * s + 8 * s;
    for (let x = (50 + from * 8 + 3) * s; x < (50 + to * 8 - 5) * s; x += 3) if (!marks.some((m) => x >= m.rect[0] && x <= m.rect[0] + m.rect[2] && y >= m.rect[1] && y <= m.rect[1] + m.rect[3])) return true;
    return false;
  });
  check(missed.length === 0, `${name}: e-mail, password and the three IBANs are covered`, missed.map((m) => m[0]).join(", "));
});
const saved = await ev(`(async () => { const r = await window.__TAURI_INTERNALS__.invoke('doc_read'); await window.__TAURI_INTERNALS__.invoke('doc_save', { path: ${JSON.stringify(file)}, asNew: true, document: r.document }); return true; })()`);
const bytes = readFileSync(file).toString("utf8");
check(saved && !/7741kqz558w|k@qmail|DE89 3704/.test(bytes) && bytes.includes("••••••"), "the saved file holds none of the hidden texts");
const second = await scan();
console.log(`TIME  second scan (readings kept): ${second} ms`);
await click("Cancel", "document.querySelector('.dw-dialog')");
await ev("window.__TAURI_INTERNALS__.invoke('doc_close')");
console.log(failed ? `${failed} check(s) FAILED` : "all checks passed");
process.exit(failed ? 1 : 0);
