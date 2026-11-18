/**
 * TASK-C.10q + TASK-J.38c：Studio 中栏「全景 / 施工」双视角默认路由。
 *
 * - 无图 → 默认全景（进门看项目在干什么）
 * - 有图 → 默认施工（确认原型后的任务图谱）
 * 全景**禁止**展示施工绿灯（无 illumination 数据源）。
 * J.38c：不另起第三视角；附录 C 投影壳挂在全景内，不改本路由语义。
 */

export const STUDIO_LENS_IDS = ["panorama", "construction"] as const;

export type StudioLensId = (typeof STUDIO_LENS_IDS)[number];

export const STUDIO_LENS_LABEL: Readonly<Record<StudioLensId, string>> = {
  panorama: "全景",
  construction: "施工",
};

/** 全景视角不得承载施工 illumination（J.38c 守卫常量） */
export const PANORAMA_LENS_FORBIDS_ILLUMINATION = true as const;

/**
 * 守卫：全景壳不得声明 illumination 字段。
 * 双视角集合保持仅 panorama/construction，禁止另起视图体系。
 */
export function assertPanoramaLensContract(input?: {
  lensIds?: readonly string[];
  illumination?: unknown;
}): void {
  const ids = input?.lensIds ?? STUDIO_LENS_IDS;
  if (ids.length !== 2 || ids[0] !== "panorama" || ids[1] !== "construction") {
    throw new Error("studio lens set must remain panorama|construction only");
  }
  if (input?.illumination != null) {
    throw new Error("panorama lens must not carry illumination");
  }
  if (PANORAMA_LENS_FORBIDS_ILLUMINATION !== true) {
    throw new Error("panorama must forbid illumination");
  }
}

/**
 * 根据是否已有任务图决定默认视角。
 * 有图时偏向施工；无图时偏向全景。手动覆盖由外壳保留。
 */
export function resolveDefaultLens(input: { hasGraph: boolean }): StudioLensId {
  return input.hasGraph ? "construction" : "panorama";
}

/**
 * 图从无到有（例如刚确认原型）时强制切到施工，并清掉手动覆盖。
 */
export function resolveActiveLens(input: {
  hasGraph: boolean;
  previousHasGraph: boolean | null;
  manualLens: StudioLensId | null;
}): { lens: StudioLensId; clearManual: boolean } {
  const auto = resolveDefaultLens({ hasGraph: input.hasGraph });
  const gainedGraph =
    input.previousHasGraph === false && input.hasGraph === true;
  if (gainedGraph) {
    return { lens: "construction", clearManual: true };
  }
  if (input.manualLens !== null) {
    return { lens: input.manualLens, clearManual: false };
  }
  return { lens: auto, clearManual: false };
}
