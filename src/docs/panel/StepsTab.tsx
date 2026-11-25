// The "Steps" tab: the guide as an outline - cover, contents, every step and text block in order. A click selects (Ctrl and
// Shift for several) and brings it into view, dragging reorders, Delete removes (the editor's own keys).

import { memo, useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { useT } from "../../i18n";
import type { GuideStep } from "../../ipc";
import { stepNumbers, type Block, type GuideDoc, type StepBlock } from "../model";
import { useNear } from "../StepPicture";
import { shownRect, templateOf } from "../template/apply";
import { guideImageUrl } from "../urls";
import { firstWords } from "./outline";

const DRAG = "application/x-snipmunk-block";

/** A tiny picture of a step: the part it shows. */
const Thumb = memo(function Thumb(props: { step: GuideStep; block: StepBlock; doc: GuideDoc }) {
  const box = useRef<HTMLSpanElement>(null);
  const near = useNear(box, 200);
  const [x, y, w, h] = shownRect(props.step, props.block, props.doc).view;
  // The part keeps its shape inside the small box.
  const wide = w / h > 48 / 30;
  return (
    <span ref={box} className="goutline__thumb">
      <span style={{ aspectRatio: `${w} / ${h}`, width: wide ? "100%" : undefined, height: wide ? undefined : "100%" }}>
        {near && <img src={guideImageUrl(props.step.image, true)} alt="" decoding="async" draggable={false} style={{ width: `${(props.step.imageSize[0] / w) * 100}%`, left: `${(-x / w) * 100}%`, top: `${(-y / h) * 100}%` }} />}
      </span>
    </span>
  );
});

// (while it is not shown, changes of the guide do not draw its long list again)
export const StepsTab = memo(StepsList, (a, b) => !a.visible && !b.visible);

function StepsList(props: {
  doc: GuideDoc;
  steps: ReadonlyMap<number, GuideStep>;
  selected: ReadonlySet<string>;
  /** The tab is the one on screen. */
  visible: boolean;
  onSelect: (id: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void;
  /** Bring the cover, the contents or a block into view in the editor. */
  onReveal: (id: string) => void;
  /** Move a block (or the selection it is part of) before the block at `index`. */
  onMove: (id: string, index: number) => void;
}) {
  const { t } = useT();
  const { doc } = props;
  const list = useRef<HTMLUListElement>(null);
  // Where a dragged block would go: before the block at this index.
  const [over, setOver] = useState<number | null>(null);
  const numbers = stepNumbers(doc);
  const tpl = templateOf(doc);
  // The selection made in the editor is brought into view here too.
  const last = [...props.selected].pop();
  useEffect(() => {
    if (props.visible && last) list.current?.querySelector(`[data-outline="${last}"]`)?.scrollIntoView({ block: "nearest" });
  }, [props.visible, last]);

  const choose = (id: string, e: MouseEvent | KeyboardEvent) => {
    props.onSelect(id, e);
    props.onReveal(id);
  };
  const keys = (e: KeyboardEvent, index: number) => {
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    // (Alt with the arrows moves the selection: the editor's own keys)
    if (!step || e.altKey) return;
    e.preventDefault();
    const next = doc.blocks[index + step];
    if (!next) return;
    choose(next.id, e);
    list.current?.querySelector<HTMLElement>(`[data-outline="${next.id}"]`)?.focus();
  };
  const dragOver = (e: DragEvent, index: number) => {
    if (!e.dataTransfer.types.includes(DRAG)) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    setOver(e.clientY > r.top + r.height / 2 ? index + 1 : index);
  };
  const drop = (e: DragEvent) => {
    const id = e.dataTransfer.getData(DRAG);
    setOver(null);
    if (!id || over === null) return;
    e.preventDefault();
    e.stopPropagation();
    props.onMove(id, over);
  };
  const fixed = (id: "cover" | "contents", label: string) => (
    <li className="goutline__fixed">
      <button type="button" onClick={() => props.onReveal(id)}>
        {label}
      </button>
    </li>
  );
  const item = (b: Block, index: number) => {
    const step = b.type === "step" ? props.steps.get(b.n) : undefined;
    const words = b.type === "step" ? firstWords((b.text ?? step?.text ?? []).map((p) => p.t).join("")) : firstWords(b.doc);
    const selected = props.selected.has(b.id);
    return (
      <li key={b.id} className={`goutline__item${over === index ? " goutline__item--before" : ""}${over === index + 1 && index === doc.blocks.length - 1 ? " goutline__item--after" : ""}`} onDragOver={(e) => dragOver(e, index)} onDrop={drop}>
        <button
          type="button"
          data-outline={b.id}
          aria-current={selected || undefined}
          className={selected ? "goutline__on" : undefined}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG, b.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => setOver(null)}
          onClick={(e) => choose(b.id, e)}
          onKeyDown={(e) => keys(e, index)}
        >
          <span className="goutline__number">{b.type === "step" ? (numbers.get(b.id) ?? "·") : "¶"}</span>
          <span className="goutline__words" dir="auto">
            {words || t(b.type === "step" ? "panel.step" : "panel.textBlock")}
          </span>
          {b.type === "step" && step?.image && <Thumb step={step} block={b} doc={doc} />}
        </button>
      </li>
    );
  };
  return (
    <ul ref={list} className="goutline" aria-label={t("panel.tree")}onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(null)}>
      {tpl.cover.on && fixed("cover", t("template.cover"))}
      {tpl.contents && fixed("contents", t("export.contents"))}
      {doc.blocks.map(item)}
      {doc.blocks.length === 0 && <li className="fxpanel__note">{t("docs.noSteps")}</li>}
    </ul>
  );
}
