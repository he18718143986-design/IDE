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
  assertEvidenceSignatureGate,
  MergeGateError,
  E_EVIDENCE_UNTRUSTED_KEY,
  EVIDENCE_SIGNATURE_INVALID,
  EVIDENCE_SIGNATURE_MISSING,
} from "../../daemon/pipeline/merger";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";
import {
  generateEvidenceKeyPair,
  savePrivateKeyWith0400,
  signEvidencePayload,
} from "../../daemon/pipeline/evidence-signer";

describe("TASK-P0.15 Scope A: Evidence 信任根强制与受控合并门禁", () => {
  let repo: string;
  let keyDir: string;
  let trustedKeyPair: ReturnType<typeof generateEvidenceKeyPair>;
  let attackerKeyPair: ReturnType<typeof generateEvidenceKeyPair>;
  let trustedPrivPath: string;
  let trustedPubPath: string;
  let originalPrivEnv: string | undefined;
  let originalPubEnv: string | undefined;

  beforeEach(() => {
    keyDir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-p015-keys-"));
    trustedKeyPair = generateEvidenceKeyPair();
    attackerKeyPair = generateEvidenceKeyPair();

    trustedPrivPath = path.join(keyDir, "trusted-priv.pem");
    trustedPubPath = path.join(keyDir, "trusted-pub.pem");
    savePrivateKeyWith0400(trustedPrivPath, trustedKeyPair.privateKeyPem);
    fs.writeFileSync(trustedPubPath, trustedKeyPair.publicKeyPem, "utf8");

    originalPrivEnv = process.env["STAGENT_EVIDENCE_PRIVATE_KEY_PATH"];
    originalPubEnv = process.env["STAGENT_EVIDENCE_PUBLIC_KEY_PATH"];
    delete process.env["STAGENT_EVIDENCE_PRIVATE_KEY_PATH"];
    delete process.env["STAGENT_EVIDENCE_PUBLIC_KEY_PATH"];
    delete process.env["STAGENT_EVIDENCE_PUBLIC_KEY_PEM"];

    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-p015-repo-"));
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
    delete process.env["STAGENT_EVIDENCE_PUBLIC_KEY_PEM"];
    safeRmSync(repo);
    safeRmSync(keyDir);
  });

  const setupExecutedContract = async (
    title: string,
    signerPrivPem: string,
    signerPubPem?: string,
  ) => {
    const store = new ContractStore(repo);
    const orchestrator = new ContractOrchestrator({ repoRoot: repo });

    const draft = createContractDraft({
      title,
      description: "p0.15 trust root test",
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

    // 临时配置私钥用于执行签名
    process.env["STAGENT_EVIDENCE_PRIVATE_KEY_PEM"] = signerPrivPem;
    if (signerPubPem) {
      process.env["STAGENT_EVIDENCE_PUBLIC_KEY_PEM"] = signerPubPem;
    }
    const outcome = await orchestrator.execute(c.contract_id);
    delete process.env["STAGENT_EVIDENCE_PRIVATE_KEY_PEM"];
    delete process.env["STAGENT_EVIDENCE_PUBLIC_KEY_PEM"];

    const updated = store.get(c.contract_id)!;
    return { contract: updated, evidence: outcome.evidence };
  };

  it("P015-P1 负向场景 1: Evidence 自带公钥自签，缺少受信任根时受控合并被 fail-closed 阻断（抛 E_EVIDENCE_UNTRUSTED_KEY）", async () => {
    // 攻击者用自己的私钥签署，并将攻击者公钥写入凭据自带字段
    const { contract, evidence } = await setupExecutedContract(
      "self-signed attacker evidence",
      attackerKeyPair.privateKeyPem,
      attackerKeyPair.publicKeyPem,
    );

    // 确保没有配置任何受信任公钥
    delete process.env["STAGENT_EVIDENCE_PUBLIC_KEY_PATH"];
    delete process.env["STAGENT_EVIDENCE_PUBLIC_KEY_PEM"];

    // 尝试执行受控合并，预期被阻断且报 E_EVIDENCE_UNTRUSTED_KEY
    await expect(
      squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence,
        reviewer: "auditor",
        trustPolicy: { ignoreDefaultKey: true },
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: E_EVIDENCE_UNTRUSTED_KEY,
        message: expect.stringMatching(
          /trust-root missing|cannot be used as the sole trust basis/i,
        ),
      }),
    );
  });

  it("P015-P1 降级场景 2: 自带公钥在显式 allowIntegrityOnly 且非受控模式下降级为 integrity_only", async () => {
    const { contract, evidence } = await setupExecutedContract(
      "integrity only test",
      attackerKeyPair.privateKeyPem,
      attackerKeyPair.publicKeyPem,
    );

    const evidencePath = path.join(
      repo,
      ".stagent",
      "evidence",
      `${contract.contract_id}-${evidence.evidence_id}.json`,
    );

    // 显式允许降级，关闭受控合并门禁
    const res = assertEvidenceSignatureGate(evidencePath, evidence, {
      allowIntegrityOnly: true,
      enforceMergeControlledTrust: false,
      ignoreDefaultKey: true,
    });

    expect(res.trustMode).toBe("integrity_only");
    expect(res.canonicalHash).toBeTruthy();
  });

  it("P015-P2 负向场景 3: 未知密钥 / 密钥不匹配时阻断合并（抛 EVIDENCE_SIGNATURE_INVALID）", async () => {
    // 凭据用攻击者私钥签名
    const { contract, evidence } = await setupExecutedContract(
      "mismatched key test",
      attackerKeyPair.privateKeyPem,
      attackerKeyPair.publicKeyPem,
    );

    // 系统配置了预期的合法受信任公钥
    await expect(
      squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence,
        reviewer: "auditor",
        expectedPublicKey: trustedKeyPair.publicKeyPem,
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: EVIDENCE_SIGNATURE_INVALID,
        message: expect.stringMatching(
          /invalid against configured trust root|wrong key|mismatch/i,
        ),
      }),
    );
  });

  it("P015-P2 负向场景 4: 伪造信任来源（声称受信 keyId 但实际公钥非受信）阻断合并", async () => {
    const { contract, evidence } = await setupExecutedContract(
      "forged origin test",
      attackerKeyPair.privateKeyPem,
      attackerKeyPair.publicKeyPem,
    );

    // 篡改 signature 记录声称自己为 default-ed25519-root
    const sigPath = path.join(
      repo,
      ".stagent",
      "signatures",
      `${contract.contract_id}-${evidence.evidence_id}.sig`,
    );
    const sigObj = JSON.parse(fs.readFileSync(sigPath, "utf8"));
    sigObj.key_id = "trusted-root-system-key";
    fs.writeFileSync(sigPath, JSON.stringify(sigObj, null, 2), "utf8");

    // 系统配置了真实受信任公钥
    await expect(
      squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence,
        reviewer: "auditor",
        expectedPublicKey: trustedKeyPair.publicKeyPem,
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: EVIDENCE_SIGNATURE_INVALID,
      }),
    );
  });

  it("P015-P2 负向场景 5: 载荷变更（签名后篡改 Evidence 内容）阻断合并", async () => {
    const { contract, evidence } = await setupExecutedContract(
      "payload tampered test",
      trustedKeyPair.privateKeyPem,
      trustedKeyPair.publicKeyPem,
    );

    // 恶意篡改 Evidence 磁盘文件中的 verdict 结果
    const evidencePath = path.join(
      repo,
      ".stagent",
      "evidence",
      `${contract.contract_id}-${evidence.evidence_id}.json`,
    );
    const raw = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
    raw.verdict.summary = "ATTACKER_ALTERED_SUMMARY";
    fs.writeFileSync(evidencePath, JSON.stringify(raw, null, 2), "utf8");

    await expect(
      squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence,
        reviewer: "auditor",
        expectedPublicKey: trustedKeyPair.publicKeyPem,
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: EVIDENCE_SIGNATURE_INVALID,
        message: expect.stringMatching(/tampered|hash mismatch/i),
      }),
    );
  });

  it("P015-P2 负向场景 6: 签名密文损坏阻断合并", async () => {
    const { contract, evidence } = await setupExecutedContract(
      "corrupted signature test",
      trustedKeyPair.privateKeyPem,
      trustedKeyPair.publicKeyPem,
    );

    const sigPath = path.join(
      repo,
      ".stagent",
      "signatures",
      `${contract.contract_id}-${evidence.evidence_id}.sig`,
    );
    const sigObj = JSON.parse(fs.readFileSync(sigPath, "utf8"));
    sigObj.signature = "INVALID" + sigObj.signature.slice(7);
    fs.writeFileSync(sigPath, JSON.stringify(sigObj, null, 2), "utf8");

    const evidencePath = path.join(
      repo,
      ".stagent",
      "evidence",
      `${contract.contract_id}-${evidence.evidence_id}.json`,
    );
    const raw = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
    raw.signature = sigObj;
    fs.writeFileSync(evidencePath, JSON.stringify(raw, null, 2), "utf8");

    await expect(
      squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence,
        reviewer: "auditor",
        expectedPublicKey: trustedKeyPair.publicKeyPem,
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: EVIDENCE_SIGNATURE_INVALID,
      }),
    );
  });

  it("P015-P2 负向场景 7: Contract 错绑阻断合并", async () => {
    const { contract, evidence } = await setupExecutedContract(
      "contract mismatch test",
      trustedKeyPair.privateKeyPem,
      trustedKeyPair.publicKeyPem,
    );

    // 传入不存在的或错配的 contractId
    await expect(
      squashMerge({
        repoRoot: repo,
        contractId: "contract-different-12345",
        evidence,
        reviewer: "auditor",
        expectedPublicKey: trustedKeyPair.publicKeyPem,
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "E_CONTRACT_NOT_FOUND",
      }),
    );
  });

  it("P015-P2 负向场景 8: Candidate Commit 错绑阻断合并", async () => {
    const { contract, evidence } = await setupExecutedContract(
      "candidate commit mismatch test",
      trustedKeyPair.privateKeyPem,
      trustedKeyPair.publicKeyPem,
    );

    // 人为篡改任务 worktree 分支引入新的提交，导致 task_commit_sha 与分支 HEAD 不符
    const worktree = path.join(
      repo,
      ".stagent",
      "worktrees",
      `task-${contract.contract_id}`,
    );
    fs.writeFileSync(
      path.join(worktree, "src", "extra.ts"),
      "export const extra = true;\n",
    );
    git(worktree, ["add", "."]);
    git(worktree, ["commit", "-q", "-m", "unauthorized commit advancing HEAD"]);

    await expect(
      squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence,
        reviewer: "auditor",
        expectedPublicKey: trustedKeyPair.publicKeyPem,
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: expect.stringMatching(
          /E_EVIDENCE_FINGERPRINT_MISMATCH|E_EVIDENCE_STALE/,
        ),
      }),
    );
  });

  it("P015-P3 正向流程: 配置合法可信密钥路径时顺利通过受控合并并留痕", async () => {
    const { contract, evidence } = await setupExecutedContract(
      "trusted root valid flow",
      trustedKeyPair.privateKeyPem,
      trustedKeyPair.publicKeyPem,
    );

    const evidencePath = path.join(
      repo,
      ".stagent",
      "evidence",
      `${contract.contract_id}-${evidence.evidence_id}.json`,
    );

    // 直接调用门禁：返回 trustMode === 'trusted'
    const gateRes = assertEvidenceSignatureGate(evidencePath, evidence, {
      expectedPublicKey: trustedKeyPair.publicKeyPem,
    });
    expect(gateRes.trustMode).toBe("trusted");
    expect(gateRes.canonicalHash).toBe(evidence.signature?.canonical_hash);

    // 调用 squashMerge 顺利完成合入
    const mergeResult = await squashMerge({
      repoRoot: repo,
      contractId: contract.contract_id,
      evidence,
      reviewer: "auditor",
      expectedPublicKey: trustedKeyPair.publicKeyPem,
    });

    expect(mergeResult.commitSha).toBeTruthy();
    expect(mergeResult.contract.lifecycle_state).toBe("MERGED");

    const commitMsg = git(repo, ["log", "-1", "--pretty=%B"]);
    expect(commitMsg).toContain(
      `Evidence-Sha256: ${evidence.signature?.canonical_hash}`,
    );
    expect(commitMsg).toContain(
      `Evidence-Signature: ${evidence.signature?.signature}`,
    );
  });
});
