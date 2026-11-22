import { Button, Dialog } from "@seconddawn/ui";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { ipc, type GuideStep, type GuideSummary } from "../ipc";
import { notify } from "../notify";
import type { Settings } from "../settings/defaults";
import { AppIcon } from "./AppIcons";

/** The address of a picture of a guide. */
const imageUrl = (id: string, file: string) => convertFileSrc(`guide/${id}/${file}`, "snipmunk-img");

type Rect = [number, number, number, number];

/** What part of the step picture is shown: the zoom area, the active window, or everything. */
export function cropOf(step: GuideStep, settings: Pick<Settings, "docStepPicture" | "docZoomDefault">): Rect {
  const [iw, ih] = step.imageSize;
  const whole: Rect = [0, 0, iw, ih];
  const clamp = (r: Rect): Rect => {
    const x = Math.max(0, r[0]);
    const y = Math.max(0, r[1]);
    const w = Math.min(iw - x, r[2] - (x - r[0]));
    const h = Math.min(ih - y, r[3] - (y - r[1]));
    return w > 8 && h > 8 ? [x, y, w, h] : whole;
  };
  if (settings.docZoomDefault && step.zoom) return clamp(step.zoom);
  if (settings.docStepPicture === "window" && step.window && step.window.rect[2] > 0) return clamp(step.window.rect);
  return whole;
}

/** One step: its number, its text (bold parts) and the picture cropped, with the click marker drawn on top (not burned in). */
function StepCard(props: { id: string; step: GuideStep; settings: Settings; index: number; onDelete: (s: GuideStep) => void; onCopy: (s: GuideStep, crop: Rect) => void }) {
  const { t } = useT();
  const { step, settings } = props;
  const ref = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(false);
  // Pictures load when the step comes near the screen (a guide can have more than a hundred steps).
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  const crop = cropOf(step, settings);
  const [cx, cy, cw, ch] = crop;
  const [iw] = step.imageSize;
  const marker = step.click && step.kind !== "type" && step.kind !== "key" ? step.click : null;
  return (
    <article className="gstep" tabIndex={-1} ref={ref} data-step={step.n} aria-label={t("docs.stepAlt", { n: props.index + 1 })}>
      <div className="gstep__head">
        <span className="gstep__badge">{props.index + 1}</span>
        <p className="gstep__text">
          {step.text.map((p, i) => (p.b ? <strong key={i}>{p.t}</strong> : <span key={i}>{p.t}</span>))}
        </p>
        <span className="gstep__actions">
          <button type="button" className="gstep__btn" title={t("docs.copyPicture")} aria-label={t("docs.copyPicture")} onClick={() => props.onCopy(step, crop)}>
            <AppIcon name="copy" size={15} />
          </button>
          <button type="button" className="gstep__btn" title={t("docs.deleteStep")} aria-label={t("docs.deleteStep")} onClick={() => props.onDelete(step)}>
            <AppIcon name="trash" size={15} />
          </button>
        </span>
      </div>
      <div className="gstep__pic" style={{ aspectRatio: `${cw} / ${ch}` }}>
        {seen && (
          <img
            src={imageUrl(props.id, step.image)}
            alt=""
            draggable={false}
            style={{ width: `${(iw / cw) * 100}%`, left: `${-(cx / cw) * 100}%`, top: `${-(cy / ch) * 100}%` }}
          />
        )}
        {seen && marker && (
          <span
            className="gstep__marker"
            style={{ left: `${((marker[0] - cx) / cw) * 100}%`, top: `${((marker[1] - cy) / ch) * 100}%`, borderColor: settings.docMarkerColor }}
          />
        )}
      </div>
    </article>
  );
}

/** A guide, read only: title (renamed in place), the steps, "Copy all as text". */
function GuideView(props: { id: string; settings: Settings; onBack: () => void }) {
  const { t } = useT();
  const { id } = props;
  const [title, setTitle] = useState("");
  const [steps, setSteps] = useState<GuideStep[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [undo, setUndo] = useState<GuideStep | null>(null);
  const undoTimer = useRef(0);
  const list = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    void ipc.guideGet(id).then((g) => g && setTitle(g.title));
    void ipc.guideSteps(id).then((s) => setSteps(s.filter((x) => !x.deleted)));
  }, [id]);
  useEffect(load, [load]);

  const remove = (s: GuideStep) => {
    void ipc.guideStepDelete(id, s.n, false).then(() => {
      setSteps((cur) => cur.filter((x) => x.n !== s.n));
      setUndo(s);
      window.clearTimeout(undoTimer.current);
      undoTimer.current = window.setTimeout(() => setUndo(null), 7000);
    });
  };
  const restore = () => {
    if (!undo) return;
    const s = undo;
    setUndo(null);
    void ipc.guideStepDelete(id, s.n, true).then(load);
  };
  const copyAll = () =>
    void ipc
      .guideText(id)
      .then((text) => ipc.copyText(text))
      .then(() => notify(t("docs.copied")))
      .catch((e) => notify(String(e), true));
  const copyPicture = (s: GuideStep, crop: Rect) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = crop[2];
      c.height = crop[3];
      c.getContext("2d")?.drawImage(img, crop[0], crop[1], crop[2], crop[3], 0, 0, crop[2], crop[3]);
      c.toBlob((blob) => {
        if (!blob) return;
        void navigator.clipboard
          .write([new ClipboardItem({ "image/png": blob })])
          .then(() => notify(t("docs.copied")))
          .catch((e) => notify(String(e), true));
      }, "image/png");
    };
    img.crossOrigin = "anonymous";
    img.src = imageUrl(id, s.image);
  };
  const rename = () => {
    setRenaming(false);
    const next = draft.trim();
    if (next && next !== title) void ipc.guideRename(id, next).then(setTitle);
  };
  // Keyboard: arrows move between steps, Delete removes the one that has the focus.
  const onKey = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (["INPUT", "TEXTAREA"].includes(target.tagName)) return;
    const cards = Array.from(list.current?.querySelectorAll<HTMLElement>(".gstep") ?? []);
    const at = cards.findIndex((c) => c === document.activeElement || c.contains(document.activeElement));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const next = cards[Math.min(cards.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))];
      next?.focus();
      next?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } else if ((e.key === "Delete" || e.key === "Backspace") && at >= 0) {
      // (the window must not ask to delete a screenshot for this key)
      e.preventDefault();
      e.stopPropagation();
      const n = Number(cards[at].dataset.step);
      const s = steps.find((x) => x.n === n);
      if (s) remove(s);
    } else if (e.key === "z" && (e.ctrlKey || e.metaKey) && undo) {
      e.preventDefault();
      restore();
    }
  };

  return (
    <div className="guide">
      <div className="guide__head">
        <button type="button" className="guide__back" onClick={props.onBack}>
          <AppIcon name="chevron" size={14} />
          <span>{t("docs.back")}</span>
        </button>
        {renaming ? (
          <input
            className="guide__title guide__title--edit"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => {
              if (e.key === "Enter") rename();
              if (e.key === "Escape") setRenaming(false);
            }}
          />
        ) : (
          <button type="button" className="guide__title" title={t("docs.rename")} onClick={() => (setDraft(title), setRenaming(true))}>
            {title}
          </button>
        )}
        <span className="guide__count">{t("docs.steps", { count: steps.length })}</span>
        <Button onClick={copyAll} disabled={steps.length === 0}>
          {t("docs.copyAll")}
        </Button>
      </div>
      <div className="guide__list" ref={list} tabIndex={0} onKeyDown={onKey}>
        {steps.length === 0 && <p className="guide__none">{t("docs.noSteps")}</p>}
        {steps.map((s, i) => (
          <StepCard key={s.n} id={id} step={s} settings={props.settings} index={i} onDelete={remove} onCopy={copyPicture} />
        ))}
      </div>
      {undo && (
        <div className="guide__undo" role="status">
          <span>{t("docs.stepDeleted", { n: undo.n })}</span>
          <button type="button" onClick={restore}>
            {t("docs.undo")}
          </button>
        </div>
      )}
    </div>
  );
}

const dateText = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Documents mode: the list of guides (newest first) and the read-only view of one. */
export function DocumentsView(props: { settings: Settings; openId: string | null; onOpened: () => void; hotkey: string; onNew: () => void }) {
  const { t } = useT();
  const [guides, setGuides] = useState<GuideSummary[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [deleting, setDeleting] = useState<GuideSummary | null>(null);
  const [lost, setLost] = useState<[string, string, number][]>([]);

  const refresh = useCallback(() => void ipc.guidesList().then(setGuides).catch(() => undefined), []);
  useEffect(() => {
    refresh();
    void ipc.guidesUnfinished().then(setLost).catch(() => undefined);
    const p = ipc.onGuideFinished(() => refresh());
    return () => void p.then((fn) => fn());
  }, [refresh]);
  // A guide that was just stopped opens at once.
  useEffect(() => {
    if (props.openId) {
      setOpen(props.openId);
      props.onOpened();
      refresh();
    }
  }, [props.openId]);

  const commitRename = (g: GuideSummary) => {
    setRenaming(null);
    const next = draft.trim();
    if (next && next !== g.title) void ipc.guideRename(g.id, next).then(refresh);
  };

  const first = lost[0];
  const recoverDialog = (
    <Dialog
      open={!!first}
      title={t("docs.recoverTitle")}
      onClose={() => setLost((l) => l.slice(1))}
      footer={
        <>
          <Button
            variant="danger"
            onClick={() => {
              if (first) void ipc.guideDelete(first[0]).then(refresh);
              setLost((l) => l.slice(1));
            }}
          >
            {t("docs.discard")}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (first) void ipc.guideRecover(first[0]).then(refresh);
              setLost((l) => l.slice(1));
            }}
          >
            {t("docs.recover", { count: first?.[2] ?? 0 })}
          </Button>
        </>
      }
    >
      <p>{t("docs.recoverBody", { title: first?.[1] ?? "", count: first?.[2] ?? 0 })}</p>
    </Dialog>
  );

  if (open) {
    return (
      <>
        <GuideView id={open} settings={props.settings} onBack={() => (setOpen(null), refresh())} />
        {recoverDialog}
      </>
    );
  }
  return (
    <div className="guides">
      <div className="guides__head">
        <h2>{t("docs.title")}</h2>
        <Button variant="primary" title={t("docs.newTip", { hotkey: props.hotkey })} onClick={props.onNew}>
          {t("docs.new")}
        </Button>
      </div>
      {guides.length === 0 ? (
        <div className="guides__empty">
          <AppIcon name="documents" size={44} />
          <p>{t("docs.empty")}</p>
        </div>
      ) : (
        <ul className="guides__list">
          {guides.map((g) => (
            <li key={g.id} className="gcard">
              <button type="button" className="gcard__open" onClick={() => setOpen(g.id)} title={g.title}>
                <span className="gcard__thumb">
                  {g.firstImage && <img src={imageUrl(g.id, g.firstImage)} alt="" loading="lazy" draggable={false} />}
                </span>
                <span className="gcard__text">
                  {renaming === g.id ? null : <strong>{g.title}</strong>}
                  <small>
                    {t("docs.steps", { count: g.steps })} · {dateText(g.created)}
                  </small>
                </span>
              </button>
              {renaming === g.id && (
                <input
                  className="gcard__rename"
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commitRename(g)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(g);
                    if (e.key === "Escape") setRenaming(null);
                  }}
                />
              )}
              <span className="gcard__actions">
                <button type="button" title={t("docs.rename")} aria-label={t("docs.rename")} onClick={() => (setDraft(g.title), setRenaming(g.id))}>
                  <AppIcon name="rename" size={15} />
                </button>
                <button type="button" title={t("docs.delete")} aria-label={t("docs.delete")} onClick={() => setDeleting(g)}>
                  <AppIcon name="trash" size={15} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={!!deleting}
        title={t("docs.deleteTitle")}
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t("session.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const g = deleting;
                setDeleting(null);
                if (g) void ipc.guideDelete(g.id).then(refresh);
              }}
            >
              {t("docs.delete")}
            </Button>
          </>
        }
      >
        <p>{t("docs.deleteBody")}</p>
      </Dialog>
      {recoverDialog}
    </div>
  );
}
