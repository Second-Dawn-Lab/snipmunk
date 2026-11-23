import { Extension } from "@tiptap/core";
import Highlight from "@tiptap/extension-highlight";
import { GuideImage, GuideTable } from "./ImageNode";
import { TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { Content, Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n";
import { ipc } from "../ipc";
import { notify } from "../notify";
import type { PmDoc } from "./model";
import { guideImageUrl } from "./urls";

/** The editors that are on the page: Ctrl+Z asks the one that has the focus first, then the document history. */
export const editors = new Map<HTMLElement, Editor>();

const FONTS = ["Segoe UI", "Calibri", "Arial", "Georgia", "Cambria", "Times New Roman", "Consolas", "Verdana"];
const SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 40];
const PALETTE = ["#000000", "#444444", "#888888", "#d62828", "#f77f00", "#fcbf49", "#2a9d8f", "#2563eb", "#7c3aed", "#ffffff"];
const HIGHLIGHTS = ["#fff59d", "#ffd6a5", "#c7f9cc", "#bde0fe", "#ffc8dd", "#e0e0e0"];

/** The fonts of the list that this computer has (measured: a font that is not there falls back and measures the same). */
let installed: string[] | null = null;
function installedFonts(): string[] {
  if (installed) return installed;
  const c = document.createElement("canvas").getContext("2d");
  if (!c) return (installed = FONTS);
  const text = "mmmmmmmmmmlliWW@#";
  const width = (f: string) => {
    c.font = `72px ${f}`;
    return c.measureText(text).width;
  };
  const base = [width("monospace"), width("serif"), width("sans-serif")];
  installed = FONTS.filter((f) => {
    const w = [width(`"${f}", monospace`), width(`"${f}", serif`), width(`"${f}", sans-serif`)];
    return w.some((x, i) => Math.abs(x - base[i]) > 0.5);
  });
  return installed.length ? installed : ["Segoe UI"];
}

/** Clean pasted HTML: no scripts, no styles of other pages, no remote images (a placeholder instead), no event handlers. */
export function sanitizeHtml(html: string, placeholder: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,iframe,object,embed,link,meta,form,input,button,select,textarea,svg,canvas,video,audio").forEach((n) => n.remove());
  doc.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") ?? "";
    // Images that came with the clipboard as data are kept as they are (the paste handler stores them); remote ones are not fetched.
    if (!src.startsWith("data:image/")) img.replaceWith(doc.createTextNode(`[${placeholder}]`));
  });
  doc.querySelectorAll("*").forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      const n = a.name.toLowerCase();
      if (n.startsWith("on") || n === "style" && /expression|url\(|javascript:/i.test(a.value)) el.removeAttribute(a.name);
      if ((n === "href" || n === "src") && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    }
  });
  return doc.body.innerHTML;
}

/** Only bold, line breaks and plain text (a step's description). */
export function simpleHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: string[] = [];
  const walk = (n: Node, bold: boolean) => {
    if (n.nodeType === 3) {
      const t = (n.textContent ?? "").replace(/\s+/g, " ");
      if (t.trim()) out.push(bold ? `<strong>${esc(t)}</strong>` : esc(t));
      else if (t && out.length && out[out.length - 1] !== "<br>") out.push(" "); // a space between two inline elements stays
    } else if (n instanceof HTMLElement) {
      const tag = n.tagName.toLowerCase();
      if (["script", "style"].includes(tag)) return;
      const b = bold || tag === "b" || tag === "strong" || /^(bold|[6-9]00)$/.test(n.style.fontWeight);
      n.childNodes.forEach((c) => walk(c, b));
      if (["p", "div", "br", "li", "tr", "h1", "h2", "h3"].includes(tag)) out.push("<br>");
    }
  };
  doc.body.childNodes.forEach((c) => walk(c, false));
  return out.join("").replace(/(<br>)+$/, "");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** TSV text (cells with tabs, rows with line breaks) as an HTML table; `null` when it is not one. */
export function tsvToHtml(text: string): string | null {
  const rows = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  if (rows.length < 1 || !rows.every((r) => r.includes("\t")) ) return null;
  const cells = rows.map((r) => r.split("\t"));
  const w = Math.max(...cells.map((c) => c.length));
  return `<table><tbody>${cells.map((r) => `<tr>${Array.from({ length: w }, (_, i) => `<td><p>${esc(r[i] ?? "")}</p></td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

const URL_RE = /^(https?:\/\/|www\.)\S+$/i;
export const isUrl = (s: string) => URL_RE.test(s.trim());

function fileToBase64(f: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}

/** Store an image (file, clipboard) in the guide; returns its file name. */
export async function storeImage(f: Blob): Promise<{ name: string; width: number; height: number }> {
  return ipc.docAddImage(await fileToBase64(f));
}

/** ctrl+Enter style helpers are not needed; Enter ends the edit of a single-line step text. */
const SingleLine = Extension.create({
  name: "singleLine",
  addKeyboardShortcuts() {
    return { Enter: () => (this.editor.view.dom.blur(), true) };
  },
});

export interface RichProps {
  value: PmDoc | null;
  onChange: (doc: PmDoc) => void;
  /** "full": the whole toolbar, tables, images; "step": bold and plain text only. */
  mode: "full" | "step";
  placeholder?: string;
  /** One line: Enter ends the edit. */
  singleLine?: boolean;
  /** Images dropped or pasted into a "step" editor are not accepted; in "full" they are stored and inserted. */
  onFocusChange?: (focused: boolean) => void;
  ariaLabel?: string;
}

/** The rich text of a content block or the description of a step: TipTap (ProseMirror) with a simple Word-like toolbar. */
export function RichText(props: RichProps) {
  const { t } = useT();
  const { mode } = props;
  const [focused, setFocused] = useState(false);
  const timer = useRef(0);
  const latest = useRef(props.onChange);
  latest.current = props.onChange;
  const remote = t("rich.remoteImage");

  const extensions = useMemo(() => {
    if (mode === "step") {
      return [
        StarterKit.configure({ heading: false, bulletList: false, orderedList: false, listItem: false, blockquote: false, codeBlock: false, code: false, horizontalRule: false, italic: false, strike: false, underline: false, link: false }),
        Placeholder.configure({ placeholder: props.placeholder ?? "" }),
        ...(props.singleLine ? [SingleLine] : []),
      ];
    }
    return [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true, linkOnPaste: true } }),
      TextStyleKit.configure({ backgroundColor: false }),
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["start", "center", "end"], defaultAlignment: "start" }),
      TableKit.configure({ table: false }),
      GuideTable.configure({ resizable: true }),
      GuideImage.configure({ allowBase64: false, inline: false }),
      Placeholder.configure({ placeholder: props.placeholder ?? "" }),
    ];
  }, [mode, props.singleLine]);

  const editor = useEditor({
    extensions,
    content: (props.value ?? undefined) as Content | undefined,
    editorProps: {
      attributes: { class: "rich__editor", "aria-label": props.ariaLabel ?? "" },
      transformPastedHTML: (html) => (mode === "step" ? simpleHtml(html) : sanitizeHtml(html, remote)),
      handlePaste: (view, event) => {
        const cd = event.clipboardData;
        if (!cd) return false;
        const html = cd.getData("text/html");
        const text = cd.getData("text/plain");
        // A table (Excel, Word, a web page) is pasted as an editable table, whatever else came with it.
        if (mode === "full" && /<table[\s>]/i.test(html)) return false;
        const images = Array.from(cd.files).filter((f) => f.type.startsWith("image/"));
        if (mode === "full" && images.length > 0) {
          event.preventDefault();
          void (async () => {
            for (const f of images) {
              try {
                const img = await storeImage(f);
                editorRef.current?.chain().focus().setImage({ src: guideImageUrl(img.name), alt: "", ...({ file: img.name, nw: img.width, nh: img.height } as object) }).run();
              } catch (e) {
                notify(String((e as { message?: string })?.message ?? e), true);
              }
            }
          })();
          return true;
        }
        if (mode === "full" && !html) {
          const table = tsvToHtml(text);
          if (table) {
            event.preventDefault();
            editorRef.current?.chain().focus().insertContent(table).run();
            return true;
          }
          if (isUrl(text) && view.state.selection.empty) {
            event.preventDefault();
            const href = /^www\./i.test(text.trim()) ? `https://${text.trim()}` : text.trim();
            editorRef.current?.chain().focus().insertContent({ type: "text", text: text.trim(), marks: [{ type: "link", attrs: { href } }] }).run();
            return true;
          }
        }
        return false;
      },
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (mode !== "full" || files.length === 0) return false;
        event.preventDefault();
        void (async () => {
          for (const f of files) {
            const img = await storeImage(f).catch(() => null);
            if (img) editorRef.current?.chain().focus().setImage({ src: guideImageUrl(img.name), alt: "", ...({ file: img.name, nw: img.width, nh: img.height } as object) }).run();
          }
        })();
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => latest.current(ed.getJSON() as PmDoc), 400);
    },
    onFocus: () => (setFocused(true), props.onFocusChange?.(true)),
    onBlur: ({ editor: ed }) => {
      window.clearTimeout(timer.current);
      latest.current(ed.getJSON() as PmDoc);
      // The toolbar stays while a toolbar control is used (it takes the focus for a moment).
      window.setTimeout(() => {
        if (!rootRef.current?.contains(document.activeElement)) {
          setFocused(false);
          props.onFocusChange?.(false);
        }
      }, 120);
    },
  });
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;
  const rootRef = useRef<HTMLDivElement>(null);

  // The editor of another value (undo of the document, another block) is set from outside.
  const lastValue = useRef(props.value);
  useEffect(() => {
    if (!editor || props.value === lastValue.current) return;
    lastValue.current = props.value;
    const cur = JSON.stringify(editor.getJSON());
    if (props.value && JSON.stringify(props.value) !== cur) editor.commands.setContent(props.value as Content, { emitUpdate: false });
  }, [editor, props.value]);

  useEffect(() => {
    if (!editor) return;
    const el = editor.view.dom as HTMLElement;
    editors.set(el, editor);
    return () => {
      editors.delete(el);
    };
  }, [editor]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <div className={`rich${mode === "full" ? " rich--box" : ""}${focused ? " rich--focus" : ""}`} ref={rootRef}>
      {editor && mode === "full" && focused && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const { t } = useT();
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      link: e.isActive("link"),
      h: e.isActive("heading", { level: 1 }) ? 1 : e.isActive("heading", { level: 2 }) ? 2 : e.isActive("heading", { level: 3 }) ? 3 : 0,
      font: (e.getAttributes("textStyle").fontFamily as string | undefined) ?? "",
      size: (e.getAttributes("textStyle").fontSize as string | undefined) ?? "",
      color: (e.getAttributes("textStyle").color as string | undefined) ?? "",
      align: (e.getAttributes("paragraph").textAlign ?? e.getAttributes("heading").textAlign ?? "start") as string,
      table: e.isActive("table"),
      tableHeader: e.isActive("tableHeader"),
      tableAlign: ((e.getAttributes("table").align as string | undefined) ?? "start"),
    }),
  });
  const fonts = useMemo(installedFonts, []);
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const chain = () => editor.chain().focus();
  const btn = (label: string, title: string, active: boolean, run: () => void, extra = "") => (
    <button type="button" className={`rich__btn${active ? " rich__btn--on" : ""} ${extra}`} aria-pressed={active} title={title} aria-label={title} onMouseDown={keep} onClick={run}>
      {label}
    </button>
  );
  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt(t("rich.linkPrompt"), prev ?? "https://");
    if (url === null) return;
    if (url.trim() === "") chain().extendMarkRange("link").unsetLink().run();
    else chain().extendMarkRange("link").setLink({ href: /^[a-z]+:/i.test(url) ? url : `https://${url}` }).run();
  };
  return (
    <div className="rich__bar" role="toolbar" aria-label={t("rich.toolbar")} onMouseDown={(e) => (e.target as HTMLElement).tagName !== "SELECT" && (e.target as HTMLElement).tagName !== "INPUT" && e.preventDefault()}>
      <select className="rich__sel" aria-label={t("rich.font")} value={s.font.replace(/["']/g, "").split(",")[0]} onChange={(e) => (e.target.value ? chain().setFontFamily(e.target.value).run() : chain().unsetFontFamily().run())}>
        <option value="">{t("rich.fontDefault")}</option>
        {fonts.map((f) => (
          <option key={f} value={f} style={{ fontFamily: f }}>
            {f}
          </option>
        ))}
      </select>
      <select className="rich__sel rich__sel--narrow" aria-label={t("rich.size")} value={s.size.replace("px", "")} onChange={(e) => (e.target.value ? chain().setFontSize(`${e.target.value}px`).run() : chain().unsetFontSize().run())}>
        <option value="">—</option>
        {SIZES.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <select className="rich__sel" aria-label={t("rich.heading")} value={s.h} onChange={(e) => (Number(e.target.value) ? chain().setHeading({ level: Number(e.target.value) as 1 | 2 | 3 }).run() : chain().setParagraph().run())}>
        <option value={0}>{t("rich.normal")}</option>
        <option value={1}>{t("rich.h1")}</option>
        <option value={2}>{t("rich.h2")}</option>
        <option value={3}>{t("rich.h3")}</option>
      </select>
      <span className="rich__sep" />
      {btn("B", t("rich.bold"), s.bold, () => chain().toggleBold().run(), "rich__btn--b")}
      {btn("I", t("rich.italic"), s.italic, () => chain().toggleItalic().run(), "rich__btn--i")}
      {btn("U", t("rich.underline"), s.underline, () => chain().toggleUnderline().run(), "rich__btn--u")}
      {btn("S", t("rich.strike"), s.strike, () => chain().toggleStrike().run(), "rich__btn--s")}
      <span className="rich__sep" />
      <ColorMenu label={t("rich.color")} glyph="A" current={s.color} palette={PALETTE} onPick={(c) => (c ? chain().setColor(c).run() : chain().unsetColor().run())} resetLabel={t("rich.noColor")} />
      <ColorMenu label={t("rich.highlight")} glyph="▇" current="" palette={HIGHLIGHTS} onPick={(c) => (c ? chain().setHighlight({ color: c }).run() : chain().unsetHighlight().run())} resetLabel={t("rich.noHighlight")} />
      <span className="rich__sep" />
      {btn("•", t("rich.bullets"), s.bullet, () => chain().toggleBulletList().run())}
      {btn("1.", t("rich.numbers"), s.ordered, () => chain().toggleOrderedList().run())}
      {btn("⇤", t("rich.alignStart"), s.align === "start", () => chain().setTextAlign("start").run(), "rich__btn--dir")}
      {btn("↔", t("rich.alignCenter"), s.align === "center", () => chain().setTextAlign("center").run())}
      {btn("⇥", t("rich.alignEnd"), s.align === "end", () => chain().setTextAlign("end").run(), "rich__btn--dir")}
      <span className="rich__sep" />
      {btn("🔗", t("rich.link"), s.link, setLink)}
      {btn("▦", t("rich.table"), s.table, () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
      {btn("✕", t("rich.clear"), false, () => chain().unsetAllMarks().clearNodes().run())}
      {s.table && (
        <div className="rich__row" role="toolbar" aria-label={t("rich.table")}>
          {btn("↥", t("rich.tableRowAbove"), false, () => chain().addRowBefore().run())}
          {btn("↧", t("rich.tableRowBelow"), false, () => chain().addRowAfter().run())}
          {btn("↤", t("rich.tableColLeft"), false, () => chain().addColumnBefore().run(), "rich__btn--dir")}
          {btn("↦", t("rich.tableColRight"), false, () => chain().addColumnAfter().run(), "rich__btn--dir")}
          <span className="rich__sep" />
          {btn("−▭", t("rich.tableDelRow"), false, () => chain().deleteRow().run())}
          {btn("−▯", t("rich.tableDelCol"), false, () => chain().deleteColumn().run())}
          {btn("🗑", t("rich.tableDel"), false, () => chain().deleteTable().run())}
          <span className="rich__sep" />
          {btn("H", t("rich.tableHeader"), s.tableHeader, () => chain().toggleHeaderRow().run())}
          {btn("⧉", t("rich.tableMerge"), false, () => chain().mergeOrSplit().run())}
          <span className="rich__sep" />
          {btn("⇤", t("rich.alignStart"), s.tableAlign === "start", () => chain().updateAttributes("table", { align: "start" }).run(), "rich__btn--dir")}
          {btn("↔", t("rich.alignCenter"), s.tableAlign === "center", () => chain().updateAttributes("table", { align: "center" }).run())}
          {btn("⇥", t("rich.alignEnd"), s.tableAlign === "end", () => chain().updateAttributes("table", { align: "end" }).run(), "rich__btn--dir")}
        </div>
      )}
    </div>
  );
}

function ColorMenu(props: { label: string; glyph: string; current: string; palette: string[]; resetLabel: string; onPick: (c: string | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="rich__colors">
      <button type="button" className="rich__btn" title={props.label} aria-label={props.label} aria-haspopup="menu" aria-expanded={open} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((o) => !o)}>
        <span style={{ color: props.current || undefined, borderBottom: `3px solid ${props.current || "currentColor"}` }}>{props.glyph}</span>
      </button>
      {open && (
        <span className="rich__pop" role="menu" onMouseLeave={() => setOpen(false)}>
          {props.palette.map((c) => (
            <button key={c} type="button" className="rich__swatch" style={{ background: c }} aria-label={c} onMouseDown={(e) => e.preventDefault()} onClick={() => (props.onPick(c), setOpen(false))} />
          ))}
          <input type="color" className="rich__custom" aria-label={props.label} onChange={(e) => props.onPick(e.target.value)} />
          <button type="button" className="rich__reset" onMouseDown={(e) => e.preventDefault()} onClick={() => (props.onPick(null), setOpen(false))}>
            {props.resetLabel}
          </button>
        </span>
      )}
    </span>
  );
}
