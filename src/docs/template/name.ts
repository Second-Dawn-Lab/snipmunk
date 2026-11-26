import { useT } from "../../i18n";
import type { Key } from "../../locales/en";
import { BUILT_INS, type Template } from "./model";

/** The name of a template for people (the built-in ones are translated). On its own, so the settings window can use it
    without the editor. */
export function useTemplateName() {
  const { t } = useT();
  return (tpl: Template) => (BUILT_INS.some((b) => b.id === tpl.id) ? t(`template.builtin.${tpl.id}` as Key) : tpl.name);
}
