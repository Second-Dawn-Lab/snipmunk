// The colors, highlighter colors and emoji the annotation popovers offer.

/** 30 colors in a 6 x 5 grid, row by row: greys, reds to yellows, greens to purples, browns and skin tones, pastels. */
export const PALETTE_COLUMNS = 6;
export const PALETTE: readonly string[] = [
  // greys
  "#000000", "#404040", "#7F7F7F", "#BFBFBF", "#E0E0E0", "#FFFFFF",
  // reds, oranges, yellows
  "#C62828", "#E53935", "#F4511E", "#FB8C00", "#FDD835", "#FFEE58",
  // greens, blues, purples
  "#2E7D32", "#43A047", "#00ACC1", "#1E88E5", "#3949AB", "#8E24AA",
  // browns and skin tones
  "#4E342E", "#A0522D", "#8D5524", "#C68642", "#E0AC69", "#FFDBAC",
  // pastels
  "#FFCDD2", "#FFE0B2", "#FFF9C4", "#C8E6C9", "#BBDEFB", "#E1BEE7",
];

export const HIGHLIGHTER_COLORS: readonly string[] = [
  "#FFEB3B", // yellow
  "#76FF03", // green
  "#18FFFF", // cyan
  "#FF4081", // pink
  "#FFAB40", // orange
  "#B388FF", // purple
];

export const EMOJI: readonly string[] = [
  "❤️", "⭐", "❓", "✔️", "❌", "🔥",
  "👍", "👎", "👏", "🙌", "👀", "💯",
  "🙂", "🙁", "😮", "😍", "😂", "😭",
];

export const SIZE_RANGE = { min: 1, max: 40 } as const;
export const HIGHLIGHTER_SIZE_RANGE = { min: 4, max: 40 } as const;

/** Black or white, whichever reads better on `hex` (for the check mark on a selected swatch). */
export function readableOn(hex: string): "#000000" | "#ffffff" {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.4 ? "#000000" : "#ffffff";
}
