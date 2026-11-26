import { Button, Dialog, Select, Switch } from "@seconddawn/ui";
import { Fragment, useRef, useState } from "react";
import { AppIcon } from "../../components/AppIcons";
import { useT } from "../../i18n";
import { notify } from "../../notify";
import type { GuideDoc, MarkerShape, MarkerSize } from "../model";
import { installedFonts, storeImage } from "../RichText";
import { changeTemplate, templateOf } from "./apply";
import { templateVars } from "./css";
import { hasPosition } from "./background";
import { useTemplateName } from "./name";
import { ACROSS, BUILT_INS, COLOR_PRESETS, COVER_FIELDS, DOWN, LOGO_PLACES, SIDES, SLOTS, TOC_LEADERS, TOC_STYLES, badgeColors, colorsOf, type Across, type CoverField, type Template } from "./model";
import type { Templates } from "./useTemplates";
import { clearCoverAlign } from "../CoverBlock";
import { CoverGallery } from "./CoverSettings";
import { hasArt } from "./background";

type Change = (fn: (d: GuideDoc) => GuideDoc, key?: string) => void;
const row = (label: string, control: React.ReactNode, id = label) => (
  <div className="fxrow" key={id}>
    <span className="fxrow__label">{label}</span>
    <span className="fxrow__control">{control}</span>
  </div>
);

/** The two colours of the step numbers: each follows the template until one of its own is chosen. */
export function BadgeColorRows(props: { doc: GuideDoc; change: Change }) {
  const { t } = useT();
  const tpl = templateOf(props.doc);
  const now = badgeColors(tpl);
  const one = (label: string, key: "badgeBg" | "badgeText", shown: string) =>
    row(
      label,
      <span className="tpl__colour">
        {tpl.steps[key] !== null && (
          <button type="button" className="tpl__auto" onClick={() => props.change((d) => changeTemplate(d, (x) => (x.steps[key] = null)))}>
            {t("template.automatic")}
          </button>
        )}
        <input type="color" className="fxcolor" aria-label={label} value={shown} onChange={(e) => props.change((d) => changeTemplate(d, (x) => (x.steps[key] = e.target.value.toUpperCase())), `tpl:${key}`)} />
      </span>,
      key,
    );
  return (
    <>
      {one(t("template.badgeBg"), "badgeBg", now.fill)}
      {one(t("template.badgeText"), "badgeText", now.text)}
    </>
  );
}

/**
 * The editor of the guide's template, one section per group. Every change stays with the guide (it works for the built-in ones
 * without making a template of one's own) and is one undo step; the editor next to it is the live preview.
 */
export function TemplateEditor(props: { doc: GuideDoc; change: Change }) {
  const { t } = useT();
  const tpl = templateOf(props.doc);
  const [fonts] = useState(installedFonts);
  const fileRef = useRef<HTMLInputElement>(null);
  const target = useRef<"logo" | "cover">("logo");
  const edit = (key: string, fn: (x: Template) => void) => props.change((d) => changeTemplate(d, fn), `tpl:${key}`);

  const select = <V extends string>(label: string, value: V, options: readonly (readonly [V, string])[], set: (x: Template, v: V) => void) =>
    row(label, <Select label={label} value={value} onChange={(v) => edit(label, (x) => set(x, v as V))} options={options.map(([v, l]) => ({ value: v, label: l }))} />);
  const number = (label: string, value: number, min: number, max: number, set: (x: Template, v: number) => void, step = 1) =>
    row(label, <input type="number" className="tpl__num" aria-label={label} value={value} min={min} max={max} step={step} onChange={(e) => e.target.value !== "" && edit(label, (x) => set(x, Number(e.target.value)))} />);
  const flag = (label: string, value: boolean, set: (x: Template, v: boolean) => void) => row(label, <Switch label={label} checked={value} onChange={(v) => edit(label, (x) => set(x, v))} />);
  const colour = (label: string, value: string, set: (x: Template, v: string) => void) =>
    row(label, <input type="color" className="fxcolor" aria-label={label} value={value} onChange={(e) => edit(label, (x) => set(x, e.target.value.toUpperCase()))} />);
  const text = (label: string, value: string, set: (x: Template, v: string) => void, hint?: string) =>
    row(label, <input type="text" className="tpl__text" aria-label={label} value={value} placeholder={hint} maxLength={200} onChange={(e) => edit(label, (x) => set(x, e.target.value))} />);
  // A place on the cover: as the design has it, or chosen.
  const byDesign = <V extends string>(list: readonly V[], name: (v: V) => string): (readonly [V | "auto", string])[] => [["auto", t("template.byDesign")], ...list.map((v) => [v, name(v)] as const)];
  const withGroup = (): (readonly [Across | "auto", string])[] => [["auto", t("template.withTexts")], ...ACROSS.map((v) => [v, t(`template.align.${v}`)] as const)];
  const image = (label: string, value: string | null, which: "logo" | "cover") =>
    row(
      label,
      <span className="tpl__image">
        <Button onClick={() => ((target.current = which), fileRef.current?.click())}>{t("template.chooseImage")}</Button>
        {value && <Button onClick={() => edit(label, (x) => (which === "logo" ? (x.logo = null) : (x.cover.image = null)))}>{t("template.remove")}</Button>}
      </span>,
    );
  const section = (title: string, children: React.ReactNode, open = false) => (
    <details className="tpl__group" open={open}>
      <summary>{title}</summary>
      <div className="tpl__rows">{children}</div>
    </details>
  );
  const colors = colorsOf(tpl);
  const slotOptions = SLOTS.map((s) => [s, t(`template.item.${s}`)] as const);
  const range = (label: string, value: number, min: number, max: number, set: (x: Template, v: number) => void) =>
    row(
      label,
      <span className="tpl__range">
        <input type="range" aria-label={label} value={value} min={min} max={max} onChange={(e) => edit(label, (x) => set(x, Number(e.target.value)))} />
        <span>{value}%</span>
      </span>,
    );
  // A text typed here replaces what was formatted on the cover itself.
  const coverText = (label: string, field: CoverField) =>
    text(label, tpl.cover[field], (x, v) => {
      x.cover[field] = v;
      delete x.cover.rich[field];
    });
  const roles = (["main", "accent", "dark"] as const).map((r) => [r, t(`template.role.${r}`)] as const);
  // The click marker and the number style are the guide's own (a template only suggests them): changed in both.
  const marker = (c: Partial<GuideDoc["marker"]>) => props.change((d) => ({ ...changeTemplate(d, (x) => (x.marker = { ...d.marker, ...c })), marker: { ...d.marker, ...c } }), "tpl:marker");
  const badge = (v: GuideDoc["badge"]) => props.change((d) => ({ ...changeTemplate(d, (x) => (x.steps.badge = v)), badge: v }), "tpl:badge");
  // Where the cover is off, the texts it shares with the header and the footer are written here.
  const used = (slot: "title" | "author") => [tpl.header, tpl.footer].some((bar) => SIDES.some((side) => bar[side] === slot));
  const fontOptions = (current: string) => Array.from(new Set([current, ...fonts])).map((f) => [f, f] as const);

  return (
    <div className="tpl">
      {section(
        t("template.colors"),
        <>
          {colour(t("template.mainColor"), tpl.colors.main, (x, v) => (x.colors.main = v))}
          <div className="tpl__presets">
            {COLOR_PRESETS.map((c) => (
              <button key={c} type="button" className="rich__swatch" style={{ background: c }} aria-label={c} onClick={() => edit("preset", (x) => (x.colors.main = c))} />
            ))}
          </div>
          {colour(t("template.color.background"), tpl.colors.background, (x, v) => (x.colors.background = v))}
          {flag(t("template.autoColors"), tpl.colors.auto, (x, v) => (x.colors = { ...colors, auto: v }))}
          {!tpl.colors.auto && (["accent", "light", "dark", "text"] as const).map((k) => colour(t(`template.color.${k}`), tpl.colors[k] || colors[k], (x, v) => (x.colors[k] = v)))}
        </>,
        true,
      )}
      {section(t("template.logo"), <>{image(t("template.logo"), tpl.logo, "logo")}</>)}
      {section(
        t("template.fonts"),
        <>
          {select(t("template.headingFont"), tpl.fonts.heading, fontOptions(tpl.fonts.heading), (x, v) => (x.fonts.heading = v))}
          {select(t("template.bodyFont"), tpl.fonts.body, fontOptions(tpl.fonts.body), (x, v) => (x.fonts.body = v))}
          {number(t("template.textSize"), tpl.fonts.size, 7, 28, (x, v) => (x.fonts.size = v), 0.5)}
          {number(t("template.headingSize"), tpl.fonts.headingSize, 12, 64, (x, v) => (x.fonts.headingSize = v))}
        </>,
      )}
      {section(
        t("template.frame"),
        <>
          {select(
            t("template.ratio"),
            tpl.frame.ratio,
            [["original", t("template.ratio.original")], ["16:9", "16:9"], ["4:3", "4:3"], ["3:2", "3:2"], ["1:1", "1:1"], ["custom", t("template.ratio.custom")]] as const,
            (x, v) => (x.frame.ratio = v),
          )}
          {tpl.frame.ratio === "custom" && number("W", tpl.frame.w, 1, 100, (x, v) => (x.frame.w = v))}
          {tpl.frame.ratio === "custom" && number("H", tpl.frame.h, 1, 100, (x, v) => (x.frame.h = v))}
          {number(t("template.maxWidth"), tpl.frame.maxWidth, 20, 100, (x, v) => (x.frame.maxWidth = v), 5)}
        </>,
      )}
      {section(
        t("template.steps"),
        <>
          {select(t("template.layout"), tpl.steps.layout, (["above", "right", "left"] as const).map((s) => [s, t(`template.layout.${s}`)] as const), (x, v) => (x.steps.layout = v))}
          {number(t("template.spacing"), tpl.steps.spacing, 0, 80, (x, v) => (x.steps.spacing = v), 2)}
          {select(t("template.description"), tpl.steps.description, (["normal", "muted", "boxed"] as const).map((s) => [s, t(`template.desc.${s}`)] as const), (x, v) => (x.steps.description = v))}
          {number(t("template.textScale"), tpl.steps.textScale, 0.8, 2, (x, v) => (x.steps.textScale = v), 0.05)}
          {flag(t("template.onePerPage"), tpl.steps.onePerPage, (x, v) => (x.steps.onePerPage = v))}
        </>,
      )}
      {section(
        t("template.page"),
        <>
          {select(t("template.pageSize"), tpl.page.size, [["a4", "A4"], ["letter", "Letter"], ["screen", t("template.screen")]] as const, (x, v) => (x.page.size = v))}
          {select(t("template.orientation"), tpl.page.orientation, [["portrait", t("template.portrait")], ["landscape", t("template.landscape")]] as const, (x, v) => (x.page.orientation = v))}
          {number(t("template.margin"), tpl.page.margin, 0, 40, (x, v) => (x.page.margin = v))}
        </>,
      )}
      {section(
        t("template.cover"),
        <>
          {flag(t("template.coverOn"), tpl.cover.on, (x, v) => (x.cover.on = v))}
          {!tpl.cover.on && used("title") && coverText(t("template.coverTitle"), "title")}
          {!tpl.cover.on && used("author") && coverText(t("template.author"), "author")}
          {tpl.cover.on && (
            <>
              <CoverGallery
                template={tpl}
                title={props.doc.title}
                onChoose={(design) =>
                  edit("design", (x) => {
                    x.cover.design = design;
                    clearCoverAlign(x, COVER_FIELDS);
                  })
                }
              />
              {hasArt(tpl.cover.design) && image(t("template.coverPicture"), tpl.cover.image, "cover")}
              {tpl.cover.design === "image" && select(t("template.overlay"), tpl.cover.overlay, (["dark", "light"] as const).map((v) => [v, t(`template.overlay.${v}`)] as const), (x, v) => (x.cover.overlay = v))}
              {select(t("template.coverDown"), tpl.cover.vertical, byDesign(DOWN, (v) => (v === "center" ? t("template.center") : t(`template.${v}`))), (x, v) => (x.cover.vertical = v))}
              {select(t("template.coverAcross"), tpl.cover.align, byDesign(ACROSS, (v) => t(`template.align.${v}`)), (x, v) => {
                x.cover.align = v;
                clearCoverAlign(x, COVER_FIELDS);
              })}
            </>
          )}
          {flag(t("template.showDate"), tpl.cover.date, (x, v) => (x.cover.date = v))}
          {tpl.cover.on &&
            tpl.cover.date &&
            select(t("template.dateAlign"), tpl.cover.dateAlign, withGroup(), (x, v) => {
              x.cover.dateAlign = v;
              clearCoverAlign(x, ["dateText"]);
            })}
          {flag(t("template.showLogo"), tpl.cover.logo, (x, v) => (x.cover.logo = v))}
          {tpl.cover.on && tpl.cover.logo && (
            <>
              {image(t("template.logo"), tpl.logo, "logo")}
              {select(t("template.logoPlace"), tpl.cover.logoPlace, LOGO_PLACES.map((v) => [v, t(`template.logoPlace.${v}`)] as const), (x, v) => (x.cover.logoPlace = v))}
              {select(t("template.logoAlign"), tpl.cover.logoAlign, withGroup(), (x, v) => (x.cover.logoAlign = v))}
              {row(
                t("template.logoSize"),
                <span className="tpl__range">
                  <input type="range" aria-label={t("template.logoSize")} value={tpl.cover.logoSize} min={24} max={240} step={2} onChange={(e) => edit("logoSize", (x) => (x.cover.logoSize = Number(e.target.value)))} />
                  <span>{tpl.cover.logoSize}px</span>
                </span>,
              )}
            </>
          )}
          {colour(t("template.color.background"), tpl.cover.background, (x, v) => (x.cover.background = v))}
        </>,
      )}
      {section(
        t("export.toc"),
        <>
          {flag(t("template.tocOn"), tpl.contents, (x, v) => (x.contents = v))}
          {tpl.contents && (
            <>
              {select(t("template.tocStyle"), tpl.toc.style, TOC_STYLES.map((v) => [v, t(`template.toc.${v}`)] as const), (x, v) => (x.toc.style = v))}
              {text(t("template.tocTitle"), tpl.toc.title, (x, v) => (x.toc.title = v), t("export.contents"))}
              {flag(t("template.tocNumbers"), tpl.toc.numbers, (x, v) => (x.toc.numbers = v))}
              {tpl.toc.numbers && flag(t("template.tocRight"), tpl.toc.right, (x, v) => (x.toc.right = v))}
              {tpl.toc.numbers && tpl.toc.right && select(t("template.tocLeader"), tpl.toc.leader, TOC_LEADERS.map((v) => [v, t(`template.leader.${v}`)] as const), (x, v) => (x.toc.leader = v))}
              {number(t("template.textSize"), tpl.toc.size || tpl.fonts.size, 7, 28, (x, v) => (x.toc.size = v), 0.5)}
              {number(t("template.tocSpacing"), tpl.toc.spacing, 1, 2.5, (x, v) => (x.toc.spacing = v), 0.1)}
              {flag(t("template.tocSteps"), tpl.toc.steps, (x, v) => (x.toc.steps = v))}
              {flag(t("template.tocHeadings"), tpl.toc.headings, (x, v) => (x.toc.headings = v))}
            </>
          )}
        </>,
      )}
      {section(
        t("template.bgImage"),
        <>
          {image(t("template.bgImage"), tpl.cover.image, "cover")}
          {tpl.cover.image && (
            <>
              {select(t("template.bgApply"), tpl.background.apply, (["cover", "all", "notCover"] as const).map((v) => [v, t(`template.bgApply.${v}`)] as const), (x, v) => (x.background.apply = v))}
              {select(t("template.bgSize"), tpl.background.size, (["original", "fit", "fill", "custom"] as const).map((v) => [v, t(`template.bgSize.${v}`)] as const), (x, v) => (x.background.size = v))}
              {tpl.background.size === "custom" && range(t("template.bgScale"), tpl.background.scale, 5, 200, (x, v) => (x.background.scale = v))}
              {hasPosition(tpl.background) && select(t("template.bgX"), tpl.background.x, (["left", "center", "right"] as const).map((v) => [v, t(`template.${v}`)] as const), (x, v) => (x.background.x = v))}
              {hasPosition(tpl.background) && select(t("template.bgY"), tpl.background.y, (["top", "center", "bottom"] as const).map((v) => [v, t(`template.${v}`)] as const), (x, v) => (x.background.y = v))}
              {range(t("template.bgOpacity"), tpl.background.opacity, 0, 100, (x, v) => (x.background.opacity = v))}
              {flag(t("template.bgGrey"), tpl.background.grey, (x, v) => (x.background.grey = v))}
            </>
          )}
        </>,
      )}
      {(["header", "footer"] as const).map((where) => (
        <div key={where}>
          {section(
            t(`template.${where}`),
            <>
              {SIDES.map((side) => (
                <Fragment key={side}>
                  {select(t(`template.${side}`), tpl[where][side], slotOptions, (x, v) => (x[where][side] = v))}
                  {tpl[where][side] === "text" && text(`${t(`template.${side}`)}: ${t("template.item.text")}`, tpl[where].texts[side], (x, v) => (x[where].texts[side] = v))}
                </Fragment>
              ))}
            </>,
          )}
        </div>
      ))}
      {section(
        t("template.pictureStyle"),
        <>
          {colour(t("template.border"), tpl.picture.borderColor, (x, v) => (x.picture.borderColor = v))}
          {number(t("template.borderWidth"), tpl.picture.borderWidth, 0, 12, (x, v) => (x.picture.borderWidth = v))}
          {number(t("template.radius"), tpl.picture.radius, 0, 40, (x, v) => (x.picture.radius = v))}
          {flag(t("template.shadow"), tpl.picture.shadow, (x, v) => (x.picture.shadow = v))}
          {select(t("template.drawingColor"), tpl.annotation, roles, (x, v) => (x.annotation = v))}
          <p className="fxpanel__note">{t("template.drawingColorHint")}</p>
        </>,
      )}
      {section(
        t("template.table"),
        <>
          {select(t("template.tableHeader"), tpl.table.header, [["main", t("template.role.main")], ["light", t("template.color.light")], ["none", t("template.item.none")]] as const, (x, v) => (x.table.header = v))}
          {flag(t("template.borders"), tpl.table.borders, (x, v) => (x.table.borders = v))}
          {flag(t("template.zebra"), tpl.table.zebra, (x, v) => (x.table.zebra = v))}
        </>,
      )}
      {section(
        t("panel.markerNumbers"),
        <>
          {row(t("guide.markerShape"), <Select label={t("guide.markerShape")} value={props.doc.marker.shape} onChange={(v) => marker({ shape: v as MarkerShape })} options={(["circle", "ring", "arrow", "hand", "box"] as MarkerShape[]).map((v) => ({ value: v, label: t(`guide.shape.${v}`) }))} />)}
          {row(t("guide.markerSize"), <Select label={t("guide.markerSize")} value={props.doc.marker.size} onChange={(v) => marker({ size: v as MarkerSize })} options={(["small", "medium", "large"] as const).map((v) => ({ value: v, label: t(`guide.size.${v}`) }))} />)}
          {row(t("guide.markerLeft"), <input type="color" className="fxcolor" aria-label={t("guide.markerLeft")} value={props.doc.marker.left} onChange={(e) => marker({ left: e.target.value.toUpperCase() })} />)}
          {row(t("guide.markerRight"), <input type="color" className="fxcolor" aria-label={t("guide.markerRight")} value={props.doc.marker.right} onChange={(e) => marker({ right: e.target.value.toUpperCase() })} />)}
          {row(t("guide.badge"), <Select label={t("guide.badge")} value={props.doc.badge} onChange={(v) => badge(v as GuideDoc["badge"])} options={(["circle", "square", "pill", "none"] as const).map((v) => ({ value: v, label: t(`guide.badge.${v}`) }))} />)}
          {props.doc.badge !== "none" && select(t("template.badgeColor"), tpl.steps.badgeColor, roles, (x, v) => (x.steps.badgeColor = v))}
          {props.doc.badge !== "none" && <BadgeColorRows doc={props.doc} change={props.change} />}
        </>,
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const which = target.current;
          void storeImage(f)
            .then((img) => edit(which, (x) => (which === "logo" ? (x.logo = img.name) : (x.cover.image = img.name))))
            .catch((err) => notify(String(err?.message ?? err), true));
        }}
      />
    </div>
  );
}

function Preview({ t: tpl }: { t: Template }) {
  const vars = templateVars(tpl) as React.CSSProperties;
  const beside = tpl.steps.layout !== "above";
  return (
    <span className="tplcard__page" style={vars} aria-hidden="true">
      <span className="tplcard__cover" style={{ background: tpl.cover.on ? tpl.cover.background : "transparent" }}>
        <span className="tplcard__title">Aa</span>
      </span>
      {[1, 2].map((n) => (
        <span key={n} className={`tplcard__step${beside ? " tplcard__step--beside" : ""}`}>
          <span className={`tplcard__badge tplcard__badge--${tpl.steps.badge}`}>{tpl.steps.badge === "none" ? "" : n}</span>
          <span className="tplcard__line" />
          <span className="tplcard__pic" style={{ aspectRatio: tpl.frame.ratio === "original" ? "16 / 9" : tpl.frame.ratio === "custom" ? `${tpl.frame.w} / ${tpl.frame.h}` : tpl.frame.ratio.replace(":", " / ") }} />
        </span>
      ))}
    </span>
  );
}

/** The panel of templates: the built-in ones and one's own, with everything the "Template" menu does. */
export function TemplateGallery(props: { open: boolean; onClose: () => void; doc: GuideDoc; templates: Templates }) {
  const { t } = useT();
  const nameOf = useTemplateName();
  const { templates } = props;
  const current = templateOf(props.doc);
  const card = (tpl: Template, mine: boolean) => (
    <li key={tpl.id} className={`tplcard${current.id === tpl.id ? " tplcard--on" : ""}`}>
      <button type="button" className="tplcard__use" aria-pressed={current.id === tpl.id} onClick={() => (templates.use(tpl, mine), props.onClose())}>
        <Preview t={tpl} />
        <strong>{nameOf(tpl)}</strong>
      </button>
      {mine && (
        // (on the thumbnail's corner while the card is pointed at or has the keyboard)
        <button type="button" className="tplcard__delete" aria-label={`${t("template.delete")}: ${tpl.name}`} title={t("template.delete")} onClick={() => templates.remove(tpl)}>
          <AppIcon name="trash" size={15} />
        </button>
      )}
      {mine && (
        <span className="tplcard__actions">
          <button type="button" onClick={() => templates.rename(tpl, false)}>
            {t("proj.rename")}
          </button>
          <button type="button" onClick={() => templates.rename(tpl, true)}>
            {t("guide.duplicate")}
          </button>
          <button type="button" onClick={() => templates.exportOne(tpl)}>
            {t("template.export")}
          </button>
        </span>
      )}
    </li>
  );
  return (
    <Dialog
      open={props.open}
      title={t("template.title")}
      // (Escape closes the question that is open above the panel, not the panel too)
      onClose={() => !templates.busy && props.onClose()}
      footer={
        <div className="tplgallery__footer">
          <Button onClick={templates.importSome}>{t("template.import")}</Button>
          <Button disabled={templates.own.length === 0} onClick={templates.exportSome}>
            {t("template.exportSome")}
          </Button>
          <Button disabled={!templates.mine} onClick={templates.update}>
            {t("template.update")}
          </Button>
          <Button onClick={templates.saveAsNew}>{t("template.saveOwn")}</Button>
          <Button variant="primary" onClick={props.onClose}>
            {t("guide.ok")}
          </Button>
        </div>
      }
    >
      <div className="tplgallery">
        <h4>{t("template.builtIn")}</h4>
        <ul className="tplgallery__list">{BUILT_INS.map((x) => card(x, false))}</ul>
        {templates.own.length > 0 && (
          <>
            <h4>{t("template.own")}</h4>
            <ul className="tplgallery__list">{templates.own.map((x) => card(x, true))}</ul>
          </>
        )}
      </div>
    </Dialog>
  );
}
