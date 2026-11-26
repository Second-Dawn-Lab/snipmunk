import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { loadable } from "./loadable";

const Name = ({ name }: { name: string }) => createElement("b", null, name);

describe("a view loaded when needed", () => {
  it("shows its fallback until the code is there, then renders at once", async () => {
    const load = vi.fn(async () => Name);
    const View = loadable(load, "…");
    expect(load).not.toHaveBeenCalled(); // nothing is fetched before it is needed
    expect(renderToString(createElement(View, { name: "guide" }))).toBe("…");
    await View.preload();
    await View.preload();
    expect(load).toHaveBeenCalledTimes(1);
    expect(renderToString(createElement(View, { name: "guide" }))).toBe("<b>guide</b>");
  });

  it("tries again after a failed load", async () => {
    let fail = true;
    const View = loadable(async () => {
      if (fail) throw new Error("not there");
      return Name;
    });
    await expect(View.preload()).rejects.toThrow("not there");
    fail = false;
    await View.preload();
    expect(renderToString(createElement(View, { name: "again" }))).toBe("<b>again</b>");
  });
});
