import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { safeRmSync } from "../helpers/tmp";
import { collectWorktreeEvidence } from "../../daemon/graph/evidence-collector";
import {
  E_FILES_NOT_WRITTEN,
  evaluateIllumination,
} from "../../daemon/graph/illumination-verifier";
import type { TaskNode } from "../../src/lib/graph/task-graph";
import {
  expandTargetFilesOnDisk,
  isGlobPattern,
  pathSatisfiesTargetPattern,
  patternIsSatisfied,
} from "../../daemon/graph/target-file-match";

let repoRoot: string;

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-j58-"));
});

afterEach(() => {
  try {
    safeRmSync(repoRoot);
  } catch {
    // ignore: sandbox policy may block recursive deletion
  }
});

function isolationWorktree(contractId: string): string {
  const worktree = path.join(
    repoRoot,
    ".stagent",
    "worktrees",
    `task-${contractId}`,
  );
  fs.mkdirSync(worktree, { recursive: true });
  return worktree;
}

function commandNode(targetFiles: string[]): TaskNode {
  return {
    node_id: "n1",
    title: "示例",
    kind: "CODE_MODIFICATION",
    depends_on: [],
    functional_area: "auth",
    target_files: targetFiles,
    verification_mode: "COMMAND",
    verification_commands: ["test"],
    state: "RUNNING",
    executed_at: null,
    commit_sha: null,
  };
}

describe("判定侧纯函数（不读盘）", () => {
  it("字面路径只做精确相等", () => {
    expect(
      pathSatisfiesTargetPattern(
        "src/auth/migration.ts",
        "src/auth/migration.ts",
      ),
    ).toBe(true);
    expect(
      pathSatisfiesTargetPattern("src/other.ts", "src/auth/migration.ts"),
    ).toBe(false);
    expect(isGlobPattern("src/auth/migration.ts")).toBe(false);
  });

  it("glob 用同一匹配规则，命中真实相对路径而非字面模式", () => {
    expect(isGlobPattern("src/**")).toBe(true);
    expect(pathSatisfiesTargetPattern("src/auth.js", "src/**")).toBe(true);
    expect(pathSatisfiesTargetPattern("package.json", "src/**")).toBe(false);
    expect(patternIsSatisfied(["src/auth.js", "index.html"], "src/**")).toBe(
      true,
    );
    expect(patternIsSatisfied(["package.json"], "src/**")).toBe(false);
  });
});

describe("采证侧磁盘展开（含未跟踪文件）", () => {
  it("J58-P1: glob 匹配到施工树实文件（含未跟踪）不报 E_FILES_NOT_WRITTEN，files_written 与哈希是真实路径而非字面 src/**", async () => {
    const contractId = "contract_j58_p1";
    const worktree = isolationWorktree(contractId);
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
    fs.writeFileSync(path.join(worktree, "src", "auth.js"), "export {}\n");
    fs.mkdirSync(path.join(worktree, "node_modules", "pkg"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(worktree, "node_modules", "pkg", "index.js"),
      "module.exports = 1;\n",
    );

    const expanded = expandTargetFilesOnDisk(worktree, ["src/**"]);
    expect(expanded).toEqual(["src/auth.js"]);
    expect(expanded).not.toContain("src/**");

    const evidence = await collectWorktreeEvidence({
      repoRoot,
      contractId,
      targetFiles: ["src/**"],
      scope: { writable_paths: ["src/**"] },
    });
    expect(evidence.worktree_available).toBe(true);
    expect(evidence.files_written).toEqual(["src/auth.js"]);
    expect(evidence.files_written).not.toContain("src/**");
    expect(evidence.file_hashes["src/auth.js"]).toMatch(/^[0-9a-f]{64}$/);
    expect(evidence.file_hashes["src/**"]).toBeUndefined();

    const result = evaluateIllumination({
      node: commandNode(["src/**"]),
      files_written: evidence.files_written,
      file_hashes: evidence.file_hashes,
      scope_valid: true,
      command_results: [{ alias: "test", exit_code: 0 }],
      commit_sha: "c0ffee1234567890",
      now: "2026-11-25T10:00:00.000Z",
    });
    expect(result.illuminated).toBe(true);
    if (result.illuminated) {
      expect(result.fingerprints.map((fp) => fp.path)).toEqual(["src/auth.js"]);
    }
  });

  it("J58-P2: glob 零匹配仍 E_FILES_NOT_WRITTEN，白话含原始模式且错误码与用词不变", async () => {
    const contractId = "contract_j58_p2";
    const worktree = isolationWorktree(contractId);
    fs.writeFileSync(path.join(worktree, "package.json"), "{}\n");

    const evidence = await collectWorktreeEvidence({
      repoRoot,
      contractId,
      targetFiles: ["src/**"],
      scope: { writable_paths: ["src/**", "package.json"] },
    });
    expect(evidence.files_written).toEqual([]);

    const result = evaluateIllumination({
      node: commandNode(["src/**"]),
      files_written: evidence.files_written,
      file_hashes: evidence.file_hashes,
      scope_valid: true,
      command_results: [{ alias: "test", exit_code: 0 }],
      commit_sha: "c0ffee1234567890",
      now: "2026-11-25T10:00:00.000Z",
    });
    expect(result.illuminated).toBe(false);
    if (!result.illuminated) {
      expect(result.code).toBe(E_FILES_NOT_WRITTEN);
      expect(result.message).toBe("节点 n1 的目标文件尚未写入: src/**");
    }
  });
});
