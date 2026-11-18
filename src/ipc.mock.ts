// In-memory stand-in for the Rust backend, so the UI runs in a plain browser (`pnpm dev`, add ?window=settings
// for the settings window). It mimics the real commands closely enough for UI work; the real rules live in
// src-tauri/src/sessions.rs and settings.rs.
import type { Capture, Session } from "./ipc";
import { defaultSettings, type Settings } from "./settings/defaults";

type Handler = (payload: never) => void;
const listeners = new Map<string, Set<Handler>>();

function emit(event: string, payload: unknown) {
  listeners.get(event)?.forEach((h) => (h as (p: unknown) => void)(payload));
}

export async function mockListen<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  const set = listeners.get(event) ?? new Set<Handler>();
  set.add(handler as Handler);
  listeners.set(event, set);
  return () => set.delete(handler as Handler);
}

let counter = 0;
const id = (prefix: string) => `${prefix}${(Date.now() + counter++).toString(16)}`;

// A few fake captures with generated pictures.
const PALETTE = ["#A0522D", "#F2A541", "#4C8DA8", "#6B8F4E", "#8E5A9B", "#C9584C"];
export function mockImageUrl(capture: Capture): string {
  const hue = PALETTE[Math.abs(hash(capture.id)) % PALETTE.length];
  const { width: w, height: h } = capture;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hue}"/>` +
    `<stop offset="1" stop-color="#fff6e9"/></linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#g)"/>` +
    `<rect x="${w * 0.08}" y="${h * 0.12}" width="${w * 0.84}" height="${h * 0.1}" rx="10" fill="#fff" fill-opacity=".75"/>` +
    `<rect x="${w * 0.08}" y="${h * 0.3}" width="${w * 0.5}" height="${h * 0.5}" rx="10" fill="#fff" fill-opacity=".55"/>` +
    `<rect x="${w * 0.62}" y="${h * 0.3}" width="${w * 0.3}" height="${h * 0.23}" rx="10" fill="#fff" fill-opacity=".55"/>` +
    `<text x="${w / 2}" y="${h * 0.92}" font-family="Segoe UI, sans-serif" font-size="${h * 0.06}" text-anchor="middle" fill="#4A2F22">${escapeXml(capture.name)}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function fake(name: string, minutesAgo: number, width: number, height: number, title?: string): Capture {
  const cid = id("c");
  return {
    id: cid,
    name,
    createdAt: Date.now() - minutesAgo * 60_000,
    file: `images/${cid}.png`,
    thumbnail: null,
    width,
    height,
    sourceWindowTitle: title ?? null,
    annotations: null,
  };
}

let session: Session = {
  id: "mock-session",
  createdAt: Date.now() - 3_600_000,
  updatedAt: Date.now(),
  groups: [
    {
      id: "g1",
      name: "Group 1",
      order: 0,
      captures: [
        fake("Capture 1", 42, 1920, 1080, "Visual Studio Code"),
        fake("Capture 2", 31, 1280, 720, "Settings"),
        fake("Capture 3", 12, 800, 600),
        fake("Error dialog", 3, 640, 360, "Snipmunk"),
      ],
    },
    { id: "g2", name: "Group 2", order: 0, captures: [fake("Capture 5", 1, 1024, 768)] },
  ],
};
session.groups[1].order = 1;

let settings: Settings = { ...defaultSettings };

function updated(change: (s: Session) => void): Session {
  const next: Session = JSON.parse(JSON.stringify(session));
  change(next);
  next.updatedAt = Date.now();
  session = next;
  emit("session-changed", session);
  return session;
}

function findCapture(s: Session, captureId: string) {
  for (const g of s.groups) {
    const i = g.captures.findIndex((c) => c.id === captureId);
    if (i >= 0) return { group: g, index: i };
  }
  throw { code: "not_found", message: `capture ${captureId}` };
}

function findGroup(s: Session, groupId: string) {
  const g = s.groups.find((x) => x.id === groupId);
  if (!g) throw { code: "not_found", message: `group ${groupId}` };
  return g;
}

function cleanName(name: unknown): string {
  const n = String(name ?? "").trim();
  if (!n) throw { code: "invalid", message: "the name is empty" };
  return n.slice(0, 80);
}

let groupNumber = 2;

export async function mockInvoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = ((): unknown => {
    switch (cmd) {
      case "get_settings":
        return settings;
      case "set_settings":
        settings = { ...settings, ...(args.patch as Partial<Settings>) };
        emit("settings-changed", settings);
        return settings;
      case "open_settings":
        window.open("?window=settings", "snipmunk-settings", "width=620,height=640");
        return null;
      case "start_capture":
      case "shortcut_fired":
      case "capture_set_delay":
      case "set_active_group":
      case "open_url":
      case "capture_cancel":
      case "capture_finish":
      case "capture_overlay_ready":
      case "toast_open":
      case "toast_close":
      case "capture_set_mode":
        return null;
      case "capture_overlay_info":
        return null;
      case "get_hotkey_status":
        return { state: "ok", shortcut: settings.captureHotkey, message: "" };
      case "check_shortcut": {
        const text = String(args.text ?? "");
        const valid = /^(ctrl|alt|shift|win)(\+(ctrl|alt|shift|win))*\+\w+$/i.test(text.replace(/\s/g, ""));
        return {
          valid,
          error: valid ? null : "this is not a shortcut",
          canonical: valid ? text.replace(/\s+/g, "") : null,
          warning: /^alt\+printscreen$/i.test(text.replace(/\s/g, "")) ? "windows" : null,
        };
      }
      case "quit_app":
      case "close_action":
      case "set_maximize_rect":
        return null;
      case "get_current_session":
        return session;
      case "new_session":
        groupNumber = 1;
        return updated((s) => {
          s.id = id("s");
          s.createdAt = Date.now();
          s.groups = [{ id: id("g"), name: "Group 1", order: 0, captures: [] }];
        });
      case "create_group":
        return updated((s) => {
          groupNumber++;
          const name = String(args.name ?? "").trim() || `Group ${groupNumber}`;
          s.groups.push({ id: id("g"), name, order: s.groups.length, captures: [] });
        });
      case "rename_group":
        return updated((s) => {
          findGroup(s, args.groupId as string).name = cleanName(args.name);
        });
      case "delete_group":
        return updated((s) => {
          if (s.groups.length <= 1)
            throw { code: "invalid", message: "the last group cannot be deleted" };
          const g = findGroup(s, args.groupId as string);
          s.groups = s.groups.filter((x) => x !== g);
          s.groups.forEach((x, i) => (x.order = i));
        });
      case "rename_capture":
        return updated((s) => {
          const { group, index } = findCapture(s, args.captureId as string);
          group.captures[index].name = cleanName(args.name);
        });
      case "delete_capture":
        return updated((s) => {
          const { group, index } = findCapture(s, args.captureId as string);
          group.captures.splice(index, 1);
        });
      case "reorder_captures":
        return updated((s) => {
          const g = findGroup(s, args.groupId as string);
          const ids = args.captureIds as string[];
          const byId = new Map(g.captures.map((c) => [c.id, c]));
          if (ids.length !== g.captures.length || ids.some((i) => !byId.has(i)))
            throw { code: "invalid", message: "the list does not match the group" };
          g.captures = ids.map((i) => byId.get(i)!);
        });
      case "move_capture_to_group":
        return updated((s) => {
          const target = findGroup(s, args.groupId as string);
          const { group, index } = findCapture(s, args.captureId as string);
          const [capture] = group.captures.splice(index, 1);
          const at = Math.min((args.index as number | null) ?? target.captures.length, target.captures.length);
          target.captures.splice(at, 0, capture);
        });
      default:
        throw { code: "unknown_command", message: cmd };
    }
  })();
  return result as T;
}
