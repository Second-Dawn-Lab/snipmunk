// End-to-end check of the step pictures of Documents mode, through the REAL recorder path of a DEVELOPMENT test instance:
//   an own test window (generated content) captured live -> steps via the dev injection path -> PNG in the working folder
//   -> the <img> of the editor loads it through the real snipmunk-img handler (complete, naturalWidth = frame width)
//   -> Save as (.snpd) -> close -> open the .snpd -> the same pictures again.
// It fails when a picture stays an empty grey box (for example `loading="lazy"` on an image without a size, the bug of 7.5-B).
//
// Run: start the test instance with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 and its data/temp folders in a
// scratch folder (never your real ones), Documents mode selected, then:
//   node scripts/e2e-guide-pictures.mjs <folder for the .snpd>
import fs from "node:fs";
import path from "node:path";

const outDir = process.argv[2];
if (!outDir) throw new Error("usage: node scripts/e2e-guide-pictures.mjs <scratch folder>");
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, "e2e.snpd").replace(/\\/g, "/");

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
    pending.set(id, (d) => (d.result?.exceptionDetails ? rej(new Error(JSON.stringify(d.result.exceptionDetails).slice(0, 400))) : res(d.result?.result?.value)));
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const invoke = (cmd, args = {}) => ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`);
// (a test instance must never be able to capture the real desktop: asked before anything is clicked)
if ((await ev("window.__TAURI_INTERNALS__.invoke('dev_capture_guard').catch(() => false)")) !== true) throw new Error("STOP: the test instance has no no-real-capture guard");
let failed = 0;
const check = (ok, what, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${extra ? "  " + extra : ""}`);
  if (!ok) failed++;
};

/** What the editor shows: every picture is a loaded image of the expected size (the frames are 640 x 360). */
const pictures = () =>
  ev(`(async () => {
    // bring every picture into view, one after the other, as a person scrolling would
    for (const g of document.querySelectorAll('.gpic')) { g.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 250)); }
    await new Promise((r) => setTimeout(r, 300));
    const imgs = [...document.querySelectorAll('.gpic img')];
    return { boxes: document.querySelectorAll('.gpic').length, missing: document.querySelectorAll('.gpic__missing').length,
      imgs: imgs.map((i) => [i.complete, i.naturalWidth, i.naturalHeight]) };
  })()`);

// 1. a guide through the real recorder path: the dev scenario opens an OWN native test window (generated content), records its
//    pictures live (window capture), injects the clicks after the hook stage and stops. Nothing of the real desktop is read.
await invoke("set_settings", { patch: { captureKind: "documents" } });
const made = await invoke("dev_guide_scenario", { kind: "native", lang: "en" });
check(Array.isArray(made) ? made.length >= 3 : (made?.steps?.length ?? 0) >= 3, "the scenario recorded steps", JSON.stringify(made).slice(0, 160));
await ev("location.reload()");
await sleep(3000);
await ev("(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.startsWith('Recover guide')); if (b) b.click(); })()");
await sleep(2500);

// 2. the files in the working folder are served by the snipmunk-img handler, with the size the step says
const state = await invoke("doc_state");
check(state.open && state.steps >= 3, "the working guide has steps", JSON.stringify(state));
const all = await invoke("doc_read");
const steps = (all.steps ?? []).filter((s) => !s.deleted);
for (const s of steps) {
  const r = await ev(`(async () => { const u = window.__TAURI_INTERNALS__.convertFileSrc('guide/current/${s.image}', 'snipmunk-img');
    const res = await fetch(u); const b = await res.blob(); const bmp = await createImageBitmap(b); return [res.status, b.type, b.size, bmp.width, bmp.height]; })()`);
  check(r[0] === 200 && r[1] === "image/png" && r[2] > 0 && r[3] === s.imageSize[0] && r[4] === s.imageSize[1], `${s.image} through the handler`, JSON.stringify(r));
}
const count = steps.length;

// 3. the editor shows them
let p = await pictures();
check(p.boxes === count && p.imgs.length === count && p.imgs.every(([c, w, h]) => c && w > 0 && h > 0) && p.missing === 0, `the editor shows ${count} loaded pictures`, JSON.stringify(p));

// 3b. pictures that show a CROP (the guide's "active window" area, or a chosen crop): the image sits at a negative offset inside its box.
//     This is the case in which `loading="lazy"` never loaded a picture (a lazy image has no size yet, so its place, outside the clipped box, never counted as visible).
const cropped = JSON.parse(JSON.stringify(all.document));
for (const b of cropped.blocks) if (b.type === "step") b.crop = [60, 50, 300, 200];
await invoke("doc_write", { document: cropped });
await ev("location.reload()");
await sleep(3000);
await ev("(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.startsWith('Recover guide')); if (b) b.click(); })()");
await sleep(2500);
p = await pictures();
check(p.boxes === count && p.imgs.length === count && p.imgs.every(([c, w]) => c && w > 0) && p.missing === 0, `the editor shows ${count} loaded CROPPED pictures`, JSON.stringify(p));
await invoke("doc_write", { document: all.document });

// 4. Save as, close, open the .snpd again
await invoke("doc_save", { path: file, asNew: true, document: all.document });
await invoke("doc_close");
await ev("location.reload()");
await sleep(2500);
await invoke("doc_open", { path: file });
await ev("location.reload()");
await sleep(2500);
const again = await invoke("doc_state");
check(again.open && again.steps === count && !!again.savedPath, `the .snpd opens with ${count} steps`, JSON.stringify(again));
// A reload offers recovery only for unsaved guides; a saved one opens by itself.
p = await pictures();
check(p.boxes === count && p.imgs.length === count && p.imgs.every(([c, w]) => c && w > 0) && p.missing === 0, `the opened .snpd shows ${count} loaded pictures`, JSON.stringify(p));

await invoke("doc_close");
// 5. the Documents home shows the thumbnail of the saved guide (Recent)
await ev("location.reload()");
await sleep(3000);
const thumbs = await ev("[...document.querySelectorAll('.gcard__thumb img')].map((i) => [i.complete, i.naturalWidth])");
check(thumbs.length >= 1 && thumbs.every(([c, w]) => c && w > 0), "the Recent list shows the thumbnail", JSON.stringify(thumbs));
console.log(failed ? `${failed} check(s) FAILED` : "all checks passed");
process.exit(failed ? 1 : 0);
