/**
 * TASK-L.15：读取 `.stagent/release-targets.json`。
 */
import fs from "node:fs";
import path from "node:path";
import {
  ReleaseInvariantError,
  validateTargetPort,
  type ReleaseTargetConfig,
  type ReleaseTargetsFile,
} from "../../src/lib/release/release";

export const RELEASE_TARGETS_REL = ".stagent/release-targets.json";

export function targetsPath(repoRoot: string): string {
  return path.join(repoRoot, RELEASE_TARGETS_REL);
}

export function loadReleaseTargets(repoRoot: string): ReleaseTargetConfig[] {
  const p = targetsPath(repoRoot);
  if (!fs.existsSync(p)) return [];
  const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as ReleaseTargetsFile;
  if (!raw || !Array.isArray(raw.targets)) {
    throw new ReleaseInvariantError(
      "E_RELEASE_TARGETS_INVALID",
      "release-targets.json 缺少 targets 数组",
    );
  }
  for (const t of raw.targets) {
    if (!t.target_id || !t.kind) {
      throw new ReleaseInvariantError(
        "E_RELEASE_TARGETS_INVALID",
        "每个目标需要 target_id 与 kind",
      );
    }
    validateTargetPort(t.port);
  }
  return raw.targets;
}

export function findTarget(
  repoRoot: string,
  targetId: string,
): ReleaseTargetConfig {
  const t = loadReleaseTargets(repoRoot).find((x) => x.target_id === targetId);
  if (!t) {
    throw new ReleaseInvariantError(
      "E_RELEASE_TARGET_NOT_FOUND",
      `找不到发布目标「${targetId}」`,
    );
  }
  return t;
}
