import { Button, Dialog, Select } from "@seconddawn/ui";
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { ipc, type Capture, type ExportSettings } from "../ipc";
import { formatTime } from "../recording/timeline";

/** A GIF over this many bytes is "very large": the person is warned before exporting. */
export const GIF_WARN_BYTES = 50 * 1024 * 1024;

export const DEFAULT_EXPORT: ExportSettings = { format: "mp4", quality: "standard", resolution: "original", aspect: "original", fit: "bars" };

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

interface Estimate {
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  bytes: number;
}

/** The shape of the result: the picture in a box of the chosen aspect ratio, with bars or cropped (a small drawing, no picture). */
function AspectPreview(props: { sourceW: number; sourceH: number; settings: ExportSettings; label: string }) {
  const { sourceW, sourceH, settings } = props;
  const target = settings.aspect === "16:9" ? 16 / 9 : settings.aspect === "9:16" ? 9 / 16 : settings.aspect === "1:1" ? 1 : sourceW / sourceH;
  const src = sourceW / sourceH;
  const box = 84;
  const [bw, bh] = target >= 1 ? [box, box / target] : [box * target, box];
  let inner: { w: number; h: number };
  if (settings.aspect === "original" || Math.abs(target - src) < 0.002) inner = { w: bw, h: bh };
  else if (settings.fit === "bars") inner = src > target ? { w: bw, h: bw / src } : { w: bh * src, h: bh };
  else inner = { w: bw, h: bh };
  return (
    <div className="exportpreview" role="img" aria-label={props.label} style={{ width: box, height: box }}>
      <div className="exportpreview__canvas" style={{ width: bw, height: bh }}>
        <div className="exportpreview__picture" style={{ width: inner.w, height: inner.h }} />
      </div>
    </div>
  );
}

/**
 * The export dialog of a recording: format (MP4 or GIF), quality, resolution, aspect ratio (with black bars or cropped), the file
 * name and the folder. It tells what the file will be (size of the picture, length, frame rate, size of the file) and warns before
 * a very large GIF. The export runs with a progress bar that can be cancelled.
 */
export function ExportDialog(props: {
  capture: Capture | null;
  /** The folder of the group of the recording: where the export goes unless another folder is chosen. */
  defaultFolder: string;
  onClose: () => void;
  onError: (e: unknown) => void;
}) {
  const { capture, onClose, onError } = props;
  const { t } = useT();
  const [settings, setSettings] = useState<ExportSettings>(DEFAULT_EXPORT);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  // When the export began, the clock (to show the time that has passed and what is left), and the finished file.
  const began = useRef(0);
  const [now, setNow] = useState(Date.now());
  const [finished, setFinished] = useState<{ file: string; bytes: number } | null>(null);
  const seq = useRef(0);

  // Each time the dialog opens for a recording: its name and its folder, the settings as they were.
  useEffect(() => {
    if (!capture) return;
    setName(capture.name);
    setFolder(props.defaultFolder);
    setProgress(null);
    setFinished(null);
  }, [capture, props.defaultFolder]);

  // What the file will be: asked again a moment after a setting changed.
  useEffect(() => {
    if (!capture) return;
    const mine = ++seq.current;
    setEstimate(null);
    const timer = window.setTimeout(() => {
      void ipc
        .estimateExport(capture.id, settings)
        .then((e) => seq.current === mine && setEstimate(e))
        .catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [capture, settings]);

  useEffect(() => {
    if (progress === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [progress === null]);

  useEffect(() => {
    const p = ipc.onRenderProgress((e) => setProgress((cur) => (cur === null ? cur : e.progress)));
    return () => void p.then((fn) => fn());
  }, []);

  if (!capture) return null;
  const gif = settings.format === "gif";
  const set = (change: Partial<ExportSettings>) => setSettings((s) => ({ ...s, ...change }));
  const busy = progress !== null;
  const qualities = gif
    ? [
        { value: "low", label: t("export.qGifLow") },
        { value: "high", label: t("export.qGifHigh") },
      ]
    : [
        { value: "high", label: t("export.qHigh") },
        { value: "standard", label: t("export.qStandard") },
        { value: "small", label: t("export.qSmall") },
      ];
  const large = gif && estimate !== null && estimate.bytes > GIF_WARN_BYTES;
  const start = () => {
    if (!folder) return;
    began.current = Date.now();
    setNow(began.current);
    setProgress(0);
    void ipc
      .exportRecording(capture.id, settings, folder, name)
      .then((r) => {
        setProgress(null);
        setFinished({ file: r.file, bytes: r.bytes });
      })
      .catch((e) => {
        setProgress(null);
        if ((e as { code?: string }).code === "cancelled") onClose();
        else {
          onError(e);
          onClose();
        }
      });
  };

  return (
    <Dialog
      open
      title={t("export.recTitle")}
      onClose={busy ? () => undefined : onClose}
      footer={
        finished ? (
          <>
            <Button onClick={() => void ipc.openFolder(finished.file).catch(onError)}>{t("ctx.showInExplorer")}</Button>
            <Button onClick={() => void ipc.openFile(finished.file).catch(onError)}>{t("export.open")}</Button>
            <Button variant="primary" onClick={onClose}>
              {t("export.close")}
            </Button>
          </>
        ) : busy ? (
          <Button onClick={() => void ipc.cancelRender()}>{t("session.cancel")}</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t("session.cancel")}
            </Button>
            <Button variant="primary" onClick={start} disabled={!folder || !name.trim()}>
              {t("export.start")}
            </Button>
          </>
        )
      }
    >
      {finished ? (
        <div className="exportdlg" role="status">
          <h3 className="exportdlg__done">{t("export.finished")}</h3>
          <p className="exportdlg__info">
            <bdi dir="ltr">{finished.file.replace(/^.*[\\/]/, "")}</bdi> ({formatBytes(finished.bytes)})
          </p>
        </div>
      ) : (
      <div className="exportdlg">
        <fieldset className="exportdlg__group" disabled={busy}>
          <legend>{t("export.format")}</legend>
          {(["mp4", "gif"] as const).map((f) => (
            <label key={f} className="exportdlg__radio">
              <input
                type="radio"
                name="export-format"
                checked={settings.format === f}
                onChange={() => set({ format: f, quality: f === "gif" ? "low" : "standard" })}
              />
              <span>{t(f === "mp4" ? "export.mp4" : "export.gif")}</span>
            </label>
          ))}
        </fieldset>
        <label className="exportdlg__row">
          <span>{t("rec.quality")}</span>
          <Select label={t("rec.quality")}value={settings.quality} disabled={busy} onChange={(quality) => set({ quality: quality as ExportSettings["quality"] })} options={qualities} />
        </label>
        <label className="exportdlg__row">
          <span>{t("export.resolution")}</span>
          <Select
            label={t("export.resolution")}
            value={settings.resolution}
            disabled={busy}
            onChange={(resolution) => set({ resolution: resolution as ExportSettings["resolution"] })}
            options={(["original", "1080", "720", "480"] as const)
              // Only the sizes that are not larger than the recording (the shorter side counts).
              .filter((r) => r === "original" || Number(r) <= Math.min(capture.width || 99999, capture.height || 99999))
              .map((r) => ({ value: r, label: t(`export.res.${r}` as "export.res.original") }))}
          />
        </label>
        <label className="exportdlg__row">
          <span>{t("export.aspect")}</span>
          <Select
            label={t("export.aspect")}
            value={settings.aspect}
            disabled={busy}
            onChange={(aspect) => set({ aspect: aspect as ExportSettings["aspect"] })}
            options={(["original", "16:9", "9:16", "1:1"] as const).map((a) => ({ value: a, label: t(`export.asp.${a}` as "export.asp.original") }))}
          />
        </label>
        {settings.aspect !== "original" && (
          <div className="exportdlg__fit">
            <fieldset className="exportdlg__group" disabled={busy}>
              <legend>{t("export.fit")}</legend>
              {(["bars", "crop"] as const).map((f) => (
                <label key={f} className="exportdlg__radio">
                  <input type="radio" name="export-fit" checked={settings.fit === f} onChange={() => set({ fit: f })} />
                  <span>{t(f === "bars" ? "export.fitBars" : "export.fitCrop")}</span>
                </label>
              ))}
            </fieldset>
            <AspectPreview sourceW={capture.width || 16} sourceH={capture.height || 9} settings={settings} label={t("export.preview")} />
          </div>
        )}
        <label className="exportdlg__row">
          <span>{t("export.fileName")}</span>
          <span className="exportdlg__name">
            <input className="textsetting" value={name} disabled={busy} maxLength={120} onChange={(e) => setName(e.target.value)} aria-label={t("export.fileName")} />
            <bdi dir="ltr">.{gif ? "gif" : "mp4"}</bdi>
          </span>
        </label>
        <div className="exportdlg__row">
          <span>{t("export.folder")}</span>
          <span className="foldersetting">
            <span className="foldersetting__path" dir="ltr" title={folder}>
              {folder}
            </span>
            <Button disabled={busy} onClick={() => void ipc.pickFolder(folder).then((f) => f && setFolder(f)).catch(() => undefined)}>
              {t("settings.chooseFolder")}
            </Button>
          </span>
        </div>
        <p className="exportdlg__info" role="status" aria-live="polite">
          {estimate
            ? gif
              ? t("export.infoGif", { width: estimate.width, height: estimate.height, duration: formatTime(estimate.durationMs / 1000), fps: estimate.fps, size: formatBytes(estimate.bytes) })
              : t("export.infoMp4", { width: estimate.width, height: estimate.height, duration: formatTime(estimate.durationMs / 1000), size: formatBytes(estimate.bytes) })
            : t("export.estimating")}
        </p>
        {gif && <p className="exportdlg__note">{t("export.gifNoSound")}</p>}
        {large && estimate && (
          <p className="exportdlg__warn" role="alert">
            {t("export.gifLarge", { size: formatBytes(estimate.bytes) })}
          </p>
        )}
        {busy && (
          <div className="exportdlg__progress" role="status">
            <span>{t("export.progress", { percent: Math.round((progress ?? 0) * 100) })}</span>
            <progress max={1} value={progress ?? 0} />
            <span className="exportdlg__time" dir="ltr">
              {t("export.elapsed", { time: formatTime((now - began.current) / 1000) })}
              {(progress ?? 0) > 0.03 &&
                ` · ${t("export.left", { time: formatTime((((now - began.current) / 1000) * (1 - (progress ?? 0))) / (progress ?? 1)) })}`}
            </span>
          </div>
        )}
      </div>
      )}
    </Dialog>
  );
}
