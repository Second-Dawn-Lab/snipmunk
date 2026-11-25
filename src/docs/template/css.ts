// The CSS of a template (no React): the same rules style the editor's pages, the print preview, HTML export and the PDF pages, so
// a block has the same size in each of them.

import { badgeColors, colorsOf, fontStack, onColor, type Template } from "./model";

/** The scope of the editor's canvas. */
export const CANVAS = ".gpage.doc";

/** The template's values as CSS variables (set on the page element). */
export function templateVars(t: Template): Record<string, string> {
  const c = colorsOf(t);
  const badge = badgeColors(t);
  return {
    "--tpl-main": c.main,
    "--tpl-on-main": onColor(c.main),
    "--tpl-accent": c.accent,
    "--tpl-light": c.light,
    "--tpl-dark": c.dark,
    "--tpl-text": c.text,
    "--tpl-bg": c.background,
    "--tpl-badge": badge.fill,
    "--tpl-badge-text": badge.text,
    "--tpl-head-font": fontStack(t.fonts.heading),
    "--tpl-body-font": fontStack(t.fonts.body),
    "--tpl-size": `${t.fonts.size}pt`,
    "--tpl-head-size": `${t.fonts.headingSize}pt`,
    "--tpl-step-size": `${+(t.fonts.size * t.steps.textScale).toFixed(2)}pt`,
    "--tpl-gap": `${t.steps.spacing}px`,
    "--tpl-pic-border": `${t.picture.borderWidth}px solid ${t.picture.borderColor}`,
    "--tpl-pic-border-width": `${t.picture.borderWidth}px`,
    "--tpl-pic-radius": `${t.picture.radius}px`,
    "--tpl-pic-shadow": t.picture.shadow ? "0 6px 20px rgba(0,0,0,.22)" : "none",
    "--tpl-pic-width": `${t.frame.maxWidth}%`,
    "--tpl-table-head": t.table.header === "main" ? c.main : t.table.header === "light" ? c.light : "transparent",
    "--tpl-table-head-text": t.table.header === "main" ? onColor(c.main) : c.text,
    "--tpl-toc-size": t.toc.size ? `${t.toc.size}pt` : `${t.fonts.size}pt`,
    "--tpl-toc-line": String(t.toc.spacing),
  };
}

const vars = (t: Template): string => Object.entries(templateVars(t)).map(([k, v]) => `${k}:${v}`).join(";");

/**
 * Rich text (headings, lists, links, tables, pictures) in a content block or a description. The top-level elements keep their
 * distance with padding, never with margins that run into each other: a page layout adds their heights up, and a block must be as
 * high on its own as among its neighbours. `.ProseMirror` is the same text while it is edited.
 */
function richCss(s: string, t: Template): string {
  const roots = [`${s} .content`, `${s} .step__desc`, `${s} .content .ProseMirror`, `${s} .step__desc .ProseMirror`];
  const top = (...children: string[]) => roots.flatMap((r) => children.map((c) => `${r}>${c}`)).join(",");
  const line = "color-mix(in srgb,var(--tpl-text) 30%,transparent)";
  return `
${s} .content,${s} .step__desc,${s} .step__head p,${s} .cover__group{white-space:pre-wrap;white-space:break-spaces;overflow-wrap:anywhere;font-variant-ligatures:none}
${s} h1,${s} h2,${s} h3{font-family:var(--tpl-head-font);color:var(--tpl-dark);line-height:1.25;margin:.7em 0 .35em;font-weight:700}
${s} h1{font-size:var(--tpl-head-size)}${s} h2{font-size:calc(var(--tpl-head-size)*.76)}${s} h3{font-size:calc(var(--tpl-head-size)*.6)}
${s} p{margin:.35em 0}${s} a{color:var(--tpl-accent);text-decoration:underline}${s} ul,${s} ol{padding-inline-start:1.6em;margin:.35em 0}
${s} code{font-family:Consolas,"Courier New",monospace;font-size:.95em;background:none;padding:0}
${top("*")}{margin:0}
${top("p")}{padding:.35em 0}
${top("h1", "h2", "h3")}{padding:.7em 0 .35em}
${top("ul", "ol")}{padding-block:.35em}
${top("blockquote")}{padding:.35em 0;padding-inline-start:12px;border-inline-start:3px solid ${line}}
${top("pre")}{padding:.5em 8px;background:var(--tpl-light)}
${top("hr")}{box-sizing:border-box;border:0;height:calc(1.2em + 1px);padding:.6em 0;background:${line} content-box}
${top("table")}{margin-block:.5em}
${top(".tableWrapper")}{padding:0;overflow:hidden}
${top(".tableWrapper>table")}{margin-block:.5em}
${s} table{border-collapse:collapse;table-layout:fixed;max-width:100%}
${s} td,${s} th{border:${t.table.borders ? `1px solid ${line}` : "0"};padding:4px 8px;vertical-align:top;text-align:start;min-width:0}
${s} th{background:var(--tpl-table-head);color:var(--tpl-table-head-text);font-weight:700}
${t.table.zebra ? `${s} tr.z td{background:var(--tpl-light)}` : ""}`;
}

/** The table of contents: four styles, the leader between an entry and its page number, and where that number stands. */
function tocCss(s: string): string {
  const faint = "color-mix(in srgb,var(--tpl-text) 45%,transparent)";
  const t = `${s} .toc`;
  return `
${t}{margin:0 0 var(--tpl-gap);font-size:var(--tpl-toc-size);line-height:var(--tpl-toc-line)}
${t}.toc--part{margin:0}
${t} h2{margin:0;padding:0 0 .6em;line-height:1.25}
${t} ol{list-style:none;padding:0;margin:0}
${t} li{display:flex;align-items:baseline;gap:6px}
${t} a{color:var(--tpl-text);text-decoration:none;min-width:0;overflow-wrap:anywhere}
${t} .toc__lead{flex:1;min-width:1.5em;align-self:flex-end;margin-bottom:.4em;border-bottom:2px dotted ${faint}}
${t}.toc--lead-dashes .toc__lead{border-bottom:1px dashed ${faint}}
${t}.toc--lead-line .toc__lead{border-bottom:1px solid ${faint}}
${t}.toc--lead-none .toc__lead{border-bottom:0}
${t}.toc--follow .toc__lead{display:none}
${t} .toc__num{flex:none;font-variant-numeric:tabular-nums}
${t} .toc__l2{padding-inline-start:16px}
${t}--classic .toc__l1{font-weight:700}
${t}--modern h2{color:var(--tpl-main);border-inline-start:6px solid var(--tpl-main);padding:0 10px;margin-bottom:.6em}
${t}--modern .toc__num{color:var(--tpl-main);font-weight:700}
${t}--modern .toc__l1{font-weight:700;border-bottom:1px solid color-mix(in srgb,var(--tpl-main) 30%,transparent)}
${t}--modern .toc__l2{padding-inline-start:22px}
${t}--formal h2{text-align:center;text-transform:uppercase;letter-spacing:.14em;color:var(--tpl-text);border-bottom:1px solid var(--tpl-text);margin-bottom:.8em}
${t}--formal .toc__l1{text-transform:uppercase;letter-spacing:.05em;font-weight:600}
${t}--formal .toc__l2{padding-inline-start:28px;font-style:italic}
${t}--simple h2{font-size:1.3em;color:var(--tpl-text)}
${t}--simple .toc__l2{padding-inline-start:0}`;
}

/** The cover page: a group of texts (and perhaps the logo) placed as the design and the settings say. */
function coverCss(s: string, t: Template): string {
  const c = `${s} .cover`;
  const art = t.cover.overlay === "dark" ? "#FFFFFF" : "#111111";
  return `
${c}{position:relative;display:flex;flex-direction:column;align-items:stretch;overflow:hidden;min-height:420px;background:${t.cover.background};color:${onColor(t.cover.background)};margin-bottom:var(--tpl-gap);line-height:1.45}
${c} .cover__group{position:relative;z-index:1;flex:1;display:flex;flex-direction:column;justify-content:center;gap:14px;padding:48px;min-width:0}
${c}--down-top .cover__group{justify-content:flex-start}
${c}--down-bottom .cover__group{justify-content:flex-end}
${c}--across-start .cover__group{text-align:start}
${c}--across-center .cover__group{text-align:center}
${c}--across-end .cover__group{text-align:end}
${c} p{margin:0}
${c} h1{color:inherit;margin:0}
${c} .cover__title{font-family:var(--tpl-head-font);font-size:calc(var(--tpl-head-size)*1.7);font-weight:700;line-height:1.25}
${c} .cover__title,${c} .cover__text{align-self:stretch}
${c} .cover__date--start{text-align:start}${c} .cover__date--center{text-align:center}${c} .cover__date--end{text-align:end}
${c} .cover__logo{width:auto;max-width:100%;object-fit:contain;flex:none}
${c} .cover__logo--start{align-self:flex-start}${c} .cover__logo--center{align-self:center}${c} .cover__logo--end{align-self:flex-end}
${c} .cover__logo--top,${c} .cover__logo--bottom{position:absolute;z-index:2;max-width:calc(100% - 64px)}
${c} .cover__logo--top{top:32px}${c} .cover__logo--bottom{bottom:32px}
${c} .cover__logo--top.cover__logo--start,${c} .cover__logo--bottom.cover__logo--start{inset-inline-start:32px}
${c} .cover__logo--top.cover__logo--end,${c} .cover__logo--bottom.cover__logo--end{inset-inline-end:32px}
${c} .cover__logo--top.cover__logo--center,${c} .cover__logo--bottom.cover__logo--center{left:50%;transform:translateX(-50%)}
${c} .cover__bg,${c} .cover__art{position:absolute;inset:0;z-index:0;pointer-events:none}
${c}--band::after{content:"";position:absolute;top:0;bottom:0;inset-inline-start:0;width:42%;background:var(--tpl-main);z-index:0}
${c}--band .cover__group{width:42%;align-self:flex-start;padding:48px 28px;color:var(--tpl-on-main)}
${c}--band .cover__title{font-size:calc(var(--tpl-head-size)*1.35)}
${c}--banner .cover__title{order:-1;background:var(--tpl-main);color:var(--tpl-on-main);margin:0 -48px;padding:40px 48px}
${c}--banner.cover--down-top .cover__group{padding-top:0}
${c}--banner.cover--down-top .cover__title{padding-top:110px}
${c}--banner .cover__logo--title{order:-2;box-sizing:content-box;align-self:stretch;width:auto;max-width:none;margin:0 -48px -14px;padding:40px 48px 0;background:var(--tpl-main)}
${c}--banner .cover__logo--title~.cover__title,${c}--banner.cover--down-top .cover__logo--title~.cover__title{padding-top:24px}
${c}--banner .cover__logo--title.cover__logo--start{object-position:left center}
${c}--banner .cover__logo--title.cover__logo--end{object-position:right center}
[dir="rtl"] ${c}--banner .cover__logo--title.cover__logo--start{object-position:right center}
[dir="rtl"] ${c}--banner .cover__logo--title.cover__logo--end{object-position:left center}
${c}--image{background:var(--tpl-main);color:var(--tpl-on-main)}
${t.cover.image ? `${c}--image{color:${art}}` : ""}
${c}--split .cover__art{inset:auto;top:0;bottom:0;inset-inline-end:0;width:50%;background-color:var(--tpl-light)}
${c}--split .cover__group{width:50%;align-self:flex-start;padding:48px 32px}
${c}--split .cover__title{font-size:calc(var(--tpl-head-size)*1.35)}
${c}--minimal .cover__title{font-size:calc(var(--tpl-head-size)*1.4);border-top:5px solid var(--tpl-main);padding-top:14px}`;
}

/** What a page of a document and the editor's canvas share: steps, text, tables, contents and the cover. */
function sharedCss(s: string, t: Template): string {
  const beside = t.steps.layout !== "above";
  const [text, picture] = t.steps.layout === "right" ? [1, 2] : [2, 1];
  return `
${s}{${vars(t)};color:var(--tpl-text);font-family:var(--tpl-body-font);font-size:var(--tpl-size);font-weight:400;line-height:1.45;letter-spacing:normal;-webkit-print-color-adjust:exact;print-color-adjust:exact}
${richCss(s, t)}
${s} .content img,${s} .step__desc img{max-width:100%;vertical-align:top}
${s} .doc-title{font-family:var(--tpl-head-font);color:var(--tpl-dark);font-size:var(--tpl-head-size);line-height:1.25;margin:0 0 var(--tpl-gap)}
${s} .step{display:flex;flex-direction:column;gap:8px;margin:0 0 var(--tpl-gap);break-inside:avoid}
${s} .step__head{display:flex;gap:10px;align-items:flex-start;font-size:var(--tpl-step-size)}
${s} .step__head p{margin:2px 0 0}
${s} .badge{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:1.9em;height:1.9em;padding:0 .35em;background:var(--tpl-badge);color:var(--tpl-badge-text);font-weight:700;border-radius:50%}
${s} .badge--square{border-radius:4px}${s} .badge--pill{border-radius:999px;min-width:2.8em}
${s} .step__desc{${t.steps.description === "muted" ? "opacity:.78" : t.steps.description === "boxed" ? "background:var(--tpl-light);padding:6px 12px;border-radius:6px" : ""}}
${beside ? `${s} .step--pic{display:grid;grid-template-columns:${t.steps.layout === "right" ? "minmax(0,1fr) minmax(0,1.3fr)" : "minmax(0,1.3fr) minmax(0,1fr)"};align-items:start;column-gap:14px}${s} .step--pic>.step__head{grid-column:${text};grid-row:1}${s} .step--pic>.step__pic,${s} .step--pic>.step__fig,${s} .step--pic>.step__media{grid-column:${picture};grid-row:1/span 2}${s} .step--pic>.step__desc{grid-column:${text};grid-row:2}` : ""}
${s} .page__bg{position:absolute;inset:0;z-index:0;pointer-events:none}
${s} .page__slot{display:grid;grid-template-columns:1fr 1fr 1fr;align-items:center;font-size:8.5pt;opacity:.75;gap:8px;line-height:1.45}
${s} .page__slot>span:nth-child(2){text-align:center}${s} .page__slot>span:nth-child(3){text-align:end}
${s} .page__slot img{max-height:9mm;width:auto;vertical-align:middle}
${tocCss(s)}
${coverCss(s, t)}`;
}

/** The size of a thumbnail's page before it is shown small. */
export const THUMB = { width: 480, height: 679 };

/** The small pictures of the cover designs: the cover's own rules, on a page of a fixed size. */
export function thumbCss(t: Template): string {
  const s = ".covthumb";
  return `
${s} *{box-sizing:border-box}
${sharedCss(s, t)}
${s} .cover{width:${THUMB.width}px;height:${THUMB.height}px;min-height:0;margin:0}`;
}

/** The editor's canvas (`.gpage.doc`): the rules of a page, and what the editing controls need to take no room of their own. */
export function canvasCss(t: Template): string {
  const s = CANVAS;
  const beside = t.steps.layout !== "above";
  return `
${s} *{box-sizing:border-box}
${sharedCss(s, t)}
${s} .rich__editor{padding:0;min-height:0;border:0;border-radius:0;background:transparent;color:inherit;box-shadow:none;outline:1px dashed transparent;outline-offset:3px}
${s} .rich:hover .rich__editor{outline-color:rgba(128,128,128,.5)}
${s} .rich--focus .rich__editor{outline:1px solid var(--dw-brand,#3b82f6);box-shadow:none}
${s} .step__media{display:flex;flex-direction:column;gap:6px;align-self:stretch;min-width:0}
${s} .step__media>.gshot{display:flow-root;width:min(100%,calc(var(--tpl-pic-width)*(1 + 2*var(--out-side,0))));margin:0 auto}
${s} .gshot>.gpic{box-sizing:content-box;width:calc(100%/(1 + 2*var(--out-side,0)) - 2*var(--tpl-pic-border-width));margin:calc(100%*var(--out-top,0)/(1 + 2*var(--out-side,0))) auto calc(100%*var(--out-bottom,0)/(1 + 2*var(--out-side,0)));border:var(--tpl-pic-border);border-radius:var(--tpl-pic-radius);box-shadow:var(--tpl-pic-shadow);background:var(--tpl-bg)}
${beside ? `${s} .step--pic>.step__media>.gshot{width:100%}` : ""}
${s} .gimg{margin:0;padding:.35em 0}
${s} .gimg__box{vertical-align:top}
${s} .tbl-auto table{width:var(--tbl-width)!important;min-width:0!important}
${s} .tbl-center table{margin-inline:auto}
${s} .tbl-end table{margin-inline-start:auto;margin-inline-end:0}
${s} .pm-gap{display:block;margin:0;padding:0;user-select:none}
${s} .pm-gap-row td{border:0!important;padding:0!important;background:transparent!important}
${s} .pm-gap-head{user-select:none}
${s} .rich__bar,${s} .gimg__bar,${s} .ginsert__menu,${s} .step__chrome,${s} .gcontent__side{font-family:system-ui,"Segoe UI",sans-serif;font-size:13px;line-height:1.4;font-weight:400;color:var(--dw-text,#111);white-space:normal;text-align:start}`;
}

/** The stylesheet of an exported document (`.doc`): HTML, print preview, print and PDF pages. */
export function documentCss(t: Template): string {
  const s = ".doc";
  return `
*{box-sizing:border-box}
html,body{margin:0;padding:0}
${sharedCss(s, t)}
${s}{background:var(--tpl-bg)}
${s} img{max-width:100%}
${s} .step__pic{display:block;width:var(--tpl-pic-width);margin:0 auto;border:var(--tpl-pic-border);border-radius:var(--tpl-pic-radius);box-shadow:var(--tpl-pic-shadow);height:auto}
${t.steps.layout !== "above" ? `${s} .step--pic>.step__pic,${s} .step--pic>.step__fig{width:100%}` : ""}
${s} .step__fig{display:flow-root;width:min(100%,calc(var(--tpl-pic-width)*(1 + 2*var(--out-side,0))));margin:0 auto}
${s} .step__shot{position:relative;width:calc(100%/(1 + 2*var(--out-side,0)));margin:calc(100%*var(--out-top,0)/(1 + 2*var(--out-side,0))) auto calc(100%*var(--out-bottom,0)/(1 + 2*var(--out-side,0)))}
${s} .step__shot>.step__pic{width:100%}
${s} .step__over{position:absolute;z-index:1;max-width:none;height:auto;left:calc(var(--tpl-pic-border-width) - (100% - 2*var(--tpl-pic-border-width))*var(--out-side,0));top:var(--tpl-pic-border-width);margin-top:calc((100% - 2*var(--tpl-pic-border-width))*var(--out-top,0)*-1);width:calc((100% - 2*var(--tpl-pic-border-width))*(1 + 2*var(--out-side,0)))}
${s} .page__bg--fixed{position:fixed}
${s}.screen-doc>*:not(.page__bg){position:relative;z-index:1}
.pages .page>*:not(.page__bg){position:relative;z-index:1}
.pages .page{position:relative;overflow:hidden;background:var(--tpl-bg);break-after:page;display:flex;flex-direction:column}
.pages .page__body{flex:1;min-height:0;overflow:hidden}
.pages .page--cover{padding:0}.pages .page--cover .cover{flex:1;margin:0;min-height:0}
@media screen{.screen-doc{max-width:980px;margin:0 auto;padding:24px}}`;
}
