import type { SoftwareContract } from "./contract.schema";
import type { EvidenceBundle } from "./evidence.schema";
import type { SupervisorProposalV1, TaskGraph } from "./graph/task-graph";
import type { DemoGate, SchemeDraft } from "./journey/scheme-draft";
import type {
  ScopePlan,
  ScopePlanDecisions,
} from "./journey/scope-plan";

/**
 * Daemon REST 客户端（浏览器侧唯一数据入口）。
 * 规范 §1：浏览器不维护虚拟仓库、不执行命令，只呈现 Daemon 状态。
 */
export const DEFAULT_DAEMON_URL = "http://127.0.0.1:3001";
export const TOKEN_STORAGE_KEY = "stagent.sessionToken";

export interface DaemonConnection {
  baseUrl: string;
  token: string;
}

export interface DaemonHealth {
  status: "ok" | "stopping";
  version: string;
  pid: number;
  port: number;
  repoRoot: string;
  /** 主工作区真实分支（P.1 顺手修） */
  currentBranch?: string | null;
  uptime: number;
}

export class DaemonApiError extends Error {
  readonly status: number;
  /** Daemon JSON `code`（如 E_SCOPE_PLAN_DRIFT）；无则 undefined。 */
  readonly code?: string;
  /** 原始错误体，漂移时含 `scope_plan`。 */
  readonly body?: unknown;
  constructor(
    status: number,
    message: string,
    options?: { code?: string; body?: unknown },
  ) {
    super(message);
    this.name = "DaemonApiError";
    this.status = status;
    if (options?.code !== undefined) this.code = options.code;
    if (options?.body !== undefined) this.body = options.body;
  }
}

/**
 * Session Token 净化（**只做归一，不猜内容**）。
 *
 * 真实故障：用户把 `.stagent/session-token` 的内容粘进设置页时，剪贴板里常常混进
 * 换行、全角空格、零宽字符（U+200B / BOM）。这些字符一旦进到
 * `authorization: Bearer <token>` 头里，浏览器会在 fetch 入口就抛
 * `Failed to read the 'headers' property from 'RequestInit':
 *  String contains non ISO-8859-1 code point` —— 页面直接白屏报错，
 * 而且错误信息完全看不出"是 Token 粘贴脏了"。
 *
 * 这里做三件事（都是无损的）：
 * 1. NFKC 归一：全角字母/数字与 U+3000 空格 → 半角；
 * 2. 剥掉零宽/行分隔符：U+200B–200F、U+2028、U+2029、U+FEFF；
 * 3. 去掉换行/制表符与两端空白。
 */
export function normalizeSessionToken(raw: string): string {
  return (
    raw
      .normalize("NFKC")
      .replace(/[\u200B-\u200F\u2028\u2029\uFEFF]/g, "")
      .replace(/[\r\n\t]/g, "")
      // 有人把 "Bearer xxx" 整段当 Token 粘进来：这里剥掉前缀，
      // 否则会拼成 "Bearer Bearer xxx" → 401，又变成一次莫名其妙的排查
      .replace(/^Bearer\s+/i, "")
      .trim()
  );
}

/** 头值只允许 ISO-8859-1 可见字符（0x20–0xFF）；控制字符与中文一律拒绝 */
const HEADER_VALUE_PATTERN = /^[\x20-\xFF]*$/;

/**
 * 组装 `Authorization` 头值，并在**发请求之前**拦住非 ASCII。
 *
 * 为什么不是"剥掉中文照常发"：剥掉之后 Token 一定变了，服务端只会回 401
 * Unauthorized，用户会误以为"Token 过期了"，白白排查半天。这里直接抛一句
 * 能照着操作的白话错误，比一个 401 有用得多。
 */
export function authorizationHeaderValue(rawToken: string): string {
  const normalized = normalizeSessionToken(rawToken);
  const ascii = normalized.replace(/[^\x20-\x7E]/g, "");
  if (ascii !== normalized) {
    const offender = Array.from(normalized).find(
      (ch) => !/^[\x20-\x7E]$/.test(ch),
    );
    throw new Error(
      `Session Token 里混入了非 ASCII 字符 ${JSON.stringify(offender)}——` +
        "浏览器不允许把中文/全角符号放进请求头。请到「设置 → Session Token」" +
        "重新复制 .stagent/session-token 的内容（只复制那一串十六进制，不要带注释或换行）。",
    );
  }
  return `Bearer ${ascii}`;
}

/** 兜底守卫：任何 header 值越界都在这里报错，报错里带 header 名便于定位 */
export function assertHeaderValueSafe(name: string, value: string): void {
  if (!HEADER_VALUE_PATTERN.test(value)) {
    throw new Error(
      `请求头 ${name} 的值含非 Latin-1 字符，无法交给 fetch（多为把中文当成了头字段）。` +
        "请把这段内容放进请求体 JSON，而不是 header。",
    );
  }
}

/**
 * Daemon 地址归一：去零宽、NFKC、去两端空白、去尾部斜杠。
 * 尾部斜杠会让 `${baseUrl}/api/contracts` 变成 `//api/contracts`，
 * Daemon 按 pathname 精确匹配，于是全体接口莫名 404 —— 顺手在这里掐掉。
 */
export function normalizeBaseUrl(raw: string): string {
  const cleaned = raw
    .normalize("NFKC")
    .replace(/[\u200B-\u200F\uFEFF]/g, "")
    .trim()
    .replace(/\/+$/, "");
  return cleaned.length > 0 ? cleaned : DEFAULT_DAEMON_URL;
}

/**
 * 解析 URL fragment 引导参数（TASK-D.1 / D.1b）。
 * 形态：`#token=<hex>` 或 `#token=<hex>&base=<urlencoded daemon origin>`。
 * 严禁读取 `?token=` query。
 */
export function parseFragmentBootstrap(hash: string): {
  token: string | null;
  baseUrl: string | null;
} {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return { token: null, baseUrl: null };
  // 兼容历史纯 `#token=xxx`（无其它键）与带 base 的形态
  const params = new URLSearchParams(raw);
  const tokenRaw = params.get("token");
  const baseRaw = params.get("base");
  return {
    token: tokenRaw ? normalizeSessionToken(tokenRaw) : null,
    baseUrl: baseRaw ? normalizeBaseUrl(baseRaw) : null,
  };
}

/**
 * 同源托管推断：控制台由 Daemon 直接托管在 3001~3010 时，
 * 用 window.location.origin 作为 baseUrl，避免死认 3001。
 * Vite 开发端口（5173）不走此分支。
 */
export function inferSameOriginDaemonBase(
  loc: Pick<Location, "hostname" | "port" | "origin"> = window.location,
): string | null {
  const host = loc.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost") return null;
  const port = Number(loc.port || (host === "localhost" ? "80" : "80"));
  if (!Number.isFinite(port)) return null;
  if (port < 3001 || port > 3010) return null;
  return loc.origin;
}

export function loadConnection(): DaemonConnection {
  // SSR 阶段无 window：返回默认连接，避免服务端渲染崩溃
  if (typeof window === "undefined") {
    return { baseUrl: DEFAULT_DAEMON_URL, token: "" };
  }

  // Token / base 引导仅允许 URL fragment：不随请求发往服务端、不进访问日志；
  // 读取后立即从地址栏抹除，避免滞留浏览器历史。
  // 规范 TASK-D.1 FAIL：严禁 URL query（?token=）传递 Token —— 这里明确不读 query。
  const boot = parseFragmentBootstrap(window.location.hash);
  if (boot.token) {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, boot.token);
  }
  if (boot.baseUrl) {
    sessionStorage.setItem("stagent.baseUrl", boot.baseUrl);
  }
  if (boot.token || boot.baseUrl) {
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
  }

  // 自动化预览回放（如 Playwright storageState）只能预置 localStorage，不支持
  // sessionStorage。没有 fragment 引导且 sessionStorage 为空时，退回
  // localStorage 作为一次性引导源，仍统一落回 sessionStorage 走原有逻辑——
  // 不改变鉴权本身，Token 仍必须通过服务端 AUTH 校验。
  if (!boot.token && !sessionStorage.getItem(TOKEN_STORAGE_KEY)) {
    const seedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (seedToken) sessionStorage.setItem(TOKEN_STORAGE_KEY, seedToken);
  }
  if (!boot.baseUrl && !sessionStorage.getItem("stagent.baseUrl")) {
    const seedBase = localStorage.getItem("stagent.baseUrl");
    if (seedBase) sessionStorage.setItem("stagent.baseUrl", seedBase);
  }

  const storedBase = sessionStorage.getItem("stagent.baseUrl");
  const envBase = import.meta.env["VITE_DAEMON_URL"] as string | undefined;
  const sameOrigin = inferSameOriginDaemonBase();
  // 同源托管时：若地址栏带来了 token，顺便把 origin 写入，刷新后仍连对本机端口
  if (!storedBase && sameOrigin && boot.token) {
    sessionStorage.setItem("stagent.baseUrl", sameOrigin);
  }

  return {
    baseUrl: normalizeBaseUrl(
      sessionStorage.getItem("stagent.baseUrl") ??
        envBase ??
        sameOrigin ??
        DEFAULT_DAEMON_URL,
    ),
    // 历史遗留的脏 Token 在这里就洗一遍，避免带着换行/全角空格一路走到 fetch
    token: normalizeSessionToken(
      sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? "",
    ),
  };
}

export function saveConnection(conn: DaemonConnection): void {
  sessionStorage.setItem("stagent.baseUrl", normalizeBaseUrl(conn.baseUrl));
  // 落盘前归一：宁可在输入时悄悄修好全角/换行，也不要让脏 Token 进请求头
  sessionStorage.setItem(TOKEN_STORAGE_KEY, normalizeSessionToken(conn.token));
}

/** 组装最终交给 fetch 的 headers：Token 归一 + 逐项 ASCII 守卫 */
function buildRequestHeaders(
  conn: DaemonConnection,
  extra: HeadersInit | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: authorizationHeaderValue(conn.token),
  };
  if (extra !== undefined) {
    const entries: Array<[string, string]> =
      extra instanceof Headers
        ? Array.from(extra.entries())
        : Array.isArray(extra)
          ? extra.map(([name, value]) => [name, value] as [string, string])
          : Object.entries(extra);
    for (const [name, value] of entries) {
      headers[name.toLowerCase()] = value;
    }
  }
  for (const [name, value] of Object.entries(headers)) {
    assertHeaderValueSafe(name, value);
  }
  return headers;
}

async function request<T>(
  conn: DaemonConnection,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${normalizeBaseUrl(conn.baseUrl)}${path}`, {
    ...init,
    headers: buildRequestHeaders(conn, init.headers),
  });

  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : {};
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    let code: string | undefined;
    if (typeof body === "object" && body) {
      const rec = body as { message?: unknown; error?: unknown; code?: unknown };
      if (typeof rec.message === "string" && rec.message.trim()) {
        message = rec.message;
      } else if ("error" in rec) {
        message = String(rec.error);
      }
      if (typeof rec.code === "string" && rec.code.trim()) {
        code = rec.code;
      }
    }
    throw new DaemonApiError(res.status, message, {
      ...(code ? { code } : {}),
      body,
    });
  }
  return body as T;
}

export async function fetchHealth(
  conn: DaemonConnection,
): Promise<DaemonHealth> {
  const res = await fetch(`${normalizeBaseUrl(conn.baseUrl)}/health`);
  if (!res.ok) throw new DaemonApiError(res.status, `health ${res.status}`);
  return (await res.json()) as DaemonHealth;
}

/** TASK-D.1c：本机最近工作区（用户级配置，非业务仓） */
export interface RecentProjectItem {
  path: string;
  name: string;
  lastOpenedAt: string;
}

export interface OpenRecentProjectResult {
  path: string;
  port: number;
  reused: boolean;
  sameOrigin: boolean;
  uiUrl: string;
  /** 带 #token= 的控制台地址；前端应导航至此，勿手拷 Token */
  launchUrl: string;
}

export async function fetchRecentProjects(
  conn: DaemonConnection,
): Promise<RecentProjectItem[]> {
  const body = await request<{ items: RecentProjectItem[] }>(
    conn,
    "/api/recent-projects",
  );
  return body.items ?? [];
}

export async function openRecentProject(
  conn: DaemonConnection,
  projectPath: string,
): Promise<OpenRecentProjectResult> {
  return request<OpenRecentProjectResult>(conn, "/api/recent-projects/open", {
    method: "POST",
    body: JSON.stringify({ path: projectPath }),
  });
}

/**
 * TASK-C.8c：粘贴绝对路径打开（与 openRecentProject 同权；需已持有 Token）。
 * Daemon 侧允许「当前 / 最近 / 已存在目录」；不含系统选择器。
 */
export async function openWorkspaceByPath(
  conn: DaemonConnection,
  projectPath: string,
): Promise<OpenRecentProjectResult> {
  return openRecentProject(conn, projectPath);
}

/**
 * TASK-C.8c：无钥匙冷开自救——不带 Authorization，仅唤起「当前」Daemon 工作区。
 * 成功后用返回的 launchUrl（含 #token=）整页跳转；调用方勿把 Token 打进日志/UI。
 */
export async function relaunchCurrentSession(
  baseUrl?: string,
): Promise<OpenRecentProjectResult> {
  const url = `${normalizeBaseUrl(baseUrl ?? loadConnection().baseUrl)}/api/session/relaunch`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  const textBody = await res.text();
  const body = textBody ? (JSON.parse(textBody) as unknown) : {};
  if (!res.ok) {
    const message =
      typeof body === "object" && body && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new DaemonApiError(res.status, message);
  }
  return body as OpenRecentProjectResult;
}

export async function listContracts(
  conn: DaemonConnection,
): Promise<SoftwareContract[]> {
  const body = await request<{ contracts: SoftwareContract[] }>(
    conn,
    "/api/contracts",
  );
  return body.contracts;
}

export async function createContract(
  conn: DaemonConnection,
  contract: SoftwareContract,
): Promise<SoftwareContract> {
  const body = await createContractWithAdmission(conn, contract);
  return body.contract;
}

export async function createContractWithAdmission(
  conn: DaemonConnection,
  contract: SoftwareContract,
  options?: { confirmationId?: string },
): Promise<{ contract: SoftwareContract; admission: AdmissionView | null }> {
  const body = await request<{
    contract: SoftwareContract;
    admission?: AdmissionView | null;
  }>(conn, "/api/contracts", {
    method: "POST",
    body: JSON.stringify({
      contract,
      ...(options?.confirmationId
        ? { confirmation_id: options.confirmationId }
        : {}),
    }),
  });
  return { contract: body.contract, admission: body.admission ?? null };
}

// ---------------------------------------------------------------------------
// TASK-D.2 / C.2：审批准入裁决（合同 Scope × 保护清单）
// ---------------------------------------------------------------------------

export type AdmissionDecisionView =
  "AUTO_APPROVED" | "NEEDS_APPROVAL" | "SKIPPED" | "AUTO_APPROVAL_FAILED";

/**
 * `POST /api/contracts/:id/admit` 的返回。
 * - `AUTO_APPROVED`：无交集（或本轮已授权）→ 已自动批准并推进，前端不弹任何东西；
 * - `NEEDS_APPROVAL`：有交集 → 前端至多弹一张白话卡，等用户点「同意」；
 * - `SKIPPED`：合同已不在待审批态，重复调用无副作用；
 * - `AUTO_APPROVAL_FAILED`：自动批准没走完（准备阶段失败等），如实告知用户。
 */
export interface AdmissionView {
  decision: AdmissionDecisionView;
  contract: SoftwareContract;
  reason?: string | undefined;
  protectedFiles: string[];
  entryNames: string[];
  /** NEEDS_APPROVAL 时的待审批卡 id；点「同意」前先用它记录本轮放行 */
  cardId?: string | undefined;
}

/** 显式准入裁决：用户在确认卡上点「同意」后调用；创建合同时 Daemon 已自动跑过一次 */
export async function admitContract(
  conn: DaemonConnection,
  contractId: string,
): Promise<AdmissionView> {
  const body = await request<{
    contract: SoftwareContract;
    admission: AdmissionView;
  }>(conn, `/api/contracts/${encodeURIComponent(contractId)}/admit`, {
    method: "POST",
  });
  return body.admission;
}

export async function approveContract(
  conn: DaemonConnection,
  contractId: string,
  reviewer: string,
  options?: { confirmationId?: string },
): Promise<SoftwareContract> {
  const body = await request<{ contract: SoftwareContract }>(
    conn,
    `/api/contracts/${encodeURIComponent(contractId)}/approve`,
    {
      method: "POST",
      body: JSON.stringify({
        reviewer,
        ...(options?.confirmationId
          ? { confirmation_id: options.confirmationId }
          : {}),
      }),
    },
  );
  return body.contract;
}

/** 断点续跑：PENDING_RESUME → EXECUTING（Daemon 侧校验 Worktree 健康） */
export async function resumeContract(
  conn: DaemonConnection,
  contractId: string,
): Promise<SoftwareContract> {
  const body = await request<{ contract: SoftwareContract }>(
    conn,
    `/api/contracts/${encodeURIComponent(contractId)}/resume`,
    { method: "POST" },
  );
  return body.contract;
}

/** 主动中止/驳回：强杀在途进程树、清理 Worktree，合同流转终态 ABORTED */
export async function abortContract(
  conn: DaemonConnection,
  contractId: string,
  reviewer: string,
  reason?: string,
): Promise<SoftwareContract> {
  const body = await request<{ contract: SoftwareContract }>(
    conn,
    `/api/contracts/${encodeURIComponent(contractId)}/abort`,
    {
      method: "POST",
      body: JSON.stringify({ reviewer, ...(reason ? { reason } : {}) }),
    },
  );
  return body.contract;
}

export async function executeContract(
  conn: DaemonConnection,
  contractId: string,
): Promise<{ contract: SoftwareContract; evidence: EvidenceBundle }> {
  return request<{ contract: SoftwareContract; evidence: EvidenceBundle }>(
    conn,
    `/api/contracts/${encodeURIComponent(contractId)}/execute`,
    { method: "POST" },
  );
}

export interface WorkerRunResult {
  applied: boolean;
  changes: Array<{ path: string; content: string }>;
  log: string[];
  usage: { inputTokens: number; outputTokens: number };
  blockers: Array<{ code: string; message: string }>;
}

export async function runWorker(
  conn: DaemonConnection,
  contractId: string,
): Promise<WorkerRunResult> {
  const body = await request<{ result: WorkerRunResult }>(
    conn,
    `/api/contracts/${encodeURIComponent(contractId)}/run-worker`,
    { method: "POST" },
  );
  return body.result;
}

export interface EditorLaunchResult {
  launched: boolean;
  worktreePath: string;
  reason?: string;
  message?: string;
  command?: string;
}

export async function openEditor(
  conn: DaemonConnection,
  contractId: string,
): Promise<EditorLaunchResult> {
  const body = await request<{ result: EditorLaunchResult }>(
    conn,
    `/api/contracts/${encodeURIComponent(contractId)}/open-editor`,
    { method: "POST" },
  );
  return body.result;
}

export interface ContractDiff {
  patch: string;
  stat: string;
}

export async function fetchDiff(
  conn: DaemonConnection,
  contractId: string,
): Promise<ContractDiff> {
  return request<ContractDiff>(
    conn,
    `/api/contracts/${encodeURIComponent(contractId)}/diff`,
  );
}

/** TASK-C.5 双栏 Diff：逐文件的基线/当前内容（真实 git） */
export interface DiffFilePairView {
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed";
  before: string;
  after: string;
  binary: boolean;
  truncated: boolean;
  /** 符号链接只给目标，不返回内容 */
  symlinkTarget?: string;
  /** 真实路径逃逸出 worktree，已拒绝读取 */
  unsafe?: boolean;
}

export interface DiffFilesView {
  files: DiffFilePairView[];
  truncatedList: boolean;
}

export async function fetchDiffFiles(
  conn: DaemonConnection,
  contractId: string,
): Promise<DiffFilesView> {
  return request<DiffFilesView>(
    conn,
    `/api/contracts/${encodeURIComponent(contractId)}/diff-files`,
  );
}

/** evidenceId 省略时取该合同最新一份（刷新后恢复验收面板） */
export async function fetchEvidence(
  conn: DaemonConnection,
  contractId: string,
  evidenceId?: string,
): Promise<EvidenceBundle> {
  const suffix = evidenceId ? `/${encodeURIComponent(evidenceId)}` : "";
  const body = await request<{ evidence: EvidenceBundle }>(
    conn,
    `/api/contracts/${encodeURIComponent(contractId)}/evidence${suffix}`,
  );
  return body.evidence;
}

export interface ArchGraphPayload {
  durationMs: number;
  stats: { nodes: number; edges: number; cycles: number };
  cycles: string[][];
  graph: {
    nodes: Array<{ filePath: string; exports: string[] }>;
    edges: Array<{ from: string; to: string }>;
  };
}

export async function fetchArchGraph(
  conn: DaemonConnection,
): Promise<ArchGraphPayload> {
  return request<ArchGraphPayload>(conn, "/api/arch/graph");
}

/** TASK-C.14：项目现状基线档案 */
export interface BaselineArchivePayload {
  archive: {
    schema_version: string;
    kind: "project_baseline_archive";
    scan_id: string;
    scanned_at: string;
    tool_version: string;
    review_status: "pending_review" | "accepted" | "incomplete";
    accepted_at: string | null;
    grants_construction: false;
    phase: "idle" | "p0" | "p1" | "p2" | "done" | "failed";
    progress_copy: string;
    p0: {
      package_name: string | null;
      package_version: string | null;
      top_level_entries: string[];
      route_clues: string[];
      module_entry_clues: string[];
      scanned_paths_note: string[];
      duration_ms: number;
      timed_out: boolean;
      network_denied: true;
      dynamic_exec_denied: true;
    } | null;
    deep: {
      structure_nodes: Array<{
        id: string;
        title: string;
        kind: string;
        provenance_plain: string;
        status_plain: string;
        confidence_label: string;
      }>;
      capability_nodes: Array<{
        id: string;
        title: string;
        kind: string;
        provenance_plain: string;
        status_plain: string;
        confidence_label: string;
      }>;
      test_file_count: number;
      test_stat_note: string;
      import_edge_count: number;
      duration_ms: number;
      timed_out: boolean;
      incomplete: boolean;
    } | null;
    dirty: {
      clean: boolean;
      uncommitted: string[];
      untracked: string[];
      steward_message: string | null;
      protect_paths: string[];
      dirty_exclusions: string[];
    };
    ignore_rules: string[];
    incomplete: boolean;
    notes: string[];
  } | null;
  scanning: boolean;
  accept_label: string;
  grants_construction: false;
}

export async function fetchBaselineArchive(
  conn: DaemonConnection,
): Promise<BaselineArchivePayload> {
  return request<BaselineArchivePayload>(conn, "/api/baseline");
}

export async function rescanBaselineArchive(
  conn: DaemonConnection,
): Promise<BaselineArchivePayload> {
  return request<BaselineArchivePayload>(conn, "/api/baseline/scan", {
    method: "POST",
    body: "{}",
  });
}

export async function acceptBaselineArchive(
  conn: DaemonConnection,
  scanId?: string,
): Promise<{
  archive: BaselineArchivePayload["archive"];
  accepted: boolean;
  grants_construction: false;
  note: string;
}> {
  return request(conn, "/api/baseline/accept", {
    method: "POST",
    body: JSON.stringify(scanId ? { scan_id: scanId } : {}),
  });
}

/** C.10f 热修：资源管理器纯文件树（相对路径列表，无 AST） */
export interface RepoTreePayload {
  root: string;
  files: string[];
}

export async function fetchRepoTree(
  conn: DaemonConnection,
  contractId?: string | null,
): Promise<RepoTreePayload> {
  const q = new URLSearchParams();
  if (contractId) q.set("contract_id", contractId);
  const suffix = q.toString() ? `?${q.toString()}` : "";
  return request<RepoTreePayload>(conn, `/api/repo/tree${suffix}`);
}

/** C.10h：资源管理器删除（废纸篓优先；保护清单拦则抛 DaemonApiError 白话） */
export interface RepoDeleteResult {
  deleted: boolean;
  path: string;
  method: "trash" | "unlink";
  message: string;
}

export async function deleteRepoPath(
  conn: DaemonConnection,
  relPath: string,
  contractId?: string | null,
): Promise<RepoDeleteResult> {
  try {
    return await request<RepoDeleteResult>(conn, "/api/repo/delete", {
      method: "POST",
      body: JSON.stringify({
        path: relPath,
        ...(contractId ? { contract_id: contractId } : {}),
      }),
    });
  } catch (err) {
    // C.10h 热修：旧 Daemon 被复用时路由未挂，服务端回 {error:"Not Found"}。
    // 给老板一句能照着做的话，而不是裸 Not Found。
    if (err instanceof DaemonApiError && err.status === 404) {
      throw new DaemonApiError(
        404,
        "本机服务还是旧版，还没有删除接口。请关掉后重新打开项目，再试一次。",
      );
    }
    throw err;
  }
}

/** C.10i：新建文件 / 文件夹 */
export interface RepoCreateResult {
  created: boolean;
  path: string;
  kind: "file" | "dir";
  message: string;
}

export async function createRepoPath(
  conn: DaemonConnection,
  args: {
    parent?: string;
    name: string;
    kind: "file" | "dir";
    contractId?: string | null;
  },
): Promise<RepoCreateResult> {
  try {
    return await request<RepoCreateResult>(conn, "/api/repo/create", {
      method: "POST",
      body: JSON.stringify({
        parent: args.parent ?? "",
        name: args.name,
        kind: args.kind,
        ...(args.contractId ? { contract_id: args.contractId } : {}),
      }),
    });
  } catch (err) {
    if (err instanceof DaemonApiError && err.status === 404) {
      throw new DaemonApiError(
        404,
        "本机服务还是旧版，还没有新建接口。请关掉后重新打开项目，再试一次。",
      );
    }
    throw err;
  }
}

/** C.10i：重命名 */
export interface RepoRenameResult {
  renamed: boolean;
  from: string;
  to: string;
  message: string;
}

export async function renameRepoPath(
  conn: DaemonConnection,
  args: { from: string; to: string; contractId?: string | null },
): Promise<RepoRenameResult> {
  try {
    return await request<RepoRenameResult>(conn, "/api/repo/rename", {
      method: "POST",
      body: JSON.stringify({
        from: args.from,
        to: args.to,
        ...(args.contractId ? { contract_id: args.contractId } : {}),
      }),
    });
  } catch (err) {
    if (err instanceof DaemonApiError && err.status === 404) {
      throw new DaemonApiError(
        404,
        "本机服务还是旧版，还没有重命名接口。请关掉后重新打开项目，再试一次。",
      );
    }
    throw err;
  }
}

/** C.10i：在 Finder / 文件管理器中显示 */
export interface RepoRevealResult {
  revealed: boolean;
  path: string;
  message: string;
}

export async function revealRepoPath(
  conn: DaemonConnection,
  relPath: string,
  contractId?: string | null,
): Promise<RepoRevealResult> {
  try {
    return await request<RepoRevealResult>(conn, "/api/repo/reveal", {
      method: "POST",
      body: JSON.stringify({
        path: relPath,
        ...(contractId ? { contract_id: contractId } : {}),
      }),
    });
  } catch (err) {
    if (err instanceof DaemonApiError && err.status === 404) {
      throw new DaemonApiError(
        404,
        "本机服务还是旧版，还没有「在 Finder 中显示」接口。请关掉后重新打开项目，再试一次。",
      );
    }
    throw err;
  }
}

export interface ModelSettings {
  configured: boolean;
  model: string;
  source: "runtime" | "environment" | "none";
}

export async function fetchSettings(
  conn: DaemonConnection,
): Promise<ModelSettings> {
  const body = await request<{ settings: ModelSettings }>(
    conn,
    "/api/settings",
  );
  return body.settings;
}

export async function saveOpenAiKey(
  conn: DaemonConnection,
  apiKey: string,
  model?: string,
): Promise<ModelSettings> {
  const body = await request<{ settings: ModelSettings }>(
    conn,
    "/api/settings/openai-key",
    {
      method: "POST",
      body: JSON.stringify({
        api_key: apiKey,
        ...(model ? { model } : {}),
      }),
    },
  );
  return body.settings;
}

/** TASK-L.14：保险库名字列表（永不含明文值） */
export interface VaultListResponse {
  names: string[];
  backend: "keychain" | "file" | "memory" | null;
}

export async function fetchVaultNames(
  conn: DaemonConnection,
): Promise<VaultListResponse> {
  return request<VaultListResponse>(conn, "/api/vault");
}

export async function putVaultSecret(
  conn: DaemonConnection,
  name: string,
  value: string,
): Promise<{ ok: boolean; name: string }> {
  return request<{ ok: boolean; name: string }>(
    conn,
    `/api/vault/${encodeURIComponent(name)}`,
    {
      method: "PUT",
      body: JSON.stringify({ value }),
    },
  );
}

export async function deleteVaultSecret(
  conn: DaemonConnection,
  name: string,
): Promise<{ ok: boolean; name: string }> {
  return request<{ ok: boolean; name: string }>(
    conn,
    `/api/vault/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );
}

/** TASK-L.13：编辑器「这段为什么存在」 */
export interface TraceWhyQuote {
  qid: string;
  text: string;
}

export interface TraceWhySchemeItem {
  id: string;
  text: string;
  quotes: TraceWhyQuote[];
}

export interface TraceWhyResult {
  commit: string;
  contract_id: string;
  scheme_items: TraceWhySchemeItem[];
  scheme_items_trailer_truncated: boolean;
}

export async function fetchTraceWhy(
  conn: DaemonConnection,
  filePath: string,
  line: number,
): Promise<TraceWhyResult> {
  const q = new URLSearchParams({
    path: filePath,
    line: String(line),
  });
  return request<TraceWhyResult>(conn, `/api/trace/why?${q.toString()}`, {
    method: "GET",
  });
}

/** TASK-L.15 */
export interface ReleaseListResponse {
  releases: import("./release/release").ReleaseRecord[];
  targets: import("./release/release").ReleaseTargetConfig[];
}

export async function fetchReleases(
  conn: DaemonConnection,
): Promise<ReleaseListResponse> {
  return request<ReleaseListResponse>(conn, "/api/releases");
}

export async function createReleaseDraft(
  conn: DaemonConnection,
  body: { target_id: string; commit_sha: string },
): Promise<{ release: import("./release/release").ReleaseRecord }> {
  return request(conn, "/api/releases", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function runRelease(
  conn: DaemonConnection,
  releaseId: string,
): Promise<{ release: import("./release/release").ReleaseRecord }> {
  return request(
    conn,
    `/api/releases/${encodeURIComponent(releaseId)}/run`,
    { method: "POST", body: "{}" },
  );
}

export async function rollbackRelease(
  conn: DaemonConnection,
  releaseId: string,
): Promise<{ release: import("./release/release").ReleaseRecord }> {
  return request(
    conn,
    `/api/releases/${encodeURIComponent(releaseId)}/rollback`,
    { method: "POST", body: "{}" },
  );
}

/** TASK-L.10：读取项目计划（含服务端权威下一份）。 */
export async function getProjectPlan(
  conn: DaemonConnection,
): Promise<{
  ok: boolean;
  plan: import("./project/project-plan").ProjectPlan;
  next_stub_id: string | null;
  next_stub: import("./project/project-plan").ContractStub | null;
}> {
  return request(conn, "/api/project/plan", { method: "GET" });
}

/** TASK-L.8：用户侧计划补丁（仅 remove_stub / reorder）。 */
export async function patchProjectPlan(
  conn: DaemonConnection,
  input: {
    patch: {
      base_revision: number;
      reason: string;
      ops: Array<Record<string, unknown>>;
    };
    removed_by?: "user" | "replan";
    scheme?: unknown;
    repo_facts?: {
      has_test_script: boolean;
      has_modules_yaml: boolean;
      existing_dirs: string[];
    };
  },
): Promise<{ ok: boolean; plan?: unknown; code?: string; discarded?: unknown }> {
  return request(conn, "/api/project/plan/patch", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** TASK-L.8：密封方案 → 计划（分解器生产入口）。 */
export async function decomposeProjectPlan(
  conn: DaemonConnection,
  input: {
    scheme: unknown;
    pab: unknown;
    repo_facts?: {
      has_test_script: boolean;
      has_modules_yaml: boolean;
      existing_dirs: string[];
    };
    project_id?: string;
  },
): Promise<{
  ok: boolean;
  plan?: unknown;
  patch?: unknown;
  model_calls?: number;
  code?: string;
  error?: string;
}> {
  return request(conn, "/api/project/plan/decompose", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface MergeResult {
  commitSha: string;
  commitMessage: string;
  contract: SoftwareContract;
  worktreeRemoved: boolean;
  /** P.1 User-First Discard：发生冲突时是否以用户主分支版本为准自动仲裁 */
  conflictResolution?: "USER_FIRST_DISCARD" | null;
  /** AI 改动全部被用户版本覆盖，没有可提交内容（不是错误） */
  nothingToMerge?: boolean;
  /** nothingToMerge 时的白话提示 */
  message?: string;
}

export async function mergeContract(
  conn: DaemonConnection,
  contractId: string,
  evidenceId: string,
  reviewer: string,
): Promise<MergeResult> {
  const body = await request<{ result: MergeResult }>(
    conn,
    `/api/contracts/${encodeURIComponent(contractId)}/merge`,
    {
      method: "POST",
      body: JSON.stringify({ evidence_id: evidenceId, reviewer }),
    },
  );
  return body.result;
}

// ---- TASK-C.6 右栏会话 ----
import type {
  ChatAdapterInfo,
  ChatSessionDetail,
  ChatSessionSummary,
} from "./chat-events";

export async function listChatAdapters(
  conn: DaemonConnection,
): Promise<ChatAdapterInfo[]> {
  return (
    await request<{ adapters: ChatAdapterInfo[] }>(conn, "/api/chat/adapters")
  ).adapters;
}

export async function listChatSessions(
  conn: DaemonConnection,
): Promise<ChatSessionSummary[]> {
  return (
    await request<{ sessions: ChatSessionSummary[] }>(
      conn,
      "/api/chat/sessions",
    )
  ).sessions;
}

export async function createChatSession(
  conn: DaemonConnection,
  adapterId: string,
): Promise<ChatSessionSummary> {
  return (
    await request<{ session: ChatSessionSummary }>(conn, "/api/chat/sessions", {
      method: "POST",
      body: JSON.stringify({ adapter_id: adapterId }),
    })
  ).session;
}

export async function getChatSession(
  conn: DaemonConnection,
  id: string,
): Promise<ChatSessionDetail> {
  return (
    await request<{ session: ChatSessionDetail }>(
      conn,
      `/api/chat/sessions/${encodeURIComponent(id)}`,
    )
  ).session;
}

export async function sendChatMessage(
  conn: DaemonConnection,
  id: string,
  text: string,
): Promise<"started" | "queued"> {
  return (
    await request<{ result: "started" | "queued" }>(
      conn,
      `/api/chat/sessions/${encodeURIComponent(id)}/messages`,
      { method: "POST", body: JSON.stringify({ text }) },
    )
  ).result;
}

export async function interruptChat(
  conn: DaemonConnection,
  id: string,
): Promise<boolean> {
  return (
    await request<{ interrupted: boolean }>(
      conn,
      `/api/chat/sessions/${encodeURIComponent(id)}/interrupt`,
      { method: "POST" },
    )
  ).interrupted;
}

// ---- TASK-C.3 编辑器读写（服务端强制校验） ----
export interface WorktreeFile {
  path: string;
  root: string;
  content: string;
  writable: boolean;
}

export async function readWorktreeFile(
  conn: DaemonConnection,
  filePath: string,
  contractId?: string | null,
): Promise<WorktreeFile> {
  const q = new URLSearchParams({ path: filePath });
  if (contractId) q.set("contract_id", contractId);
  return request<WorktreeFile>(conn, `/api/worktree/files?${q.toString()}`);
}

export async function saveWorktreeFile(
  conn: DaemonConnection,
  filePath: string,
  content: string,
  contractId?: string | null,
): Promise<void> {
  await request(conn, "/api/worktree/files", {
    method: "POST",
    body: JSON.stringify({
      path: filePath,
      content,
      ...(contractId ? { contract_id: contractId } : {}),
    }),
  });
}

// ---------------------------------------------------------------------------
// TASK-P.1 保护清单 / 本轮授权 / 撤销
// ---------------------------------------------------------------------------

export interface ProtectionEntryView {
  id: string;
  name: string;
  patterns: string[];
  createdAt: string;
}

export interface ProtectionCardView {
  id: string;
  files: string[];
  entryNames: string[];
  createdAt: string;
}

export interface ProtectionStateView {
  /** CORRUPT：清单损坏，门卫按全拦截运行（不能显示为自由模式） */
  mode: "VIBE" | "PROTECTED" | "CORRUPT";
  entries: ProtectionEntryView[];
  corrupt: string | null;
  round: {
    roundId: string;
    startedAt: string;
    pending: ProtectionCardView[];
    approvedFiles: string[];
  };
  checkpoint: { roundId: string; at: string } | null;
}

export interface ProtectionRecommendationView {
  name: string;
  patterns: string[];
  reason: string;
}

export async function fetchProtection(
  conn: DaemonConnection,
): Promise<ProtectionStateView> {
  return request<ProtectionStateView>(conn, "/api/protection");
}

export async function fetchProtectionRecommendations(
  conn: DaemonConnection,
): Promise<ProtectionRecommendationView[]> {
  const body = await request<{
    recommendations: ProtectionRecommendationView[];
  }>(conn, "/api/protection/recommendations");
  return body.recommendations;
}

export async function applyProtectionRecommendations(
  conn: DaemonConnection,
  names: string[],
): Promise<void> {
  await request(conn, "/api/protection/recommendations/apply", {
    method: "POST",
    body: JSON.stringify({ names }),
  });
}

export async function lockProtectionPath(
  conn: DaemonConnection,
  name: string,
  patterns: string[],
): Promise<void> {
  await request(conn, "/api/protection/entries", {
    method: "POST",
    body: JSON.stringify({ name, patterns }),
  });
}

export async function unlockProtectionEntry(
  conn: DaemonConnection,
  id: string,
): Promise<void> {
  await request(conn, "/api/protection/entries/remove", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

export async function decideProtectionCard(
  conn: DaemonConnection,
  cardId: string,
  decision: "approve" | "deny",
): Promise<void> {
  await request(conn, "/api/protection/decisions", {
    method: "POST",
    body: JSON.stringify({ cardId, decision }),
  });
}

// ---------------------------------------------------------------------------
// Supervisor 草案生成（POST /api/supervisor/draft）
//
// 控制面契约（任务卡 2026-10 / S.2）：
// - 请求只带一句自然语言 + 可选的圈选路径，**不落盘**（Zero-Tool 只读）；
// - 响应里的 `contract` 是 `lifecycle_state=DRAFT / approval=DRAFT` 的未落盘草案，
//   带完整 `supervisor_metadata`（白话理由 + 未决问题 + 建议范围）；
// - 预算走 `.stagent/supervisor-budget.json` **独立账本**，耗尽时端点返回 402，
//   `DaemonApiError.status === 402` 且 message 为 `BUDGET_EXHAUSTED`。
// ---------------------------------------------------------------------------

/** 草案里 L0 规则推导出的计划（与合同 Scope 同源，但保留原始形态便于展示） */
export interface SupervisorDraftPlanView {
  writable_paths: string[];
  readonly_paths: string[];
  strictly_forbidden_paths: string[];
  commands: Array<{
    alias?: string | undefined;
    executable: string;
    args: string[];
    expected_exit_code?: number | undefined;
    timeout_seconds?: number | undefined;
  }>;
  budget: Record<string, unknown>;
  protected_files: string[];
  protected_entry_names: string[];
  needs_protection_approval: boolean;
}

/** Supervisor 独立日预算快照（与 Worker 的 cost.json 无任何共享字段） */
export interface SupervisorBudgetSnapshotView {
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cost_minor_units: number;
  currency: string;
  tripped: boolean;
  max_total_tokens?: number | undefined;
  max_cost_minor_units?: number | undefined;
  remaining_tokens?: number | undefined;
}

/** L1 单次模型调用后的真实用量（纯 L0 时为 null） */
export interface SupervisorDraftUsageView {
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface SupervisorDraftResult {
  contract: SoftwareContract;
  plan: SupervisorDraftPlanView;
  /** L0 规则理由 + 可选 L1 补全理由，按序拼接 */
  rationale: string[];
  /** G-11 零丢失：L0 与 L1 未决问题按序拼接，**不去重** */
  unresolved_questions: string[];
  /** 纯 L0 恒为 0（零模型调用、零费用） */
  model_calls: number;
  usage: SupervisorDraftUsageView | null;
}

export interface SupervisorDraftResponse {
  draft: SupervisorDraftResult;
  budget: SupervisorBudgetSnapshotView;
}

/**
 * 生成一份未落盘的合同草案。
 * `enrich: true` 时 Daemon 必须已注入 L1 补全器，否则 409 `ENRICH_NOT_CONFIGURED`。
 * 省略 `enrich` 时：有注入则走 L1，无则纯 L0。前端「出草案」显式传 true，
 * 并在 409 时回退 L0。
 */

// ---------------------------------------------------------------------------
// TASK-C.2 / D.3：展示态快照 + 质疑自查
// ---------------------------------------------------------------------------

export interface PresentationStateRecordView {
  contract_id: string;
  presentation_state: string;
  lifecycle_state: string;
  approval_status: string;
  message: string;
  updated_at: string;
}

export interface PresentationStateSnapshotView {
  version: number;
  updated_at: string | null;
  contracts: Record<string, PresentationStateRecordView>;
}

/** 断线重连 / 首屏：读 `.stagent/state.json` 投影快照（GET /api/state） */
export async function fetchPresentationSnapshot(
  conn: DaemonConnection,
): Promise<PresentationStateSnapshotView> {
  return request<PresentationStateSnapshotView>(conn, "/api/state");
}

export type DisputeClassificationView =
  "IMPLEMENTATION_BUG" | "REQUIREMENT_DRIFT" | "UNATTRIBUTED";

/** POST /api/supervisor/dispute 响应里的报告（字段与 daemon 对齐，前端只读展示） */
export interface DisputeReportApiView {
  report_id: string;
  contract_id: string;
  change_request_id: string;
  challenge: string;
  classification: DisputeClassificationView;
  suggested_classification?: DisputeClassificationView | undefined;
  confidence: number;
  degraded: boolean;
  reason_code?: string | undefined;
  rationale: string[];
  plain_summary: string;
  facts: {
    challenge: string;
    keywords: string[];
    prompt: {
      session_id: string | null;
      source: string;
      original_request: string | null;
      confirmations: unknown[];
      matched_messages: unknown[];
    };
    spec: {
      snapshot_id: string;
      version: number;
      sha256: string;
      content: string;
      matched_entries: string[];
    } | null;
    code: {
      worktree_path: string;
      available: boolean;
      changed_files: string[];
      diff_stat: string;
      diff_excerpt: string;
      commit_sha: string | null;
      terminal_lines: string[];
      verification_results: Array<{
        alias: string;
        exit_code: number;
        passed: boolean;
      }>;
      evidence_id: string | null;
      tests_modified: boolean;
    };
  };
  next_action: {
    kind: "REWORK" | "REQUIREMENT_CHANGE" | "MANUAL_ARBITRATION";
    message?: string | undefined;
  };
  generated_at: string;
}

export interface DisputeSelfCheckResponse {
  report: DisputeReportApiView;
  degraded?: boolean | undefined;
  code?: string | undefined;
}

export type DisputeUserChoice = "BUG_FIX" | "REQUIREMENT_CHANGE";

export async function submitDisputeSelfCheck(
  conn: DaemonConnection,
  input: {
    contract_id: string;
    challenge: string;
    session_id?: string | undefined;
    /** 降级后用户点选：按缺陷修复 / 按新需求演进 */
    user_choice?: DisputeUserChoice | undefined;
  },
): Promise<DisputeSelfCheckResponse> {
  return request<DisputeSelfCheckResponse>(conn, "/api/supervisor/dispute", {
    method: "POST",
    body: JSON.stringify({
      contract_id: input.contract_id,
      challenge: input.challenge,
      ...(input.session_id === undefined
        ? {}
        : { session_id: input.session_id }),
      ...(input.user_choice === undefined
        ? {}
        : { user_choice: input.user_choice }),
    }),
  });
}

export async function generateSupervisorDraft(
  conn: DaemonConnection,
  input: {
    intent: string;
    context_paths?: string[] | undefined;
    enrich?: boolean | undefined;
  },
): Promise<SupervisorDraftResponse> {
  return request<SupervisorDraftResponse>(conn, "/api/supervisor/draft", {
    method: "POST",
    body: JSON.stringify({
      intent: input.intent,
      ...(input.context_paths && input.context_paths.length > 0
        ? { context_paths: input.context_paths }
        : {}),
      ...(input.enrich === true ? { enrich: true } : {}),
    }),
  });
}

export interface UndoRoundResult {
  undone: boolean;
  roundId?: string;
  restoredFrom?: string;
  deletedFiles?: string[];
  reason?: string;
}

export async function undoProtectionRound(
  conn: DaemonConnection,
): Promise<UndoRoundResult> {
  return request<UndoRoundResult>(conn, "/api/protection/undo", {
    method: "POST",
  });
}

// ---------------------------------------------------------------------------
// Task Graph（TASK-C.7 / 架构 §3.3）
// 前端只消费 Daemon 的权威快照：GET 一次做首屏兜底，之后靠
// `TASK_GRAPH_UPDATED` 帧推送。任何"本地算一下节点状态"的写法都不在这里。
// ---------------------------------------------------------------------------

export interface TaskGraphVerifyRequest {
  node_id: string;
  /**
   * OP-32-A：可选命令别名；若指定则执行并校验特定命令，缺省执行该节点全部 verification_commands。
   */
  command_alias?: string;
  /**
   * OP-32-A：验证命令退出码由 Daemon 在 Worktree 内实采（runCommand），
   * 前端不再提交 command_results / execution_exit_code / syntax_check_exit_code。
   *
   * MANUAL 仅在用户明确确认后提交；不提交代表未确认。
   */
  manual_approved?: boolean;
  /** 来源标记便于证据审计；Daemon 无法独立验证浏览器点击事件。 */
  manual_approved_source?: "ui_click";
  /** 兼容遗留调用；若携带将被 Daemon 以 E_UNAUTHORIZED_COMMAND 硬拒绝 */
  command_results?: Array<{ alias: string; exit_code: number }>;
  execution_exit_code?: number;
  expected_exit_code?: number;
  syntax_check_exit_code?: number;
  side_effects?: Array<{
    path: string;
    before_sha256: string | null;
    after_sha256: string | null;
  }>;
}

export interface TaskGraphVerifyResponse {
  illuminated: boolean;
  code?: string;
  message?: string;
  /** Scope 越界明细（仅在未点亮且存在越界时返回） */
  scope_violations?: string[];
  graph: TaskGraph;
}

/**
 * 读取当前 Task Graph。尚未建图时 Daemon 返回 404，这里归一成 null，
 * 让调用方用"空态"而不是一个红色错误横幅来迎接第一次使用。
 */
export async function fetchTaskGraph(
  conn: DaemonConnection,
  contractId?: string,
): Promise<TaskGraph | null> {
  try {
    const query =
      contractId === undefined
        ? ""
        : `?contract_id=${encodeURIComponent(contractId)}`;
    const body = await request<{ graph: TaskGraph }>(
      conn,
      `/api/graph${query}`,
    );
    return body.graph;
  } catch (err) {
    if (err instanceof DaemonApiError && err.status === 404) return null;
    throw err;
  }
}

export async function createTaskGraph(
  conn: DaemonConnection,
  proposal: SupervisorProposalV1,
): Promise<TaskGraph> {
  const body = await request<{ graph: TaskGraph }>(
    conn,
    "/api/graph/proposal",
    {
      method: "POST",
      body: JSON.stringify({ proposal }),
    },
  );
  return body.graph;
}

export async function startTaskGraphNode(
  conn: DaemonConnection,
  nodeId: string,
): Promise<TaskGraph> {
  const body = await request<{ graph: TaskGraph }>(
    conn,
    "/api/graph/nodes/start",
    { method: "POST", body: JSON.stringify({ node_id: nodeId }) },
  );
  return body.graph;
}

export async function verifyTaskGraphNode(
  conn: DaemonConnection,
  input: TaskGraphVerifyRequest,
): Promise<TaskGraphVerifyResponse> {
  return request<TaskGraphVerifyResponse>(conn, "/api/graph/verify", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function markTaskGraphStale(
  conn: DaemonConnection,
  paths: string[],
  contractId?: string,
): Promise<{ node_ids: string[]; contract_demoted: boolean }> {
  return request<{ node_ids: string[]; contract_demoted: boolean }>(
    conn,
    "/api/graph/stale",
    {
      method: "POST",
      body: JSON.stringify({
        paths,
        ...(contractId === undefined ? {} : { contract_id: contractId }),
      }),
    },
  );
}

// ---------------------------------------------------------------------------
// TASK-S.6：非技术旅程右侧唯一入口分流
// ---------------------------------------------------------------------------

export type JourneyRouteKind =
  "DISPUTE" | "REAL_PLAYTEST" | "FAST_PATH" | "MAJOR_DRAFT" | "CHAT";

export interface JourneyIntentView {
  kind: JourneyRouteKind;
  confidence: number;
  reasons: string[];
  skip_demo: boolean;
}

export interface JourneyResponse {
  intent: JourneyIntentView;
  route: JourneyRouteKind;
  plain_summary: string;
  skip_demo: boolean;
  requirements_updated: boolean;
  requirements_hint: string | null;
  suggest_viewport:
    "dispute" | "demo" | "graph" | "contract" | "playtest" | null;
  code: string | null;
  draft: SupervisorDraftResult | null;
  dispute_report: DisputeReportApiView | null;
  budget: SupervisorBudgetSnapshotView;
}

export interface ClientTraceEventInput {
  kind: string;
  ts?: string | undefined;
  cta?: string | undefined;
  viewport?: string | undefined;
  disabled_reason?: string | undefined;
  contractId?: string | undefined;
  contract_id?: string | undefined;
  sessionId?: string | undefined;
  session_id?: string | undefined;
  detail?: Record<string, unknown> | undefined;
}

/** TASK-C.17：POST /api/client-events —— UI trace 落盘 */
export async function postClientEvents(
  events: ClientTraceEventInput[],
  conn: DaemonConnection = loadConnection(),
): Promise<{ accepted: number }> {
  if (!conn.token || events.length === 0) return { accepted: 0 };
  return request<{ accepted: number }>(conn, "/api/client-events", {
    method: "POST",
    body: JSON.stringify({ events }),
  });
}

export interface JourneyHistoryTurn {
  ts: string;
  role: "user" | "assistant" | "system";
  text: string;
  contractId?: string;
  sessionId?: string;
  route?: string;
  code?: string;
}

/** TASK-C.17：GET /api/supervisor/journey —— 刷新还原旅程 */
export async function fetchJourneyHistory(
  conn: DaemonConnection,
  contractId?: string | undefined,
): Promise<{ contract_id: string | null; turns: JourneyHistoryTurn[] }> {
  const q =
    contractId && contractId.length > 0
      ? `?contract_id=${encodeURIComponent(contractId)}`
      : "";
  return request(conn, `/api/supervisor/journey${q}`);
}

/** POST /api/supervisor/journey —— 右侧一句话分流 */
export async function submitJourneyMessage(
  conn: DaemonConnection,
  input: {
    message: string;
    contract_id?: string | undefined;
    session_id?: string | undefined;
  },
): Promise<JourneyResponse> {
  return request<JourneyResponse>(conn, "/api/supervisor/journey", {
    method: "POST",
    body: JSON.stringify({
      message: input.message,
      ...(input.contract_id === undefined
        ? {}
        : { contract_id: input.contract_id }),
      ...(input.session_id === undefined
        ? {}
        : { session_id: input.session_id }),
    }),
  });
}

// ---------------------------------------------------------------------------
// TASK-S.6b：真机预览挂载
// ---------------------------------------------------------------------------

export interface RealPlaytestApiView {
  contract_id: string;
  url: string;
  port: number;
  status: "RUNNING" | "STOPPED" | "ERROR";
  owned: boolean;
  updated_at: string;
  plain_summary?: string;
  suggest_viewport?: "playtest" | null;
  message?: string;
}

export async function startRealPlaytest(
  conn: DaemonConnection,
  input: {
    contract_id: string;
    attach_url?: string | undefined;
    root_dir?: string | undefined;
    stub?: boolean | undefined;
    title?: string | undefined;
  },
): Promise<RealPlaytestApiView> {
  return request<RealPlaytestApiView>(conn, "/api/preview/real/start", {
    method: "POST",
    body: JSON.stringify({
      contract_id: input.contract_id,
      ...(input.attach_url === undefined
        ? {}
        : { attach_url: input.attach_url }),
      ...(input.root_dir === undefined ? {} : { root_dir: input.root_dir }),
      ...(input.stub === undefined ? {} : { stub: input.stub }),
      ...(input.title === undefined ? {} : { title: input.title }),
    }),
  });
}

export async function stopRealPlaytest(
  conn: DaemonConnection,
  input: { contract_id: string },
): Promise<RealPlaytestApiView> {
  return request<RealPlaytestApiView>(conn, "/api/preview/real/stop", {
    method: "POST",
    body: JSON.stringify({ contract_id: input.contract_id }),
  });
}

export async function getRealPlaytestStatus(
  conn: DaemonConnection,
  contractId: string,
): Promise<RealPlaytestApiView> {
  const q = encodeURIComponent(contractId);
  return request<RealPlaytestApiView>(
    conn,
    `/api/preview/real/status?contract_id=${q}`,
    { method: "GET" },
  );
}

// ---------------------------------------------------------------------------
// TASK-C.11b/c：隔离 Demo prototypes + 感官确认
// ---------------------------------------------------------------------------

export interface SupervisorPrototypeView {
  prototype_id: string;
  relative_root: string;
  confirmed: boolean;
  confirmed_at: string | null;
  preview_url?: string | null;
  preview_status?: "RUNNING" | "STOPPED" | "ERROR" | null;
  message?: string;
}

export async function createSupervisorPrototype(
  conn: DaemonConnection,
  input: { title?: string; prototype_id?: string },
): Promise<SupervisorPrototypeView> {
  return request<SupervisorPrototypeView>(conn, "/api/supervisor/prototype", {
    method: "POST",
    body: JSON.stringify({
      action: "create",
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.prototype_id === undefined
        ? {}
        : { prototype_id: input.prototype_id }),
    }),
  });
}

export async function confirmSupervisorPrototype(
  conn: DaemonConnection,
  input: { prototype_id: string },
): Promise<SupervisorPrototypeView> {
  return request<SupervisorPrototypeView>(conn, "/api/supervisor/prototype", {
    method: "POST",
    body: JSON.stringify({
      action: "confirm",
      prototype_id: input.prototype_id,
    }),
  });
}

export interface SchemeSnapshotView {
  snapshot_id: string;
  digest: string;
  idempotent: boolean;
}

/** TASK-C.22 / J.4：确认方案不可变快照（幂等；须带 scope_plan）。 */
export async function freezeSchemeSnapshot(
  conn: DaemonConnection,
  input: {
    confirmation_id: string;
    scheme: SchemeDraft;
    demo: DemoGate;
    decision: {
      code: string;
      message: string;
      demo_mode: "none" | "interactive" | "degraded";
    };
    scope_plan: ScopePlan;
  },
): Promise<SchemeSnapshotView> {
  return request<SchemeSnapshotView>(conn, "/api/supervisor/scheme/freeze", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** TASK-J.4：范围预检（只读、零模型、零落盘）。 */
export async function preflightScope(
  conn: DaemonConnection,
  input: {
    scheme: SchemeDraft;
    decisions?: ScopePlanDecisions;
    /** TASK-L.10 / L.9：按桩预检；缺省时 Daemon 用 nextStub */
    stub_id?: string;
  },
): Promise<{
  scope_plan: ScopePlan;
  stub_id?: string;
  next_stub_id?: string;
}> {
  return request<{
    scope_plan: ScopePlan;
    stub_id?: string;
    next_stub_id?: string;
  }>(conn, "/api/supervisor/scope/preflight", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getSupervisorPrototypeStatus(
  conn: DaemonConnection,
  prototypeId?: string,
): Promise<SupervisorPrototypeView | null> {
  const q = prototypeId
    ? `?prototype_id=${encodeURIComponent(prototypeId)}`
    : "";
  return request<SupervisorPrototypeView | null>(
    conn,
    `/api/supervisor/prototype${q}`,
    { method: "GET" },
  );
}
