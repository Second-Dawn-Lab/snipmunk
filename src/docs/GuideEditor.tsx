import { Button, Dialog } from "@seconddawn/ui";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AppIcon } from "../components/AppIcons";
import { useT } from "../i18n";
import { ipc, type GuideStep } from "../ipc";
import { notify } from "../notify";
import { RichText, storeImage } from "./RichText";
import { editors } from "./editors";
import { StepPicture, type Tool } from "./StepPicture";
import {
  duplicateBlock,
  emptyText,
  indexOfBlock,
  insertBlock,
  moveBlockTo,
  moveBlocksTo,
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
import { canvasCss, CANVAS } from "./template/css";
import { templateOf } from "./template/apply";
import { artCss, backgroundCss } from "./template/background";
import { newGuideTemplateAfterDelete, pageSize, roleColor } from "./template/model";
import { TemplateGallery } from "./template/TemplatePanel";
import { TemplateButton } from "./template/TemplateButton";
import { useTemplates } from "./template/useTemplates";
import { ContentsBlock, CoverBlock, useCoverPictures } from "./CoverBlock";
import { columnHeight, markText, placePages, sheetOf, textTop } from "./canvas";
import { pageBox, type Layout } from "./export/paginate";
import { PageSheets } from "./PageSheets";
import { useCanvasPages } from "./pageflow";
import { SidePanel, type PanelTab } from "./panel/SidePanel";
import { GuideTab } from "./panel/GuideTab";
import { StepTab } from "./panel/StepTab";
import { StepsTab } from "./panel/StepsTab";
import { RecordMore } from "./RecordMore";
import { PageView, usePrint } from "./export/ExportDialog";
import { editorSelection } from "./selection";
import { useQuickRedact } from "./RedactTools";
import { PAGE_PIXELS, PAGE_WIDTHS, ZOOM_MAX, ZOOM_MIN, clampZoom, edgeSpeed, pageScale, stepZoom, type PageFit, type PageWidth } from "./view";
import type { Settings } from "../settings/defaults";
import { readChoices, rememberChoice, type Choices } from "./panel/choices";
import type { ToolsApi } from "./panel/StepTools";
import { useToolKeys, type ToolLimits } from "./panel/ToolGrid";
import { areaOf } from "./areas";
import { placeAfterChange } from "./place";

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

/** A description in which nothing is written yet (it takes no room, in the editor as in print). */
const nothingWritten = (doc: PmDoc): boolean =>
  ((doc.content ?? []) as { type?: string; content?: unknown[] }[]).every((n) => n.type === "paragraph" && !n.content?.length);

const blobToBase64 = (b: Blob): Promise<string> =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });

type Dispatch = GuideApi["change"];

// --- the "+" between blocks -------------------------------------------------------------------------------------------------------

type Insert = "text" | "image" | "clipboard" | "screenshot" | "file" | "blank";

const InsertBar = memo(function InsertBar(props: { index: number; onInsert: (index: number, what: Insert) => void; onDropBlock: (id: string, index: number) => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  // The menu opens upwards when there is no room below the "+" inside the list.
  const [up, setUp] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const m = menuRef.current;
    const list = m?.closest(".glist");
    if (!m || !list) return;
    const room = list.getBoundingClientRect().bottom - m.parentElement!.getBoundingClientRect().bottom;
    setUp(room < m.getBoundingClientRect().height + 12);
  }, [open]);
  const item = (what: Parameters<typeof props.onInsert>[1], label: string) => (
    <button type="button" role="menuitem" className="ginsert__item" onClick={() => (setOpen(false), props.onInsert(props.index, what))}>
      {label}
    </button>
  );
  return (
    <div
      className={`ginsert${over ? " ginsert--over" : ""}${open ? " ginsert--open" : ""}`}
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
        <div ref={menuRef} className={`ginsert__menu${up ? " ginsert__menu--up" : ""}`} role="menu" onMouseLeave={() => setOpen(false)}>
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
});

/**
 * A click anywhere on a block selects it (Ctrl/Shift for several). Clicks that belong to something inside the block - a text editor,
 * a button, a field, the toolbar - and clicks while a picture tool is active keep their own meaning.
 */
function selectByClick(e: React.MouseEvent, toolActive: boolean, id: string, onSelect: (id: string, e: React.MouseEvent) => void) {
  if (toolActive) return;
  if ((e.target as HTMLElement).closest("button,input,select,textarea,a,.ProseMirror,.pop__panel,.rich__bar")) return;
  onSelect(id, e);
}

/**
 * While a block is dragged near the top or the bottom of the list, the list scrolls (faster the closer to the edge), so a block can
 * be dragged anywhere in a long guide. It stops when the pointer leaves the edge zone, and when the drag ends.
 */
function useDragScroll() {
  useEffect(() => {
    let speed = 0;
    let frame = 0;
    let seen = 0;
    // The list the pointer is over: the guide, or the outline in the sidebar.
    let target: HTMLElement | null = null;
    const list = () => target ?? document.querySelector<HTMLElement>(".glist");
    const stop = () => {
      speed = 0;
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const tick = () => {
      const l = list();
      // (a drag fires "dragover" all the time; when it stops firing, the pointer left the window)
      if (!l || speed === 0 || performance.now() - seen > 250) return stop();
      l.scrollTop += speed;
      frame = requestAnimationFrame(tick);
    };
    const over = (e: globalThis.DragEvent) => {
      target = (e.target as Element | null)?.closest?.<HTMLElement>(".gpanel__body, .glist") ?? null;
      const l = list();
      if (!l || !e.dataTransfer?.types.includes("application/x-snipmunk-block")) return;
      const r = l.getBoundingClientRect();
      speed = edgeSpeed(e.clientY, r.top, r.bottom);
      seen = performance.now();
      if (speed !== 0) {
        e.preventDefault();
        if (!frame) frame = requestAnimationFrame(tick);
      }
    };
    window.addEventListener("dragover", over, true);
    window.addEventListener("drop", stop, true);
    window.addEventListener("dragend", stop, true);
    return () => {
      stop();
      window.removeEventListener("dragover", over, true);
      window.removeEventListener("drop", stop, true);
      window.removeEventListener("dragend", stop, true);
    };
  }, []);
}

/** What stays where it is on screen while the pages are laid out anew: the text being written, else the first thing in view. */
function inView(list: HTMLElement): { el: Element; top: number } | null {
  const view = list.getBoundingClientRect();
  const seen = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.bottom > view.top + 4 && r.top < view.bottom;
  };
  const writing = document.activeElement?.closest(".ProseMirror");
  const el = writing && list.contains(writing) && seen(writing) ? writing : Array.from(list.querySelectorAll(".gstep__head, .gcontent, .gcontents__part > [data-pg], .gcover")).find(seen);
  return el ? { el, top: el.getBoundingClientRect().top } : null;
}

// --- one step -----------------------------------------------------------------------------------------------------------------------

const AREA_LABEL = { default: "guide.areaDefault", window: "settings.docPictureWindow", screen: "settings.docPictureScreen", custom: "guide.areaCustom" } as const;

const StepView = memo(function StepView(props: {
  block: StepBlock;
  step: GuideStep | undefined;
  /** The number the step shows (none when it was switched off). */
  number: number | undefined;
  doc: GuideDoc;
  selected: boolean;
  /** The picture tool of this step ("none" unless it is the selected one), and its selected mark. */
  tool: Tool;
  color: string;
  width: number;
  choices: Choices;
  ann: string | null;
  onAnn: (block: string, ann: string | null) => void;
  onSelect: (id: string, e: React.MouseEvent) => void;
  change: Dispatch;
  dragStart: (e: DragEvent, id: string) => void;
}) {
  const { t } = useT();
  const { block, step, doc, tool, change } = props;
  const patch = useCallback((c: Partial<StepBlock>, key = "") => change((d) => updateBlock<StepBlock>(d, block.id, c), key), [change, block.id]);
  const parts = block.text ?? step?.text;
  // (the same value until the words change: the text editor compares it with its own)
  const words = useMemo(() => partsToDoc(parts ?? []), [parts]);
  if (!step) return null;
  const badge = doc.badge === "none" || props.number === undefined ? null : <span className={`badge badge--${doc.badge} gstep__badge`}>{props.number}</span>;
  // Only a step with a picture area of its own says so.
  const area = step.image ? areaOf(step, block) : "default";
  const desc = block.desc ?? null;
  return (
    <article
      className={`gblock gstep step${step.image ? " step--pic gstep--pic" : ""}${props.selected ? " gblock--sel" : ""}`}
      data-block={block.id}
      tabIndex={-1}
      onClick={(e) => selectByClick(e, tool !== "none", block.id, props.onSelect)}
    >
      <div className="step__head gstep__head">
        <button type="button" className="gblock__handle step__chrome" draggable title={t("guide.drag")} aria-label={t("guide.drag")} onDragStart={(e) => props.dragStart(e, block.id)}>
          ⋮⋮
        </button>
        {badge}
        <div className="step__text gstep__text">
          <RichText mode="step" singleLine value={words}ariaLabel={t("guide.stepText")} onChange={(d) => patch({ text: docToParts(d) }, `text:${block.id}`)} />
        </div>
        <span className="gstep__side step__chrome">
          {area !== "default" && (
            <span className="gstep__area" title={t("guide.stepArea")}>
              {t(AREA_LABEL[area])}
            </span>
          )}
          <span className="gstep__actions">
            {block.text && !block.masked && !block.maskTyped && (
              <button type="button" className="gstep__btn" title={t("guide.resetText")} aria-label={t("guide.resetText")} onClick={() => patch({ text: undefined })}>
                ↺
              </button>
            )}
            <button type="button" className="gstep__btn" title={t("guide.duplicate")} aria-label={t("guide.duplicate")} onClick={() => change((d) => duplicateBlock(d, block.id).doc)}>
              <AppIcon name="duplicate" size={15} />
            </button>
            <button type="button" className="gstep__btn" title={t("docs.deleteStep")} aria-label={t("docs.deleteStep")} onClick={() => change((d) => removeBlocks(d, new Set([block.id])))}>
              <AppIcon name="trash" size={15} />
            </button>
          </span>
        </span>
      </div>
      {step.image && (
        <div className="step__media gstep__media">
          <StepPicture step={step} block={block} doc={doc} tool={tool} color={props.color} width={props.width} choices={props.choices} selected={props.ann} movable={props.selected} onSelect={(a) => props.onAnn(block.id, a)} onChange={(c, key) => patch(c, key)} />
        </div>
      )}
      {desc ? (
        <div className={`step__desc${nothingWritten(desc) ? " step__desc--empty" : ""}`}>
          <RichText mode="full" value={desc} placeholder={t("guide.descPlaceholder")} onChange={(d) => patch({ desc: d }, `desc:${block.id}`)} />
        </div>
      ) : (
        <button type="button" className="gstep__adddesc step__chrome" onClick={() => patch({ desc: emptyText() })}>
          + {t("guide.addDescription")}
        </button>
      )}
    </article>
  );
});

const ContentView = memo(function ContentView(props: { block: ContentBlock; selected: boolean; onSelect: (id: string, e: React.MouseEvent) => void; change: Dispatch; dragStart: (e: DragEvent, id: string) => void }) {
  const { t } = useT();
  const { block, change } = props;
  return (
    <article className={`gblock gcontent${props.selected ? " gblock--sel" : ""}`} data-block={block.id} tabIndex={-1} onClick={(e) => selectByClick(e, false, block.id, props.onSelect)}>
      <div className="gcontent__side">
        <button type="button" className="gblock__handle" draggable title={t("guide.drag")} aria-label={t("guide.drag")} onDragStart={(e) => props.dragStart(e, block.id)}>
          ⋮⋮
        </button>
        <button type="button" className="gstep__btn" title={t("docs.deleteStep")} aria-label={t("docs.deleteStep")} onClick={() => change((d) => removeBlocks(d, new Set([block.id])))}>
          <AppIcon name="trash" size={15} />
        </button>
      </div>
      <div className="content gcontent__body">
        <RichText mode="full" value={block.doc} placeholder={t("guide.textPlaceholder")} onChange={(d) => change((x) => updateBlock<ContentBlock>(x, block.id, { doc: d }), `text:${block.id}`)} />
      </div>
    </article>
  );
});

// --- the editor ----------------------------------------------------------------------------------------------------------------------

export function GuideEditor(props: {
  guide: GuideApi;
  screenshots: ScreenshotChoice[];
  /** The column width and zoom of the editor (user settings). */
  view: { width: PageWidth; zoom: number; fit: PageFit };
  settings: Settings;
  onPatch: (c: Partial<Settings>) => void;
  /** "Quick redact whole guide…" */
  onRedactGuide: () => void;
  /** What begins the row above the pages (the guide's name and status), and the guide's tab under that row. */
  heading: ReactNode;
  tabs: ReactNode;
  /** The place in the bottom bar for the actions of the selected blocks. */
  selectionSlot: HTMLElement | null;
}) {
  const { t } = useT();
  const { guide } = props;
  const doc = guide.doc!;
  const docRef = useRef(doc);
  docRef.current = doc;
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pickList, setPickList] = useState<{ index: number } | null>(null);
  const [tab, setTab] = useState<PanelTab>("guide");
  // The picture tool belongs to the selected step; colour and size stay from step to step.
  const [toolOf, setToolOf] = useState<{ id: string; tool: Tool } | null>(null);
  const [pickedColor, setColor] = useState<string | null>(null);
  const [stroke, setStroke] = useState(3);
  const [annOf, setAnnOf] = useState<{ id: string; ann: string } | null>(null);
  // The options of the next callout, magnifier and spotlight (counted up when one was chosen, to read them again).
  const [chosen, setChosen] = useState(0);
  const onAnn = useCallback((id: string, ann: string | null) => setAnnOf(ann === null ? null : { id, ann }), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileTarget = useRef<{ index: number; as: "image" | "step" }>({ index: 0, as: "image" });
  const numbers = useMemo(() => stepNumbers(doc), [doc]);
  const change = guide.change;
  const sourceRef = useRef({ doc, steps: guide.steps });
  sourceRef.current = { doc, steps: guide.steps };
  const quickSource = useCallback(() => sourceRef.current, []);
  const quick = useQuickRedact(props.settings, props.onPatch, quickSource, change);
  const quickRun = quick.run;
  const quickSettings = quick.settings;
  const quickPatch = quick.onPatch;
  const quickStable = useMemo(() => ({ run: quickRun, settings: quickSettings, onPatch: quickPatch }), [quickRun, quickSettings]); // (the patch function is new on every render)
  const [gallery, setGallery] = useState(false);
  const templates = useTemplates(doc, change, (id) => {
    // (new guides cannot start with a template that is gone)
    const next = newGuideTemplateAfterDelete(props.settings.docTemplate, id);
    if (next) props.onPatch({ docTemplate: next });
  });
  // "Print preview": the pages as the PDF and the printer have them, to look at.
  const [preview, setPreview] = useState(false);
  const printer = usePrint(quickSource);
  const print = printer.print;
  const { zoom, width, fit } = props.view;
  const tpl = templateOf(doc);
  // The colour of new arrows, boxes and texts: the template's, until another one is picked.
  const color = pickedColor ?? roleColor(tpl, tpl.annotation);
  const accent = roleColor(tpl, tpl.annotation);
  const choices = useMemo(() => readChoices(accent), [accent, chosen]);
  const remember = useCallback((c: Parameters<typeof rememberChoice>[0]) => {
    rememberChoice(c);
    setChosen((n) => n + 1);
  }, []);
  // What a step's picture takes from the guide: the same object until one of these changes, so only changed steps are drawn again.
  const { picture, keepFull, zoomDefault, template, marker, badge, spotlight } = doc;
  const shared = useMemo(() => ({ picture, keepFull, zoomDefault, template, marker, badge, spotlight }) as GuideDoc, [picture, keepFull, zoomDefault, template, marker, badge, spotlight]);

  // --- the pages ----------------------------------------------------------------------------------------------------------------
  const size = pageSize(tpl);
  const paged = !!size;
  const pages = useCanvasPages(doc, guide.steps, paged);
  const layout: Layout | null = paged ? (pages?.layout ?? null) : null;
  const sheet = sheetOf(layout?.box ?? pageBox({ template: tpl }));
  const pictures = useCoverPictures(tpl);
  const listRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  // The room for the pages (a hidden list has none).
  const [room, setRoom] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const l = listRef.current;
    if (!l || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (r.width > 0) setRoom({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    observer.observe(l);
    return () => observer.disconnect();
  }, []);
  const scale = paged ? pageScale(fit, zoom, room, { w: sheet.width, h: sheet.height }) : zoom / 100;
  const percent = Math.round(scale * 100);
  // What was clicked stays where it is on screen when the selection changes.
  const held = useRef<{ el: Element; top: number } | null>(null);
  const spacer = useRef(0);
  const holdPlace = useCallback((id?: string) => {
    const l = listRef.current;
    if (!l) return;
    const view = l.getBoundingClientRect();
    const el = id
      ? (l.querySelector(`[data-block="${id}"] .gstep__head`) ?? l.querySelector(`[data-block="${id}"]`))
      : Array.from(l.querySelectorAll(".gstep__head, .gcontent, .gcover, .gcontents")).find((x) => x.getBoundingClientRect().bottom > view.top + 4);
    held.current = el ? { el, top: el.getBoundingClientRect().top } : null;
  }, []);
  const showSpacer = (px: number) => {
    spacer.current = px;
    if (spacerRef.current) spacerRef.current.style.height = `${px}px`;
  };
  // Where the view is, as a share of the whole: kept when the zoom changes.
  const share = useRef(0);
  const onScroll = () => {
    const l = listRef.current;
    if (!l) return;
    // The room that was added above the guide is taken away again once it is out of sight.
    if (spacer.current > 0 && l.scrollTop >= spacer.current) {
      const added = spacer.current;
      showSpacer(0);
      l.scrollTop -= added;
    }
    if (l.clientHeight > 0) share.current = l.scrollTop / Math.max(1, l.scrollHeight);
  };

  // Put every block on its page (after anything changed its size, or the layout is new).
  const place = useRef<{ layout: Layout | null; scale: number; current: boolean }>({ layout: null, scale: 1, current: false });
  place.current = { layout, scale, current: pages?.data.doc === doc };
  const relayout = useCallback((keep: boolean) => {
    const column = columnRef.current;
    const list = listRef.current;
    const wrap = wrapRef.current;
    if (!column || !list || list.hidden) return;
    const now = place.current;
    // The guide changed and its new pages are on their way: placing blocks by the old ones would only be undone.
    if (now.layout && !now.current) return;
    const anchor = keep ? inView(list) : null;
    if (!placePages(column, now.layout) && now.layout) {
      // (a text block that had not been drawn yet)
      markText(column, now.layout);
      placePages(column, now.layout);
    }
    if (wrap) {
      const at = now.layout ? sheetOf(now.layout.box) : null;
      const sheets = column.querySelectorAll(".gsheet").length;
      column.style.minHeight = at ? `${columnHeight(at, Math.max(sheets, 1))}px` : "";
      wrap.style.height = `${Math.ceil(column.offsetHeight * now.scale)}px`;
    }
    if (anchor?.el.isConnected) {
      const moved = anchor.el.getBoundingClientRect().top - anchor.top;
      if (Math.abs(moved) >= 0.5) list.scrollTop += moved;
    }
  }, []);
  const marked = useRef<Layout | null>(null);
  // At once when the pages, the selection, the tool or the zoom changed; what only changes the size of a block is seen by the
  // observer below.
  useLayoutEffect(() => {
    const column = columnRef.current;
    if (column && marked.current !== layout) {
      marked.current = layout;
      markText(column, layout);
    }
    relayout(!held.current);
  }, [layout, sel, toolOf, scale, preview, relayout]);
  useEffect(() => {
    const flow = flowRef.current;
    if (!flow || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => relayout(true));
    });
    observer.observe(flow);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [relayout]);

  const percentRef = useRef(percent);
  percentRef.current = percent;
  const patchRef = useRef(props.onPatch);
  patchRef.current = props.onPatch;
  // Ctrl+wheel zooms the page, Ctrl+0 goes back to 100%. The place in the guide stays: the scroll position follows the new height.
  const setZoom = useCallback((z: number) => patchRef.current({ docZoom: clampZoom(z), docFit: "none" }), []);
  const lastScale = useRef(scale);
  useLayoutEffect(() => {
    const l = listRef.current;
    if (lastScale.current === scale || !l) return;
    lastScale.current = scale;
    l.scrollTop = share.current * l.scrollHeight;
  }, [scale, width]);
  useEffect(() => {
    const l = listRef.current;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(stepZoom(percentRef.current, e.deltaY < 0 ? 1 : -1));
    };
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== "0") return;
      e.preventDefault();
      setZoom(100);
    };
    l?.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", key);
    return () => {
      l?.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", key);
    };
  }, [setZoom]);

  // The preview covers the pages; closing it comes back to the same place.
  const wasAt = useRef(0);
  const showPreview = useCallback((on: boolean) => {
    if (on) wasAt.current = listRef.current?.scrollTop ?? 0;
    setPreview(on);
  }, []);
  useLayoutEffect(() => {
    const l = listRef.current;
    if (!preview && l && wasAt.current) {
      l.scrollTop = wasAt.current;
      wasAt.current = 0;
    }
  }, [preview]);

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
        const node = { type: "image", attrs: { src: guideImageUrl(img.name), alt: "", file: img.name, nw: img.width, nh: img.height } };
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

  const onInsert = async (index: number, what: Insert) => {
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

  // (the same function for every "+": a change of the guide does not draw them all again)
  const insertRef = useRef(onInsert);
  insertRef.current = onInsert;
  const insert = useCallback((index: number, what: Insert) => void insertRef.current(index, what), []);

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

  // Dropping a dragged block: when it is one of several selected blocks, the whole selection moves.
  const selRef = useRef(sel);
  selRef.current = sel;
  const dropBlock = useCallback(
    (id: string, index: number) => change((d) => (selRef.current.has(id) && selRef.current.size > 1 ? moveBlocksTo(d, selRef.current, index) : moveBlockTo(d, id, index))),
    [change],
  );
  useDragScroll();

  const dragStart = useCallback((e: DragEvent, id: string) => {
    e.dataTransfer.setData("application/x-snipmunk-block", id);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const choose = useCallback((id: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    setSel((cur) => {
      const now = docRef.current;
      if (e.shiftKey && cur.size > 0) {
        const last = [...cur].pop()!;
        const a = indexOfBlock(now, last);
        const b = indexOfBlock(now, id);
        return new Set(now.blocks.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.id));
      }
      if (e.ctrlKey || e.metaKey) {
        const n = new Set(cur);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }
      return new Set([id]);
    });
  }, []);
  // A click on a block of the guide: its step options open (a folded sidebar stays folded).
  const onSelectBlock = useCallback(
    (id: string, e: React.MouseEvent) => {
      holdPlace(id);
      // A click beside the marks lets go of the selected one: Delete then means the step again.
      if (!(e.target as Element).closest(".gann,.ghandles,.ghandle,.gredact")) setAnnOf(null);
      choose(id, e);
      if (docRef.current.blocks.some((b) => b.id === id && b.type === "step")) setTab("step");
    },
    [choose, holdPlace],
  );
  const reveal = useCallback((id: string) => {
    wasAt.current = 0;
    setPreview(false);
    // (after the selection has changed the heights)
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => listRef.current?.querySelector(`article[data-block="${id}"]`)?.scrollIntoView({ block: "start" })));
  }, []);

  /**
   * Move the selected blocks one place. The view stays where it is: the browser's scroll anchoring is off for the list, the scroll
   * position is put back after the move, and only when a moved block would leave the visible area is the list scrolled by the minimum
   * ("nearest"), never centred.
   */
  const moveSelection = useCallback(
    (delta: -1 | 1) => {
      const list = document.querySelector<HTMLElement>(".glist");
      const top = list?.scrollTop ?? 0;
      const order = doc.blocks.filter((b) => sel.has(b.id)).map((b) => b.id);
      const lead = delta < 0 ? order[0] : order[order.length - 1];
      change((d) => moveBlocks(d, sel, delta));
      window.setTimeout(() => {
        if (!list) return;
        list.scrollTop = top;
        const el = list.querySelector<HTMLElement>(`article[data-block="${lead}"]`);
        if (!el) return;
        const r = el.getBoundingClientRect();
        const v = list.getBoundingClientRect();
        // (a block taller than the view is still visible while a good part of it is on screen; a sliver of it is not: on pages a
        // step can move far down at once)
        const shown = Math.min(r.bottom, v.bottom) - Math.max(r.top, v.top);
        if (shown < Math.min(96, r.height / 2)) el.scrollIntoView({ block: "nearest" });
        // (after the pages were laid out anew)
      }, 220);
    },
    [doc, sel, change],
  );

  const toolRef = useRef<Tool>("none");
  // The selected mark of the selected step: Delete takes it away (not the step), Escape lets go of it first.
  const markRef = useRef<{ remove: () => void; release: () => void } | null>(null);

  // Keys: Ctrl+Z / Ctrl+Y (a focused rich-text editor undoes its own typing first, then the document history), Ctrl+P prints,
  // Alt+Up/Down move the selected blocks, Delete deletes them (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const pm = target?.closest<HTMLElement>(".ProseMirror");
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (ctrl && k === "p" && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        print();
        return;
      }
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
        e.stopPropagation();
        moveSelection(e.key === "ArrowUp" ? -1 : 1);
      } else if ((e.key === "Delete" || e.key === "Backspace") && sel.size > 0 && !target?.closest("input,select,textarea")) {
        e.preventDefault();
        e.stopPropagation();
        if (markRef.current) return markRef.current.remove();
        change((d) => removeBlocks(d, sel));
        setSel(new Set());
      } else if (e.key === "Escape" && !target?.closest(".pop__panel")) {
        // First the tool is put away, then the selected mark, then the selection.
        if (toolRef.current !== "none") return setToolOf(null);
        if (markRef.current) return markRef.current.release();
        holdPlace();
        setSel(new Set());
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [guide, change, sel, moveSelection, holdPlace, print]);

  editorSelection.ids = sel;
  // The tools act on a step when it is the only thing selected.
  const only = sel.size === 1 ? doc.blocks.find((b) => b.id === [...sel][0]) : undefined;
  const active = only?.type === "step" ? only : undefined;
  const activeId = active?.id;
  const activeStep = active ? guide.steps.get(active.n) : undefined;
  const tool: Tool = active && toolOf?.id === active.id ? toolOf.tool : "none";
  toolRef.current = tool;
  const setTool = useCallback((next: Tool) => setToolOf(activeId ? { id: activeId, tool: next } : null), [activeId]);
  const ann = active && annOf?.id === active.id ? annOf.ann : null;
  const patchActive = (c: Partial<StepBlock>) => active && change((d) => updateBlock<StepBlock>(d, active.id, c));
  const deleteSelectedMark = () => {
    if (!active || !ann) return;
    if (ann.startsWith("redact:")) patchActive({ redact: (active.redact ?? []).filter((_, i) => `redact:${i}` !== ann) });
    else patchActive({ annotations: (active.annotations ?? []).filter((x) => x.id !== ann) });
    setAnnOf(null);
  };
  // (a mark that is gone, by an undo, is no longer selected)
  const markThere = !!ann && !!active && (ann.startsWith("redact:") ? !!active.redact?.[Number(ann.slice(7))] : !!active.annotations?.some((a) => a.id === ann));
  markRef.current = markThere ? { remove: deleteSelectedMark, release: () => setAnnOf(null) } : null;
  const limits: ToolLimits = {
    hasClick: !!activeStep && activeStep.click !== null && activeStep.kind !== "type" && activeStep.kind !== "key",
    canExpand: !!activeStep?.monitor && activeStep.monitor[2] === activeStep.imageSize[0] && activeStep.monitor[3] === activeStep.imageSize[1],
  };
  // (the letters choose a tool for the selected step, with the sidebar open or folded)
  useToolKeys(!!activeStep?.image && !preview, tool, setTool, limits);
  useLayoutEffect(() => {
    const was = held.current;
    held.current = null;
    const l = listRef.current;
    if (!was || !l || !was.el.isConnected) return;
    const next = placeAfterChange(was.el.getBoundingClientRect().top - was.top, l.scrollTop, spacer.current);
    showSpacer(next.spacer);
    l.scrollTop = next.scroll;
  });
  const selSteps = doc.blocks.filter((b): b is StepBlock => b.type === "step" && sel.has(b.id));
  const patchSelected = (make: (b: StepBlock) => Partial<StepBlock> | null, key?: string) =>
    change((d) => ({ ...d, blocks: d.blocks.map((b) => (b.type === "step" && sel.has(b.id) ? ({ ...b, ...make(b) } as StepBlock) : b)) }), key);

  const css = useMemo(() => canvasCss(tpl), [tpl]);
  const pictureCss = `${pictures.background ? `${CANVAS} .bgimg{${backgroundCss(tpl.background, pictures.background)}}` : ""}${pictures.art ? `${CANVAS} .artimg{${artCss(pictures.art)}}` : ""}`;
  const column: CSSProperties = paged
    ? ({ width: sheet.width, transform: `scale(${scale})`, "--inv": 1 / scale } as CSSProperties)
    : { maxWidth: PAGE_PIXELS[width] ?? "none", zoom: zoom / 100 };
  const tools: ToolsApi = {
    active: active && activeStep?.image ? { block: active, step: activeStep } : null,
    tool,
    setTool,
    limits,
    color,
    setColor,
    width: stroke,
    setWidth: setStroke,
    selected: markThere ? ann : null,
    deleteSelected: deleteSelectedMark,
    choices,
    remember,
  };

  // A guide that is only a cover so far still has a page to put the first block on.
  const bare = paged && tpl.cover.on && !tpl.contents && doc.blocks.length === 0;
  const firstBar = <InsertBar index={0} onInsert={insert} onDropBlock={dropBlock} />;
  const blocks = (
    <div ref={flowRef} className="gflow" style={paged ? { width: sheet.text, marginInlineStart: sheet.margin, ...(bare ? { paddingTop: textTop(sheet, 1) } : {}) } : undefined}>
      {paged && !tpl.cover.on && (
        <div className="gtitle">
          <div className="pgap" data-gap="title" />
          <h1 className="doc-title" data-pg="title" dir="auto">
            {doc.title}
          </h1>
        </div>
      )}
      {tpl.contents && <ContentsBlock doc={doc} steps={guide.steps} where={layout?.where} onReveal={reveal} />}
      {doc.blocks.length === 0 && <p className="guide__none">{t("docs.noSteps")}</p>}
      {doc.blocks.length === 0 && firstBar}
      {doc.blocks.map((b: Block, i) => (
        <div key={b.id} className="gitem">
          <div className="pgap" data-gap={b.id} />
          {/* (on the page of the first block, not before the room in front of it) */}
          {i === 0 && firstBar}
          {b.type === "step" ? (
            <StepView
              block={b}
              step={guide.steps.get(b.n)}
              number={numbers.get(b.id)}
              doc={shared}
              selected={sel.has(b.id)}
              tool={activeId === b.id ? tool : "none"}
              color={color}
              width={stroke}
              choices={choices}
              ann={annOf?.id === b.id ? annOf.ann : null}
              onAnn={onAnn}
              onSelect={onSelectBlock}
              change={change}
              dragStart={dragStart}
            />
          ) : (
            <ContentView block={b} selected={sel.has(b.id)} onSelect={onSelectBlock} change={change} dragStart={dragStart} />
          )}
          <InsertBar index={i + 1} onInsert={insert} onDropBlock={dropBlock} />
        </div>
      ))}
    </div>
  );

  // The zoom of the pages (without a page size: the width of the column too).
  const zoomControl = (
    <div className="gzoom" role="group" aria-label={t("guide.zoomControl")}>
      {size ? (
        <span className="gzoom__size" title={t("template.pageSize")}>
          {tpl.page.size === "a4" ? "A4" : "Letter"}
        </span>
      ) : (
        <select className="gzoom__width" aria-label={t("guide.pageWidth")} title={t("guide.pageWidth")} value={width} onChange={(e) => props.onPatch({ docPageWidth: e.target.value as PageWidth })}>
          {PAGE_WIDTHS.map((w) => (
            <option key={w} value={w}>
              {t(`guide.width.${w}`)}
            </option>
          ))}
        </select>
      )}
      <button type="button" className="gbar__btn" aria-label={t("zoom.out")} title={t("zoom.out")} disabled={percent <= ZOOM_MIN} onClick={() => setZoom(stepZoom(percent, -1))}>
        -
      </button>
      {size ? (
        <select
          className="gzoom__value gzoom__fit"
          aria-label={t("guide.zoomPages")}
          title={t("guide.zoomPages")}
          value={fit === "width" || fit === "page" ? fit : "now"}
          onChange={(e) => (e.target.value === "100" ? setZoom(100) : e.target.value !== "now" && props.onPatch({ docFit: e.target.value as PageFit }))}
        >
          <option value="now" hidden>
            {percent}%
          </option>
          <option value="width">{t("guide.fitWidth")}</option>
          <option value="page">{t("guide.fitPage")}</option>
          <option value="100">100%</option>
        </select>
      ) : (
        <button type="button" className="gzoom__value" title={`${t("guide.zoomReset")} (Ctrl+0)`} onClick={() => setZoom(100)}>
          {zoom}%
        </button>
      )}
      <button type="button" className="gbar__btn" aria-label={t("zoom.in")} title={t("zoom.in")} disabled={percent >= ZOOM_MAX} onClick={() => setZoom(stepZoom(percent, 1))}>
        +
      </button>
    </div>
  );

  return (
    <div className="gdoc">
      {/* The header: one row (what the guide is at the start, what is done with it at the end) and the tab, styled as the
          header of a recording is. */}
      <div className="modehead">
      <div className="headrow">
        {props.heading}
        <div className="headrow__tools" role="toolbar" aria-label={t("docs.title")}>
          {preview && (
            <button type="button" className="gtoggle gbar__print" disabled={printer.busy} title={`${t("guide.print")} (Ctrl+P)`} onClick={print}>
              {t("guide.print")}
            </button>
          )}
          <button type="button" className="gtoggle gbar__preview" aria-pressed={preview} onClick={() => showPreview(!preview)}>
            {t("template.printPreview")}
          </button>
          <TemplateButton doc={doc} templates={templates} onManage={() => setGallery(true)} />
          {zoomControl}
          <span className="headrow__history">
            <button type="button" className="gbar__btn" disabled={!guide.history.canUndo} title={`${t("docs.undo")} (Ctrl+Z)`} aria-label={t("docs.undo")} onClick={guide.undo}>
              <AppIcon name="undo" size={16} />
            </button>
            <button type="button" className="gbar__btn" disabled={!guide.history.canRedo} title={`${t("guide.redo")} (Ctrl+Y)`} aria-label={t("guide.redo")} onClick={guide.redo}>
              <AppIcon name="redo" size={16} />
            </button>
          </span>
          <RecordMore onRecord={(area) => guide.recordMore(sel.size ? [...sel].pop() : undefined, area)} />
        </div>
      </div>
      {props.tabs}
      </div>
      <div className="geditor geditor--side">
      <div className="geditor__main" onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()} onDrop={onDrop}>
        {sel.size > 0 &&
          props.selectionSlot &&
          createPortal(
            <div className="gbar__sel" role="toolbar" aria-label={t("guide.selected", { count: sel.size })}>
              <span className="bottombar__count">{t("guide.selected", { count: sel.size })}</span>
              <button type="button" className="gbar__btn" title={t("guide.moveUp")} aria-label={t("guide.moveUp")} onClick={() => moveSelection(-1)}>
                ↑
              </button>
              <button type="button" className="gbar__btn" title={t("guide.moveDown")} aria-label={t("guide.moveDown")} onClick={() => moveSelection(1)}>
                ↓
              </button>
              <button type="button" className="gbar__btn" title={t("docs.deleteStep")} aria-label={t("docs.deleteStep")} onClick={() => (change((d) => removeBlocks(d, sel)), setSel(new Set()))}>
                <AppIcon name="trash" size={16} />
              </button>
            </div>,
            props.selectionSlot,
          )}
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
        {preview && <PageView source={{ doc, steps: guide.steps }} scale={scale} fit={fit !== "none"} />}
        <div
          className={`glist${paged ? " glist--paged" : ""}`}
          ref={listRef}
          hidden={preview}
          onScroll={onScroll}
          onClick={(e) => {
            // A click beside the blocks selects nothing.
            if (!(e.target as HTMLElement).matches(".glist,.gscale,.gpage,.gflow,.gitem,.ginsert,.gspacer,.pgap,.gsheet,.gsheet__in,.gsheet__grow") || sel.size === 0) return;
            holdPlace();
            setSel(new Set());
          }}
        >
          <style>{css + pictureCss}</style>
          <div ref={spacerRef} className="gspacer" />
          {/* The same elements with and without pages, so a change of template never makes the texts anew. */}
          <div ref={wrapRef} className={paged ? "gscale" : "gscale gscale--off"} style={paged ? { width: sheet.width * scale } : undefined}>
            <div ref={columnRef} className={`gpage tpl doc ${paged ? "gpage--paged" : "gpage--screen"}`} data-scaled={paged ? "" : undefined} data-pages={layout ? layout.cover + layout.pages.length : undefined} data-layout-ms={pages ? pages.ms.toFixed(2) : undefined} style={column}>
              {layout && pages && <PageSheets layout={layout} data={pages.data} background={!!pictures.background} atLeast={bare ? 2 : 1} />}
              {tpl.cover.on && <CoverBlock doc={doc} change={change}pictures={pictures} style={paged ? { position: "absolute", top: 0, insetInlineStart: 0, width: sheet.width, height: sheet.height, margin: 0 } : undefined} />}
              {blocks}
            </div>
          </div>
        </div>
      </div>
      <TemplateGallery open={gallery} onClose={() => setGallery(false)} doc={doc} templates={templates} />
      {templates.dialogs}
      <SidePanel
        tab={tab}
        onTab={setTab}
        collapsed={props.settings.docPanelCollapsed}
        width={props.settings.docPanelWidth}
        onLayout={(c) => props.onPatch({ ...(c.collapsed !== undefined ? { docPanelCollapsed: c.collapsed } : {}), ...(c.width !== undefined ? { docPanelWidth: c.width } : {}) })}
      >
        {{
          guide: <GuideTab doc={doc} steps={guide.steps} change={change} onRedactGuide={props.onRedactGuide} />,
          step: (
            <StepTab
              doc={doc}
              steps={guide.steps}
              blocks={selSteps}
              patch={patchSelected}
              onAdjustZoom={() => {
                if (!selSteps[0]) return;
                setToolOf({ id: selSteps[0].id, tool: "zoom" });
                reveal(selSteps[0].id);
              }}
              quick={quickStable}
              settings={props.settings}
              tools={tools}
              change={change}
            />
          ),
          steps: <StepsTab doc={doc} steps={guide.steps} selected={sel} visible={tab === "steps" && !props.settings.docPanelCollapsed} onSelect={choose} onReveal={reveal} onMove={dropBlock} />,
        }}
      </SidePanel>
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
    </div>
  );
}
