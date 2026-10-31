import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { matchesAnyPattern, normalizePath } from "../../src/lib/scope";

/**
 * TASK-P.1 全局保护清单与本轮授权状态（架构规范 §0.6.3 / §0.6.5）。
 *
 * - 清单存 `.stagent/protection.json`（路径 glob + 白话名称），仅可经 UI/API 修改；
 *   清单文件自身恒受保护（自锁），AI 任何通道都改不了它。
 * - 命中行为：先拦后写；本轮多个受保护文件合并为一张白话是/否卡；同意仅覆盖卡上清单；
 *   超出清单弹补充卡（同一次授权的补充，计入 ≤2 规则）；待审批持久化，断线/重启不自动放行；
 *   门卫读取出错一律按拒绝处理（失败关闭）。
 * - 本模块只做确定性规则判定，零模型调用。
 */

export const PROTECTION_FILE_REL = ".stagent/protection.json";
export const PROTECTION_STATE_REL = ".stagent/protection-state.json";
export const PROTECTION_REQUESTS_DIR_REL = ".stagent/protection-requests";
export const SILENT_CONTRACT_LOG_REL = ".stagent/silent-contracts.jsonl";

export interface ProtectionEntry {
  id: string;
  /** 白话名称，如「登录」「支付」 */
  name: string;
  /** 仓库相对路径 glob，如 "src/auth/**" */
  patterns: string[];
  createdAt: string;
}

export interface ProtectionList {
  version: 1;
  entries: ProtectionEntry[];
}

/** 清单读取出错（损坏/不可读）——门卫必须据此按拒绝处理（失败关闭） */
export class ProtectionStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtectionStoreError";
  }
}

const EMPTY_LIST: ProtectionList = { version: 1, entries: [] };

function listPath(repoRoot: string): string {
  return path.join(repoRoot, PROTECTION_FILE_REL);
}

/** 读取保护清单；文件不存在返回空清单；文件损坏抛 ProtectionStoreError（绝不静默当空） */
export function loadProtectionList(repoRoot: string): ProtectionList {
  const file = listPath(repoRoot);
  if (!fs.existsSync(file)) return { ...EMPTY_LIST, entries: [] };
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    throw new ProtectionStoreError(`保护清单不可读：${(err as Error).message}`);
  }
  try {
    const parsed = JSON.parse(raw) as ProtectionList;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      throw new Error("结构不符合 version=1 + entries[]");
    }
    return parsed;
  } catch (err) {
    throw new ProtectionStoreError(
      `保护清单已损坏（${(err as Error).message}），按全部拦截处理；请在界面修复或删除后重建`,
    );
  }
}

/** 原子落盘（temp + rename），清单只允许经此函数修改（UI/API 通道） */
export function saveProtectionList(
  repoRoot: string,
  list: ProtectionList,
): void {
  const file = listPath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

export function addProtectionEntry(
  repoRoot: string,
  name: string,
  patterns: string[],
): ProtectionEntry {
  const list = loadProtectionList(repoRoot);
  const entry: ProtectionEntry = {
    id: `pe-${crypto.randomUUID().slice(0, 8)}`,
    name,
    patterns,
    createdAt: new Date().toISOString(),
  };
  list.entries.push(entry);
  saveProtectionList(repoRoot, list);
  return entry;
}

export function removeProtectionEntry(repoRoot: string, id: string): boolean {
  const list = loadProtectionList(repoRoot);
  const before = list.entries.length;
  list.entries = list.entries.filter((e) => e.id !== id);
  if (list.entries.length === before) return false;
  saveProtectionList(repoRoot, list);
  return true;
}

/** 清单非空 = 保护模式（PROTECTED）；为空 = 自由模式（VIBE） */
export function protectionMode(repoRoot: string): "VIBE" | "PROTECTED" {
  return loadProtectionList(repoRoot).entries.length > 0 ? "PROTECTED" : "VIBE";
}

export interface ProtectionMatch {
  hit: boolean;
  entryName?: string | undefined;
  matchedPattern?: string | undefined;
  /** 命中的是清单文件自身（自锁） */
  selfLock?: boolean | undefined;
}

/**
 * 判定一个仓库相对路径是否被保护。清单损坏时抛 ProtectionStoreError（失败关闭）。
 * relPath 应先经 normalizePath 规范化； symlink 场景由调用方先解真实路径再传入。
 */
export function matchProtected(
  repoRoot: string,
  relPath: string,
): ProtectionMatch {
  const rel = normalizePath(relPath);
  // 自锁：清单文件本身恒受保护，只能经 UI/API（saveProtectionList）修改
  if (rel === normalizePath(PROTECTION_FILE_REL)) {
    return {
      hit: true,
      entryName: "保护清单本身",
      matchedPattern: PROTECTION_FILE_REL,
      selfLock: true,
    };
  }
  const list = loadProtectionList(repoRoot);
  for (const entry of list.entries) {
    const m = matchesAnyPattern(rel, entry.patterns);
    if (m.matches) {
      return {
        hit: true,
        entryName: entry.name,
        matchedPattern: m.matchedPattern,
      };
    }
    // 目录整体改名/删除：`dir/**` 模式也要拦住 `dir` 本身
    for (const pattern of entry.patterns) {
      const base = normalizePath(pattern).replace(/\/\*\*$/, "");
      if (
        base !== normalizePath(pattern) &&
        (rel === base || rel.startsWith(`${base}/`))
      ) {
        return { hit: true, entryName: entry.name, matchedPattern: pattern };
      }
    }
  }
  return { hit: false };
}

// ---------------------------------------------------------------------------
// TASK-D.2：合同 Scope 与保护清单的交集判定（审批前守门）
// ---------------------------------------------------------------------------

/** glob 语法标记（命中则需要按「见证路径」双向求交，不能直接字符串比较） */
const GLOB_SYNTAX = /[*?[\]{}]/;
/** 见证路径占位符：用于把 glob 折成一个具体路径再做双向匹配 */
const GLOB_WITNESS = "__stagent_witness__";

function isGlobPattern(pattern: string): boolean {
  return GLOB_SYNTAX.test(pattern);
}

/**
 * 把 glob 模式折成一条「见证路径」，用于判断两个 glob 是否有交集：
 * `src/auth/**` → `src/auth/__stagent_witness__`；`.env*` → `.env__stagent_witness__`。
 * 仅用于求交，不落盘、不代表真实文件。
 */
export function witnessPath(pattern: string): string {
  const composed = normalizePath(pattern)
    .replace(/\*\*\/?/g, `${GLOB_WITNESS}/`)
    .replace(/[*?]/g, GLOB_WITNESS)
    .replace(/[{}]/g, "")
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "");
  return composed || GLOB_WITNESS;
}

export interface ProtectionIntersection {
  /** 是否存在交集（error 非空时恒为 true） */
  hit: boolean;
  /** 交集条目：合同写具体路径时给具体路径；合同写 glob 时给命中的保护规则（便于白话卡片展示） */
  files: string[];
  /** 命中的白话名称（去重） */
  entryNames: string[];
  /** 判定过程出错（清单损坏/不可读）：调用方必须按 hit=true 处理（失败关闭） */
  error?: string | undefined;
}

/**
 * 求「合同 writable_paths」与「已启用保护清单」的交集。
 *
 * 判定方式（双向见证，避免枚举文件）：
 * 1. 用合同路径的见证路径去跑 `matchProtected` —— 覆盖具体路径、目录改名/删除的基目录规则；
 * 2. 用保护规则的见证路径去匹配合同路径（合同侧写成 glob 时）；
 * 3. 合同写目录、保护写其子路径时，按目录前缀包含判定。
 *
 * 失败关闭：清单读取/匹配抛错一律返回 `hit=true` + `error`，绝不静默放行。
 */
export function intersectWithProtection(
  repoRoot: string,
  scopedPaths: string[],
): ProtectionIntersection {
  let list: ProtectionList;
  try {
    list = loadProtectionList(repoRoot);
  } catch (err) {
    return {
      hit: true,
      files: [],
      entryNames: [],
      error: (err as Error).message,
    };
  }

  const files = new Set<string>();
  const names = new Set<string>();

  try {
    // 自锁：合同把保护清单本身列为可写，等于试图改锁
    if (
      scopedPaths.some(
        (p) => normalizePath(p) === normalizePath(PROTECTION_FILE_REL),
      )
    ) {
      files.add(normalizePath(PROTECTION_FILE_REL));
      names.add("保护清单本身");
    }

    for (const raw of scopedPaths) {
      const contractPath = normalizePath(raw);
      if (!contractPath) continue;
      const contractIsGlob = isGlobPattern(contractPath);
      const contractWitness = witnessPath(contractPath);

      // ① 合同见证路径是否命中保护规则（复用 matchProtected：含自锁与基目录规则）
      const contractHit = matchProtected(repoRoot, contractWitness);
      if (contractHit.hit) {
        files.add(
          contractIsGlob
            ? (contractHit.matchedPattern ?? contractPath)
            : contractPath,
        );
        names.add(contractHit.entryName ?? "受保护路径");
      }

      for (const entry of list.entries) {
        for (const rawPattern of entry.patterns) {
          const pattern = normalizePath(rawPattern);
          if (!pattern) continue;

          // ② 保护见证路径是否落在合同 glob 内
          const protectionWitness = witnessPath(pattern);
          const contractCoversProtection = matchesAnyPattern(
            protectionWitness,
            [contractPath],
          ).matches;
          // ③ 合同写目录、保护写其子路径
          const dirCoversChild =
            !contractIsGlob &&
            (protectionWitness === contractPath ||
              protectionWitness.startsWith(`${contractPath}/`));

          if (contractCoversProtection || dirCoversChild) {
            files.add(contractIsGlob ? pattern : contractPath);
            names.add(entry.name);
          }
        }
      }
    }
  } catch (err) {
    return {
      hit: true,
      files: [...files].sort(),
      entryNames: [...names].sort(),
      error: (err as Error).message,
    };
  }

  return {
    hit: files.size > 0,
    files: [...files].sort(),
    entryNames: [...names].sort(),
  };
}

// ---------------------------------------------------------------------------
// 本轮状态：待审批卡 + 已授权清单 + 已拒绝清单（持久化，断线/重启不丢）
// ---------------------------------------------------------------------------

export interface PendingCard {
  id: string;
  /** 本轮涉及的受保护文件（仓库相对路径，已规范化） */
  files: string[];
  /** 涉及的白话名称（去重） */
  entryNames: string[];
  createdAt: string;
}

export interface ProtectionRoundState {
  roundId: string;
  startedAt: string;
  /** 待审批卡（同一时刻最多一张；补充卡 = 新文件并入或另起一张） */
  pending: PendingCard[];
  /** 本轮已授权文件（同意仅覆盖卡上清单，授权不跨轮） */
  approvedFiles: string[];
  /** 本轮已拒绝文件（AI 再碰同一文件直接拒，不重复弹卡） */
  deniedFiles: string[];
  /** 本轮门卫见过的写入路径（静默合同备案用，封顶 200 条） */
  observed: string[];
}

function statePath(repoRoot: string): string {
  return path.join(repoRoot, PROTECTION_STATE_REL);
}

function newRound(): ProtectionRoundState {
  return {
    roundId: `round-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`,
    startedAt: new Date().toISOString(),
    pending: [],
    approvedFiles: [],
    deniedFiles: [],
    observed: [],
  };
}

/**
 * 读取本轮状态；不存在则新建一轮。
 * 状态文件损坏时返回「全新空轮」：无任何授权记录 → 受保护写入全部被拦（失败关闭，
 * 待审批卡会在下一次请求时重建，永不自动放行）。
 */
export function loadRoundState(repoRoot: string): ProtectionRoundState {
  const file = statePath(repoRoot);
  try {
    if (!fs.existsSync(file)) return newRound();
    const parsed = JSON.parse(
      fs.readFileSync(file, "utf8"),
    ) as ProtectionRoundState;
    if (
      !parsed ||
      typeof parsed.roundId !== "string" ||
      !Array.isArray(parsed.pending) ||
      !Array.isArray(parsed.approvedFiles) ||
      !Array.isArray(parsed.deniedFiles)
    ) {
      return newRound();
    }
    if (!Array.isArray(parsed.observed)) parsed.observed = [];
    return parsed;
  } catch {
    return newRound();
  }
}

export function saveRoundState(
  repoRoot: string,
  state: ProtectionRoundState,
): void {
  const file = statePath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

export function hasActiveRound(repoRoot: string): boolean {
  return fs.existsSync(statePath(repoRoot));
}

/** 静默合同：后台备案本轮范围与结局，前端不弹窗、不阻断（§0.6.3） */
export function appendSilentContractRecord(
  repoRoot: string,
  record: Record<string, unknown>,
): void {
  const file = path.join(repoRoot, SILENT_CONTRACT_LOG_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(
    file,
    JSON.stringify({ at: new Date().toISOString(), ...record }) + "\n",
    "utf8",
  );
}

/** 开始一轮（若尚无进行中的轮）：建立状态 + 静默合同备案 */
export function ensureRoundStarted(
  repoRoot: string,
  trigger: string,
): ProtectionRoundState {
  const existed = hasActiveRound(repoRoot);
  const state = loadRoundState(repoRoot);
  if (!existed) {
    saveRoundState(repoRoot, state);
    appendSilentContractRecord(repoRoot, {
      kind: "round_start",
      roundId: state.roundId,
      trigger,
    });
  }
  return state;
}

/** 结束本轮：备案结局并清除状态（授权不跨轮） */
export function closeRound(
  repoRoot: string,
  outcome: "UNDONE" | "MERGED" | "DISCARDED",
): void {
  const state = loadRoundState(repoRoot);
  appendSilentContractRecord(repoRoot, {
    kind: "round_close",
    roundId: state.roundId,
    outcome,
    observed: state.observed,
  });
  try {
    fs.unlinkSync(statePath(repoRoot));
  } catch {
    // 状态文件可能已不存在
  }
}

/**
 * 登记/合并待审批卡：本轮新碰到的受保护文件并入现有待审批卡（一张卡列全部）；
 * 没有待审批卡时才新建。返回卡片与是否新建（新建 = 需要弹卡；并入已有卡 = 同一张卡更新）。
 */
export function requestApproval(
  repoRoot: string,
  files: string[],
  entryNames: string[],
): { card: PendingCard; isNew: boolean } {
  const state = loadRoundState(repoRoot);
  const normalized = files.map(normalizePath);
  const fresh = normalized.filter(
    (f) => !state.approvedFiles.includes(f) && !state.deniedFiles.includes(f),
  );
  const existing = state.pending[0];
  if (existing) {
    const merged = [...new Set([...existing.files, ...fresh])];
    const names = [...new Set([...existing.entryNames, ...entryNames])];
    if (merged.length !== existing.files.length) {
      existing.files = merged;
      existing.entryNames = names;
      saveRoundState(repoRoot, state);
    }
    return { card: existing, isNew: false };
  }
  const card: PendingCard = {
    id: `pc-${crypto.randomUUID().slice(0, 8)}`,
    files: [...new Set(fresh)],
    entryNames: [...new Set(entryNames)],
    createdAt: new Date().toISOString(),
  };
  state.pending.push(card);
  saveRoundState(repoRoot, state);
  return { card, isNew: true };
}

/** 用户裁决：同意 = 本轮放行卡上清单内文件；不同意 = 本轮再碰直接拒（不重复弹卡） */
export function decideApproval(
  repoRoot: string,
  cardId: string,
  decision: "approve" | "deny",
): PendingCard | null {
  const state = loadRoundState(repoRoot);
  const idx = state.pending.findIndex((c) => c.id === cardId);
  if (idx < 0) return null;
  const card = state.pending[idx]!;
  state.pending.splice(idx, 1);
  const target =
    decision === "approve" ? state.approvedFiles : state.deniedFiles;
  for (const f of card.files) {
    if (!target.includes(f)) target.push(f);
  }
  saveRoundState(repoRoot, state);
  appendSilentContractRecord(repoRoot, {
    kind: "approval_decision",
    roundId: state.roundId,
    cardId,
    decision,
    files: card.files,
  });
  return card;
}

// ---------------------------------------------------------------------------
// 门卫：Agent 写通道的确定性拦截（零模型调用）
// ---------------------------------------------------------------------------

export interface GateResult {
  allowed: boolean;
  reason: string;
  /** 命中保护且已登记待审批卡时，卡片 id */
  cardId?: string | undefined;
  entryName?: string | undefined;
}

/**
 * Agent 文件写入/改名/删除的统一门卫。
 * - 未命中清单 → 放行；
 * - 命中且本轮已授权（卡上清单内）→ 放行，不再弹卡；
 * - 命中且本轮已拒绝 → 直接拒，不重复弹卡；
 * - 命中且未问过 → 登记/并入待审批卡并拒绝（先拦后写）；
 * - 清单损坏/读取异常 → 按拒绝处理（失败关闭）。
 */
export function guardAgentWrite(repoRoot: string, relPath: string): GateResult {
  const rel = normalizePath(relPath);

  // 清单为空时零副作用放行：不写 protection-state.json。
  // 合同 Worktree / 未启用保护的项目不应因为一次写入就在工作区落 .stagent 状态，
  // 否则既污染被测仓库，也会让测试清理与安全删除策略互相打架。
  let entryCount: number;
  try {
    entryCount = loadProtectionList(repoRoot).entries.length;
  } catch (err) {
    return {
      allowed: false,
      reason: `门卫读取保护清单失败，按拒绝处理：${(err as Error).message}`,
    };
  }
  if (entryCount === 0 && rel !== normalizePath(PROTECTION_FILE_REL)) {
    return { allowed: true, reason: "ok" };
  }

  let match: ProtectionMatch;
  try {
    match = matchProtected(repoRoot, rel);
  } catch (err) {
    return {
      allowed: false,
      reason: `门卫读取保护清单失败，按拒绝处理：${(err as Error).message}`,
    };
  }
  const state = loadRoundState(repoRoot);
  if (!state.observed.includes(rel) && state.observed.length < 200) {
    state.observed.push(rel);
    saveRoundState(repoRoot, state);
  }
  if (!match.hit) return { allowed: true, reason: "ok" };
  if (match.selfLock) {
    return {
      allowed: false,
      reason: "保护清单本身被锁定，只能在 Stagent 界面里修改",
      entryName: match.entryName,
    };
  }
  if (state.approvedFiles.includes(rel)) {
    return { allowed: true, reason: "本轮已授权", entryName: match.entryName };
  }
  if (state.deniedFiles.includes(rel)) {
    return {
      allowed: false,
      reason: `「${match.entryName}」本轮已被你拒绝，AI 需换方案`,
      entryName: match.entryName,
    };
  }
  const { card } = requestApproval(repoRoot, [rel], [match.entryName!]);
  return {
    allowed: false,
    reason: `AI 想修改被保护的「${match.entryName}」，已在 Stagent 弹出确认卡`,
    cardId: card.id,
    entryName: match.entryName,
  };
}

/**
 * 解符号链接后的真实相对路径（防 symlink 绕过）：
 * 已存在路径按真实路径判定；不存在则判其父目录。逃逸出仓库时返回 null。
 */
export function resolveRealRel(
  repoRoot: string,
  relPath: string,
): string | null {
  const realRoot = fs.realpathSync(repoRoot);
  const abs = path.resolve(realRoot, relPath);
  let real = abs;
  try {
    real = fs.existsSync(abs)
      ? fs.realpathSync(abs)
      : path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs));
  } catch {
    real = abs;
  }
  const rel = path.relative(realRoot, real);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

/** 4 类绕过的统一注入点：原生写 / Shell / 改名删除 / 符号链接都先经此判定 */
export function guardAgentFileOperation(
  repoRoot: string,
  relPath: string,
): GateResult {
  let realRel: string | null;
  try {
    realRel = resolveRealRel(repoRoot, relPath);
  } catch (err) {
    return {
      allowed: false,
      reason: `门卫解析路径失败，按拒绝处理：${(err as Error).message}`,
    };
  }
  if (realRel === null) {
    return { allowed: false, reason: "路径逃逸出仓库，按拒绝处理" };
  }
  return guardAgentWrite(repoRoot, realRel);
}

// ---------------------------------------------------------------------------
// hook 通道请求队列（Claude Code PreToolUse hook 是独立进程，只能文件传话）
// ---------------------------------------------------------------------------

/** hook 投递拦截请求（daemon 轮询拾取并入待审批卡） */
export function enqueueProtectionRequest(
  repoRoot: string,
  files: string[],
  entryNames: string[],
): void {
  const dir = path.join(repoRoot, PROTECTION_REQUESTS_DIR_REL);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.json`,
  );
  fs.writeFileSync(
    file,
    JSON.stringify({ at: new Date().toISOString(), files, entryNames }),
    "utf8",
  );
}

/** daemon 拾取 hook 投递的请求，并入本轮待审批卡；返回是否产生了待审批卡 */
export function drainProtectionRequests(repoRoot: string): boolean {
  const dir = path.join(repoRoot, PROTECTION_REQUESTS_DIR_REL);
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return false;
  }
  let hasPending = loadRoundState(repoRoot).pending.length > 0;
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      const req = JSON.parse(fs.readFileSync(file, "utf8")) as {
        files?: string[];
        entryNames?: string[];
      };
      const { isNew } = requestApproval(
        repoRoot,
        req.files ?? [],
        req.entryNames ?? [],
      );
      hasPending =
        hasPending || isNew || loadRoundState(repoRoot).pending.length > 0;
    } catch {
      // 单条请求损坏不影响其他；留下次重试
      continue;
    } finally {
      try {
        fs.unlinkSync(file);
      } catch {
        // 忽略
      }
    }
  }
  return hasPending;
}

// ---------------------------------------------------------------------------
// 首导入推荐：固定规则扫描目录/文件名，零模型调用（P1 稿场景 A）
// ---------------------------------------------------------------------------

export interface ProtectionRecommendation {
  name: string;
  patterns: string[];
  reason: string;
}

const SCAN_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".stagent",
  "dist",
  "dist-ssr",
  ".output",
  ".tanstack",
  ".vinxi",
  ".next",
  "build",
  "coverage",
]);

const RECOMMEND_RULES: Array<{
  name: string;
  dirNames: string[];
  fileNames: string[];
  reason: string;
}> = [
  {
    name: "登录",
    dirNames: ["auth", "login", "signin", "sign-in", "account"],
    fileNames: [],
    reason: "目录名含 auth/login",
  },
  {
    name: "支付",
    dirNames: ["payment", "payments", "pay", "billing", "checkout"],
    fileNames: [],
    reason: "目录名含 payment/pay",
  },
  {
    name: "密码和密钥",
    dirNames: ["secrets", "credentials"],
    fileNames: [".env", ".env.local", ".env.production", ".env.development"],
    reason: "环境变量/密钥文件",
  },
];

/** 扫描项目（最深 3 层目录），按固定规则给出锁定建议；已被清单覆盖的不重复推荐 */
export function recommendProtections(
  repoRoot: string,
): ProtectionRecommendation[] {
  const foundDirs = new Set<string>();
  const foundFiles = new Set<string>();

  const walk = (dir: string, depth: number) => {
    if (depth > 3) return;
    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      const abs = path.join(dir, item.name);
      const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
      if (item.isDirectory()) {
        if (SCAN_SKIP_DIRS.has(item.name) || item.name.startsWith(".git"))
          continue;
        foundDirs.add(rel);
        walk(abs, depth + 1);
      } else if (item.isFile()) {
        foundFiles.add(rel);
      }
    }
  };
  walk(repoRoot, 1);

  let locked: ProtectionEntry[] = [];
  try {
    locked = loadProtectionList(repoRoot).entries;
  } catch {
    locked = [];
  }
  const alreadyLocked = (patternBase: string) =>
    locked.some((e) =>
      e.patterns.some(
        (p) =>
          p === patternBase ||
          p.startsWith(patternBase.replace(/\/\*\*$/, "") + "/"),
      ),
    );

  const recs: ProtectionRecommendation[] = [];
  for (const rule of RECOMMEND_RULES) {
    const patterns: string[] = [];
    for (const dir of [...foundDirs].sort()) {
      const base = path.posix.basename(dir).toLowerCase();
      if (rule.dirNames.includes(base)) patterns.push(`${dir}/**`);
    }
    for (const f of rule.fileNames) {
      if (foundFiles.has(f)) patterns.push(f);
    }
    if (patterns.length === 0) continue;
    if (patterns.every((p) => alreadyLocked(p))) continue;
    recs.push({ name: rule.name, patterns, reason: rule.reason });
  }
  return recs;
}
