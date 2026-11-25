// Quick redact on one step picture: what the recognized text holds, and what follows a label even when it cannot be read.

import { ipc } from "../ipc";
import type { FindOptions } from "../ocr/pii";
import type { OcrResult } from "../ocr/types";
import { addAfterLabels, findInPicture, labelsIn, type Finding } from "./redact";

export async function findOnPicture(block: string, picture: string, result: OcrResult, options: FindOptions): Promise<Finding[]> {
  const found = findInPicture(block, result, options);
  const labels = labelsIn(result, options);
  if (labels.length === 0) return found;
  const inks = await ipc.docInk(picture, labels.map((l) => l.box));
  return addAfterLabels(block, result, found, labels, inks);
}
