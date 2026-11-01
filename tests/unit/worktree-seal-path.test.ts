/**
 * TASK-A.7：seal worktreeDir 与 worktree-manager.getWorktreePath 统一 `task-{id}`。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { safeRmSync } from "../helpers/tmp";
import {
  acquireWorktreeLock,
  isWorktreeSealed,
  readWorktreeManifest,
  sealWorktree,
  worktreeManifestPath,
} from "../../daemon/guard/worktree-seal";
import { getWorktreePath } from "../../daemon/git/worktree-manager";

const tmpDirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-a7-"));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try {
      safeRmSync(d);
    } catch {
      /* ignore */
    }
  }
});

describe("TASK-A.7 seal path prefix aligns with manager", () => {
  it("manifest 路径含 /task- 前缀，且目录 === getWorktreePath", () => {
    const root = tmp();
    const contractId = "wt-a7";
    const manifestPath = worktreeManifestPath(root, contractId);
    const sealDir = path.dirname(manifestPath);
    const managerDir = getWorktreePath(root, contractId);

    expect(manifestPath.replace(/\\/g, "/")).toMatch(/\/task-wt-a7\/\.stagent_manifest\.json$/);
    expect(path.basename(sealDir)).toBe(`task-${contractId}`);
    expect(sealDir).toBe(managerDir);
  });

  it("seal 写入落在 task- 目录；旧无前缀目录不可见（判未封存）", () => {
    const root = tmp();
    const contractId = "legacy1";
    const legacyDir = path.join(root, ".stagent", "worktrees", contractId);
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, ".stagent_manifest.json"),
      JSON.stringify({
        schema_version: "1.0.0",
        contract_id: contractId,
        sealed: true,
        sealed_at: "2020-01-01T00:00:00.000Z",
        lock_held: true,
        note: "legacy unprefixed",
      }),
      "utf8",
    );

    // 只读新路径：旧 manifest 不可见 → 未封存
    expect(readWorktreeManifest(root, contractId)).toBeNull();
    expect(isWorktreeSealed(root, contractId)).toBe(false);

    acquireWorktreeLock(root, contractId);
    const seal = sealWorktree({ repoRoot: root, contract_id: contractId });
    expect(seal.ok).toBe(true);
    expect(seal.manifest_path).toBe(worktreeManifestPath(root, contractId));
    expect(path.basename(path.dirname(seal.manifest_path))).toBe(
      `task-${contractId}`,
    );
    expect(isWorktreeSealed(root, contractId)).toBe(true);

    // 旧路径仍在，但不被读
    expect(
      fs.existsSync(path.join(legacyDir, ".stagent_manifest.json")),
    ).toBe(true);
  });
});
