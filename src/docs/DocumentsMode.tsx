import { Button } from "@seconddawn/ui";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppIcon } from "../components/AppIcons";
import { MenuItem } from "../components/MenuItem";
import { Pop } from "../components/Pop";
import { useT } from "../i18n";
import { imageUrl, type Capture, type Session } from "../ipc";
import type { Settings } from "../settings/defaults";
import { GuideEditor, type ScreenshotChoice } from "./GuideEditor";
import { ExportDialog, useCopyAs, type CopyKind } from "./export/ExportDialog";
import { editorSelection } from "./selection";
import { RedactDialog } from "./RedactTools";
import type { GuideApi } from "./useGuide";

/** Start renaming the open guide: its name in the header becomes a field (F2 and the File menu). */
export const renameGuide = () => document.querySelector<HTMLButtonElement>(".recheader__name")?.click();

/** The heading of the open guide, like the recording's: icon, name, status and steps. It begins the row above the pages. */
function GuideHeading({ guide }: { guide: GuideApi }) {
  const { t } = useT();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const steps = guide.doc ? guide.doc.blocks.filter((b) => b.type === "step").length : 0;
  const start = () => (setDraft(guide.title), setRenaming(true));
  const commit = () => {
    setRenaming(false);
    guide.rename(draft);
  };
  return (
    <div className="recheader" role="group" aria-label={t("guide.header")}>
      <AppIcon name="documents" size={18} />
      {renaming ? (
        <input
          className="recheader__input"
          autoFocus
          value={draft}
          maxLength={80}
          aria-label={t("proj.rename")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setRenaming(false);
          }}
        />
      ) : (
        <button type="button" className="recheader__name" title={guide.savedPath ? `${guide.savedPath}\n${t("proj.rename")}` : t("proj.rename")} onClick={start} onKeyDown={(e) => e.key === "F2" && start()}>
          <span>{guide.title}</span>
          <AppIcon name="rename" size={13} />
        </button>
      )}
      <span className={`recheader__chip recheader__chip--${guide.status}`}>
        {guide.status === "edited" && <span className="recheader__dot" aria-hidden="true" />}
        {t(guide.status === "edited" ? "proj.statusEdited" : guide.status === "saved" ? "proj.statusSaved" : "proj.notSaved")}
      </span>
      <span className="recheader__size">{t("docs.steps", { count: steps })}</span>
    </div>
  );
}

/** The bottom bar of an open guide, like the recording's: what can be done with the selected blocks at the start (like the
 * screenshot selection), "Copy as" and Export at the end. */
function GuideBottomBar({ selection, onExport, onCopy }: { selection: (el: HTMLElement | null) => void; onExport: () => void; onCopy: (k: CopyKind) => void }) {
  const { t } = useT();
  const [copy, setCopy] = useState(false);
  return (
    <footer className="bottombar">
      <span className="bottombar__sel" ref={selection} />
      <span className="bottombar__spacer" />
      <Pop
        open={copy}
        onClose={() => setCopy(false)}
        kind="menu"
        label={t("export.copyAs")}
        align="end"
        trigger={
          <button type="button" className="dw-btn bottombar__copyas" aria-haspopup="menu" aria-expanded={copy} onClick={() => setCopy((o) => !o)}>
            <AppIcon name="copy" size={16} />
            {t("export.copyAs")}
            <AppIcon name="chevron" size={13} />
          </button>
        }
      >
        {(["rich", "markdown", "markdownPictures", "text"] as const).map((k) => (
          <MenuItem key={k} label={t(`export.copy.${k}`)} onSelect={() => (setCopy(false), onCopy(k))} />
        ))}
      </Pop>
      <button type="button" className="dw-btn dw-btn--primary bottombar__export" title={`${t("export.button")} (Ctrl+E)`} onClick={onExport}>
        <AppIcon name="save" size={16} />
        {t("export.button")}
      </button>
    </footer>
  );
}

/** The open guide as a tab under the header, like the tabs of a recording (one tab: one guide is open at a time). */
function GuideTabs({ guide }: { guide: GuideApi }) {
  const { t } = useT();
  const unsaved = guide.status !== "saved";
  return (
    <div className="rectabs" role="tablist" aria-label={t("guide.tabs")}>
      <div className="rectabs__strip">
        <span className="rectab rectab--active" role="presentation" title={guide.savedPath ?? guide.title}>
          <button type="button" role="tab" aria-selected="true" className="rectab__main" onAuxClick={(e) => e.button === 1 && guide.close()}>
            <span className="rectab__name">{guide.title}</span>
            {unsaved && (
              <span className="rectab__mark" title={t("proj.unsavedDot")} aria-label={t("proj.unsavedDot")}>
                *
              </span>
            )}
          </button>
          <button type="button" className="rectab__close" aria-label={t("proj.closeTab", { name: guide.title })} title={t("guide.close")} onClick={() => guide.close()}>
            <AppIcon name="close" size={11} />
          </button>
        </span>
      </div>
    </div>
  );
}

/** Ctrl+W closes the open guide (with the question about unsaved changes). */
function useCloseKey(guide: GuideApi) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "w" || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || !guide.doc) return;
      e.preventDefault();
      guide.close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [guide]);
}

/** F2 renames (while the header has no focus too). */
function useF2(guide: GuideApi) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F2" || !guide.doc) return;
      renameGuide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [guide.doc]);
}

/** The home page of Documents mode (no guide open): New guide, Open guide…, and the recent guides. */
function GuideHome({ guide, hotkey }: { guide: GuideApi; hotkey: string }) {
  const { t } = useT();
  return (
    <div className="guides">
      <div className="guides__head">
        <h2>{t("docs.title")}</h2>
        <Button onClick={guide.open}>{t("guide.open")}</Button>
        <Button variant="primary" title={t("docs.newTip", { hotkey })} onClick={() => guide.newGuide()}>
          {t("docs.new")}
        </Button>
      </div>
      {guide.recent.length === 0 ? (
        <div className="guides__empty">
          <AppIcon name="documents" size={44} />
          <p>{t("docs.empty")}</p>
        </div>
      ) : (
        <>
          <h3 className="guides__sub">{t("guide.recent")}</h3>
          <ul className="guides__list">
            {guide.recent.map((r) => (
              <li key={r.path} className={`gcard${r.exists ? "" : " gcard--missing"}`}>
                <button type="button" className="gcard__open" disabled={!r.exists} onClick={() => guide.openRecent(r.path)} title={r.path}>
                  <span className="gcard__thumb">{r.thumbnail && <img src={r.thumbnail} alt="" draggable={false} />}</span>
                  <span className="gcard__text">
                    <strong>{r.name}</strong>
                    <small>{r.exists ? `${t("docs.steps", { count: r.steps })} · ${new Date(r.openedAt).toLocaleDateString()}` : t("proj.missing")}</small>
                  </span>
                </button>
                {!r.exists && (
                  <button type="button" className="recempty__remove" onClick={() => guide.removeRecent(r.path)}>
                    {t("proj.removeFromList")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Documents mode: the home page, or the open guide (its row, tab and editor) with its bottom bar. */
export function DocumentsMode(props: { guide: GuideApi; settings: Settings; onPatch: (c: Partial<Settings>) => void; session: Session | null; captures: Capture[]; children?: ReactNode }) {
  const { guide, settings } = props;
  useF2(guide);
  useCloseKey(guide);
  const choices: ScreenshotChoice[] = useMemo(() => {
    const s = props.session;
    if (!s) return [];
    return props.captures.slice(0, 40).map((c) => ({
      id: c.id,
      name: c.name,
      thumb: imageUrl(s, c),
      load: async () => (await fetch(imageUrl(s, c))).blob(),
    }));
  }, [props.session, props.captures]);
  const [exporting, setExporting] = useState(false);
  const [redacting, setRedacting] = useState(false);
  // Where the editor puts the actions of the selected blocks: in the bottom bar.
  const [selectionSlot, setSelectionSlot] = useState<HTMLElement | null>(null);
  const exportSource = useCallback(() => (guide.doc ? { doc: guide.doc, steps: guide.steps } : null), [guide.doc, guide.steps]);
  const selected = useCallback(() => editorSelection.ids, []);
  const copyAs = useCopyAs(exportSource, selected);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "e" || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || !guide.doc) return;
      e.preventDefault();
      setExporting(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [guide.doc]);
  return (
    <>
      <main className="panels panels--single">
        {!guide.doc ? (
          <div className="panel panel--right">
            <GuideHome guide={guide} hotkey={settings.docStartHotkey} />
          </div>
        ) : (
          <div className="panel panel--right guide guide--doc">
            <RedactDialog open={redacting} onClose={() => setRedacting(false)} doc={guide.doc} steps={guide.steps} settings={settings} onPatch={props.onPatch} change={guide.change} />
            <ExportDialog open={exporting} onClose={() => setExporting(false)} source={exportSource} defaultFolder={settings.docGuidesDir} />
            <GuideEditor
              guide={guide}
              screenshots={choices}
              view={{ width: settings.docPageWidth, zoom: settings.docZoom, fit: settings.docFit }}
              settings={settings}
              onPatch={props.onPatch}
              onRedactGuide={() => setRedacting(true)}
              heading={<GuideHeading guide={guide} />}
              tabs={<GuideTabs guide={guide} />}
              selectionSlot={selectionSlot}
            />
          </div>
        )}
        {props.children}
      </main>
      {guide.doc && <GuideBottomBar selection={setSelectionSlot} onExport={() => setExporting(true)} onCopy={(k) => void copyAs(k)} />}
    </>
  );
}
