/**
 * G-MATCH 唯一实现（SSOT §14.11 第 5 小节；TASK-J.18a）。
 * 自然语言通道：(b)(c)(d)；代码通道：artifact_keys / code_tokens。
 * 纯函数：零 node:* 导入、零时钟、零随机数、零网络。
 */
import { ALIAS_LEXICON, type AliasLexicon } from "./artifact-alias-lexicon";
import type { GateUnit } from "./artifact-projection";
import type { GraveyardEntry } from "./scheme-patch-types";
import { graphemeCount, normalizeForAnchor } from "./text-normalize";

/** 墓地 Dice 阈值（G-MATCH-NL-3）。字面量 0.75 只允许出现在本文件。 */
export const GRAVEYARD_DICE_THRESHOLD = 0.75;

/**
 * 代码通道停用词：通用编程词不进入 artifact_keys，只走自然语言弱通道。
 * G-MATCH-CODE / worker-graveyard-gate.md §2.4。
 */
export const CODE_STOPLIST: ReadonlySet<string> = new Set([
  "api",
  "data",
  "file",
  "user",
  "list",
  "page",
  "app",
  "src",
  "lib",
  "test",
  "util",
  "index",
  "main",
  "config",
  "server",
  "client",
  "db",
  "http",
  "json",
]);

export interface NlMatch {
  a: boolean;
  b: boolean;
  c: boolean;
  d: boolean;
}

export interface ArtifactMatch {
  via: "direct" | "alias" | "nl";
  key: string;
}

/** matchNormalize：规范化之后 ASCII 小写，删除全部空白与 \p{P}\p{S}。只用于指纹与关键词比较。 */
export function matchNormalize(s: string): string {
  return normalizeForAnchor(s)
    .text.replace(/[A-Z]/g, (c) => c.toLowerCase())
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

/**
 * lexemes：汉字连续段取相邻二元组（长度为 1 的段取单字）；ASCII 字母数字词（长度 ≥ 2）整体作为一个元素。
 * 排序去重后返回。
 */
export function lexemes(s: string): string[] {
  const t = normalizeForAnchor(s).text.replace(/[A-Z]/g, (c) =>
    c.toLowerCase(),
  );
  const out = new Set<string>();
  for (const m of t.matchAll(/[a-z0-9]{2,}/g)) out.add(m[0]);
  for (const m of t.matchAll(/\p{Script=Han}+/gu)) {
    const run = m[0];
    if (run.length === 1) out.add(run);
    else for (let i = 0; i < run.length - 1; i++) out.add(run.slice(i, i + 2));
  }
  return [...out].sort();
}

/** Dice 系数：2|A∩B| / (|A|+|B|)，按集合计；两侧皆空返回 0 */
export function dice(a: readonly string[], b: readonly string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  const denom = sa.size + sb.size;
  if (denom === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return (2 * inter) / denom;
}

/**
 * matchesTombstoneText：G-MATCH-NL-4。
 * (a) 仅在给出 targetId 且与 entry.item_ref.id 相同时为真；
 * (b) 指纹精确相等；(c) Dice ≥ 阈值；(d) 复活关键词（≥4 字素）子串命中。
 * 非 active 墓碑四分量皆假。
 */
export function matchesTombstoneText(
  text: string,
  entry: GraveyardEntry,
  opts?: { targetId?: string },
): NlMatch {
  if (entry.status !== "active")
    return { a: false, b: false, c: false, d: false };
  const a = Boolean(
    opts?.targetId !== undefined &&
    entry.item_ref &&
    opts.targetId === entry.item_ref.id,
  );
  const key = matchNormalize(text);
  const b = key.length > 0 && key === entry.fingerprint.key;
  const c =
    dice(lexemes(text), entry.fingerprint.lexemes) >= GRAVEYARD_DICE_THRESHOLD;
  let d = false;
  for (const rk of entry.revival_keys) {
    if (graphemeCount(rk) >= 4 && key.includes(rk)) {
      d = true;
      break;
    }
  }
  return { a, b, c, d };
}

/** 从词素 / revival_keys 抽出 ASCII 字母数字词（长度 ≥ 3） */
function asciiWordsFrom(s: string): string[] {
  const out: string[] = [];
  for (const m of s.toLowerCase().matchAll(/[a-z0-9]{3,}/g)) out.push(m[0]);
  return out;
}

/**
 * artifactKeys：G-MATCH-CODE-1。
 * 去重排序( lexemes∪revival_keys 中 ASCII 词 ≥3 且 ∉ CODE_STOPLIST ∪ 别名展开 )。
 */
export function artifactKeys(
  entry: GraveyardEntry,
  lexicon: AliasLexicon = ALIAS_LEXICON,
): string[] {
  const base = new Set<string>();
  for (const lex of entry.fingerprint.lexemes) {
    for (const w of asciiWordsFrom(lex)) {
      if (!CODE_STOPLIST.has(w)) base.add(w);
    }
  }
  for (const rk of entry.revival_keys) {
    for (const w of asciiWordsFrom(rk)) {
      if (!CODE_STOPLIST.has(w)) base.add(w);
    }
  }
  const out = new Set<string>(base);
  for (const w of base) {
    const aliases = lexicon[w];
    if (!aliases) continue;
    for (const a of aliases) out.add(a.toLowerCase());
  }
  return [...out].sort();
}

/** 不含别名展开的基键（用于 via: direct） */
function baseArtifactKeys(entry: GraveyardEntry): string[] {
  const base = new Set<string>();
  for (const lex of entry.fingerprint.lexemes) {
    for (const w of asciiWordsFrom(lex)) {
      if (!CODE_STOPLIST.has(w)) base.add(w);
    }
  }
  for (const rk of entry.revival_keys) {
    for (const w of asciiWordsFrom(rk)) {
      if (!CODE_STOPLIST.has(w)) base.add(w);
    }
  }
  return [...base].sort();
}

/**
 * codeTokens：G-MATCH-CODE-2。
 * 按非字母数字切分；驼峰与下划线再切分；小写；同时保留完整模块说明符小写原样。
 */
export function codeTokens(text: string): string[] {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  // 完整模块说明符：@scope/name、裸包名、go 风格 path
  for (const m of lower.matchAll(/@[a-z0-9-]+\/[a-z0-9._*-]+/g)) out.add(m[0]);
  for (const m of lower.matchAll(
    /\b[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9._-]+)+\b/g,
  ))
    out.add(m[0]);
  for (const m of lower.matchAll(/\b[a-z][a-z0-9_-]{1,}\b/g)) out.add(m[0]);

  // 非字母数字切分 + 驼峰 / 下划线
  const parts = text.split(/[^A-Za-z0-9]+/);
  for (const part of parts) {
    if (!part) continue;
    const camel = part.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/);
    for (const c of camel) {
      for (const u of c.split("_")) {
        const t = u.toLowerCase();
        if (t.length > 0) out.add(t);
      }
    }
  }
  return [...out];
}

/** 包名 / 模块说明符是否命中某个 artifact key（含 scope 通配） */
export function packageNameMatchesKey(pkg: string, key: string): boolean {
  const p = pkg.toLowerCase();
  const k = key.toLowerCase();
  if (p === k) return true;
  if (k.endsWith("/*")) {
    const prefix = k.slice(0, -1);
    if (p.startsWith(prefix)) return true;
  }
  const segments = p.split("/");
  const last = segments[segments.length - 1] ?? p;
  if (last === k) return true;
  if (p.startsWith("@") && segments.length >= 2 && segments[1] === k)
    return true;
  return false;
}

function findCodeHit(
  unitText: string,
  entry: GraveyardEntry,
  mode: "package" | "tokens",
): ArtifactMatch | null {
  if (entry.status !== "active") return null;
  const base = new Set(baseArtifactKeys(entry));
  const all = artifactKeys(entry);

  const hitKey = (keys: readonly string[]): string | null => {
    for (const k of keys) {
      if (mode === "package") {
        if (packageNameMatchesKey(unitText, k)) return k;
      } else {
        const tokens = new Set(codeTokens(unitText));
        if (tokens.has(k.toLowerCase())) return k;
        // scope 通配在 tokens 里：若 token 为 @mongodb-js/zstd 且 k 为 @mongodb-js/*
        if (k.endsWith("/*")) {
          const prefix = k.slice(0, -1).toLowerCase();
          for (const t of tokens) {
            if (t.startsWith(prefix) || packageNameMatchesKey(t, k)) return k;
          }
        }
      }
    }
    return null;
  };

  const direct = hitKey([...base]);
  if (direct !== null) return { via: "direct", key: direct };
  const aliased = hitKey(all.filter((k) => !base.has(k)));
  if (aliased !== null) return { via: "alias", key: aliased };
  // 也允许 all 中与 base 重叠但通过通配命中的别名键
  const any = hitKey(all);
  if (any !== null) {
    return { via: base.has(any) ? "direct" : "alias", key: any };
  }
  return null;
}

/**
 * matchArtifactUnit：G-MATCH-CODE-3（U-NL 走 NL 通道）。
 * 非 active → null。
 */
export function matchArtifactUnit(
  unit: GateUnit,
  entry: GraveyardEntry,
): ArtifactMatch | null {
  if (entry.status !== "active") return null;
  if (unit.kind === "U-NL") {
    const m = matchesTombstoneText(unit.text, entry);
    if (m.b || m.c || m.d) return { via: "nl", key: entry.fingerprint.key };
    return null;
  }
  if (
    unit.kind === "U-DEP" ||
    unit.kind === "U-CMD" ||
    unit.kind === "U-IMPORT"
  ) {
    return findCodeHit(unit.text, entry, "package");
  }
  if (unit.kind === "U-PATH" || unit.kind === "U-IDENT") {
    return findCodeHit(unit.text, entry, "tokens");
  }
  return null;
}
