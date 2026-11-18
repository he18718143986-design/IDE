/**
 * TASK-J.38b：五字段投影加层（只读）。
 *
 * - 消费 J.36 `SchemeItemProjectionDto`；非法 / 缺省按 J.37 丢字段
 * - 零写 `SchemeItemMeta.source` / `evidence`；禁止写入快照密封权威
 * - 可选消费 J.38a `FineModelLayer` 作 provenance 提示，不渲染六实体、不落盘
 */
import type {
  FineModelLayer,
  ItemSource,
  SchemeItemMeta,
  SchemeItemProjectionDto,
  SchemeItemProjectionStatus,
} from "./scheme-patch-types";

const STATUS_SET = new Set<SchemeItemProjectionStatus>([
  "draft",
  "proposed",
  "confirmed",
  "rejected",
  "deferred",
]);

const CONFIDENCE_SET = new Set<"low" | "medium" | "high">([
  "low",
  "medium",
  "high",
]);

const SOURCE_PROVENANCE: Record<ItemSource, string> = {
  user_said: "业主原话",
  user_confirmed: "业主已确认",
  ai_inferred: "AI 推断",
  user_edited: "业主手改",
};

export type ProjectSchemeItemFiveFieldsInput = {
  /** 显式投影 DTO（可含非法值；本函数只读清洗） */
  dto?: SchemeItemProjectionDto | null;
  /** 条目 meta；只读推导缺省展示，不得被回写 */
  meta?: Pick<
    SchemeItemMeta,
    "id" | "source" | "evidence" | "user_pinned"
  > | null;
  /** 方案已冻结时，缺省 status 倾向 confirmed（仍不改 source） */
  schemeFrozen?: boolean;
  /**
   * 可选细模型加层（deriveFineModelFromV2 产物）。
   * 仅作 provenance 提示源；不渲染 Actor/UseCase/…/AC 实体列表。
   */
  fineLayer?: FineModelLayer | null;
};

function isStatus(v: unknown): v is SchemeItemProjectionStatus {
  return (
    typeof v === "string" && STATUS_SET.has(v as SchemeItemProjectionStatus)
  );
}

function isConfidence(v: unknown): v is "low" | "medium" | "high" {
  return (
    typeof v === "string" && CONFIDENCE_SET.has(v as "low" | "medium" | "high")
  );
}

function sanitizeLinks(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") continue;
    const t = item.trim();
    if (t === "") continue;
    out.push(t);
  }
  return out.length > 0 ? out : undefined;
}

function statusFromMeta(
  meta: ProjectSchemeItemFiveFieldsInput["meta"],
  schemeFrozen: boolean | undefined,
): SchemeItemProjectionStatus | undefined {
  if (schemeFrozen === true) return "confirmed";
  if (!meta) return undefined;
  switch (meta.source) {
    case "user_confirmed":
      return "confirmed";
    case "user_said":
    case "user_edited":
      return "proposed";
    case "ai_inferred":
      return "draft";
    default:
      return undefined;
  }
}

function provenanceFromMetaAndLayer(
  meta: ProjectSchemeItemFiveFieldsInput["meta"],
  fineLayer: FineModelLayer | null | undefined,
): string | undefined {
  if (meta) {
    const base = SOURCE_PROVENANCE[meta.source];
    if (base) {
      if (fineLayer && meta.id) {
        const hit = fineLayer.acceptance.some(
          (a) => a.acceptance_id === meta.id,
        );
        if (hit) return `${base} · 细模型加层对齐`;
      }
      return base;
    }
  }
  return undefined;
}

/**
 * DTO → 视图五字段纯函数。
 * - 非法枚举 / 空串 / 非数组 links → 丢弃该字段
 * - 缺省不伪造 confirmed / high
 * - 不修改入参；不返回 / 不触碰 source、evidence
 */
export function projectSchemeItemFiveFields(
  input: ProjectSchemeItemFiveFieldsInput = {},
): SchemeItemProjectionDto {
  const dto = input.dto ?? null;
  const out: SchemeItemProjectionDto = {};

  if (dto && isStatus(dto.status)) {
    out.status = dto.status;
  } else {
    const derived = statusFromMeta(input.meta, input.schemeFrozen);
    if (derived) out.status = derived;
  }

  if (dto && typeof dto.scope === "string") {
    const scope = dto.scope.trim();
    if (scope !== "") out.scope = scope;
  }

  if (dto && typeof dto.provenance === "string") {
    const provenance = dto.provenance.trim();
    if (provenance !== "") out.provenance = provenance;
  } else {
    const derived = provenanceFromMetaAndLayer(input.meta, input.fineLayer);
    if (derived) out.provenance = derived;
  }

  const links = sanitizeLinks(dto?.links);
  if (links) out.links = links;

  if (dto && isConfidence(dto.confidence)) {
    out.confidence = dto.confidence;
  }

  return out;
}

/**
 * 断言辅助：投影结果不得冒充 meta 写回字段（测试 / 门禁用）。
 * 本函数自身不写盘、不改 meta。
 */
export function assertProjectionDoesNotTouchAuthority(
  metaBefore: SchemeItemMeta,
  metaAfter: SchemeItemMeta,
  projection: SchemeItemProjectionDto,
): void {
  if (metaBefore.source !== metaAfter.source) {
    throw new Error("五字段投影不得改写 SchemeItemMeta.source");
  }
  if (
    JSON.stringify(metaBefore.evidence) !== JSON.stringify(metaAfter.evidence)
  ) {
    throw new Error("五字段投影不得改写 SchemeItemMeta.evidence");
  }
  const projKeys = Object.keys(projection);
  if (projKeys.includes("source") || projKeys.includes("evidence")) {
    throw new Error("五字段投影结果不得携带 source/evidence");
  }
}
