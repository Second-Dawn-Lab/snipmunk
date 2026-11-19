import { describe, expect, it } from "vitest";
import { buildDocument } from "../ocr/layout";
import { matchesAll, normalize, queryTerms } from "./normalize";
import { matchingWords, SearchIndex } from "./index";

const m = (hay: string, q: string) => matchesAll(normalize(hay), queryTerms(q));

describe("normalizing", () => {
  it("ignores case and accents (fr, de, es, tr)", () => {
    expect(m("Café Crème brûlée", "cafe creme")).toBe(true);
    expect(m("Élève à l'école", "ELEVE ecole")).toBe(true);
    expect(m("Müller Übung", "muller ubung")).toBe(true);
    expect(m("Straße", "strasse")).toBe(true);
    expect(m("STRASSE", "straße")).toBe(true);
    expect(m("Señor", "senor")).toBe(true);
    expect(m("İstanbul ışık", "istanbul isik")).toBe(true);
  });
  it("unifies Arabic spellings: alef and hamza forms, tatweel, diacritics, teh marbuta, digits", () => {
    expect(m("أحمد", "احمد")).toBe(true);
    expect(m("إسلام", "اسلام")).toBe(true);
    expect(m("مَدْرَسَة", "مدرسه")).toBe(true);
    expect(m("كـــتاب", "كتاب")).toBe(true);
    expect(m("مسؤول", "مسوول")).toBe(true);
    expect(m("فاتورة ٢٠٢٤", "فاتوره 2024")).toBe(true);
  });
  it("matches Chinese as substrings and full-width forms", () => {
    expect(m("这是一个发票文件", "发票")).toBe(true);
    expect(m("这是一个发票文件", "合同")).toBe(false);
    expect(m("ＡＢＣ１２３", "abc123")).toBe(true);
    expect(m("請款單 2024", "款單 2024")).toBe(true);
  });
  it("needs every word, in any order, and an empty query matches nothing by itself", () => {
    expect(m("invoice for anna schmidt", "schmidt invoice")).toBe(true);
    expect(m("invoice for anna", "invoice bob")).toBe(false);
    expect(queryTerms("   ")).toEqual([]);
    expect(m("anything", "")).toBe(false);
  });
});

describe("the index", () => {
  const caps = [
    { id: "a", name: "Rechnung März", sourceWindowTitle: "Outlook – Posteingang" },
    { id: "b", name: "Screenshot 2", sourceWindowTitle: null },
    { id: "c", name: "Facture", sourceWindowTitle: "Chrome" },
  ];
  const make = () => {
    const ix = new SearchIndex();
    caps.forEach((c) => ix.setMeta(c));
    return ix;
  };
  it("searches names, window titles and recognized text", () => {
    const ix = make();
    ix.setText("b", "Total à payer: 120 euros");
    expect(ix.search("marz", ["a", "b", "c"])).toEqual(["a"]);
    expect(ix.search("posteingang", ["a", "b", "c"])).toEqual(["a"]);
    expect(ix.search("PAYER euros", ["a", "b", "c"])).toEqual(["b"]);
    expect(ix.search("", ["a", "b"])).toEqual(["a", "b"]);
  });
  it("keeps the order of the candidates and only searches them", () => {
    const ix = make();
    expect(ix.search("e", ["c", "a"])).toEqual(["c", "a"]);
    expect(ix.search("rechnung", ["b", "c"])).toEqual([]);
  });
  it("updates when a name changes and keeps the recognized text", () => {
    const ix = make();
    ix.setText("a", "Betrag 99");
    ix.setMeta({ id: "a", name: "Mahnung", sourceWindowTitle: null });
    expect(ix.search("mahnung betrag", ["a"])).toEqual(["a"]);
    expect(ix.search("rechnung", ["a"])).toEqual([]);
  });
  it("forgets text that is read again and removed captures", () => {
    const ix = make();
    ix.setText("a", "geheim");
    ix.clearText("a");
    expect(ix.search("geheim", ["a"])).toEqual([]);
    expect(ix.unread(["a", "b"])).toBe(2);
    ix.remove("a");
    expect(ix.has("a")).toBe(false);
    ix.keepOnly(new Set(["c"]));
    expect(ix.has("b")).toBe(false);
  });
  it("counts the captures whose text is not read yet", () => {
    const ix = make();
    ix.setText("a", "");
    expect(ix.unread(["a", "b", "c"])).toBe(2);
  });
  it("stays fast with 500 captures", () => {
    const ix = new SearchIndex();
    const ids: string[] = [];
    for (let i = 0; i < 500; i++) {
      ids.push(`c${i}`);
      ix.setMeta({ id: `c${i}`, name: `Capture ${i}`, sourceWindowTitle: `Window ${i % 7}` });
      ix.setText(`c${i}`, "lorem ipsum dolor sit amet ".repeat(80) + (i === 321 ? "needle" : ""));
    }
    const t0 = performance.now();
    for (let k = 0; k < 20; k++) expect(ix.search("needle", ids)).toEqual(["c321"]);
    expect((performance.now() - t0) / 20).toBeLessThan(25);
  });
});

describe("highlighting", () => {
  const doc = buildDocument(
    { language: "de", width: 400, height: 100, lines: [
      { text: "Rechnung Straße 5", words: [
        { text: "Rechnung", x: 0, y: 0, w: 80, h: 20 }, { text: "Straße", x: 90, y: 0, w: 60, h: 20 }, { text: "5", x: 160, y: 0, w: 10, h: 20 },
      ] },
    ] },
  );
  it("marks the words that contain a term, folded", () => {
    expect([...matchingWords(doc, "strasse")]).toEqual([1]);
    expect([...matchingWords(doc, "RECHN 5")].sort()).toEqual([0, 2]);
    expect(matchingWords(doc, "").size).toBe(0);
  });
});
