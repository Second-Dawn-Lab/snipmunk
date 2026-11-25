// The cover's designs as small pictures to choose from. Each one is the cover itself, drawn by the same rules as in the guide.

import { useMemo } from "react";
import { useT } from "../../i18n";
import { guideImageUrl } from "../urls";
import { artCss, hasArt, onCover } from "./background";
import { thumbCss, THUMB } from "./css";
import { coverClass, coverLogoClass } from "../export/html";
import { COVER_DESIGNS, type CoverDesign, type Template } from "./model";

/** The width of a thumbnail on screen. */
const SHOWN = 72;

export function CoverGallery(props: { template: Template; title: string; onChoose: (design: CoverDesign) => void }) {
  const { t, locale } = useT();
  const tpl = props.template;
  const css = useMemo(() => thumbCss(tpl), [tpl]);
  const image = tpl.cover.image ? guideImageUrl(tpl.cover.image) : null;
  const today = new Date().toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
  const scale = SHOWN / THUMB.width;
  return (
    <div className="covgallery" role="radiogroup" aria-label={t("template.coverDesign")}>
      <style>{css + (image ? `.covthumb .artimg,.covthumb .bgimg{${artCss(image)}}` : "")}</style>
      {COVER_DESIGNS.map((design) => {
        // (as the design itself places things; what was chosen by hand shows on the page)
        const cover = { ...tpl.cover, design, align: "auto" as const, vertical: "auto" as const };
        const name = t(`template.cover.${design}`);
        return (
          <button key={design} type="button" role="radio" aria-checked={tpl.cover.design === design} className="covgallery__item" title={name} onClick={() => props.onChoose(design)}>
            <span className="covgallery__frame" style={{ width: SHOWN, height: THUMB.height * scale }} aria-hidden="true">
              <span className="covthumb" style={{ transform: `scale(${scale})` }}>
                <span className={coverClass(cover)} style={{ display: "flex" }}>
                  {hasArt(design) ? <span className={`cover__art${image ? " artimg" : ""}`} /> : image && onCover(tpl.background) && <span className="cover__bg bgimg" style={{ opacity: tpl.background.opacity / 100 }} />}
                  <span className="cover__group">
                    {cover.logo && tpl.logo && cover.logoPlace === "title" && <img className={coverLogoClass(cover)} style={{ height: cover.logoSize }} src={guideImageUrl(tpl.logo)} alt="" />}
                    <span className="cover__title" style={{ display: "block" }}>{cover.title || props.title}</span>
                    <span className="cover__text" style={{ display: "block" }}>{cover.subtitle || t("template.subtitle")}</span>
                    {cover.date && <span className="cover__text" style={{ display: "block" }}>{cover.dateText || today}</span>}
                  </span>
                </span>
              </span>
            </span>
            <span className="covgallery__name">{name}</span>
          </button>
        );
      })}
    </div>
  );
}
