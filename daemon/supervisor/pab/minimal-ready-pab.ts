/**
 * TASK-J.50a-2：minimal ready PAB 的资格判定、零模型生成、完整文档落盘，
 * 以及从落盘结果投影 ReadyPabView。
 *
 * digest 用 Node createHash("sha256") 对落盘规范化内容（省略 baseline_digest）
 * 做小写 hex；规范化序列化复用 scheme-patch-types.stableStringify。
 * ReadyPabView 只从 store 读回结果投影，不临时拼 status=ready 对象。
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execGitSync } from "../../git/worktree-manager";
import type { SchemeDraftV2 } from "../../../src/lib/journey/scheme-patch-types";
import { stableStringify } from "../../../src/lib/journey/scheme-patch-types";
import type { ReadyPabView } from "../decomposer/decompose";
import {
  ArchitectureBaselineStoreError,
  isProjectArchitectureBaseline,
  normalizeArchitectureBaselineRecord,
  PAB_SCHEMA_VERSION,
  readCurrentArchitectureBaseline,
  readCurrentArchitectureBaselineDocument,
  writeCurrentArchitectureBaseline,
  type ProjectArchitectureBaseline,
} from "../../project/architecture-baseline-store";
import { readSchemeLedger } from "../intent-compiler/scheme-ledger-store";
import {
  SCHEME_SNAPSHOT_DIR,
  readSchemeSnapshot,
} from "../../pipeline/scheme-snapshot-store";

export type MinimalPabFailure = {
  ok: false;
  code: "E_PAB_NOT_READY";
  plain_message: string;
};

export type MinimalPabEligibility = { ok: true } | MinimalPabFailure;

export type EnsureMinimalReadyPabResult =
  { ok: true; pab: ReadyPabView; created: boolean } | MinimalPabFailure;

const MODULES_YAML_REL = path.join("docs", "system", "modules.yaml");

/**
 * 资格判定。全过才允许生成；否则白话失败关闭，不写盘。
 */
export function assessMinimalReadyPabEligibility(
  scheme: SchemeDraftV2,
): MinimalPabEligibility {
  if (scheme.frozen !== true) {
    return fail("方案还没密封，还不能生成架构基线。");
  }
  if (scheme.size_hint === "large") {
    return fail("这个需求规模较大，不能用精简架构基线，需要完整架构设计。");
  }
  if (scheme.size_hint === "tiny") {
    return fail(
      "当前需求不能按精简档跳过架构基线；登录页这类需求按标准档处理。",
    );
  }
  if (scheme.size_hint !== "standard") {
    return fail("这个需求的规模档不适合用精简架构基线。");
  }

  const visible = scheme.modules.filter((m) => m.user_visible);
  if (visible.length !== 1) {
    return fail("这个需求不是单个用户可见模块，不能用精简架构基线。");
  }
  if (scheme.modules.length !== 1) {
    return fail("这个需求涉及多个模块，不能用精简架构基线。");
  }

  const onlyModuleId = scheme.modules[0]!.id;
  for (const flow of scheme.flows) {
    for (const step of flow.steps) {
      if (step.module_id !== undefined && step.module_id !== onlyModuleId) {
        return fail("这个需求有跨模块流程，不能用精简架构基线。");
      }
    }
  }

  if (scheme.modules[0]!.kind === "change_existing") {
    return fail("这个需求会改到已有数据边界，不能用精简架构基线。");
  }
  if (scheme.modules[0]!.kind !== "new") {
    return fail("这个需求会改到已有数据边界，不能用精简架构基线。");
  }

  return { ok: true };
}

/**
 * 从台账加载资格判定用的已密封方案。内容读 state.draft；密封证明为
 * 同一 scheme_id + 修订号的已冻结快照，或台账自身 frozen===true。
 * 确认密封后交给判定表时带上 frozen: true。不用请求体或快照里的投影当内容。
 */
export function loadSealedLedgerSchemeForMinimalPab(
  projectRoot: string,
): { ok: true; scheme: SchemeDraftV2 } | MinimalPabFailure {
  const draft = readSchemeLedger(projectRoot)?.state.draft;
  if (!draft) {
    return fail("方案还没密封，还不能生成架构基线。");
  }
  const snapshotSealed = hasMatchingFrozenSnapshot(projectRoot, draft);
  if (!snapshotSealed && draft.frozen !== true) {
    return fail("方案还没密封，还不能生成架构基线。");
  }
  return { ok: true, scheme: { ...draft, frozen: true } };
}

function hasMatchingFrozenSnapshot(
  projectRoot: string,
  draft: SchemeDraftV2,
): boolean {
  const dir = path.join(projectRoot, SCHEME_SNAPSHOT_DIR);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return false;
  }
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const confirmationId = name.slice(0, -".json".length);
    const snapshot = readSchemeSnapshot(projectRoot, confirmationId);
    if (!snapshot) continue;
    if (
      snapshot.scheme.scheme_id === draft.scheme_id &&
      snapshot.scheme_revision === draft.scheme_revision
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 密封后生产入口：具备资格则零模型生成 mode=minimal、status=ready 的完整
 * PAB 文档并落盘，再从落盘结果投影 ReadyPabView。已有 ready 当前文件时
 * 不改写，直接返回其投影。不具备资格或无法读取仓库 HEAD 时失败关闭、不写盘。
 * 资格判定只读台账内容与密封证明，忽略传入的 scheme 参数。
 */
export function ensureMinimalReadyPab(input: {
  projectRoot: string;
  scheme?: SchemeDraftV2;
}): EnsureMinimalReadyPabResult {
  const loaded = loadSealedLedgerSchemeForMinimalPab(input.projectRoot);
  if (!loaded.ok) return loaded;
  const eligibility = assessMinimalReadyPabEligibility(loaded.scheme);
  if (!eligibility.ok) return eligibility;

  const existing = readCurrentArchitectureBaselineDocument(input.projectRoot);
  if (existing) {
    const view = readCurrentArchitectureBaseline(input.projectRoot);
    if (view && view.status === "ready") {
      return { ok: true, pab: view, created: false };
    }
    return fail("已经有一份架构基线，不能直接改写。");
  }

  const baseSha = readRepoHeadSha(input.projectRoot);
  if (!baseSha) {
    return fail("读不到仓库当前提交，还不能生成架构基线。");
  }

  const knowledgeDigest = readKnowledgeDigest(input.projectRoot);
  const drafted = buildMinimalReadyDocument({
    scheme: loaded.scheme,
    baseSha,
    knowledgeDigest,
  });
  const canonical = normalizeArchitectureBaselineRecord(drafted, "generate", {
    requireDigest: false,
  });
  const digest = computeArchitectureBaselineDigest(canonical);
  const toWrite = {
    ...canonical,
    baseline_digest: digest,
  } as ProjectArchitectureBaseline;

  try {
    writeCurrentArchitectureBaseline(input.projectRoot, toWrite);
  } catch (err) {
    if (err instanceof ArchitectureBaselineStoreError) {
      if (err.code === "E_PAB_REVISION_EXISTS") {
        return fail("已经有一份同样修订的架构基线，不能直接改写。");
      }
      return fail("架构基线写入失败，还不能继续拆需求。");
    }
    throw err;
  }

  const stored = readCurrentArchitectureBaseline(input.projectRoot);
  if (!stored || stored.status !== "ready") {
    return fail("架构基线写入后读不回可用结果，还不能继续拆需求。");
  }
  return { ok: true, pab: stored, created: true };
}

/**
 * decompose 未传入 pab 时的回退：先读 store；仍为空且具备资格则生产落盘再读。
 * 不具备资格或仍无 ready PAB 时返回本卡白话原因。
 */
export function resolvePabForDecompose(input: {
  projectRoot: string;
  scheme?: SchemeDraftV2;
  pab?: ReadyPabView | null;
}): { pab: ReadyPabView | null; failure?: MinimalPabFailure } {
  if (input.pab !== undefined && input.pab !== null) {
    return { pab: input.pab };
  }
  const existing = readCurrentArchitectureBaseline(input.projectRoot);
  if (existing) {
    return { pab: existing };
  }
  const ensured = ensureMinimalReadyPab({
    projectRoot: input.projectRoot,
  });
  if (!ensured.ok) {
    return { pab: null, failure: ensured };
  }
  return { pab: ensured.pab };
}

/**
 * 对落盘（或待落盘）对象计算 digest：省略 baseline_digest 后做
 * stableStringify，再 sha256 小写 hex。
 */
export function computeArchitectureBaselineDigest(value: unknown): string {
  const canonical = omitBaselineDigest(value);
  return createHash("sha256")
    .update(stableStringify(canonical), "utf8")
    .digest("hex");
}

/** 从已解析的落盘 JSON 复算 digest，并与文件中的 baseline_digest 比对。 */
export function verifyPersistedArchitectureBaselineDigest(
  parsed: unknown,
):
  | { ok: true; digest: string }
  | { ok: false; expected: string; actual: unknown } {
  const rec =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as { baseline_digest?: unknown })
      : null;
  const actual = rec?.baseline_digest;
  const expected = computeArchitectureBaselineDigest(parsed);
  if (typeof actual !== "string" || actual !== expected) {
    return { ok: false, expected, actual };
  }
  return { ok: true, digest: expected };
}

function fail(plain_message: string): MinimalPabFailure {
  return { ok: false, code: "E_PAB_NOT_READY", plain_message };
}

function omitBaselineDigest(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const rec = value as Record<string, unknown>;
  const rest: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(rec)) {
    if (key === "baseline_digest") continue;
    rest[key] = item;
  }
  return rest;
}

function readRepoHeadSha(projectRoot: string): string | null {
  try {
    const result = execGitSync(["rev-parse", "HEAD"], projectRoot);
    const sha = result.stdout.trim();
    if (result.exitCode !== 0 || !/^[0-9a-f]{40,64}$/i.test(sha)) {
      return null;
    }
    return sha.toLowerCase();
  } catch {
    return null;
  }
}

function readKnowledgeDigest(projectRoot: string): string | null {
  const file = path.join(projectRoot, MODULES_YAML_REL);
  if (!fs.existsSync(file)) return null;
  const content = fs.readFileSync(file, "utf8");
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function mapPabSource(
  source: SchemeDraftV2["modules"][number]["source"],
): ProjectArchitectureBaseline["components"][number]["source"] {
  if (
    source === "user_said" ||
    source === "user_confirmed" ||
    source === "ai_inferred"
  ) {
    return source;
  }
  return "user_confirmed";
}

function buildMinimalReadyDocument(input: {
  scheme: SchemeDraftV2;
  baseSha: string;
  knowledgeDigest: string | null;
}): Omit<ProjectArchitectureBaseline, "baseline_digest"> {
  const scheme = input.scheme;
  const module = scheme.modules[0]!;
  const componentId = `comp-${module.id}`;
  const acceptanceIds = scheme.acceptance.map((item) => item.id);
  const goalsMap = [
    ...scheme.goals.map((goal) => ({
      scheme_item_id: goal.id,
      component_ids: [componentId],
      acceptance_ids: [...acceptanceIds],
    })),
    {
      scheme_item_id: module.id,
      component_ids: [componentId],
      acceptance_ids: [...acceptanceIds],
    },
  ];
  const verificationCatalog = scheme.acceptance.map((item) => ({
    verification_id: `ver-${item.id}`,
    command_or_method: "manual",
    covers: [item.id],
  }));
  const ownsData = scheme.entities.map((entity) => entity.name);
  const dataContracts = scheme.entities.map((entity) => ({
    data_id: `data-${entity.id}`,
    owner_component_id: componentId,
    schema_or_invariant:
      entity.fields_hint.length > 0
        ? `${entity.name}: ${entity.fields_hint.join(", ")}`
        : entity.name,
    migration_policy: "新建实体，归属本模块，无已有数据迁移。",
    rollback_policy: "随本模块回滚，不保留独立数据迁移。",
  }));
  const assumptions =
    input.knowledgeDigest === null
      ? [
          {
            assumption_id: "asm-no-knowledge-base",
            statement:
              "尚无系统知识库；本基线依据已密封方案与仓库当前提交建立。",
            impact: "后续补齐知识库后，架构基线可能需要修订。",
            blocking: false,
          },
        ]
      : [];

  return {
    schema_version: PAB_SCHEMA_VERSION,
    baseline_id: `pab-${scheme.scheme_id}`,
    baseline_revision: 1,
    status: "ready",
    scheme_ref: {
      scheme_id: scheme.scheme_id,
      scheme_revision: scheme.scheme_revision,
    },
    repository_ref: {
      base_sha: input.baseSha,
      knowledge_digest: input.knowledgeDigest,
    },
    mode: "minimal",
    goals_map: goalsMap,
    components: [
      {
        component_id: componentId,
        name: module.name,
        purpose: module.purpose,
        path_hints: [],
        owns_data: ownsData,
        depends_on: [],
        must_not_depend_on: [],
        source: mapPabSource(module.source),
        evidence_refs: [],
      },
    ],
    interfaces: [],
    data_contracts: dataContracts,
    decisions: [],
    invariants: [],
    non_functional: [],
    assumptions,
    open_decisions: [],
    verification_catalog: verificationCatalog,
  };
}

export { isProjectArchitectureBaseline };
