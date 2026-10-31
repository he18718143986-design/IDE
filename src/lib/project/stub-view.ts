/**
 * TASK-L.9 / project-decomposition.md §5：方案的「桩视图」。
 *
 * 把整份方案裁成只含该桩 scheme_item_ids（及 area_hints）的视图，
 * 作为 buildScopePlan 的 scheme 入参——禁止把其他桩的区域混进本份 ScopePlan。
 */

import type { ScopePlanSchemeInput } from "../../../daemon/supervisor/scope-plan-builder";
import type { SchemeDraftV2, WithText } from "../journey/scheme-patch-types";
import type { ContractStub } from "./project-plan";

export type SchemeLikeForStubView =
  | ScopePlanSchemeInput
  | (Pick<
      SchemeDraftV2,
      | "scheme_revision"
      | "title"
      | "summary"
      | "goals"
      | "modules"
      | "acceptance"
      | "out_of_scope"
      | "entities"
      | "notes"
    > & {
      modules?: SchemeDraftV2["modules"] | string[];
      notes?: string | null;
    });

function filterByIds<T extends { id: string }>(
  items: readonly T[] | undefined,
  ids: ReadonlySet<string>,
): T[] {
  if (!items) return [];
  return items.filter((item) => ids.has(item.id));
}

/**
 * 只保留桩声明的 scheme_item_ids；区域提示写入 notes，供路径启发式消费。
 */
export function schemeViewForStub(
  scheme: SchemeLikeForStubView,
  stub: ContractStub,
): ScopePlanSchemeInput {
  const ids = new Set(stub.scheme_item_ids);
  const goals = filterByIds(
    "goals" in scheme && Array.isArray(scheme.goals)
      ? (scheme.goals as WithText[])
      : undefined,
    ids,
  );
  const acceptance = filterByIds(
    "acceptance" in scheme && Array.isArray(scheme.acceptance)
      ? (scheme.acceptance as Array<WithText & { check?: string }>)
      : undefined,
    ids,
  );

  const modulesV2 =
    "modules" in scheme &&
    Array.isArray(scheme.modules) &&
    scheme.modules.length > 0 &&
    typeof scheme.modules[0] === "object"
      ? filterByIds(
          scheme.modules as Array<{ id: string; name: string; purpose?: string; kind?: "new" | "change_existing" }>,
          ids,
        )
      : [];

  const moduleNamesFromV2 = modulesV2.map((m) => m.name);
  const moduleNamesLegacy =
    "modules" in scheme &&
    Array.isArray(scheme.modules) &&
    (scheme.modules.length === 0 || typeof scheme.modules[0] === "string")
      ? (scheme.modules as string[]).filter((name) =>
          // 旧 SchemeDraft.modules 无 id：若桩有 area_hints 则不依赖名字过滤
          stub.area_hints.length === 0 ? true : stub.area_hints.some((h) => name.includes(h) || h.includes(name)),
        )
      : [];

  const titleBits = [
    stub.title,
    ...goals.map((g) => g.text),
    ...moduleNamesFromV2,
  ].filter(Boolean);
  const summaryBits = [
    ...goals.map((g) => g.text),
    ...acceptance.map((a) => ("text" in a ? String(a.text) : "")),
    ...stub.area_hints.map((h) => `区域 ${h}`),
  ].filter(Boolean);

  const notesParts: string[] = [];
  if (typeof scheme.notes === "string" && scheme.notes.trim()) {
    notesParts.push(scheme.notes.trim());
  }
  for (const hint of stub.area_hints) {
    notesParts.push(hint);
  }

  const outOfScope =
    "out_of_scope" in scheme && Array.isArray(scheme.out_of_scope)
      ? scheme.out_of_scope.map((o) =>
          typeof o === "string" ? { text: o } : { text: (o as { text: string }).text },
        )
      : [];

  return {
    scheme_revision: scheme.scheme_revision,
    title: titleBits[0] ?? stub.title,
    summary: summaryBits.join("；") || stub.title,
    modules:
      moduleNamesFromV2.length > 0
        ? moduleNamesFromV2
        : moduleNamesLegacy.length > 0
          ? moduleNamesLegacy
          : stub.area_hints.length > 0
            ? stub.area_hints
            : [],
    notes: notesParts.join("\n"),
    ...(modulesV2.length > 0
      ? {
          modules_v2: modulesV2.map((m) => ({
            id: m.id,
            name: m.name,
            purpose: m.purpose,
            kind: m.kind ?? "new",
            project_anchor: stub.area_hints[0],
          })),
        }
      : stub.area_hints.length > 0
        ? {
            modules_v2: stub.area_hints.map((hint, i) => ({
              id: stub.scheme_item_ids[i] ?? `hint-${i}`,
              name: hint,
              purpose: stub.title,
              kind: "change_existing" as const,
              project_anchor: hint,
            })),
          }
        : {}),
    ...(acceptance.length > 0
      ? {
          acceptance: acceptance.map((a) => ({
            id: a.id,
            text: "text" in a ? String(a.text) : a.id,
            check:
              "check" in a && (a.check === "auto" || a.check === "playtest" || a.check === "both")
                ? a.check
                : ("both" as const),
          })),
        }
      : {}),
    ...(outOfScope.length > 0 ? { out_of_scope: outOfScope } : {}),
  };
}
