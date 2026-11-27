import { Fragment, type ReactNode } from "react";

/**
 * A small Markdown renderer for Nova's answers: headings, paragraphs, bold/italic/code/links, bullet and
 * numbered lists, tables, quotes, code blocks and rules. Builds React elements (no raw HTML), so model output
 * can't inject markup; links open in a new tab and only http(s), mailto and in-app paths are allowed.
 */
export function Markdown({ text }: { text: string }) {
  return <div className="nova-md space-y-2.5 text-[14px] leading-relaxed">{blocks(text)}</div>;
}

function inline(s: string, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  // order matters: code first (no formatting inside), then links, bold, italic
  const re = /(`[^`]+`)|(\[([^\]]+)\]\(([^)\s]+)\))|(\*\*([^*]+)\*\*|__([^_]+)__)|(\*([^*\s][^*]*?)\*|_([^_\s][^_]*?)_)/g;
  let last = 0, m: RegExpExecArray | null, n = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[1]) out.push(<code key={k} className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[12.5px]">{m[1].slice(1, -1)}</code>);
    else if (m[2]) {
      const href = m[4];
      const safe = /^(https?:\/\/|mailto:|\/)/i.test(href);
      out.push(safe ? <a key={k} href={href} target={href.startsWith("/") ? undefined : "_blank"} rel="noopener noreferrer" className="font-medium text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent">{inline(m[3], k)}</a> : <Fragment key={k}>{m[3]}</Fragment>);
    } else if (m[5]) out.push(<strong key={k} className="font-semibold text-foreground">{inline(m[6] ?? m[7], k)}</strong>);
    else if (m[8]) out.push(<em key={k}>{inline(m[9] ?? m[10], k)}</em>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

const cells = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

function blocks(text: string): ReactNode[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: ReactNode[] = [];
  let i = 0, key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const k = key++;
    // fenced code
    if (/^```/.test(line.trim())) {
      const body: string[] = []; i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) body.push(lines[i++]);
      i++;
      out.push(<pre key={k} className="overflow-x-auto rounded-lg bg-surface-muted p-3 font-mono text-[12.5px] leading-relaxed">{body.join("\n")}</pre>);
      continue;
    }
    // heading
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      out.push(lvl <= 2
        ? <h3 key={k} className="pt-1 text-[15px] font-semibold text-foreground">{inline(h[2], `h${k}`)}</h3>
        : <h4 key={k} className="pt-0.5 text-[14px] font-semibold text-foreground">{inline(h[2], `h${k}`)}</h4>);
      i++; continue;
    }
    // rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { out.push(<hr key={k} className="border-hairline" />); i++; continue; }
    // table: header row, separator row, body rows
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const head = cells(line); i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push(
        <div key={k} className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-[13px]">
            <thead className="bg-surface-sunken"><tr>{head.map((c, j) => <th key={j} className="border-b border-border px-2.5 py-1.5 text-left font-semibold">{inline(c, `th${k}${j}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri} className="border-b border-hairline last:border-0">{head.map((_, j) => <td key={j} className="px-2.5 py-1.5 align-top tabular-nums">{inline(r[j] ?? "", `td${k}${ri}${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    // quote
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ""));
      out.push(<blockquote key={k} className="border-l-2 border-accent/40 pl-3 text-secondary">{inline(body.join(" "), `q${k}`)}</blockquote>);
      continue;
    }
    // lists (one level, with indented continuation lines and fenced code blocks inside an item)
    const bullet = /^\s*[-*+]\s+/, numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      // each item is a sequence of text runs and code blocks, kept in the order written
      type Part = { kind: "text" | "code"; value: string };
      const items: Part[][] = [];
      const addText = (s: string) => { const it = items[items.length - 1]; const last = it[it.length - 1]; if (last?.kind === "text") last.value += ` ${s}`; else it.push({ kind: "text", value: s }); };
      while (i < lines.length && (bullet.test(lines[i]) || numbered.test(lines[i]) || ((/^\s{2,}\S/.test(lines[i]) || /^```/.test(lines[i].trim())) && items.length))) {
        if (/^```/.test(lines[i].trim())) {
          // a code block belonging to the current item: keep it whole (no inline formatting)
          const body: string[] = []; i++;
          while (i < lines.length && !/^```/.test(lines[i].trim())) body.push(lines[i++].replace(/^\s{1,4}/, ""));
          i++;
          items[items.length - 1].push({ kind: "code", value: body.join("\n") });
          continue;
        }
        if (bullet.test(lines[i]) || numbered.test(lines[i])) items.push([{ kind: "text", value: lines[i].replace(ordered ? numbered : bullet, "").replace(bullet, "") }]);
        else addText(lines[i].trim());
        i++;
      }
      const Tag = ordered ? "ol" : "ul";
      out.push(<Tag key={k} className={ordered ? "list-decimal space-y-1 pl-5 marker:text-muted" : "list-disc space-y-1 pl-5 marker:text-muted"}>{items.map((parts, j) => (
        <li key={j}>
          {parts.map((p, pi) => p.kind === "code"
            ? <pre key={pi} className="my-1.5 overflow-x-auto rounded-lg bg-surface-muted p-3 font-mono text-[12.5px] leading-relaxed">{p.value}</pre>
            : <span key={pi}>{inline(p.value, `l${k}${j}${pi}`)}</span>)}
        </li>
      ))}</Tag>);
      continue;
    }
    // paragraph: consecutive plain lines
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[i]) && !(lines[i].includes("|") && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? ""))) para.push(lines[i++]);
    if (!para.length) { para.push(lines[i++]); }
    out.push(<p key={k}>{para.flatMap((p, j) => (j ? [<br key={`b${j}`} />, ...inline(p, `p${k}${j}`)] : inline(p, `p${k}${j}`)))}</p>);
  }
  return out;
}
