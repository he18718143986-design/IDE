/**
 * TASK-L.17d：参考站抓取成果 → CompareView snapshots 装配。
 *
 * GET /api/playtest/reference-snapshots?contract_id=
 * 读合同 references[]，经 WebIngestProxy 受控 GET，映射为 ReferenceSnapshotView。
 * 不持久化快照库；screenshot_url 本卡恒为 null；单 URL 失败不拖垮整表。
 */
import fs from "node:fs";
import path from "node:path";
import { WebIngestProxy, extractHtmlSummary } from "../web-ingest/proxy";
import { WebIngestError } from "../web-ingest/types";
import { normalizeContractId } from "./evidence";

/** 与 CompareView.ReferenceSnapshotView 对齐（daemon 侧不依赖 React 组件） */
export interface ReferenceSnapshotView {
  reference_url: string;
  html_snapshot?: string | null | undefined;
  dom_summary?: string | null | undefined;
  screenshot_url?: string | null | undefined;
}

export const E_SNAPSHOTS_CONTRACT_REQUIRED = "E_PLAYTEST_CONTRACT_REQUIRED";
export const E_SNAPSHOTS_CONTRACT_NOT_FOUND = "E_CONTRACT_NOT_FOUND";

/** HTML 快照回传上限，避免把整页塞进 JSON 响应 */
const HTML_SNAPSHOT_MAX_CHARS = 200_000;

function contractsDir(repoRoot: string): string {
  return path.join(path.resolve(repoRoot), ".stagent", "contracts");
}

/**
 * 只读合同 references[]（与 playtest-guard 同口径：normalize + 原始名兜底）。
 * 不碰 ContractStore / 不写盘。
 */
export function readContractReferences(
  repoRoot: string,
  contractId: string,
): { exists: boolean; references: string[] } {
  const safe = normalizeContractId(contractId);
  let file = path.join(contractsDir(repoRoot), `${safe}.json`);
  if (!fs.existsSync(file) && safe !== contractId) {
    const rawFile = path.join(contractsDir(repoRoot), `${contractId}.json`);
    if (fs.existsSync(rawFile)) {
      file = rawFile;
    }
  }
  if (!fs.existsSync(file)) return { exists: false, references: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as {
      references?: unknown;
    };
    const refs = Array.isArray(raw.references)
      ? raw.references.filter(
          (r): r is string => typeof r === "string" && r.trim().length > 0,
        )
      : [];
    return { exists: true, references: refs };
  } catch {
    return { exists: true, references: [] };
  }
}

function formatSummary(html: string): string {
  const s = extractHtmlSummary(html);
  const parts: string[] = [];
  if (s.title) parts.push(`标题：${s.title}`);
  if (s.description) parts.push(`描述：${s.description}`);
  if (s.h1 && s.h1.length > 0) parts.push(`H1：${s.h1.join(" / ")}`);
  if (s.snippet) parts.push(s.snippet);
  return parts.join("\n") || "（无可用摘要）";
}

function truncateHtml(html: string): string {
  if (html.length <= HTML_SNAPSHOT_MAX_CHARS) return html;
  return `${html.slice(0, HTML_SNAPSHOT_MAX_CHARS)}\n<!-- truncated -->`;
}

function failureSnapshot(
  referenceUrl: string,
  err: unknown,
): ReferenceSnapshotView {
  let message: string;
  if (err instanceof WebIngestError) {
    message = `[${err.code}] ${err.message}`;
  } else if (err instanceof Error) {
    message = err.message;
  } else {
    message = String(err);
  }
  return {
    reference_url: referenceUrl,
    html_snapshot: null,
    dom_summary: `抓取失败：${message}`,
    screenshot_url: null,
  };
}

/**
 * 对 references[] 逐条经 WebIngestProxy 拉数并映射。
 * 白名单 = references 自身域名（与 L.17a 同口径）；失败项保留占位说明，不伪造内容。
 */
export async function ingestReferenceSnapshots(
  references: readonly string[],
  proxy: WebIngestProxy,
): Promise<ReferenceSnapshotView[]> {
  const out: ReferenceSnapshotView[] = [];
  for (const raw of references) {
    const referenceUrl = raw.trim();
    if (!referenceUrl) continue;
    try {
      const result = await proxy.fetch({
        url: referenceUrl,
        format: "html",
      });
      // 非 2xx 也诚实说明，不把错误页当成功抓取成果冒充
      if (result.status < 200 || result.status >= 300) {
        out.push({
          reference_url: referenceUrl,
          html_snapshot: null,
          dom_summary: `抓取失败：上游 HTTP ${result.status}`,
          screenshot_url: null,
        });
        continue;
      }
      const html = result.content ?? "";
      out.push({
        reference_url: referenceUrl,
        html_snapshot: truncateHtml(html),
        dom_summary: formatSummary(html),
        screenshot_url: null,
      });
    } catch (err) {
      out.push(failureSnapshot(referenceUrl, err));
    }
  }
  return out;
}

export interface BuildReferenceSnapshotsInput {
  repoRoot: string;
  contractId: string;
  /** 测试可注入；缺省按合同 references 建 WebIngestProxy */
  proxy?: WebIngestProxy | undefined;
  fetchFn?: typeof fetch | undefined;
}

export interface BuildReferenceSnapshotsResult {
  snapshots: ReferenceSnapshotView[];
  contract_exists: boolean;
  references: string[];
}

export async function buildReferenceSnapshots(
  input: BuildReferenceSnapshotsInput,
): Promise<BuildReferenceSnapshotsResult> {
  const contract = readContractReferences(input.repoRoot, input.contractId);
  if (!contract.exists) {
    return { snapshots: [], contract_exists: false, references: [] };
  }
  if (contract.references.length === 0) {
    return { snapshots: [], contract_exists: true, references: [] };
  }
  const proxy =
    input.proxy ??
    new WebIngestProxy({
      allowedDomains: [...contract.references],
      ...(input.fetchFn ? { fetchFn: input.fetchFn } : {}),
    });
  const snapshots = await ingestReferenceSnapshots(contract.references, proxy);
  return {
    snapshots,
    contract_exists: true,
    references: contract.references,
  };
}

export interface ReferenceSnapshotsHttpResult {
  status: number;
  body: unknown;
}

/**
 * 路由可复用判定（HTTP 与单测共用）。
 * 200 { snapshots } | 400 缺 contract_id | 404 合同不存在
 */
export async function handleReferenceSnapshotsRequest(
  repoRoot: string,
  contractIdRaw: string | null | undefined,
  options?: {
    proxy?: WebIngestProxy | undefined;
    fetchFn?: typeof fetch | undefined;
  },
): Promise<ReferenceSnapshotsHttpResult> {
  const contractId =
    typeof contractIdRaw === "string" ? contractIdRaw.trim() : "";
  if (!contractId) {
    return {
      status: 400,
      body: {
        error: "contract_id_required",
        code: E_SNAPSHOTS_CONTRACT_REQUIRED,
        message: "需要 contract_id",
      },
    };
  }
  try {
    const built = await buildReferenceSnapshots({
      repoRoot,
      contractId,
      ...(options?.proxy ? { proxy: options.proxy } : {}),
      ...(options?.fetchFn ? { fetchFn: options.fetchFn } : {}),
    });
    if (!built.contract_exists) {
      return {
        status: 404,
        body: {
          error: "contract_not_found",
          code: E_SNAPSHOTS_CONTRACT_NOT_FOUND,
          message: `找不到合同 ${contractId}`,
        },
      };
    }
    return {
      status: 200,
      body: { snapshots: built.snapshots },
    };
  } catch (err) {
    return {
      status: 500,
      body: {
        error: err instanceof Error ? err.message : String(err),
        code: "E_PLAYTEST_SNAPSHOTS_FAILED",
      },
    };
  }
}
