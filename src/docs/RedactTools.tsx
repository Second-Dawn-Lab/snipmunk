import { Button, Dialog, Select } from "@seconddawn/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pop } from "../components/Pop";
import { AppIcon } from "../components/AppIcons";
import { useT } from "../i18n";
import { ipc, type GuideStep } from "../ipc";
import { notify } from "../notify";
import { anythingChosen, optionsFromSettings } from "../ocr/quickRedact";
import type { Settings } from "../settings/defaults";
import { stepNumbers, type GuideDoc, type Redaction, type StepBlock } from "./model";
import { findInText, knownValues, recordNeedsMask, scanArea, applyRedactions, type Finding } from "./redact";
import { findOnPicture } from "./scanPicture";

type Change = (fn: (d: GuideDoc) => GuideDoc, key?: string) => void;
type Style = Redaction["kind"];

const STYLE = "snipmunk.redactStyle";
const readStyle = (): Style => {
  try {
    const v = localStorage.getItem(STYLE);
    return v === "blur" || v === "pixelate" ? v : "black";
  } catch {
    return "black";
  }
};
const keepStyle = (v: Style) => {
  try {
    localStorage.setItem(STYLE, v);
  } catch {
    /* no storage */
  }
};

/** The types Quick redact looks for: the same settings as in screenshot mode. */
const TYPES = [
  ["quickRedactEmail", "ocr.redactEmail"],
  ["quickRedactPhone", "ocr.redactPhone"],
  ["quickRedactCard", "ocr.redactCard"],
  ["quickRedactIban", "ocr.redactIban"],
  ["quickRedactSecret", "ocr.redactSecret"],
  ["quickRedactCustom", "ocr.redactCustom"],
] as const;
const KIND_LABEL = { email: "ocr.redactEmail", phone: "ocr.redactPhone", card: "ocr.redactCard", iban: "ocr.redactIban", secret: "ocr.redactSecret", custom: "ocr.redactCustom" } as const;

function Options(props: { settings: Settings; onPatch: (c: Partial<Settings>) => void; style: Style; onStyle: (s: Style) => void }) {
  const { t } = useT();
  return (
    <>
      {TYPES.map(([key, label]) => (
        <label key={key} className="recopts__check">
          <input type="checkbox" checked={props.settings[key]} onChange={(e) => props.onPatch({ [key]: e.target.checked })} />
          <span>{t(label)}</span>
        </label>
      ))}
      <label className="recopts__row">
        <span>{t("redact.style")}</span>
        <Select
          label={t("redact.style")}
          value={props.style}
          onChange={(v) => props.onStyle(v as Style)}
          options={[
            { value: "black", label: t("guide.tool.black") },
            { value: "blur", label: t("guide.tool.blur") },
            { value: "pixelate", label: t("guide.tool.pixelate") },
          ]}
        />
      </label>
    </>
  );
}

/** How many pictures are read at the same time. */
const AT_ONCE = 3;

/** Read the pictures of some steps (a few at a time) and find what to cover in them and what to mask in the texts; `progress`
 * after each picture, a signal stops between two. `only`: these blocks (without it the whole guide and its cover). */
async function scan(
  doc: GuideDoc,
  steps: ReadonlyMap<number, GuideStep>,
  settings: Settings,
  only: ReadonlySet<string> | undefined,
  progress: (done: number, of: number) => void,
  signal?: AbortSignal,
): Promise<{ found: Finding[]; records: Set<string> }> {
  const options = optionsFromSettings(settings);
  const chosen = doc.blocks.filter((b): b is StepBlock => b.type === "step" && (!only || only.has(b.id)));
  const blocks = chosen.filter((b) => !!steps.get(b.n)?.image);
  const stop = () => {
    if (signal?.aborted) throw new DOMException("cancelled", "AbortError");
  };
  // Blocks that show the same part of a picture (a duplicated step) read it once.
  const read = new Map<string, ReturnType<typeof ipc.docOcr>>();
  const pictures: Finding[][] = blocks.map(() => []);
  let next = 0;
  let done = 0;
  progress(0, blocks.length);
  const worker = async () => {
    while (next < blocks.length) {
      stop();
      const i = next++;
      const step = steps.get(blocks[i].n)!;
      const area = scanArea(step, blocks[i], doc);
      const key = `${step.image}|${area?.join() ?? ""}`;
      let result = read.get(key);
      if (!result) read.set(key, (result = ipc.docOcr(step.image, area)));
      pictures[i] = await findOnPicture(blocks[i].id, step.image, await result, options);
      progress(++done, blocks.length);
    }
  };
  await Promise.all(Array.from({ length: AT_ONCE }, worker));
  stop();
  const records = new Set(chosen.filter((b) => !b.masked && recordNeedsMask(steps.get(b.n), options)).map((b) => b.id));
  // The pictures and the texts of a block next to each other, in the order of the guide (the cover first).
  const order = new Map(doc.blocks.map((b, i) => [b.id, i + 1]));
  // What a picture shows to be secret is hidden in the texts as well.
  const onPictures = pictures.flat();
  const found = [...onPictures, ...findInText(doc, steps, options, only, knownValues(onPictures))].sort((a, b) => (order.get(a.block) ?? 0) - (order.get(b.block) ?? 0));
  return { found, records };
}

export interface QuickRedact {
  settings: Settings;
  onPatch: (c: Partial<Settings>) => void;
  /** Hide what is found in these blocks (one undo step; the marks can be removed again). */
  run: (ids: ReadonlySet<string>, style: Style) => Promise<void>;
}

/** Quick redact of the selected step(s). */
export function useQuickRedact(settings: Settings, onPatch: (c: Partial<Settings>) => void, source: () => { doc: GuideDoc; steps: ReadonlyMap<number, GuideStep> }, change: Change): QuickRedact {
  const { t } = useT();
  const ref = useRef({ settings, source, change });
  ref.current = { settings, source, change };
  const busy = useRef(false);
  const run = useCallback(
    async (ids: ReadonlySet<string>, style: Style) => {
      const { settings: s, source: get, change: apply } = ref.current;
      if (busy.current || !anythingChosen(optionsFromSettings(s))) return;
      busy.current = true;
      try {
        const { doc, steps } = get();
        const { found, records } = await scan(doc, steps, s, ids, () => undefined);
        apply((d) => applyRedactions(d, steps, found, style, records));
        notify(t("redact.covered", { items: found.length }));
      } catch (e) {
        notify(String((e as { message?: string })?.message ?? e), true);
      } finally {
        busy.current = false;
      }
    },
    [t],
  );
  return { settings, onPatch, run };
}

/** The types, the style and "Quick redact": a button of the step toolbar's "Hide" group, or with `text` a button of the sidebar. */
export function QuickRedactButton(props: { quick: QuickRedact; ids: () => ReadonlySet<string>; text?: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<Style>(readStyle);
  const choose = (s: Style) => (setStyle(s), keepStyle(s));
  return (
    <Pop
      open={open}
      onClose={() => setOpen(false)}
      label={t("ocr.redact")}
      trigger={
        props.text ? (
          <Button aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {props.text}
          </Button>
        ) : (
          <button type="button" className="tool" aria-haspopup="dialog" aria-expanded={open} aria-label={t("ocr.redact")} title={t("ocr.redact")} onClick={() => setOpen((o) => !o)}>
            <AppIcon name="redact" />
          </button>
        )
      }
    >
      <div className="recopts">
        <Options settings={props.quick.settings} onPatch={props.quick.onPatch} style={style} onStyle={choose} />
        <Button
          variant="primary"
          disabled={!anythingChosen(optionsFromSettings(props.quick.settings))}
          onClick={() => {
            setOpen(false);
            void props.quick.run(props.ids(), style);
          }}
        >
          {t("ocr.redact")}
        </Button>
      </div>
    </Pop>
  );
}

type State = { step: "choose" } | { step: "busy"; done: number; of: number } | { step: "review"; found: Finding[]; records: Set<string> };

/** A found text as the list shows it: one line, not too long. */
const short = (text: string) => {
  const line = [...text.replace(/\s+/g, " ").trim()];
  return line.length > 60 ? `${line.slice(0, 59).join("")}…` : line.join("");
};

/**
 * "Quick redact whole guide…": every step picture and every text is read (progress, Cancel), then what was found is listed by
 * type with the place it is in; each item can be unticked, and Apply is one undo step.
 */
export function RedactDialog(props: { open: boolean; onClose: () => void; doc: GuideDoc; steps: ReadonlyMap<number, GuideStep>; settings: Settings; onPatch: (c: Partial<Settings>) => void; change: Change }) {
  const { t } = useT();
  const [state, setState] = useState<State>({ step: "choose" });
  const [style, setStyle] = useState<Style>(readStyle);
  const [off, setOff] = useState<ReadonlySet<number>>(new Set());
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!props.open) return abort.current?.abort();
    setState({ step: "choose" });
    setOff(new Set());
  }, [props.open]);

  // Steps are numbered as their badges are; the other blocks ("Text block 2") are counted on their own.
  const numbers = new Map<string, number>();
  let stepCount = 0;
  let others = 0;
  const shown = stepNumbers(props.doc);
  for (const b of props.doc.blocks) {
    if (b.type === "step") ++stepCount;
    numbers.set(b.id, b.type === "step" ? (shown.get(b.id) ?? stepCount) : ++others);
  }
  const place = (f: Finding) => (f.where === "cover" ? t("redact.item.cover") : t(`redact.item.${f.where}`, { n: numbers.get(f.block) ?? 0 }));

  const start = async () => {
    abort.current = new AbortController();
    const signal = abort.current.signal;
    setState({ step: "busy", done: 0, of: stepCount });
    try {
      const r = await scan(props.doc, props.steps, props.settings, undefined, (done, of) => !signal.aborted && setState({ step: "busy", done, of }), signal);
      if (!signal.aborted) setState({ step: "review", ...r });
    } catch (e) {
      if ((e as { name?: string }).name !== "AbortError") notify(String((e as { message?: string })?.message ?? e), true);
      setState({ step: "choose" });
    }
  };
  const apply = () => {
    if (state.step !== "review") return;
    const chosen = state.found.filter((_, i) => !off.has(i));
    props.change((d) => applyRedactions(d, props.steps, chosen, style, state.records));
    props.onClose();
  };
  const toggle = (i: number) =>
    setOff((set) => {
      const n = new Set(set);
      if (!n.delete(i)) n.add(i);
      return n;
    });
  const close = () => (abort.current?.abort(), props.onClose());

  return (
    <Dialog
      open={props.open}
      title={t("redact.wholeTitle")}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t("session.cancel")}
          </Button>
          {state.step === "choose" && (
            <Button variant="primary" disabled={!anythingChosen(optionsFromSettings(props.settings))} onClick={() => void start()}>
              {t("redact.scan")}
            </Button>
          )}
          {state.step === "review" && (
            <Button variant="primary" disabled={state.found.length - off.size === 0 && state.records.size === 0} onClick={apply}>
              {t("redact.apply")}
            </Button>
          )}
        </>
      }
    >
      <div className="redact">
        {state.step === "choose" && <Options settings={props.settings} onPatch={props.onPatch} style={style} onStyle={(s) => (setStyle(s), keepStyle(s))} />}
        {state.step === "busy" && (
          <>
            <progress max={Math.max(1, state.of)} value={state.done} />
            <p>{t("redact.scanning", { done: Math.min(state.of, state.done + 1), of: state.of })}</p>
          </>
        )}
        {state.step === "review" && (
          <>
            <p className="redact__sum">{t("redact.foundItems", { items: state.found.length })}</p>
            {(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((kind) => {
              const items = state.found.map((f, i) => ({ f, i })).filter((x) => x.f.kind === kind);
              if (items.length === 0) return null;
              return (
                <fieldset key={kind}>
                  <legend>
                    {t(KIND_LABEL[kind])} ({items.length})
                  </legend>
                  {items.map(({ f, i }) => (
                    <label key={i} className="redact__item">
                      <input type="checkbox" checked={!off.has(i)} onChange={() => toggle(i)} />
                      <span>
                        {place(f)}: <bdi>{f.text ? short(f.text) : t("redact.unreadable")}</bdi>
                      </span>
                    </label>
                  ))}
                </fieldset>
              );
            })}
          </>
        )}
      </div>
    </Dialog>
  );
}
