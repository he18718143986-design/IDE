/**
 * TASK-J.19：DN-2「可以/不行」意外卡的侧车载荷。
 * 挂起时由 design-step 写入；HTTP/画布入口读取后调用 resolveDesignDependencyAllow。
 * 路径：`.stagent/records/<contractId>/design-dependency-surprise.json`
 * 禁止写入已废止的 `.stagent/metadata/`。
 */

import fs from "node:fs";
import path from "node:path";

export const DESIGN_DEPENDENCY_SURPRISE_FILE =
  "design-dependency-surprise.json" as const;

export interface DesignDependencySurprise {
  schema_version: "1.0.0";
  contract_id: string;
  reason: "DESIGN_NEEDS_DEPENDENCY";
  original_stub_id: string | null;
  dependencies: Array<{ name: string; version: string; why: string }>;
  detail: string;
  created_at: string;
}

function surprisePath(repoRoot: string, contractId: string): string {
  return path.join(
    repoRoot,
    ".stagent",
    "records",
    contractId,
    DESIGN_DEPENDENCY_SURPRISE_FILE,
  );
}

export function writeDesignDependencySurprise(
  repoRoot: string,
  surprise: Omit<DesignDependencySurprise, "schema_version" | "created_at"> & {
    created_at?: string;
  },
): string {
  const file = surprisePath(repoRoot, surprise.contract_id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const full: DesignDependencySurprise = {
    schema_version: "1.0.0",
    contract_id: surprise.contract_id,
    reason: "DESIGN_NEEDS_DEPENDENCY",
    original_stub_id: surprise.original_stub_id,
    dependencies: surprise.dependencies,
    detail: surprise.detail,
    created_at: surprise.created_at ?? new Date().toISOString(),
  };
  fs.writeFileSync(file, `${JSON.stringify(full, null, 2)}\n`, "utf8");
  return file;
}

export function readDesignDependencySurprise(
  repoRoot: string,
  contractId: string,
): DesignDependencySurprise | null {
  const file = surprisePath(repoRoot, contractId);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(
      fs.readFileSync(file, "utf8"),
    ) as DesignDependencySurprise;
    if (
      !raw ||
      raw.schema_version !== "1.0.0" ||
      raw.reason !== "DESIGN_NEEDS_DEPENDENCY" ||
      raw.contract_id !== contractId ||
      !Array.isArray(raw.dependencies)
    ) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

export function clearDesignDependencySurprise(
  repoRoot: string,
  contractId: string,
): void {
  const file = surprisePath(repoRoot, contractId);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
}
