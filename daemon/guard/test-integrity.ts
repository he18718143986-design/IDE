/**
 * 测试文件防篡改（Test Integrity Guard）。
 *
 * 威胁模型：Worker（LLM）修复失败时的经典作弊路径是修改测试断言、
 * 把 it() 改成 it.skip()，让验证命令退出码归零、Evidence 显示 PASSED。
 * 退出码只证明「命令跑完了」，不证明「测试没被考生自己改过」。
 *
 * 规则：
 * 1. 测试文件的写操作要求 writable_paths 中存在「显式指向测试代码」的模式
 *    （如 tests/**、**／*.test.ts）；仅被 src/** 这类宽泛模式覆盖不够。
 * 2. 即使合同显式授权了测试文件，Evidence 也必须记录 tests_modified: true，
 *    供核销人在控制台高亮预警中人工复核。
 */

const TEST_DIR_SEGMENTS = new Set(["tests", "test", "__tests__"]);
const TEST_FILE_PATTERN = /\.(test|spec)\.[^/]+$/;

function normalize(relPath: string): string {
  return relPath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^(\.\/|\/)+/, "");
}

/** 判断相对路径是否为测试文件（tests/、test/、__tests__/ 目录或 *.test.* / *.spec.* 文件） */
export function isTestPath(relPath: string): boolean {
  const normalized = normalize(relPath);
  if (!normalized) return false;
  const segments = normalized.split("/");
  if (
    segments
      .slice(0, -1)
      .some((segment) => TEST_DIR_SEGMENTS.has(segment.toLowerCase()))
  ) {
    return true;
  }
  const basename = segments[segments.length - 1] ?? "";
  return TEST_FILE_PATTERN.test(basename.toLowerCase());
}

/**
 * writable_paths 中是否存在「显式指向测试代码」的模式。
 * 仅 `src/**` 这类宽泛模式不算显式授权；必须出现 tests/test/__tests__
 * 目录段，或 .test. / .spec. 文件模式。
 */
export function scopeExplicitlyIncludesTests(writablePaths: string[]): boolean {
  return writablePaths.some((raw) => {
    const pattern = normalize(raw).toLowerCase();
    if (!pattern) return false;
    if (pattern.includes(".test.") || pattern.includes(".spec.")) return true;
    return /(^|\/)(tests?|__tests__)(\/|$)/.test(pattern);
  });
}

/** 语言标签：决定断言与 skip/only 识别规则 */
export type TestIntegrityLang = "ts" | "js" | "tsx" | "jsx" | "py" | "go" | "rs";

export interface TestWeakeningResult {
  weakened: boolean;
  reasons: string[];
  base_assertion_count: number;
  candidate_assertion_count: number;
}

const ASSERTION_PATTERNS: Record<string, RegExp[]> = {
  ts: [/\bexpect\s*\(/g, /\bassert\s*\(/g, /\bassert\.\w+\s*\(/g],
  js: [/\bexpect\s*\(/g, /\bassert\s*\(/g, /\bassert\.\w+\s*\(/g],
  tsx: [/\bexpect\s*\(/g, /\bassert\s*\(/g],
  jsx: [/\bexpect\s*\(/g, /\bassert\s*\(/g],
  py: [
    /\bassert\b/g,
    /\bself\.assert\w+\s*\(/g,
    /\bpytest\.raises\s*\(/g,
  ],
  go: [/\b(?:assert|require|assertEq)\w*\s*\(/g, /\bt\.(?:Fatal|Error|Fail)/g],
  rs: [/\bassert(?:_eq|_ne|_lt|_gt)?!\s*\(/g],
};

const WEAKEN_INSERT_PATTERNS: RegExp[] = [
  /\bit\.only\s*\(/g,
  /\btest\.only\s*\(/g,
  /\bdescribe\.only\s*\(/g,
  /\bfit\s*\(/g,
  /\bfdescribe\s*\(/g,
  /\bit\.skip\s*\(/g,
  /\btest\.skip\s*\(/g,
  /\bdescribe\.skip\s*\(/g,
  /\bxit\s*\(/g,
  /\bxdescribe\s*\(/g,
  /\bxtest\s*\(/g,
  /@pytest\.mark\.skip(?:if)?\b/g,
  /\bpytest\.skip\s*\(/g,
  /\bt\.Skip\s*\(/g,
];

function countMatches(text: string, patterns: RegExp[]): number {
  let total = 0;
  for (const pattern of patterns) {
    const flags = pattern.flags.includes("g")
      ? pattern.flags
      : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, flags);
    const hits = text.match(re);
    total += hits?.length ?? 0;
  }
  return total;
}

function collectInsertHits(text: string): string[] {
  const hits: string[] = [];
  for (const pattern of WEAKEN_INSERT_PATTERNS) {
    const flags = pattern.flags.includes("g")
      ? pattern.flags
      : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, flags);
    const found = text.match(re);
    if (found && found.length > 0) {
      hits.push(...found);
    }
  }
  return hits;
}

/**
 * 比对基线与候选测试源码，判定是否削弱门禁（verification-strategy §5）。
 *
 * - 断言调用数下降 → weakened
 * - 新增 .skip / .only / xit / @pytest.mark.skip 等 → weakened
 * - 只增断言 → 不 weakened
 */
export function detectTestWeakening(
  baseText: string,
  candidateText: string,
  lang: TestIntegrityLang,
): TestWeakeningResult {
  const key = lang in ASSERTION_PATTERNS ? lang : "ts";
  const patterns = ASSERTION_PATTERNS[key] ?? ASSERTION_PATTERNS["ts"]!;
  const baseCount = countMatches(baseText, patterns);
  const candidateCount = countMatches(candidateText, patterns);
  const reasons: string[] = [];

  if (candidateCount < baseCount) {
    reasons.push(
      `assertion_count_dropped:${baseCount}->${candidateCount}`,
    );
  }

  const baseInserts = collectInsertHits(baseText);
  const candidateInserts = collectInsertHits(candidateText);
  if (candidateInserts.length > baseInserts.length) {
    reasons.push(
      `inserted_skip_or_only:${baseInserts.length}->${candidateInserts.length}`,
    );
  }

  return {
    weakened: reasons.length > 0,
    reasons,
    base_assertion_count: baseCount,
    candidate_assertion_count: candidateCount,
  };
}
