import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { imageUrl, type Capture, type Session } from "../ipc";
import { fitZoom, formatSize } from "../sessionModel";
import { AnnotationBar } from "./AnnotationBar";
import type { Settings } from "../settings/defaults";

/** "fit" follows the size of the stage; a number is a zoom the user chose. */
export type ZoomMode = "fit" | number;

/** The right panel: the capture's name and size, the annotation toolbar and the picture. */
export function Preview(props: {
  session: Session;
  capture: Capture | null;
  zoomMode: ZoomMode;
  /** Reports the zoom in effect (also while fitting), so the zoom menu can step from it. */
  onZoom: (zoom: number) => void;
  settings: Settings;
  onPatch: (change: Partial<Settings>) => void;
}) {
  const { t } = useT();
  const { capture, zoomMode, onZoom } = props;
  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setBox({ width: el.clientWidth - 32, height: el.clientHeight - 32 });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const zoom = capture ? (zoomMode === "fit" ? fitZoom(capture, box) : zoomMode) : 1;
  const percent = Math.round(zoom * 100);
  useEffect(() => onZoom(zoom), [zoom, onZoom]);

  return (
    <section className="preview" aria-label={capture?.name ?? t("preview.none")}>
      <div className="preview__head">
        <div className="preview__title">
          <div className="preview__name" title={capture?.name}>
            {capture?.name ?? " "}
          </div>
          <div className="preview__size">
            {capture ? <bdi>{formatSize(capture.width, capture.height)}</bdi> : " "}
          </div>
        </div>
        {capture && (
          <span className="preview__zoom" title={t("zoom.current", { percent })} dir="ltr">
            {percent}%
          </span>
        )}
      </div>

      <AnnotationBar settings={props.settings} onPatch={props.onPatch} />

      <div className="preview__stage" ref={stage}>
        {capture ? (
          <img
            className="preview__image"
            src={imageUrl(props.session, capture)}
            alt={capture.name}
            width={Math.max(1, Math.round(capture.width * zoom))}
            height={Math.max(1, Math.round(capture.height * zoom))}
            draggable={false}
          />
        ) : (
          <p className="preview__none">{t("preview.none")}</p>
        )}
      </div>
    </section>
  );
}
