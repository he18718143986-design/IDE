/**
 * 文本规范化与字素计数（锚定 / G-MATCH 共享）。
 * 从 evidence-anchor 抽出，避免 graveyard-match ↔ evidence-anchor 循环依赖。
 * 纯函数：零 node:* 导入、零时钟、零随机数、零网络。
 */

const SEGMENTER = new Intl.Segmenter("und", { granularity: "grapheme" });
const FORMAT_CHARS = /\u200B|\u200C|\u200D|\u2060|\uFEFF|\u00AD/g;
const WS = /\s/;

export interface NormalizedText {
  text: string;
  /** rawStart[i]：规范化第 i 个 UTF-16 码元对应的原文起始偏移 */
  rawStart: number[];
  /** rawEnd[i]：对应原文簇的结束偏移（不含） */
  rawEnd: number[];
}

export function graphemeCount(s: string): number {
  return Array.from(SEGMENTER.segment(s)).length;
}

/**
 * normalizeForAnchor：N1 换行统一 → N2 删零宽 → N3 按字素 NFKC → N4 空白折叠 → N5 去首尾空白。
 * 同时为原文构建偏移映射。
 */
export function normalizeForAnchor(raw: string): NormalizedText {
  const units: { ch: string; rs: number; re: number }[] = [];
  for (const { segment, index } of SEGMENTER.segment(raw)) {
    const base = segment === "\r\n" || segment === "\r" ? "\n" : segment;
    const kept = base.replace(FORMAT_CHARS, "");
    if (kept.length === 0) continue;
    const nfkc = kept.normalize("NFKC");
    const end = index + segment.length;
    for (let i = 0; i < nfkc.length; i++)
      units.push({ ch: nfkc.charAt(i), rs: index, re: end });
  }

  let text = "";
  const rawStart: number[] = [];
  const rawEnd: number[] = [];
  let lastWs = false;
  for (const u of units) {
    if (WS.test(u.ch)) {
      if (lastWs) {
        rawEnd[rawEnd.length - 1] = u.re;
        continue;
      }
      text += " ";
      rawStart.push(u.rs);
      rawEnd.push(u.re);
      lastWs = true;
    } else {
      text += u.ch;
      rawStart.push(u.rs);
      rawEnd.push(u.re);
      lastWs = false;
    }
  }

  let a = 0;
  let b = text.length;
  while (a < b && text[a] === " ") a++;
  while (b > a && text[b - 1] === " ") b--;
  return {
    text: text.slice(a, b),
    rawStart: rawStart.slice(a, b),
    rawEnd: rawEnd.slice(a, b),
  };
}
