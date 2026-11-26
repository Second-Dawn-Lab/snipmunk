// What the documentation media script needs to drive a GUARDED test instance over the web view's debugging port.
//
// Safety, in this order:
//   1. nothing is done unless `dev_capture_guard` answers true (the instance never reads the real screen, sound, camera,
//      mouse or keyboard);
//   2. every call that would leave the instance (clipboard, share, drag out, file and folder pickers, opening other programs
//      or web pages) is answered by this script instead of the app, so the pictures can show the buttons being used without
//      anything happening on the computer;
//   3. pictures are taken of a window's own web content only (DevTools), never of the screen.
/* global URL, clearTimeout */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PORT = 9222;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Calls the page may not pass on to the app while pictures are taken, and what the page is told instead. */
const BLOCKED = [
  [/^export_clipboard$/, false],
  [/^(copy_text|copy_table|export_share|export_drag|export_open_editor|open_folder|show_in_explorer|open_url|open_os_settings)$/, null],
  [/^(open_file|pick_[a-z_]+)$/, null],
  [/^plugin(%3A|:)(dialog|updater|process|autostart)/, null],
  [/^(quit_app|restart_app|update_check|update_install)$/, null],
];

const CORS = [
  { name: "Access-Control-Allow-Origin", value: "*" },
  { name: "Access-Control-Allow-Headers", value: "*" },
  { name: "Access-Control-Expose-Headers", value: "Tauri-Response" },
  { name: "Tauri-Response", value: "ok" },
  { name: "Content-Type", value: "application/json" },
];

async function pages() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  return list.filter((t) => t.type === "page");
}

/** One window of the test instance. */
export class Page {
  constructor(target, ws) {
    this.target = target;
    this.ws = ws;
    this.next = 1;
    this.pending = new Map();
    this.blocked = [];
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.method === "Fetch.requestPaused") this.#paused(d.params);
      this.pending.get(d.id)?.(d);
      this.pending.delete(d.id);
    };
  }

  #paused({ requestId, request }) {
    const command = decodeURIComponent(new URL(request.url).pathname.slice(1));
    const rule = BLOCKED.find(([re]) => re.test(command));
    // (a request of a page that was left or closed meanwhile cannot be answered any more: nothing to do)
    const answer = (method, params) => this.send(method, { requestId, ...params }, 10000).catch(() => undefined);
    if (!rule) return void answer("Fetch.continueRequest");
    if (request.method === "POST") this.blocked.push(command);
    void answer("Fetch.fulfillRequest", { responseCode: 200, responseHeaders: CORS, body: Buffer.from(JSON.stringify(rule[1])).toString("base64") });
  }

  send(method, params = {}, timeout = 60000) {
    return new Promise((resolve, reject) => {
      const id = this.next++;
      const timer = setTimeout(() => reject(new Error(`no answer to ${method}`)), timeout);
      this.pending.set(id, (d) => {
        clearTimeout(timer);
        if (d.error) reject(new Error(`${method}: ${d.error.message}`));
        else resolve(d.result);
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async ev(expression, timeout) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeout);
    if (r.exceptionDetails) throw new Error(`${expression.slice(0, 120)} -> ${JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails).slice(0, 500)}`);
    return r.result?.value;
  }

  invoke(command, args = {}) {
    return this.ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`, 180000);
  }

  settings(patch) {
    return this.invoke("set_settings", { patch });
  }

  async until(expression, ms = 30000) {
    const start = Date.now();
    for (;;) {
      if (await this.ev(`!!(${expression})`)) return;
      if (Date.now() - start > ms) throw new Error("timed out: " + expression);
      await sleep(120);
    }
  }

  /** The window's size in CSS pixels and the scale the picture is taken at. */
  size(width, height, scale = 1) {
    return this.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
  }

  sizeReset() {
    return this.send("Emulation.clearDeviceMetricsOverride");
  }

  /** A picture of this window's own content. */
  async shot(file, clip) {
    const r = await this.send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { scale: 1, ...clip } } : {}) });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    return file;
  }

  rect(selector, index = 0) {
    return this.ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  }

  // Mouse and keys are events of this web view only; the computer's pointer and keyboard are not touched.
  mouse(type, x, y, more = {}) {
    return this.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...more });
  }

  move(x, y) {
    return this.mouse("mouseMoved", x, y, { button: "none" });
  }

  async clickAt(x, y, modifiers = 0) {
    await this.mouse("mouseMoved", x, y, { button: "none", modifiers });
    await this.mouse("mousePressed", x, y, { buttons: 1, modifiers });
    await this.mouse("mouseReleased", x, y, { modifiers });
    await sleep(350);
  }

  async click(selector, index = 0, modifiers = 0) {
    await this.ev(`document.querySelectorAll(${JSON.stringify(selector)})[${index}]?.scrollIntoView({ block: "nearest", inline: "nearest" })`);
    const r = await this.rect(selector, index);
    if (!r) throw new Error("nothing at " + selector);
    await this.clickAt(r.x + r.w / 2, r.y + r.h / 2, modifiers);
  }

  /** Click the first element of `selector` whose text (or label, or title) matches. */
  async clickText(selector, pattern) {
    const index = await this.ev(`[...document.querySelectorAll(${JSON.stringify(selector)})].findIndex((e) => ${pattern}.test(e.getAttribute("aria-label") || e.title || e.textContent.trim()))`);
    if (index < 0) throw new Error(`no ${selector} matching ${pattern}`);
    await this.click(selector, index);
  }

  /** Press, move in steps and release; `each` runs after every step (for the frames of a GIF). */
  async drag(from, to, { steps = 10, each, release = true } = {}) {
    await this.move(from[0], from[1]);
    await this.mouse("mousePressed", from[0], from[1], { buttons: 1 });
    for (let i = 1; i <= steps; i++) {
      await this.mouse("mouseMoved", from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps, { buttons: 1 });
      if (each) await each(i);
    }
    if (release) await this.mouse("mouseReleased", to[0], to[1]);
    await sleep(300);
  }

  async key(key, code, { text, modifiers = 0 } = {}) {
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key.length === 1 ? "Key" + key.toUpperCase() : key, windowsVirtualKeyCode: code, modifiers, ...(text ? { text } : {}) });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", key, windowsVirtualKeyCode: code, modifiers });
    await sleep(300);
  }

  letter(k) {
    return this.key(k, k.toUpperCase().charCodeAt(0), { text: k });
  }

  escape() {
    return this.key("Escape", 27);
  }

  /** Answer the blocked calls here from now on, and keep printing and file inputs from opening anything. */
  async guard() {
    await this.send("Fetch.enable", { patterns: [{ urlPattern: "*ipc.localhost*" }] });
    const script = `window.print = () => {}; document.addEventListener("click", (e) => { if (e.target?.closest?.('input[type="file"]') || e.target?.type === "file") e.preventDefault(); }, true);
      HTMLInputElement.prototype.showPicker = function () {};`;
    await this.send("Page.enable");
    await this.send("Page.addScriptToEvaluateOnNewDocument", { source: script });
    await this.ev(script);
  }

  async reload(ms = 3000) {
    await this.ev("location.reload()");
    await sleep(ms);
  }

  close() {
    this.ws.close();
  }
}

async function open(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("the debugging port refused the connection"));
  });
  return new Page(target, ws);
}

/** The window whose page says it is `kind` ("main", "settings", "overlay", "recbar", ...). Waits for it to appear. */
export async function connect(kind, ms = 20000) {
  const start = Date.now();
  for (;;) {
    for (const t of await pages()) {
      const p = await open(t);
      const is = await p.ev("document.documentElement.dataset.window").catch(() => null);
      if (is && (is === kind || is.startsWith(kind + "-"))) {
        await p.guard();
        return p;
      }
      p.close();
    }
    if (Date.now() - start > ms) throw new Error(`no "${kind}" window of a test instance on port ${PORT}`);
    await sleep(300);
  }
}

/** The main window, after the guard has been checked. Nothing is clicked without it. */
export async function connectMain() {
  const main = await connect("main");
  if ((await main.invoke("dev_capture_guard").catch(() => false)) !== true) {
    throw new Error("STOP: the instance has no no-real-capture guard (SNIPMUNK_NO_REAL_CAPTURE). Nothing was done.");
  }
  return main;
}

/** Windows of the test instance itself (never of another program): find, place, title, show. See win.ps1. */
export function ownWindow(action, args = {}) {
  const list = Object.entries(args).flatMap(([k, v]) => [`-${k}`, String(v)]);
  const out = execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(HERE, "win.ps1"), "-Action", action, ...list], { encoding: "utf8" });
  return out.trim() ? JSON.parse(out) : null;
}
