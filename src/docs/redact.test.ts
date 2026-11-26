import { describe, expect, it } from "vitest";
import { findMatches } from "../ocr/pii";
import type { GuideStep } from "../ipc";
import { createDocument, type ContentBlock, type GuideDoc, type PmDoc, type StepBlock } from "./model";
import { MASK, applyRedactions, findInPicture, findInText, maskTyped, recordNeedsMask, scanArea, knownValues } from "./redact";
import { applyTemplate, templateOf } from "./template/apply";
import { BASIC } from "./template/model";

/** A recognized picture with one word per box, 10 px per character. */
const picture = (...lines: string[]) => ({
  width: 800,
  height: 400,
  language: "en",
  lines: lines.map((line, row) => {
    let x = 20;
    return {
      text: line,
      words: line.split(" ").map((text) => {
        const w = { text, x, y: 40 + row * 40, w: text.length * 10, h: 20 };
        x += w.w + 10;
        return w;
      }),
    };
  }),
});
const options = { email: true, phone: false, card: true, iban: true, secret: false, custom: { words: ["Falcon"], wholeWord: true } };
const all = { email: true, phone: false, card: true, iban: true, secret: true };
const step = (n: number, extra: Partial<GuideStep> = {}): GuideStep => ({ n, kind: "click", t: 0, image: `s${n}.png`, imageSize: [800, 400], click: [1, 1], window: null, zoom: null, text: [{ t: "x" }], deleted: false, ...extra });
const defaults = { marker: { left: "#000", right: "#000", shape: "circle" as const, size: "small" as const }, badge: "circle" as const, picture: "window" as const, keepFull: false, zoomDefault: false };
const para = (...texts: string[]): PmDoc => ({ type: "doc", content: texts.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })) });

describe("quick redact of step pictures", () => {
  const found = findInPicture("b", picture("Mail anna.muster@example.com today", "IBAN DE89 3704 0044 0532 0130 00", "Card 4111 1111 1111 1111 Project Falcon", "Nothing here 12345"), options);
  it("finds e-mail addresses, IBANs, cards and custom words with their boxes", () => {
    expect(found.map((f) => f.kind).sort()).toEqual(["card", "custom", "email", "iban"]);
    const email = found.find((f) => f.kind === "email")!.rect!;
    expect(found.find((f) => f.kind === "email")!.text).toBe("anna.muster@example.com");
    expect(email[0]).toBeLessThanOrEqual(70);
    expect(email[1]).toBeLessThanOrEqual(40);
    expect(email[2]).toBeGreaterThanOrEqual(230);
  });
  it("adds the marks to the step once, in the chosen style, and marks the step as masked", () => {
    const steps = new Map([[1, step(1)]]);
    const doc = createDocument("T", 1, [...steps.values()], defaults);
    const mine = found.map((f) => ({ ...f, block: doc.blocks[0].id }));
    const plain = applyRedactions(doc, steps, mine, "black");
    const b = plain.blocks[0] as StepBlock;
    expect(b.redact).toHaveLength(4);
    expect(b.redact![0].kind).toBe("black");
    expect(b.masked).toBe(true);
    expect(applyRedactions(plain, steps, mine, "blur")).toBe(plain);
  });
  it("covers what Windows OCR really returns for an editor window (readings of generated Consolas pictures)", () => {
    // A slashed zero is read as O, Ø, e or s; "IBAN:" is often a line of its own; groups with hyphens.
    for (const read of [
      "Iban: DE89 3704 0044 0532 0130 eo",
      "IBAN: DE89-3704-0044-0532-0130-OO",
      "IBAN: DE89-37Ø4-OØ44-Ø532-Ø130-OO",
      "IBAN: DE89370400440532013000",
      "DE89 37e4 ee44 es32 e13e ee",
      "DE89-37e4-ee44-e532-e13e-ee",
      "DE8937e4ee44e532e13eee",
      "IBAN: DE8937Ø40Ø440532013000",
    ]) {
      expect(findMatches(read, all).map((m) => m.kind), read).toEqual(["iban"]);
    }
    for (const read of ["email : k@qmail.com", "email : k @qmail.com", "email : k@qmail .com", "email : k©qmail.com", "email : k@qmail.c0m", "k@qmail.com"]) {
      expect(findMatches(read, all).map((m) => m.kind), read).toEqual(["email"]);
    }
    for (const read of ["password: 7741kqz558w", "password; 7741kqz558w"]) expect(findMatches(read, all).map((m) => m.text), read).toEqual(["7741kqz558w"]);
    for (const read of ["Contact me @home. Not now", "see you at home.de facto", "IBAN DE00 1111", "Ln:6 Col:36 Pos: 165"]) {
      expect(findMatches(read, { ...all, secret: false }), read).toEqual([]);
    }
  });
  it("joins a label and its value that were read as two lines, and counts two readings of a line once", () => {
    const word = (text: string, x: number, y: number) => ({ text, x, y, w: text.length * 8, h: 14 });
    const line = (...words: ReturnType<typeof word>[]) => ({ text: words.map((w) => w.text).join(" "), words });
    const result = {
      width: 800,
      height: 400,
      language: "en",
      lines: [
        line(word("password:", 20, 40)),
        line(word("7741kqz558w", 110, 40)),
        line(word("k@qmail.com", 20, 80)),
        // The enlarged reading of the same two lines, a pixel off.
        line(word("password:", 21, 41), word("7741kqz558w", 111, 41)),
        line(word("k@qmail.com", 21, 80)),
      ],
    };
    const f = findInPicture("b", result, all);
    expect(f.map((x) => x.kind)).toEqual(["secret", "email"]);
    expect(f[0].rect![0]).toBeGreaterThanOrEqual(100);
  });
  it("reads the shown area with a margin, the whole picture when the file keeps it", () => {
    const s = step(1, { window: { rect: [100, 100, 300, 200], title: "", process: "" } });
    const doc = createDocument("T", 1, [s], defaults);
    const b = doc.blocks[0] as StepBlock;
    expect(scanArea(s, b, doc)).toEqual([52, 52, 396, 296]);
    expect(scanArea(s, b, { ...doc, keepFull: true })).toBeNull();
    expect(scanArea(s, b, { ...doc, picture: "screen" })).toBeNull();
  });
});

describe("quick redact of the texts", () => {
  const secret = "7741kqz558w";
  const typing = step(2, { kind: "type", typed: "hunter2", element: { name: "Password", controlType: "Edit", rect: [0, 0, 1, 1] }, text: [{ t: "Type '" }, { t: "hunter2" }, { t: "' in " }, { t: "Password", b: true }] });
  const click = step(1, { element: { name: `password: ${secret}`, controlType: "Pane", rect: [0, 0, 1, 1] }, text: [{ t: "Click " }, { t: `Name : Sam email : k@qmail.com password: ${secret}`, b: true }] });
  const steps = new Map([
    [1, click],
    [2, typing],
  ]);
  const base = createDocument("T", 1, [click, typing], defaults);
  const content: ContentBlock = {
    id: "c1",
    type: "content",
    doc: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Write to v@" }, { type: "text", text: "qmail.com", marks: [{ type: "bold" }] }, { type: "text", text: " today" }] },
        { type: "paragraph", content: [{ type: "text", text: "our contact", marks: [{ type: "link", attrs: { href: "mailto:boss@example.com" } }] }] },
        { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "IBAN DE89 3704 0044 0532 0130 00" }] }] }] }] },
      ],
    },
  };
  let doc: GuideDoc = { ...base, blocks: [{ ...base.blocks[0], desc: para(`The password: ${secret} is old`) } as StepBlock, base.blocks[1], content] };
  doc = applyTemplate(doc, { ...BASIC, cover: { ...BASIC.cover, on: true, author: "me@example.com" } });
  const found = findInText(doc, steps, all);

  it("finds secrets in sentences, typed text, descriptions, content blocks, tables, links and the cover", () => {
    expect(found.map((f) => `${f.where}:${f.kind}`)).toEqual(["cover:email", "text:email", "text:secret", "desc:secret", "typed:secret", "content:email", "content:email", "content:iban"]);
    expect(recordNeedsMask(click, all)).toBe(true);
    expect(recordNeedsMask(typing, all)).toBe(false);
    expect(findInText(doc, steps, all, new Set(["c1"])).every((f) => f.block === "c1")).toBe(true);
  });
  it("masks them, keeps labels and formatting, and leaves none of the originals in the document", () => {
    const masked = applyRedactions(doc, steps, found, "black");
    const text = (b: StepBlock) => b.text!.map((p) => p.t).join("");
    const first = masked.blocks[0] as StepBlock;
    expect(text(first)).toBe(`Click Name : Sam email : ${MASK} password: ${MASK}`);
    expect(first.text![1].b).toBe(true);
    expect(first.masked).toBe(true);
    const second = masked.blocks[1] as StepBlock;
    expect(text(second)).toBe(`Type '${MASK}' in Password`);
    expect(second.maskTyped).toBe(true);
    expect(templateOf(masked).cover.author).toBe(MASK);
    const saved = JSON.stringify(masked);
    for (const original of [secret, "hunter2", "qmail.com", "boss@example.com", "DE89 3704", "me@example.com"]) expect(saved, original).not.toContain(original);
    expect(saved).toContain("our contact");
    expect(findInText(masked, steps, all)).toEqual([]);
  });
  it("applies only what is ticked", () => {
    const one = applyRedactions(doc, steps, found.filter((f) => f.where === "desc"), "black");
    expect(JSON.stringify((one.blocks[0] as StepBlock).desc)).not.toContain(secret);
    expect((one.blocks[0] as StepBlock).text).toBeUndefined();
    expect(one.blocks[1]).toBe(doc.blocks[1]);
    expect(maskTyped([{ t: "abc" }], "")).toEqual([{ t: "abc" }]);
  });
});

// --- the words of callouts and text marks (8-A) --------------------------------------------------------------------------

describe("quick redact of callouts and text marks", () => {
  const steps = new Map([
    [1, step(1)],
    [2, step(2)],
  ]);
  const base = createDocument("T", 1, [...steps.values()], defaults);
  const mark = (id: string, kind: "callout" | "text" | "rect", text: string) => ({ id, kind, x: 10, y: 10, color: "#000", width: 3, text });
  const doc: GuideDoc = {
    ...base,
    blocks: [
      base.blocks[0],
      { ...(base.blocks[1] as StepBlock), annotations: [mark("c1", "callout", "Write to anna@example.com\nor call the desk"), mark("t1", "text", "IBAN DE89 3704 0044\n0532 0130 00"), mark("r1", "rect", "anna@example.com")] },
    ],
  };
  const found = findInText(doc, steps, all);

  it("lists every finding with its step and mark", () => {
    expect(found.map((f) => [f.where, f.mark, f.kind, f.block === doc.blocks[1].id])).toEqual([
      ["callout", "c1", "email", true],
      ["mark", "t1", "iban", true],
    ]);
    // A number parted by a line break is still found, whole.
    expect(found[1].text).toBe("DE89 3704 0044\n0532 0130 00");
  });

  it("masks them in one change, and nothing of them is left in the guide", () => {
    const masked = applyRedactions(doc, steps, found, "black");
    const b = masked.blocks[1] as StepBlock;
    expect(b.annotations!.map((a) => a.text)).toEqual([`Write to ${MASK}\nor call the desk`, `IBAN ${MASK}`, "anna@example.com"]);
    expect(b.masked).toBe(true);
    expect(masked.blocks[0]).toBe(doc.blocks[0]);
    // (a rectangle's unused words are not a text anyone sees; nothing else holds the values)
    expect(JSON.stringify({ ...masked, blocks: [{ ...b, annotations: b.annotations!.slice(0, 2) }] })).not.toMatch(/anna@example\.com|0532/);
    expect(findInText(masked, steps, all)).toEqual([]);
    // Unticked items stay.
    const one = applyRedactions(doc, steps, [found[0]], "black").blocks[1] as StepBlock;
    expect(one.annotations![1].text).toContain("0532");
  });

  it("looks only at the chosen steps, and hides a value a picture showed", () => {
    expect(findInText(doc, steps, all, new Set([doc.blocks[0].id]))).toEqual([]);
    const note: GuideDoc = { ...base, blocks: [{ ...(base.blocks[0] as StepBlock), annotations: [mark("c2", "callout", "Use 47qrt$9191 here")] }] };
    expect(findInText(note, steps, all)).toEqual([]);
    expect(findInText(note, steps, all, undefined, [{ kind: "secret", text: "47qrt$9191" }]).map((f) => f.where)).toEqual(["callout"]);
  });
});

// --- what pictures teach the texts ----------------------------------------------------------------------------------------

describe("a value known from a picture, and a label split over two steps", () => {
  const all = { email: true, phone: false, card: true, iban: true, secret: true };
  const picture = (text: string, kind: "secret" | "email" | "phone" = "secret") => ({ block: "p", kind, text, where: "picture" as const, rect: [0, 0, 1, 1] as [number, number, number, number] });
  const typing = (n: number, typed: string) => ({ n, kind: "type", t: 0, monitor: [0, 0, 100, 100], scale: 1, image: "", imageSize: [100, 100] as [number, number], click: null, typed, text: [{ t: "Type " }, { t: `'${typed}'`, b: true }, { t: " in the editor" }] }) as unknown as GuideStep;
  const guide = (n: number) => createDocument("T", 1, Array.from({ length: n }, (_, i) => typing(i + 1, "x")), { marker: BASIC.marker, badge: "circle", picture: "screen", keepFull: false, zoomDefault: false });

  it("takes only values particular enough", () => {
    expect(knownValues([picture("47qrt$9191"), picture("required"), picture("1234567"), picture("ab1"), picture("k@example.com", "email"), picture("030 1234567", "phone")]).map((k) => k.text)).toEqual(["47qrt$9191", "k@example.com"]);
  });
  it("hides the value in the typed text that shows it", () => {
    const steps = new Map([[1, typing(1, "then 47qrt$9191 and more")]]);
    expect(findInText(guide(1), steps, all)).toEqual([]);
    const found = findInText(guide(1), steps, all, undefined, knownValues([picture("47QRT$9191")]));
    expect(found.map((f) => [f.where, f.kind])).toEqual([["typed", "secret"]]);
    const masked = applyRedactions(guide(1), steps, found.map((f) => ({ ...f, block: guide(1).blocks[0].id })), "black");
    expect(masked).toBeDefined();
  });
  it("sees a password label whose beginning went into the step before", () => {
    for (const typed of ["ssword : 47qrt$9191", "sword: abc", "asswort=abc", " nnwort: abc"]) {
      expect(findInText(guide(1), new Map([[1, typing(1, typed)]]), all).map((f) => f.where), typed).toEqual(["typed"]);
    }
    for (const typed of ["pas", "a word: here", "the password is long", "keyword: abc"]) {
      expect(findInText(guide(1), new Map([[1, typing(1, typed)]]), all), typed).toEqual([]);
    }
  });
});
