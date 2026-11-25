// Development builds only: what Windows read on a step picture, where, and what Quick redact found in it, so a missed value
// can be explained. Loaded lazily from the step tab; a release build never includes it.
import { Button, Dialog } from "@seconddawn/ui";
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { ipc, type GuideStep } from "../ipc";
import { notify } from "../notify";
import { findMatches } from "../ocr/pii";
import { optionsFromSettings } from "../ocr/quickRedact";
import { findGarbledIbans } from "../ocr/sensitive";
import type { OcrResult } from "../ocr/types";
import type { Settings } from "../settings/defaults";
import type { GuideDoc, Rect, StepBlock } from "./model";
import { addAfterLabels, findInPicture, labelsIn, scanArea, type Finding, type PictureLabel } from "./redact";
import { guideImageUrl } from "./urls";

interface Reading {
  area: Rect;
  result: OcrResult;
  labels: PictureLabel[];
  inks: (Rect | null)[];
  found: Finding[];
}

/** Every recognized line from top to bottom: where it is, what it says and which finder matched what. */
function lineReport(r: Reading, settings: Settings) {
  const options = optionsFromSettings(settings);
  return r.result.lines
    .map((l) => {
      const x = Math.min(...l.words.map((w) => w.x));
      const y = Math.min(...l.words.map((w) => w.y));
      const matches = [...findMatches(l.text, options), ...(options.iban ? findGarbledIbans(l.text) : [])].map((m) => `${m.kind}: ${m.text}`);
      return { x: Math.round(x), y: Math.round(y), text: l.text, matches };
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

export function reportText(r: Reading, settings: Settings): string {
  return [
    `picture ${r.result.width}x${r.result.height}, read ${r.area.join(",")}, language ${r.result.language}, ${r.result.tookMs} ms`,
    "lines (x,y text [matches]):",
    ...lineReport(r, settings).map((l) => `${l.x},${l.y} ${JSON.stringify(l.text)}${l.matches.length ? ` [${l.matches.join("; ")}]` : ""}`),
    "labels (kind label-box -> ink after it):",
    ...r.labels.map((l, i) => `${l.kind} ${l.box.join(",")} -> ${r.inks[i]?.join(",") ?? "nothing"}`),
    "covered (kind box text):",
    ...r.found.map((f) => `${f.kind} ${f.rect!.join(",")} ${JSON.stringify(f.text)}`),
  ].join("\n");
}

export default function OcrDebug(props: { step: GuideStep; block: StepBlock; doc: GuideDoc; settings: Settings; onClose: () => void }) {
  const { t } = useT();
  const [reading, setReading] = useState<Reading | null>(null);
  const { step, block, doc, settings } = props;
  useEffect(() => {
    let gone = false;
    void (async () => {
      const area = scanArea(step, block, doc);
      const options = optionsFromSettings(settings);
      const result = await ipc.docOcr(step.image, area);
      const labels = labelsIn(result, options);
      const inks = labels.length ? await ipc.docInk(step.image, labels.map((l) => l.box)) : [];
      const found = addAfterLabels(block.id, result, findInPicture(block.id, result, options), labels, inks);
      if (!gone) setReading({ area: area ?? [0, 0, step.imageSize[0], step.imageSize[1]], result, labels, inks, found });
    })().catch((e) => notify(String(e?.message ?? e), true));
    return () => {
      gone = true;
    };
  }, [step, block, doc, settings]);
  const box = (key: string, r: Rect, color: string, width: number, title: string) => (
    <rect key={key} x={r[0]} y={r[1]} width={r[2]} height={r[3]} fill="none" stroke={color} strokeWidth={width} vectorEffect="non-scaling-stroke">
      <title>{title}</title>
    </rect>
  );
  return (
    <Dialog
      open
      title={t("ocr.debug")}
      onClose={props.onClose}
      footer={
        <>
          <Button disabled={!reading} onClick={() => reading && void navigator.clipboard.writeText(reportText(reading, settings)).catch((e) => notify(String(e?.message ?? e), true))}>
            {t("ocr.debugCopy")}
          </Button>
          <Button variant="primary" onClick={props.onClose}>
            {t("guide.ok")}
          </Button>
        </>
      }
    >
      <div className="ocrdbg">
        {!reading && <p>{t("export.working")}</p>}
        {reading && (
          <>
            <svg viewBox={reading.area.join(" ")} className="ocrdbg__picture">
              <image href={guideImageUrl(step.image, true)} width={step.imageSize[0]} height={step.imageSize[1]} />
              {reading.result.lines.flatMap((l, i) => l.words.map((w, j) => box(`w${i}-${j}`, [w.x, w.y, w.w, w.h], "#2563eb", 1, `${w.text}  (${l.text})`)))}
              {reading.inks.map((r, i) => r && box(`i${i}`, r, "#d97706", 1, reading.labels[i].kind))}
              {reading.found.map((f, i) => box(`f${i}`, f.rect!, "#dc2626", 2, `${f.kind}: ${f.text}`))}
            </svg>
            <pre className="ocrdbg__text" dir="ltr">
              {reportText(reading, settings)}
            </pre>
          </>
        )}
      </div>
    </Dialog>
  );
}
