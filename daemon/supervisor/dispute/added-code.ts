/**
 * 新增代码行提取（TASK-S.5 · playtest-self-check §3.1 / 修 P-4）。
 *
 * Worker 能写注释与字符串字面量，这些「叙述」不得让「代码已触及」信号成立。
 * 本函数只保留统一 diff 中的新增行，并剔除字符串字面量与注释。
 *
 * 纯函数、零模型。这是启发式（不是完整词法分析）：
 * - 字符串按单行成对引号剥离；跨行模板字符串的中间行仍保留（偏保守）；
 * - 块注释跨行时按状态跳过；以 `*` 开头的行视为 JSDoc 续行；
 * - `#` 不作为注释符（TS 私有字段 `#x` 是代码）。
 */

const STRING_LITERAL = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /\/\/.*$/;

export function addedCodeLines(patch: string): string[] {
  const out: string[] = [];
  let inBlockComment = false;
  for (const raw of patch.split(/\r?\n/)) {
    if (!raw.startsWith("+") || raw.startsWith("+++")) continue;
    let work = raw.slice(1).replace(STRING_LITERAL, " ");
    if (inBlockComment) {
      const end = work.indexOf("*/");
      if (end < 0) continue;
      work = work.slice(end + 2);
      inBlockComment = false;
    }
    work = work.replace(BLOCK_COMMENT, " ");
    const open = work.indexOf("/*");
    if (open >= 0) {
      work = work.slice(0, open);
      inBlockComment = true;
    }
    work = work.replace(LINE_COMMENT, "");
    const trimmed = work.trim();
    if (
      trimmed === "" ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("<!--")
    ) {
      continue;
    }
    out.push(trimmed);
  }
  return out;
}
