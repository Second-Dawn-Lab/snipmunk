import { Button } from "@seconddawn/ui";
import { useEffect, useMemo, useState } from "react";
import { AppIcon } from "../components/AppIcons";
import { MenuItem } from "../components/MenuItem";
import { Pop } from "../components/Pop";
import { useT } from "../i18n";
import { imageUrl, ipc, type Capture, type Session } from "../ipc";
import type { Settings } from "../settings/defaults";
import { GuideEditor, type ScreenshotChoice } from "./GuideEditor";
import type { GuideApi } from "./useGuide";

/** The header of the open guide, like the recording project's: File ▾ and the main button on the left; name, status and steps on the right. */
function GuideHeader({ guide, onError }: { guide: GuideApi; onError: (m: string) => void }) {
  const { t } = useT();
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const close = () => setMenu(false);
  const steps = guide.doc ? guide.doc.blocks.filter((b) => b.type === "step").length : 0;
  const start = () => (setDraft(guide.title), setRenaming(true));
  const commit = () => {
    setRenaming(false);
    guide.rename(draft);
  };
  return (
    <div className="recheader" role="group" aria-label={t("guide.header")}>
      <Pop
        open={menu}
        onClose={close}
        kind="menu"
        label={t("proj.file")}
        align="start"
        trigger={
          <button type="button" className="recheader__file" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((o) => !o)}>
            {t("proj.file")}
            <AppIcon name="chevron" size={13} />
          </button>
        }
      >
        <MenuItem label={t("docs.new")} onSelect={() => (close(), guide.newGuide())} />
        <MenuItem label={t("guide.open")} hint="Ctrl+O" onSelect={() => (close(), guide.open())} />
        <MenuItem label={t("guide.saveAs")} hint="Ctrl+Shift+S" disabled={guide.busy} onSelect={() => (close(), void guide.saveAs())} />
        <MenuItem label={t("guide.recordMore")} onSelect={() => (close(), guide.recordMore())} />
        {guide.savedPath && <MenuItem label={t("ctx.showInExplorer")} onSelect={() => (close(), void ipc.openFolder(guide.savedPath!).catch((e) => onError(String(e?.message ?? e))))} />}
        <MenuItem label={t("guide.close")} onSelect={() => (close(), guide.close())} />
        {guide.recent.length > 0 && (
          <>
            <div className="menuitem__heading">{t("guide.recent")}</div>
            {guide.recent.slice(0, 6).map((r) => (
              <MenuItem key={r.path} label={r.name} disabled={!r.exists} onSelect={() => (close(), guide.openRecent(r.path))} />
            ))}
          </>
        )}
      </Pop>
      {!guide.savedPath ? (
        <Button variant="primary" disabled={guide.busy} onClick={() => void guide.saveAs()}>
          {t("guide.saveAs")}
        </Button>
      ) : guide.dirty ? (
        <Button variant="primary" disabled={guide.busy} onClick={() => void guide.save()} title="Ctrl+S">
          {t("guide.save")}
        </Button>
      ) : (
        <Button disabled>{t("proj.statusSaved")}</Button>
      )}
      <span className="recheader__spacer" />
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
      document.querySelector<HTMLButtonElement>(".recheader__name")?.click();
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
        <Button variant="primary" title={t("docs.newTip", { hotkey })} onClick={guide.newGuide}>
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

/** Documents mode: the home page, or the open guide with its header and the editor. */
export function DocumentsMode(props: { guide: GuideApi; settings: Settings; session: Session | null; captures: Capture[]; onError: (m: string) => void }) {
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
  if (!guide.doc) return <GuideHome guide={guide} hotkey={settings.docStartHotkey} />;
  return (
    <div className="guide guide--doc">
      <GuideHeader guide={guide} onError={props.onError} />
      <GuideTabs guide={guide} />
      <GuideEditor guide={guide} screenshots={choices} />
    </div>
  );
}
