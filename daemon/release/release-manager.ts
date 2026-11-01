/**
 * TASK-L.15：发布编排 —— 草稿 / 执行 / 回滚 / 持久化。
 *
 * 不创建 git worktree：用 `git archive <sha> | tar -x` 导出干净目录。
 * 保险库值只注入 deploy 与 health；install / build 只用明文 build_env。
 * 合同状态机与 MERGED 终态不变（ADR-0012）。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  RELEASE_SCHEMA_VERSION,
  ReleaseInvariantError,
  assertAtMostOneActive,
  assertAtMostOneLive,
  assertTransition,
  canTransition,
  type ReleaseRecord,
  type ReleaseStep,
  type ReleaseTargetConfig,
} from "../../src/lib/release/release";
import { findTarget, loadReleaseTargets } from "./targets-store";
import type { ReleaseTargetAdapter, StepResult } from "./target-adapter";
import { LocalProcessAdapter } from "./targets/local-process";
import { UserCommandAdapter } from "./targets/user-command";
import { getActiveVault, type Vault } from "../vault";
import { isProtectedBranch } from "../git/branch-guard";
import { redactSecrets } from "../runner/command-runner";

export const RELEASES_DIR_REL = ".stagent/releases";

export interface ReleaseManagerOptions {
  repoRoot: string;
  vault?: Vault | null;
  /** 探活最大失败次数，默认 3 */
  healthAttempts?: number;
  /** 探活间隔 ms，默认 500（测试可降） */
  healthIntervalMs?: number;
  /** 测试注入：覆盖适配器 */
  adapters?: {
    local_process?: ReleaseTargetAdapter;
    user_command?: ReleaseTargetAdapter;
  };
  /** 测试注入：覆盖「提交是否在保护分支」 */
  isCommitOnProtectedBranch?: (sha: string) => boolean;
  now?: () => Date;
}

function releasesDir(repoRoot: string): string {
  return path.join(repoRoot, RELEASES_DIR_REL);
}

function releaseJsonPath(repoRoot: string, releaseId: string): string {
  return path.join(releasesDir(repoRoot), `${releaseId}.json`);
}

function checkoutDir(repoRoot: string, releaseId: string): string {
  return path.join(releasesDir(repoRoot), releaseId, "checkout");
}

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

export function listReleaseRecords(repoRoot: string): ReleaseRecord[] {
  const dir = releasesDir(repoRoot);
  if (!fs.existsSync(dir)) return [];
  const out: ReleaseRecord[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(
        fs.readFileSync(path.join(dir, name), "utf-8"),
      ) as ReleaseRecord;
      out.push(raw);
    } catch {
      // skip corrupt
    }
  }
  return out.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function readRelease(
  repoRoot: string,
  releaseId: string,
): ReleaseRecord | null {
  const p = releaseJsonPath(repoRoot, releaseId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8")) as ReleaseRecord;
}

function persist(repoRoot: string, record: ReleaseRecord): void {
  ensureDir(releasesDir(repoRoot));
  const tmp = releaseJsonPath(repoRoot, record.release_id) + ".tmp";
  const final = releaseJsonPath(repoRoot, record.release_id);
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n");
  fs.renameSync(tmp, final);
}

function stepFromResult(
  name: ReleaseStep["step"],
  result: StepResult,
): ReleaseStep {
  return {
    step: name,
    argv: result.argv,
    exit_code: result.exit_code,
    started_at: result.started_at,
    ended_at: result.ended_at,
    log_tail: result.log_tail,
  };
}

function defaultIsCommitOnProtectedBranch(
  repoRoot: string,
  sha: string,
): boolean {
  // 任一保护分支名包含该提交即通过 R-INV-3
  try {
    const out = execFileSync(
      "git",
      ["branch", "--contains", sha, "--format=%(refname:short)"],
      { cwd: repoRoot, encoding: "utf-8" },
    );
    const branches = out
      .split("\n")
      .map((l) => l.replace(/^\*\s*/, "").trim())
      .filter(Boolean);
    if (branches.some((b) => isProtectedBranch(b))) return true;
    // 也检查远程跟踪名（origin/main）
    const outAll = execFileSync(
      "git",
      ["branch", "-a", "--contains", sha, "--format=%(refname:short)"],
      { cwd: repoRoot, encoding: "utf-8" },
    );
    return outAll
      .split("\n")
      .map((l) => l.replace(/^\*\s*/, "").trim().replace(/^origin\//, ""))
      .filter(Boolean)
      .some((b) => isProtectedBranch(b));
  } catch {
    return false;
  }
}

function collectContractIds(
  repoRoot: string,
  commitSha: string,
  previousLiveSha: string | null,
): string[] {
  try {
    const range = previousLiveSha
      ? `${previousLiveSha}..${commitSha}`
      : commitSha;
    const log = execFileSync(
      "git",
      ["log", range, "--format=%B%x00"],
      { cwd: repoRoot, encoding: "utf-8" },
    );
    const ids = new Set<string>();
    for (const msg of log.split("\0")) {
      for (const line of msg.split("\n")) {
        const m = line.match(/^Stagent-Contract-ID:\s*(.+)\s*$/);
        if (m?.[1]) ids.add(m[1].trim());
      }
    }
    return [...ids];
  } catch {
    return [];
  }
}

function nextReleaseId(repoRoot: string, now: Date): string {
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const prefix = `rel-${y}${mo}${d}-`;
  const existing = listReleaseRecords(repoRoot)
    .map((r) => r.release_id)
    .filter((id) => id.startsWith(prefix));
  let max = 0;
  for (const id of existing) {
    const n = Number(id.slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(2, "0")}`;
}

export function exportCheckout(
  repoRoot: string,
  commitSha: string,
  dest: string,
): void {
  ensureDir(dest);
  // 清空目标（若重入）
  for (const name of fs.readdirSync(dest)) {
    fs.rmSync(path.join(dest, name), { recursive: true, force: true });
  }
  const archive = spawnSync(
    "git",
    ["archive", "--format=tar", commitSha],
    { cwd: repoRoot, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
  );
  if (archive.status !== 0) {
    throw new ReleaseInvariantError(
      "E_RELEASE_ARCHIVE",
      `git archive 失败：${archive.stderr?.toString() || "unknown"}`,
    );
  }
  const tar = spawnSync("tar", ["-x", "-C", dest], {
    input: archive.stdout,
    encoding: "buffer",
  });
  if (tar.status !== 0) {
    throw new ReleaseInvariantError(
      "E_RELEASE_ARCHIVE",
      `tar 解包失败：${tar.stderr?.toString() || "unknown"}`,
    );
  }
}

export class ReleaseManager {
  private readonly repoRoot: string;
  private readonly healthAttempts: number;
  private readonly healthIntervalMs: number;
  private readonly adapters: {
    local_process: ReleaseTargetAdapter;
    user_command: ReleaseTargetAdapter;
  };
  private readonly isCommitOnProtectedBranch: (sha: string) => boolean;
  private readonly now: () => Date;
  private vaultOverride: Vault | null | undefined;

  constructor(options: ReleaseManagerOptions) {
    this.repoRoot = options.repoRoot;
    this.healthAttempts = options.healthAttempts ?? 3;
    this.healthIntervalMs = options.healthIntervalMs ?? 500;
    this.adapters = {
      local_process:
        options.adapters?.local_process ?? new LocalProcessAdapter(),
      user_command:
        options.adapters?.user_command ?? new UserCommandAdapter(),
    };
    this.isCommitOnProtectedBranch =
      options.isCommitOnProtectedBranch ??
      ((sha) => defaultIsCommitOnProtectedBranch(this.repoRoot, sha));
    this.now = options.now ?? (() => new Date());
    this.vaultOverride = options.vault;
  }

  private vault(): Vault | null {
    if (this.vaultOverride !== undefined) return this.vaultOverride;
    return getActiveVault();
  }

  private adapterFor(target: ReleaseTargetConfig): ReleaseTargetAdapter {
    return this.adapters[target.kind];
  }

  listTargets(): ReleaseTargetConfig[] {
    return loadReleaseTargets(this.repoRoot);
  }

  list(): ReleaseRecord[] {
    return listReleaseRecords(this.repoRoot);
  }

  get(releaseId: string): ReleaseRecord | null {
    return readRelease(this.repoRoot, releaseId);
  }

  /**
   * 创建草稿。R-INV-2 / R-INV-3 在此检查；R-INV-1 在进入 LIVE 时再断言。
   */
  async createDraft(input: {
    target_id: string;
    commit_sha: string;
  }): Promise<ReleaseRecord> {
    const target = findTarget(this.repoRoot, input.target_id);
    const sha = input.commit_sha.trim();
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
      throw new ReleaseInvariantError(
        "E_RELEASE_BAD_SHA",
        `提交号格式不对：${sha}`,
      );
    }
    if (!this.isCommitOnProtectedBranch(sha)) {
      throw new ReleaseInvariantError(
        "E_RELEASE_INV3",
        "只能发布保护分支上的已合并提交",
      );
    }

    const all = listReleaseRecords(this.repoRoot);
    // 草稿也算非终态 —— 同目标不能并行
    const pretend: ReleaseRecord = {
      schema_version: RELEASE_SCHEMA_VERSION,
      release_id: "__pending__",
      target_id: target.target_id,
      commit_sha: sha,
      contract_ids: [],
      state: "RELEASE_DRAFT",
      previous_live_release_id: null,
      steps: [],
      created_at: this.now().toISOString(),
      triggered_by: "USER",
    };
    assertAtMostOneActive([...all, pretend], target.target_id);

    const previousLive =
      all
        .filter((r) => r.target_id === target.target_id && r.state === "LIVE")
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;

    const created = this.now();
    const release_id = nextReleaseId(this.repoRoot, created);
    const contract_ids = collectContractIds(
      this.repoRoot,
      sha,
      previousLive?.commit_sha ?? null,
    );

    const record: ReleaseRecord = {
      schema_version: RELEASE_SCHEMA_VERSION,
      release_id,
      target_id: target.target_id,
      commit_sha: sha,
      contract_ids,
      state: "RELEASE_DRAFT",
      previous_live_release_id: previousLive?.release_id ?? null,
      steps: [],
      created_at: created.toISOString(),
      triggered_by: "USER",
      incident: null,
    };
    persist(this.repoRoot, record);
    return record;
  }

  /**
   * 删除草稿（取消）。
   */
  cancelDraft(releaseId: string): void {
    const rec = readRelease(this.repoRoot, releaseId);
    if (!rec) {
      throw new ReleaseInvariantError(
        "E_RELEASE_NOT_FOUND",
        `找不到发布 ${releaseId}`,
      );
    }
    if (rec.state !== "RELEASE_DRAFT") {
      throw new ReleaseInvariantError(
        "E_RELEASE_NOT_DRAFT",
        "只能取消草稿状态的发布",
      );
    }
    fs.rmSync(releaseJsonPath(this.repoRoot, releaseId), { force: true });
    fs.rmSync(path.join(releasesDir(this.repoRoot), releaseId), {
      recursive: true,
      force: true,
    });
  }


  private async resolveDeployEnv(
    target: ReleaseTargetConfig,
  ): Promise<{ env: Record<string, string>; secrets: string[]; missing: string[] }> {
    const keys = target.env_keys ?? [];
    const vault = this.vault();
    const missing: string[] = [];
    const env: Record<string, string> = { ...(target.build_env ?? {}) };
    // build_env 是明文，也进 deploy（额外）；但 secrets 列表只含保险库值
    const secrets: string[] = [];
    if (keys.length === 0) {
      return { env: { ...(target.build_env ?? {}) }, secrets, missing };
    }
    if (!vault) {
      return { env, secrets, missing: [...keys] };
    }
    const names = await vault.listNames();
    const nameSet = new Set(names);
    for (const k of keys) {
      if (!nameSet.has(k)) missing.push(k);
    }
    if (missing.length > 0) {
      return { env, secrets, missing };
    }
    const resolved = await vault.resolveEnv(keys);
    for (const [k, v] of Object.entries(resolved)) {
      env[k] = v;
      secrets.push(v);
    }
    return { env, secrets, missing };
  }

  private transition(rec: ReleaseRecord, to: ReleaseRecord["state"]): void {
    assertTransition(rec.state, to);
    rec.state = to;
    persist(this.repoRoot, rec);
  }

  /**
   * 用户点击「发布」：BUILDING → … → LIVE / FAILED / ROLLED_BACK。
   */
  async run(releaseId: string): Promise<ReleaseRecord> {
    const rec = readRelease(this.repoRoot, releaseId);
    if (!rec) {
      throw new ReleaseInvariantError(
        "E_RELEASE_NOT_FOUND",
        `找不到发布 ${releaseId}`,
      );
    }
    if (rec.state !== "RELEASE_DRAFT") {
      throw new ReleaseInvariantError(
        "E_RELEASE_NOT_DRAFT",
        `发布 ${releaseId} 不是草稿（当前 ${rec.state}）`,
      );
    }

    const target = findTarget(this.repoRoot, rec.target_id);
    const adapter = this.adapterFor(target);

    // RO-06：缺密钥 → 前置失败（保持 DRAFT，不进入 BUILDING）
    const deployEnv = await this.resolveDeployEnv(target);
    if (deployEnv.missing.length > 0) {
      throw new ReleaseInvariantError(
        "E_RELEASE_MISSING_SECRETS",
        `发布前还缺这些密钥：${deployEnv.missing.join("、")}。请到设置 → 密钥里补上。`,
      );
    }

    // 再确认 R-INV-2（排除自己）
    const others = listReleaseRecords(this.repoRoot).filter(
      (r) => r.release_id !== rec.release_id,
    );
    assertAtMostOneActive(
      [
        ...others,
        { ...rec, state: "BUILDING" },
      ],
      rec.target_id,
    );

    this.transition(rec, "BUILDING");

    const dest = checkoutDir(this.repoRoot, rec.release_id);
    try {
      exportCheckout(this.repoRoot, rec.commit_sha, dest);
    } catch (err) {
      rec.steps.push({
        step: "build",
        argv: ["git", "archive", rec.commit_sha],
        exit_code: 1,
        started_at: this.now().toISOString(),
        ended_at: this.now().toISOString(),
        log_tail: (err as Error).message,
      });
      this.transition(rec, "FAILED");
      return rec;
    }

    // build：只用明文 build_env，不注入保险库
    const buildEnv = { ...(target.build_env ?? {}) };
    const buildResult = await adapter.build({
      release: rec,
      checkoutDir: dest,
      env: buildEnv,
      target,
      repoRoot: this.repoRoot,
    });
    // 二次脱敏：防止脚本打印到别处的保险库值（RO-11：build 未注入，但仍扫一遍）
    const allSecrets = this.vault()?.currentValues() ?? [];
    buildResult.log_tail = redactSecrets(
      buildResult.log_tail,
      allSecrets,
    ).text.slice(-8_000);
    rec.steps.push(stepFromResult("build", buildResult));
    persist(this.repoRoot, rec);
    if (!buildResult.ok) {
      this.transition(rec, "FAILED");
      return rec;
    }

    this.transition(rec, "DEPLOYING");
    const deployResult = await adapter.deploy({
      release: rec,
      checkoutDir: dest,
      env: deployEnv.env,
      target,
      repoRoot: this.repoRoot,
    });
    deployResult.log_tail = redactSecrets(
      deployResult.log_tail,
      deployEnv.secrets,
    ).text.slice(-8_000);
    rec.steps.push(stepFromResult("deploy", deployResult));
    persist(this.repoRoot, rec);
    if (!deployResult.ok) {
      this.transition(rec, "FAILED");
      return rec;
    }

    this.transition(rec, "CHECKING_HEALTH");
    let healthOk = false;
    let lastHealth: StepResult | null = null;
    for (let i = 0; i < this.healthAttempts; i++) {
      lastHealth = await adapter.health({
        release: rec,
        checkoutDir: dest,
        env: deployEnv.env,
        target,
        repoRoot: this.repoRoot,
      });
      lastHealth.log_tail = redactSecrets(
        lastHealth.log_tail,
        deployEnv.secrets,
      ).text.slice(-8_000);
      if (lastHealth.ok) {
        healthOk = true;
        break;
      }
      if (i + 1 < this.healthAttempts) {
        await new Promise((r) => setTimeout(r, this.healthIntervalMs));
      }
    }
    if (lastHealth) {
      rec.steps.push(stepFromResult("health", lastHealth));
      persist(this.repoRoot, rec);
    }

    if (healthOk) {
      // 旧 LIVE → SUPERSEDED
      const prevId = rec.previous_live_release_id;
      if (prevId) {
        const prev = readRelease(this.repoRoot, prevId);
        if (prev && prev.state === "LIVE" && canTransition(prev.state, "SUPERSEDED")) {
          prev.state = "SUPERSEDED";
          persist(this.repoRoot, prev);
        }
      }
      this.transition(rec, "LIVE");
      const all = listReleaseRecords(this.repoRoot);
      assertAtMostOneLive(all, rec.target_id);
      return rec;
    }

    // 探活失败
    const prevId = rec.previous_live_release_id;
    const rollbackSupported = target.rollback_supported !== false;
    if (!prevId || !rollbackSupported) {
      if (!rollbackSupported && prevId) {
        rec.incident =
          "该目标声明不支持自动回滚（rollback_supported: false）；探活失败后请手动处理。";
        persist(this.repoRoot, rec);
      }
      this.transition(rec, "FAILED");
      return rec;
    }

    // 自动回滚
    this.transition(rec, "ROLLING_BACK");
    const prev = readRelease(this.repoRoot, prevId);
    if (!prev) {
      rec.incident = "找不到上一个 LIVE 记录，无法回滚。";
      persist(this.repoRoot, rec);
      this.transition(rec, "FAILED");
      return rec;
    }
    const prevCheckout = checkoutDir(this.repoRoot, prev.release_id);
    if (!fs.existsSync(prevCheckout)) {
      // 旧导出目录不在则重新导出
      exportCheckout(this.repoRoot, prev.commit_sha, prevCheckout);
    }

    // 停新版本 → 用旧导出目录重新部署 → 探活
    if (adapter.stop) {
      const stopNew = await adapter.stop({
        release: rec,
        checkoutDir: dest,
        env: deployEnv.env,
        target,
        repoRoot: this.repoRoot,
      });
      rec.steps.push(stepFromResult("rollback", stopNew));
      persist(this.repoRoot, rec);
    }

    const redeploy = await adapter.deploy({
      release: prev,
      checkoutDir: prevCheckout,
      env: deployEnv.env,
      target,
      repoRoot: this.repoRoot,
    });
    redeploy.log_tail = redactSecrets(
      redeploy.log_tail,
      deployEnv.secrets,
    ).text.slice(-8_000);
    rec.steps.push(
      stepFromResult("rollback", {
        ...redeploy,
        argv: ["rollback-deploy", ...redeploy.argv],
      }),
    );
    persist(this.repoRoot, rec);

    let rbHealthOk = false;
    let lastRbHealth: StepResult | null = null;
    for (let i = 0; i < this.healthAttempts; i++) {
      lastRbHealth = await adapter.health({
        release: prev,
        checkoutDir: prevCheckout,
        env: deployEnv.env,
        target,
        repoRoot: this.repoRoot,
      });
      lastRbHealth.log_tail = redactSecrets(
        lastRbHealth.log_tail,
        deployEnv.secrets,
      ).text.slice(-8_000);
      if (lastRbHealth.ok) {
        rbHealthOk = true;
        break;
      }
      if (i + 1 < this.healthAttempts) {
        await new Promise((r) => setTimeout(r, this.healthIntervalMs));
      }
    }
    if (lastRbHealth) {
      rec.steps.push(
        stepFromResult("rollback", {
          ...lastRbHealth,
          argv: ["rollback-health", ...lastRbHealth.argv],
        }),
      );
      persist(this.repoRoot, rec);
    }

    if (rbHealthOk) {
      // 上一个 LIVE 记录保持 LIVE（规范：本发布 → ROLLED_BACK，上一 LIVE 仍 LIVE）
      if (prev.state !== "LIVE") {
        prev.state = "LIVE";
        persist(this.repoRoot, prev);
      }
      this.transition(rec, "ROLLED_BACK");
      return rec;
    }

    rec.incident = "两个版本都起不来：新版本探活失败，回滚后旧版本也探活失败。";
    persist(this.repoRoot, rec);
    this.transition(rec, "FAILED");
    return rec;
  }

  /**
   * 手动回滚 = 以上一个 LIVE 的 commit_sha 新建草稿并立即执行（R-INV-4）。
   * 若当前发布是 LIVE，则 previous_live 取它自己的 previous；若是 FAILED，取它的 previous_live。
   */
  async rollback(releaseId: string): Promise<ReleaseRecord> {
    const rec = readRelease(this.repoRoot, releaseId);
    if (!rec) {
      throw new ReleaseInvariantError(
        "E_RELEASE_NOT_FOUND",
        `找不到发布 ${releaseId}`,
      );
    }
    if (rec.state !== "LIVE" && rec.state !== "FAILED") {
      throw new ReleaseInvariantError(
        "E_RELEASE_ROLLBACK_STATE",
        "只能从 LIVE 或 FAILED 卡上回滚",
      );
    }
    const prevId = rec.previous_live_release_id;
    if (!prevId) {
      throw new ReleaseInvariantError(
        "E_RELEASE_NO_PREVIOUS",
        "没有上一个可回滚的版本",
      );
    }
    const prev = readRelease(this.repoRoot, prevId);
    if (!prev) {
      throw new ReleaseInvariantError(
        "E_RELEASE_NO_PREVIOUS",
        "上一个版本记录丢失",
      );
    }
    // 若当前是 LIVE，先把它当作「将被取代」——但手动回滚是新建发布，
    // createDraft 时 previous LIVE 仍是当前 rec；run 成功后会 SUPERSEDED。
    const draft = await this.createDraft({
      target_id: rec.target_id,
      commit_sha: prev.commit_sha,
    });
    return this.run(draft.release_id);
  }
}
