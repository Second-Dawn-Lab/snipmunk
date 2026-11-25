// The sheets behind the editor's blocks: for every page its colour, the picture behind it, the header and the footer. The blocks
// themselves lie on top, each page's first one at the head of its sheet (see canvas.ts).

import { memo, useMemo } from "react";
import { sheetCount, sheetOf, sheetTop } from "./canvas";
import { barHtml, type Layout } from "./export/paginate";
import type { ExportData } from "./export/html";
import { onPages } from "./template/background";
import { guideImageUrl } from "./urls";

export const PageSheets = memo(function PageSheets(props: { layout: Layout; data: ExportData; background: boolean; atLeast: number }) {
  const { layout, data } = props;
  const sheet = sheetOf(layout.box);
  // (the logo of the bars is shown from the guide itself)
  const withLogo = useMemo(() => {
    const logo = data.template.logo;
    return logo ? { ...data, pictures: new Map(data.pictures).set(logo, { src: guideImageUrl(logo), width: 1, height: 1 }) } : data;
  }, [data]);
  const behind = props.background && onPages(data.template.background);
  return (
    <div className="gsheets" aria-hidden="true">
      {Array.from({ length: Math.max(sheetCount(layout), props.atLeast) }, (_, i) => {
        const cover = i < layout.cover;
        const n = i - layout.cover + 1;
        const bar = (where: "header" | "footer") => <div dangerouslySetInnerHTML={{ __html: barHtml(withLogo, layout.box, where, n, layout.pages.length) }} />;
        return (
          <div key={i} className={`gsheet${cover ? " gsheet--cover" : ""}`} data-sheet={i} style={{ top: sheetTop(sheet, i), width: sheet.width, height: sheet.height }}>
            {!cover && behind && <div className="page__bg bgimg" />}
            {!cover && (
              <div className="gsheet__in" style={{ padding: sheet.margin }}>
                {bar("header")}
                <div className="gsheet__grow" />
                {bar("footer")}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});
