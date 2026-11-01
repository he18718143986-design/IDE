/**
 * TASK-L.17b：Release Store 读取辅助（服务端版本指纹单一事实源）。
 *
 * `release_id` 是认可状态的唯一版本事实源：只认当前 `state === "LIVE"` 的发布记录。
 * 微合同修改 / 新部署导致 LIVE 变更时，旧 `release_id` 立即不再是「当前活跃版本」，
 * 由 playtest-guard 判 STALE_VERSION（不跨版本穿透）。
 *
 * 刻意**独立读盘、不 import `release-manager`**：后者会经 vault/keychain-backend
 * 传递引入 `node:child_process`，而 `check playtest` 门禁位于
 * `daemon/supervisor/**`，受 TASK-S.1「零工具静态依赖禁令（AST 传递闭包）」约束。
 * 门禁是纯只读判定，必须保持零命令执行依赖闭包。读取口径与 `listReleaseRecords`
 * 一致（`.stagent/releases/*.json`，按 created_at 升序），不复制解析逻辑之外的行为。
 */
import fs from "node:fs";
import path from "node:path";
import type { ReleaseRecord } from "../../src/lib/release/release";

/** 与 release-manager.ts::RELEASES_DIR_REL 保持一致；此处独立声明以避开重依赖闭包 */
const RELEASES_DIR_REL = ".stagent/releases";

function releasesDir(repoRoot: string): string {
  return path.join(path.resolve(repoRoot), RELEASES_DIR_REL);
}

/** 当前所有 LIVE 发布（按 created_at 升序，与 listReleaseRecords 一致） */
export function listLiveReleases(repoRoot: string): ReleaseRecord[] {
  const dir = releasesDir(repoRoot);
  if (!fs.existsSync(dir)) return [];
  const out: ReleaseRecord[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(
        fs.readFileSync(path.join(dir, name), "utf-8"),
      ) as ReleaseRecord;
      if (raw.state === "LIVE") out.push(raw);
    } catch {
      // 损坏记录跳过，与 release-manager 口径一致
    }
  }
  return out.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * 解析「当前活跃版本」`release_id`。
 *
 * - 优先取 `contract_ids` 含该合同的 LIVE 记录（合同 → 发布精确绑定）；
 * - 无匹配时回退到最近一条 LIVE（兼容 contract_ids 尚未回填的场景）；
 * - 无任何 LIVE → `null`（服务端无法装配 release_id，须显式报错，不得静默放过）。
 */
export function resolveCurrentLiveReleaseId(
  repoRoot: string,
  contractId: string,
): string | null {
  const lives = listLiveReleases(repoRoot);
  if (lives.length === 0) return null;
  const matching = lives.filter(
    (r) => Array.isArray(r.contract_ids) && r.contract_ids.includes(contractId),
  );
  const pool = matching.length > 0 ? matching : lives;
  const sorted = [...pool].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  return sorted[sorted.length - 1]?.release_id ?? null;
}
