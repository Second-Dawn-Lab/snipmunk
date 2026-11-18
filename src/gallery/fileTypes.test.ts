import { describe, expect, it } from "vitest";
import { extensionOf, isImportDrag, isSupportedImage, planDrop, webUrls } from "./fileTypes";

const file = (name: string, type = "") => ({ name, type });

describe("file extensions", () => {
  it("are lower case and need a name before the dot", () => {
    expect(extensionOf("Photo.JPG")).toBe("jpg");
    expect(extensionOf("a.b.png")).toBe("png");
    expect(extensionOf("noext")).toBe("");
    expect(extensionOf(".png")).toBe("");
    expect(extensionOf("C:\\pics\\x.GIF")).toBe("gif");
  });
});

describe("supported images", () => {
  it("accepts PNG, JPG, JPEG, WebP, BMP and GIF", () => {
    for (const ext of ["png", "jpg", "jpeg", "webp", "bmp", "gif"]) {
      expect(isSupportedImage(file(`x.${ext}`)), ext).toBe(true);
      expect(isSupportedImage(file(`x.${ext.toUpperCase()}`)), ext).toBe(true);
    }
  });

  it("trusts a known image type over the name", () => {
    expect(isSupportedImage(file("image", "image/png"))).toBe(true);
    expect(isSupportedImage(file("download", "image/jpeg"))).toBe(true);
    expect(isSupportedImage(file("x.bin", "image/webp"))).toBe(true);
    expect(isSupportedImage(file("x", "image/x-ms-bmp"))).toBe(true);
  });

  it("uses the extension when the type is unknown", () => {
    expect(isSupportedImage(file("x.png", ""))).toBe(true);
    expect(isSupportedImage(file("x.jpg", "application/octet-stream"))).toBe(true);
    expect(isSupportedImage(file("x.txt", ""))).toBe(false);
    expect(isSupportedImage(file("noext", ""))).toBe(false);
  });

  it("refuses other types, even with an image extension", () => {
    expect(isSupportedImage(file("x.svg", "image/svg+xml"))).toBe(false);
    expect(isSupportedImage(file("x.avif", "image/avif"))).toBe(false);
    expect(isSupportedImage(file("x.pdf", "application/pdf"))).toBe(false);
    expect(isSupportedImage(file("x.png", "text/plain"))).toBe(false);
    expect(isSupportedImage(file("x.tiff", "image/tiff"))).toBe(false);
  });
});

describe("drags that could bring an image", () => {
  it("are files, addresses and dragged web content", () => {
    expect(isImportDrag(["Files"])).toBe(true);
    expect(isImportDrag(["text/uri-list", "text/plain"])).toBe(true);
    expect(isImportDrag(["text/html"])).toBe(true);
    expect(isImportDrag(["text/plain"])).toBe(false);
    expect(isImportDrag([])).toBe(false);
  });
});

describe("web addresses in a drop", () => {
  it("come from the address list and from images in dragged HTML, once each", () => {
    const urls = webUrls({
      uriList: "# a comment\r\nhttps://example.com/cat.png\r\nfile:///C:/x.png\r\nhttps://example.com/cat.png",
      html: '<meta charset="utf-8"><img src="https://example.com/dog.jpg" alt="d"><img src=\'http://a.b/c.gif\'>',
    });
    expect(urls).toEqual(["https://example.com/cat.png", "https://example.com/dog.jpg", "http://a.b/c.gif"]);
  });

  it("are empty for local addresses and text", () => {
    expect(webUrls({ uriList: "file:///C:/x.png", html: "<p>hello</p>" })).toEqual([]);
  });
});

describe("planning a drop", () => {
  it("adds the supported files in their order and counts the others", () => {
    const plan = planDrop({
      files: [file("b.png", "image/png"), file("notes.txt", "text/plain"), file("a.jpg", "image/jpeg"), file("c.heic", "")],
      uriList: "",
      html: "",
    });
    expect(plan).toEqual({
      kind: "files",
      accepted: [file("b.png", "image/png"), file("a.jpg", "image/jpeg")],
      skipped: 2,
    });
  });

  it("with only unsupported files adds none and skips them all", () => {
    const plan = planDrop({ files: [file("x.zip", "application/zip")], uriList: "", html: "" });
    expect(plan).toEqual({ kind: "files", accepted: [], skipped: 1 });
  });

  it("prefers files over addresses (a browser sends both for an image it can hand over)", () => {
    const plan = planDrop({
      files: [file("cat.png", "image/png")],
      uriList: "https://example.com/cat.png",
      html: '<img src="https://example.com/cat.png">',
    });
    expect(plan.kind).toBe("files");
  });

  it("asks the user to save the picture first when only an address came", () => {
    const plan = planDrop({ files: [], uriList: "https://example.com/cat.png", html: "" });
    expect(plan).toEqual({ kind: "url", urls: ["https://example.com/cat.png"] });
  });

  it("ignores a drop with nothing usable", () => {
    expect(planDrop({ files: [], uriList: "", html: "" })).toEqual({ kind: "none" });
    expect(planDrop({ files: [], uriList: "file:///C:/x", html: "" })).toEqual({ kind: "none" });
  });
});
