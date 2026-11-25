// End-to-end check of templates and export in a DEVELOPMENT test instance (generated guide only; the clipboard is not touched):
//   a guide with N generated steps (annotations, a redaction, a template with a picture frame), a content block with a table, an
//   image, a link and Arabic text -> every format written to a scratch folder through the app's own code -> the files are checked:
//   PDF exists with one sheet per page and no step on two pages, fonts and text maps embedded; DOCX headings, pictures, table,
//   contents field, header and footer; Markdown links resolve; HTML self-contained; no original pixel under a redaction.
// Start the test instance (dev server) with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 and its data, temp and
// templates folders in a scratch folder, then: node scripts/e2e-guide-export.mjs <scratch folder> [steps]
import fs from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { strFromU8, unzipSync } from "../node_modules/fflate/esm/index.mjs";

const out = process.argv[2];
if (!out) throw new Error("usage: node scripts/e2e-guide-export.mjs <scratch folder> [steps]");
const STEPS = Number(process.argv[3] || 6);
fs.rmSync(path.join(out, "export"), { recursive: true, force: true });
const dir = path.resolve(out, "export");
fs.mkdirSync(dir, { recursive: true });

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
const invoke = async (cmd, args = {}) => {
  const r = await ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}).then((v) => ({ v }), (e) => ({ e: JSON.stringify(e) }))`);
  if (r.e) throw new Error(`${cmd}: ${r.e}`);
  return r.v;
};
// (a test instance must never be able to capture the real desktop: asked before anything is clicked)
if ((await ev("window.__TAURI_INTERNALS__.invoke('dev_capture_guard').catch(() => false)")) !== true) throw new Error("STOP: the test instance has no no-real-capture guard");
let failed = 0;
const check = (ok, what, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${extra ? "  " + extra : ""}`);
  if (!ok) failed++;
};

await invoke("set_settings", { patch: { captureKind: "documents" } });
await invoke("dev_guide_seed", { count: STEPS });

// the guide document: template with a 16:9 frame, annotations and a redaction on step 1, a content block, Arabic text
const setup = `(async () => {
  const inv = window.__TAURI_INTERNALS__.invoke;
  const model = await import('/src/docs/model.ts');
  const apply = await import('/src/docs/template/apply.ts');
  const tm = await import('/src/docs/template/model.ts');
  const all = await inv('doc_read');
  const steps = new Map(all.steps.filter((s) => !s.deleted).map((s) => [s.n, s]));
  let doc = model.createDocument('Export test guide', Date.now(), [...steps.values()], { marker: { left: '#FF5A36', right: '#3B82F6', shape: 'circle', size: 'medium' }, badge: 'circle', picture: 'window', keepFull: false, zoomDefault: false });
  const c = document.createElement('canvas'); c.width = 300; c.height = 160; const x = c.getContext('2d'); x.fillStyle = '#2a9d8f'; x.fillRect(0, 0, 300, 160); x.fillStyle = '#fff'; x.font = '28px sans-serif'; x.fillText('Generated', 70, 90);
  const img = await inv('doc_add_image', { base64Data: c.toDataURL('image/png').split(',')[1] });
  const logo = await inv('doc_add_image', { base64Data: c.toDataURL('image/png').split(',')[1] });
  const cell = (type, t, w) => ({ type, attrs: { colwidth: [w] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
  doc = model.insertBlock(doc, 0, { id: 'c1', type: 'content', doc: { type: 'doc', content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Before you start' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Read ' }, { type: 'text', text: 'the manual', marks: [{ type: 'link', attrs: { href: 'https://example.com/manual' } }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'مرحباً بكم في الدليل' }] },
    { type: 'image', attrs: { src: 'x', file: img.name, alt: 'Generated', nw: 300, nh: 160 } },
    { type: 'table', content: [ { type: 'tableRow', content: [cell('tableHeader', 'Key', 120), cell('tableHeader', 'Value', 200)] }, { type: 'tableRow', content: [cell('tableCell', 'a', 120), cell('tableCell', 'b', 200)] } ] },
  ] } });
  const first = doc.blocks[1];
  first.redact = [{ rect: [100, 100, 200, 100], kind: 'black' }];
  first.annotations = [{ id: 'a1', kind: 'arrow', x: 600, y: 300, x2: 800, y2: 420, color: '#FF00FF', width: 4 }, { id: 'a2', kind: 'rect', x: 500, y: 200, x2: 700, y2: 300, color: '#00FF00', width: 4 }];
  first.desc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A description of the first step.' }] }] };
  const tpl = JSON.parse(JSON.stringify(tm.BUILT_INS.find((t) => t.id === 'corporate')));
  tpl.frame.ratio = '16:9'; tpl.logo = logo.name;
  doc = apply.applyTemplate(doc, tpl);
  await inv('doc_write', { document: doc });
  window.__e2e = { doc, steps };
  return { blocks: doc.blocks.length, steps: steps.size };
})()`;
const made = await ev(setup);
check(made.steps === STEPS && made.blocks === STEPS + 1, "the guide is set up", JSON.stringify(made));

// the redacted area has no original pixel in the exported picture
const pixels = await ev(`(async () => {
  const pic = await import('/src/docs/export/pictures.tsx');
  const apply = await import('/src/docs/template/apply.ts');
  const { doc, steps } = window.__e2e;
  const b = doc.blocks[1];
  const img = await pic.stepImage(steps.get(b.n), b, doc, { markers: false, annotations: false, jpeg: null });
  const view = apply.shownRect(steps.get(b.n), b, doc).view;
  const i = new Image(); i.src = img.src; await i.decode();
  const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0);
  const k = i.width / view[2];
  const r = [Math.ceil((100 - view[0]) * k) + 2, Math.ceil((100 - view[1]) * k) + 2, Math.floor(200 * k) - 4, Math.floor(100 * k) - 4];
  const d = x.getImageData(r[0], r[1], r[2], r[3]).data;
  let other = 0; for (let p = 0; p < d.length; p += 4) if (d[p] || d[p + 1] || d[p + 2]) other++;
  return { other, checked: d.length / 4, view, size: [i.width, i.height] };
})()`);
check(pixels.checked > 1000 && pixels.other === 0, "every pixel under the redaction is black in the exported picture", JSON.stringify(pixels));
check(Math.abs(pixels.view[2] / pixels.view[3] - 16 / 9) < 0.01, "the picture has the frame's ratio", JSON.stringify(pixels.view));

const exportAs = (format, file, extra = "{}") =>
  ev(`(async () => {
    const run = await import('/src/docs/export/run.ts');
    const { doc, steps } = window.__e2e;
    const c = { ...run.DEFAULT_CHOICES, format: '${format}', cover: true, toc: true, ...${extra} };
    const locale = { lang: 'en', rtl: false, contents: 'Contents', pagePattern: 'Page {n} of {of}', stepPattern: 'Step {n}', date: 'Test date' };
    const t0 = performance.now();
    const data = await run.buildData({ doc, steps }, doc, c, locale);
    const bytes = await run.writeExport(${JSON.stringify(file.replace(/\\/g, "/")).replace(/\//g, "\\\\")}, data, c, locale);
    const ms = Math.round(performance.now() - t0);
    let pages = null;
    if ('${format}' === 'pdf') { const pg = await import('/src/docs/export/paginate.ts'); const p = await pg.paginate(data); const where = {}; p.contents.forEach((ids, i) => ids.forEach((id) => (where[id] = (where[id] || []).concat(i)))); pages = { count: p.pages.length, split: Object.entries(where).filter(([, v]) => v.length > 1).length, steps: doc.blocks.filter((b) => b.type === 'step').filter((b) => (where['b-' + b.id] || []).length === 1).length }; }
    return { ms, bytes, pages };
  })()`);

const f = (name) => path.join(dir, name);
const html = await exportAs("html", f("guide.html"));
const docx = await exportAs("docx", f("guide.docx"));
const md = await exportAs("md", f("guide.md"));
const zip = await exportAs("md", f("guide-zip.zip"), "{ mdZip: true }");
const pdf = await exportAs("pdf", f("guide.pdf"));
const jpg = await exportAs("pdf", f("guide-small.pdf"), "{ jpeg: 0.8 }");
for (const [name, r] of Object.entries({ html, docx, md, zip, pdf, "pdf (JPEG)": jpg })) console.log(`TIME  ${name}: ${r.ms} ms, ${(r.bytes / 1024).toFixed(0)} KB`);

// HTML
const h = fs.readFileSync(f("guide.html"), "utf8");
const embedded = (h.match(/<img [^>]*src="data:image\/(png|jpeg);base64,/g) || []).length;
check(embedded === STEPS + 2, `HTML embeds ${STEPS + 2} pictures`, String(embedded));
check(!/src="(?!data:)/.test(h) && !/<script|url\(\s*["']?https?:|@import/i.test(h), "HTML has no outside address and no script");
check(h.includes('class="toc toc--') && h.includes('class="cover cover--') && h.includes("<table"), "HTML has the cover, the contents and the table");

// Markdown
const m = fs.readFileSync(f("guide.md"), "utf8");
const links = [...m.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((x) => decodeURIComponent(x[1]));
check(links.length === STEPS + 1 && links.every((l) => fs.existsSync(path.join(dir, l))), "Markdown links resolve to files", `${links.length}`);
check(m.includes("| Key | Value |") && m.includes("[the manual](https://example.com/manual)"), "Markdown has the table and the link");
const z = unzipSync(fs.readFileSync(f("guide-zip.zip")));
check(Object.keys(z).filter((k) => k.endsWith(".png")).length === STEPS + 1 && !!z["guide-zip.md"], "the ZIP holds the text and the pictures");

// DOCX
const d = unzipSync(fs.readFileSync(f("guide.docx")));
const body = strFromU8(d["word/document.xml"]);
const media = Object.keys(d).filter((k) => k.startsWith("word/media/")).length;
check((body.match(/<w:drawing>/g) || []).length === STEPS + 2 && media >= 1, "DOCX has the pictures inline", `${(body.match(/<w:drawing>/g) || []).length} drawings, ${media} files`);
check(body.includes('w:val="Heading1"') && body.includes("<w:tbl>") && /TOC [^<]*\\h/.test(body) && body.includes("<w:bidi/>"), "DOCX has a heading, the table, the contents field and right-to-left text");
const hf = Object.keys(d).filter((k) => /word\/(header|footer)\d*\.xml/.test(k)).map((k) => strFromU8(d[k])).join("");
check(hf.includes("PAGE") && hf.includes("NUMPAGES"), "DOCX header and footer have page numbers");

// PDF
const p = fs.readFileSync(f("guide.pdf"));
const text = p.toString("latin1");
const sheets = (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length;
check(text.startsWith("%PDF-") && sheets === pdf.pages.count, "the PDF has one sheet per page", `${sheets} sheets, ${pdf.pages.count} pages`);
check(pdf.pages.split === 0 && pdf.pages.steps === STEPS, "no step is on two pages", JSON.stringify(pdf.pages));
let maps = 0;
for (const s of text.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
  try {
    if (inflateSync(Buffer.from(s[1], "latin1")).toString("latin1").includes("beginbfchar") || inflateSync(Buffer.from(s[1], "latin1")).toString("latin1").includes("beginbfrange")) maps++;
  } catch {
    /* not a compressed stream */
  }
}
check(maps > 0 && /\/FontFile2/.test(text), "the PDF embeds its fonts and has text maps (the text can be read out)", `${maps} maps`);
check(/\/Subtype\s*\/Link/.test(text), "the PDF has links");

// the .snpd with the template: opens again with it, minor version 1
const file = path.join(dir, "guide.snpd").replace(/\\/g, "/");
await ev(`(async () => { const apply = await import('/src/docs/template/apply.ts'); const { doc, steps } = window.__e2e; await window.__TAURI_INTERNALS__.invoke('doc_save', { path: ${JSON.stringify(file)}, asNew: true, document: apply.materializeFrames(doc, steps) }); })()`);
await invoke("doc_close");
await invoke("doc_open", { path: file });
const back = await invoke("doc_read");
check(back.document?.template?.id === "corporate" && back.document.blocks[1].frame && !back.document.blocks[1].redact, "the .snpd carries the template and the frames, the redaction burned in");

// own templates
const mine = await invoke("templates_save", { template: { ...back.document.template, id: "", name: "Team template" } });
const list = await invoke("templates_list");
check(list.some((t) => t.id === mine.id && t.name === "Team template"), "an own template is saved and listed");
await invoke("templates_export", { id: mine.id, path: path.join(dir, "team.snpt") });
const imported = await invoke("templates_import", { path: path.join(dir, "team.snpt") });
check(imported.id !== mine.id && imported.name === "Team template", "a template file is imported again");
await invoke("templates_delete", { id: mine.id });
await invoke("templates_delete", { id: imported.id });
await invoke("doc_close");

// the editor shows the template, the page view shows pages
await invoke("dev_guide_seed", { count: 3 });
await ev("location.reload()");
await sleep(3500);
await ev("(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.startsWith('Recover guide')); if (b) b.click(); })()");
await sleep(2500);
await ev("document.querySelector('.headrow .gbar__preview').click()");
await sleep(4000);
const view = await ev("(() => { const f = document.querySelector('iframe.pageview'); return f ? f.contentDocument.querySelectorAll('.page').length : 0; })()");
check(view >= 1, "the page view shows pages", String(view));
await invoke("doc_close");
console.log(failed ? `${failed} check(s) FAILED` : "all checks passed");
process.exit(failed ? 1 : 0);
