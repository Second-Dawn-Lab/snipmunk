// What the sections share: where pictures go, the list of pictures for images.py, and facts that a later section needs
// (kept in files, so that one section can be run again on its own).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ownWindow, sleep } from "./lib.mjs";

/** The size of the main window in the pictures: 1120 x 700 CSS pixels at 1.25 = 1400 x 875 pixels. */
export const MAIN = { width: 1120, height: 700, scale: 1.25 };

/** The folder that holds the repository: no picture may show a path below it. */
const WORKSPACE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Texts no picture may show: paths of the workspace and of the test instance. */
const PRIVATE = [WORKSPACE, WORKSPACE.replaceAll(path.sep, "/"), "_scratch", "target-test"];
/** Nor the names of the user and of the computer (looked for as whole words: a short name is part of ordinary words). */
const NAMES = [os.userInfo().username, os.hostname()].filter((n) => n.length > 2).map((n) => new RegExp(`(?<![\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu"));

/** The names of this computer's sound devices and cameras (only the lists are read; no device is opened). */
async function deviceNames(main) {
  const audio = await main.invoke("audio_devices");
  const cameras = await main.invoke("webcam_devices");
  return [...audio.mic.map((d) => ["Microphone", d.name]), ...audio.system.map((d) => ["Speakers", d.name]), ...cameras.map((d) => ["Camera", d.name])].filter(([, n]) => n);
}

/** Shows "Speakers", "Microphone" or "Camera" instead of the name of a device, in the picture only. */
const generic = (devices) => `(() => { for (const [kind, name] of ${JSON.stringify(devices)}) {
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (n.nodeValue.includes(name)) n.nodeValue = n.nodeValue.replaceAll(name, kind);
} })()`;

/**
 * Looks at everything a window shows as text (texts, fields, chosen options) and refuses the picture when something
 * private is in it. Text that is part of a picture is not read: the pictures still have to be looked at.
 */
async function checkPrivate(page, name, devices) {
  await page.ev(generic(devices));
  const text = await page.ev(`[document.body?.innerText ?? "", ...[...document.querySelectorAll("input, textarea")].map((e) => e.value + " " + e.placeholder),
    ...[...document.querySelectorAll("select")].map((e) => e.selectedOptions[0]?.textContent ?? ""), ...[...document.querySelectorAll("iframe")].map((f) => { try { return f.contentDocument.body.innerText; } catch { return ""; } })].join(" | ")`);
  const low = text.toLowerCase();
  const found = [...[...PRIVATE, ...devices.map(([, n]) => n)].filter((p) => low.includes(p.toLowerCase())), ...NAMES.map((n) => text.match(n)?.[0]).filter(Boolean)];
  // ... and any user folder but the demo one.
  const folder = text.match(/[a-z]:[\\/]+users[\\/]+(?!demo\b)[^\\/\s]+/i);
  if (found.length || folder) throw new Error(`PRIVATE TEXT in the window, picture "${name}" not taken: ${[...found, folder?.[0]].filter(Boolean).join(", ")}`);
}

export function makeContext(main, out) {
  fs.mkdirSync(path.join(out, "raw"), { recursive: true });
  const read = (name, fallback) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(out, name), "utf8"));
    } catch {
      return fallback;
    }
  };
  const manifest = read("manifest.json", { png: {}, gif: {} });
  const state = read("state.json", {});

  let devices = [];
  const ctx = {
    main,
    out,
    state,
    raw: (name) => path.join(out, "raw", name),
    /** Where the instance may write: the folder settings point here between the pictures (a demo path is only shown). */
    files: path.join(out, "files"),
    folders: { projectsDir: path.join(out, "files"), docGuidesDir: path.join(out, "files"), autoSaveDir: path.join(out, "files"), exportFolder: "", lastSaveFolder: "" },
    save() {
      fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 1));
      fs.writeFileSync(path.join(out, "state.json"), JSON.stringify(state, null, 1));
    },
    /** A picture of the documentation: docs/media/<name>.png. */
    async png(name, page, { clip, maxWidth = 1400 } = {}) {
      await checkPrivate(page, name, devices);
      const src = await page.shot(ctx.raw(`${name}.png`), clip);
      manifest.png[name] = { src, maxWidth };
      ctx.save();
      console.log("  picture", name);
      return src;
    },
    /** A picture made from bytes (not a window shot). */
    file(name, bytes, { maxWidth = 1400 } = {}) {
      const src = ctx.raw(`${name}.png`);
      fs.writeFileSync(src, bytes);
      manifest.png[name] = { src, maxWidth };
      ctx.save();
      console.log("  picture", name);
      return src;
    },
    /** The frames of docs/media/<name>.gif: `add(page, ms)` takes the next one, `hold(ms)` shows the last one longer. */
    gif(name, size) {
      const dir = ctx.raw(`gif-${name}`);
      fs.rmSync(dir, { recursive: true, force: true });
      const frames = [];
      manifest.gif[name] = { ...size, frames };
      return {
        async add(page, ms = 90, extra = {}) {
          await checkPrivate(page, name, devices);
          const src = await page.shot(path.join(dir, `${String(frames.length).padStart(4, "0")}.png`));
          frames.push({ src, ms, ...extra });
          ctx.save();
          return src;
        },
        /** A frame made of several windows: `[page, x, y]` each, drawn by images.py on a plain backdrop. */
        async layers(ms, list) {
          const placed = [];
          for (const [i, [page, x, y]] of list.entries()) {
            await checkPrivate(page, name, devices);
            const src = await page.shot(path.join(dir, `${String(frames.length).padStart(4, "0")}-${i}.png`));
            placed.push({ src, x, y });
          }
          frames.push({ ms, layers: placed });
          ctx.save();
        },
        hold(ms) {
          frames[frames.length - 1].ms += ms;
          ctx.save();
        },
      };
    },
    /** The same start for every run: English, light, demo-neutral settings, nothing recorded from the computer. */
    async prepare() {
      fs.mkdirSync(ctx.files, { recursive: true });
      devices = await deviceNames(main);
      await main.settings({ ...ctx.folders, language: "en", theme: "light", autoUpdateCheck: false, autoCopyToClipboard: false, autoSaveScreenshots: false, recSystemSound: false, recMic: false, webcamOn: false });
      // Off every monitor: the pictures come from the window's own content, so it does not need to be seen.
      ownWindow("place", { Title: "Snipmunk", X: -4000, Y: 100 });
      await main.size(MAIN.width, MAIN.height, MAIN.scale);
      await sleep(600);
    },
    /** The main window in one of its modes, freshly loaded. */
    async mode(captureKind, patch = {}) {
      await main.settings({ captureKind, ...patch });
      await main.reload(3500);
    },
  };
  return ctx;
}
