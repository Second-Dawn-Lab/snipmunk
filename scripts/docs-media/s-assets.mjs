// The demo pictures: every page of "Acme Notes", drawn by a window of the test instance (its settings window, whose
// content is replaced) and measured, so that later marks and clicks land on the right things.
import fs from "node:fs";
import { desktop, PAGES } from "./demo.mjs";
import { connect, ownWindow, sleep } from "./lib.mjs";

export const DEMO = { width: 1280, height: 800 };

/** Opens the settings window as a demo window and returns it; `show(name)` puts a demo page into it. */
export async function demoWindow(main) {
  await main.invoke("open_settings", { tab: null });
  const page = await connect("settings");
  ownWindow("place", { Title: "*Settings", X: -6000, Y: 100 });
  const { frameTree } = await page.send("Page.getFrameTree");
  const frameId = frameTree.frame.id;
  page.html = async (html) => {
    await page.send("Page.setDocumentContent", { frameId, html });
    await sleep(250);
  };
  page.show = (name) => page.html(PAGES[name]());
  /** The rectangles of the marked elements of the page on show, in CSS pixels. */
  page.marks = () =>
    page.ev(`Object.fromEntries([...document.querySelectorAll("[data-mark]")].map((e) => { const r = e.getBoundingClientRect(); return [e.dataset.mark, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }]; }))`);
  page.closeWindow = async () => {
    // (not awaited: the window that would answer is the one that goes)
    await page.ev(`void window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "settings" })`).catch(() => undefined);
    await sleep(400);
    page.close();
    await sleep(600);
  };
  return page;
}

export async function assets(ctx) {
  const page = await demoWindow(ctx.main);
  await page.size(DEMO.width, DEMO.height, 1);
  ctx.state.marks = {};
  for (const name of Object.keys(PAGES)) {
    await page.show(name);
    ctx.state.marks[name] = await page.marks();
    await page.shot(ctx.raw(`demo-${name}.png`));
  }
  // An invented desktop with the demo window on it, for the selection overlay (1920 x 1080).
  await page.size(1920, 1080, 1);
  const inner = "data:image/png;base64," + fs.readFileSync(ctx.raw("demo-activity.png")).toString("base64");
  await page.html(desktop(inner));
  await sleep(500);
  await page.shot(ctx.raw("demo-desktop.png"));
  await page.sizeReset();
  await page.closeWindow();
}
