/**
 * TASK-L.17b：dec-12 结构化试玩证据 —— 浏览器侧契约（分层写死）。
 *
 * 本模块只做两件事：
 *  1) zod schema（前后端共用同一份校验）；
 *  2) submitPlaytestEvidence 客户端调用。
 *
 * 严禁在此直接读写 `.stagent/`：证据落盘、`release_id` / `timestamp` / `operator`
 * 装配全部由 Daemon `POST /api/playtest/evidence` 负责 —— 这是 dec-12 红线
 * 「AI/Worker 伪造用户认可 → FAIL」的第一道防线（服务端装配 + 原话必填）。
 */
import { z } from "zod";
import { request, type DaemonConnection } from "../daemon-api";

export const PLAYTEST_EVIDENCE_SCHEMA_VERSION = "1.0.0" as const;

/**
 * 字段分工（前后端共读）：
 *  - `release_id`：服务端从 Release Store 查当前 LIVE 记录填入，前端**不得传值**；
 *  - `timestamp`：服务端 `new Date().toISOString()` 精确 ISO；
 *  - `operator`：恒为字面量 `"user"`，服务端写死；
 *  - `user_verdict`：非空用户原话（唯一的用户侧输入，必填）。
 */
export const playtestEvidenceSchema = z.object({
  schema_version: z.literal(PLAYTEST_EVIDENCE_SCHEMA_VERSION),
  contract_id: z.string().min(1),
  release_id: z.string().min(1),
  user_verdict: z.string().min(1, "user_verdict 必须是非空原话"),
  operator: z.literal("user"),
  timestamp: z.string().datetime(),
});

export type PlaytestEvidence = z.infer<typeof playtestEvidenceSchema>;

/** 请求体：只收 contract_id + user_verdict（非空原话），其余一律服务端装配 */
export interface SubmitPlaytestEvidenceInput {
  contract_id: string;
  /** 用户认可 / 评阅原话，必填非空 */
  user_verdict: string;
}

export interface PlaytestEvidenceResponse {
  ok: true;
  evidence: PlaytestEvidence;
}

/**
 * 提交试玩认可证据。客户端只发 `contract_id` + 原话；
 * `release_id` / `timestamp` / `operator` 绝不出现在请求体里。
 * 空原话在发出前即拦下（服务端仍会再校验一次，双保险）。
 */
export async function submitPlaytestEvidence(
  conn: DaemonConnection,
  input: SubmitPlaytestEvidenceInput,
): Promise<PlaytestEvidenceResponse> {
  const verdict = input.user_verdict.trim();
  if (verdict.length === 0) {
    throw new Error("请填写你的试玩认可原话（user_verdict 不能为空）");
  }
  const contractId = input.contract_id.trim();
  if (contractId.length === 0) {
    throw new Error("contract_id 不能为空");
  }
  return request<PlaytestEvidenceResponse>(
    conn,
    "/api/playtest/evidence",
    {
      method: "POST",
      body: JSON.stringify({
        contract_id: contractId,
        user_verdict: verdict,
      }),
    },
  );
}
