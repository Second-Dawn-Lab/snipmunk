// Recording mode. The project that is shown is made here from nothing real: a video drawn from the demo pages, a drawn
// "test camera" (no person), and a cursor track written by this script. Only the floating bar comes from a recording, and
// that one records the app's generated test pattern.
import fs from "node:fs";
import { zipSync, strToU8 } from "fflate";
import { demoWindow } from "./s-assets.mjs";
import { connect, ownWindow, sleep } from "./lib.mjs";

const LENGTH = 8000;
const SIZE = { width: 1280, height: 800 };

/** Runs in the demo window: draws both videos and the pointer picture; returns them as base64. */
const FILM = `async ({ pages, marks, length }) => {
  const load = async (b64) => createImageBitmap(await (await fetch("data:image/png;base64," + b64)).blob());
  const img = {};
  for (const [k, v] of Object.entries(pages)) img[k] = await load(v);
  const screen = Object.assign(document.createElement("canvas"), { width: 1280, height: 800 });
  const cam = Object.assign(document.createElement("canvas"), { width: 640, height: 360 });
  document.body.append(screen, cam);
  const s = screen.getContext("2d"), c = cam.getContext("2d");
  const title = "Release checklist";
  const drawScreen = (t) => {
    const page = t < 2000 ? "notes" : t < 4900 ? "editor" : t < 6500 ? "written" : "saved";
    s.drawImage(img[page], 0, 0);
    if (page === "editor" && t > 3200) {
      const f = marks.editor["title-field"];
      s.fillStyle = "#fff"; s.fillRect(f.x + 3, f.y + 3, f.w - 6, f.h - 6);
      s.fillStyle = "#1f2433"; s.font = '15px "Segoe UI"'; s.textBaseline = "middle";
      s.fillText(title.slice(0, Math.floor((t - 3200) / 85)) + (t % 600 < 300 ? "|" : ""), f.x + 13, f.y + f.h / 2 + 1);
    }
  };
  const circle = (x, y, r, colour) => { c.fillStyle = colour; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); };
  const drawCam = (t) => {
    const g = c.createLinearGradient(0, 0, 640, 360); g.addColorStop(0, "#0f766e"); g.addColorStop(1, "#1e3a8a");
    c.fillStyle = g; c.fillRect(0, 0, 640, 360);
    const bob = Math.sin(t / 450) * 6;
    c.fillStyle = "#f59e0b"; c.beginPath(); c.ellipse(320, 390 + bob, 170, 120, 0, 0, 7); c.fill();
    circle(320, 165 + bob, 92, "#fde68a");
    const blink = t % 2600 < 140;
    c.fillStyle = "#1f2937";
    for (const x of [288, 352]) { if (blink) c.fillRect(x - 11, 150 + bob, 22, 4); else circle(x, 152 + bob, 10, "#1f2937"); }
    c.strokeStyle = "#1f2937"; c.lineWidth = 7; c.lineCap = "round"; c.beginPath(); c.arc(320, 180 + bob, 38, 0.25, Math.PI - 0.25); c.stroke();
    c.fillStyle = "#ffffffcc"; c.font = 'bold 22px "Segoe UI"'; c.textAlign = "center"; c.fillText("TEST CAMERA", 320, 40);
  };
  const record = (canvas, draw) => new Promise((resolve) => {
    draw(0);
    const type = ["video/mp4;codecs=avc1.640028", "video/mp4;codecs=avc1.4D0028", "video/mp4"].find((x) => MediaRecorder.isTypeSupported(x));
    const r = new MediaRecorder(canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 3_000_000 });
    const parts = [];
    r.ondataavailable = (e) => parts.push(e.data);
    r.onstop = () => { const f = new FileReader(); f.onload = () => resolve(f.result.split(",")[1]); f.readAsDataURL(new Blob(parts, { type: "video/mp4" })); };
    r.start();
    const t0 = performance.now();
    const tick = () => { const t = performance.now() - t0; draw(t); if (t < length) setTimeout(tick, 30); else r.stop(); };
    tick();
  });
  const [screenFile, camFile] = await Promise.all([record(screen, drawScreen), record(cam, drawCam)]);
  drawScreen(0);
  const arrow = Object.assign(document.createElement("canvas"), { width: 32, height: 32 });
  const a = arrow.getContext("2d");
  const p = new Path2D("M2 2 L2 23 L7.5 18 L11.5 27 L15.5 25.2 L11.6 16.6 L19 16 Z");
  a.fillStyle = "#fff"; a.fill(p); a.strokeStyle = "#111"; a.lineWidth = 1.5; a.lineJoin = "round"; a.stroke(p);
  return { screenFile, camFile, thumb: screen.toDataURL("image/png").split(",")[1], arrow: arrow.toDataURL("image/png").split(",")[1] };
}`;

/** The pointer of the demo recording: where it goes and when it clicks (ms, pixels of the video). */
function cursorTrack(marks) {
  const mid = (m) => [m.x + m.w / 2, m.y + m.h / 2];
  const stops = [
    [0, [640, 520]],
    [700, [640, 520]],
    [1900, mid(marks.notes["new-note"])],
    [2300, mid(marks.notes["new-note"])],
    [2900, mid(marks.editor["title-field"])],
    [5400, mid(marks.editor["title-field"])],
    [6400, mid(marks.written.save)],
    [LENGTH, mid(marks.written.save)],
  ];
  const clicks = [2000, 3050, 6500];
  const lines = [
    { type: "header", version: 1, ...SIZE, fps: 30 },
    { t: 0, shape: "s1", hx: 2, hy: 2, w: 32, h: 32, file: "cursors/s1.png" },
  ];
  const events = [];
  for (let t = 0; t <= LENGTH; t += 33) {
    const i = Math.max(1, stops.findIndex(([at]) => at >= t));
    const [[t0, p0], [t1, p1]] = [stops[i - 1], stops[i]];
    const k = Math.min(1, Math.max(0, (t - t0) / (t1 - t0 || 1)));
    const e = k * k * (3 - 2 * k);
    events.push({ t, x: Math.round(p0[0] + (p1[0] - p0[0]) * e), y: Math.round(p0[1] + (p1[1] - p0[1]) * e), v: 1, s: "s1" });
  }
  for (const t of clicks) events.push({ t, b: "l", d: 1 }, { t: t + 90, b: "l", d: 0 });
  events.sort((a, b) => a.t - b.t);
  return [...lines, ...events].map((l) => JSON.stringify(l)).join("\n") + "\n";
}

async function makeProject(ctx) {
  const window = await demoWindow(ctx.main);
  await window.size(SIZE.width, SIZE.height, 1);
  await window.html("<!doctype html><body style='margin:0'></body>");
  const pages = Object.fromEntries(["notes", "editor", "written", "saved"].map((n) => [n, fs.readFileSync(ctx.raw(`demo-${n}.png`)).toString("base64")]));
  const film = await window.ev(`(${FILM})(${JSON.stringify({ pages, marks: ctx.state.marks, length: LENGTH })})`, 60000);
  await window.sizeReset();
  await window.closeWindow();
  const bytes = (b64) => new Uint8Array(Buffer.from(b64, "base64"));
  const json = (o) => strToU8(JSON.stringify(o));
  const effects = {
    cursor: { show: true, size: "1.5", halo: true, haloColor: "#FFD60A" },
    click: { kind: "ripple", left: "#3B82F6", right: "#F97316", size: "large" },
    webcam: { show: true, shape: "circle", size: "m", position: "bottom-right", x: 0.85, y: 0.8, border: "medium", borderColor: "#FFFFFF", syncMs: 0 },
    trim: { startMs: 0, endMs: null },
  };
  const entries = {
    "manifest.json": json({ format: "snipmunk.recording", version: 1, minor: 0, appVersion: "0.1.0" }),
    "recording.json": json({
      version: 1, name: "Create a note", screenFile: "screen.mp4", ...SIZE, fps: 30, quality: "standard", durationMs: LENGTH, frames: (LENGTH / 1000) * 30,
      startedAt: Date.now(), source: "window", cursorFile: "cursor.jsonl", webcamFile: "webcam.mp4", webcamStartMs: 0, effects,
    }),
    "screen.mp4": bytes(film.screenFile),
    "webcam.mp4": bytes(film.camFile),
    "cursor.jsonl": strToU8(cursorTrack(ctx.state.marks)),
    "cursors/s1.png": bytes(film.arrow),
    "thumbnail.png": bytes(film.thumb),
  };
  const file = ctx.raw("Create a note.snpr");
  fs.writeFileSync(file, zipSync(entries, { level: 0 }));
  return file;
}

/** Puts the playhead at a time by a click on the timeline, and waits for the picture. */
async function seek(main, seconds) {
  const r = await main.rect(".recplayer__timeline");
  await main.clickAt(r.x + (r.w * seconds * 1000) / LENGTH, r.y + r.h / 2);
  await sleep(900);
}

export async function recording(ctx) {
  const { main } = ctx;
  const file = await makeProject(ctx);
  // (system sound on, as at first: a guarded instance opens no sound device whatever the switch says)
  await ctx.mode("video", { projectsDir: "C:\\Users\\Demo\\Videos\\Snipmunk", recCountdown: 3, recFps: 30, recQuality: "standard", recSystemSound: true });
  try {
    // Opened and closed once, so that it stands in "Recent projects"; then opened from there, as a person would.
    const opened = await main.invoke("project_open", { path: file });
    await main.invoke("project_close", { id: opened.id, discard: true });
    await main.reload(4000);
    await ctx.png("recording-empty", main);
    await main.click('.topbar [aria-label="Recording options"]');
    await sleep(500);
    await ctx.png("recording-options", main);
    await main.escape();
    await main.clickText(".recempty__card, .recempty button", "/Create a note/");
    await main.until(`document.querySelector(".recplayer__timeline")`);
    await sleep(1500);
    await seek(main, 2.16);
    await ctx.png("recording-effects", main);

    // Split the recording and cut one part out.
    await main.click('.recplayer__editmenu > button');
    await main.clickText(".recplayer__menuitem", "/^Split/");
    await seek(main, 3.2);
    await main.clickText(".recplayer__chip", "/^Split/");
    await seek(main, 4.8);
    await main.clickText(".recplayer__chip", "/^Split/");
    await seek(main, 4.0);
    await main.clickText(".recplayer__chip", "/^Delete/");
    await sleep(500);
    await seek(main, 6.6);
    await ctx.png("recording-split", main);

    await main.clickText(".bottombar button", "/^Export/");
    await sleep(3500);
    // The dialog starts in the folder of the project, here a work folder: a demo folder is shown instead (the picture
    // only; nothing is exported).
    await main.ev(`document.querySelectorAll(".foldersetting__path").forEach((e) => { e.textContent = e.title = "C:\\\\Users\\\\Demo\\\\Videos\\\\Snipmunk"; })`);
    await ctx.png("recording-export", main);
    await main.escape();
    await sleep(500);
    // Close the tab (its edits are not kept).
    for (const p of (await main.invoke("project_recent")).filter((r) => r.name === "Create a note")) {
      const again = await main.invoke("project_open", { path: p.path });
      await main.invoke("project_close", { id: again.id, discard: true });
    }
    await main.reload(3500);

    // The floating bar of a running recording: the app records its generated test pattern, nothing of the screen.
    await main.settings({ recCountdown: 0, webcamOn: false });
    await main.invoke("start_recording", { mode: "rectangle", window: "__synthetic__" });
    await sleep(4200);
    const bar = await connect("recbar");
    await bar.until(`document.querySelector(".floatbar")`);
    const r = await bar.ev("({ w: innerWidth, h: innerHeight })");
    await bar.size(r.w, r.h, 2);
    await sleep(400);
    await ctx.png("recording-bar", bar);
    bar.close();
    await main.invoke("stop_recording");
    await sleep(2500);
    await main.invoke("discard_current_recording");
  } finally {
    if ((await main.invoke("recording_state")).recording) await main.invoke("stop_recording");
    ownWindow("restore", { Title: "Snipmunk" });
    ownWindow("place", { Title: "Snipmunk", X: -4000, Y: 100 });
    await main.settings({ ...ctx.folders, recCountdown: 3, recSystemSound: false });
    await sleep(500);
  }
}
