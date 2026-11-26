import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {
  generateEvidenceKeyPair,
  canonicalizeJson,
  stripUnsignedFields,
  computeCanonicalSha256,
  signEvidencePayload,
  verifyEvidenceSignature,
  assertPrivateKeySecurity,
  savePrivateKeyWith0400,
} from "../../daemon/pipeline/evidence-signer";

describe("TASK-P1.2 / P12-P1 ~ P12-P2: Evidence Ed25519 签名与防篡改单元测试", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-signer-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_e) {
      // ignore
    }
  });

  describe("P12-P1: 密钥生成与权限管理", () => {
    it("基于 Node.js 原生 crypto 模块生成 Ed25519 密钥对，零外部依赖", () => {
      const keyPair = generateEvidenceKeyPair();
      expect(keyPair.privateKeyPem).toContain("BEGIN PRIVATE KEY");
      expect(keyPair.publicKeyPem).toContain("BEGIN PUBLIC KEY");
      expect(keyPair.keyId).toHaveLength(16);
      expect(keyPair.publicKeyBase64.length).toBeGreaterThan(20);

      // 验证原生 crypto 可正常解析公钥与私钥
      const pubKey = crypto.createPublicKey(keyPair.publicKeyPem);
      expect(pubKey.asymmetricKeyType).toBe("ed25519");
      const privKey = crypto.createPrivateKey(keyPair.privateKeyPem);
      expect(privKey.asymmetricKeyType).toBe("ed25519");
    });

    it("私钥保存支持赋予 0400 权限；禁止落盘在工作区或 Evidence 目录下", () => {
      const keyPair = generateEvidenceKeyPair();
      const safeKeyPath = path.join(tempDir, "keys", "evidence-priv.pem");
      savePrivateKeyWith0400(safeKeyPath, keyPair.privateKeyPem);

      expect(fs.existsSync(safeKeyPath)).toBe(true);

      // 工作区隔离检查：若私钥位于 repoRoot 内部或包含 .stagent/evidence，断言阻断
      const fakeRepoRoot = path.join(tempDir, "workspace");
      fs.mkdirSync(fakeRepoRoot, { recursive: true });
      const badKeyPathInsideRepo = path.join(
        fakeRepoRoot,
        ".stagent",
        "evidence",
        "priv.pem",
      );
      fs.mkdirSync(path.dirname(badKeyPathInsideRepo), { recursive: true });
      fs.writeFileSync(badKeyPathInsideRepo, keyPair.privateKeyPem);

      expect(() => {
        assertPrivateKeySecurity(badKeyPathInsideRepo, fakeRepoRoot);
      }).toThrow(/E_PRIVATE_KEY_LOCATION_INSECURE/);
    });
  });

  describe("P12-P2: RFC 8785 确定性规范化与摘要计算", () => {
    it("不同键序与嵌套结构序列化后产出完全一致的规范化 JSON 与 SHA-256", () => {
      const objA = {
        zebra: "last",
        apple: "first",
        nested: { b: 2, a: 1 },
        list: [1, 2, { y: 2, x: 1 }],
      };
      const objB = {
        apple: "first",
        list: [1, 2, { x: 1, y: 2 }],
        nested: { a: 1, b: 2 },
        zebra: "last",
      };

      const canonA = canonicalizeJson(objA);
      const canonB = canonicalizeJson(objB);
      expect(canonA).toBe(canonB);

      const hashA = computeCanonicalSha256(objA);
      const hashB = computeCanonicalSha256(objB);
      expect(hashA).toBe(hashB);
      expect(hashA).toHaveLength(64);
    });

    it("规范化载荷剥离 signature、manual_confirmation 与派生 can_merge", () => {
      const payload = {
        contract_id: "c-1",
        verdict: {
          status: "PASSED",
          can_merge: true,
          summary: "ok",
        },
        manual_confirmation: {
          actor: "tina",
          confirmed_at: "2026-11-26T00:00:00Z",
          reason: "done",
        },
        signature: {
          algorithm: "Ed25519",
          signature: "dummy",
          canonical_hash: "abcd",
          signed_at: "2026-11-26T00:00:00Z",
        },
      };

      const stripped = stripUnsignedFields(payload);
      expect(stripped["signature"]).toBeUndefined();
      expect(stripped["manual_confirmation"]).toBeUndefined();
      expect(
        (stripped["verdict"] as Record<string, unknown>)["can_merge"],
      ).toBeUndefined();
      expect((stripped["verdict"] as Record<string, unknown>)["status"]).toBe(
        "PASSED",
      );
    });
  });

  describe("P12-P5: 签名与验签正反向测试", () => {
    it("合法数据正常签名与公钥验签通过", () => {
      const keyPair = generateEvidenceKeyPair();
      const payload = {
        contract_id: "c-123",
        verdict: { status: "PASSED", summary: "all green" },
        scope_audit: { passed: true, forbidden_violations: [] },
      };

      const sigRecord = signEvidencePayload(payload, {
        privateKeyPem: keyPair.privateKeyPem,
      });
      expect(sigRecord.algorithm).toBe("Ed25519");
      expect(sigRecord.signature).toBeTruthy();
      expect(sigRecord.canonical_hash).toHaveLength(64);

      const verifyResult = verifyEvidenceSignature(payload, sigRecord, {
        publicKeyPem: keyPair.publicKeyPem,
      });
      expect(verifyResult.valid).toBe(true);
      expect(verifyResult.reason).toBeUndefined();
    });

    it("负向用例 1：篡改 Evidence 内容字段，验签阻断并识别哈希篡改", () => {
      const keyPair = generateEvidenceKeyPair();
      const payload = {
        contract_id: "c-123",
        verdict: { status: "FAILED", summary: "failed tests" },
      };
      const sigRecord = signEvidencePayload(payload, {
        privateKeyPem: keyPair.privateKeyPem,
      });

      // 攻击者篡改 status 为 PASSED
      const tampered = {
        contract_id: "c-123",
        verdict: { status: "PASSED", summary: "failed tests" },
      };

      const verifyResult = verifyEvidenceSignature(tampered, sigRecord, {
        publicKeyPem: keyPair.publicKeyPem,
      });
      expect(verifyResult.valid).toBe(false);
      expect(verifyResult.reason).toContain("Canonical payload hash mismatch");
    });

    it("负向用例 2：篡改签名密文字符串，验签阻断", () => {
      const keyPair = generateEvidenceKeyPair();
      const payload = {
        contract_id: "c-123",
        verdict: { status: "PASSED", summary: "green" },
      };
      const sigRecord = signEvidencePayload(payload, {
        privateKeyPem: keyPair.privateKeyPem,
      });

      // 篡改签名密文中的一个字节
      const rawSig = Buffer.from(sigRecord.signature, "base64");
      rawSig[0] = rawSig[0]! ^ 0xff;
      const tamperedRecord = {
        ...sigRecord,
        signature: rawSig.toString("base64"),
      };

      const verifyResult = verifyEvidenceSignature(payload, tamperedRecord, {
        publicKeyPem: keyPair.publicKeyPem,
      });
      expect(verifyResult.valid).toBe(false);
      expect(verifyResult.reason).toContain(
        "Ed25519 cryptographic signature verification failed",
      );
    });

    it("负向用例 3：缺失签名结构或格式损坏，验签阻断", () => {
      const payload = { contract_id: "c-1" };
      const res1 = verifyEvidenceSignature(
        payload,
        null as unknown as Parameters<typeof verifyEvidenceSignature>[1],
      );
      expect(res1.valid).toBe(false);
      expect(res1.reason).toContain("Missing or malformed");

      const res2 = verifyEvidenceSignature(payload, {
        algorithm: "RSA",
        signature: "abc",
      } as unknown as Parameters<typeof verifyEvidenceSignature>[1]);
      expect(res2.valid).toBe(false);
    });
    it("负向用例 4：使用不匹配的公钥验签，阻断合流", () => {
      const pairA = generateEvidenceKeyPair();
      const pairB = generateEvidenceKeyPair();
      const payload = { contract_id: "c-1", verdict: { status: "PASSED" } };

      const sig = signEvidencePayload(payload, {
        privateKeyPem: pairA.privateKeyPem,
      });

      // 使用公钥 B 校验
      const res = verifyEvidenceSignature(payload, sig, {
        publicKeyPem: pairB.publicKeyPem,
        expectedPublicKeyPem: pairB.publicKeyPem,
      });
      expect(res.valid).toBe(false);
    });
  });
});
