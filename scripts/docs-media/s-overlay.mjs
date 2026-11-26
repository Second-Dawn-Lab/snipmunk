// The selection overlay (shown far off every monitor by the app's own timing command, with the invented desktop drawn on
// it instead of a screen picture) and the GIF "capture, annotate, copy all".
import fs from "node:fs";
import { MAIN } from "./context.mjs";
import { connect, sleep } from "./lib.mjs";
import { pointer } from "./pointer.mjs";
import { seedCaptures } from "./s-screenshots.mjs";

/** The overlay of the instance with the invented desktop on it; `css` is its width (the picture is 1920 wide). */
async function demoOverlay(ctx, scale) {
  await ctx.main.invoke("dev_overlay_timing", { fresh: true });
  const page = await connect("overlay");
  await page.size(1280, 720, scale);
  const bytes = fs.readFileSync(ctx.raw("demo-desktop.png")).toString("base64");
  await page.ev(`(async () => {
    const picture = await createImageBitmap(await (await fetch("data:image/png;base64,${bytes}")).blob());
    document.querySelector(".overlay__frozen").getContext("2d").drawImage(picture, 0, 0);
  })()`);
  await sleep(500);
  return page;
}

/** The area around the numbers and the chart of the demo window, in desktop pixels (the window's content starts at 300, 134). */
function area(marks) {
  const c = marks.activity.chart;
  return { x: 300 + c.x - 24, y: 134 + marks.activity.stat2.y - 22, w: c.w + 48, h: c.y + c.h - marks.activity.stat2.y + 44 };
}

export async function overlay(ctx) {
  const { main, state } = ctx;
  const box = area(state.marks);
  const css = (x, y) => [(x * 2) / 3, (y * 2) / 3];

  let page = await demoOverlay(ctx, 1.125);
  await page.drag(css(box.x, box.y), css(box.x + box.w, box.y + box.h), { steps: 12, release: false });
  await ctx.png("capture-overlay", page);
  await page.escape();
  page.close();

  // --- the GIF: capture an area, draw on it, copy everything -------------------------------------------------------------
  await ctx.mode("screenshot", { galleryView: "medium", defaultCopyMode: "separate" });
  await seedCaptures(ctx, [
    ["tasks", "Release board"],
    ["team", "Team directory"],
    ["notes", "Sprint planning"],
  ]);
  await main.size(MAIN.width, MAIN.height, 960 / MAIN.width);
  await main.reload(5000);
  const gif = ctx.gif("capture-annotate-copy", { width: 960, height: 600 });
  const m = pointer(main, gif, [520, 330]);
  await m.still(400);
  await m.toElement(".topbar button", "/^Add capture/", { steps: 5 });
  await m.press();
  await m.release();

  page = await demoOverlay(ctx, 0.75);
  const o = pointer(page, gif, css(box.x - 60, box.y - 40));
  await o.still(250);
  await o.to(...css(box.x, box.y), { steps: 3 });
  await o.press();
  await o.to(...css(box.x + box.w, box.y + box.h), { steps: 11, held: true });
  gif.hold(250);
  await o.hide();
  await page.escape();
  page.close();

  // The selected area becomes the newest capture, as after a capture.
  const crop = await main.ev(`(async () => {
    const picture = await createImageBitmap(await (await fetch("data:image/png;base64,${fs.readFileSync(ctx.raw("demo-desktop.png")).toString("base64")}")).blob(), ${box.x}, ${box.y}, ${box.w}, ${box.h});
    const c = document.createElement("canvas");
    c.width = picture.width; c.height = picture.height;
    c.getContext("2d").drawImage(picture, 0, 0);
    return c.toDataURL("image/png").split(",")[1];
  })()`);
  const group = (await main.invoke("get_current_session")).groups[0].id;
  await main.ev(`window.__TAURI_INTERNALS__.invoke("import_image", Uint8Array.from(atob("${crop}"), (c) => c.charCodeAt(0)), { headers: { "x-group-id": "${group}", "x-file-name": "Weekly%20activity.png" } })`);
  await main.reload(4000);
  await main.clickText(".card", "/Weekly activity/");
  await main.escape();
  await sleep(700);
  const p = pointer(main, gif, [700, 520]);
  await p.still(450);

  // An arrow on the new capture.
  await p.toElement(".annobar button", "/^Shapes/");
  await p.click(500);
  await p.toElement(".annobar button", "/^Arrow/", { steps: 4 });
  await p.click(300);
  const stage = await main.ev(`(() => { const r = [...document.querySelectorAll("canvas")].map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0]; return [r.x, r.y, r.width, r.height]; })()`);
  const on = (fx, fy) => [stage[0] + stage[2] * fx, stage[1] + stage[3] * fy];
  await p.to(...on(0.74, 0.3), { steps: 5 });
  await p.press();
  await p.to(...on(0.55, 0.47), { steps: 9, held: true });
  await p.release();
  await sleep(400);
  await p.still(250);

  // Everything at once.
  await p.toElement("button", "/^Select all$/");
  await p.click(500);
  await p.toElement(".bottombar button", "/^Copy the selected/");
  await p.click(150);
  // (the app draws the four pictures; the clipboard call itself is answered by this script, so nothing is copied)
  await main.until(`/captures copied/.test(document.body.innerText)`, 60000);
  await sleep(250);
  await p.still(1500);
  console.log("  held back:", main.blocked.join(" "));
  await p.hide();
  await main.size(MAIN.width, MAIN.height, MAIN.scale);
}
