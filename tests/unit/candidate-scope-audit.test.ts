import { describe, it, expect } from "vitest";
import {
  E_OUT_OF_SCOPE,
  E_OUT_OF_SCOPE_UNTRACKED,
  auditCandidateScope,
  describeCandidateViolations,
  isDaemonManaged,
  parseDiffNameStatus,
  parsePorcelainStatus,
  parseRawDiffSpecialKinds,
  unquoteGitPath,
  CandidateScopeViolationError,
  type CandidateChangeEntry,
} from "../../daemon/pipeline/candidate-scope-audit";
import type { FileSystemScope } from "../../src/lib/scope";

const SAMPLE_SCOPE: FileSystemScope = {
  writable_paths: ["src/**", "tests/**"],
  readonly_paths: ["package.json", "docs/**"],
  strictly_forbidden_paths: [".env*"],
};

describe("TASK-P0.2 / 全量候选变更审计 (Candidate Scope Audit)", () => {
  describe("unquoteGitPath 路径解码", () => {
    it("未加引号的普通路径直接返回", () => {
      expect(unquoteGitPath("src/index.ts")).toBe("src/index.ts");
      expect(unquoteGitPath("file with spaces.txt")).toBe(
        "file with spaces.txt",
      );
    });

    it("正确解析标准转义符（双引号、换行、制表符、斜杠）", () => {
      expect(unquoteGitPath('"src/hello\\"world.ts"')).toBe(
        'src/hello"world.ts',
      );
      expect(unquoteGitPath('"path\\twith\\ttab"')).toBe("path\twith\ttab");
      expect(unquoteGitPath('"path\\\\backslash"')).toBe("path\\backslash");
    });

    it("正确解码 UTF-8 八进制转义（中文与特殊字符）", () => {
      // "文件.txt" 的 UTF-8 编码为 \346\226\207\344\273\266
      const raw = '"\\346\\226\\207\\344\\273\\266.txt"';
      expect(unquoteGitPath(raw)).toBe("文件.txt");
    });
  });

  describe("isDaemonManaged 白名单判定", () => {
    it("正确放行 node_modules/ 与 .stagent/ 目录及子路径", () => {
      expect(isDaemonManaged("node_modules/foo/index.js")).toBe(true);
      expect(isDaemonManaged("node_modules/")).toBe(true);
      expect(isDaemonManaged(".stagent/worktrees/task-1")).toBe(true);
      expect(isDaemonManaged(".stagent/")).toBe(true);
    });

    it("不误放行类似名称的普通源文件或目录", () => {
      expect(isDaemonManaged("src/node_modules_mock.ts")).toBe(false);
      expect(isDaemonManaged("src/node_modules/foo.ts")).toBe(false);
      expect(isDaemonManaged("scripts/.stagent-helper.sh")).toBe(false);
    });
  });

  describe("parsePorcelainStatus 全状态解析", () => {
    it("全量覆盖 M/A/D/R/C/T/U/?? 各种状态码", () => {
      const output = [
        " M src/modified.ts",
        "M  src/staged-modified.ts",
        "A  src/added.ts",
        " D docs/deleted.md",
        "D  docs/staged-deleted.md",
        "R  scripts/old.sh -> src/new.sh",
        "C  template.txt -> src/copy.txt",
        "T  bin/symlink",
        "UU src/conflict.ts",
        "?? untracked.txt",
        '?? "file with spaces.txt"',
        '?? "\\346\\226\\207\\344\\273\\266.txt"',
      ].join("\n");

      const entries = parsePorcelainStatus(output);
      expect(entries).toHaveLength(12);

      const byPath = new Map(entries.map((e) => [e.path, e]));

      expect(byPath.get("src/modified.ts")?.changeType).toBe("MODIFIED");
      expect(byPath.get("src/staged-modified.ts")?.changeType).toBe("MODIFIED");
      expect(byPath.get("src/added.ts")?.changeType).toBe("ADDED");
      expect(byPath.get("docs/deleted.md")?.changeType).toBe("DELETED");
      expect(byPath.get("docs/staged-deleted.md")?.changeType).toBe("DELETED");

      const rename = byPath.get("src/new.sh");
      expect(rename?.changeType).toBe("RENAMED");
      expect(rename?.oldPath).toBe("scripts/old.sh");

      const copy = byPath.get("src/copy.txt");
      expect(copy?.changeType).toBe("COPIED");
      expect(copy?.oldPath).toBe("template.txt");

      expect(byPath.get("bin/symlink")?.changeType).toBe("TYPE_CHANGED");
      expect(byPath.get("bin/symlink")?.specialKind).toBe("symlink");

      expect(byPath.get("src/conflict.ts")?.changeType).toBe("UNMERGED");
      expect(byPath.get("untracked.txt")?.changeType).toBe("UNTRACKED");
      expect(byPath.get("file with spaces.txt")?.changeType).toBe("UNTRACKED");
      expect(byPath.get("文件.txt")?.changeType).toBe("UNTRACKED");
    });
  });

  describe("parseDiffNameStatus 解析", () => {
    it("解析 git diff --name-status 制表符分隔输出（含 -M 重命名与复制评分）", () => {
      const diffOutput = [
        "M\tsrc/index.ts",
        "A\tsrc/utils.ts",
        "D\tsrc/legacy.ts",
        "R100\tdocs/old.md\tsrc/docs.md",
        "C090\tbase.json\tsrc/new.json",
        "T\tbin/tool",
        "U\tsrc/merge.ts",
      ].join("\n");

      const entries = parseDiffNameStatus(diffOutput);
      expect(entries).toHaveLength(7);

      const byPath = new Map(entries.map((e) => [e.path, e]));
      expect(byPath.get("src/index.ts")?.changeType).toBe("MODIFIED");
      expect(byPath.get("src/utils.ts")?.changeType).toBe("ADDED");
      expect(byPath.get("src/legacy.ts")?.changeType).toBe("DELETED");

      const rename = byPath.get("src/docs.md");
      expect(rename?.changeType).toBe("RENAMED");
      expect(rename?.oldPath).toBe("docs/old.md");

      const copy = byPath.get("src/new.json");
      expect(copy?.changeType).toBe("COPIED");
      expect(copy?.oldPath).toBe("base.json");

      expect(byPath.get("bin/tool")?.changeType).toBe("TYPE_CHANGED");
      expect(byPath.get("bin/tool")?.specialKind).toBe("symlink");
      expect(byPath.get("src/merge.ts")?.changeType).toBe("UNMERGED");
    });
  });

  describe("parseRawDiffSpecialKinds 特殊类型提取", () => {
    it("提取 mode-only（仅权限变更）、symlink 与 submodule", () => {
      const raw = [
        ":100644 100755 e69de29 e69de29 M\tscripts/exec.sh",
        ":000000 120000 0000000 0231def A\tsrc/symlink",
        ":160000 160000 aaaaaaa bbbbbbb M\tvendor/submodule",
      ].join("\n");

      const map = parseRawDiffSpecialKinds(raw);
      expect(map.get("scripts/exec.sh")).toBe("mode-only");
      expect(map.get("src/symlink")).toBe("symlink");
      expect(map.get("vendor/submodule")).toBe("submodule");
    });
  });

  describe("auditCandidateScope 纯函数核心判定", () => {
    it("授权范围内的所有操作正常通过", () => {
      const entries: CandidateChangeEntry[] = [
        {
          path: "src/a.ts",
          changeType: "MODIFIED",
          rawStatus: "M",
          source: "WORKTREE",
        },
        {
          path: "tests/b.test.ts",
          changeType: "ADDED",
          rawStatus: "A",
          source: "WORKTREE",
        },
        {
          path: "src/old.ts",
          changeType: "DELETED",
          rawStatus: "D",
          source: "WORKTREE",
        },
        {
          path: "src/new.ts",
          oldPath: "src/prev.ts",
          changeType: "RENAMED",
          rawStatus: "R",
          source: "WORKTREE",
        },
      ];

      const report = auditCandidateScope(
        entries,
        SAMPLE_SCOPE,
        "PRE_EXECUTION",
      );
      expect(report.passed).toBe(true);
      expect(report.violations).toHaveLength(0);
      expect(report.inspected).toContain("src/a.ts");
    });

    it("修改已跟踪文件超出 Scope：判定越界", () => {
      const entries: CandidateChangeEntry[] = [
        {
          path: "package.json",
          changeType: "MODIFIED",
          rawStatus: "M",
          source: "WORKTREE",
        },
      ];
      const report = auditCandidateScope(
        entries,
        SAMPLE_SCOPE,
        "PRE_EXECUTION",
      );
      expect(report.passed).toBe(false);
      expect(report.violations).toHaveLength(1);
      expect(report.violations[0]?.path).toBe("package.json");
      expect(report.violations[0]?.reason).toBe("NOT_WRITABLE");
      expect(report.violations[0]?.changeType).toBe("MODIFIED");
    });

    it("删除 Scope 外文件：按原路径判定越界", () => {
      const entries: CandidateChangeEntry[] = [
        {
          path: "docs/readme.md",
          changeType: "DELETED",
          rawStatus: "D",
          source: "WORKTREE",
        },
      ];
      const report = auditCandidateScope(
        entries,
        SAMPLE_SCOPE,
        "PRE_EXECUTION",
      );
      expect(report.passed).toBe(false);
      expect(report.violations).toHaveLength(1);
      expect(report.violations[0]?.path).toBe("docs/readme.md");
      expect(report.violations[0]?.reason).toBe("NOT_WRITABLE");
      expect(report.violations[0]?.changeType).toBe("DELETED");
    });

    it("重命名判定（选 A 裁决）：源路径与目标路径均必须在 writable_paths 内", () => {
      // 场景 1：源路径在 Scope 内，目标路径超出 Scope -> 越界（防范将 Scope 内文件移到外面）
      const entries1: CandidateChangeEntry[] = [
        {
          path: "docs/stolen.md",
          oldPath: "src/valid.ts",
          changeType: "RENAMED",
          rawStatus: "R",
          source: "WORKTREE",
        },
      ];
      const report1 = auditCandidateScope(
        entries1,
        SAMPLE_SCOPE,
        "PRE_EXECUTION",
      );
      expect(report1.passed).toBe(false);
      expect(report1.violations.some((v) => v.path === "docs/stolen.md")).toBe(
        true,
      );

      // 场景 2：源路径超出 Scope（如 .env），目标路径在 Scope 内 -> 越界（防范偷盗只读/未授权文件并篡改删除原文件）
      const entries2: CandidateChangeEntry[] = [
        {
          path: "src/env.txt",
          oldPath: ".env.production",
          changeType: "RENAMED",
          rawStatus: "R",
          source: "WORKTREE",
        },
      ];
      const report2 = auditCandidateScope(
        entries2,
        SAMPLE_SCOPE,
        "PRE_EXECUTION",
      );
      expect(report2.passed).toBe(false);
      expect(report2.violations.some((v) => v.path === ".env.production")).toBe(
        true,
      );
      expect(
        report2.violations.some((v) => v.reason === "FORBIDDEN_PATH"),
      ).toBe(true);

      // 场景 3：源路径与目标路径均在 Scope 内 -> 放行
      const entries3: CandidateChangeEntry[] = [
        {
          path: "src/components/Button.tsx",
          oldPath: "src/Button.tsx",
          changeType: "RENAMED",
          rawStatus: "R",
          source: "WORKTREE",
        },
      ];
      const report3 = auditCandidateScope(
        entries3,
        SAMPLE_SCOPE,
        "PRE_EXECUTION",
      );
      expect(report3.passed).toBe(true);
    });

    it("严格受保护路径（strictly_forbidden_paths）优先报 FORBIDDEN_PATH", () => {
      const entries: CandidateChangeEntry[] = [
        {
          path: ".env.local",
          changeType: "UNTRACKED",
          rawStatus: "??",
          source: "WORKTREE",
        },
      ];
      const report = auditCandidateScope(
        entries,
        SAMPLE_SCOPE,
        "POST_VERIFICATION",
      );
      expect(report.passed).toBe(false);
      expect(report.violations[0]?.reason).toBe("FORBIDDEN_PATH");
    });

    it("node_modules/ 与 .stagent/ 路径被白名单自动放行", () => {
      const entries: CandidateChangeEntry[] = [
        {
          path: "node_modules/.cache/test.json",
          changeType: "MODIFIED",
          rawStatus: "M",
          source: "WORKTREE",
        },
        {
          path: ".stagent/worktrees/task-1/state.json",
          changeType: "ADDED",
          rawStatus: "A",
          source: "WORKTREE",
        },
      ];
      const report = auditCandidateScope(entries, SAMPLE_SCOPE, "PRE_MERGE");
      expect(report.passed).toBe(true);
      expect(report.skipped).toContain("node_modules/.cache/test.json");
      expect(report.skipped).toContain(".stagent/worktrees/task-1/state.json");
    });

    it("保留 specialKind 标记（mode-only/symlink/submodule）", () => {
      const entries: CandidateChangeEntry[] = [
        {
          path: "scripts/deploy.sh",
          changeType: "MODIFIED",
          specialKind: "mode-only",
          rawStatus: "M",
          source: "WORKTREE",
        },
      ];
      const report = auditCandidateScope(
        entries,
        SAMPLE_SCOPE,
        "PRE_EXECUTION",
      );
      expect(report.passed).toBe(false);
      expect(report.violations[0]?.specialKind).toBe("mode-only");
    });
  });

  describe("describeCandidateViolations 白话报错", () => {
    it("清晰呈现违规数量、类型、特殊标记与引导指引", () => {
      const report = auditCandidateScope(
        [
          {
            path: "scripts/deploy.sh",
            changeType: "MODIFIED",
            specialKind: "mode-only",
            rawStatus: "M",
            source: "WORKTREE",
          },
          {
            path: "docs/readme.md",
            changeType: "DELETED",
            rawStatus: "D",
            source: "WORKTREE",
          },
        ],
        SAMPLE_SCOPE,
        "PRE_MERGE",
      );

      const msg = describeCandidateViolations(report);
      expect(msg).toContain("合并前检查发现 2 个未授权的改动");
      expect(msg).toContain("[mode-only] scripts/deploy.sh（修改）");
      expect(msg).toContain("docs/readme.md（删除）");
      expect(msg).toContain("writable_paths");
    });
  });

  describe("CandidateScopeViolationError 错误类型", () => {
    it("未跟踪文件使用 E_OUT_OF_SCOPE_UNTRACKED，跟踪文件变更使用 E_OUT_OF_SCOPE", () => {
      const reportUntracked = auditCandidateScope(
        [
          {
            path: "leak.txt",
            changeType: "UNTRACKED",
            rawStatus: "??",
            source: "WORKTREE",
          },
        ],
        SAMPLE_SCOPE,
        "PRE_EXECUTION",
      );
      const err1 = new CandidateScopeViolationError(reportUntracked);
      expect(err1.code).toBe(E_OUT_OF_SCOPE_UNTRACKED);

      const reportTracked = auditCandidateScope(
        [
          {
            path: "package.json",
            changeType: "MODIFIED",
            rawStatus: "M",
            source: "WORKTREE",
          },
        ],
        SAMPLE_SCOPE,
        "PRE_EXECUTION",
      );
      const err2 = new CandidateScopeViolationError(reportTracked);
      expect(err2.code).toBe(E_OUT_OF_SCOPE);
    });
  });
});
