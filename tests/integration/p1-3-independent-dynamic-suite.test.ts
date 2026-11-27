import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { safeRmSync } from "../helpers/tmp";
import { git } from "../helpers/git";
import { ContractStore } from "../../daemon/pipeline/contract-store";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import {
  squashMerge,
  MergeGateError,
  E_EVIDENCE_REVISION_MISMATCH,
  EVIDENCE_SIGNATURE_MISSING,
  EVIDENCE_SIGNATURE_INVALID,
} from "../../daemon/pipeline/merger";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import {
  generateEvidenceKeyPair,
  savePrivateKeyWith0400,
} from "../../daemon/pipeline/evidence-signer";
import { EvidenceIntegrityError } from "../../daemon/guard/evidence-integrity";

/**
 * TASK-P1.3 (P13-P1 & P13-P5):
 * P0 独立动态渗透套件（独立于既有测试，脱离单测自证循环）。
 *
 * 覆盖场景：
 * - TC-P0-1A: 合同版本过期阻断 (E_EVIDENCE_REVISION_MISMATCH)
 * - TC-P0-1B: 任务分支提交流转嫁接阻断 (E_EVIDENCE_STALE / E_EVIDENCE_FINGERPRINT_MISMATCH)
 * - TC-P0-1C: 非受控模式伪装阻断 (E_CANNOT_MERGE)
 * - TC-P0-2A: 未授权路径越界写入阻断 (SCOPE_VIOLATION / E_OUT_OF_SCOPE)
 * - TC-P0-2B: 重命名路径逃逸阻断 (新旧路径双审拦截)
 * - TC-P0-4A: 既有测试被篡改拦截并触发基线重跑 (E_TEST_BASELINE_REGRESSION)
 * - TC-P0-4B: 破坏基线环境逃逸失败关闭 (E_TEST_BASELINE_UNAVAILABLE)
 * - P13-P5: 独立动态验收防跨提交嫁接与 Git Trailer 绑定核验
 */

describe("TASK-P1.3 · P13-P1 & P13-P5 独立动态渗透与跨平台验收套件", () => {
  let repo: string;
  let keyDir: string;
  let privKeyPath: string;
  let pubKeyPath: string;
  let store: ContractStore;
  let orchestrator: ContractOrchestrator;
  let originalPrivEnv: string | undefined;
  let originalPubEnv: string | undefined;

  const worktreeOf = (contractId: string) =>
    path.join(repo, ".stagent", "worktrees", `task-${contractId}`);

  beforeEach(() => {
    // 独立私钥安全目录（模式 0400 隔离，远离 repo）
    keyDir = fs.mkdtempSync(path.join(os.tmpdir(), "p1-3-keys-"));
    const keyPair = generateEvidenceKeyPair();
    privKeyPath = path.join(keyDir, "evidence-priv.pem");
    pubKeyPath = path.join(keyDir, "evidence-pub.pem");
    savePrivateKeyWith0400(privKeyPath, keyPair.privateKeyPem);
    fs.writeFileSync(pubKeyPath, keyPair.publicKeyPem, "utf8");

    originalPrivEnv = process.env["STAGENT_EVIDENCE_PRIVATE_KEY_PATH"];
    originalPubEnv = process.env["STAGENT_EVIDENCE_PUBLIC_KEY_PATH"];
    process.env["STAGENT_EVIDENCE_PRIVATE_KEY_PATH"] = privKeyPath;
    process.env["STAGENT_EVIDENCE_PUBLIC_KEY_PATH"] = pubKeyPath;

    // 独立宿主 repo
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "p1-3-repo-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "penetration@example.com"]);
    git(repo, ["config", "user.name", "PenetrationRunner"]);

    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.mkdirSync(path.join(repo, "tests", "unit"), { recursive: true });

    fs.writeFileSync(
      path.join(repo, "src", "app.ts"),
      "export const app = 1;\n",
    );
    fs.writeFileSync(
      path.join(repo, "package.json"),
      '{\n  "name": "p1-3-test"\n}\n',
    );

    // 基线测试文件：严格断言 src/app.ts 必须包含 'export const app ='
    fs.writeFileSync(
      path.join(repo, "tests", "unit", "app.test.js"),
      `const fs = require('fs');
const path = require('path');
const content = fs.readFileSync(path.resolve(process.cwd(), 'src/app.ts'), 'utf-8');
if (!content.includes('export const app =')) {
  process.exit(1);
}
`,
    );

    git(repo, ["add", "."]);
    git(repo, [
      "commit",
      "-q",
      "-m",
      "init: repo with base app and baseline test",
    ]);

    store = new ContractStore(repo);
    orchestrator = new ContractOrchestrator({ repoRoot: repo });
  });

  afterEach(() => {
    if (originalPrivEnv !== undefined) {
      process.env["STAGENT_EVIDENCE_PRIVATE_KEY_PATH"] = originalPrivEnv;
    } else {
      delete process.env["STAGENT_EVIDENCE_PRIVATE_KEY_PATH"];
    }
    if (originalPubEnv !== undefined) {
      process.env["STAGENT_EVIDENCE_PUBLIC_KEY_PATH"] = originalPubEnv;
    } else {
      delete process.env["STAGENT_EVIDENCE_PUBLIC_KEY_PATH"];
    }
    safeRmSync(repo);
    safeRmSync(keyDir);
  });

  function makeStandardContract(options?: {
    writablePaths?: string[];
    readonlyPaths?: string[];
    verificationScript?: string;
    allowBaselineTestMutation?: boolean;
  }): SoftwareContract {
    const draft = createContractDraft({
      title: "penetration-contract",
      description: "p1-3 dynamic penetration test",
      acceptanceCriteria: ["verify passes"],
      writablePaths: options?.writablePaths ?? ["src/**"],
      readonlyPaths: options?.readonlyPaths ?? ["package.json"],
      allowBaselineTestMutation: options?.allowBaselineTestMutation,
      commands: [
        {
          alias: "verify",
          executable: "node",
          args: [
            "-e",
            options?.verificationScript ??
              "require('./tests/unit/app.test.js');require('fs').writeFileSync('src/app.ts', 'export const app = 2;');process.exit(0)",
          ],
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
  }

  // =========================================================================
  // TC-P0-1 系列：P0-1 门禁闭合动态渗透
  // =========================================================================

  it("TC-P0-1A: 合同版本过期阻断 —— 构造过期 contract_revision 发起合并，抛出 E_EVIDENCE_REVISION_MISMATCH", async () => {
    const contract = makeStandardContract();
    store.save(contract);
    await orchestrator.admit(contract.contract_id);
    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.evidence.verdict.status).toBe("PASSED");

    // 动态攻击：提升合同版本，同时保持审批绑定当前版本，使已生成的 Evidence 中记录的版本滞后
    const loaded = store.get(contract.contract_id)!;
    const bumpedRevision = loaded.contract_revision + 1;
    const bumped: SoftwareContract = {
      ...loaded,
      contract_revision: bumpedRevision,
      approval: {
        status: "APPROVED",
        approved_by: "auditor",
        approved_at: new Date().toISOString(),
        approved_revision: bumpedRevision,
      },
    };
    store.save(bumped);

    let thrown: unknown;
    try {
      await squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence: outcome.evidence,
        reviewer: "auditor",
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(MergeGateError);
    expect((thrown as MergeGateError).code).toBe(E_EVIDENCE_REVISION_MISMATCH);
  });

  it("TC-P0-1B: 任务分支提交流转嫁接阻断 —— Evidence 签发后向任务分支追加提交，合并抛出指纹失配/Stale阻断", async () => {
    const contract = makeStandardContract();
    store.save(contract);
    await orchestrator.admit(contract.contract_id);
    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.evidence.verdict.status).toBe("PASSED");

    // 动态攻击：在 Evidence 签发后，暗中向任务分支追加一次空提交以改变分支 HEAD
    const wt = worktreeOf(contract.contract_id);
    git(wt, [
      "commit",
      "--allow-empty",
      "-m",
      "sneak: post-evidence commit graft",
    ]);

    let thrown: unknown;
    try {
      await squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence: outcome.evidence,
        reviewer: "auditor",
      });
    } catch (err) {
      thrown = err;
    }

    // 指纹失配导致抛出 EvidenceIntegrityError，且标记 Evidence 为 STALE
    expect(thrown).toBeDefined();
    const isIntegrityErr = thrown instanceof EvidenceIntegrityError;
    const isMergeGateErr = thrown instanceof MergeGateError;
    expect(isIntegrityErr || isMergeGateErr).toBe(true);

    if (isIntegrityErr) {
      expect((thrown as EvidenceIntegrityError).code).toBe(
        "E_EVIDENCE_FINGERPRINT_MISMATCH",
      );
    } else if (isMergeGateErr) {
      expect((thrown as MergeGateError).code).toBe("E_EVIDENCE_STALE");
    }
  });

  it("TC-P0-1C: 非受控模式伪装阻断 —— Evidence 伪装 UNCONTROLLED_EXTERNAL 尝试合流，抛出 E_CANNOT_MERGE", async () => {
    const contract = makeStandardContract();
    store.save(contract);
    await orchestrator.admit(contract.contract_id);
    const outcome = await orchestrator.execute(contract.contract_id);

    // 动态攻击：篡改磁盘上的证据快照，将 worker_control_mode 改为非受控外部模式
    const eviDir = path.join(repo, ".stagent", "evidence");
    const eviPath = path.join(
      eviDir,
      `${contract.contract_id}-${outcome.evidence.evidence_id}.json`,
    );
    const diskContent = JSON.parse(fs.readFileSync(eviPath, "utf-8"));
    diskContent.worker_control_mode = "UNCONTROLLED_EXTERNAL";
    fs.writeFileSync(eviPath, JSON.stringify(diskContent, null, 2), "utf-8");

    let thrown: unknown;
    try {
      await squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence: outcome.evidence,
        reviewer: "auditor",
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(MergeGateError);
    // 控制模式校验 (E_CANNOT_MERGE) 或随后的签名防篡改校验 (EVIDENCE_SIGNATURE_INVALID) 强行阻断
    expect(["E_CANNOT_MERGE", EVIDENCE_SIGNATURE_INVALID]).toContain(
      (thrown as MergeGateError).code,
    );
  });

  // =========================================================================
  // TC-P0-2 系列：P0-2 变更审计动态渗透
  // =========================================================================

  it("TC-P0-2A: 未授权路径越界写入阻断 —— 任务分支改动越出 writable_paths，PRE_MERGE 审计拦截", async () => {
    const contract = makeStandardContract({
      writablePaths: ["src/**"],
      readonlyPaths: ["package.json"],
    });
    store.save(contract);
    await orchestrator.admit(contract.contract_id);

    // 在 worktree 中越界修改只读文件 package.json 并 commit
    const wt = worktreeOf(contract.contract_id);
    fs.writeFileSync(
      path.join(wt, "package.json"),
      '{\n  "name": "p1-3-test",\n  "hacked": true\n}\n',
    );
    git(wt, ["add", "package.json"]);
    git(wt, ["commit", "-m", "violation: illegal modify package.json"]);

    // 执行生成证据
    const outcome = await orchestrator.execute(contract.contract_id);

    // PRE_MERGE 阶段强行复核分支改动
    let thrown: unknown;
    try {
      await squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence: outcome.evidence,
        reviewer: "auditor",
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(MergeGateError);
    expect((thrown as MergeGateError).code).toBe("E_OUT_OF_SCOPE");
  });

  it("TC-P0-2B: 重命名路径逃逸阻断 —— 授权文件重命名为受保护路径，新旧路径双审拦截", async () => {
    const contract = makeStandardContract({
      writablePaths: ["src/**"],
      readonlyPaths: ["package.json", "docs/**"],
    });
    store.save(contract);
    await orchestrator.admit(contract.contract_id);

    const wt = worktreeOf(contract.contract_id);
    // 动态攻击：重命名 src/app.ts 到受保护的 docs/escaped.ts
    fs.mkdirSync(path.join(wt, "docs"), { recursive: true });
    git(wt, ["mv", "src/app.ts", "docs/escaped.ts"]);
    git(wt, ["commit", "-m", "escape: rename src/app.ts to docs/escaped.ts"]);

    // 重新补充一个合法 src/app.ts 避免验证命令失败
    fs.writeFileSync(path.join(wt, "src", "app.ts"), "export const app = 1;\n");
    git(wt, ["add", "src/app.ts"]);
    git(wt, ["commit", "-m", "recreate src/app.ts for verify"]);

    const outcome = await orchestrator.execute(contract.contract_id);

    let thrown: unknown;
    try {
      await squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence: outcome.evidence,
        reviewer: "auditor",
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(MergeGateError);
    expect((thrown as MergeGateError).code).toBe("E_OUT_OF_SCOPE");
  });

  // =========================================================================
  // TC-P0-4 系列：P0-4 测试完整性动态渗透
  // =========================================================================

  it("TC-P0-4A: 既有测试被篡改拦截 —— 修改既有测试掩盖回归，触发基线重跑 fail-closed E_TEST_BASELINE_REGRESSION", async () => {
    const contract = makeStandardContract({
      writablePaths: ["src/**", "tests/**"],
      verificationScript: "require('./tests/unit/app.test.js');process.exit(0)",
    });
    store.save(contract);
    await orchestrator.admit(contract.contract_id);
    const wt = worktreeOf(contract.contract_id);

    // 动态攻击：修改业务代码破坏原有基线行为（移除 'export const app ='）
    fs.writeFileSync(
      path.join(wt, "src", "app.ts"),
      "export const broken_name = 999;\n",
    );
    // 同时故意篡改既有单元测试使其对断言脱敏（无条件 pass），试图蒙混过关
    fs.writeFileSync(
      path.join(wt, "tests", "unit", "app.test.js"),
      "// tampered to always pass\nprocess.exit(0);\n",
    );

    const outcome = await orchestrator.execute(contract.contract_id);

    // 必须识别测试篡改，并触发基线重跑失败关闭
    expect(outcome.evidence.verdict.can_merge).toBe(false);
    expect(outcome.evidence.tests_modified).toBe(true);

    const ti = outcome.evidence.test_integrity;
    expect(ti).toBeDefined();
    expect(ti?.modified_existing_tests).toEqual(["tests/unit/app.test.js"]);
    expect(ti?.baseline_rerun_triggered).toBe(true);
    expect(ti?.baseline_rerun_passed).toBe(false);
    expect(ti?.failure_code).toBe("E_TEST_BASELINE_REGRESSION");
  });

  it("TC-P0-4B: 破坏基线环境逃逸阻断 —— 破坏宿主基线运行环境，失败关闭抛出 E_TEST_BASELINE_UNAVAILABLE", async () => {
    const contract = makeStandardContract({
      writablePaths: ["src/**", "tests/**"],
      verificationScript: "setTimeout(() => {}, 5000);",
    });
    // 注入超时让基线重跑超时失败
    contract.verification_spec.commands[0]!.timeout_seconds = 1;
    store.save(contract);
    await orchestrator.admit(contract.contract_id);
    const wt = worktreeOf(contract.contract_id);

    // 篡改测试触发基线重跑
    fs.writeFileSync(
      path.join(wt, "tests", "unit", "app.test.js"),
      "// trigger baseline rerun\n",
    );

    const outcome = await orchestrator.execute(contract.contract_id);

    expect(outcome.evidence.verdict.can_merge).toBe(false);
    expect(outcome.evidence.verdict.status).toBe("BLOCKED");
    const ti = outcome.evidence.test_integrity;
    expect(ti?.baseline_rerun_triggered).toBe(true);
    expect(ti?.baseline_rerun_passed).toBe(false);
    expect(ti?.failure_code).toBe("E_TEST_BASELINE_UNAVAILABLE");
  });

  // =========================================================================
  // P13-P5: 独立动态验收防跨提交嫁接与 Git Trailer 绑定核验
  // =========================================================================

  it("P13-P5: 独立动态验收防嫁接核验 —— 合法 Evidence 顺利合流且 Git 提交严格注入 Evidence-Sha256 与 Evidence-Signature Trailer", async () => {
    const contract = makeStandardContract({
      writablePaths: ["src/**"],
      verificationScript: "require('./tests/unit/app.test.js');process.exit(0)",
    });
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "auditor");

    // 在 worktree 中写入真正的产物变更，确保分支与 main 产生合法 diff
    const wt = worktreeOf(contract.contract_id);
    fs.writeFileSync(
      path.join(wt, "src", "app.ts"),
      "export const app = 100;\n",
    );

    const outcome = await orchestrator.execute(contract.contract_id);

    expect(outcome.evidence.verdict.can_merge).toBe(true);
    expect(outcome.evidence.signature).toBeDefined();

    const mergeRes = await squashMerge({
      repoRoot: repo,
      contractId: contract.contract_id,
      evidence: outcome.evidence,
      reviewer: "lead-auditor",
    });

    expect(mergeRes.commitSha).toBeTruthy();

    // 检查 Git commit message 中的 Trailer 绑定
    const logMsg = git(repo, ["log", "-1", "--pretty=%B", mergeRes.commitSha]);
    expect(logMsg).toContain("Evidence-Sha256:");
    expect(logMsg).toContain("Evidence-Signature:");
    expect(logMsg).toContain(`Stagent-Contract-ID: ${contract.contract_id}`);

    // 核验文件内容被正确合入 main
    const mergedContent = fs.readFileSync(
      path.join(repo, "src", "app.ts"),
      "utf-8",
    );
    expect(mergedContent).toContain("export const app = 100;");
  });
});
