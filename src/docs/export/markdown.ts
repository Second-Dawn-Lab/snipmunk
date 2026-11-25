// A guide as Markdown (no React, no DOM).

import { imageKey, pmDoc, type ExportData, type PmNode } from "./html";

export interface MarkdownOptions {
  /** Steps as a numbered list, or as "## Step N" headings. */
  steps: "list" | "headings";
  frontMatter: boolean;
  /** Where a picture is: a relative path in the images folder, a data address, or `null` to leave pictures out. */
  image: (key: string) => string | null;
  /** The word for "Step N" headings. */
  stepWord: (n: number) => string;
}

const escText = (s: string): string => s.replace(/([\\`*_[\]<>])/g, "\\$1").replace(/^(\s*)([#>+-]|\d+\.)(\s)/gm, "$1\\$2$3");
/** A link target: spaces and parentheses must not end it. */
const target = (u: string): string => u.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");

function inline(node: PmNode, md: MarkdownOptions): string {
  if (node.type === "hardBreak") return "  \n";
  if (node.type !== "text") return (node.content ?? []).map((c) => inline(c, md)).join("");
  let t = escText(node.text ?? "");
  const marks = node.marks ?? [];
  const lead = /^\s*/.exec(t)![0];
  const tail = /\s*$/.exec(t.slice(lead.length))![0];
  t = t.slice(lead.length, t.length - tail.length);
  if (!t) return lead + tail;
  if (marks.some((m) => m.type === "bold")) t = `**${t}**`;
  if (marks.some((m) => m.type === "italic")) t = `*${t}*`;
  if (marks.some((m) => m.type === "strike")) t = `~~${t}~~`;
  const link = marks.find((m) => m.type === "link")?.attrs?.href;
  if (typeof link === "string" && /^(https?:\/\/|mailto:)/i.test(link)) t = `[${t}](${target(link)})`;
  return lead + t + tail;
}

function table(node: PmNode, md: MarkdownOptions): string {
  const rows = (node.content ?? []).map((r) => (r.content ?? []).map((c) => (c.content ?? []).map((p) => inline(p, md)).join(" ").replace(/\n/g, " ").replace(/\|/g, "\\|")));
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
  const header = node.content?.[0]?.content?.some((c) => c.type === "tableHeader");
  const head = header ? rows[0] : Array.from({ length: width }, () => "");
  return [line(head), line(Array.from({ length: width }, () => "---")), ...rows.slice(header ? 1 : 0).map(line)].join("\n");
}

/** Block nodes as Markdown, separated by blank lines. */
export function blockToMarkdown(node: PmNode, md: MarkdownOptions): string {
  const blocks = (n: PmNode) => (n.content ?? []).map((c) => blockToMarkdown(c, md)).filter((s) => s !== "").join("\n\n");
  switch (node.type) {
    case "doc":
      return blocks(node);
    case "paragraph":
      return inline(node, md);
    case "heading":
      return `${"#".repeat(Math.min(6, (Number(node.attrs?.level) || 1) + 1))} ${inline(node, md)}`;
    case "bulletList":
    case "orderedList": {
      const ordered = node.type === "orderedList";
      const start = Number(node.attrs?.start) || 1;
      return (node.content ?? [])
        .map((li, i) => {
          const mark = ordered ? `${start + i}. ` : "- ";
          const body = (li.content ?? []).map((c) => blockToMarkdown(c, md)).join("\n");
          return mark + body.split("\n").join(`\n${" ".repeat(mark.length)}`);
        })
        .join("\n");
    }
    case "blockquote":
      return blocks(node)
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
    case "horizontalRule":
      return "---";
    case "table":
      return table(node, md);
    case "image": {
      const src = md.image(imageKey(node.attrs ?? {}));
      return src ? `![${escText(String(node.attrs?.alt ?? ""))}](${target(src)})` : "";
    }
    default:
      return inline(node, md);
  }
}

export function exportMarkdown(d: ExportData, md: MarkdownOptions): string {
  const out: string[] = [];
  if (md.frontMatter) out.push(`---\ntitle: ${JSON.stringify(d.doc.title)}\ndate: ${JSON.stringify(d.date)}\n---`);
  out.push(`# ${escText(d.doc.title)}`);
  let n = 0;
  let list: string[] = [];
  const flush = () => {
    if (list.length) out.push(list.join("\n\n"));
    list = [];
  };
  for (const b of d.doc.blocks) {
    if (b.type !== "step") {
      flush();
      const text = blockToMarkdown(pmDoc(b.doc), md);
      if (text) out.push(text);
      continue;
    }
    if (!b.numberHidden) n++;
    const parts = b.text ?? d.steps.get(b.n)?.text ?? [];
    const text = parts.map((p) => (p.b && p.t.trim() ? `**${escText(p.t)}**` : escText(p.t))).join("");
    const src = md.image(b.id);
    const rest: string[] = [];
    if (src && d.pictures.has(b.id)) rest.push(`![${b.numberHidden ? text.replace(/[*[\]]/g, "") : md.stepWord(n)}](${target(src)})`);
    if (d.options.descriptions && b.desc) {
      const desc = blockToMarkdown(pmDoc(b.desc), md);
      if (desc.trim()) rest.push(desc);
    }
    if (b.numberHidden) {
      // A step without a number is plain text between the numbered ones.
      flush();
      out.push([text, ...rest].join("\n\n"));
    } else if (md.steps === "headings") {
      flush();
      out.push([`## ${md.stepWord(n)}`, text, ...rest].join("\n\n"));
    } else {
      const mark = d.options.numbers ? `${n}. ` : "- ";
      const pad = " ".repeat(mark.length);
      list.push([mark + text, ...rest.map((r) => pad + r.split("\n").join(`\n${pad}`))].join("\n\n"));
    }
  }
  flush();
  return out.join("\n\n") + "\n";
}
