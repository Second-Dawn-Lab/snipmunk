import { Button, Dialog } from "@seconddawn/ui";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { AppIcon } from "../components/AppIcons";
import { useT } from "../i18n";
import { ipc, type GuideStep } from "../ipc";
import { notify } from "../notify";
import { editors, RichText, storeImage } from "./RichText";
import { StepPicture, type Tool } from "./StepPicture";
import {
  duplicateBlock,
  emptyText,
  indexOfBlock,
  insertBlock,
  moveBlockTo,
  moveBlocks,
  newId,
  removeBlocks,
  stepNumbers,
  updateBlock,
  type Block,
  type ContentBlock,
  type GuideDoc,
  type Part,
  type PmDoc,
  type StepBlock,
} from "./model";
import type { GuideApi } from "./useGuide";
import { guideImageUrl } from "./urls";
import { GuideSidebar } from "./GuideSidebar";

/** A screenshot of Snipmunk's list that can become a step. */
export interface ScreenshotChoice {
  id: string;
  name: string;
  thumb: string;
  load: () => Promise<Blob>;
}

const partsToDoc = (parts: Part[]): PmDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: parts.filter((p) => p.t).map((p) => ({ type: "text", text: p.t, ...(p.b ? { marks: [{ type: "bold" }] } : {}) })) }],
});

/** The first paragraph of a rich text as parts (text with or without bold). */
function docToParts(doc: PmDoc): Part[] {
  const out: Part[] = [];
  const walk = (n: unknown) => {
    const node = n as { type?: string; text?: string; marks?: { type: string }[]; content?: unknown[] };
    if (node.type === "text" && node.text) out.push({ t: node.text, ...(node.marks?.some((m) => m.type === "bold") ? { b: true } : {}) });
    else if (node.type === "hardBreak") out.push({ t: " " });
    node.content?.forEach(walk);
  };
  (doc.content?.[0] ? [doc.content[0]] : []).forEach(walk);
  return out;
}

const blobToBase64 = (b: Blob): Promise<string> =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });

type Dispatch = GuideApi["change"];

// --- the "+" between blocks -------------------------------------------------------------------------------------------------------

function InsertBar(props: { index: number; onInsert: (index: number, what: "text" | "image" | "clipboard" | "screenshot" | "file" | "blank") => void; onDropBlock: (id: string, index: number) => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const item = (what: Parameters<typeof props.onInsert>[1], label: string) => (
    <button type="button" role="menuitem" className="ginsert__item" onClick={() => (setOpen(false), props.onInsert(props.index, what))}>
      {label}
    </button>
  );
  return (
    <div
      className={`ginsert${over ? " ginsert--over" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/x-snipmunk-block")) {
            e.preventDefault();
            setOver(true);
          }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData("application/x-snipmunk-block");
        if (id) {
          e.preventDefault();
          e.stopPropagation();
          props.onDropBlock(id, props.index);
        }
      }}
    >
      <span className="ginsert__line" />
      <button type="button" className="ginsert__plus" aria-haspopup="menu" aria-expanded={open} title={t("guide.insert")} aria-label={t("guide.insert")} onClick={() => setOpen((o) => !o)}>
        +
      </button>
      {open && (
        <div className="ginsert__menu" role="menu" onMouseLeave={() => setOpen(false)}>
          {item("text", t("guide.insertText"))}
          {item("image", t("guide.insertImageFile"))}
          {item("clipboard", t("guide.insertImageClipboard"))}
          {item("file", t("guide.insertStepFile"))}
          {item("screenshot", t("guide.insertStepList"))}
          {item("blank", t("guide.insertBlank"))}
        </div>
      )}
    </div>
  );
}

// --- one step -----------------------------------------------------------------------------------------------------------------------

const COLORS = ["#d62828", "#f77f00", "#fcbf49", "#2a9d8f", "#2563eb", "#7c3aed", "#000000", "#ffffff"];
const TOOLS: { id: Tool; label: Parameters<ReturnType<typeof useT>["t"]>[0] }[] = [
  { id: "arrow", label: "guide.tool.arrow" },
  { id: "line", label: "guide.tool.line" },
  { id: "rect", label: "guide.tool.rect" },
  { id: "ellipse", label: "guide.tool.ellipse" },
  { id: "highlight", label: "guide.tool.highlight" },
  { id: "pen", label: "guide.tool.pen" },
  { id: "text", label: "guide.tool.text" },
  { id: "callout", label: "guide.tool.callout" },
  { id: "badge", label: "guide.tool.badge" },
  { id: "blur", label: "guide.tool.blur" },
  { id: "pixelate", label: "guide.tool.pixelate" },
  { id: "black", label: "guide.tool.black" },
  { id: "crop", label: "guide.tool.crop" },
  { id: "zoom", label: "guide.tool.zoom" },
  { id: "marker", label: "guide.tool.marker" },
];

const StepView = memo(function StepView(props: {
  block: StepBlock;
  step: GuideStep | undefined;
  number: number;
  doc: GuideDoc;
  selected: boolean;
  editing: boolean;
  onEdit: (id: string | null) => void;
  onSelect: (id: string, e: React.MouseEvent) => void;
  change: Dispatch;
  dragStart: (e: DragEvent, id: string) => void;
  /** A tool the sidebar asked for (the zoom area). */
  req: { id: string; tool: "zoom"; n: number } | null;
}) {
  const { t } = useT();
  const { block, step, doc } = props;
  const [tool, setTool] = useState<Tool>("none");
  const reqN = props.req?.id === block.id ? props.req.n : 0;
  useEffect(() => {
    if (reqN > 0 && props.req) setTool(props.req.tool);
  }, [reqN]);
  const [color, setColor] = useState(COLORS[0]);
  const [ann, setAnn] = useState<string | null>(null);
  const patch = useCallback((c: Partial<StepBlock>, key = "") => props.change((d) => updateBlock<StepBlock>(d, block.id, c), key), [props, block.id]);
  if (!step) return null;
  const parts = block.text ?? step.text;
  const hasClick = step.click !== null && step.kind !== "type" && step.kind !== "key";
  const badge = doc.badge === "none" ? null : <span className={`gstep__badge gstep__badge--${doc.badge}`}>{props.number}</span>;
  return (
    <article className={`gblock gstep${props.selected ? " gblock--sel" : ""}`} data-block={block.id} tabIndex={-1}>
      <div className="gstep__head">
        <button type="button" className="gblock__handle" draggable title={t("guide.drag")} aria-label={t("guide.drag")} onDragStart={(e) => props.dragStart(e, block.id)} onClick={(e) => props.onSelect(block.id, e)}>
          ⋮⋮
        </button>
        {badge}
        <div className="gstep__text">
          <RichText mode="step" singleLine value={partsToDoc(parts)} ariaLabel={t("guide.stepText")} onChange={(d) => patch({ text: docToParts(d) }, `text:${block.id}`)} />
        </div>
        <span className="gstep__actions">
          {block.text && (
            <button type="button" className="gstep__btn" title={t("guide.resetText")} aria-label={t("guide.resetText")} onClick={() => patch({ text: undefined })}>
              ↺
            </button>
          )}
          {step.image && (
            <button type="button" className={`gstep__btn${props.editing ? " gstep__btn--on" : ""}`} aria-pressed={props.editing} title={t("guide.editPicture")} aria-label={t("guide.editPicture")} onClick={() => (props.onEdit(props.editing ? null : block.id), setTool("none"))}>
              <AppIcon name="pen" size={15} />
            </button>
          )}
          <button type="button" className="gstep__btn" title={t("guide.duplicate")} aria-label={t("guide.duplicate")} onClick={() => props.change((d) => duplicateBlock(d, block.id).doc)}>
            <AppIcon name="duplicate" size={15} />
          </button>
          <button type="button" className="gstep__btn" title={t("docs.deleteStep")} aria-label={t("docs.deleteStep")} onClick={() => props.change((d) => removeBlocks(d, new Set([block.id])))}>
            <AppIcon name="trash" size={15} />
          </button>
        </span>
      </div>
      {step.image && (
        <>
          {props.editing && (
            <div className="gtools" role="toolbar" aria-label={t("guide.editPicture")}>
              {TOOLS.filter((x) => hasClick || x.id !== "marker").map((x) => (
                <button key={x.id} type="button" className={`gtools__btn${tool === x.id ? " gtools__btn--on" : ""}`} aria-pressed={tool === x.id} onClick={() => setTool(tool === x.id ? "none" : x.id)}>
                  {t(x.label)}
                </button>
              ))}
              <span className="gtools__sep" />
              {COLORS.map((c) => (
                <button key={c} type="button" className={`gtools__swatch${color === c ? " gtools__swatch--on" : ""}`} style={{ background: c }} aria-label={c} onClick={() => setColor(c)} />
              ))}
              <span className="gtools__sep" />
              {hasClick && (
                <button type="button" className="gtools__btn" aria-pressed={!block.markerHidden} onClick={() => patch({ markerHidden: !block.markerHidden })}>
                  {block.markerHidden ? t("guide.markerShow") : t("guide.markerHide")}
                </button>
              )}
              {hasClick && (
                <button type="button" className="gtools__btn" aria-pressed={block.zoom ?? doc.zoomDefault} onClick={() => patch({ zoom: !(block.zoom ?? doc.zoomDefault) })}>
                  {t("guide.zoom")}
                </button>
              )}
              {(block.crop || block.zoomRect || block.markerPos || (block.annotations?.length ?? 0) > 0 || (block.redact?.length ?? 0) > 0) && (
                <>
                  {block.crop && (
                    <button type="button" className="gtools__btn" onClick={() => patch({ crop: null })}>
                      {t("guide.resetCrop")}
                    </button>
                  )}
                  {(block.annotations?.length ?? 0) > 0 && (
                    <button type="button" className="gtools__btn" onClick={() => patch({ annotations: ann ? block.annotations!.filter((a) => a.id !== ann) : block.annotations!.slice(0, -1) })}>
                      {ann ? t("guide.deleteSelected") : t("guide.undoLast")}
                    </button>
                  )}
                  {(block.redact?.length ?? 0) > 0 && (
                    <button type="button" className="gtools__btn" onClick={() => patch({ redact: block.redact!.slice(0, -1) })}>
                      {t("guide.undoRedact")}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          <StepPicture step={step} block={block} doc={doc} tool={props.editing ? tool : "none"} color={color} selected={ann} onSelect={setAnn} onChange={(c) => patch(c)} />
        </>
      )}
      {block.desc !== undefined && block.desc !== null ? (
        <RichText mode="full" value={block.desc} placeholder={t("guide.descPlaceholder")} onChange={(d) => patch({ desc: d }, `desc:${block.id}`)} />
      ) : (
        <button type="button" className="gstep__adddesc" onClick={() => patch({ desc: emptyText() })}>
          + {t("guide.addDescription")}
        </button>
      )}
    </article>
  );
});

const ContentView = memo(function ContentView(props: { block: ContentBlock; selected: boolean; onSelect: (id: string, e: React.MouseEvent) => void; change: Dispatch; dragStart: (e: DragEvent, id: string) => void }) {
  const { t } = useT();
  const { block } = props;
  return (
    <article className={`gblock gcontent${props.selected ? " gblock--sel" : ""}`} data-block={block.id} tabIndex={-1}>
      <div className="gcontent__side">
        <button type="button" className="gblock__handle" draggable title={t("guide.drag")} aria-label={t("guide.drag")} onDragStart={(e) => props.dragStart(e, block.id)} onClick={(e) => props.onSelect(block.id, e)}>
          ⋮⋮
        </button>
        <button type="button" className="gstep__btn" title={t("docs.deleteStep")} aria-label={t("docs.deleteStep")} onClick={() => props.change((d) => removeBlocks(d, new Set([block.id])))}>
          <AppIcon name="trash" size={15} />
        </button>
      </div>
      <div className="gcontent__body">
        <RichText mode="full" value={block.doc} placeholder={t("guide.textPlaceholder")} onChange={(d) => props.change((x) => updateBlock<ContentBlock>(x, block.id, { doc: d }), `text:${block.id}`)} />
      </div>
    </article>
  );
});

// --- the editor ----------------------------------------------------------------------------------------------------------------------

export function GuideEditor(props: { guide: GuideApi; screenshots: ScreenshotChoice[] }) {
  const { t } = useT();
  const { guide } = props;
  const doc = guide.doc!;
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [pickList, setPickList] = useState<{ index: number } | null>(null);
  const [toolReq, setToolReq] = useState<{ id: string; tool: "zoom"; n: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileTarget = useRef<{ index: number; as: "image" | "step" }>({ index: 0, as: "image" });
  const numbers = useMemo(() => stepNumbers(doc), [doc]);
  const change = guide.change;

  const insertStepFromBlob = useCallback(
    async (blob: Blob, index: number) => {
      try {
        const step = await ipc.docAddStepImage(await blobToBase64(blob));
        guide.addStep(step);
        change((d) => insertBlock(d, index, { id: newId(), type: "step", n: step.n } as StepBlock));
      } catch (e) {
        notify(String((e as { message?: string })?.message ?? e), true);
      }
    },
    [guide, change],
  );

  const insertImageBlob = useCallback(
    async (blob: Blob, index: number) => {
      try {
        const img = await storeImage(blob);
        const node = { type: "image", attrs: { src: guideImageUrl(img.name), alt: "", file: img.name } };
        change((d) => insertBlock(d, index, { id: newId(), type: "content", doc: { type: "doc", content: [node, { type: "paragraph" }] } } as ContentBlock));
      } catch (e) {
        notify(String((e as { message?: string })?.message ?? e), true);
      }
    },
    [change],
  );

  const clipboardImage = async (): Promise<Blob | null> => {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((x) => x.startsWith("image/"));
        if (type) return await item.getType(type);
      }
    } catch (e) {
      notify(String((e as { message?: string })?.message ?? e), true);
      return null;
    }
    notify(t("guide.noClipboardImage"), true);
    return null;
  };

  const onInsert = async (index: number, what: "text" | "image" | "clipboard" | "screenshot" | "file" | "blank") => {
    if (what === "text") {
      change((d) => insertBlock(d, index, { id: newId(), type: "content", doc: emptyText() } as ContentBlock));
    } else if (what === "image" || what === "file") {
      fileTarget.current = { index, as: what === "image" ? "image" : "step" };
      fileRef.current?.click();
    } else if (what === "clipboard") {
      const b = await clipboardImage();
      if (b) await insertImageBlob(b, index);
    } else if (what === "screenshot") {
      setPickList({ index });
    } else if (what === "blank") {
      try {
        const step = await ipc.docAddBlankStep();
        guide.addStep(step);
        change((d) => insertBlock(d, index, { id: newId(), type: "step", n: step.n } as StepBlock));
      } catch (e) {
        notify(String((e as { message?: string })?.message ?? e), true);
      }
    }
  };

  // Files from Explorer dropped on the guide.
  const onDrop = (e: DragEvent) => {
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    e.preventDefault();
    void (async () => {
      let at = doc.blocks.length;
      for (const f of files) {
        await (e.shiftKey ? insertStepFromBlob(f, at) : insertImageBlob(f, at));
        at += 1;
      }
    })();
  };

  const dragStart = useCallback((e: DragEvent, id: string) => {
    e.dataTransfer.setData("application/x-snipmunk-block", id);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const onSelectBlock = useCallback(
    (id: string, e: React.MouseEvent) => {
      setSel((cur) => {
        if (e.shiftKey && cur.size > 0) {
          const last = [...cur].pop()!;
          const a = indexOfBlock(doc, last);
          const b = indexOfBlock(doc, id);
          return new Set(doc.blocks.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.id));
        }
        if (e.ctrlKey || e.metaKey) {
          const n = new Set(cur);
          if (n.has(id)) n.delete(id);
          else n.add(id);
          return n;
        }
        return cur.size === 1 && cur.has(id) ? new Set() : new Set([id]);
      });
    },
    [doc],
  );

  // Keys: Ctrl+Z / Ctrl+Y (a focused rich-text editor undoes its own typing first, then the document history), Alt+Up/Down move
  // the selected blocks, Delete deletes them (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const pm = target?.closest<HTMLElement>(".ProseMirror");
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (ctrl && (k === "z" || k === "y")) {
        const redo = k === "y" || (k === "z" && e.shiftKey);
        const ed = pm ? editors.get(pm) : undefined;
        if (ed && (redo ? ed.can().redo() : ed.can().undo())) return; // the editor's own history first
        if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
        e.preventDefault();
        if (redo) guide.redo();
        else guide.undo();
        return;
      }
      if (pm || (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && sel.size > 0) {
        e.preventDefault();
        change((d) => moveBlocks(d, sel, e.key === "ArrowUp" ? -1 : 1));
      } else if ((e.key === "Delete" || e.key === "Backspace") && sel.size > 0 && !target?.closest("input,select,textarea")) {
        e.preventDefault();
        e.stopPropagation();
        change((d) => removeBlocks(d, sel));
        setSel(new Set());
      } else if (e.key === "Escape") {
        setSel(new Set());
        setEditing(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [guide, change, sel]);

  const set = (c: Partial<GuideDoc>) => change((d) => ({ ...d, ...c }));
  const setMarker = (c: Partial<GuideDoc["marker"]>) => change((d) => ({ ...d, marker: { ...d.marker, ...c } }));

  const selBlock = sel.size === 1 ? doc.blocks.find((x) => x.id === [...sel][0]) : undefined;
  const selStep = selBlock && selBlock.type === "step" ? selBlock : undefined;

  return (
    <div className="geditor geditor--side">
    <div className="geditor__main" onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()} onDrop={onDrop}>
      <div className="gbar" role="toolbar" aria-label={t("docs.title")}>
        {sel.size > 0 && (
          <span className="gbar__sel">
            {t("guide.selected", { count: sel.size })}
            <button type="button" className="gbar__btn" title={t("guide.moveUp")} aria-label={t("guide.moveUp")} onClick={() => change((d) => moveBlocks(d, sel, -1))}>
              ↑
            </button>
            <button type="button" className="gbar__btn" title={t("guide.moveDown")} aria-label={t("guide.moveDown")} onClick={() => change((d) => moveBlocks(d, sel, 1))}>
              ↓
            </button>
            <button
              type="button"
              className="gbar__btn"
              title={t("docs.deleteStep")}
              aria-label={t("docs.deleteStep")}
              onClick={() => (change((d) => removeBlocks(d, sel)), setSel(new Set()))}
            >
              <AppIcon name="trash" size={16} />
            </button>
          </span>
        )}
        <span className="gbar__grow" />
        <button type="button" className="gbar__btn" disabled={!guide.history.canUndo} title={`${t("docs.undo")} (Ctrl+Z)`} aria-label={t("docs.undo")} onClick={guide.undo}>
          <AppIcon name="undo" size={16} />
        </button>
        <button type="button" className="gbar__btn" disabled={!guide.history.canRedo} title={`${t("guide.redo")} (Ctrl+Y)`} aria-label={t("guide.redo")} onClick={guide.redo}>
          <AppIcon name="redo" size={16} />
        </button>
        <span className="gbar__sep" />
        <Button onClick={() => guide.recordMore(sel.size ? [...sel].pop() : undefined)}>{t("guide.recordMore")}</Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const { index, as } = fileTarget.current;
          void (as === "image" ? insertImageBlob(f, index) : insertStepFromBlob(f, index));
        }}
      />
      <div className="glist">
        {doc.blocks.length === 0 && <p className="guide__none">{t("docs.noSteps")}</p>}
        <InsertBar index={0} onInsert={(i, w) => void onInsert(i, w)} onDropBlock={(id, i) => change((d) => moveBlockTo(d, id, i))} />
        {doc.blocks.map((b: Block, i) => (
          <div key={b.id} className="gitem">
            {b.type === "step" ? (
              <StepView
                block={b}
                step={guide.steps.get(b.n)}
                number={numbers.get(b.id) ?? 0}
                doc={doc}
                selected={sel.has(b.id)}
                editing={editing === b.id}
                req={toolReq}
                onEdit={setEditing}
                onSelect={onSelectBlock}
                change={change}
                dragStart={dragStart}
              />
            ) : (
              <ContentView block={b} selected={sel.has(b.id)} onSelect={onSelectBlock} change={change} dragStart={dragStart} />
            )}
            <InsertBar index={i + 1} onInsert={(ix, w) => void onInsert(ix, w)} onDropBlock={(id, ix) => change((d) => moveBlockTo(d, id, ix))} />
          </div>
        ))}
      </div>
    </div>
      <GuideSidebar
        doc={doc}
        set={set}
        setMarker={setMarker}
        block={selStep}
        step={selStep ? guide.steps.get(selStep.n) : undefined}
        patch={(c) => selStep && change((d) => updateBlock<StepBlock>(d, selStep.id, c))}
        requestTool={(tool) => selStep && (setEditing(selStep.id), setToolReq((r) => ({ id: selStep.id, tool, n: (r?.n ?? 0) + 1 })))}
      />
      <Dialog
        open={pickList !== null}
        title={t("guide.pickScreenshot")}
        onClose={() => setPickList(null)}
        footer={<Button onClick={() => setPickList(null)}>{t("session.cancel")}</Button>}
      >
        <div className="gpick">
          {props.screenshots.length === 0 && <p>{t("guide.noScreenshots")}</p>}
          {props.screenshots.map((s) => (
            <button
              key={s.id}
              type="button"
              className="gpick__item"
              title={s.name}
              onClick={() => {
                const at = pickList?.index ?? doc.blocks.length;
                setPickList(null);
                void s.load().then((b) => insertStepFromBlob(b, at));
              }}
            >
              <img src={s.thumb} alt="" />
              <span>{s.name}</span>
            </button>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
