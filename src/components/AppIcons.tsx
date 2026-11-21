import type { ReactNode } from "react";

// Snipmunk's own icons (24 x 24, stroke only), drawn like the ones in @seconddawn/ui. Icons that point in a
// direction (arrows, chevrons, undo and redo) are listed in DIRECTIONAL and mirror in right-to-left layouts;
// a camera, a trash can or an emoji do not.

const paths = {
  // capture modes
  rectangle: <rect x="4" y="6" width="16" height="12" rx="1.5" strokeDasharray="3 2.5" />,
  window: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 9h18M6.5 7h.01M9 7h.01" />
    </>
  ),
  fullscreen: <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />,
  freeform: <path d="M5 14c-2-4 2-9 8-9s8 4 5 7-6 1-6 4 3 3 1 5" strokeDasharray="3 2.5" />,
  scrolling: (
    <>
      <rect x="5" y="3" width="11" height="18" rx="2" />
      <path d="M19 8v8M17.5 14.5 19 16l1.5-1.5M17.5 9.5 19 8l1.5 1.5M8 8h5M8 12h5M8 16h3" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="m16 10 5-3v10l-5-3" />
    </>
  ),
  // top bar
  paint: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1.400 0 2-1 2-2 0-1.500-1-1.800-1-3 0-1 .8-2 2-2h2.500A3.500 3.500 0 0 0 21 10.500C21 6.400 17 3 12 3z" />
      <path d="M7.500 11h.01M10 7.500h.01M14.500 7.500h.01" />
    </>
  ),
  save: (
    <>
      <path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M8 3v5h7V3M8 21v-7h8v7" />
    </>
  ),
  share: (
    <>
      <circle cx="6" cy="12" r="2.500" />
      <circle cx="18" cy="6" r="2.500" />
      <circle cx="18" cy="18" r="2.500" />
      <path d="m8.200 10.800 7.600-3.600M8.200 13.200l7.600 3.600" />
    </>
  ),
  zoom: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.300-4.300M8 11h6M11 8v6" />
    </>
  ),
  print: (
    <>
      <path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
      <rect x="7" y="14" width="10" height="7" rx="1" />
    </>
  ),
  openfile: <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M12 17v-5M9.500 14.500 12 12l2.500 2.500" />,
  chevronNext: <path d="m9 6 6 6-6 6" />,
  // annotation tools
  pen: <path d="M17 3a2.800 2.800 0 0 1 4 4L8 20l-5 1 1-5zM14 6l4 4" />,
  highlighter: <path d="M9 11l5 5M4 20h6l10-10-6-6L4 14zM14 4l6 6" />,
  eraser: <path d="M20 20H9L3.500 14.500a2 2 0 0 1 0-2.800L12 3.200a2 2 0 0 1 2.800 0l5.500 5.500a2 2 0 0 1 0 2.800L11 20.500" />,
  shapes: (
    <>
      <rect x="3" y="3" width="9" height="9" rx="1.500" />
      <circle cx="16.500" cy="16.500" r="4.500" />
    </>
  ),
  text: <path d="M5 6V4h14v2M12 4v16M9 20h6" />,
  crop: <path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14" />,
  rotate: <path d="M21 12a9 9 0 1 1-3-6.700M21 3v6h-6" />,
  blur: <path d="M12 3c3.500 4.500 6 7.500 6 11a6 6 0 0 1-12 0c0-3.500 2.500-6.500 6-11z" />,
  textscan: (
    <>
      <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
      <path d="M8.500 9.500V8.500h7v1M12 8.500v7M10.500 15.500h3" />
    </>
  ),
  // shapes
  smile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.500 14a4 4 0 0 0 7 0M9 9.500h.01M15 9.500h.01" />
    </>
  ),
  square: <rect x="4" y="4" width="16" height="16" rx="1.500" />,
  circle: <circle cx="12" cy="12" r="8.500" />,
  line: <path d="M5 19 19 5" />,
  arrow: <path d="M5 19 19 5M9 5h10v10" />,
  fill: <path d="M5 11 12 4l7 7-7 8zM5 11h14M20 16c0 1.500-1 2.500-1 3.500a1 1 0 0 0 2 0c0-1-1-2-1-3.500z" />,
  outline: <rect x="4" y="4" width="16" height="16" rx="3" strokeDasharray="0.1 3.200" strokeWidth="2.600" />,
  // text actions
  copytext: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1M12 13.500h6M15 13.500V18" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M3 15h18M9 4v16M15 4v16" />
    </>
  ),
  redact: (
    <>
      <rect x="3" y="9" width="18" height="6" rx="1" fill="currentColor" />
      <path d="M5 5h8M5 19h12" />
    </>
  ),
  select: <path d="M5 3l14 8-6.500 2L10 20z" />,
  // capture list views and menus
  viewList: (
    <>
      <rect x="3" y="4" width="5" height="4" rx="1" />
      <rect x="3" y="10" width="5" height="4" rx="1" />
      <rect x="3" y="16" width="5" height="4" rx="1" />
      <path d="M11 6h10M11 12h10M11 18h10" />
    </>
  ),
  viewMedium: (
    <>
      <rect x="3" y="3" width="8" height="8" rx="1.500" />
      <rect x="13" y="3" width="8" height="8" rx="1.500" />
      <rect x="3" y="13" width="8" height="8" rx="1.500" />
      <rect x="13" y="13" width="8" height="8" rx="1.500" />
    </>
  ),
  viewLarge: <rect x="4" y="4" width="16" height="16" rx="2" />,
  duplicate: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M4 16V5a1 1 0 0 1 1-1h11M14.500 11.500v6M11.500 14.500h6" />
    </>
  ),
  rename: <path d="M4 20h4L19 9a2.800 2.800 0 0 0-4-4L4 16zM13.500 6.500l4 4" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  // generic
  check: <path d="M20 6 9 17l-5-5" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.200" />
      <circle cx="12" cy="12" r="1.200" />
      <circle cx="19" cy="12" r="1.200" />
    </>
  ),
  undo: <path d="M3 7v6h6M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.700 3L3 13" />,
  redo: <path d="M21 7v6h-6M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6.700 3L21 13" />,
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  newsession: <path d="M12 5v14M5 12h14" />,
  settings: <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />,
  /** The recording options: a video camera with a small gear in front of it. */
  recoptions: (
    <>
      <path d="M16 9.5V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4" />
      <path d="M16 10l5-3v9" />
      <circle cx="15" cy="17" r="2.2" />
      <path d="M15 12.6v1.2M15 20.2v1.2M10.6 17h1.2M18.2 17h1.2M11.9 13.9l.85.85M17.25 19.25l.85.85M11.9 20.1l.85-.85M17.25 14.75l.85-.85" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V4.500A1 1 0 0 1 10 3.500h4a1 1 0 0 1 1 1V7" />
      <path d="M6 7l1 12.500a1.500 1.500 0 0 0 1.500 1.400h7a1.500 1.500 0 0 0 1.500-1.400L18 7" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  pause: (
    <>
      <rect x="6.500" y="5" width="3.500" height="14" rx="1" />
      <rect x="14" y="5" width="3.500" height="14" rx="1" />
    </>
  ),
  play: <path d="M8 5.500v13a.8.8 0 0 0 1.200.7l10-6.500a.8.8 0 0 0 0-1.400L9.200 4.800A.8.8 0 0 0 8 5.500z" />,
  speaker: (
    <>
      <path d="M4 9.500v5h3.500L12 18.500v-13L7.500 9.500z" />
      <path d="M15.500 9a4 4 0 0 1 0 6M18 6.500a7.500 7.500 0 0 1 0 11" />
    </>
  ),
  speakerOff: (
    <>
      <path d="M4 9.500v5h3.500L12 18.500v-13L7.500 9.500z" />
      <path d="m16 9.500 5 5M21 9.500l-5 5" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.500 11a6.500 6.500 0 0 0 13 0M12 17.500V21M9 21h6" />
    </>
  ),
  micOff: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.500 11a6.500 6.500 0 0 0 13 0M12 17.500V21M9 21h6M4 4l16 16" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6" cy="6" r="2.800" />
      <circle cx="6" cy="18" r="2.800" />
      <path d="M8.200 7.700 20 18M8.200 16.300 20 6" />
    </>
  ),
  webcam: (
    <>
      <circle cx="12" cy="10" r="6.500" />
      <circle cx="12" cy="10" r="2.200" />
      <path d="M8 21h8M12 16.500V21" />
    </>
  ),
  webcamOff: (
    <>
      <circle cx="12" cy="10" r="6.500" />
      <circle cx="12" cy="10" r="2.200" />
      <path d="M8 21h8M12 16.500V21M4 4l16 16" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type AppIconName = keyof typeof paths;

/** Icons that mirror when the page is right to left. */
const DIRECTIONAL = new Set<AppIconName>(["undo", "redo", "chevronNext"]);

export function AppIcon(props: { name: AppIconName; size?: number; className?: string }) {
  const { name, size = 18, className } = props;
  return (
    <svg
      className={`dw-icon${DIRECTIONAL.has(name) ? " rtl-flip" : ""}${className ? ` ${className}` : ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
