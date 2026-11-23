import { convertFileSrc } from "@tauri-apps/api/core";

let generation = 0;

/**
 * A new working guide (or a new load of it: opened, recovered, recorded) has new pictures under the SAME file names (step-0001.png).
 * The web view keeps decoded images by address, so an old guide's picture would show for the new one; the generation in the address
 * makes it a different address.
 */
export const bumpGuideGeneration = (): void => {
  generation++;
};

/** The address of a file of the open guide's working folder (a step picture, an inserted image). */
export const guideImageUrl = (file: string, versioned = false): string => {
  const url = convertFileSrc(`guide/current/${file}`, "snipmunk-img");
  return versioned ? `${url}?g=${generation}` : url;
};
