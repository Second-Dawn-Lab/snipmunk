import { describe, expect, it } from "vitest";
import { cfHtml, fileUrl, imagesHtml, planCopy, tempFileNames } from "./clipboardPayload";
import { GAP, gridColumns, gridLayout, stackLayout, tooLarge } from "./compose";
import { baseName, dateTimeName, exportNames, sanitizeName, uniqueName } from "./fileNames";

describe("stack", () => {
  it("puts captures top to bottom with a 16 px gap, each centred at its own width", () => {
    const l = stackLayout([{ w: 100, h: 50 }, { w: 60, h: 30 }, { w: 100, h: 20 }]);
    expect(l.width).toBe(100);
    expect(l.height).toBe(50 + GAP + 30 + GAP + 20);
    expect(l.items.map((i) => [i.x, i.y])).toEqual([[0, 0], [20, 66], [0, 112]]);
  });
  it("one capture is the capture, nothing is empty", () => {
    expect(stackLayout([{ w: 7, h: 9 }])).toMatchObject({ width: 7, height: 9 });
    expect(stackLayout([])).toEqual({ width: 0, height: 0, items: [] });
  });
});

describe("grid", () => {
  it("picks the columns from the count", () => {
    expect([1, 2, 4, 5, 9, 10, 40].map(gridColumns)).toEqual([1, 2, 2, 3, 3, 4, 4]);
  });
  it("sizes the cells of a row to its biggest capture and centres the captures", () => {
    const l = gridLayout([{ w: 100, h: 40 }, { w: 60, h: 80 }, { w: 50, h: 50 }]);
    // 3 captures: 2 columns. Row 1: cells 100 x 80. Row 2: one capture, centred under the 216 px row.
    expect(l.width).toBe(100 + GAP + 100);
    expect(l.height).toBe(80 + GAP + 50);
    expect(l.items[0]).toMatchObject({ x: 0, y: 20 });
    expect(l.items[1]).toMatchObject({ x: 100 + GAP + 20, y: 0 });
    expect(l.items[2]).toMatchObject({ x: (216 - 50) / 2, y: 80 + GAP });
  });
  it("keeps every capture inside the picture and apart from the others", () => {
    const sizes = Array.from({ length: 11 }, (_, i) => ({ w: 40 + i * 7, h: 30 + ((i * 13) % 40) }));
    const l = gridLayout(sizes);
    for (const a of l.items) {
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(a.x + a.w).toBeLessThanOrEqual(l.width);
      expect(a.y + a.h).toBeLessThanOrEqual(l.height);
    }
    for (const a of l.items) for (const b of l.items) {
      if (a.index >= b.index) continue;
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      expect(apart).toBe(true);
    }
  });
  it("knows what is too large", () => {
    expect(tooLarge(16384, 100)).toBe(false);
    expect(tooLarge(16385, 100)).toBe(true);
    expect(tooLarge(15000, 14000)).toBe(true);
  });
});

describe("copy plan", () => {
  const s = (w: number, h: number) => ({ w, h });
  it("Separate and a single capture copy the pictures themselves", () => {
    expect(planCopy("separate", [s(1, 1), s(1, 1)])).toEqual({ kind: "separate", count: 2 });
    expect(planCopy("grid", [s(5, 5)])).toEqual({ kind: "separate", count: 1 });
  });
  it("Stack and Grid compose; an extreme size is refused", () => {
    expect(planCopy("stack", [s(10, 10), s(10, 10)]).kind).toBe("composed");
    expect(planCopy("stack", Array.from({ length: 5 }, () => s(4000, 4000))).kind).toBe("tooLarge");
  });
});

describe("clipboard text", () => {
  it("makes file addresses with escaped names", () => {
    expect(fileUrl("C:\\Users\\Me\\a b#1.png")).toBe("file:///C:/Users/Me/a%20b%231.png");
  });
  it("builds the images HTML with escaped alt text", () => {
    expect(imagesHtml([{ path: "C:/t/a.png", width: 3, height: 2, alt: 'x"<y' }])).toContain('alt="x&quot;&lt;y"');
  });
  it("writes correct byte offsets in the HTML Format header", () => {
    const text = cfHtml("<p>Grüße</p>");
    const bytes = new TextEncoder().encode(text);
    const num = (k: string) => Number(new RegExp(`${k}:(\\d+)`).exec(text)?.[1]);
    const dec = (a: number, b: number) => new TextDecoder().decode(bytes.slice(a, b));
    expect(dec(num("StartFragment"), num("EndFragment"))).toBe("<p>Grüße</p>");
    expect(dec(num("StartHTML"), num("EndHTML"))).toMatch(/^<html>.*<\/html>$/s);
    expect(num("EndHTML")).toBe(bytes.length);
  });
  it("names the temp files uniquely and safely", () => {
    expect(tempFileNames(["a", "A", "b/c", "CON"])).toEqual(["a.png", "A (2).png", "b c.png", "_CON.png"]);
  });
});

describe("file names", () => {
  it("makes names Windows accepts", () => {
    expect(sanitizeName('a<b>c:d"e/f\\g|h?i*j')).toBe("a b c d e f g h i j");
    expect(sanitizeName("report. ")).toBe("report");
    expect(sanitizeName("NUL")).toBe("_NUL");
    expect(sanitizeName("com1.txt")).toBe("_com1.txt");
    expect(sanitizeName("   ")).toBe("Capture");
    expect(sanitizeName("x".repeat(300)).length).toBe(120);
    expect(sanitizeName("日本語のスクリーンショット")).toBe("日本語のスクリーンショット");
  });
  it("names by capture name, group + number + name and date and time", () => {
    const c = { name: "Document21", createdAt: new Date(2026, 10, 18, 20, 59, 28).getTime() };
    expect(baseName(c, { naming: "capture", groupName: "G", index: 0, count: 1 })).toBe("Document21");
    expect(baseName(c, { naming: "group", groupName: "Group 1", index: 0, count: 5 })).toBe("Group 1 - 01 - Document21");
    expect(baseName(c, { naming: "group", groupName: "Group 1", index: 99, count: 120 })).toBe("Group 1 - 100 - Document21");
    expect(baseName(c, { naming: "dateTime", groupName: "G", index: 0, count: 1 })).toBe("Screenshot 2026-11-18 205928");
    expect(dateTimeName(c.createdAt, "Bildschirmfoto")).toBe("Bildschirmfoto 2026-11-18 205928");
  });
  it("adds (2), (3) for names that are taken, in the batch and in the folder, ignoring case", () => {
    expect(uniqueName("a", "png", new Set(["A.png"]))).toBe("a (2).png");
    expect(uniqueName("a", "png", new Set(["a.png", "a (2).png"]))).toBe("a (3).png");
    const caps = [{ name: "Shot", createdAt: 0 }, { name: "Shot", createdAt: 0 }, { name: "Shot", createdAt: 0 }];
    expect(exportNames(caps, "png", { naming: "capture", groupName: "G" }, ["Shot.png"])).toEqual(["Shot (2).png", "Shot (3).png", "Shot (4).png"]);
  });
  it("same-second date and time names stay unique", () => {
    const caps = [{ name: "a", createdAt: 5000 }, { name: "b", createdAt: 5000 }];
    const names = exportNames(caps, "jpg", { naming: "dateTime", groupName: "G" });
    expect(new Set(names).size).toBe(2);
    expect(names[1]).toMatch(/\(2\)\.jpg$/);
  });
});
