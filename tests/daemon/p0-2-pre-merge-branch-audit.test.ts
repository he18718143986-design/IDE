import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";

import { ContractStore } from "../../daemon/pipeline/contract-store";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import { MergeGateError, squashMerge } from "../../daemon/pipeline/merger";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import { git } from "../helpers/git";
import type { EvidenceBundle } from "../../src/lib/evidence.schema";
import { CandidateScopeViolationError } from "../../daemon/pipeline/candidate-scope-audit";

/**
 * TASK-P0.2：全量候选变更（Candidate Changes）Scope 审计守卫集成测试。
 *
 * 核心验证：
 * 1. PRE_MERGE 阶段即使工作树（Worktree）完全干净，但任务分支已 commit 了超出 Scope 的修改/新增/删除/重命名，
 *    仍被 `git diff --name-status base...HEAD` 复核拦截，抛出 `MergeGateError`（code `E_OUT_OF_SCOPE`）；
 * 2. 裁决选 A（新旧路径均审）在真实合并门禁中严格生效；
 * 3. 授权范围内的正常 commit 在 PRE_MERGE 阶段顺利通过并合入主分支；
 * 4. PRE_EXECUTION / POST_VERIFICATION 执行侧针对已跟踪文件的修改/越界同样即时阻断并产出 BLOCKED 证据。
 */

describe("TASK-P0.2 / 全量候选变更门禁集成测试", () => {
  let repo: string;
  let store: ContractStore;
  let orchestrator: ContractOrchestrator;

  const makeContract = (
    title: string,
    options?: { command?: string },
  ): SoftwareContract => {
    const draft = createContractDraft({
      title,
      description: "p0.2 candidate scope test",
      acceptanceCriteria: ["pass"],
      writablePaths: ["src/**"],
      readonlyPaths: ["package.json", "docs/**"],
      strictlyForbiddenPaths: [".env*"],
      commands: [
        {
          alias: "verify",
          executable: "node",
          args: ["-e", options?.command ?? "process.exit(0)"],
          expected_exit_code: 0,
          timeout_seconds: 30,
        },
      ],
    });
    return softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "PENDING_APPROVAL",
      approval: { status: "PENDING_REVIEW" },
    });
  };

  /** 走完 approve → 写入合法代码 → execute，获得 AUDITED 状态与 PASSED 证据 */
  async function reachAudited(title: string, options?: { command?: string }) {
    const contract = makeContract(title, options);
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");
    const worktree = path.join(
      repo,
      ".stagent",
      "worktrees",
      `task-${contract.contract_id}`,
    );
    fs.writeFileSync(
      path.join(worktree, "src", "feature.ts"),
      "export const feature = 1;\n",
    );
    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.contract.lifecycle_state).toBe("AUDITED");
    return { contract, worktree, evidence: outcome.evidence };
  }

  function readEvidence(contractId: string): EvidenceBundle | null {
    const dir = path.join(repo, ".stagent", "evidence");
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir).filter((f) => f.includes(contractId));
    if (files.length === 0) return null;
    return JSON.parse(
      fs.readFileSync(
        path.join(dir, files[files.length - 1] as string),
        "utf8",
      ),
    );
  }

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-p0-2-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(repo, "docs", "readme.md"), "# Docs\n");
    fs.writeFileSync(path.join(repo, "package.json"), '{"name":"test"}\n');
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);

    store = new ContractStore(repo);
    orchestrator = new ContractOrchestrator({ repoRoot: repo });
  });

  afterEach(() => {
    safeRmSync(repo);
  });

  describe("PRE_MERGE 分支 diff vs base 越权拦截（Worktree 干净但 commit 越权）", () => {
    it("分支已提交了对只读文件（package.json）的修改：Worktree 干净仍阻断合并", async () => {
      const { contract, worktree, evidence } = await reachAudited(
        "tampered package.json",
      );
      const headBefore = git(repo, ["rev-parse", "HEAD"]).trim();

      // 在 worktree 中越界修改 package.json 并 commit，使 worktree 保持干净
      fs.writeFileSync(
        path.join(worktree, "package.json"),
        '{"name":"tampered"}\n',
      );
      git(worktree, ["add", "package.json"]);
      git(worktree, ["commit", "-m", "stealthily edit package.json"]);

      // 验证此时 worktree 确实是 clean 的
      const status = git(worktree, ["status", "--porcelain"]);
      expect(status.trim()).toBe("");

      // 触发合并：PRE_MERGE 必须通过分支 diff 抓获该越权变更并阻断
      let caughtError: unknown;
      try {
        await squashMerge({
          repoRoot: repo,
          contractId: contract.contract_id,
          evidence,
          reviewer: "tina",
        });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(MergeGateError);
      const gateErr = caughtError as MergeGateError;
      expect(gateErr.code).toBe("E_OUT_OF_SCOPE");
      expect(gateErr.message).toContain("package.json");

      // 合并未发生
      expect(git(repo, ["rev-parse", "HEAD"]).trim()).toBe(headBefore);
      expect(store.get(contract.contract_id)?.lifecycle_state).toBe("AUDITED");
    });

    it("分支已提交了删除 Scope 外文件（docs/readme.md）：阻断合并", async () => {
      const { contract, worktree, evidence } =
        await reachAudited("deleted docs");
      const headBefore = git(repo, ["rev-parse", "HEAD"]).trim();

      // 在 worktree 中删除 docs/readme.md 并 commit
      fs.unlinkSync(path.join(worktree, "docs", "readme.md"));
      git(worktree, ["add", "docs/readme.md"]);
      git(worktree, ["commit", "-m", "delete docs"]);

      let caughtError: unknown;
      try {
        await squashMerge({
          repoRoot: repo,
          contractId: contract.contract_id,
          evidence,
          reviewer: "tina",
        });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(MergeGateError);
      const gateErr = caughtError as MergeGateError;
      expect(gateErr.code).toBe("E_OUT_OF_SCOPE");
      expect(gateErr.message).toContain("docs/readme.md");
      expect(git(repo, ["rev-parse", "HEAD"]).trim()).toBe(headBefore);
    });

    it("重命名判定（选 A 裁决）：将 Scope 外文件 rename 进 Scope 内已 commit 仍阻断", async () => {
      const { contract, worktree, evidence } = await reachAudited(
        "rename out-of-scope source",
      );
      const headBefore = git(repo, ["rev-parse", "HEAD"]).trim();

      // 将 docs/readme.md 重命名为 src/readme.md 并提交
      git(worktree, ["mv", "docs/readme.md", "src/readme.md"]);
      git(worktree, ["commit", "-m", "steal docs into src"]);

      let caughtError: unknown;
      try {
        await squashMerge({
          repoRoot: repo,
          contractId: contract.contract_id,
          evidence,
          reviewer: "tina",
        });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(MergeGateError);
      const gateErr = caughtError as MergeGateError;
      expect(gateErr.code).toBe("E_OUT_OF_SCOPE");
      // 报错必须指出源路径 docs/readme.md 越界
      expect(gateErr.message).toContain("docs/readme.md");
      expect(git(repo, ["rev-parse", "HEAD"]).trim()).toBe(headBefore);
    });

    it("合法范围内的修改在 PRE_MERGE 阶段顺利通过并合入主分支", async () => {
      const { contract, evidence } = await reachAudited("valid merge");
      const headBefore = git(repo, ["rev-parse", "HEAD"]).trim();

      const result = await squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence,
        reviewer: "tina",
      });

      expect(result.commitSha).toBeTruthy();
      expect(git(repo, ["rev-parse", "HEAD"]).trim()).not.toBe(headBefore);
      expect(
        fs.readFileSync(path.join(repo, "src", "feature.ts"), "utf-8").replace(/\r\n/g, "\n"),
      ).toBe("export const feature = 1;\n");
      expect(store.get(contract.contract_id)?.lifecycle_state).toBe("MERGED");
    });
  });

  describe("执行侧全量候选变更阻断与证据留痕", () => {
    it("PRE_EXECUTION 阶段：工作区预先存在已跟踪文件的修改即时阻断并产出 BLOCKED 证据", async () => {
      const contract = makeContract("pre-execution modification");
      store.save(contract);
      await orchestrator.approve(contract.contract_id, "tina");
      const worktree = path.join(
        repo,
        ".stagent",
        "worktrees",
        `task-${contract.contract_id}`,
      );

      // 在执行前直接修改 package.json（已跟踪文件）
      fs.writeFileSync(
        path.join(worktree, "package.json"),
        '{"name":"tampered"}\n',
      );

      await expect(orchestrator.execute(contract.contract_id)).rejects.toThrow(
        CandidateScopeViolationError,
      );

      // 合同处于 EXECUTING 且证据为 BLOCKED
      const loaded = store.get(contract.contract_id);
      expect(loaded?.lifecycle_state).toBe("EXECUTING");

      const ev = readEvidence(contract.contract_id);
      expect(ev?.verdict.status).toBe("BLOCKED");
      expect(ev?.verdict.reason_code).toBe("SCOPE_VIOLATION");
      expect(ev?.verdict.summary).toContain("package.json");
      expect(ev?.verdict.can_merge).toBe(false);
      expect(ev?.scope_audit.passed).toBe(false);
    });

    it("POST_VERIFICATION 阶段：验收测试脚本篡改了 Scope 外已跟踪文件被阻断", async () => {
      // 验收脚本会在运行过程中篡改 package.json
      const command = `require('fs').writeFileSync('package.json', 'hacked')`;
      const contract = makeContract("post-verify modification", { command });
      store.save(contract);
      await orchestrator.approve(contract.contract_id, "tina");
      const worktree = path.join(
        repo,
        ".stagent",
        "worktrees",
        `task-${contract.contract_id}`,
      );
      fs.writeFileSync(
        path.join(worktree, "src", "feature.ts"),
        "export const feature = 1;\n",
      );

      await expect(orchestrator.execute(contract.contract_id)).rejects.toThrow(
        CandidateScopeViolationError,
      );

      const ev = readEvidence(contract.contract_id);
      expect(ev?.verdict.status).toBe("BLOCKED");
      expect(ev?.verdict.reason_code).toBe("SCOPE_VIOLATION");
      expect(ev?.verdict.summary).toContain("package.json");
    });
  });
});
