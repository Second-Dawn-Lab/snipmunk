// The settings window: the General, Screenshots and Documents pages. The folder shown is a demo folder; nothing is saved
// into it, and the instance's own folders are set again afterwards.
import { connect, ownWindow, sleep } from "./lib.mjs";

export async function settingsPages(ctx) {
  const { main } = ctx;
  // (the pictures show the settings as they are at first; nothing is captured while the clipboard switch is on)
  await main.settings({ autoSaveScreenshots: false, autoCopyToClipboard: true, docGuidesDir: "C:\\Users\\Demo\\Documents\\Snipmunk" });
  await main.invoke("open_settings", { tab: "general" });
  const page = await connect("settings");
  try {
    ownWindow("place", { Title: "*Settings", X: -6000, Y: 100 });
    await page.size(880, 640, 1.25);
    await page.until(`document.querySelector(".settings__tab")`);
    await sleep(900);
    await ctx.png("settings-general", page);
    for (const [tab, name] of [["Screenshots", "settings-screenshots"], ["Documents", "settings-documents"]]) {
      await page.clickText(".settings__tab", `/^${tab}$/`);
      await page.move(5, 5);
      await sleep(700);
      await ctx.png(name, page);
    }
  } finally {
    await page.ev(`void window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "settings" })`).catch(() => undefined);
    await sleep(400);
    page.close();
    await main.settings({ ...ctx.folders, autoCopyToClipboard: false });
  }
}
