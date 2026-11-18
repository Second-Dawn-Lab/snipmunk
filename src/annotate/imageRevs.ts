// Permanent redaction and its undo (no React, no IPC): which version of the stored picture is on disk, and which versions
// the undo history can still bring back. The earlier pictures live only in memory, for this run of Snipmunk: nothing of
// them is written to disk, and after Snipmunk is closed the burned-in redaction is final.

/** One entry of the undo history: the annotation document and the version of the stored picture it belongs to. */
export interface EditState<D> {
  doc: D;
  /** 0 is the picture as it was when Snipmunk started; each permanent redaction makes a new one. */
  rev: number;
}

export class ImageRevisions {
  /** The version that is in the file now. */
  disk = 0;
  private next = 1;
  private bytes = new Map<number, Uint8Array>();

  /** Keep the bytes of a version in memory (the file as it was before it was replaced, the one that replaced it). */
  remember(rev: number, data: Uint8Array): void {
    this.bytes.set(rev, data);
  }

  has(rev: number): boolean {
    return rev === this.disk || this.bytes.has(rev);
  }

  /** The number for a new version. */
  allocate(): number {
    return this.next++;
  }

  get(rev: number): Uint8Array | undefined {
    return this.bytes.get(rev);
  }

  /** The file now holds version `rev`. */
  setDisk(rev: number): void {
    this.disk = rev;
  }

  /** How many bytes are held for undo (shown nowhere; for tests and for a memory note). */
  get size(): number {
    let n = 0;
    for (const b of this.bytes.values()) n += b.byteLength;
    return n;
  }

  /** Forget the pictures (the capture was deleted). */
  clear(): void {
    this.bytes.clear();
  }
}

export type SyncPlan =
  | { kind: "none" }
  /** Write the bytes of `rev` to the file. */
  | { kind: "restore"; rev: number }
  /** The version is not in memory: this cannot be undone (should not happen). */
  | { kind: "missing"; rev: number };

/** What has to happen to the file when the history moves to an entry of version `target`. */
export function planImageSync(revs: ImageRevisions, target: number): SyncPlan {
  if (target === revs.disk) return { kind: "none" };
  return revs.get(target) ? { kind: "restore", rev: target } : { kind: "missing", rev: target };
}

/** The document after a permanent redaction: the redactions are gone (they are in the pixels now), everything else stays. */
export function withoutRedactions<I extends { type: string }, D extends { items: I[] }>(doc: D): D {
  return { ...doc, items: doc.items.filter((a) => a.type !== "redact") };
}

export function hasRedactions(doc: { items: { type: string }[] }): boolean {
  return doc.items.some((a) => a.type === "redact");
}
