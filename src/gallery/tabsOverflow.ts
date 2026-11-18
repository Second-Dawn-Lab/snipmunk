// Fade edges of the group tab strip (no React), so the logic can be unit tested.

export interface ScrollMetrics {
  /** Distance scrolled from the start edge (the absolute `scrollLeft`: right-to-left layouts report it negative). */
  scrollStart: number;
  /** Visible width. */
  client: number;
  /** Full width of the tabs. */
  scroll: number;
}

export interface FadeState {
  /** Tabs are hidden beyond the start edge. */
  start: boolean;
  /** Tabs are hidden beyond the end edge. */
  end: boolean;
  /** The strip scrolls at all (the list of all groups is offered). */
  overflow: boolean;
}

export function fadeEdges(m: ScrollMetrics): FadeState {
  const start = Math.abs(m.scrollStart);
  const overflow = m.scroll > m.client + 1;
  return { overflow, start: overflow && start > 1, end: overflow && start + m.client < m.scroll - 1 };
}
