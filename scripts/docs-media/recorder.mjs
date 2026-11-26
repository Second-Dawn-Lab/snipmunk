// Records a guide through the app's own step recorder, on a demo window of the instance: the recorder pictures that window
// only, and gets its clicks and keys from this script (no mouse or keyboard hook; the computer's own are never used).
// Windows is asked for names only at the points given here, so before every click it is checked that the point lies on a
// window of the test instance.
import { PAGES } from "./demo.mjs";
import { connect, ownWindow, sleep } from "./lib.mjs";
import { pointer } from "./pointer.mjs";
import { demoWindow } from "./s-assets.mjs";

export const WINDOW = { width: 960, height: 640 };
const BAR_ROOM = 76; // (the band above the window in the GIF, where the guide bar is drawn)

/**
 * `first` is the page the demo window starts with. Returns the recorder: `click(mark, nextPage)`, `type(mark, text,
 * nextPage)` and `stop()`. With `gif`, every step also adds frames (the demo window and the guide bar).
 */
export async function startRecording(ctx, first, gif = null) {
  const { main } = ctx;
  await main.invoke("doc_close").catch(() => undefined);
  const demo = await demoWindow(main);
  await demo.show(first);
  const placed = () => ownWindow("place", { Title: "Acme Notes", X: 240, Y: 200, Width: WINDOW.width, Height: WINDOW.height, Top: "" });
  ownWindow("place", { Title: "*Settings", NewTitle: "Acme Notes" });
  const at = placed();
  await sleep(600);
  const dpr = await demo.ev("devicePixelRatio");
  await main.invoke("dev_guide_start", { hwnd: at.hwnd });
  await main.invoke("dev_guide_bar", { show: true });
  const bar = await connect("guidebar");
  await bar.until(`document.querySelector(".floatbar")`);
  await sleep(700);
  const barSize = await bar.ev("({ w: innerWidth, h: innerHeight })");

  const film = gif && {
    add: (_, ms) => gif.layers(ms, [[demo, 0, BAR_ROOM], [bar, Math.round((WINDOW.width / dpr - barSize.w) / 2), Math.round((BAR_ROOM - barSize.h) / 2)]]),
    hold: (ms) => gif.hold(ms),
  };
  const drawn = film ? pointer(demo, film, [WINDOW.width * 0.55, WINDOW.height * 0.72]) : null;
  if (drawn) await drawn.still(600);

  /** The point of a marked element: on the desktop for the recorder, in the page for the drawn pointer. */
  const point = async (mark) => {
    const r = (await demo.marks())[mark];
    if (!r) throw new Error(`the page has no element marked "${mark}"`);
    (ctx.state.guideMarks ??= {})[mark] = r;
    const css = [r.x + Math.min(r.w / 2, 130), r.y + r.h / 2];
    return { css, screen: [Math.round(at.x + css[0] * dpr), Math.round(at.y + css[1] * dpr)] };
  };

  async function click(mark, next) {
    const p = await point(mark);
    if (drawn) {
      await drawn.to(...p.css, { steps: 4 });
      await drawn.press();
      await drawn.release();
      await drawn.hide();
    }
    placed(); // (on top again, and where it was)
    await sleep(450); // (the recorder's newest picture is the page as it is now, without the drawn pointer)
    if (!ownWindow("check", { Points: p.screen.join(",") }).own) throw new Error("another window covers the demo window: nothing was clicked");
    await main.invoke("dev_guide_inject", { events: [{ type: "mouse", button: "left", x: p.screen[0], y: p.screen[1] }, { type: "wait", ms: 900 }] });
    if (next) await demo.html(PAGES[next]());
    await sleep(350);
    if (drawn) await drawn.still(380);
  }

  /** Types into the marked field (after a click on it): key by key to the recorder, and shown in the field. */
  async function type(mark, text, next) {
    const shift = { shift: true };
    const key = (c) => {
      if (/[a-z]/.test(c)) return { vk: c.toUpperCase().charCodeAt(0) };
      if (/[A-Z]/.test(c)) return { vk: c.charCodeAt(0), mods: shift };
      if (/[0-9]/.test(c)) return { vk: c.charCodeAt(0) };
      const other = { " ": [0x20], "@": [0x32, shift], ".": [0xbe], ",": [0xbc], "-": [0xbd] }[c];
      if (!other) throw new Error(`no key for "${c}"`);
      return { vk: other[0], ...(other[1] ? { mods: other[1] } : {}) };
    };
    await main.invoke("dev_guide_inject", { events: [...text].map((c) => ({ type: "key", layout: "en", ...key(c) })) });
    const set = (value) => demo.ev(`(() => { const f = document.querySelector('[data-mark="${mark}"]'); f.value = ${JSON.stringify(value)}; })()`);
    if (drawn) {
      for (let n = 3; n < text.length; n += 4) {
        await set(text.slice(0, n));
        await drawn.still(70);
      }
    }
    await set(text);
    await sleep(350);
    if (drawn) await drawn.still(300);
    if (next) await demo.html(PAGES[next]());
  }

  async function stop() {
    await sleep(900);
    if (drawn) {
      await drawn.hide();
      await film.add(demo, 600);
    }
    await main.invoke("guide_stop");
    await main.invoke("dev_guide_bar", { show: false });
    bar.close();
    await demo.closeWindow();
    return main.invoke("doc_read");
  }

  return { click, type, stop, bar };
}
