// Drives the measurement instance of Snipmunk (a release build with the cargo feature "measure-guard") through the states of
// scripts/measure-memory.ps1, over the web view's debugging port. It refuses an instance without the guard.
//   node scripts/measure-drive.mjs <port> <action> [argument]
import { spawn } from "node:child_process";

const [port, action, argument] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The main window's page, once it answers. */
async function connect() {
  for (let i = 0; i < 120; i++) {
    const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => []);
    for (const t of targets.filter((x) => x.type === "page")) {
      const ws = new WebSocket(t.webSocketDebuggerUrl);
      await new Promise((r, no) => ((ws.onopen = r), (ws.onerror = no))).catch(() => null);
      if (ws.readyState !== 1) continue;
      let n = 0;
      const pending = new Map();
      ws.onmessage = (m) => {
        const d = JSON.parse(m.data);
        pending.get(d.id)?.(d);
      };
      const send = (method, params = {}) => new Promise((res) => (pending.set(++n, res), ws.send(JSON.stringify({ id: n, method, params }))));
      const ev = async (expression) => {
        const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
        return r.result?.result?.value;
      };
      if ((await ev("document.documentElement.dataset.window").catch(() => null)) === "main" && (await ev("!!document.querySelector('.shell')").catch(() => false))) return { send, ev, ws };
      ws.close();
    }
    await sleep(500);
  }
  throw new Error("no main window answered on the debugging port");
}

const page = await connect();
const { ev, send } = page;
const invoke = (command, args = {}) => ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`);
if ((await invoke("dev_capture_guard").catch(() => false)) !== true) {
  console.error("STOP: this instance has no capture guard");
  process.exit(2);
}
const until = async (expression, seconds = 60) => {
  for (let i = 0; i < seconds * 5; i++) {
    if (await ev(expression).catch(() => false)) return;
    await sleep(200);
  }
  throw new Error(`timed out: ${expression}`);
};
const settings = (patch) => invoke("set_settings", { patch });
const emit = (event, payload) => invoke("plugin:event|emit", { event, payload });
const click = (expression) => ev(`(() => { const e = ${expression}; if (!e) return false; e.click(); return true; })()`);
const key = async (k, code, modifiers = 0) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, windowsVirtualKeyCode: code, modifiers });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, windowsVirtualKeyCode: code, modifiers });
};
const path = (p) => p.replace(/\//g, "\\");

const actions = {
  guard: async () => "guarded",
  prepare: async () => settings({ language: "en", captureKind: "screenshot", recCountdown: 0, recSystemSound: false, recMic: false, webcamOn: false, closeAction: "quit" }),
  /** A generated recording of `argument` seconds (the real encoder on a generated picture). */
  record: async () => {
    await settings({ captureKind: "video" });
    await invoke("start_recording", { mode: "rectangle", window: "__synthetic__" });
    await until("window.__TAURI_INTERNALS__.invoke('recording_state').then((s) => s.recording)", 30);
    await sleep(Number(argument) * 1000);
    await invoke("stop_recording");
    await until("!!document.querySelector('.recplayer')", 90);
  },
  /** The current recording becomes a project file, and is no longer the current one. */
  saveProject: async () => {
    const current = await invoke("current_recording");
    await invoke("project_save", { captureId: current, path: path(argument) });
    await invoke("discard_current_recording");
  },
  seedCaptures: async () => {
    await settings({ captureKind: "screenshot" });
    await invoke("debug_seed_session", { count: Number(argument) });
    await until(`document.querySelectorAll('.panel--left img').length > 0`);
    await sleep(1500);
    await click("document.querySelector('.panel--left img')?.closest('button,[role=option],li,div')");
  },
  /** A guide of `argument`'s steps, saved to a file (the preparation run). */
  makeGuide: async () => {
    const [count, file] = argument.split("|");
    await settings({ captureKind: "documents" });
    await invoke("doc_close").catch(() => undefined);
    await invoke("dev_guide_seed", { count: Number(count) });
    await ev("location.reload()");
    await sleep(4000);
    const again = await connect();
    page.ws.close();
    page.ws = again.ws;
    await again.ev("(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.startsWith('Recover guide')); b?.click(); })()");
    await sleep(6000);
    await again.ev(`(async () => { const r = await window.__TAURI_INTERNALS__.invoke('doc_read'); await window.__TAURI_INTERNALS__.invoke('doc_save', { path: ${JSON.stringify(path(file))}, asNew: true, document: r.document }); await window.__TAURI_INTERNALS__.invoke('doc_close'); })()`);
  },
  openProject: async () => {
    await settings({ captureKind: "video" });
    await sleep(500);
    await emit("open-project", path(argument));
    await until("!!document.querySelector('.recplayer')", 90);
  },
  closeProject: async () => {
    await key("w", 87, 2);
    await sleep(500);
  },
  openGuide: async () => {
    await settings({ captureKind: "documents" });
    await sleep(500);
    await emit("open-guide", path(argument));
    await until("document.querySelectorAll('.gstep').length > 10 && Number(document.querySelector('.gpage')?.dataset.pages) > 1", 120);
  },
  /** Export the open guide as PDF through its dialog. */
  exportPdf: async () => {
    if (!(await click("document.querySelector('.bottombar__export')"))) throw new Error("no Export button");
    await until("!!document.querySelector('.export select')", 20);
    await ev("(() => { const s = document.querySelector('.export select'); const o = [...s.options].find((x) => x.textContent === 'PDF'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true })); })()");
    await sleep(300);
    await click("document.querySelector('.dw-dialog .dw-btn--primary')");
    await until("!!document.querySelector('.export__done')", 240);
  },
  closeExport: async () => click("document.querySelector('.dw-dialog .dw-btn--primary')"),
  /** Milliseconds from the start of a capture to the picture on the overlay, with a generated screenshot on an overlay far
      off every monitor. "fresh" destroys a kept overlay before each time. */
  overlayTiming: async () => {
    const times = [];
    for (let i = 0; i < 8; i++) {
      times.push(await invoke("dev_overlay_timing", { fresh: argument === "fresh" }));
      await sleep(1500);
    }
    return times.join(" ");
  },
  minimize: async () => invoke("plugin:window|minimize", { label: "main" }),
  /** Bring the main window back (as the toast's button does). */
  show: async () => invoke("toast_open"),
  // (the page may be gone before it answers)
  quit: async () => {
    await Promise.race([invoke("quit_app").catch(() => undefined), sleep(500)]);
  },
  /** Quit, and start the program again `argument` = "ms|exe" milliseconds later, while it may still be on its way out. */
  quitAndStart: async () => {
    const [ms, exe] = argument.split("|");
    void invoke("quit_app").catch(() => undefined);
    await sleep(Number(ms));
    spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
    await sleep(300);
  },
  /** Where the main page's start-up time went (milliseconds from the start of its loading). */
  pageTiming: async () =>
    ev(`(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const at = (n) => Math.round(n);
      const files = performance.getEntriesByType('resource').filter((r) => /\\.(js|css)$|ipc\\.localhost/.test(r.name)).map((r) => r.name.split('/').pop() + ' ' + at(r.startTime) + '-' + at(r.responseEnd));
      return ['response ' + at(nav.responseEnd), 'DOM ready ' + at(nav.domContentLoadedEventEnd), 'first paint ' + performance.getEntriesByType('paint').map((p) => p.name + ' ' + at(p.startTime)).join(', ')].concat(files).join('\\n');
    })()`),
  eval: async () => ev(argument),
};

if (!actions[action]) throw new Error(`unknown action ${action}`);
const result = await actions[action]();
if (result !== undefined && result !== null) console.log(typeof result === "string" ? result : JSON.stringify(result));
// (leaving at once while the connection closes trips an assertion of Node on Windows)
page.ws.close();
setTimeout(() => process.exit(0), 250);
