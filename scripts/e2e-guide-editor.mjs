// End-to-end checks of the guide editor in a DEVELOPMENT test instance (generated guide, no real screen, keyboard or mouse):
//   B1 every "+" opens the insert menu and inserts at its own place (between blocks 3 and 4, and at the end)
//   B2 Alt+Down moves the selected block and the view stays still (scrollTop unchanged)
//   B3 a guide of 150 steps: no layout shift while the pictures load, the scroll position is what was set (a scrollbar drag does not jump)
//   B5 a click anywhere on a step selects it
// Start the test instance with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 and its data/temp folders in a
// scratch folder, then: node scripts/e2e-guide-editor.mjs
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
    pending.set(id, (d) => (d.result?.exceptionDetails ? rej(new Error(JSON.stringify(d.result.exceptionDetails).slice(0, 400))) : res(d.result?.result?.value)));
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const invoke = (cmd, args = {}) => ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`);
let failed = 0;
const check = (ok, what, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${extra ? "  " + extra : ""}`);
  if (!ok) failed++;
};

await invoke("set_settings", { patch: { captureKind: "documents" } });
await invoke("dev_guide_seed", { count: 150 });
await ev("location.reload()");
await sleep(3500);
await ev("(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.startsWith('Recover guide')); if (b) b.click(); })()");
await sleep(4000);

// --- B3: no layout shift while pictures load; the scroll position is what was set ---------------------------------------------------
const shift = await ev(`(async () => {
  const list = document.querySelector('.glist');
  let cls = 0;
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value; }).observe({ type: 'layout-shift', buffered: false });
  const h0 = list.scrollHeight;
  const jumps = [];
  // a scrollbar drag from the top to the bottom and back in 60 steps
  for (let i = 0; i <= 120; i++) {
    const f = i <= 60 ? i / 60 : (120 - i) / 60;
    const want = Math.round(f * (list.scrollHeight - list.clientHeight));
    list.scrollTop = want;
    await new Promise((r) => requestAnimationFrame(r));
    if (Math.abs(list.scrollTop - want) > 1) jumps.push([i, want, list.scrollTop]);
  }
  await new Promise((r) => setTimeout(r, 800));
  return { h0, h1: list.scrollHeight, cls, jumps: jumps.length, steps: document.querySelectorAll('.gstep').length, loaded: [...document.querySelectorAll('.gpic img')].filter((i) => i.complete && i.naturalWidth > 0).length };
})()`);
check(shift.steps === 150, "150 steps are in the list", JSON.stringify(shift));
check(shift.h0 === shift.h1, "the height of the list did not change while the pictures loaded", `${shift.h0} -> ${shift.h1}`);
check(shift.cls < 0.02, "no layout shift while loading and scrolling", `CLS ${shift.cls.toFixed(4)}`);
check(shift.jumps === 0, "the scroll position is what was set (a drag does not jump)", `${shift.jumps} jumps`);

// --- B1: every + inserts at its own place ------------------------------------------------------------------------------------------
await ev("document.querySelector('.glist').scrollTop = 0");
const insertAt = async (gitemIndex, label) => {
  const before = await ev("document.querySelectorAll('.glist .gitem').length");
  await ev(`(() => { const g = document.querySelectorAll('.glist .gitem')[${gitemIndex}]; const p = g.querySelector('.ginsert__plus'); p.scrollIntoView({ block: 'center' }); p.click(); })()`);
  await sleep(300);
  const vis = await ev(`(() => { const it = document.querySelector('.ginsert__menu .ginsert__item'); if (!it) return 'no menu'; const r = it.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return top && (top === it || it.contains(top)) && r.top >= 0 && r.bottom <= innerHeight ? 'visible' : 'covered'; })()`);
  check(vis === "visible", `${label}: the insert menu opens and is not clipped`, vis);
  await ev("[...document.querySelectorAll('.ginsert__item')].find((b) => b.textContent === 'Text block').click()");
  await sleep(500);
  return before;
};
// between blocks 3 and 4 = the bar inside the third item
await insertAt(2, "between blocks 3 and 4");
let kinds = await ev("[...document.querySelectorAll('.glist .gitem > article')].slice(0, 6).map((a) => a.classList.contains('gcontent') ? 'text' : 'step')");
check(kinds.join() === "step,step,step,text,step,step", "the text block is the 4th block", kinds.join());
// at the end
const countBefore = await ev("document.querySelectorAll('.glist .gitem').length");
await ev("(() => { const l = document.querySelector('.glist'); l.scrollTop = l.scrollHeight; })()");
await sleep(300);
await ev("(() => { const g = [...document.querySelectorAll('.glist .gitem')].pop(); g.querySelector('.ginsert__plus').click(); })()");
await sleep(300);
await ev("[...document.querySelectorAll('.ginsert__item')].find((b) => b.textContent === 'Text block').click()");
await sleep(500);
const last = await ev("(() => { const a = [...document.querySelectorAll('.glist .gitem > article')]; return [a.length, a[a.length - 1].classList.contains('gcontent')]; })()");
check(last[0] === countBefore + 1 && last[1] === true, "a text block was added at the end", JSON.stringify(last));

// --- B5: a click anywhere on a step selects it ----------------------------------------------------------------------------------------
await ev("document.querySelector('.glist').scrollTop = 0");
await sleep(300);
const sel = await ev(`(async () => {
  const a = document.querySelectorAll('.glist .gstep')[5];
  a.scrollIntoView({ block: 'center' });
  await new Promise((r) => setTimeout(r, 400));
  const pic = a.querySelector('.gpic');
  const r = pic.getBoundingClientRect();
  pic.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 20, clientY: r.top + 20 }));
  await new Promise((r) => setTimeout(r, 200));
  return a.classList.contains('gblock--sel');
})()`);
check(sel === true, "a click on the picture selects the step");

// --- B2: Alt+Down moves the selected block and the view stays still ----------------------------------------------------------------------
// (a) a short block moves past another short block (two text blocks next to each other): it stays in view, so the scroll position must not change at all
await ev("document.querySelector('.glist').scrollTop = 0");
await insertAt(2, "a second text block between blocks 3 and 4");
const mvText = await ev(`(async () => {
  const list = document.querySelector('.glist');
  const a = document.querySelectorAll('.glist .gitem > article')[3];
  a.scrollIntoView({ block: 'center' });
  await new Promise((r) => setTimeout(r, 300));
  a.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  const id = a.dataset.block;
  const top = list.scrollTop;
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 400));
  const order = [...document.querySelectorAll('.glist .gitem > article')].map((x) => x.dataset.block);
  return { moved: order.indexOf(id), scrollDelta: Math.abs(list.scrollTop - top) };
})()`);
check(mvText.moved === 4 && mvText.scrollDelta <= 2, "Alt+Down moved a block that stays in view and the scroll position did not change", JSON.stringify(mvText));
// (b) a step taller than the view: if it leaves the view it is brought back by the minimum ("nearest"), never centred
const mvStep = await ev(`(async () => {
  const list = document.querySelector('.glist');
  const a = document.querySelectorAll('.glist .gstep')[5];
  a.scrollIntoView({ block: 'center' });
  await new Promise((r) => setTimeout(r, 400));
  const pic = a.querySelector('.gpic');
  const rr = pic.getBoundingClientRect();
  pic.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rr.left + 20, clientY: rr.top + 20 }));
  await new Promise((r) => setTimeout(r, 200));
  const id = a.dataset.block;
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 400));
  const el = list.querySelector('[data-block="' + id + '"]');
  const r = el.getBoundingClientRect(), v = list.getBoundingClientRect();
  const visible = r.bottom > v.top && r.top < v.bottom;
  const centred = Math.abs((r.top + r.bottom) / 2 - (v.top + v.bottom) / 2) < 10;
  return { visible, centred, flushWithEdge: Math.abs(r.top - v.top) < 3 || Math.abs(r.bottom - v.bottom) < 3 };
})()`);
check(mvStep.visible && !mvStep.centred && mvStep.flushWithEdge, "a moved step that left the view is brought back to the nearest edge, not centred", JSON.stringify(mvStep));

await invoke("doc_close");
console.log(failed ? `${failed} check(s) FAILED` : "all checks passed");
process.exit(failed ? 1 : 0);
