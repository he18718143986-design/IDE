import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * TASK-P1.2: Evidence Ed25519 签名与防篡改辅助模块。
 *
 * 核心安全边界与规范约束（红线）：
 * 1. 零新增外部运行时依赖：完全基于 Node.js 原生 `node:crypto` 模块；
 * 2. 私钥隔离与权限：私钥存放在独立安全目录，POSIX 权限严格设为 0o400，绝不落盘于工作区或 Evidence 目录；
 * 3. 规范化序列化：遵循 RFC 8785 (JSON Canonicalization Scheme, JCS) 确定性键序规则；
 * 4. 防篡改与可信链：合流 PRE_MERGE 阶段 fail-closed 强校验，无有效签名一律拒合。
 */

export interface KeyPairResult {
  publicKeyPem: string;
  privateKeyPem: string;
  publicKeyBase64: string;
  keyId: string;
}

export interface EvidenceSignatureRecord {
  algorithm: "Ed25519";
  signature: string; // base64
  canonical_hash: string; // sha256 hex of RFC 8785 canonical JSON
  key_id?: string | undefined;
  public_key?: string | undefined; // SPKI PEM or base64
  signed_at: string; // ISO 8601
}

/**
 * RFC 8785 规范化序列化 (JSON Canonicalization Scheme)
 *
 * 规则：
 * 1. 基本类型：null, boolean, number, string 遵循标准 JSON 表达；
 * 2. 数组：按原有索引顺序序列化元素；
 * 3. 对象：按 UTF-16 code units 字典序对键进行严格排序（`keys.sort()`）；
 * 4. 忽略值为 undefined 的属性，无任何多余空格。
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((item) => canonicalizeJson(item)).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries: string[] = [];
  for (const key of keys) {
    const v = obj[key];
    if (v === undefined || typeof v === "function" || typeof v === "symbol") {
      continue;
    }
    entries.push(JSON.stringify(key) + ":" + canonicalizeJson(v));
  }
  return "{" + entries.join(",") + "}";
}

/**
 * 剥离无需签名的动态/派生字段（如签名结构体自身以及人工确认留痕）
 */
export function stripUnsignedFields(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const clone = { ...(value as Record<string, unknown>) };
  delete clone["signature"];
  // manual_confirmation 为审查人人工确认留痕，由 G2 门禁单独审计，不属于自动化 Worker 执行面产出
  delete clone["manual_confirmation"];
  // can_merge 为派生字段（§9.2：合并侧独立重核，不信任快照里的 can_merge），排除在签名载荷外
  if (
    clone["verdict"] &&
    typeof clone["verdict"] === "object" &&
    !Array.isArray(clone["verdict"])
  ) {
    const verdictClone = { ...(clone["verdict"] as Record<string, unknown>) };
    delete verdictClone["can_merge"];
    clone["verdict"] = verdictClone;
  }
  return clone;
}

/**
 * 基于 RFC 8785 计算 Evidence 规范化载荷的 SHA-256 摘要
 */
export function computeCanonicalSha256(value: unknown): string {
  const stripped = stripUnsignedFields(value);
  const canonical = canonicalizeJson(stripped);
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * 生成 Ed25519 密钥对（零外部依赖）
 */
export function generateEvidenceKeyPair(): KeyPairResult {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const keyId = crypto
    .createHash("sha256")
    .update(publicKey)
    .digest("hex")
    .slice(0, 16);
  const pubDer = crypto
    .createPublicKey(publicKey)
    .export({ type: "spki", format: "der" });
  return {
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
    publicKeyBase64: pubDer.toString("base64"),
    keyId,
  };
}

/**
 * 默认密钥存储目录（位于用户主目录独立安全位置，远离工作区）
 */
export function getDefaultKeyDir(): string {
  return path.join(os.homedir(), ".stagent", "keys");
}

export function getDefaultPrivateKeyPath(): string {
  return path.join(getDefaultKeyDir(), "evidence-ed25519.pem");
}

export function getDefaultPublicKeyPath(): string {
  return path.join(getDefaultKeyDir(), "evidence-ed25519.pub.pem");
}

/**
 * 严格校验私钥文件安全性（0400 权限及路径隔离）
 */
export function assertPrivateKeySecurity(
  keyPath: string,
  repoRoot?: string,
): void {
  // 1. 绝对禁止将私钥存放在工作区或 Evidence 目录下
  if (repoRoot) {
    const resolvedKey = path.resolve(keyPath);
    const resolvedRepo = path.resolve(repoRoot);
    if (
      resolvedKey.startsWith(resolvedRepo) ||
      resolvedKey.includes(".stagent/evidence")
    ) {
      throw new Error(
        `E_PRIVATE_KEY_LOCATION_INSECURE: Private key must not reside within repository or evidence directory: ${keyPath}`,
      );
    }
  }

  if (!fs.existsSync(keyPath)) {
    throw new Error(`Private key file not found: ${keyPath}`);
  }

  // 2. 在非 Windows 平台检查严格的 0400 权限 (仅 owner 可读，禁止任何 write/exec 及 group/others 权限)
  if (process.platform !== "win32") {
    const stat = fs.statSync(keyPath);
    const mode = stat.mode & 0o777;
    if (mode !== 0o400) {
      throw new Error(
        `E_PRIVATE_KEY_INSECURE_PERMS: Private key file permissions are 0o${mode.toString(8)}, strictly required 0o400 (read-only by owner)`,
      );
    }
  }
}

/**
 * 保存私钥文件并严格赋予 0400 权限
 */
export function savePrivateKeyWith0400(
  keyPath: string,
  privateKeyPem: string,
): void {
  const dir = path.dirname(keyPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (fs.existsSync(keyPath)) {
    try {
      if (process.platform !== "win32") {
        fs.chmodSync(keyPath, 0o600);
      }
    } catch {
      // ignore
    }
    try {
      fs.unlinkSync(keyPath);
    } catch {
      // ignore
    }
  }
  fs.writeFileSync(keyPath, privateKeyPem, { encoding: "utf8", mode: 0o400 });
  if (process.platform !== "win32") {
    fs.chmodSync(keyPath, 0o400);
  }
}

let memoryCachedDefaultKeyPair: {
  privateKeyPem: string;
  publicKeyPem: string;
} | null = null;

/**
 * 获取或安全初始化系统私钥
 */
export function ensureDefaultKeyPair(): {
  privateKeyPem: string;
  publicKeyPem: string;
} {
  if (memoryCachedDefaultKeyPair) {
    return memoryCachedDefaultKeyPair;
  }

  const privPath =
    process.env["STAGENT_EVIDENCE_PRIVATE_KEY_PATH"] ||
    getDefaultPrivateKeyPath();
  const pubPath =
    process.env["STAGENT_EVIDENCE_PUBLIC_KEY_PATH"] ||
    getDefaultPublicKeyPath();

  if (fs.existsSync(privPath) && fs.existsSync(pubPath)) {
    try {
      assertPrivateKeySecurity(privPath);
      memoryCachedDefaultKeyPair = {
        privateKeyPem: fs.readFileSync(privPath, "utf8"),
        publicKeyPem: fs.readFileSync(pubPath, "utf8"),
      };
      return memoryCachedDefaultKeyPair;
    } catch {
      // ignore and regenerate
    }
  }

  // 如果不存在，安全初始化生成并写入
  const keyPair = generateEvidenceKeyPair();
  try {
    savePrivateKeyWith0400(privPath, keyPair.privateKeyPem);
    if (fs.existsSync(pubPath)) {
      try {
        fs.unlinkSync(pubPath);
      } catch {
        // ignore
      }
    }
    fs.writeFileSync(pubPath, keyPair.publicKeyPem, "utf8");
  } catch {
    // 降级使用内存中的有效密钥对，保障执行韧性
  }

  memoryCachedDefaultKeyPair = {
    privateKeyPem: keyPair.privateKeyPem,
    publicKeyPem: keyPair.publicKeyPem,
  };
  return memoryCachedDefaultKeyPair;
}

/**
 * 签名载荷接口
 */
export function signEvidencePayload(
  payload: unknown,
  options?: {
    privateKeyPem?: string | undefined;
    privateKeyPath?: string | undefined;
    repoRoot?: string | undefined;
  },
): EvidenceSignatureRecord {
  let privateKeyPem: string;

  if (options?.privateKeyPem) {
    privateKeyPem = options.privateKeyPem;
  } else if (process.env["STAGENT_EVIDENCE_PRIVATE_KEY_PEM"]) {
    privateKeyPem = process.env["STAGENT_EVIDENCE_PRIVATE_KEY_PEM"];
  } else {
    const keyPath =
      options?.privateKeyPath ||
      process.env["STAGENT_EVIDENCE_PRIVATE_KEY_PATH"] ||
      getDefaultPrivateKeyPath();
    if (!fs.existsSync(keyPath)) {
      // 自动初始化安全密钥对
      const pair = ensureDefaultKeyPair();
      privateKeyPem = pair.privateKeyPem;
    } else {
      assertPrivateKeySecurity(keyPath, options?.repoRoot);
      privateKeyPem = fs.readFileSync(keyPath, "utf8");
    }
  }

  const stripped = stripUnsignedFields(payload);
  const canonical = canonicalizeJson(stripped);
  const hash = crypto
    .createHash("sha256")
    .update(canonical, "utf8")
    .digest("hex");

  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const signatureBuffer = crypto.sign(
    null,
    Buffer.from(canonical, "utf8"),
    privateKey,
  );

  const publicKey = crypto.createPublicKey(privateKey);
  const publicKeyPem = publicKey.export({
    type: "spki",
    format: "pem",
  }) as string;
  const keyId = crypto
    .createHash("sha256")
    .update(publicKeyPem)
    .digest("hex")
    .slice(0, 16);

  return {
    algorithm: "Ed25519",
    signature: signatureBuffer.toString("base64"),
    canonical_hash: hash,
    key_id: keyId,
    public_key: publicKeyPem,
    signed_at: new Date().toISOString(),
  };
}

/**
 * 校验签名结果接口
 */
export interface VerificationOutcome {
  valid: boolean;
  reason?: string | undefined;
  canonical_hash?: string | undefined;
}

/**
 * 强校验 Evidence 数字签名
 */
export function verifyEvidenceSignature(
  payload: unknown,
  sigRecord: EvidenceSignatureRecord,
  options?: {
    publicKeyPem?: string | undefined;
    publicKeyPath?: string | undefined;
    expectedPublicKeyPem?: string | undefined;
  },
): VerificationOutcome {
  if (
    !sigRecord ||
    typeof sigRecord !== "object" ||
    sigRecord.algorithm !== "Ed25519" ||
    !sigRecord.signature ||
    typeof sigRecord.signature !== "string"
  ) {
    return {
      valid: false,
      reason: "Missing or malformed signature record",
    };
  }

  const stripped = stripUnsignedFields(payload);
  const canonical = canonicalizeJson(stripped);
  const currentHash = crypto
    .createHash("sha256")
    .update(canonical, "utf8")
    .digest("hex");

  if (sigRecord.canonical_hash && sigRecord.canonical_hash !== currentHash) {
    return {
      valid: false,
      reason: `Canonical payload hash mismatch (content was tampered): expected ${sigRecord.canonical_hash}, got ${currentHash}`,
      canonical_hash: currentHash,
    };
  }

  // 确定用于验签的公钥
  let publicKeyPem: string | undefined = options?.publicKeyPem;
  if (!publicKeyPem && options?.publicKeyPath) {
    if (fs.existsSync(options.publicKeyPath)) {
      publicKeyPem = fs.readFileSync(options.publicKeyPath, "utf8");
    }
  }
  if (!publicKeyPem && process.env["STAGENT_EVIDENCE_PUBLIC_KEY_PEM"]) {
    publicKeyPem = process.env["STAGENT_EVIDENCE_PUBLIC_KEY_PEM"];
  }
  if (!publicKeyPem && process.env["STAGENT_EVIDENCE_PUBLIC_KEY_PATH"]) {
    if (fs.existsSync(process.env["STAGENT_EVIDENCE_PUBLIC_KEY_PATH"])) {
      publicKeyPem = fs.readFileSync(
        process.env["STAGENT_EVIDENCE_PUBLIC_KEY_PATH"],
        "utf8",
      );
    }
  }
  if (!publicKeyPem && sigRecord.public_key) {
    publicKeyPem = sigRecord.public_key;
  }
  if (!publicKeyPem) {
    const defaultPub = getDefaultPublicKeyPath();
    if (fs.existsSync(defaultPub)) {
      publicKeyPem = fs.readFileSync(defaultPub, "utf8");
    }
  }

  if (!publicKeyPem) {
    return {
      valid: false,
      reason: "No public key available for signature verification",
      canonical_hash: currentHash,
    };
  }

  // 若传入了预期的受信公钥，校验公钥是否匹配
  if (options?.expectedPublicKeyPem) {
    const normExpected = options.expectedPublicKeyPem.trim();
    const normActual = publicKeyPem.trim();
    if (normExpected !== normActual) {
      return {
        valid: false,
        reason: "Public key mismatch against trusted public key",
        canonical_hash: currentHash,
      };
    }
  }

  try {
    const pubKey = crypto.createPublicKey(publicKeyPem);
    const signatureBytes = Buffer.from(sigRecord.signature, "base64");
    const verified = crypto.verify(
      null,
      Buffer.from(canonical, "utf8"),
      pubKey,
      signatureBytes,
    );
    if (!verified) {
      return {
        valid: false,
        reason:
          "Ed25519 cryptographic signature verification failed (invalid signature or wrong key)",
        canonical_hash: currentHash,
      };
    }
    return {
      valid: true,
      canonical_hash: currentHash,
    };
  } catch (err) {
    return {
      valid: false,
      reason: `Verification error: ${err instanceof Error ? err.message : String(err)}`,
      canonical_hash: currentHash,
    };
  }
}
