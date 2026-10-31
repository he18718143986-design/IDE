/**
 * 墓地门禁裁决（TASK-J.18c / worker-graveyard-gate.md §2.5、§3、§6.2）。
 * evaluateGraveyardGate / pickPrimaryVerdict / buildGatePack 为纯裁决 API；
 * 本卡不接线写盘路径（接线见 J.18d）。
 */
import { ALIAS_LEXICON_VERSION } from "../../src/lib/journey/artifact-alias-lexicon";
import {
  projectArtifact,
  projectCommand,
  projectText,
  type ArtifactChange,
  type GateUnit,
} from "../../src/lib/journey/artifact-projection";
import {
  artifactKeys,
  matchArtifactUnit,
} from "../../src/lib/journey/graveyard-match";
import type { GraveyardEntry } from "../../src/lib/journey/scheme-patch-types";
import {
  MAX_DIFF_FILE_BYTES,
  MAX_DIFF_FILES,
} from "../diff/diff-files";

/** 再导出，供单测与接线方统一引用。 */
export { MAX_DIFF_FILE_BYTES, MAX_DIFF_FILES };

/** 门禁日志码（§6.3）；不进 ERROR_CODES。 */
export const GATE_LOG_CODES = [
  "W_GRAVEYARD_WEAK_MATCH",
  "W_GRAVEYARD_CHECK_UNAVAILABLE",
  "W_GATE_PACK_MISSING",
  "W_GATE_DIFF_TRUNCATED",
] as const;

export type GateWarningCode = (typeof GATE_LOG_CODES)[number];

export type GateStrength = "strong" | "weak";

export interface GraveyardHit {
  rejected_id: string;
  lock: "user" | "security" | "soft";
  strength: GateStrength;
  units: GateUnit[];
  via: "direct" | "alias" | "path+ident" | "nl";
}

export interface GateInput {
  graveyard: readonly GraveyardEntry[];
  changes: readonly ArtifactChange[];
  commands: readonly (readonly string[])[];
  texts: readonly { text: string; source: GateUnit["source"] }[];
  availability: "snapshot" | "unavailable";
}

export interface GateResult {
  block: boolean;
  hits: GraveyardHit[];
  warnings: GateWarningCode[];
  primary?: {
    code: "E_PROPOSAL_PREVIOUSLY_REJECTED";
    rejected_id: string;
    lock: "user" | "security";
  };
}

const STRONG_KINDS = new Set<GateUnit["kind"]>([
  "U-DEP",
  "U-CMD",
  "U-IMPORT",
]);

function hitLock(
  entry: GraveyardEntry,
): "user" | "security" | "soft" {
  if (!entry.disallow_revival) return "soft";
  return entry.rejected_by === "security_gate" ? "security" : "user";
}

function classifyStrengthAndVia(
  matched: readonly { unit: GateUnit; via: "direct" | "alias" | "nl" }[],
): { strength: GateStrength; via: GraveyardHit["via"] } {
  const kinds = new Set(matched.map((m) => m.unit.kind));
  const hasPath = kinds.has("U-PATH");
  const hasIdent = kinds.has("U-IDENT");
  const hasStrongKind = matched.some((m) => STRONG_KINDS.has(m.unit.kind));

  if (hasStrongKind) {
    const strongMatch = matched.find((m) => STRONG_KINDS.has(m.unit.kind))!;
    return { strength: "strong", via: strongMatch.via === "nl" ? "direct" : strongMatch.via };
  }
  if (hasPath && hasIdent) {
    return { strength: "strong", via: "path+ident" };
  }
  // 弱：优先报告 nl，否则 direct/alias
  const nl = matched.find((m) => m.via === "nl");
  if (nl) return { strength: "weak", via: "nl" };
  const any = matched[0]!;
  return { strength: "weak", via: any.via === "nl" ? "nl" : any.via };
}

/**
 * 给定快照墓地与一批产出物，确定性给出是否拦截、主码与全部命中证据。
 * availability=unavailable（旧直签）→ 不拦截，只记 W_GRAVEYARD_CHECK_UNAVAILABLE。
 */
export function evaluateGraveyardGate(input: GateInput): GateResult {
  if (input.availability === "unavailable") {
    return {
      block: false,
      hits: [],
      warnings: ["W_GRAVEYARD_CHECK_UNAVAILABLE"],
    };
  }

  const units: GateUnit[] = [];
  for (const change of input.changes) {
    units.push(...projectArtifact(change));
  }
  for (const argv of input.commands) {
    units.push(...projectCommand(argv));
  }
  for (const t of input.texts) {
    units.push(...projectText(t.text, t.source));
  }

  const hits: GraveyardHit[] = [];
  const warningSet = new Set<GateWarningCode>();

  for (const entry of input.graveyard) {
    if (entry.status !== "active") continue;
    const matched: { unit: GateUnit; via: "direct" | "alias" | "nl" }[] = [];
    for (const unit of units) {
      const m = matchArtifactUnit(unit, entry);
      if (m) matched.push({ unit, via: m.via });
    }
    if (matched.length === 0) continue;

    const { strength, via } = classifyStrengthAndVia(matched);
    const lock = hitLock(entry);
    const hit: GraveyardHit = {
      rejected_id: entry.rejected_id,
      lock,
      strength,
      units: matched.map((m) => m.unit),
      via,
    };
    hits.push(hit);

    const blocking =
      strength === "strong" && (lock === "user" || lock === "security");
    if (!blocking) {
      warningSet.add("W_GRAVEYARD_WEAK_MATCH");
    }
  }

  hits.sort((a, b) =>
    a.rejected_id < b.rejected_id ? -1 : a.rejected_id > b.rejected_id ? 1 : 0,
  );

  // 主码：强安全 > 强用户（P3 > P4）；同级按 rejected_id 字典序（已排序）
  let primary: GateResult["primary"];
  const strongSecurity = hits.find(
    (h) => h.strength === "strong" && h.lock === "security",
  );
  const strongUser = hits.find(
    (h) => h.strength === "strong" && h.lock === "user",
  );
  const chosen = strongSecurity ?? strongUser;
  if (chosen) {
    primary = {
      code: "E_PROPOSAL_PREVIOUSLY_REJECTED",
      rejected_id: chosen.rejected_id,
      lock: chosen.lock,
    };
  }

  return {
    block: Boolean(primary),
    hits,
    warnings: GATE_LOG_CODES.filter((c) => warningSet.has(c)),
    ...(primary ? { primary } : {}),
  };
}

export type BlockingCode =
  | "E_UNSAFE_EXECUTION"
  | "PATH_TRAVERSAL_DETECTED"
  | "E_SCHEME_SNAPSHOT_NOT_FOUND"
  | "E_SCHEME_SNAPSHOT_MISMATCH"
  | "E_FORBIDDEN_PATH"
  | "E_PROPOSAL_PREVIOUSLY_REJECTED"
  | "E_OUT_OF_SCOPE_UNTRACKED"
  | "E_OUT_OF_SCOPE";

export interface LineVerdict {
  code: BlockingCode;
  detail?: Record<string, unknown>;
}

/** 优先级数字越小越高。P3/P4 同码靠 detail.lock 区分。 */
function verdictRank(v: LineVerdict): number {
  switch (v.code) {
    case "E_UNSAFE_EXECUTION":
    case "PATH_TRAVERSAL_DETECTED":
      return 0;
    case "E_SCHEME_SNAPSHOT_NOT_FOUND":
    case "E_SCHEME_SNAPSHOT_MISMATCH":
      return 1;
    case "E_FORBIDDEN_PATH":
      return 2;
    case "E_PROPOSAL_PREVIOUSLY_REJECTED": {
      const lock = v.detail?.["lock"];
      if (lock === "security") return 3;
      return 4; // user 或缺省按 P4
    }
    case "E_OUT_OF_SCOPE_UNTRACKED":
      return 5;
    case "E_OUT_OF_SCOPE":
      return 6;
    default:
      return 100;
  }
}

/**
 * 同一次写入多条命中时取最高优先级主码（§3.3）。
 * 不认识的码（含签署期 E_SCOPE_PLAN_DRIFT）一律忽略，保证执行期主码永不落成漂移码。
 */
export function pickPrimaryVerdict(
  verdicts: readonly LineVerdict[],
): LineVerdict | null {
  let best: LineVerdict | null = null;
  let bestRank = Infinity;
  for (const v of verdicts) {
    if (!isBlockingCode(v.code)) continue;
    const r = verdictRank(v);
    if (r < bestRank) {
      best = v;
      bestRank = r;
    }
  }
  return best;
}

const BLOCKING_CODE_SET = new Set<string>([
  "E_UNSAFE_EXECUTION",
  "PATH_TRAVERSAL_DETECTED",
  "E_SCHEME_SNAPSHOT_NOT_FOUND",
  "E_SCHEME_SNAPSHOT_MISMATCH",
  "E_FORBIDDEN_PATH",
  "E_PROPOSAL_PREVIOUSLY_REJECTED",
  "E_OUT_OF_SCOPE_UNTRACKED",
  "E_OUT_OF_SCOPE",
]);

function isBlockingCode(code: string): code is BlockingCode {
  return BLOCKING_CODE_SET.has(code);
}

export interface GatePack {
  pack_version: 1;
  alias_lexicon_version: number;
  tombstones: {
    rejected_id: string;
    lock: "user" | "security";
    keys: string[];
  }[];
}

/** 只含 active 且 disallow_revival 的阻断类墓碑；keys 已含别名、已小写。 */
export function buildGatePack(
  graveyard: readonly GraveyardEntry[],
): GatePack {
  const tombstones: GatePack["tombstones"] = [];
  for (const entry of graveyard) {
    if (entry.status !== "active") continue;
    if (!entry.disallow_revival) continue;
    const lock: "user" | "security" =
      entry.rejected_by === "security_gate" ? "security" : "user";
    tombstones.push({
      rejected_id: entry.rejected_id,
      lock,
      keys: artifactKeys(entry).map((k) => k.toLowerCase()),
    });
  }
  tombstones.sort((a, b) =>
    a.rejected_id < b.rejected_id ? -1 : a.rejected_id > b.rejected_id ? 1 : 0,
  );
  return {
    pack_version: 1,
    alias_lexicon_version: ALIAS_LEXICON_VERSION,
    tombstones,
  };
}

/** 依赖清单路径：截断不可跳过 → E_GATE_SCAN_FAILED。 */
export function isDependencyManifestPath(filePath: string): boolean {
  const base = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
  if (base === "package.json") return true;
  if (base === "go.mod") return true;
  if (/^requirements.*\.txt$/i.test(base)) return true;
  return false;
}

export type DiffScanFile = {
  path: string;
  before: string | null;
  after: string | null;
  truncated?: boolean;
  binary?: boolean;
};

export type DiffScanAssessment =
  | { ok: false; code: "E_GATE_SCAN_FAILED"; reason: string }
  | {
      ok: true;
      changes: ArtifactChange[];
      warnings: GateWarningCode[];
    };

/**
 * 全量扫描读 diff 结果 → 可喂给 evaluateGraveyardGate 的 changes，
 * 或失败关闭为 E_GATE_SCAN_FAILED（TM-GE-01～05）。
 */
export function assessDiffScan(input: {
  readError?: boolean;
  truncatedList?: boolean;
  files: readonly DiffScanFile[];
}): DiffScanAssessment {
  if (input.readError) {
    return {
      ok: false,
      code: "E_GATE_SCAN_FAILED",
      reason: "readDiffFiles 抛错，全量扫描无法读取 diff",
    };
  }
  if (input.truncatedList) {
    return {
      ok: false,
      code: "E_GATE_SCAN_FAILED",
      reason: `变更文件超过 ${MAX_DIFF_FILES}，覆盖不完整`,
    };
  }
  const warnings: GateWarningCode[] = [];
  const changes: ArtifactChange[] = [];
  for (const f of input.files) {
    // 删除：无新增单元
    if (f.after === null && f.before !== null) {
      continue;
    }
    if (f.truncated && isDependencyManifestPath(f.path)) {
      return {
        ok: false,
        code: "E_GATE_SCAN_FAILED",
        reason: `依赖清单 ${f.path} 超过 MAX_DIFF_FILE_BYTES，不可跳过`,
      };
    }
    if (f.binary) {
      // 只做 U-PATH（新文件）
      if (f.before === null && f.after !== null) {
        changes.push({ path: f.path, before: null, after: "" });
      }
      continue;
    }
    if (f.truncated) {
      warnings.push("W_GATE_DIFF_TRUNCATED");
      if (f.before === null && f.after !== null) {
        changes.push({ path: f.path, before: null, after: "" });
      } else if (f.after !== null) {
        // 截断普通源码：只保留路径判定，不喂正文
        changes.push({ path: f.path, before: f.before, after: f.before ?? "" });
        // 若是新文件已在上面；已有文件截断则不产生新增行，仅当新文件才有 U-PATH
      }
      continue;
    }
    changes.push({ path: f.path, before: f.before, after: f.after });
  }
  return {
    ok: true,
    changes,
    warnings: GATE_LOG_CODES.filter((c) => warnings.includes(c)),
  };
}

export type GateCardRecommendation =
  | "retry"
  | "abandon_or_revive"
  | "explain_security";

/**
 * 卡片推荐动作（§5.1）：同墓碑本轮第二次强命中 → 不再推荐重试。
 */
export function recommendGateCardAction(
  primary: GateResult["primary"],
  priorStrongRejectedIds: ReadonlySet<string>,
): GateCardRecommendation | null {
  if (!primary) return null;
  if (primary.lock === "security") return "explain_security";
  if (priorStrongRejectedIds.has(primary.rejected_id)) {
    return "abandon_or_revive";
  }
  return "retry";
}

/** 稳定序列化，供 TM-GE-08 确定性对拍。 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
