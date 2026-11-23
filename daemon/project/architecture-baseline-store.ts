/**
 * TASK-J.50a-1：PAB 落盘与读取（`.stagent/project/architecture-baseline.json`）。
 * 旧修订归档到 `architecture-baseline.revisions/<revision>.json`；已归档文件不可改写。
 * digest 由调用方写入，本 store 原样落盘与读出，不重新计算。
 *
 * TASK-J.50a-2：允许在同一当前文件中保留完整 PAB 文档字段（扩展保留字段，
 * 不另起一套落盘路径）。对外 readCurrentArchitectureBaseline /
 * readArchitectureBaselineRevision 仍返回 ReadyPabView 投影，以保持
 * J.50a-1 已交付的读取语义；归档时复制磁盘上的完整上一份文档，
 * 而不是只归档投影后的五个字段。E_PAB_REVISION_EXISTS 行为不变。
 */

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../../src/lib/state-machine";
import type { ReadyPabView } from "../supervisor/decomposer/decompose";

export const PROJECT_DIR = ".stagent/project" as const;
export const ARCHITECTURE_BASELINE_FILENAME =
  "architecture-baseline.json" as const;
export const ARCHITECTURE_BASELINE_REVISIONS_DIR =
  "architecture-baseline.revisions" as const;

export const PAB_SCHEMA_VERSION = "1.0.0" as const;

export type ArchitectureBaselineStoreErrorCode =
  "E_PAB_INVALID" | "E_PAB_REVISION_EXISTS" | "E_PAB_UNREADABLE";

export class ArchitectureBaselineStoreError extends Error {
  readonly code: ArchitectureBaselineStoreErrorCode;

  constructor(code: ArchitectureBaselineStoreErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = "ArchitectureBaselineStoreError";
    this.code = code;
  }
}

export type PabSource =
  "observed" | "user_said" | "user_confirmed" | "ai_inferred";

export type PabMode = "initial" | "minimal" | "full";

export type PabInterfaceKind =
  "http" | "type" | "event" | "cli" | "file_format" | "db_schema";

export type PabDecisionOwner = "supervisor" | "user";

/** 规格 ProjectArchitectureBaseline（含 ReadyPabView 所需字段与 baseline_digest）。 */
export interface ProjectArchitectureBaseline {
  schema_version: typeof PAB_SCHEMA_VERSION;
  baseline_id: string;
  baseline_revision: number;
  baseline_digest: string;
  status: ReadyPabView["status"];
  scheme_ref: { scheme_id: string; scheme_revision: number };
  repository_ref: { base_sha: string; knowledge_digest: string | null };
  mode: PabMode;
  goals_map: Array<{
    scheme_item_id: string;
    component_ids: string[];
    acceptance_ids: string[];
  }>;
  components: Array<{
    component_id: string;
    name: string;
    purpose: string;
    path_hints: string[];
    owns_data: string[];
    depends_on: string[];
    must_not_depend_on: string[];
    source: PabSource;
    evidence_refs: string[];
  }>;
  interfaces: Array<{
    interface_id: string;
    name: string;
    kind: PabInterfaceKind;
    signature: string;
    provider_component_id: string;
    consumer_component_ids: string[];
    compatibility: string;
    verification_ids: string[];
  }>;
  data_contracts: Array<{
    data_id: string;
    owner_component_id: string;
    schema_or_invariant: string;
    migration_policy: string;
    rollback_policy: string;
  }>;
  decisions: Array<{
    decision_id: string;
    question: string;
    chosen: string;
    alternatives: string[];
    rationale: string;
    source: PabSource;
    evidence_refs: string[];
    escalation: string | null;
  }>;
  invariants: Array<{
    invariant_id: string;
    statement: string;
    verification_ids: string[];
  }>;
  non_functional: Array<{
    requirement_id: string;
    statement: string;
    verification_ids: string[];
  }>;
  assumptions: Array<{
    assumption_id: string;
    statement: string;
    impact: string;
    blocking: boolean;
  }>;
  open_decisions: Array<{
    decision_id: string;
    question: string;
    blocking: boolean;
    owner: PabDecisionOwner;
  }>;
  verification_catalog: Array<{
    verification_id: string;
    command_or_method: string;
    covers: string[];
  }>;
}

/** 写入入参：完整文档，或仅 ReadyPabView 字段（与 J.50a-1 调用方兼容）。 */
export type ArchitectureBaselineWriteInput =
  ReadyPabView | ProjectArchitectureBaseline;

/** 磁盘上的规范化记录：视图字段，或完整文档。 */
export type ArchitectureBaselineRecord =
  ReadyPabView | ProjectArchitectureBaseline;

/** 读入时的宽松对象形状（具名字段，避免 noPropertyAccessFromIndexSignature）。 */
interface LooseRec {
  schema_version?: unknown;
  baseline_id?: unknown;
  baseline_revision?: unknown;
  baseline_digest?: unknown;
  status?: unknown;
  scheme_ref?: unknown;
  repository_ref?: unknown;
  mode?: unknown;
  goals_map?: unknown;
  components?: unknown;
  interfaces?: unknown;
  data_contracts?: unknown;
  decisions?: unknown;
  invariants?: unknown;
  non_functional?: unknown;
  assumptions?: unknown;
  open_decisions?: unknown;
  verification_catalog?: unknown;
  scheme_id?: unknown;
  scheme_revision?: unknown;
  base_sha?: unknown;
  knowledge_digest?: unknown;
  scheme_item_id?: unknown;
  component_ids?: unknown;
  acceptance_ids?: unknown;
  component_id?: unknown;
  name?: unknown;
  purpose?: unknown;
  path_hints?: unknown;
  owns_data?: unknown;
  depends_on?: unknown;
  must_not_depend_on?: unknown;
  source?: unknown;
  evidence_refs?: unknown;
  interface_id?: unknown;
  kind?: unknown;
  signature?: unknown;
  provider_component_id?: unknown;
  consumer_component_ids?: unknown;
  compatibility?: unknown;
  verification_ids?: unknown;
  data_id?: unknown;
  owner_component_id?: unknown;
  schema_or_invariant?: unknown;
  migration_policy?: unknown;
  rollback_policy?: unknown;
  decision_id?: unknown;
  question?: unknown;
  chosen?: unknown;
  alternatives?: unknown;
  rationale?: unknown;
  escalation?: unknown;
  invariant_id?: unknown;
  statement?: unknown;
  requirement_id?: unknown;
  assumption_id?: unknown;
  impact?: unknown;
  blocking?: unknown;
  owner?: unknown;
  verification_id?: unknown;
  command_or_method?: unknown;
  covers?: unknown;
}

export function architectureBaselinePath(projectRoot: string): string {
  return path.resolve(projectRoot, PROJECT_DIR, ARCHITECTURE_BASELINE_FILENAME);
}

export function architectureBaselineRevisionPath(
  projectRoot: string,
  revision: number,
): string {
  return path.resolve(
    projectRoot,
    PROJECT_DIR,
    ARCHITECTURE_BASELINE_REVISIONS_DIR,
    `${revision}.json`,
  );
}

/**
 * 读取当前 PAB 的 ReadyPabView 投影。文件不存在时返回 null（明确的 not-found）。
 * 文件存在但无法解析或字段不合 ReadyPabView 时失败关闭。
 */
export function readCurrentArchitectureBaseline(
  projectRoot: string,
): ReadyPabView | null {
  const record = readArchitectureBaselineRecord(
    architectureBaselinePath(projectRoot),
  );
  return record ? projectReadyPabView(record) : null;
}

/**
 * 读取当前落盘的完整记录（若文件只含视图字段，则返回视图记录）。
 * 文件不存在时返回 null；损坏或字段非法时失败关闭。
 */
export function readCurrentArchitectureBaselineDocument(
  projectRoot: string,
): ArchitectureBaselineRecord | null {
  return readArchitectureBaselineRecord(architectureBaselinePath(projectRoot));
}

/**
 * 读取已归档修订的 ReadyPabView 投影。
 * 文件不存在时返回 null；损坏或字段非法时失败关闭。
 */
export function readArchitectureBaselineRevision(
  projectRoot: string,
  revision: number,
): ReadyPabView | null {
  const record = readArchitectureBaselineRecord(
    architectureBaselineRevisionPath(projectRoot, revision),
  );
  return record ? projectReadyPabView(record) : null;
}

/**
 * 读取已归档修订的完整记录（视图或完整文档）。
 */
export function readArchitectureBaselineRevisionDocument(
  projectRoot: string,
  revision: number,
): ArchitectureBaselineRecord | null {
  return readArchitectureBaselineRecord(
    architectureBaselineRevisionPath(projectRoot, revision),
  );
}

/**
 * 写入当前 PAB。若已有当前文件，先把磁盘上的完整上一份文档归档到
 * `architecture-baseline.revisions/<旧 baseline_revision>.json`，再写新文件。
 * 已存在的归档目标不得覆盖；不得把已归档修订再次写成当前。
 * digest 原样落盘，不重新计算。
 */
export function writeCurrentArchitectureBaseline(
  projectRoot: string,
  pab: ArchitectureBaselineWriteInput,
): void {
  const next = normalizeArchitectureBaselineRecord(pab, "write", {
    requireDigest: true,
  });
  const currentPath = architectureBaselinePath(projectRoot);
  const nextArchive = architectureBaselineRevisionPath(
    projectRoot,
    next.baseline_revision,
  );
  if (fs.existsSync(nextArchive)) {
    throw new ArchitectureBaselineStoreError(
      "E_PAB_REVISION_EXISTS",
      `修订 ${next.baseline_revision} 已归档，不得改写：${nextArchive}`,
    );
  }

  const previous = readArchitectureBaselineRecord(currentPath);
  if (previous) {
    if (previous.baseline_revision === next.baseline_revision) {
      throw new ArchitectureBaselineStoreError(
        "E_PAB_REVISION_EXISTS",
        `修订 ${next.baseline_revision} 已作为当前 PAB 落盘，不得直接改写`,
      );
    }
    const archivePath = architectureBaselineRevisionPath(
      projectRoot,
      previous.baseline_revision,
    );
    if (fs.existsSync(archivePath)) {
      throw new ArchitectureBaselineStoreError(
        "E_PAB_REVISION_EXISTS",
        `修订 ${previous.baseline_revision} 已归档，不得改写：${archivePath}`,
      );
    }
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    writeJsonAtomic(archivePath, previous);
  }

  fs.mkdirSync(path.dirname(currentPath), { recursive: true });
  writeJsonAtomic(currentPath, next);
}

export function projectReadyPabView(
  record: ArchitectureBaselineRecord,
): ReadyPabView {
  const view: ReadyPabView = {
    baseline_id: record.baseline_id,
    baseline_revision: record.baseline_revision,
    baseline_digest: record.baseline_digest,
    status: record.status,
  };
  if (record.open_decisions !== undefined) {
    view.open_decisions = record.open_decisions;
  }
  return view;
}

export function isProjectArchitectureBaseline(
  record: ArchitectureBaselineRecord,
): record is ProjectArchitectureBaseline {
  return hasFullDocumentMarkers(record);
}

/**
 * 规范化写入/读出记录。`requireDigest: false` 时允许尚无 baseline_digest
 *（供生成器先规范化再计算 digest）；写入路径必须 requireDigest: true。
 */
export function normalizeArchitectureBaselineRecord(
  value: unknown,
  source: string,
  options: { requireDigest: boolean },
): ArchitectureBaselineRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ArchitectureBaselineStoreError(
      "E_PAB_INVALID",
      `PAB 必须是对象（来源：${source}）`,
    );
  }
  const rec = value as LooseRec;
  const view = normalizeReadyPabViewFields(rec, source, options);
  if (!hasFullDocumentMarkers(rec)) {
    return view;
  }
  return normalizeFullDocument(rec, view, source, options);
}

function hasFullDocumentMarkers(value: object): boolean {
  const rec = value as LooseRec;
  return (
    rec.schema_version !== undefined ||
    rec.scheme_ref !== undefined ||
    rec.repository_ref !== undefined ||
    rec.mode !== undefined ||
    rec.goals_map !== undefined ||
    rec.components !== undefined ||
    rec.interfaces !== undefined ||
    rec.data_contracts !== undefined ||
    rec.decisions !== undefined ||
    rec.invariants !== undefined ||
    rec.non_functional !== undefined ||
    rec.assumptions !== undefined ||
    rec.verification_catalog !== undefined
  );
}

function readArchitectureBaselineRecord(
  target: string,
): ArchitectureBaselineRecord | null {
  if (!fs.existsSync(target)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ArchitectureBaselineStoreError(
      "E_PAB_UNREADABLE",
      `PAB 文件无法解析：${target}（${detail}）`,
    );
  }
  return normalizeArchitectureBaselineRecord(raw, target, {
    requireDigest: true,
  });
}

function normalizeReadyPabViewFields(
  rec: LooseRec,
  source: string,
  options: { requireDigest: boolean },
): ReadyPabView {
  if (typeof rec.baseline_id !== "string" || rec.baseline_id.length === 0) {
    throw new ArchitectureBaselineStoreError(
      "E_PAB_INVALID",
      `缺少或非法的 baseline_id（来源：${source}）`,
    );
  }
  if (
    typeof rec.baseline_revision !== "number" ||
    !Number.isInteger(rec.baseline_revision)
  ) {
    throw new ArchitectureBaselineStoreError(
      "E_PAB_INVALID",
      `缺少或非法的 baseline_revision（来源：${source}）`,
    );
  }
  if (options.requireDigest) {
    if (
      typeof rec.baseline_digest !== "string" ||
      rec.baseline_digest.length === 0
    ) {
      throw new ArchitectureBaselineStoreError(
        "E_PAB_INVALID",
        `缺少或非法的 baseline_digest（来源：${source}）`,
      );
    }
  } else if (
    rec.baseline_digest !== undefined &&
    (typeof rec.baseline_digest !== "string" ||
      rec.baseline_digest.length === 0)
  ) {
    throw new ArchitectureBaselineStoreError(
      "E_PAB_INVALID",
      `缺少或非法的 baseline_digest（来源：${source}）`,
    );
  }
  if (!isPabStatus(rec.status)) {
    throw new ArchitectureBaselineStoreError(
      "E_PAB_INVALID",
      `缺少或非法的 status（来源：${source}）`,
    );
  }

  const view: ReadyPabView = {
    baseline_id: rec.baseline_id,
    baseline_revision: rec.baseline_revision,
    baseline_digest:
      typeof rec.baseline_digest === "string" ? rec.baseline_digest : "",
    status: rec.status,
  };
  if (!options.requireDigest && rec.baseline_digest === undefined) {
    delete (view as { baseline_digest?: string }).baseline_digest;
  }
  if (rec.open_decisions !== undefined) {
    view.open_decisions = hasFullDocumentMarkers(rec)
      ? normalizeFullOpenDecisions(rec.open_decisions, source)
      : normalizeOpenDecisions(rec.open_decisions, source);
  }
  return view;
}

function normalizeFullDocument(
  rec: LooseRec,
  view: ReadyPabView,
  source: string,
  options: { requireDigest: boolean },
): ProjectArchitectureBaseline {
  if (rec.schema_version !== PAB_SCHEMA_VERSION) {
    throw new ArchitectureBaselineStoreError(
      "E_PAB_INVALID",
      `缺少或非法的 schema_version（来源：${source}）`,
    );
  }
  if (!isPabMode(rec.mode)) {
    throw new ArchitectureBaselineStoreError(
      "E_PAB_INVALID",
      `缺少或非法的 mode（来源：${source}）`,
    );
  }
  const schemeRef = normalizeSchemeRef(rec.scheme_ref, source);
  const repositoryRef = normalizeRepositoryRef(rec.repository_ref, source);
  const openDecisions =
    rec.open_decisions === undefined
      ? []
      : normalizeFullOpenDecisions(rec.open_decisions, source);

  const document: ProjectArchitectureBaseline = {
    schema_version: PAB_SCHEMA_VERSION,
    baseline_id: view.baseline_id,
    baseline_revision: view.baseline_revision,
    baseline_digest: view.baseline_digest ?? "",
    status: view.status,
    scheme_ref: schemeRef,
    repository_ref: repositoryRef,
    mode: rec.mode,
    goals_map: normalizeGoalsMap(rec.goals_map, source),
    components: normalizeComponents(rec.components, source),
    interfaces: normalizeInterfaces(rec.interfaces, source),
    data_contracts: normalizeDataContracts(rec.data_contracts, source),
    decisions: normalizeDecisions(rec.decisions, source),
    invariants: normalizeInvariants(rec.invariants, source),
    non_functional: normalizeNonFunctional(rec.non_functional, source),
    assumptions: normalizeAssumptions(rec.assumptions, source),
    open_decisions: openDecisions,
    verification_catalog: normalizeVerificationCatalog(
      rec.verification_catalog,
      source,
    ),
  };
  if (!options.requireDigest && rec.baseline_digest === undefined) {
    delete (document as { baseline_digest?: string }).baseline_digest;
  }
  return document;
}

function isPabStatus(value: unknown): value is ReadyPabView["status"] {
  return value === "draft" || value === "ready" || value === "stale";
}

function isPabMode(value: unknown): value is PabMode {
  return value === "initial" || value === "minimal" || value === "full";
}

function isPabSource(value: unknown): value is PabSource {
  return (
    value === "observed" ||
    value === "user_said" ||
    value === "user_confirmed" ||
    value === "ai_inferred"
  );
}

function isPabInterfaceKind(value: unknown): value is PabInterfaceKind {
  return (
    value === "http" ||
    value === "type" ||
    value === "event" ||
    value === "cli" ||
    value === "file_format" ||
    value === "db_schema"
  );
}

function requireObject(value: unknown, label: string, source: string): object {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ArchitectureBaselineStoreError(
      "E_PAB_INVALID",
      `${label} 必须是对象（来源：${source}）`,
    );
  }
  return value;
}

function requireString(value: unknown, label: string, source: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ArchitectureBaselineStoreError(
      "E_PAB_INVALID",
      `缺少或非法的 ${label}（来源：${source}）`,
    );
  }
  return value;
}

function requireStringArray(
  value: unknown,
  label: string,
  source: string,
): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ArchitectureBaselineStoreError(
      "E_PAB_INVALID",
      `${label} 必须是字符串数组（来源：${source}）`,
    );
  }
  return value as string[];
}

function requireArray(
  value: unknown,
  label: string,
  source: string,
): unknown[] {
  if (!Array.isArray(value)) {
    throw new ArchitectureBaselineStoreError(
      "E_PAB_INVALID",
      `${label} 必须是数组（来源：${source}）`,
    );
  }
  return value;
}

function normalizeSchemeRef(
  value: unknown,
  source: string,
): ProjectArchitectureBaseline["scheme_ref"] {
  const rec = requireObject(value, "scheme_ref", source) as LooseRec;
  if (typeof rec.scheme_id !== "string" || rec.scheme_id.length === 0) {
    throw new ArchitectureBaselineStoreError(
      "E_PAB_INVALID",
      `缺少或非法的 scheme_ref.scheme_id（来源：${source}）`,
    );
  }
  if (
    typeof rec.scheme_revision !== "number" ||
    !Number.isInteger(rec.scheme_revision)
  ) {
    throw new ArchitectureBaselineStoreError(
      "E_PAB_INVALID",
      `缺少或非法的 scheme_ref.scheme_revision（来源：${source}）`,
    );
  }
  return { scheme_id: rec.scheme_id, scheme_revision: rec.scheme_revision };
}

function normalizeRepositoryRef(
  value: unknown,
  source: string,
): ProjectArchitectureBaseline["repository_ref"] {
  const rec = requireObject(value, "repository_ref", source) as LooseRec;
  if (typeof rec.base_sha !== "string" || rec.base_sha.length === 0) {
    throw new ArchitectureBaselineStoreError(
      "E_PAB_INVALID",
      `缺少或非法的 repository_ref.base_sha（来源：${source}）`,
    );
  }
  if (
    rec.knowledge_digest !== null &&
    typeof rec.knowledge_digest !== "string"
  ) {
    throw new ArchitectureBaselineStoreError(
      "E_PAB_INVALID",
      `缺少或非法的 repository_ref.knowledge_digest（来源：${source}）`,
    );
  }
  return { base_sha: rec.base_sha, knowledge_digest: rec.knowledge_digest };
}

function normalizeGoalsMap(
  value: unknown,
  source: string,
): ProjectArchitectureBaseline["goals_map"] {
  return requireArray(value, "goals_map", source).map((item, index) => {
    const rec = requireObject(item, `goals_map[${index}]`, source) as LooseRec;
    return {
      scheme_item_id: requireString(
        rec.scheme_item_id,
        `goals_map[${index}].scheme_item_id`,
        source,
      ),
      component_ids: requireStringArray(
        rec.component_ids,
        `goals_map[${index}].component_ids`,
        source,
      ),
      acceptance_ids: requireStringArray(
        rec.acceptance_ids,
        `goals_map[${index}].acceptance_ids`,
        source,
      ),
    };
  });
}

function normalizeComponents(
  value: unknown,
  source: string,
): ProjectArchitectureBaseline["components"] {
  return requireArray(value, "components", source).map((item, index) => {
    const rec = requireObject(item, `components[${index}]`, source) as LooseRec;
    if (!isPabSource(rec.source)) {
      throw new ArchitectureBaselineStoreError(
        "E_PAB_INVALID",
        `缺少或非法的 components[${index}].source（来源：${source}）`,
      );
    }
    return {
      component_id: requireString(
        rec.component_id,
        `components[${index}].component_id`,
        source,
      ),
      name: requireString(rec.name, `components[${index}].name`, source),
      purpose: requireString(
        rec.purpose,
        `components[${index}].purpose`,
        source,
      ),
      path_hints: requireStringArray(
        rec.path_hints,
        `components[${index}].path_hints`,
        source,
      ),
      owns_data: requireStringArray(
        rec.owns_data,
        `components[${index}].owns_data`,
        source,
      ),
      depends_on: requireStringArray(
        rec.depends_on,
        `components[${index}].depends_on`,
        source,
      ),
      must_not_depend_on: requireStringArray(
        rec.must_not_depend_on,
        `components[${index}].must_not_depend_on`,
        source,
      ),
      source: rec.source,
      evidence_refs: requireStringArray(
        rec.evidence_refs,
        `components[${index}].evidence_refs`,
        source,
      ),
    };
  });
}

function normalizeInterfaces(
  value: unknown,
  source: string,
): ProjectArchitectureBaseline["interfaces"] {
  return requireArray(value, "interfaces", source).map((item, index) => {
    const rec = requireObject(item, `interfaces[${index}]`, source) as LooseRec;
    if (!isPabInterfaceKind(rec.kind)) {
      throw new ArchitectureBaselineStoreError(
        "E_PAB_INVALID",
        `缺少或非法的 interfaces[${index}].kind（来源：${source}）`,
      );
    }
    return {
      interface_id: requireString(
        rec.interface_id,
        `interfaces[${index}].interface_id`,
        source,
      ),
      name: requireString(rec.name, `interfaces[${index}].name`, source),
      kind: rec.kind,
      signature: requireString(
        rec.signature,
        `interfaces[${index}].signature`,
        source,
      ),
      provider_component_id: requireString(
        rec.provider_component_id,
        `interfaces[${index}].provider_component_id`,
        source,
      ),
      consumer_component_ids: requireStringArray(
        rec.consumer_component_ids,
        `interfaces[${index}].consumer_component_ids`,
        source,
      ),
      compatibility: requireString(
        rec.compatibility,
        `interfaces[${index}].compatibility`,
        source,
      ),
      verification_ids: requireStringArray(
        rec.verification_ids,
        `interfaces[${index}].verification_ids`,
        source,
      ),
    };
  });
}

function normalizeDataContracts(
  value: unknown,
  source: string,
): ProjectArchitectureBaseline["data_contracts"] {
  return requireArray(value, "data_contracts", source).map((item, index) => {
    const rec = requireObject(
      item,
      `data_contracts[${index}]`,
      source,
    ) as LooseRec;
    return {
      data_id: requireString(
        rec.data_id,
        `data_contracts[${index}].data_id`,
        source,
      ),
      owner_component_id: requireString(
        rec.owner_component_id,
        `data_contracts[${index}].owner_component_id`,
        source,
      ),
      schema_or_invariant: requireString(
        rec.schema_or_invariant,
        `data_contracts[${index}].schema_or_invariant`,
        source,
      ),
      migration_policy: requireString(
        rec.migration_policy,
        `data_contracts[${index}].migration_policy`,
        source,
      ),
      rollback_policy: requireString(
        rec.rollback_policy,
        `data_contracts[${index}].rollback_policy`,
        source,
      ),
    };
  });
}

function normalizeDecisions(
  value: unknown,
  source: string,
): ProjectArchitectureBaseline["decisions"] {
  return requireArray(value, "decisions", source).map((item, index) => {
    const rec = requireObject(item, `decisions[${index}]`, source) as LooseRec;
    if (!isPabSource(rec.source)) {
      throw new ArchitectureBaselineStoreError(
        "E_PAB_INVALID",
        `缺少或非法的 decisions[${index}].source（来源：${source}）`,
      );
    }
    if (rec.escalation !== null && typeof rec.escalation !== "string") {
      throw new ArchitectureBaselineStoreError(
        "E_PAB_INVALID",
        `缺少或非法的 decisions[${index}].escalation（来源：${source}）`,
      );
    }
    return {
      decision_id: requireString(
        rec.decision_id,
        `decisions[${index}].decision_id`,
        source,
      ),
      question: requireString(
        rec.question,
        `decisions[${index}].question`,
        source,
      ),
      chosen: requireString(rec.chosen, `decisions[${index}].chosen`, source),
      alternatives: requireStringArray(
        rec.alternatives,
        `decisions[${index}].alternatives`,
        source,
      ),
      rationale: requireString(
        rec.rationale,
        `decisions[${index}].rationale`,
        source,
      ),
      source: rec.source,
      evidence_refs: requireStringArray(
        rec.evidence_refs,
        `decisions[${index}].evidence_refs`,
        source,
      ),
      escalation: rec.escalation,
    };
  });
}

function normalizeInvariants(
  value: unknown,
  source: string,
): ProjectArchitectureBaseline["invariants"] {
  return requireArray(value, "invariants", source).map((item, index) => {
    const rec = requireObject(item, `invariants[${index}]`, source) as LooseRec;
    return {
      invariant_id: requireString(
        rec.invariant_id,
        `invariants[${index}].invariant_id`,
        source,
      ),
      statement: requireString(
        rec.statement,
        `invariants[${index}].statement`,
        source,
      ),
      verification_ids: requireStringArray(
        rec.verification_ids,
        `invariants[${index}].verification_ids`,
        source,
      ),
    };
  });
}

function normalizeNonFunctional(
  value: unknown,
  source: string,
): ProjectArchitectureBaseline["non_functional"] {
  return requireArray(value, "non_functional", source).map((item, index) => {
    const rec = requireObject(
      item,
      `non_functional[${index}]`,
      source,
    ) as LooseRec;
    return {
      requirement_id: requireString(
        rec.requirement_id,
        `non_functional[${index}].requirement_id`,
        source,
      ),
      statement: requireString(
        rec.statement,
        `non_functional[${index}].statement`,
        source,
      ),
      verification_ids: requireStringArray(
        rec.verification_ids,
        `non_functional[${index}].verification_ids`,
        source,
      ),
    };
  });
}

function normalizeAssumptions(
  value: unknown,
  source: string,
): ProjectArchitectureBaseline["assumptions"] {
  return requireArray(value, "assumptions", source).map((item, index) => {
    const rec = requireObject(
      item,
      `assumptions[${index}]`,
      source,
    ) as LooseRec;
    if (typeof rec.blocking !== "boolean") {
      throw new ArchitectureBaselineStoreError(
        "E_PAB_INVALID",
        `assumptions[${index}].blocking 必须是 boolean（来源：${source}）`,
      );
    }
    return {
      assumption_id: requireString(
        rec.assumption_id,
        `assumptions[${index}].assumption_id`,
        source,
      ),
      statement: requireString(
        rec.statement,
        `assumptions[${index}].statement`,
        source,
      ),
      impact: requireString(rec.impact, `assumptions[${index}].impact`, source),
      blocking: rec.blocking,
    };
  });
}

function normalizeVerificationCatalog(
  value: unknown,
  source: string,
): ProjectArchitectureBaseline["verification_catalog"] {
  return requireArray(value, "verification_catalog", source).map(
    (item, index) => {
      const rec = requireObject(
        item,
        `verification_catalog[${index}]`,
        source,
      ) as LooseRec;
      return {
        verification_id: requireString(
          rec.verification_id,
          `verification_catalog[${index}].verification_id`,
          source,
        ),
        command_or_method: requireString(
          rec.command_or_method,
          `verification_catalog[${index}].command_or_method`,
          source,
        ),
        covers: requireStringArray(
          rec.covers,
          `verification_catalog[${index}].covers`,
          source,
        ),
      };
    },
  );
}

function normalizeOpenDecisions(
  value: unknown,
  source: string,
): NonNullable<ReadyPabView["open_decisions"]> {
  if (!Array.isArray(value)) {
    throw new ArchitectureBaselineStoreError(
      "E_PAB_INVALID",
      `open_decisions 必须是数组（来源：${source}）`,
    );
  }
  return value.map((item, index) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new ArchitectureBaselineStoreError(
        "E_PAB_INVALID",
        `open_decisions[${index}] 必须是对象（来源：${source}）`,
      );
    }
    const rec = item as { blocking?: unknown };
    if (typeof rec.blocking !== "boolean") {
      throw new ArchitectureBaselineStoreError(
        "E_PAB_INVALID",
        `open_decisions[${index}].blocking 必须是 boolean（来源：${source}）`,
      );
    }
    return item as { blocking: boolean };
  });
}

function normalizeFullOpenDecisions(
  value: unknown,
  source: string,
): ProjectArchitectureBaseline["open_decisions"] {
  return requireArray(value, "open_decisions", source).map((item, index) => {
    const rec = requireObject(
      item,
      `open_decisions[${index}]`,
      source,
    ) as LooseRec;
    if (typeof rec.blocking !== "boolean") {
      throw new ArchitectureBaselineStoreError(
        "E_PAB_INVALID",
        `open_decisions[${index}].blocking 必须是 boolean（来源：${source}）`,
      );
    }
    if (rec.owner !== "supervisor" && rec.owner !== "user") {
      throw new ArchitectureBaselineStoreError(
        "E_PAB_INVALID",
        `缺少或非法的 open_decisions[${index}].owner（来源：${source}）`,
      );
    }
    return {
      decision_id: requireString(
        rec.decision_id,
        `open_decisions[${index}].decision_id`,
        source,
      ),
      question: requireString(
        rec.question,
        `open_decisions[${index}].question`,
        source,
      ),
      blocking: rec.blocking,
      owner: rec.owner,
    };
  });
}
