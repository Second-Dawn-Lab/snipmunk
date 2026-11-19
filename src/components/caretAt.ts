// Where the caret goes when the user clicks into a text: the index of the character edge nearest to the click, found by laying the
// same text out in a hidden copy of the text field (a text field has no "caret from point" of its own).

const COPY = [
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight", "textAlign", "direction",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth",
  "borderLeftWidth", "boxSizing", "width", "whiteSpace", "overflowWrap", "wordBreak", "tabSize",
] as const;

/** The character index (0 to length) nearest to the client point (x, y) in this text field. */
export function caretIndexAt(area: HTMLTextAreaElement, x: number, y: number): number {
  const text = area.value;
  const chars = [...text];
  if (chars.length === 0) return 0;
  const cs = getComputedStyle(area);
  const box = area.getBoundingClientRect();
  const mirror = document.createElement("div");
  for (const p of COPY) mirror.style[p] = cs[p];
  mirror.style.position = "fixed";
  mirror.style.left = `${box.left}px`;
  mirror.style.top = `${box.top}px`;
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.height = "auto";
  mirror.style.overflow = "hidden";
  mirror.style.transform = "none";
  if (cs.whiteSpace === "nowrap" || cs.whiteSpace === "normal") mirror.style.whiteSpace = "pre-wrap";
  const spans = chars.map((ch) => {
    const s = document.createElement("span");
    s.textContent = ch === "\n" ? "\n​" : ch;
    mirror.appendChild(s);
    return s;
  });
  document.body.appendChild(mirror);
  try {
    const rects = spans.map((s) => s.getBoundingClientRect());
    // The line nearest to the click, then the character edge nearest to it on that line.
    let best = 0;
    let bestScore = Infinity;
    rects.forEach((r, i) => {
      const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      const rtl = cs.direction === "rtl";
      const startEdge = rtl ? r.right : r.left;
      const endEdge = rtl ? r.left : r.right;
      const before = Math.abs(x - startEdge);
      const after = Math.abs(x - endEdge);
      const score = dy * 1000 + Math.min(before, after);
      if (score < bestScore) {
        bestScore = score;
        best = before <= after ? i : i + 1;
      }
    });
    return Math.max(0, Math.min(chars.length, best));
  } finally {
    mirror.remove();
  }
}
