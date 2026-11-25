// The first pages of a guide as the editor shows them: the cover in the design of the template (its texts written where they
// stand; everything else about it is set in the sidebar) and the table of contents (a list that follows the guide).

import { memo, useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from "react";
import { useT } from "../i18n";
import type { GuideStep } from "../ipc";
import { coverClass, coverLogoClass, coverTextClass, tocHtml, type ExportData } from "./export/html";
import { split } from "./export/paginate";
import { artPicture, backgroundPicture } from "./export/pictures";
import type { GuideDoc, PmDoc } from "./model";
import { RichText } from "./RichText";
import { changeTemplate, templateOf } from "./template/apply";
import { hasArt, onCover, onPages } from "./template/background";
import type { CoverField, Template } from "./template/model";
import { guideImageUrl } from "./urls";

type Change = (fn: (d: GuideDoc) => GuideDoc, key?: string) => void;

/** The words of a rich text, one line. */
export function richWords(doc: PmDoc): string {
  const walk = (n: { text?: string; content?: unknown[]; type?: string }): string =>
    (n.text ?? "") + (n.type === "hardBreak" ? " " : "") + ((n.content ?? []) as Parameters<typeof walk>[0][]).map(walk).join("");
  return ((doc.content ?? []) as Parameters<typeof walk>[0][]).map(walk).join(" ").trim();
}

/** A rich text as it is compared: attributes that were never set say nothing. */
const same = (doc: PmDoc): string => JSON.stringify(doc, (key, v) => (key === "attrs" && v && Object.values(v).every((x) => x === null) ? undefined : v));

/** Plain words as a rich text of one paragraph. */
const plainDoc = (text: string): PmDoc => ({ type: "doc", content: [{ type: "paragraph", ...(text ? { content: [{ type: "text", text }] } : {}) }] });

/** What a change of a text on the cover stores: the plain words (header, Word's title ...) and how they were formatted. */
export function setCoverText(t: Template, field: CoverField, doc: PmDoc): void {
  const words = richWords(doc);
  t.cover[field] = words;
  const formatted = same(doc) !== same(plainDoc(words));
  if (formatted) t.cover.rich = { ...t.cover.rich, [field]: doc };
  else delete t.cover.rich[field];
}

/** Take the alignment of their own away from texts of the cover, so they stand as the design (or the date's place) says. */
export function clearCoverAlign(t: Template, fields: readonly CoverField[]): void {
  for (const field of fields) {
    const rich = t.cover.rich[field];
    if (!rich) continue;
    const content = (rich.content as { attrs?: Record<string, unknown> }[] | undefined)?.map((n) => (n.attrs && "textAlign" in n.attrs ? { ...n, attrs: { ...n.attrs, textAlign: null } } : n));
    t.cover.rich = { ...t.cover.rich, [field]: { ...rich, content } as PmDoc };
  }
}

function CoverText(props: { field: CoverField; template: Template; placeholder: string; label: string; change: Change }) {
  const { template: tpl, field } = props;
  const rich = tpl.cover.rich[field];
  const words = tpl.cover[field];
  // (the same object until the text changes: the editor takes a new one as a change from outside)
  const value = useMemo(() => rich ?? plainDoc(words), [rich, words]);
  // An empty subtitle or author takes no room until the cover is being written on, as it takes none in print.
  const empty = (field === "subtitle" || field === "author") && !words;
  return (
    <div className={`${coverTextClass(tpl.cover, field)} gcover__text gcover__text--${field}${empty ? " gcover__text--empty" : ""}`}>
      <RichText mode="cover" value={value} placeholder={props.placeholder} ariaLabel={props.label} onChange={(d) => props.change((x) => (same(d) === same(value) ? x : changeTemplate(x, (t) => setCoverText(t, field, d))), `cover:${field}`)} />
    </div>
  );
}

export interface CoverPictures {
  /** The picture behind the cover and the pages, with opacity and grey in it. */
  background: string | null;
  /** The picture that is part of the cover (designs "image" and "split"). */
  art: string | null;
}

/** The pictures of the template as the editor shows them (the same as in the exports). */
export function useCoverPictures(tpl: Template): CoverPictures {
  const [background, setBackground] = useState<string | null>(null);
  const [art, setArt] = useState<string | null>(null);
  const image = tpl.cover.image;
  const { opacity, grey } = tpl.background;
  const behind = onPages(tpl.background) || (onCover(tpl.background) && !hasArt(tpl.cover.design));
  const part = hasArt(tpl.cover.design);
  const overlay = tpl.cover.design === "image" ? tpl.cover.overlay : null;
  useEffect(() => {
    let gone = false;
    setBackground(null);
    if (image && behind) void backgroundPicture(image, { opacity, grey }).then((p) => !gone && setBackground(p.src)).catch(() => undefined);
    return () => {
      gone = true;
    };
  }, [image, behind, opacity, grey]);
  useEffect(() => {
    let gone = false;
    setArt(null);
    if (image && part) void artPicture(image, { opacity, grey }, overlay).then((p) => !gone && setArt(p.src)).catch(() => undefined);
    return () => {
      gone = true;
    };
  }, [image, part, overlay, opacity, grey]);
  return { background, art };
}

/**
 * The cover page as the first block of the editor: title, subtitle, author and date (edited where they stand, with font, size,
 * colour and alignment), the logo and the pictures, laid out by the same rules as in print. With a page size it fills page 1.
 */
export const CoverBlock = memo(function CoverBlock(props: { doc: GuideDoc; change: Change; pictures: CoverPictures; style?: CSSProperties }) {
  const { t, locale } = useT();
  const tpl = templateOf(props.doc);
  const c = tpl.cover;
  const today = new Date().toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
  const text = (field: CoverField, placeholder: string, label: string) => <CoverText field={field} template={tpl} placeholder={placeholder} label={t("template.coverText", { field: label })} change={props.change} />;
  const logo = c.logo && tpl.logo ? <img className={`gcover__logo ${coverLogoClass(c)}`} style={{ height: c.logoSize }} src={guideImageUrl(tpl.logo)} alt={t("template.logo")} /> : null;
  // (a click on the cover itself takes the keyboard there: the empty fields come into view)
  const focus = (e: MouseEvent<HTMLElement>) => {
    if (!(e.target as HTMLElement).closest(".ProseMirror,button,input,select")) e.currentTarget.focus({ preventScroll: true });
  };
  return (
    <header className={`gcover ${coverClass(c)}`} data-block="cover" tabIndex={-1} style={props.style} aria-label={t("template.cover")} onClick={focus}>
      {hasArt(c.design) ? (
        (props.pictures.art || c.design === "split") && <div className={`cover__art${props.pictures.art ? " artimg" : ""}`} />
      ) : (
        props.pictures.background && onCover(tpl.background) && <div className="cover__bg bgimg" />
      )}
      {c.logoPlace !== "title" && logo}
      <div className="cover__group">
        {c.logoPlace === "title" && logo}
        {text("title", props.doc.title, t("template.item.title"))}
        {text("subtitle", t("template.subtitle"), t("template.subtitle"))}
        {text("author", t("template.author"), t("template.author"))}
        {c.date && text("dateText", today, t("template.date"))}
      </div>
    </header>
  );
});

/**
 * The table of contents as its own block after the cover: read-only, always the guide as it is now, drawn as in print, with the
 * page numbers when the pages are known. A click on an entry goes to it.
 */
export const ContentsBlock = memo(function ContentsBlock(props: { doc: GuideDoc; steps: ReadonlyMap<number, GuideStep>; where: ReadonlyMap<string, number> | undefined; onReveal: (block: string) => void }) {
  const { t } = useT();
  const tpl = templateOf(props.doc);
  const data = { doc: props.doc, steps: props.steps, template: tpl, options: { cover: false, toc: true, numbers: true, descriptions: true }, words: { contents: t("export.contents") } } as unknown as ExportData;
  const html = tocHtml(data, props.where);
  // (taken apart and drawn again only when the list itself changed, not for every change of the guide)
  const parts = useMemo(() => (html ? split({ id: "toc", kind: "toc", html }) : []), [html]);
  const open = (e: MouseEvent) => {
    const link = (e.target as HTMLElement).closest("a");
    if (!link) return;
    e.preventDefault();
    const id = (link.getAttribute("href") ?? "").replace(/^#b-/, "");
    const block = props.doc.blocks.find((b) => id === b.id || id.startsWith(`${b.id}-`));
    if (block) props.onReveal(block.id);
  };
  return (
    <section className="gcontents" data-block="contents" tabIndex={-1} aria-label={t("export.contents")} onClick={open}>
      {parts.map((p) => (
        <div key={p.child} className="gcontents__part">
          <div className="pgap" data-gap={`toc:${p.child}`} />
          <div data-pg={`toc:${p.child}`} style={{ display: "flow-root" }} dangerouslySetInnerHTML={{ __html: p.html }} />
        </div>
      ))}
    </section>
  );
});
