/** 与 GitHub 渲染一致的最小 Markdown 工具：只认 ``` / ~~~ 围栏，不做完整解析。 */

export interface FencedBlock {
  info: string;
  body: string;
  /** 围栏开头所在行（1 起） */
  line: number;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;

/** 每一行是否落在围栏代码块内（含围栏行本身）。 */
export function fenceMask(lines: string[]): boolean[] {
  const mask: boolean[] = [];
  let open: string | null = null;
  for (const line of lines) {
    const m = FENCE.exec(line);
    if (open === null) {
      if (m) {
        open = m[1]!;
        mask.push(true);
        continue;
      }
      mask.push(false);
    } else {
      mask.push(true);
      if (m && m[1]!.startsWith(open[0]!) && m[1]!.length >= open.length) {
        if (m[2]!.trim() === "") open = null;
      }
    }
  }
  return mask;
}

export function fencedBlocks(content: string): FencedBlock[] {
  const lines = content.split(/\r?\n/);
  const blocks: FencedBlock[] = [];
  let open: {
    fence: string;
    info: string;
    line: number;
    body: string[];
  } | null = null;
  lines.forEach((line, i) => {
    const m = FENCE.exec(line);
    if (open === null) {
      if (m) open = { fence: m[1]!, info: m[2]!.trim(), line: i + 1, body: [] };
      return;
    }
    if (
      m &&
      m[2]!.trim() === "" &&
      m[1]!.startsWith(open.fence[0]!) &&
      m[1]!.length >= open.fence.length
    ) {
      blocks.push({
        info: open.info,
        body: open.body.join("\n"),
        line: open.line,
      });
      open = null;
      return;
    }
    open.body.push(line);
  });
  return blocks;
}

/**
 * github-slugger 的规则：转小写，删掉字母 / 数字 / 连接符 / 空格 / 连字符以外的字符，
 * 空格换成连字符。标题里的链接取其文字，HTML 标签整体去掉。
 */
export function githubSlug(heading: string): string {
  const text = heading
    .replace(/<[^>]+>/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim()
    .toLowerCase();
  return text.replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "").replace(/ /g, "-");
}

export function collectAnchors(content: string): Set<string> {
  const lines = content.split(/\r?\n/);
  const mask = fenceMask(lines);
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  lines.forEach((line, i) => {
    if (mask[i]) return;
    const h = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const base = githubSlug(h[1]!);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      anchors.add(n === 0 ? base : `${base}-${n}`);
    }
    for (const a of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) {
      anchors.add(a[1]!);
    }
  });
  return anchors;
}

export interface MarkdownLink {
  target: string;
  line: number;
}

/** 正文里的 `[text](target)`；跳过围栏与行内代码。 */
export function collectLinks(content: string): MarkdownLink[] {
  const lines = content.split(/\r?\n/);
  const mask = fenceMask(lines);
  const links: MarkdownLink[] = [];
  lines.forEach((line, i) => {
    if (mask[i]) return;
    const prose = line.replace(/`[^`]*`/g, "");
    for (const m of prose.matchAll(
      /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g,
    )) {
      links.push({ target: m[1]!, line: i + 1 });
    }
  });
  return links;
}
