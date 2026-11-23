import { describe, expect, it } from "vitest";
import { isUrl, tsvToHtml } from "./RichText";

describe("paste: tables and links", () => {
  it("turns tab separated text (Excel, Word, a web table copied as text) into a table, rows padded to the widest", () => {
    const html = tsvToHtml("a\tb\tc\r\n1\t2\r\nx\ty\tz\r\n")!;
    expect(html.match(/<tr>/g)).toHaveLength(3);
    expect(html.match(/<td>/g)).toHaveLength(9);
    expect(html).toContain("<td><p>a</p></td>");
    expect(html).toContain("<td><p></p></td>");
  });
  it("escapes the text of the cells", () => {
    expect(tsvToHtml("<b>\t&")).toContain("&lt;b&gt;");
    expect(tsvToHtml("<b>\t&")).toContain("&amp;");
  });
  it("leaves text without tabs alone (it is pasted as it is)", () => {
    expect(tsvToHtml("just text")).toBeNull();
    expect(tsvToHtml("a\tb\nno tab here")).toBeNull();
  });
  it("recognises a pasted URL only when the whole text is one", () => {
    expect(isUrl("https://example.com/a?b=c")).toBe(true);
    expect(isUrl("  www.example.org ")).toBe(true);
    expect(isUrl("see https://example.com")).toBe(false);
    expect(isUrl("javascript:alert(1)")).toBe(false);
  });
});
