/**
 * TASK-L.7：ProjectPlan 落盘（`.stagent/project/plan.json`）。
 * 旧版写入 `plan.revisions/<revision>.json`；原子写：临时文件 + rename。
 */

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../../src/lib/state-machine";
import type { ProjectPlan } from "../../src/lib/project/project-plan";

export const PROJECT_DIR = ".stagent/project" as const;
export const PLAN_FILENAME = "plan.json" as const;
export const PLAN_REVISIONS_DIR = "plan.revisions" as const;

export function projectDir(repoRoot: string): string {
  return path.resolve(repoRoot, PROJECT_DIR);
}

export function planPath(repoRoot: string): string {
  return path.join(projectDir(repoRoot), PLAN_FILENAME);
}

export function planRevisionPath(repoRoot: string, revision: number): string {
  return path.join(
    projectDir(repoRoot),
    PLAN_REVISIONS_DIR,
    `${revision}.json`,
  );
}

export function readPlan(repoRoot: string): ProjectPlan | null {
  const target = planPath(repoRoot);
  if (!fs.existsSync(target)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(target, "utf8")) as ProjectPlan;
    if (raw?.schema_version !== "1.0.0") return null;
    if (typeof raw.plan_revision !== "number") return null;
    return raw;
  } catch {
    return null;
  }
}

/**
 * 写入计划。若已有现行 plan.json，先将其归档到
 * `plan.revisions/<旧 plan_revision>.json`（不覆盖已存在的同名修订）。
 */
export function writePlan(repoRoot: string, plan: ProjectPlan): void {
  const dir = projectDir(repoRoot);
  fs.mkdirSync(dir, { recursive: true });
  const target = planPath(repoRoot);

  if (fs.existsSync(target)) {
    const previous = readPlan(repoRoot);
    if (previous) {
      const revDir = path.join(dir, PLAN_REVISIONS_DIR);
      fs.mkdirSync(revDir, { recursive: true });
      const archive = planRevisionPath(repoRoot, previous.plan_revision);
      if (!fs.existsSync(archive)) {
        writeJsonAtomic(archive, previous);
      }
    }
  }

  writeJsonAtomic(target, plan);
}
