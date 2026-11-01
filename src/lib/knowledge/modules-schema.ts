/**
 * TASK-L.11 / L.12：`docs/system/modules.yaml` 的 zod Schema、类型与路径覆盖。
 */

import { z } from "zod";
import { matchesAnyPattern } from "../scope";

export const moduleEntrySchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "module id must be kebab-case"),
  name: z.string().min(1),
  purpose: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1),
  depends_on: z.array(z.string().min(1)).default([]),
  interfaces: z.array(z.string().min(1)).default([]),
  introduced_by: z.string().min(1),
  updated_by: z.array(z.string().min(1)).default([]),
});

export type ModuleEntry = z.infer<typeof moduleEntrySchema>;

export const modulesYamlSchema = z.object({
  schema_version: z.literal("1.0.0"),
  modules: z.array(moduleEntrySchema),
});

export type ModulesYaml = z.infer<typeof modulesYamlSchema>;

export function parseModulesYaml(data: unknown): ModulesYaml {
  return modulesYamlSchema.parse(data);
}

export function safeParseModulesYaml(data: unknown) {
  return modulesYamlSchema.safeParse(data);
}

/**
 * TASK-L.12：路径是否被任一模块的 `paths` glob 覆盖。
 * 复用 `matchesAnyPattern`（与网关写范围同一套 picomatch 口径）。
 */
export function coversPath(
  modules: ModulesYaml | readonly ModuleEntry[],
  filePath: string,
): boolean {
  const list: readonly ModuleEntry[] = Array.isArray(modules)
    ? modules
    : (modules as ModulesYaml).modules;
  const patterns = list.flatMap((m: ModuleEntry) => m.paths);
  if (patterns.length === 0) return false;
  return matchesAnyPattern(filePath, [...patterns]).matches;
}

/**
 * TASK-L.12 / KB-4：`depends_on` 在已知模块 id 集合内是否成环。
 * 指向不存在 id 的边忽略（Schema 已允许；不在此升级为漂移）。
 */
export function hasDependsOnCycle(
  modules: readonly ModuleEntry[],
): boolean {
  const ids = new Set(modules.map((m) => m.id));
  const adj = new Map<string, string[]>();
  for (const m of modules) {
    adj.set(
      m.id,
      m.depends_on.filter((d) => ids.has(d)),
    );
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of ids) color.set(id, WHITE);

  const dfs = (node: string): boolean => {
    color.set(node, GRAY);
    for (const next of adj.get(node) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) return true;
      if (c === WHITE && dfs(next)) return true;
    }
    color.set(node, BLACK);
    return false;
  };

  for (const id of ids) {
    if ((color.get(id) ?? WHITE) === WHITE && dfs(id)) return true;
  }
  return false;
}
