/**
 * TASK-L.18：只读加载目标仓 docs/system/modules.yaml 与 interfaces/ 消费者。
 * 不写盘；失败时诚实返回空/缺失，不抛给调用方编造图。
 */

import fs from "node:fs";
import path from "node:path";
import { load as parseYaml } from "js-yaml";
import {
  safeParseModulesYaml,
  type ModuleEntry,
  type ModulesYaml,
} from "../../src/lib/knowledge/modules-schema";

export type LoadModulesResult =
  | {
      ok: true;
      data: ModulesYaml;
      interfaceConsumers: Record<string, string[]>;
      modules_path: string;
    }
  | {
      ok: false;
      reason: "missing" | "invalid";
      detail: string;
      modules_path: string;
    };

function modulesYamlPath(repoRoot: string): string {
  return path.join(repoRoot, "docs", "system", "modules.yaml");
}

/**
 * 从 interfaces/<module-id>.md 解析 consumers 行。
 * 认 `consumers:` / `消费者:` 后的逗号/空白分隔 id；只保留已知模块 id，且不含自身。
 */
export function parseInterfaceConsumersMarkdown(
  markdown: string,
  moduleId: string,
  knownIds: ReadonlySet<string>,
): string[] {
  const out = new Set<string>();
  for (const line of markdown.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:consumers?|消费者)\s*[:：]\s*(.+)\s*$/i);
    if (!m?.[1]) continue;
    for (const raw of m[1].split(/[,，\s]+/)) {
      const id = raw.trim();
      if (!id || id === moduleId) continue;
      if (knownIds.has(id)) out.add(id);
    }
  }
  return [...out].sort();
}

export function loadInterfaceConsumers(
  repoRoot: string,
  modules: readonly ModuleEntry[],
): Record<string, string[]> {
  const known = new Set(modules.map((m) => m.id));
  const dir = path.join(repoRoot, "docs", "system", "interfaces");
  const result: Record<string, string[]> = {};
  if (!fs.existsSync(dir)) return result;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith(".md")) continue;
    const moduleId = ent.name.slice(0, -3);
    if (!known.has(moduleId)) continue;
    let text: string;
    try {
      text = fs.readFileSync(path.join(dir, ent.name), "utf8");
    } catch {
      continue;
    }
    const consumers = parseInterfaceConsumersMarkdown(text, moduleId, known);
    if (consumers.length > 0) result[moduleId] = consumers;
  }
  return result;
}

export function loadModulesForRepo(repoRoot: string): LoadModulesResult {
  const modules_path = modulesYamlPath(repoRoot);
  if (!fs.existsSync(modules_path)) {
    return {
      ok: false,
      reason: "missing",
      detail: "docs/system/modules.yaml 不存在",
      modules_path,
    };
  }
  try {
    const rawText = fs.readFileSync(modules_path, "utf8");
    const raw = parseYaml(rawText);
    const parsed = safeParseModulesYaml(raw);
    if (!parsed.success) {
      return {
        ok: false,
        reason: "invalid",
        detail: parsed.error.issues[0]?.message ?? "schema invalid",
        modules_path,
      };
    }
    const interfaceConsumers = loadInterfaceConsumers(
      repoRoot,
      parsed.data.modules,
    );
    return {
      ok: true,
      data: parsed.data,
      interfaceConsumers,
      modules_path,
    };
  } catch (err) {
    return {
      ok: false,
      reason: "invalid",
      detail: err instanceof Error ? err.message : String(err),
      modules_path,
    };
  }
}
