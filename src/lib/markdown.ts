/**
 * Just enough Markdown for a chat reply, parsed into data rather than HTML.
 *
 * Models answer in Markdown whether asked to or not, and a reply full of
 * literal asterisks and fences is hard to read in a 300px panel. But a reply is
 * also text from a third party - and, with web tools on, text a web page may
 * have steered - so nothing here produces markup. The panel renders these
 * tokens with ordinary Svelte elements, which escape everything, and a link is
 * only ever `http(s)`.
 *
 * Tolerant of a reply that is still arriving: an unclosed fence is a code block
 * holding what has come so far, rather than a paragraph that snaps into code
 * when the closing fence lands.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'link'; text: string; href: string };

export type Block =
  | { kind: 'para'; inlines: Inline[] }
  | { kind: 'heading'; level: number; inlines: Inline[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'quote'; inlines: Inline[] }
  | { kind: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { kind: 'rule' };

const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*|__[^_\n]+?__)|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])|(?<![\w*])\*([^*\s][^*\n]*?)\*(?![\w*])|(?<![\w])_([^_\s][^_\n]*?)_(?![\w])/g;

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const push = (token: Inline) => {
    const prev = out.at(-1);
    if (token.kind === 'text' && prev?.kind === 'text') prev.text += token.text;
    else out.push(token);
  };
  for (const m of source.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) push({ kind: 'text', text: source.slice(last, at) });
    if (m[1]) push({ kind: 'code', text: m[1].slice(1, -1) });
    else if (m[2]) push({ kind: 'bold', text: m[2].slice(2, -2) });
    else if (m[3] && m[4]) push({ kind: 'link', text: m[3], href: m[4] });
    else if (m[5]) push({ kind: 'link', text: m[5], href: m[5] });
    else if (m[6]) push({ kind: 'italic', text: m[6] });
    else if (m[7]) push({ kind: 'italic', text: m[7] });
    last = at + m[0].length;
  }
  if (last < source.length) push({ kind: 'text', text: source.slice(last) });
  return out;
}

const FENCE = /^\s*(```|~~~)\s*([\w+#.-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function cells(line: string): Inline[][] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => parseInline(cell.trim()));
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];

  const flush = () => {
    if (para.length) blocks.push({ kind: 'para', inlines: parseInline(para.join('\n')) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;

    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const marker = fence[1] as string;
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] as string).trim().startsWith(marker)) {
        body.push(lines[i] as string);
        i++;
      }
      blocks.push({ kind: 'code', lang: fence[2] ?? '', text: body.join('\n') });
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', level: (heading[1] ?? '#').length, inlines: parseInline(heading[2] ?? '') });
      continue;
    }

    if (RULE.test(line)) {
      flush();
      blocks.push({ kind: 'rule' });
      continue;
    }

    const next = lines[i + 1];
    if (line.includes('|') && next !== undefined && TABLE_SEP.test(next)) {
      flush();
      const header = cells(line);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && (lines[i] as string).includes('|') && (lines[i] as string).trim()) {
        rows.push(cells(lines[i] as string));
        i++;
      }
      i--;
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = bullet ? null : ORDERED.exec(line);
    if (bullet || ordered) {
      flush();
      const isOrdered = !!ordered;
      const items: Inline[][] = [];
      const pattern = isOrdered ? ORDERED : BULLET;
      let j = i;
      let current: string[] = [];
      for (; j < lines.length; j++) {
        const row = lines[j] as string;
        const m = pattern.exec(row);
        if (m) {
          if (current.length) items.push(parseInline(current.join(' ')));
          current = [m[1] ?? ''];
        } else if (row.trim() && /^\s{2,}/.test(row) && current.length) {
          // An indented continuation of the item above.
          current.push(row.trim());
        } else {
          break;
        }
      }
      if (current.length) items.push(parseInline(current.join(' ')));
      blocks.push({ kind: 'list', ordered: isOrdered, items });
      i = j - 1;
      continue;
    }

    if (line.startsWith('>')) {
      flush();
      const quoted: string[] = [];
      while (i < lines.length && (lines[i] as string).startsWith('>')) {
        quoted.push((lines[i] as string).replace(/^>\s?/, ''));
        i++;
      }
      i--;
      blocks.push({ kind: 'quote', inlines: parseInline(quoted.join('\n')) });
      continue;
    }

    para.push(line);
  }
  flush();
  return blocks;
}

/** The reply with its Markdown removed, for places that show one line of it. */
export function plainText(source: string): string {
  return source
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/[*_`#>|]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
