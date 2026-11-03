/**
 * TASK-L.17b：dec-12 结构化试玩证据 —— Daemon 侧装配 + 原子落盘 + 请求校验。
 *
 * 分层写死：浏览器只发 `contract_id` + `user_verdict`（非空原话）；其余字段全部服务端装配。
 *
 * 红线（dec-12 逐条对应）：
 *  - 「AI/Worker 伪造用户认可 → FAIL」：服务端装配 `release_id` / `timestamp` / `operator`，
 *    请求体一旦携带任一装配字段即视为伪造并显式拒绝；`user_verdict` 必填非空。
 *  - 「release_id 必须由服务端从 Release Store 查当前 LIVE 记录填入，不接受前端传值」：
 *    `resolveCurrentLiveReleaseId()` 从 `.stagent/releases/` 解析，前端无从干预。
 *  - 原子落盘：写临时文件 + fsync + rename（照抄 `.stagent/` 的 `writeJsonAtomic` 惯例），
 *    禁裸 `writeFileSync(finalPath, ...)`。
 */
import fs from "node:fs";
import path from "node:path";
import {
  playtestEvidenceSchema,
  PLAYTEST_EVIDENCE_SCHEMA_VERSION,
  type PlaytestEvidence,
} from "../../src/lib/journey/playtest-evidence";
import { writeJsonAtomic } from "../../src/lib/state-machine";
import { resolveCurrentLiveReleaseId } from "../release/active-live";

export const EVIDENCE_DIR_REL = ".stagent/evidence";

export const E_EVIDENCE_CONTRACT_REQUIRED = "E_PLAYTEST_CONTRACT_REQUIRED";
export const E_EVIDENCE_VERDICT_REQUIRED = "E_PLAYTEST_VERDICT_REQUIRED";
export const E_EVIDENCE_FORGED_FIELD = "E_PLAYTEST_FORGED_FIELD";
export const E_NO_ACTIVE_RELEASE = "E_PLAYTEST_NO_ACTIVE_RELEASE";

/** 服务端装配字段：请求体一旦出现即判定为伪造 */
export const SERVER_ASSEMBLED_FIELDS = [
  "release_id",
  "timestamp",
  "operator",
] as const;

/** 带 `code` 的领域错误，供 HTTP 路由统一映射状态码 */
export class PlaytestEvidenceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "PlaytestEvidenceError";
    this.code = code;
  }
}

export function evidenceDir(repoRoot: string): string {
  return path.join(path.resolve(repoRoot), EVIDENCE_DIR_REL);
}

/**
 * 合同 ID 路径安全归一函数（防目录穿越与特殊字符破损）。
 *
 * 读侧（`readContractReferences`）与写侧（`playtestEvidencePath` / `playtestHistoryPath`）
 * 严格共用此归一函数，消除两套口径，保证含特殊字符 ID 的读写一致性（OP-37）。
 */
export function normalizeContractId(contractId: string): string {
  return contractId.replace(/[^A-Za-z0-9._-]/g, "_");
}

/** 证据文件路径；对 contract_id 做路径安全归一，防目录穿越 */
export function playtestEvidencePath(
  repoRoot: string,
  contractId: string,
): string {
  const safe = normalizeContractId(contractId);
  return path.join(evidenceDir(repoRoot), `playtest-${safe}.json`);
}

/** 证据历史追加文件路径（OP-38）；与主文件保持相同归一口径 */
export function playtestHistoryPath(
  repoRoot: string,
  contractId: string,
): string {
  const safe = normalizeContractId(contractId);
  return path.join(evidenceDir(repoRoot), `playtest-${safe}.history.jsonl`);
}

export interface PlaytestEvidenceRequestBody {
  contract_id?: unknown;
  user_verdict?: unknown;
  release_id?: unknown;
  timestamp?: unknown;
  operator?: unknown;
}

/**
 * 纯校验：请求体只收 `contract_id` + `user_verdict`。
 * 任何服务端装配字段出现 → 伪造，显式拒绝（不静默忽略，便于审计与测试断言）。
 */
export function validatePlaytestEvidenceRequest(
  body: PlaytestEvidenceRequestBody,
): { contract_id: string; user_verdict: string } {
  for (const field of SERVER_ASSEMBLED_FIELDS) {
    if (body[field] !== undefined) {
      throw new PlaytestEvidenceError(
        E_EVIDENCE_FORGED_FIELD,
        `${field} 由服务端装配，前端不得传值（伪造请求被拒绝）`,
      );
    }
  }
  const contractId =
    typeof body.contract_id === "string" ? body.contract_id.trim() : "";
  if (contractId.length === 0) {
    throw new PlaytestEvidenceError(
      E_EVIDENCE_CONTRACT_REQUIRED,
      "contract_id 必填",
    );
  }
  const verdict =
    typeof body.user_verdict === "string" ? body.user_verdict.trim() : "";
  if (verdict.length === 0) {
    throw new PlaytestEvidenceError(
      E_EVIDENCE_VERDICT_REQUIRED,
      "user_verdict 必须是非空的用户认可原话",
    );
  }
  return { contract_id: contractId, user_verdict: verdict };
}

/**
 * 服务端装配 + 原子落盘。
 *
 * - `release_id`：从 Release Store 当前 LIVE 记录查得（绝不接受前端传值）；
 * - `timestamp`：服务端 `new Date().toISOString()` 精确 ISO；
 * - `operator`：恒为 `"user"`；
 * - 落盘前用共用 schema 自检，保证写入的必是完整证据。
 */
export function assembleAndStorePlaytestEvidence(input: {
  repoRoot: string;
  contract_id: string;
  user_verdict: string;
  now?: () => Date;
}): PlaytestEvidence {
  const releaseId = resolveCurrentLiveReleaseId(
    input.repoRoot,
    input.contract_id,
  );
  if (releaseId === null) {
    throw new PlaytestEvidenceError(
      E_NO_ACTIVE_RELEASE,
      "当前没有 LIVE 发布，无法装配 release_id；请先发布再提交试玩认可",
    );
  }
  const verdict = input.user_verdict.trim();
  if (verdict.length === 0) {
    throw new PlaytestEvidenceError(
      E_EVIDENCE_VERDICT_REQUIRED,
      "user_verdict 必须是非空的用户认可原话",
    );
  }
  const now = input.now ?? (() => new Date());
  const record: PlaytestEvidence = {
    schema_version: PLAYTEST_EVIDENCE_SCHEMA_VERSION,
    contract_id: input.contract_id,
    release_id: releaseId,
    user_verdict: verdict,
    operator: "user",
    timestamp: now().toISOString(),
  };
  const validated = playtestEvidenceSchema.parse(record);
  // 照抄 `.stagent/records/` / `.stagent/contracts/` 原子惯例：
  // 临时文件 → fsync → rename → 目录项 fsync；禁裸 writeFileSync(finalPath)。
  writeJsonAtomic(
    playtestEvidencePath(input.repoRoot, input.contract_id),
    validated,
  );

  /**
   * OP-38 历史链增强：追加写 .history.jsonl。
   *
   * 一致性边界说明（审计面 vs 权威面）：
   * 1. 权威性（SSOT）：主证据文件（playtest-{id}.json）是当前有效认可的唯一事实源。
   *    门禁判定（`evaluatePlaytestGuard`）及核心业务状态流转只读主证据文件。
   * 2. 两步落盘一致性：先通过 writeJsonAtomic 原子覆盖主文件，后追加写入 history 文件。
   *    若两步之间发生掉电/进程崩溃，可能出现「主文件已更新但 history 缺少末次记录」的极端情况；
   *    history 仅作为审计追踪增强面，非阻断性权威面，接受此最终一致性边界。
   * 3. 并发原子追加：落盘内容强制为单行 JSON（无未转义内嵌换行），末尾追加单个 \n。
   *    单行紧凑写入保证在 POSIX / 单进程追加场景下的完整性。
   */
  const historyFile = playtestHistoryPath(input.repoRoot, input.contract_id);
  const singleLineJson = JSON.stringify(validated);
  if (singleLineJson.includes("\n") || singleLineJson.includes("\r")) {
    throw new Error(
      "Serialized evidence must be a single line JSON without raw newlines",
    );
  }
  fs.mkdirSync(path.dirname(historyFile), { recursive: true });
  fs.appendFileSync(historyFile, `${singleLineJson}\n`, "utf-8");

  return validated;
}

/**
 * OP-38：读取指定合同的历史认可记录序列（按写入先后顺序，由旧到新）。
 * 损坏的单行记录会被跳过；文件不存在返回空数组。
 */
export function readPlaytestEvidenceHistory(
  repoRoot: string,
  contractId: string,
): PlaytestEvidence[] {
  const file = playtestHistoryPath(repoRoot, contractId);
  if (!fs.existsSync(file)) return [];
  try {
    const content = fs.readFileSync(file, "utf-8");
    const records: PlaytestEvidence[] = [];
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const raw = JSON.parse(trimmed) as unknown;
        const parsed = playtestEvidenceSchema.safeParse(raw);
        if (parsed.success) {
          records.push(parsed.data);
        }
      } catch {
        // 忽略单行损坏内容
      }
    }
    return records;
  } catch {
    return [];
  }
}

/** 读原始证据（不存在 / 损坏时 value=null，交由门禁区分 UNCONFIRMED / INVALID） */
export function readPlaytestEvidenceRaw(
  repoRoot: string,
  contractId: string,
): { exists: boolean; value: unknown } {
  const file = playtestEvidencePath(repoRoot, contractId);
  if (!fs.existsSync(file)) return { exists: false, value: null };
  try {
    return {
      exists: true,
      value: JSON.parse(fs.readFileSync(file, "utf-8")) as unknown,
    };
  } catch {
    return { exists: true, value: null };
  }
}

export interface PlaytestEvidenceHttpResult {
  status: number;
  body: unknown;
}

/**
 * 路由可复用判定（HTTP 与单测共用，不依赖真实 server 实例）。
 * 服务端拒绝语义在此收敛：400 = 伪造/缺字段，409 = 无活跃版本，201 = 落盘成功。
 */
export function handlePlaytestEvidenceRequest(
  repoRoot: string,
  rawBody: unknown,
  now?: () => Date,
): PlaytestEvidenceHttpResult {
  const body = (
    rawBody && typeof rawBody === "object" ? rawBody : {}
  ) as PlaytestEvidenceRequestBody;
  try {
    const validated = validatePlaytestEvidenceRequest(body);
    const evidence = assembleAndStorePlaytestEvidence({
      repoRoot,
      contract_id: validated.contract_id,
      user_verdict: validated.user_verdict,
      ...(now === undefined ? {} : { now }),
    });
    return { status: 201, body: { ok: true, evidence } };
  } catch (err) {
    if (err instanceof PlaytestEvidenceError) {
      const status = err.code === E_NO_ACTIVE_RELEASE ? 409 : 400;
      return { status, body: { error: err.message, code: err.code } };
    }
    return {
      status: 500,
      body: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}
