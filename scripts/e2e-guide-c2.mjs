// End-to-end check of the template menu and own templates, the cover in the editor, the background
// picture, the page view with its contents, and the layout of the export dialog, in a DEVELOPMENT test instance (generated
// pictures only: nothing of the desktop is read).
// Start the test instance with its data, temp and template folders in a scratch folder, then:
//   node scripts/e2e-guide-c2.mjs <scratch folder>
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = process.argv[2];
if (!out) throw new Error("usage: node scripts/e2e-guide-c2.mjs <scratch folder>");
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (expression, ms = 30000) => {
  const start = Date.now();
  for (;;) {
    if (await ev(expression)) return;
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
const size = (width, height, scale = 1) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
const click = (text, scope = "document") => ev(`(() => { const b = [...${scope}.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`);
const inv = (command, args = {}) => ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`);
const key = async (k) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k, windowsVirtualKeyCode: k === "Escape" ? 27 : 0 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k });
};

if ((await inv("dev_capture_guard").catch(() => false)) !== true) throw new Error("STOP: no no-real-capture guard");
await size(1280, 860);
await inv("set_settings", { patch: { captureKind: "documents", language: "en", docZoom: 100, docPageWidth: "normal" } });
await ev("window.__TAURI_INTERNALS__.invoke('doc_close').catch(() => undefined)");
await inv("doc_new", { title: "Toolbar and templates" });
// A narrow strip (a taskbar), a normal picture, and a picture for the background.
const made = await ev(`(async () => {
  const inv = window.__TAURI_INTERNALS__.invoke;
  const png = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c.toDataURL('image/png').split(',')[1]; };
  const strip = await inv('doc_add_step_image', { base64Data: png(1600, 44, (x, w, h) => { x.fillStyle = '#243'; x.fillRect(0, 0, w, h); x.fillStyle = '#9cf'; for (let i = 0; i < 12; i++) x.fillRect(20 + i * 52, 8, 30, 28); }) });
  const wide = await inv('doc_add_step_image', { base64Data: png(1200, 600, (x, w, h) => { x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.fillStyle = '#345'; x.fillRect(100, 100, 400, 200); }) });
  const logo = await inv('doc_add_image', { base64Data: png(300, 80, (x, w, h) => { x.fillStyle = '#c33'; x.fillRect(0, 0, w, h); }) });
  const bg = await inv('doc_add_image', { base64Data: png(600, 600, (x, w, h) => { const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#f90'); g.addColorStop(1, '#06f'); x.fillStyle = g; x.fillRect(0, 0, w, h); }) });
  const model = await import('/src/docs/model.ts');
  const doc = model.createDocument('Toolbar and templates', Date.now(), [strip, wide], { marker: { left: '#f00', right: '#00f', shape: 'circle', size: 'medium' }, badge: 'circle', picture: 'screen', keepFull: false, zoomDefault: false });
  await inv('doc_write', { document: doc });
  return { logo: logo.name, bg: bg.name };
})()`);
await ev("location.reload()");
await sleep(3000);
await ev("(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.startsWith('Recover guide')); if (b) b.click(); })()");
await until("document.querySelectorAll('.gstep').length === 2");
await sleep(1200);

// --- templates ----------------------------------------------------------------------------------------------------------------
const openMenu = async () => {
  await ev("document.querySelector('.headrow .gsplit__more').click()");
  await sleep(400);
};
await openMenu();
const menu = await ev("[...document.querySelectorAll('.tplmenu button')].map((b) => ({ t: b.textContent.trim(), off: b.getAttribute('aria-disabled') === 'true' }))");
check(menu.some((m) => m.t === "Corporate") && menu.find((m) => m.t === "Update my template")?.off === true && menu.some((m) => m.t.startsWith("Manage templates")), "the template menu lists the templates and the actions; a built-in one cannot be updated", JSON.stringify(menu.map((m) => m.t)));
await shot("c2-template-menu.png");
await ev("[...document.querySelectorAll('.tplmenu button')].find((b) => b.textContent.trim() === 'Corporate').click()");
await sleep(900);
await openMenu();
await ev("[...document.querySelectorAll('.tplmenu button')].find((b) => b.textContent.trim().startsWith('Save as my template')).click()");
await sleep(400);
await click("Save", "document.querySelector('.dw-dialog')");
await sleep(900);
await openMenu();
check((await ev("[...document.querySelectorAll('.tplmenu button')].find((b) => b.textContent.trim() === 'Update my template').getAttribute('aria-disabled')")) === null, "an own template can be updated");
await key("Escape");
const doc = () => inv("doc_read").then((r) => r.document);
// A change of the guide's copy, then "Update my template".
const own = (await inv("templates_list"))[0];
await ev(`(async () => { const apply = await import('/src/docs/template/apply.ts'); const r = await window.__TAURI_INTERNALS__.invoke('doc_read'); const d = apply.changeTemplate(r.document, (t) => { t.steps.badgeBg = '#00AA00'; t.header = { left: 'title', center: 'text', right: 'author', texts: { left: '', center: 'Confidential', right: '' } }; }); await window.__TAURI_INTERNALS__.invoke('templates_save', { template: { ...d.template, id: ${JSON.stringify(own.id)}, name: ${JSON.stringify(own.name)} } }); })()`);
const updated = await inv("templates_list");
check(updated.length === 1 && updated[0].steps.badgeBg === "#00AA00", "update overwrites the own template in place");
await inv("templates_rename", { id: own.id, name: "Second one", copy: true });
const folder = path.resolve(out, "shared");
rmSync(folder, { recursive: true, force: true });
mkdirSync(folder, { recursive: true });
const ids = (await inv("templates_list")).map((t) => t.id);
const count = await inv("templates_export_many", { ids, folder });
check(count === 2 && readdirSync(folder).filter((f) => f.endsWith(".snpt")).length === 2, "several templates are exported as one file each", readdirSync(folder).join(", "));
for (const f of readdirSync(folder)) await inv("templates_import", { path: path.join(folder, f) });
const all = await inv("templates_list");
check(all.length === 4 && new Set(all.map((t) => t.id)).size === 4, "several files are imported, each under its own id");
for (const t of all) await inv("templates_delete", { id: t.id });

// --- the cover in the editor, the background, the page view -------------------------------------------------------------------
await ev(`(async () => { const apply = await import('/src/docs/template/apply.ts'); const r = await window.__TAURI_INTERNALS__.invoke('doc_read'); const d = apply.changeTemplate(r.document, (t) => { t.cover.on = true; t.contents = true; t.logo = ${JSON.stringify(made.logo)}; t.cover.image = ${JSON.stringify(made.bg)}; t.cover.background = '#FFFFFF'; t.background = { apply: 'all', size: 'custom', scale: 60, x: 'right', y: 'bottom', opacity: 30, grey: true }; t.header = { left: 'title', center: 'text', right: 'logo', texts: { left: '', center: 'Confidential', right: '' } }; }); await window.__TAURI_INTERNALS__.invoke('doc_write', { document: d }); })()`);
await ev("location.reload()");
await sleep(3000);
await ev("(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.startsWith('Recover guide')); if (b) b.click(); })()");
await until("!!document.querySelector('.gcover')");
await sleep(1500);
check(await ev("(() => { const p = document.querySelector('.gpage'); return p.querySelector('.gcover') === p.querySelector('.gcover, .gblock') && !!document.querySelector('.gcover__logo') && !!document.querySelector('.gcover .cover__bg'); })()"), "the cover is the first block of the editor, with logo and background picture");
await ev("(() => { const e = document.querySelector('.gcover__text--title .rich__editor'); e.focus(); })()");
await sleep(200);
await send("Input.insertText", { text: "Cover headline" });
await sleep(300);
await ev("document.querySelector('.gcover__text--title [aria-label=\"Center\"], .gcover__text--title .rich__bar button:nth-last-of-type(3)')?.click()");
await shot("c2-cover.png");
await ev("document.activeElement.blur()");
await sleep(1200);
check((await doc()).template.cover.title === "Cover headline", "the title written on the cover is the template's cover title", JSON.stringify((await doc()).template.cover.title));
await ev("document.querySelector('.gbar__preview').click()");
await until("!!document.querySelector('iframe.pageview')?.contentDocument?.querySelector('.page--cover')");
await sleep(1500);
const view = await ev(`(() => { const d = document.querySelector('iframe.pageview').contentDocument; const pages = [...d.querySelectorAll('.page')];
  return { pressed: document.querySelector('.gbar__preview').getAttribute('aria-pressed'), toc: pages[1]?.querySelector('.toc') ? [...pages[1].querySelectorAll('.toc li span')].map((x) => x.textContent) : null,
    coverBg: !!pages[0].querySelector('.cover__bg'), pageBg: pages.slice(1).every((p) => !!p.querySelector('.page__bg')), head: pages[1].querySelector('.page__slot')?.textContent, headLogo: !!pages[1].querySelector('.page__slot img'),
    bgSize: d.defaultView.getComputedStyle(pages[1].querySelector('.page__bg')).backgroundSize, pageH: pages[1].getBoundingClientRect().height, bgH: pages[1].querySelector('.page__bg').getBoundingClientRect().height }; })()`);
check(view.pressed === "true" && view.toc?.length === 2 && view.toc.every((v) => /^\d+$/.test(v)), "the page view shows the contents after the cover, with page numbers", JSON.stringify(view.toc));
check(view.coverBg && view.pageBg && view.bgSize.startsWith("60%") && Math.abs(view.bgH - view.pageH) < 2, "the background picture is on every page, placed as chosen", JSON.stringify({ size: view.bgSize, bgH: view.bgH, pageH: view.pageH }));
check(view.head.includes("Cover headline") && view.head.includes("Confidential") && view.headLogo, "the header shows the cover title, the own text and the logo", view.head);
await shot("c2-pageview.png");
// (the preview button, not the first toggle: while the preview is open that one is "Print…")
await ev("document.querySelector('.gbar__preview').click()");

// --- record more ----------------------------------------------------------------------------------------------------------------
await ev("[...document.querySelectorAll('.headrow .gsplit__more')].pop().click()");
await sleep(400);
const areas = await ev("[...document.querySelectorAll('.pop__panel [role=menuitemradio]')].map((x) => [x.textContent.trim(), x.getAttribute('aria-checked')])");
check(areas.length === 5 && areas[0][0] === "Same as before" && areas[0][1] === "true", "record more steps offers the area again, the same as before first", JSON.stringify(areas));
await key("Escape");

// --- the export dialog ----------------------------------------------------------------------------------------------------------
await ev("document.querySelector('.bottombar__export').click()");
await sleep(600);
check(await ev("(() => { const rows = [...document.querySelectorAll('.export__row')]; return rows.some((r) => r.textContent.includes('Table of contents') && r.querySelector('[role=switch]').getAttribute('aria-checked') === 'true'); })()"), "the contents switch of the export follows the template");
for (const [scale, w, h] of [[1, 1280, 860], [1.25, 1024, 688], [1.5, 854, 574]]) {
  await size(w, h, scale);
  await sleep(500);
  for (const format of ["PDF", "Markdown"]) {
    await ev(`(() => { const s = document.querySelector('.export select'); const o = [...s.options].find((x) => x.textContent === ${JSON.stringify(format)}); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await sleep(300);
    const layout = await ev(`(() => { const d = document.querySelector('.dw-dialog').getBoundingClientRect(); const box = document.querySelector('.export'); const rows = [...box.querySelectorAll('.export__row')];
      const out = [...box.querySelectorAll('input, select, button, span')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > d.right - 8 || r.left < d.left + 8); }).length;
      const lefts = new Set(rows.map((r) => Math.round(r.children[1].getBoundingClientRect().left)));
      const widths = new Set(rows.map((r) => r.querySelector('select, input:not([type=checkbox])')).filter(Boolean).map((c) => Math.round(c.getBoundingClientRect().width)));
      return { out, lefts: [...lefts], widths: [...widths], sideways: box.scrollWidth > box.clientWidth, fits: d.bottom <= innerHeight && d.top >= 0 }; })()`);
    check(layout.out === 0 && !layout.sideways && layout.lefts.length === 1 && layout.widths.length === 1 && layout.fits, `export dialog at ${scale * 100} % (${format}): two aligned columns, nothing sticks out`, JSON.stringify(layout));
    if (format === "PDF") await shot(`c2-export-${scale * 100}.png`);
  }
}
await click("Cancel", "document.querySelector('.dw-dialog')");
await send("Emulation.clearDeviceMetricsOverride");
// The saved file opens again with the cover as written.
const file = path.resolve(out, "c2.snpd");
const last = await inv("doc_read");
await inv("doc_save", { path: file, asNew: true, document: last.document });
check(existsSync(file) && readFileSync(file).toString("utf8").includes("Cover headline"), "the guide is saved with its cover");
await inv("doc_close");
console.log(failed ? `${failed} check(s) FAILED` : "all checks passed");
process.exit(failed ? 1 : 0);
