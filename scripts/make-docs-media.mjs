// Makes the screenshots and GIF frames of the documentation from a GUARDED development test instance, with invented demo
// content only. How to start the instance and run this: docs/media/README.md.
//
//   node scripts/make-docs-media.mjs <work folder> [section ...]
//   sections: assets screenshots overlay recording films editor settings   (none given: all of them, in this order)
//
// Raw pictures and frames are written below the work folder; scripts/docs-media/images.py then writes docs/media/.
import path from "node:path";
import { makeContext } from "./docs-media/context.mjs";
import { connectMain } from "./docs-media/lib.mjs";
import { assets } from "./docs-media/s-assets.mjs";
import { guideEditor, guideFilms } from "./docs-media/s-guides.mjs";
import { overlay } from "./docs-media/s-overlay.mjs";
import { recording } from "./docs-media/s-recording.mjs";
import { screenshots } from "./docs-media/s-screenshots.mjs";
import { settingsPages } from "./docs-media/s-settings.mjs";

const SECTIONS = { assets, screenshots, overlay, recording, films: guideFilms, editor: guideEditor, settings: settingsPages };

const [out, ...only] = process.argv.slice(2);
if (!out) throw new Error("usage: node scripts/make-docs-media.mjs <work folder> [section ...]");
const unknown = only.filter((n) => !SECTIONS[n]);
if (unknown.length) throw new Error(`unknown section: ${unknown.join(", ")} (known: ${Object.keys(SECTIONS).join(" ")})`);

const main = await connectMain(); // (refuses an instance without the guard)
const ctx = makeContext(main, path.resolve(out));
await ctx.prepare();
for (const name of only.length ? only : Object.keys(SECTIONS)) {
  console.log(`--- ${name}`);
  await SECTIONS[name](ctx);
  ctx.save();
}
main.close();
console.log("done");
