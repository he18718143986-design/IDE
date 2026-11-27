import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { safeRmSync } from "../helpers/tmp";
import { git } from "../helpers/git";
import { ContractStore } from "../../daemon/pipeline/contract-store";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import {
  squashMerge,
  MergeGateError,
  EVIDENCE_SIGNATURE_MISSING,
  EVIDENCE_SIGNATURE_INVALID,
} from "../../daemon/pipeline/merger";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";
import {
  generateEvidenceKeyPair,
  savePrivateKeyWith0400,
} from "../../daemon/pipeline/evidence-signer";

describe("TASK-P1.2 / P12-P3 ~ P12-P5: Evidence Ed25519 签名与合流验签集成测试", () => {
  let repo: string;
  let keyDir: string;
  let store: ContractStore;
  let orchestrator: ContractOrchestrator;
  let originalPrivEnv: string | undefined;
  let originalPubEnv: string | undefined;

  beforeEach(() => {
    // 独立私钥安全目录，绝对远离 repo 工作区
    keyDir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-secure-keys-"));
    const keyPair = generateEvidenceKeyPair();
    const privPath = path.join(keyDir, "evidence-priv.pem");
    const pubPath = path.join(keyDir, "evidence-pub.pem");
    savePrivateKeyWith0400(privPath, keyPair.privateKeyPem);
    fs.writeFileSync(pubPath, keyPair.publicKeyPem, "utf8");

    originalPrivEnv = process.env["STAGENT_EVIDENCE_PRIVATE_KEY_PATH"];
    originalPubEnv = process.env["STAGENT_EVIDENCE_PUBLIC_KEY_PATH"];
    process.env["STAGENT_EVIDENCE_PRIVATE_KEY_PATH"] = privPath;
    process.env["STAGENT_EVIDENCE_PUBLIC_KEY_PATH"] = pubPath;

    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-p1-repo-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "audit@example.com"]);
    git(repo, ["config", "user.name", "Auditor"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, "src", "index.ts"),
      "export const val = 1;\n",
    );
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);

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

  const setupApprovedAndExecutedContract = async (title: string) => {
    const draft = createContractDraft({
      title,
      description: "p1 signature gate test",
      acceptanceCriteria: ["verify passes"],
      writablePaths: ["src/**"],
      commands: [
        {
          alias: "verify",
          executable: "node",
          args: [
            "-e",
            "require('fs').writeFileSync('src/index.ts', 'export const val = 2;');process.exit(0)",
          ],
          expected_exit_code: 0,
          timeout_seconds: 30,
        },
      ],
    });

    const c = softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "PENDING_APPROVAL",
      approval: { status: "PENDING_REVIEW" },
    });
    store.save(c);

    await orchestrator.approve(c.contract_id, "auditor");
    const worktree = path.join(
      repo,
      ".stagent",
      "worktrees",
      `task-${c.contract_id}`,
    );
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(worktree, "src", "index.ts"),
      "export const val = 2;\n",
    );
    const outcome = await orchestrator.execute(c.contract_id);
    const updated = store.get(c.contract_id)!;
    return { contract: updated, evidence: outcome.evidence };
  };

  it("P12-P3 & P12-P4 正向流程：自动化签署的合法 Evidence 顺利通过 PRE_MERGE 验签，Git 提交注入 Evidence-Sha256 与 Evidence-Signature Trailer", async () => {
    const { contract, evidence } = await setupApprovedAndExecutedContract(
      "valid signed evidence",
    );

    expect(evidence.signature).toBeDefined();
    expect(evidence.signature?.algorithm).toBe("Ed25519");
    expect(evidence.signature?.signature).toBeTruthy();
    expect(evidence.signature?.canonical_hash).toHaveLength(64);

    // 独立签名凭据文件存在
    const sigPath = path.join(
      repo,
      ".stagent",
      "signatures",
      `${contract.contract_id}-${evidence.evidence_id}.sig`,
    );
    expect(fs.existsSync(sigPath)).toBe(true);

    // 执行 squashMerge
    const mergeResult = await squashMerge({
      repoRoot: repo,
      contractId: contract.contract_id,
      evidence,
      reviewer: "lead-reviewer",
    });

    expect(mergeResult.commitSha).toBeTruthy();

    // 检查 Git commit message 中是否完整绑定了 Evidence-Sha256 与 Evidence-Signature Trailer
    const commitMsg = git(repo, ["log", "-1", "--pretty=%B"]);
    expect(commitMsg).toContain(
      `Evidence-Sha256: ${evidence.signature?.canonical_hash}`,
    );
    expect(commitMsg).toContain(
      `Evidence-Signature: ${evidence.signature?.signature}`,
    );
    expect(commitMsg).toContain(`Stagent-Evidence-ID: ${evidence.evidence_id}`);
  });

  it("P12-P5 负向场景 1：攻击者篡改 Evidence JSON 内容，PRE_MERGE 验签识别并抛出 EVIDENCE_SIGNATURE_INVALID 阻断合流", async () => {
    const { contract, evidence } =
      await setupApprovedAndExecutedContract("tampered content");

    const jsonPath = path.join(
      repo,
      ".stagent",
      "evidence",
      `${contract.contract_id}-${evidence.evidence_id}.json`,
    );
    const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    // 恶意篡改业务总结与判定内容
    raw.verdict.summary = "FORGED: attacker modified summary";
    fs.writeFileSync(jsonPath, JSON.stringify(raw, null, 2), "utf8");

    await expect(
      squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence,
        reviewer: "lead-reviewer",
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: EVIDENCE_SIGNATURE_INVALID,
        message: expect.stringMatching(/tampered|hash mismatch/i),
      }),
    );

    // 确保主干分支未合并
    const log = git(repo, ["log", "--oneline"]);
    expect(log).not.toContain("p1 signature gate test");
  });

  it("P12-P5 负向场景 2：移除独立 .sig 文件且剔除内嵌 signature，PRE_MERGE 识别缺失签名并抛出 EVIDENCE_SIGNATURE_MISSING 阻断合流", async () => {
    const { contract, evidence } =
      await setupApprovedAndExecutedContract("missing signature");

    const sigPath = path.join(
      repo,
      ".stagent",
      "signatures",
      `${contract.contract_id}-${evidence.evidence_id}.sig`,
    );
    if (fs.existsSync(sigPath)) {
      fs.unlinkSync(sigPath);
    }

    const jsonPath = path.join(
      repo,
      ".stagent",
      "evidence",
      `${contract.contract_id}-${evidence.evidence_id}.json`,
    );
    const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    delete raw.signature;
    fs.writeFileSync(jsonPath, JSON.stringify(raw, null, 2), "utf8");

    await expect(
      squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence,
        reviewer: "lead-reviewer",
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: EVIDENCE_SIGNATURE_MISSING,
      }),
    );
  });

  it("P12-P5 负向场景 3：篡改 .sig 签名密文，PRE_MERGE 密码学验签失败并抛出 EVIDENCE_SIGNATURE_INVALID 阻断合流", async () => {
    const { contract, evidence } = await setupApprovedAndExecutedContract(
      "corrupted signature bytes",
    );

    const sigPath = path.join(
      repo,
      ".stagent",
      "signatures",
      `${contract.contract_id}-${evidence.evidence_id}.sig`,
    );
    const sigJson = JSON.parse(fs.readFileSync(sigPath, "utf8"));
    // 翻转签名 base64 前几个字符
    sigJson.signature = "AAAA" + sigJson.signature.slice(4);
    fs.writeFileSync(sigPath, JSON.stringify(sigJson, null, 2), "utf8");

    // 同时将 JSON 内嵌签名同步修改以防止回退内嵌
    const jsonPath = path.join(
      repo,
      ".stagent",
      "evidence",
      `${contract.contract_id}-${evidence.evidence_id}.json`,
    );
    const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    raw.signature = sigJson;
    fs.writeFileSync(jsonPath, JSON.stringify(raw, null, 2), "utf8");

    await expect(
      squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence,
        reviewer: "lead-reviewer",
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: EVIDENCE_SIGNATURE_INVALID,
        message: expect.stringMatching(/verification failed/i),
      }),
    );
  });

  it("P12-P5 负向场景 4：.sig 签名文件损坏（非标准 JSON），抛出 EVIDENCE_SIGNATURE_INVALID 阻断合流", async () => {
    const { contract, evidence } = await setupApprovedAndExecutedContract(
      "corrupted json file",
    );

    const sigPath = path.join(
      repo,
      ".stagent",
      "signatures",
      `${contract.contract_id}-${evidence.evidence_id}.sig`,
    );
    fs.writeFileSync(sigPath, "{ this is not valid json content", "utf8");

    await expect(
      squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence,
        reviewer: "lead-reviewer",
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: EVIDENCE_SIGNATURE_INVALID,
        message: expect.stringMatching(/corrupted|invalid json/i),
      }),
    );
  });

  it("P12-P5 负向场景 5：公钥不符（使用非受信公钥），PRE_MERGE 验签识别并抛出 EVIDENCE_SIGNATURE_INVALID 阻断合流", async () => {
    const { contract, evidence } = await setupApprovedAndExecutedContract(
      "untrusted public key",
    );

    // 生成另一对完全无关的密钥对作为系统受信公钥
    const otherPair = generateEvidenceKeyPair();
    const otherPubPath = path.join(keyDir, "untrusted-pub.pem");
    fs.writeFileSync(otherPubPath, otherPair.publicKeyPem, "utf8");

    process.env["STAGENT_EVIDENCE_PUBLIC_KEY_PATH"] = otherPubPath;

    await expect(
      squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence,
        reviewer: "lead-reviewer",
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: EVIDENCE_SIGNATURE_INVALID,
      }),
    );
  });
});
