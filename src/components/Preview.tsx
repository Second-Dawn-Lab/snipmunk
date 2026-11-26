import { useT } from "../i18n";
import { type Capture, type Session } from "../ipc";
import { RecordingView } from "../lazyViews";
import { formatSize } from "../sessionModel";
import { AnnotationBar } from "./AnnotationBar";
import { Editor } from "./Editor";
import type { Settings } from "../settings/defaults";

/** "fit" follows the size of the stage; a number is a zoom the user chose. */
export type ZoomMode = "fit" | number;

/** The right panel: the capture's name and size, the annotation toolbar and the picture (the editor). */
export function Preview(props: {
  session: Session;
  capture: Capture | null;
  zoomMode: ZoomMode;
  /** Reports the zoom in effect (also while fitting), so the zoom menu can step from it. */
  onZoom: (zoom: number) => void;
  /** The zoom changed by the mouse wheel in the editor. */
  onZoomMode: (zoom: number) => void;
  settings: Settings;
  onPatch: (change: Partial<Settings>) => void;
  onError: (e: unknown) => void;
  /** The recording mode: no annotation toolbar; a video shows its details until the player exists. */
  recording?: boolean;
  /** The gallery search: the words that match are marked in the picture. */
  searchQuery?: string;
  /** A recording or a project was edited (effects, trim): the open project has unsaved changes. */
  onEdited?: () => void;
  /** The zoom in effect, for the badge. */
  zoom: number;
}) {
  const { t } = useT();
  const { capture } = props;
  const percent = Math.round(props.zoom * 100);

  return (
    <section className="preview" aria-label={capture?.name ?? t("preview.none")}>
      {capture?.kind !== "video" && (
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
      )}

      {capture?.kind !== "video" && !props.recording && <AnnotationBar settings={props.settings} onPatch={props.onPatch} />}

      <div className="preview__stage">
        {capture?.kind === "video" ? (
          <RecordingView key={capture.id} session={props.session} capture={capture} settings={props.settings} onError={props.onError} onEdited={props.onEdited} />
        ) : capture ? (
          <Editor
            key={capture.id}
            session={props.session}
            capture={capture}
            zoomMode={props.zoomMode}
            onZoom={props.onZoom}
            onZoomMode={props.onZoomMode}
            settings={props.settings}
            onPatch={props.onPatch}
            onError={props.onError}
            searchQuery={props.searchQuery}
          />
        ) : (
          <p className="preview__none">{t("preview.none")}</p>
        )}
      </div>
    </section>
  );
}
