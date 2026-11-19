import { Button, Dialog, Select } from "@seconddawn/ui";
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { ipc, type Capture } from "../ipc";
import type { Naming, SaveFormat, Settings } from "../settings/defaults";

const FORMATS: SaveFormat[] = ["png", "jpeg", "webp", "bmp", "zip"];
const NAMINGS: Naming[] = ["capture", "group", "dateTime"];

/** Save: the format, the file names and the quality; the folder is the export folder or asked when saving. */
export function SaveDialog(props: {
  captures: Capture[] | null;
  settings: Settings;
  onCancel: () => void;
  onSave: (captures: Capture[], options: { format: SaveFormat; naming: Naming; quality: number; folder: string }) => void;
}) {
  const { t } = useT();
  const { settings } = props;
  const [format, setFormat] = useState<SaveFormat>(settings.saveFormat);
  const [naming, setNaming] = useState<Naming>(settings.saveNaming);
  const [quality, setQuality] = useState(settings.saveQuality);
  const open = props.captures !== null;
  const [folder, setFolder] = useState("");
  useEffect(() => {
    if (!open) return;
    // The export folder of the settings, else the folder used last, else Pictures.
    const known = settings.exportFolder || settings.lastSaveFolder;
    if (known) setFolder(known);
    else void ipc.picturesFolder().then(setFolder).catch(() => setFolder(""));
    setFormat(settings.saveFormat);
    setNaming(settings.saveNaming);
    setQuality(settings.saveQuality);
  }, [open, settings.saveFormat, settings.saveNaming, settings.saveQuality]);
  const lossy = format === "jpeg" || format === "webp";
  const count = props.captures?.length ?? 0;
  return (
    <Dialog
      open={open}
      title={t("save.title")}
      onClose={props.onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={props.onCancel}>
            {t("session.cancel")}
          </Button>
          <Button variant="primary" disabled={!folder} onClick={() => props.captures && props.onSave(props.captures, { format, naming, quality, folder })}>
            {t("save.confirm")}
          </Button>
        </>
      }
    >
      <div className="savedlg">
        <p>{t("captures.title", { count })}</p>
        <label className="savedlg__row">
          <span>{t("save.format")}</span>
          <Select label={t("save.format")} value={format} onChange={setFormat} options={FORMATS.map((f) => ({ value: f, label: t(`format.${f}`) }))} />
        </label>
        {format === "zip" && <p className="dialog__hint">{t("save.zipNote")}</p>}
        <label className="savedlg__row">
          <span>{t("save.naming")}</span>
          <Select label={t("save.naming")} value={naming} onChange={setNaming} options={NAMINGS.map((n) => ({ value: n, label: t(`naming.${n}`) }))} />
        </label>
        {lossy && (
          <label className="savedlg__row">
            <span>{t("save.quality")}</span>
            <input type="range" min={10} max={100} value={quality} aria-label={t("save.quality")} onChange={(e) => setQuality(Number(e.target.value))} />
            <output dir="ltr">{quality}</output>
          </label>
        )}
        <div className="savedlg__row savedlg__row--folder">
          <span>{t("save.folder")}</span>
          <span className="savedlg__folder" dir="ltr" title={folder}>
            {folder}
          </span>
          <Button
            variant="ghost"
            onClick={() =>
              void ipc.pickFolder(folder || undefined).then((chosen) => {
                if (chosen) setFolder(chosen);
              })
            }
          >
            {t("save.change")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
