// Screenshots mode: the list with demo captures, annotation, copy, search, save, text recognition and Quick redact.
// The captures are the demo pictures, imported as files; nothing is captured and nothing reaches the clipboard.
import fs from "node:fs";
import { sleep } from "./lib.mjs";

const CAPTURES = [
  // (imported in this order: the last one is the newest and stands first in the list)
  ["billing", "Payment details"],
  ["activity", "Weekly activity"],
  ["tasks", "Release board"],
  ["team", "Team directory"],
  ["notes", "Sprint planning"],
];

/** Imports demo pictures as captures into the one list; returns the session. */
export async function seedCaptures(ctx, list = CAPTURES) {
  const { main } = ctx;
  await main.invoke("debug_seed_session", { count: 0 });
  let session = await main.invoke("get_current_session");
  const group = session.groups[0].id;
  for (const [page, name] of list) {
    const bytes = fs.readFileSync(ctx.raw(`demo-${page}.png`)).toString("base64");
    session = await main.ev(
      `window.__TAURI_INTERNALS__.invoke("import_image", Uint8Array.from(atob("${bytes}"), (c) => c.charCodeAt(0)), { headers: { "x-group-id": "${group}", "x-file-name": encodeURIComponent(${JSON.stringify(name + ".png")}) } })`,
    );
  }
  return session;
}

/** The marks of the "Sprint planning" capture, placed on the measured elements of the demo page. */
export function notesMarks(m) {
  const red = "#E53935";
  const line = { stroke: red, strokeOpacity: 100, strokeWidth: 5 };
  const q = m.question;
  const y = q.y + q.h / 2;
  const highlight = [];
  for (let x = q.x + 16; x <= q.x + 396; x += 28) highlight.push(x, y, 0.5);
  const li = m.li2;
  return {
    version: 1,
    crop: null,
    rotation: 0,
    flipH: false,
    flipV: false,
    items: [
      { id: "m1", type: "highlighter", points: highlight, color: "#FFEB3B", size: 26 },
      { id: "m2", type: "rect", x: li.x - 14, y: li.y - 5, w: 330, h: li.h + 10, rotation: 0, fill: "none", fillOpacity: 100, ...line },
      { id: "m3", type: "text", x: 800, y: 450, w: 250, h: 42, text: "Add a new note", fontSize: 30, color: red, background: false, rotation: 0, fixedWidth: false },
      { id: "m4", type: "arrow", x1: 1000, y1: 440, x2: m["new-note"].x + m["new-note"].w / 2, y2: m["new-note"].y + m["new-note"].h + 14, ...line },
      { id: "m5", type: "emoji", x: li.x + 330, y: li.y - 12, size: 44, char: "✅", rotation: 0 },
    ],
  };
}

/** Stores marks on a capture and gives it the matching thumbnail, with the app's own renderer. */
export async function annotate(ctx, captureId, annotations) {
  const { main } = ctx;
  await main.invoke("set_annotations", { captureId, annotations });
  await main.ev(`(async () => {
    const { renderCapture } = await import("/src/share/renderCapture.ts");
    const session = await window.__TAURI_INTERNALS__.invoke("get_current_session");
    const capture = session.groups[0].captures.find((c) => c.id === ${JSON.stringify(captureId)});
    const full = await renderCapture(session, capture);
    const small = document.createElement("canvas");
    small.width = 520;
    small.height = Math.round((full.height * 520) / full.width);
    small.getContext("2d").drawImage(full, 0, 0, small.width, small.height);
    const blob = await new Promise((r) => small.toBlob(r, "image/png"));
    await window.__TAURI_INTERNALS__.invoke("set_capture_thumbnail", new Uint8Array(await blob.arrayBuffer()), { headers: { "x-capture-id": encodeURIComponent(capture.id) } });
  })()`);
}

/** The pointer out of the way, so that no hover or tooltip is in a picture. */
const park = async (main) => {
  await main.move(700, 20);
  await sleep(600);
};

const card = (main, name) => main.clickText(".card", `/${name}/`).then(() => sleep(500));

/** Adds a capture to the selection, as Ctrl+click does (2 is the Ctrl key of a synthetic event). */
const ctrlCard = async (main, name) => {
  const index = await main.ev(`[...document.querySelectorAll(".card")].findIndex((c) => c.textContent.includes(${JSON.stringify(name)}))`);
  await main.click(".card", index, 2);
};

const choose = (main, label, value) =>
  main.ev(`(() => { const s = [...document.querySelectorAll("select")].find((x) => x.getAttribute("aria-label") === ${JSON.stringify(label)});
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, ${JSON.stringify(value)}); s.dispatchEvent(new Event("change", { bubbles: true })); })()`);

export async function screenshots(ctx) {
  const { main, state } = ctx;
  await ctx.mode("screenshot", { galleryView: "medium", defaultCopyMode: "separate", quickRedactWords: [], lastSaveFolder: "" });
  const session = await seedCaptures(ctx);
  const byName = Object.fromEntries(session.groups[0].captures.map((c) => [c.name, c]));
  await annotate(ctx, byName["Sprint planning"].id, notesMarks(state.marks.notes));
  await main.reload(5000);
  await main.until(`document.querySelectorAll(".card").length === ${CAPTURES.length}`);

  // The main window, with every capture selected: one click copies them all.
  await card(main, "Sprint planning");
  await main.clickText("button", "/^Select all$/");
  await park(main);
  await ctx.png("main-window", main);
  await main.settings({ theme: "dark" });
  await sleep(1200);
  await ctx.png("main-window-dark", main);
  await main.settings({ theme: "light" });
  await sleep(900);

  await main.clickText("button", "/^Clear all$/");
  await main.click(".topbar .splitbtn__more");
  await ctx.png("capture-mode-menu", main);
  await main.escape();
  await main.click(".topbar .filemenu");
  await ctx.png("file-menu", main);
  await main.escape();

  // Annotation tools.
  await main.clickText(".annobar button", "/^Shapes/");
  await sleep(600);
  await ctx.png("annotate", main);
  await main.clickText(".annobar button", "/^Select/");
  await main.click('.annobar [aria-label="Pen options"]');
  await sleep(400);
  await ctx.png("annotate-pen", main);
  await main.escape();
  await main.reload(4500);

  // Several captures, one copy.
  await card(main, "Sprint planning");
  await ctrlCard(main, "Team directory");
  await ctrlCard(main, "Release board");
  await choose(main, "Copy mode", "grid");
  await park(main);
  await ctx.png("select-and-copy", main);
  await choose(main, "Copy mode", "separate");

  // The picture "Copy → Grid" makes, drawn by the app's own code (nothing is put on the clipboard).
  const grid = await main.ev(`(async () => {
    const { drawCapture, finalSize } = await import("/src/share/renderCapture.ts");
    const { gridLayout } = await import("/src/share/compose.ts");
    const session = await window.__TAURI_INTERNALS__.invoke("get_current_session");
    const list = ["Sprint planning", "Team directory", "Release board", "Weekly activity"].map((n) => session.groups[0].captures.find((c) => c.name === n));
    const layout = gridLayout(list.map(finalSize));
    const canvas = document.createElement("canvas");
    canvas.width = layout.width;
    canvas.height = layout.height;
    const g = canvas.getContext("2d");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, canvas.width, canvas.height);
    for (const p of layout.items) await drawCapture(session, list[p.index], g, p.x, p.y);
    return canvas.toDataURL("image/png").split(",")[1];
  })()`, 120000);
  ctx.file("copy-grid", Buffer.from(grid, "base64"), { maxWidth: 1200 });

  // Save, and search. The folder shown is a demo folder; the dialog is looked at and closed, nothing is saved.
  await main.settings({ lastSaveFolder: "C:\\Users\\Demo\\Pictures" });
  await main.escape();
  await main.clickText(".bottombar button", "/^Save/");
  await sleep(500);
  await ctx.png("save-dialog", main);
  await main.escape();
  await main.settings({ lastSaveFolder: "" });
  await main.click('input[placeholder="Search captures"]');
  await main.send("Input.insertText", { text: "release" });
  await sleep(2500);
  await ctx.png("search", main);
  await main.reload(4500);

  // Text recognition.
  await card(main, "Team directory");
  await main.escape();
  await main.clickText(".annobar button", "/^Text actions/");
  await main.until(`[...document.querySelectorAll("button")].some((b) => b.textContent.includes("Copy all text") && !b.disabled)`, 60000);
  await sleep(2500);
  const lines = await main.ev(`[...document.querySelectorAll(".ocrword")].map((s) => { const r = s.getBoundingClientRect(); return { t: s.textContent, x: r.x, y: r.y, w: r.width, h: r.height }; })`);
  const first = lines.find((l) => /^Mia/.test(l.t));
  const last = [...lines].reverse().find((l) => /0182|0167/.test(l.t));
  if (first && last) await main.drag([first.x + 1, first.y + first.h / 2], [last.x + last.w - 1, last.y + last.h / 2]);
  else console.log("  note: the text lines to select were not found", lines.length);
  await sleep(600);
  await ctx.png("text-actions", main);

  // Quick redact, before and after.
  await main.reload(4500);
  await card(main, "Payment details");
  await main.escape();
  await park(main);
  await ctx.png("quick-redact-before", main);
  await main.clickText(".annobar button", "/^Text actions/");
  await main.until(`[...document.querySelectorAll("button")].some((b) => b.textContent.includes("Copy all text") && !b.disabled)`, 60000);
  await sleep(2500);
  await main.click(".splitbtn__main.tool--labelled");
  await sleep(3000); // (the picture is read again after the redactions)
  await main.clickText("button", "/^Close this toolbar$/");
  await sleep(4500); // (the notice goes away)
  await park(main);
  await ctx.png("quick-redact-after", main);
  state.redacted = await main.ev(`(async () => { const s = await window.__TAURI_INTERNALS__.invoke("get_current_session"); return s.groups[0].captures.find((c) => c.name === "Payment details").annotations?.items?.length ?? 0; })()`);
  console.log("  redactions:", state.redacted);
  await main.clickText(".annobar button", "/^Text actions/");
  await sleep(1000);
  await main.click(".splitbtn__more", 1);
  await sleep(500);
  await ctx.png("quick-redact-types", main);
  await main.escape();
}
