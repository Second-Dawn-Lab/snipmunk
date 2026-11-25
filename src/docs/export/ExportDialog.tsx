import { Button, Dialog, Select, Switch } from "@seconddawn/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import { ipc } from "../../ipc";
import { directionOf } from "../../language";
import { notify } from "../../notify";
import type { Block } from "../model";
import { templateOf } from "../template/apply";
import { BUILT_INS, normalizeTemplate, type Template } from "../template/model";
import { useTemplateName } from "../template/TemplatePanel";
import { clipboardHtml } from "./html";
import { exportMarkdown } from "./markdown";
import { buildData, exportDoc, extensionOf, readChoices, writeExport, type Choices, type Format, type Locale, type Source } from "./run";
import { paginate, previewHtml, printHtml } from "./paginate";

const REMEMBER = "snipmunk.export";
const FOLDER = "snipmunk.exportFolder";

const stored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* no storage */
  }
};

/** The words and the language of an export, from the language of the program. */
export function useExportLocale(): () => Locale {
  const { t, locale } = useT();
  // (`t` is new at every render; what depends on this function must run again only when the language changes)
  const words = useRef(t);
  words.current = t;
  return useCallback(
    () => ({
      lang: locale,
      rtl: directionOf(locale) === "rtl",
      contents: words.current("export.contents"),
      pagePattern: words.current("export.pageOf", { n: "{n}", of: "{of}" }),
      stepPattern: words.current("export.stepN", { n: "{n}" }),
      date: new Date().toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" }),
    }),
    [locale],
  );
}

type State = { step: "choose" } | { step: "busy"; done: number; of: number } | { step: "done"; path: string; bytes: number };

/** The export dialog: format, template, what goes in, the file; progress with Cancel; then Open and Show in File Explorer. */
export function ExportDialog(props: { open: boolean; onClose: () => void; source: () => Source | null; defaultFolder: string }) {
  const { t } = useT();
  const nameOf = useTemplateName();
  const localeOf = useExportLocale();
  const [choices, setChoices] = useState<Choices>(() => readChoices(stored(REMEMBER)));
  const [template, setTemplate] = useState("");
  const [own, setOwn] = useState<Template[]>([]);
  const [name, setName] = useState("");
  const [state, setState] = useState<State>({ step: "choose" });
  const abort = useRef<AbortController | null>(null);
  const source = props.open ? props.source() : null;

  useEffect(() => {
    if (!props.open) return;
    setState({ step: "choose" });
    setTemplate("");
    const s = props.source();
    setName(s ? s.doc.title : "");
    setChoices((c) => ({ ...c, cover: s ? templateOf(s.doc).cover.on : c.cover, toc: s ? templateOf(s.doc).contents : c.toc }));
    void ipc.templatesList().then((l) => setOwn(l.map(normalizeTemplate))).catch(() => undefined);
    // (once per opening: the guide is read at that moment)
  }, [props.open]);

  const set = (c: Partial<Choices>) => setChoices((x) => ({ ...x, ...c }));
  const f = choices.format;
  const paged = f === "pdf" || f === "docx";

  const run = async () => {
    const s = props.source();
    if (!s) return;
    try {
      const kind = extensionOf(choices);
      const path = await ipc.pickExportSave(stored(FOLDER) ?? props.defaultFolder, name.trim() || s.doc.title, kind);
      if (!path) return;
      store(REMEMBER, JSON.stringify(choices));
      store(FOLDER, path.replace(/[\\/][^\\/]*$/, ""));
      abort.current = new AbortController();
      setState({ step: "busy", done: 0, of: 1 });
      let chosen: Template | null = null;
      if (template) {
        chosen = BUILT_INS.find((x) => x.id === template) ?? normalizeTemplate(await ipc.templatesUse(template));
      }
      const doc = exportDoc(s, chosen, choices);
      const locale = localeOf();
      const data = await buildData(s, doc, choices, locale, (done, of) => setState({ step: "busy", done, of: of + 1 }), abort.current.signal);
      const bytes = await writeExport(path, data, choices, locale, abort.current.signal);
      setState({ step: "done", path, bytes });
      if (choices.openAfter) await ipc.openFile(path);
    } catch (e) {
      const cancelled = (e as { name?: string }).name === "AbortError" || (e as { code?: string }).code === "cancelled";
      if (!cancelled) notify(String((e as { message?: string })?.message ?? e), true);
      setState({ step: "choose" });
    }
  };
  const cancel = () => {
    abort.current?.abort();
    void ipc.exportCancel();
  };
  const check = (key: "cover" | "toc" | "numbers" | "descriptions" | "markers" | "annotations" | "openAfter" | "mdFrontMatter" | "mdZip", label: string) => (
    <label className="export__row">
      <span>{label}</span>
      <span className="export__control">
        <Switch label={label} checked={choices[key]} onChange={(v) => set({ [key]: v })} />
      </span>
    </label>
  );
  const select = (label: string, value: string, options: [string, string][], change: (v: string) => void) => (
    <label className="export__row">
      <span>{label}</span>
      <Select label={label} value={value} onChange={change} options={options.map(([v, l]) => ({ value: v, label: l }))} />
    </label>
  );

  return (
    <Dialog
      open={props.open && !!source}
      title={t("export.title")}
      onClose={() => (state.step === "busy" ? undefined : props.onClose())}
      footer={
        state.step === "busy" ? (
          <Button onClick={cancel}>{t("session.cancel")}</Button>
        ) : state.step === "done" ? (
          <>
            <Button onClick={() => void ipc.openFolder(state.path).catch((e) => notify(String(e?.message ?? e), true))}>{t("ctx.showInExplorer")}</Button>
            <Button onClick={() => void ipc.openFile(state.path).catch((e) => notify(String(e?.message ?? e), true))}>{t("export.openFile")}</Button>
            <Button variant="primary" onClick={props.onClose}>
              {t("guide.ok")}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={props.onClose}>
              {t("session.cancel")}
            </Button>
            <Button variant="primary" onClick={() => void run()}>
              {t("export.go")}
            </Button>
          </>
        )
      }
    >
      {state.step === "busy" ? (
        <div className="export__busy">
          <progress max={state.of} value={state.done} />
          <p>{t("export.working")}</p>
        </div>
      ) : state.step === "done" ? (
        <div className="export__done">
          <p>{t("export.done", { size: state.bytes < 1024 * 1024 ? `${Math.max(1, Math.round(state.bytes / 1024))} KB` : `${(state.bytes / 1048576).toFixed(1)} MB` })}</p>
          <p className="export__path" dir="ltr">
            {state.path}
          </p>
        </div>
      ) : (
        <div className="export">
          {select(
            t("export.format"),
            f,
            [
              ["pdf", "PDF"],
              ["docx", "Word (.docx)"],
              ["md", "Markdown"],
              ["html", "HTML"],
            ],
            (v) => set({ format: v as Format }),
          )}
          {select(
            t("template.title"),
            template,
            [["", `${t("export.guideTemplate")}`], ...BUILT_INS.map((x) => [x.id, nameOf(x)] as [string, string]), ...own.map((x) => [x.id, x.name] as [string, string])],
            setTemplate,
          )}
          <label className="export__row">
            <span>{t("export.fileName")}</span>
            <input type="text" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </label>
          {f !== "md" && check("cover", t("template.cover"))}
          {f !== "md" && check("toc", t("export.toc"))}
          {check("numbers", t("export.numbers"))}
          {check("descriptions", t("export.descriptions"))}
          {check("markers", t("export.markers"))}
          {check("annotations", t("export.annotations"))}
          {paged &&
            select(
              t("template.pageSize"),
              choices.pageSize ?? "",
              [
                ["", t("export.fromTemplate")],
                ["a4", "A4"],
                ["letter", "Letter"],
              ],
              (v) => set({ pageSize: (v || null) as Choices["pageSize"] }),
            )}
          {paged &&
            select(
              t("template.orientation"),
              choices.orientation ?? "",
              [
                ["", t("export.fromTemplate")],
                ["portrait", t("template.portrait")],
                ["landscape", t("template.landscape")],
              ],
              (v) => set({ orientation: (v || null) as Choices["orientation"] }),
            )}
          {paged &&
            select(
              t("export.quality"),
              choices.jpeg === null ? "png" : String(choices.jpeg),
              [
                ["png", t("export.png")],
                ["0.92", t("export.jpegHigh")],
                ["0.8", t("export.jpegSmall")],
              ],
              (v) => set({ jpeg: v === "png" ? null : Number(v) }),
            )}
          {f === "md" &&
            select(
              t("export.mdSteps"),
              choices.mdSteps,
              [
                ["list", t("export.mdList")],
                ["headings", t("export.mdHeadings")],
              ],
              (v) => set({ mdSteps: v as Choices["mdSteps"] }),
            )}
          {f === "md" && check("mdFrontMatter", t("export.mdFront"))}
          {f === "md" && check("mdZip", t("export.mdZip"))}
          {check("openAfter", t("export.openAfter"))}
        </div>
      )}
    </Dialog>
  );
}

/** Only the selected blocks when some are selected, else the whole guide. */
const part = (source: Source, selected: ReadonlySet<string>): Source =>
  selected.size === 0 ? source : { ...source, doc: { ...source.doc, blocks: source.doc.blocks.filter((b: Block) => selected.has(b.id)) } };

export type CopyKind = "rich" | "markdown" | "markdownPictures" | "text";

/** "Copy as…": formatted text with pictures, Markdown (with or without the pictures), or plain text; the selection or everything. */
export function useCopyAs(source: () => Source | null, selected: () => ReadonlySet<string>) {
  const { t } = useT();
  const localeOf = useExportLocale();
  return useCallback(
    async (kind: CopyKind) => {
      const all = source();
      if (!all) return;
      try {
        const s = part(all, selected());
        const locale = localeOf();
        const choices = readChoices(stored(REMEMBER));
        const withPictures = kind === "rich" || kind === "markdownPictures";
        const doc = withPictures ? s.doc : { ...s.doc, blocks: s.doc.blocks };
        const data = withPictures
          ? await buildData(s, doc, { ...choices, format: "html" }, locale)
          : await buildData({ doc: { ...s.doc, blocks: [] }, steps: s.steps }, { ...s.doc, blocks: [] }, { ...choices, format: "html" }, locale).then((d) => ({ ...d, doc }));
        if (kind === "rich") {
          const c = clipboardHtml(data);
          await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([c.html], { type: "text/html" }), "text/plain": new Blob([c.text], { type: "text/plain" }) })]);
        } else if (kind === "text") {
          await navigator.clipboard.writeText(clipboardHtml(data).text);
        } else {
          const md = exportMarkdown(data, {
            steps: choices.mdSteps,
            frontMatter: false,
            stepWord: (n) => locale.stepPattern.replace("{n}", String(n)),
            image: (key) => data.pictures.get(key)?.src ?? null,
          });
          await navigator.clipboard.writeText(md);
        }
        notify(t("export.copied"));
      } catch (e) {
        notify(String((e as { message?: string })?.message ?? e), true);
      }
    },
    [source, selected, localeOf, t],
  );
}

/** The pages of the guide as the preview shows them and the printer gets them: everything of the guide, as the editor has it. */
async function viewPages(source: Source, locale: Locale, signal?: AbortSignal) {
  const t = templateOf(source.doc);
  const choices: Choices = { ...readChoices(stored(REMEMBER)), format: "pdf", cover: t.cover.on, toc: t.contents, numbers: true, descriptions: true, markers: true, annotations: true, jpeg: 0.92 };
  const data = await buildData(source, source.doc, choices, locale, undefined, signal);
  return { data, pages: await paginate(data) };
}

/** The frame that holds the document being printed (one at a time). */
let printing: HTMLIFrameElement | null = null;

/**
 * Print the guide through the system's print dialog: the same pages as the PDF, with the page size and orientation of the
 * template, in a frame of its own that runs no script.
 */
export function usePrint(source: () => Source | null): { print: () => void; busy: boolean } {
  const localeOf = useExportLocale();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const print = useCallback(() => {
    const s = source();
    if (!s || running.current) return;
    running.current = true;
    setBusy(true);
    void viewPages(s, localeOf())
      .then(async ({ data, pages }) => {
        printing?.remove();
        const frame = document.createElement("iframe");
        printing = frame;
        frame.className = "printframe";
        frame.setAttribute("aria-hidden", "true");
        frame.setAttribute("sandbox", "allow-same-origin allow-modals");
        await new Promise<void>((resolve) => {
          frame.onload = () => resolve();
          frame.srcdoc = printHtml(data, pages);
          document.body.appendChild(frame);
        });
        const view = frame.contentWindow!;
        await Promise.all(Array.from(view.document.images).map((i) => i.decode().catch(() => undefined)));
        await view.document.fonts.ready;
        view.focus();
        view.print();
      })
      .catch((e) => notify(String((e as { message?: string })?.message ?? e), true))
      .finally(() => {
        running.current = false;
        setBusy(false);
      });
  }, [source, localeOf]);
  return { print, busy };
}

/** The print preview: the pages exactly as the PDF and the printer have them (rebuilt a moment after a change). */
export function PageView(props: { source: Source; scale: number; fit: boolean }) {
  const { t } = useT();
  const localeOf = useExportLocale();
  const [html, setHtml] = useState<string | null>(null);
  const { doc, steps } = props.source;
  const frame = useRef<HTMLIFrameElement>(null);
  // The sheets are shown at the zoom of the editor's pages (and never wider than the view while a page is fitted to it).
  const fit = useCallback(() => {
    const f = frame.current;
    const body = f?.contentDocument?.body;
    const page = body?.querySelector<HTMLElement>(".page");
    if (!f || !body || !page) return;
    body.style.zoom = "1";
    const room = (f.clientWidth - 24) / (page.offsetWidth + 32);
    body.style.zoom = String(props.fit ? Math.min(props.scale, room) : props.scale);
  }, [props.scale, props.fit]);
  useEffect(() => {
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit]);
  useEffect(() => {
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      void viewPages({ doc, steps }, localeOf(), abort.signal)
        .then(({ data, pages }) => {
          if (!abort.signal.aborted) setHtml(previewHtml(data, pages));
        })
        .catch((e) => {
          if (!abort.signal.aborted) notify(String(e?.message ?? e), true);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [doc, steps, localeOf]);
  return html === null ? (
    <div className="pageview pageview--busy">{t("export.working")}</div>
  ) : (
    <iframe ref={frame} className="pageview" title={t("template.printPreview")} sandbox="allow-same-origin" srcDoc={html} onLoad={fit} />
  );
}
