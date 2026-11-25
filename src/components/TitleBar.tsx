import { useT } from "../i18n";
import logo from "../assets/snipmunk.png";
import { WindowControls } from "./WindowControls";

/** The custom title bar of the main window: icon, name, tagline and the window buttons. */
export function TitleBar() {
  const { t } = useT();
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar__content" data-tauri-drag-region>
      <div className="titlebar__brand" data-tauri-drag-region>
        <img className="titlebar__logo" src={logo} alt="" width={22} height={22} draggable={false} />
        <span className="titlebar__name" data-tauri-drag-region>
          {t("app.name")}
        </span>
        <span className="titlebar__tagline" data-tauri-drag-region>
          {t("app.tagline")}
        </span>
      </div>
      </div>
      <WindowControls />
    </header>
  );
}
