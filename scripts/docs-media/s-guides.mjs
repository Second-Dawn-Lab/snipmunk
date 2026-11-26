// Documents mode: three guides recorded on the demo window (see recorder.mjs), the GIFs "a guide being recorded" and
// "Quick redact on a guide", and the pictures of the editor, the templates, the print preview and the export.
import { MAIN } from "./context.mjs";
import { sleep } from "./lib.mjs";
import { pointer } from "./pointer.mjs";
import { startRecording, WINDOW } from "./recorder.mjs";

const GIF = { width: 960, height: 600 };
const SETTINGS = { docStepMode: "auto", docRecordTyping: true, docRecordShortcuts: true, docStepPicture: "window", docArea: "active", docTemplate: "basic", docZoomDefault: false, docPanelWidth: 300, docPanelCollapsed: false, docFit: "none", docZoom: 80, recCountdown: 3 };

/** "Click **New note**" as the parts of a step text. */
const parts = (text) => text.split("**").map((t, i) => (i % 2 ? { t, b: true } : { t })).filter((p) => p.t);

/**
 * The recorder names the program of the demo window "Snipmunk" and its text boxes "the text field". The guide gets the
 * words a person would type over them (a normal edit of a step's text).
 */
async function retext(main, guide, title, texts) {
  const doc = guide.document;
  const steps = doc.blocks.filter((b) => b.type === "step");
  if (steps.length !== texts.length) throw new Error(`the guide has ${steps.length} steps, ${texts.length} expected: ${guide.steps.map((s) => s.text.map((p) => p.t).join("")).join(" / ")}`);
  steps.forEach((b, i) => (b.text = parts(texts[i])));
  doc.title = title;
  await main.invoke("doc_write", { document: doc });
}

/** The open guide in the editor, freshly loaded. */
async function openGuide(main) {
  await main.reload(3000);
  await main.ev(`[...document.querySelectorAll("button")].find((b) => b.textContent.startsWith("Recover guide"))?.click()`);
  await main.until(`document.querySelector("article.gstep")`);
  await sleep(2200);
}

const read = async (main) => (await main.invoke("doc_read")).document;

/** Brings element `i` of `selector` to the middle of the pages. */
const into = async (main, selector, i = 0, block = "center") => {
  await main.ev(`document.querySelectorAll(${JSON.stringify(selector)})[${i}]?.scrollIntoView({ block: ${JSON.stringify(block)} })`);
  await sleep(500);
};

async function home(ctx) {
  const { main } = ctx;
  await main.invoke("doc_close").catch(() => undefined);
  await ctx.mode("documents", SETTINGS);
  await ctx.png("guides-home", main);
  await main.click(".topbar .splitbtn__more");
  await sleep(400);
  await ctx.png("guide-area-menu", main);
  await main.escape();
  await main.click('.topbar [aria-label="Guide quick settings"]');
  await sleep(400);
  await ctx.png("guide-quick-settings", main);
  await main.escape();
}

/** The GIF of a guide being recorded: the demo window with the guide bar, then the guide that came out of it. */
async function recordingFilm(ctx) {
  const { main } = ctx;
  const gif = ctx.gif("guide-recording", { width: WINDOW.width, height: WINDOW.height + 76 });
  const rec = await startRecording(ctx, "notes", gif);
  await rec.click("new-note", "editor");
  await rec.click("title-field");
  await rec.type("title-field", "Release checklist", "titled");
  await rec.click("save", "kept");
  const guide = await rec.stop();
  await retext(main, guide, "Create a note", ["Click **New note** in Acme Notes", "Click the **Title** field", "Type **Release checklist** as the title", "Click **Save note**"]);
  await ctx.mode("documents", SETTINGS);
  await openGuide(main);
  await main.size(MAIN.width, MAIN.height, GIF.width / MAIN.width);
  await main.settings({ docZoom: 62 });
  await sleep(1500);
  await into(main, "article.gstep", 0, "start");
  await gif.add(main, 900);
  for (const i of [1, 2, 3]) {
    await into(main, "article.gstep", i);
    await gif.add(main, 450);
  }
  gif.hold(700);
  await main.size(MAIN.width, MAIN.height, MAIN.scale);
}

/** The GIF of Quick redact over a whole guide, on a guide whose pictures and texts hold (invented) sensitive values. */
async function redactFilm(ctx) {
  const { main } = ctx;
  const rec = await startRecording(ctx, "billing");
  await rec.click("download");
  await rec.click("nav-team", "team");
  await rec.click("invite", "share");
  const bar = await rec.bar.ev("({ w: innerWidth, h: innerHeight })");
  await rec.bar.size(bar.w, bar.h, 2);
  await sleep(400);
  await ctx.png("guide-bar", rec.bar);
  await rec.bar.sizeReset();
  await rec.click("email-field");
  await rec.type("email-field", "priya@acme-notes.example", "invited");
  await rec.click("invite", "team");
  const guide = await rec.stop();
  await retext(main, guide, "Send an invoice and invite a colleague", [
    "Click **Download invoice**",
    "Open **Team**",
    "Click **Invite person**",
    "Click the **E-mail address** field",
    "Type **priya@acme-notes.example**",
    "Click **Send invite**",
  ]);
  await ctx.mode("documents", { ...SETTINGS, docZoom: 70 });
  await openGuide(main);
  await main.size(MAIN.width, MAIN.height, GIF.width / MAIN.width);
  await into(main, "article.gstep", 0, "start");
  await main.ev(`[...document.querySelectorAll("button")].find((b) => b.textContent.includes("Quick redact whole guide"))?.scrollIntoView({ block: "center" })`);
  await sleep(1500);
  const gif = ctx.gif("guide-quick-redact", GIF);
  const p = pointer(main, gif, [560, 420]);
  await p.still(700);
  await p.toElement("button", "/^Quick redact whole guide/");
  await p.click(500);
  await p.toElement("dialog button, .dw-dialog button", "/^Scan$/", { steps: 4 });
  await p.press();
  await p.release();
  await main.until(`[...document.querySelectorAll("dialog button, .dw-dialog button")].some((b) => b.textContent.trim() === "Apply" && !b.disabled)`, 90000);
  await sleep(600);
  await p.still(1300);
  await p.hide();
  await ctx.png("guide-quick-redact-dialog", main);
  await p.toElement("dialog button, .dw-dialog button", "/^Apply$/", { steps: 4 });
  await p.click(900);
  await sleep(1500);
  await p.hide();
  await gif.add(main, 900);
  await into(main, "article.gstep", 1);
  await gif.add(main, 700);
  await into(main, "article.gstep", 3);
  await gif.add(main, 1100);
  await main.size(MAIN.width, MAIN.height, MAIN.scale);
}

/** The longer guide the editor pictures are taken with. */
async function editorPictures(ctx) {
  const { main } = ctx;
  const rec = await startRecording(ctx, "notes");
  await rec.click("new-note", "editor");
  await rec.click("title-field");
  await rec.type("title-field", "Release checklist", "titled");
  await rec.click("note-field");
  await rec.type("note-field", "Build, test, publish.");
  await rec.click("save", "saved");
  await rec.click("share", "share");
  await rec.click("email-field");
  await rec.type("email-field", "priya@acme-notes.example", "invited");
  await rec.click("invite", "saved");
  const guide = await rec.stop();
  await retext(main, guide, "Create and share a note", [
    "Click **New note** in Acme Notes",
    "Click the **Title** field",
    "Type **Release checklist** as the title",
    "Click the **Note** field",
    "Type **Build, test, publish.**",
    "Click **Save note**",
    "Click **Share**",
    "Click the **E-mail address** field",
    "Type **priya@acme-notes.example**",
    "Click **Send invite**",
  ]);
  const paragraph = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
  let doc = await read(main);
  doc.blocks.unshift({ id: "intro", type: "content", doc: { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Before you start" }] }, paragraph("This guide shows how to write a note in Acme Notes and share it with a colleague. All names and addresses are examples.")] } });
  const save = doc.blocks.filter((b) => b.type === "step")[5];
  save.desc = { type: "doc", content: [paragraph("The note is saved in the team notebook.")] };
  await main.invoke("doc_write", { document: doc });
  await ctx.mode("documents", { ...SETTINGS, docZoom: 70 });
  await openGuide(main);

  // The template gallery; "Corporate" is chosen.
  await main.size(MAIN.width, 860, MAIN.scale);
  await main.click(".gsplit__main");
  await sleep(900);
  await ctx.png("guide-templates", main);
  await main.clickText(".tplcard__use", "/Corporate$/");
  await sleep(700);
  // (choosing a template may leave the gallery open: close it then)
  await main.ev(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "OK")?.click()`);
  await main.size(MAIN.width, MAIN.height, MAIN.scale);
  await sleep(1200);
  doc = await read(main);
  Object.assign(doc.template.cover, { on: true, subtitle: "A short guide for the team", author: "Mia Example", date: true });
  doc.template.contents = true;
  await main.invoke("doc_write", { document: doc });

  // The cover, a whole page.
  await main.settings({ docFit: "page" });
  await openGuide(main);
  await main.ev(`document.querySelector(".gpage")?.scrollIntoView({ block: "start" })`);
  await sleep(1200);
  await ctx.png("guide-cover", main);

  // The pages with the steps.
  await main.settings({ docFit: "none", docZoom: 65 });
  await openGuide(main);
  await into(main, ".ProseMirror h2", 0, "start");
  await sleep(900);
  await ctx.png("guide-editor", main);

  // The tools of a step: a spotlight and a callout on "Click Share".
  const step = 6;
  await into(main, "article.gstep", step);
  await main.click("article.gstep .badge", step);
  await main.clickText(".gpanel__tab", "/^Step$/");
  await sleep(700);
  await into(main, "article.gstep", step);
  const pic = await main.ev(`(() => { const a = document.querySelectorAll("article.gstep")[${step}]; const r = (a.querySelector(".gpic") ?? a).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const share = ctx.state.guideMarks.share;
  const at = (x, y) => [pic.x + ((x + 1) / (WINDOW.width + 2)) * pic.w, pic.y + ((y + 1) / (WINDOW.height + 2)) * pic.h];
  await main.letter("s");
  await main.drag(at(share.x - 16, share.y - 12), at(share.x + share.w + 16, share.y + share.h + 12), { steps: 6 });
  await main.letter("o");
  await main.drag(at(share.x - 8, share.y + share.h + 4), at(share.x - 230, share.y + 170), { steps: 6 });
  await main.send("Input.insertText", { text: "Share it with your team" });
  await sleep(500);
  await main.escape();
  await main.escape();
  await sleep(900);
  if (!(await main.ev(`!!document.querySelector(".gpanel__tab[aria-selected=true]")`)) || !(await main.ev(`document.querySelectorAll("article.gstep")[${step}].classList.toString()`)).includes("sel")) {
    await main.click("article.gstep .badge", step);
  }
  await main.clickText(".gpanel__tab", "/^Step$/");
  await into(main, "article.gstep", step);
  await main.move(500, 20);
  await sleep(700);
  await ctx.png("guide-step-tools", main);
  await main.clickText(".gpanel__tab", "/^Tree$/");
  await sleep(900);
  await ctx.png("guide-tree", main);
  await main.clickText(".gpanel__tab", "/^Guide$/");

  // Print preview.
  await main.settings({ docFit: "page" });
  await sleep(500);
  await main.click(".gbar__preview");
  await sleep(3500);
  await ctx.png("guide-print-preview", main);
  await main.click(".gbar__preview");
  await sleep(1500);

  // Export: the dialog is looked at and closed; nothing is exported.
  await main.click(".bottombar__export, .bottombar .dw-btn--primary");
  await sleep(900);
  await main.ev(`document.querySelectorAll(".foldersetting__path").forEach((e) => { e.textContent = e.title = "C:\\\\Users\\\\Demo\\\\Documents\\\\Snipmunk"; })`);
  await ctx.png("guide-export", main);
  await main.escape();
  await sleep(500);
  await main.clickText(".bottombar button", "/^Copy as/");
  await sleep(500);
  await ctx.png("guide-copy-as", main);
  await main.escape();
}

/** The Documents home pictures and the two GIFs. */
export async function guideFilms(ctx) {
  await home(ctx);
  await recordingFilm(ctx);
  await redactFilm(ctx);
  await ctx.main.invoke("doc_close").catch(() => undefined);
}

/** The editor, template, print preview and export pictures. */
export async function guideEditor(ctx) {
  await editorPictures(ctx);
  await ctx.main.invoke("doc_close").catch(() => undefined);
}
