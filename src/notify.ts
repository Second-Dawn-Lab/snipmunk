// A short message for the window (the notice bar of the main window), sent from anywhere in the page.

export interface Notice {
  text: string;
  /** An error is shown in the red bar and stays until dismissed; a notice goes away by itself. */
  error?: boolean;
}

const EVENT = "snipmunk:notice";

export function notify(text: string, error = false): void {
  window.dispatchEvent(new CustomEvent<Notice>(EVENT, { detail: { text, error } }));
}

export function onNotice(cb: (n: Notice) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<Notice>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
