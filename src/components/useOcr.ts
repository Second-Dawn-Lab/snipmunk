import { useCallback, useEffect, useRef, useState } from "react";
import { editorStore } from "../annotate/editorStore";
import type { AnnotationDoc } from "../annotate/schema";
import { ipc } from "../ipc";
import { ocrKey } from "../ocr/key";
import { buildDocument } from "../ocr/layout";
import type { OcrDoc, OcrResult } from "../ocr/types";

interface Cached {
  key: string;
  doc: OcrDoc;
}

// Recognized texts of this run, by capture (the stored ones are in the session folder, `ocr_get`).
const cache = new Map<string, Cached>();
const inFlight = new Map<string, Promise<OcrDoc | null>>();

/** Forget what was recognized for a capture (its picture changed). */
export function forgetOcr(captureId: string): void {
  cache.delete(captureId);
}

/**
 * The recognized text of the shown capture: from this run's memory, from the session folder, or read now from the picture
 * the editor renders (crop, rotation, flip and redactions applied, no other marks). While `active` it is kept current as
 * the document changes. `ensure()` returns the text for the document as it is now, reading it when needed.
 */
export function useOcr(options: {
  captureId: string;
  doc: AnnotationDoc;
  docRef: { current: AnnotationDoc };
  languages: string;
  active: boolean;
  /** Draw the picture to read, or `null` when there is none yet. */
  render: (doc: AnnotationDoc) => Promise<Blob | null>;
  onError: (message: string) => void;
}): { ocr: OcrDoc | null; ensure: () => Promise<OcrDoc | null> } {
  const { captureId, languages } = options;
  const key = ocrKey(options.doc, languages);
  const [state, setState] = useState<Cached | null>(() => {
    const c = cache.get(captureId);
    return c && c.key === key ? c : null;
  });
  const latest = useRef(options);
  latest.current = options;

  const ensure = useCallback(async (): Promise<OcrDoc | null> => {
    const o = latest.current;
    const wanted = ocrKey(o.docRef.current, o.languages);
    const hit = cache.get(o.captureId);
    if (hit && hit.key === wanted) return hit.doc;
    const flightKey = `${o.captureId}|${wanted}`;
    const running = inFlight.get(flightKey);
    if (running) return running;
    const job = (async (): Promise<OcrDoc | null> => {
      try {
        const stored = await ipc.ocrGet(o.captureId);
        let result: OcrResult | null = stored && stored.key === wanted ? stored : null;
        if (!result) {
          editorStore.set({ ocrBusy: true });
          const png = await o.render(o.docRef.current);
          if (!png) return null;
          result = await ipc.ocrRecognize(o.captureId, wanted, png);
        }
        const doc = buildDocument(result);
        cache.set(o.captureId, { key: wanted, doc });
        return doc;
      } catch (e) {
        const message = (e as { message?: string })?.message ?? String(e);
        latest.current.onError(message);
        return null;
      } finally {
        inFlight.delete(flightKey);
        editorStore.set({ ocrBusy: false });
      }
    })();
    inFlight.set(flightKey, job);
    return job;
  }, []);

  // While the text actions are open, the text is read (and read again after an edit that changes it).
  useEffect(() => {
    if (!options.active) return;
    let gone = false;
    void ensure().then((doc) => {
      if (!gone && doc) setState({ key, doc });
    });
    return () => {
      gone = true;
    };
  }, [options.active, key, ensure]);

  // Text recognized for another document is not shown.
  const current = state && state.key === key ? state.doc : null;
  return { ocr: current, ensure };
}
