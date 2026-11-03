import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * TASK-P.1/C.5 静态闸门（用户要求，C.5 验收后加固）：
 * 全仓只有 daemon/worker/cli-host 可以启动外部进程；cli-host 之外的历史遗留启动点
 * 逐一列白（后续逐步迁移，迁移完成一条就从白名单删一条）。
 *
 * 判定口径（宁可误报，不可漏报）：
 * 1. 任何一行出现字符串 `child_process`（import / 动态 import / require / createRequire 全算）；
 * 2. 任何一行出现 spawn/spawnSync/execFile/execFileSync/execSync/fork 调用；
 * 3. 任何一行出现 `.exec(`（仅对已登记的 RegExp 误报行做行级豁免）；
 * 4. 任何一行出现 process.binding(、Bun.spawn(、execa、cross-spawn。
 *
 * 修复方式二选一：
 *  1. 把进程启动挪进 daemon/worker/cli-host/（推荐）；
 *  2. 确属受控例外：在 LEGACY_ALLOWLIST 增加文件（写理由与迁移计划），
 *     或对已知误报在 LINE_ALLOWLIST 增加「文件 + 行特征 + 理由」。
 */

const REPO_ROOT = path.resolve(__dirname, "../..");
const SCAN_DIRS = ["daemon", "src", "bin"];
const SOURCE_EXTS = new Set([".ts", ".tsx", ".mts", ".mjs", ".js", ".cjs"]);

interface LegacyAllowance {
  file: string;
  module: string;
  reason: string;
}

const LEGACY_ALLOWLIST: LegacyAllowance[] = [
  {
    file: "daemon/git/worktree-manager.ts",
    module: "daemon/git",
    reason: "git 命令封装 execGit（worktree/分支操作）",
  },
  {
    file: "daemon/editor/launcher.ts",
    module: "daemon/editor",
    reason: "调起外部编辑器",
  },
  {
    file: "daemon/editor/repo-delete.ts",
    module: "daemon/editor",
    reason:
      "TASK-C.10h：仅 execFileSync 调用 /usr/bin/trash 或 osascript 移到废纸篓（固定系统二进制，非任意用户命令）",
  },
  {
    file: "daemon/editor/repo-fs-ops.ts",
    module: "daemon/editor",
    reason:
      "TASK-C.10i：仅 execFileSync 调用 open/xdg-open/explorer 在文件管理器中显示（固定系统二进制）",
  },
  {
    file: "daemon/server.ts",
    module: "daemon/server",
    reason: "Diff API 的 git diff（execFileSync）",
  },
  {
    file: "daemon/runner/process-tree.ts",
    module: "daemon/runner",
    reason: "Windows 进程树回收（taskkill/tasklist）",
  },
  {
    file: "daemon/runner/command-runner.ts",
    module: "daemon/runner",
    reason: "合同验证命令执行",
  },
  {
    file: "daemon/pipeline/orchestrator.ts",
    module: "daemon/pipeline",
    reason: "worktree 依赖安装与 git 同步",
  },
  {
    file: "bin/stagent.ts",
    module: "bin",
    reason: "CLI 唤起浏览器",
  },
  {
    file: "daemon/core/open-workspace.ts",
    module: "daemon/core",
    reason:
      "TASK-D.1c：仅 spawn 本仓 stagent start 以唤起最近项目 Daemon（非任意用户命令；路径须已在最近列表）",
  },
  {
    file: "daemon/baseline/os-sandbox.ts",
    module: "daemon/baseline",
    reason:
      "TASK-C.14e：sandbox-exec / unshare 只读断网证明（固定系统二进制，非任意用户命令）",
  },
  {
    file: "daemon/git/ensure-git-repo.ts",
    module: "daemon/git",
    reason:
      "TASK-H.4：仅 execFileSync 调用 git init（固定 git 二进制，需用户确认）",
  },
  {
    file: "daemon/pipeline/records-export-cleanup.ts",
    module: "daemon/pipeline",
    reason:
      "TASK-H.8：仅 spawnSync zip 打包 .stagent/records/ 脱敏导出（不上云）",
  },
  {
    file: "daemon/release/release-manager.ts",
    module: "daemon/release",
    reason:
      "TASK-L.15：仅 execFileSync/spawnSync 调用 git log|show|archive 与 tar，做发布前 sha 核对与产物打包（固定二进制）",
  },
  {
    file: "daemon/trace/why.ts",
    module: "daemon/trace",
    reason:
      "TASK-L.13：仅 execFile 调用 git log/show 读取 stagent trailer 与方案绑定（只读追溯，固定 git 二进制）",
  },
  {
    file: "daemon/knowledge/check-knowledge.ts",
    module: "daemon/knowledge",
    reason:
      "TASK-L.18：仅 execFileSync 调用 git rev-parse/show 核对知识库引用是否漂移（KNOWLEDGE_DRIFT 取证）",
  },
  {
    file: "daemon/vault/keychain-backend.ts",
    module: "daemon/vault",
    reason:
      "OQ-REL-1 决议 A：系统钥匙串后端，仅 execFile/spawn 调用固定二进制 security（macOS）/ secret-tool（Linux），参数经白名单校验",
  },
];

const CLI_HOST_PREFIX = "daemon/worker/cli-host/";

/** 行级豁免：只豁免「确知是 RegExp.prototype.exec」的行，不豁免文件 */
const LINE_ALLOWLIST: Array<{
  file: string;
  pattern: RegExp;
  reason: string;
}> = [
  {
    file: "src/lib/terminal.ts",
    pattern: /SGR\.exec\(input\)/,
    reason: "RegExp.prototype.exec，非子进程调用",
  },
  {
    file: "daemon/supervisor/demo/demo-generator.ts",
    pattern: /\/\^#\\s\+\(\.\+\)\$\/\.exec\(line\)/,
    reason: "RegExp.prototype.exec，Markdown H1 解析（TASK-S.4）",
  },
  {
    file: "daemon/supervisor/demo/demo-generator.ts",
    pattern: /\/\^##\\s\+\(\.\+\)\$\/\.exec\(line\)/,
    reason: "RegExp.prototype.exec，Markdown H2 解析（TASK-S.4）",
  },
  {
    file: "daemon/supervisor/demo/demo-generator.ts",
    pattern: /\/\^\\s\*\[-\*\]\\s\+\(\.\+\)\$\/\.exec\(line\)/,
    reason: "RegExp.prototype.exec，Markdown 列表解析（TASK-S.4）",
  },
  {
    file: "daemon/baseline/dirty-check.ts",
    pattern: /\/\^\(\.\{2\}\)\\s\+\(\.\*\)\$\/\.exec\(line\)/,
    reason: "RegExp.prototype.exec，git porcelain 解析（TASK-H trim / dirty）",
  },
  {
    file: "daemon/baseline/sandbox-scanner.ts",
    pattern: /routeRe\.exec\(text\)/,
    reason: "RegExp.prototype.exec，路由线索提取（非子进程）",
  },
  {
    file: "daemon/baseline/sandbox-scanner.ts",
    pattern: /importRe\.exec\(text\)/,
    reason: "RegExp.prototype.exec，import 边计数（非子进程）",
  },
  {
    file: "daemon/worker/parse-worker-output.ts",
    pattern: /fence\.exec\(trimmed\)/,
    reason: "RegExp.prototype.exec，剥 markdown 围栏（TASK-H.1）",
  },
  {
    file: "daemon/trace/why.ts",
    pattern:
      /\/\^\(\[A-Za-z\]\[A-Za-z0-9-\]\*\):\\s\*\(\.\*\)\$\/\.exec\(line\)/,
    reason: "RegExp.prototype.exec，stagent trailer 键值解析（TASK-L.13）",
  },
  {
    file: "daemon/trace/why.ts",
    pattern: /\/scheme_item_ids:\\s\+\(\.\+\)\\s\*\$\/\.exec\(line\)/,
    reason: "RegExp.prototype.exec，scheme_item_ids 行解析（TASK-L.13）",
  },
  {
    file: "daemon/web-ingest/proxy.ts",
    pattern: /h1Regex\.exec\(html\)/,
    reason: "RegExp.prototype.exec，抽 HTML 一级标题（TASK-L.17a）",
  },
  {
    file: "src/lib/journey/artifact-projection.ts",
    pattern: /re\.exec\(line\.trim\(\)\)/,
    reason: "RegExp.prototype.exec，依赖清单逐行解析（TASK-J.6）",
  },
  {
    file: "daemon/release/active-live.ts",
    pattern: /传递引入 `node:child_process`/,
    reason:
      "文档注释引用模块名（说明为何刻意不 import release-manager），非真实导入",
  },
];

/** 明确的进程启动 API（排除 xxx.spawn( 这类同名方法） */
const SPAWN_CALL =
  /(?<![.\w])(?:spawn|spawnSync|execFile|execFileSync|execSync|fork)\s*\(/;
/** 恢复 .exec( 检测（含对象方法），靠行级豁免排除 RegExp 误报 */
const DOT_EXEC = /\.exec\s*\(/;
/**
 * 可静态证明的 RegExp 字面量调用：`/…/flags.exec(...)`。
 * 字面量正则不可能是子进程 API，因此无需逐行登记（减少白名单腐化）。
 */
const REGEX_LITERAL_EXEC = /\/(?:[^/\\\n]|\\.)+\/[a-z]*\.exec\s*\(/;
/** 需要禁止的第三方/运行时启动方式 */
const OTHER_LAUNCHERS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /process\s*\.\s*binding\s*\(/, label: "process.binding" },
  {
    pattern: /process\s*\[\s*["']binding["']\s*\]/,
    label: "process['binding']",
  },
  { pattern: /\bgetBuiltinModule\s*\(/, label: "getBuiltinModule" },
  { pattern: /\bBun\s*\.\s*spawn\s*\(/, label: "Bun.spawn" },
  { pattern: /\bexeca\b/, label: "execa" },
  { pattern: /["']cross-spawn["']/, label: "cross-spawn" },
];

function isLineAllowed(rel: string, line: string): boolean {
  return LINE_ALLOWLIST.some(
    (rule) => rule.file === rel && rule.pattern.test(line),
  );
}

/** 扫描一段源码，返回违规说明（空数组 = 干净） */
export function scanContent(rel: string, content: string): string[] {
  const violations: string[] = [];
  const lines = content.split("\n");
  lines.forEach((line, index) => {
    if (isLineAllowed(rel, line)) return;
    const where = `${rel}:${index + 1}`;
    if (line.includes("child_process")) {
      violations.push(
        `${where} 引用 child_process（import/require/动态导入均禁止）`,
      );
      return;
    }
    if (line.includes("worker_threads")) {
      violations.push(`${where} 引用 worker_threads（线程可间接执行命令）`);
      return;
    }
    for (const rule of OTHER_LAUNCHERS) {
      if (rule.pattern.test(line)) {
        violations.push(`${where} 使用 ${rule.label}`);
        return;
      }
    }
    if (SPAWN_CALL.test(line)) {
      violations.push(`${where} 调用进程启动 API`);
      return;
    }
    if (DOT_EXEC.test(line) && !REGEX_LITERAL_EXEC.test(line)) {
      violations.push(`${where} 调用 .exec(（未能证明是 RegExp）`);
    }
  });
  return violations;
}

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(abs, out);
    } else if (SOURCE_EXTS.has(path.extname(entry.name))) {
      out.push(abs);
    }
  }
}

function relOf(abs: string): string {
  return path.relative(REPO_ROOT, abs).split(path.sep).join("/");
}

describe("进程启动白名单（TASK-P.1 / C.5 加固）", () => {
  it("cli-host 与 7 个历史遗留模块之外，不得出现任何进程启动迹象", () => {
    const files: string[] = [];
    for (const dir of SCAN_DIRS) walk(path.join(REPO_ROOT, dir), files);

    const allowed = new Set(LEGACY_ALLOWLIST.map((a) => a.file));
    const offenders: string[] = [];

    for (const abs of files) {
      const rel = relOf(abs);
      if (rel.startsWith(CLI_HOST_PREFIX) || allowed.has(rel)) continue;
      offenders.push(...scanContent(rel, fs.readFileSync(abs, "utf8")));
    }

    expect(
      offenders,
      `只有 daemon/worker/cli-host 可以启动外部进程。违规点：\n` +
        offenders.map((f) => `  - ${f}`).join("\n") +
        `\n请挪进 cli-host，或在 LEGACY_ALLOWLIST / LINE_ALLOWLIST 登记理由。`,
    ).toEqual([]);
  });

  it.each([
    [
      "from 'child_process'（无 node: 前缀）",
      `import { exec } from 'child_process';`,
    ],
    [
      "import * as cp + cp.exec(",
      `import * as cp from "node:child_process";\ncp.exec("ls");`,
    ],
    ["动态 import", `const cp = await import("node:child_process");`],
    [
      "createRequire",
      `const require2 = createRequire(import.meta.url);\nconst cp = require2("child_process");`,
    ],
    ["process.binding", `const b = process.binding("spawn_sync");`],
    ["process['binding']", `const b = process['binding']("spawn_sync");`],
    [
      "getBuiltinModule",
      `const cp = process.getBuiltinModule("child_process");`,
    ],
    ["worker_threads", `import { Worker } from "node:worker_threads";`],
    ["Bun.spawn", `Bun.spawn(["ls", "-la"]);`],
    ["execa 导入", `import { execa } from "execa";`],
    ["cross-spawn 导入", `const spawn = require("cross-spawn");`],
    ["对象方法 .exec(", `child.exec("rm -rf /");`],
    ["无 import 直接 spawn", `spawn("ls", ["-la"]);`],
  ])("负向用例：%s 必须被拦截", (_name, code) => {
    expect(scanContent("daemon/example.ts", code).length).toBeGreaterThan(0);
  });

  it("正向对照：RegExp.exec 的已登记行不误报，普通代码不误报", () => {
    expect(
      scanContent(
        "src/lib/terminal.ts",
        `while ((match = SGR.exec(input)) !== null) {`,
      ),
    ).toEqual([]);
    expect(
      scanContent("daemon/example.ts", `const x = arr.filter(Boolean);`),
    ).toEqual([]);
  });

  it("白名单里的模块仍存在（迁移后请同步删除条目，避免白名单腐化）", () => {
    for (const item of LEGACY_ALLOWLIST) {
      expect(fs.existsSync(path.join(REPO_ROOT, item.file)), item.file).toBe(
        true,
      );
    }
  });

  it("保护清单模块自身零进程启动迹象", () => {
    const dir = path.join(REPO_ROOT, "daemon", "protection");
    const files = fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".ts"))
      .map((n) => ({
        rel: `daemon/protection/${n}`,
        content: fs.readFileSync(path.join(dir, n), "utf8"),
      }));
    for (const f of files) {
      expect(scanContent(f.rel, f.content)).toEqual([]);
    }
  });
});
