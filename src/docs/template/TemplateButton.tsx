import { useState } from "react";
import { AppIcon } from "../../components/AppIcons";
import { MenuItem } from "../../components/MenuItem";
import { Pop } from "../../components/Pop";
import { useT } from "../../i18n";
import type { GuideDoc } from "../model";
import { templateOf } from "./apply";
import { BUILT_INS, type Template } from "./model";
import { useTemplateName } from "./TemplatePanel";
import type { Templates } from "./useTemplates";

/** "Template" with a menu: the templates to switch to, save, update, export, import, and the panel. */
export function TemplateButton(props: { doc: GuideDoc; templates: Templates; onManage: () => void }) {
  const { t } = useT();
  const nameOf = useTemplateName();
  const [open, setOpen] = useState(false);
  const { templates } = props;
  const current = templateOf(props.doc).id;
  const run = (fn: () => void) => () => (setOpen(false), fn());
  const entry = (tpl: Template, own: boolean) => (
    <MenuItem key={tpl.id} role="menuitemradio" checked={current === tpl.id} label={nameOf(tpl)} onSelect={run(() => templates.use(tpl, own))} />
  );
  return (
    <Pop
      open={open}
      onClose={() => setOpen(false)}
      kind="menu"
      label={t("template.menu")}
      align="end"
      trigger={
        <span className="gsplit">
          <button type="button" className="gsplit__main" onClick={props.onManage}>
            {t("template.title")}
          </button>
          <button
            type="button"
            className="gsplit__more"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={t("template.menu")}
            title={t("template.menu")}
            onClick={() => (templates.refresh(), setOpen((o) => !o))}
          >
            <AppIcon name="chevron" size={13} />
          </button>
        </span>
      }
    >
      <div className="tplmenu">
        <div className="menuitem__heading">{t("template.builtIn")}</div>
        {BUILT_INS.map((x) => entry(x, false))}
        {templates.own.length > 0 && <div className="menuitem__heading">{t("template.own")}</div>}
        {templates.own.map((x) => entry(x, true))}
        <hr className="tplmenu__sep" />
        <MenuItem label={t("template.saveOwn")} onSelect={run(templates.saveAsNew)} />
        <MenuItem label={t("template.update")} disabled={!templates.mine} onSelect={run(templates.update)} />
        <MenuItem label={t("template.exportSome")} disabled={templates.own.length === 0} onSelect={run(templates.exportSome)} />
        <MenuItem label={t("template.import")} onSelect={run(templates.importSome)} />
        <MenuItem label={t("template.manage")} onSelect={run(props.onManage)} />
      </div>
    </Pop>
  );
}
