// A drawn pointer for the GIFs: pictures of a web view do not contain the mouse pointer, so one is drawn into the page
// where the next synthetic mouse event goes. It never takes a click.
const draw = (x, y, down) => `(() => {
  let p = document.getElementById("docs-pointer");
  if (!p) {
    p = document.createElement("div");
    p.id = "docs-pointer";
    p.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none";
    p.innerHTML = '<i style="position:absolute;left:-17px;top:-17px;width:34px;height:34px;border-radius:50%;background:#ffb30066;border:2px solid #ffb300"></i>' +
      '<svg width="24" height="30" viewBox="0 0 24 30" style="position:absolute;left:-2px;top:-2px"><path d="M2 2 L2 23 L7.5 18 L11.5 27 L15.5 25.2 L11.6 16.6 L19 16 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  }
  // (a dialog on show draws over everything else: the pointer goes inside it)
  const host = document.querySelector("dialog[open]") ?? document.body;
  if (p.parentElement !== host) host.appendChild(p);
  p.style.transform = "translate(${x}px, ${y}px)";
  p.querySelector("i").style.display = ${down} ? "block" : "none";
})()`;

/** A pointer for one page: it glides, drags and clicks with synthetic events and adds the frames to a GIF. */
export function pointer(page, gif, start = [600, 400]) {
  let at = start;
  const show = (x, y, down = false) => page.ev(draw(Math.round(x), Math.round(y), down));
  const ease = (t) => t * t * (3 - 2 * t);
  return {
    async still(ms) {
      await show(at[0], at[1]);
      await gif.add(page, ms);
    },
    /** Glide to a point (the button up, or held when `held`). */
    async to(x, y, { steps = 5, ms = 70, held = false } = {}) {
      const from = at;
      for (let i = 1; i <= steps; i++) {
        const t = ease(i / steps);
        const px = from[0] + (x - from[0]) * t;
        const py = from[1] + (y - from[1]) * t;
        await page.mouse("mouseMoved", px, py, held ? { buttons: 1 } : { button: "none" });
        await show(px, py, held);
        await gif.add(page, ms);
      }
      at = [x, y];
    },
    async toElement(selector, pattern, options) {
      const r = await page.ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => ${pattern}.test(x.getAttribute("aria-label") || x.title || x.textContent.trim())); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
      if (!r) throw new Error(`nothing matches ${selector} ${pattern}`);
      await this.to(r[0], r[1], options);
    },
    async press() {
      await page.mouse("mousePressed", at[0], at[1], { buttons: 1 });
      await show(at[0], at[1], true);
      await gif.add(page, 90);
    },
    async release() {
      await page.mouse("mouseReleased", at[0], at[1]);
      await show(at[0], at[1]);
    },
    async click(after = 300) {
      await this.press();
      await this.release();
      await new Promise((r) => setTimeout(r, after));
      await show(at[0], at[1]);
      await gif.add(page, 120);
    },
    hide: () => page.ev(`document.getElementById("docs-pointer")?.remove()`),
  };
}
