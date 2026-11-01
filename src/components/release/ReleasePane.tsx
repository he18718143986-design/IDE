/**
 * TASK-L.15：画布「发布」页 —— 选目标、发布、进度、回滚。
 * 不显示密钥值；不宣称端到端运维闭环（L.16 另卡）。
 */
import { useCallback, useEffect, useState } from "react";
import type { DaemonConnection } from "@/lib/daemon-api";
import {
  createReleaseDraft,
  fetchReleases,
  rollbackRelease,
  runRelease,
} from "@/lib/daemon-api";
import type {
  ReleaseRecord,
  ReleaseTargetConfig,
} from "@/lib/release/release";

export interface ReleasePaneProps {
  conn: DaemonConnection;
  connected: boolean;
  /** 默认填入的提交（保护分支 tip） */
  defaultCommitSha?: string;
}

const STATE_LABEL: Record<string, string> = {
  RELEASE_DRAFT: "草稿",
  BUILDING: "构建中",
  DEPLOYING: "部署中",
  CHECKING_HEALTH: "检查中",
  LIVE: "已上线",
  FAILED: "失败",
  ROLLING_BACK: "回滚中",
  ROLLED_BACK: "已回滚",
  SUPERSEDED: "已取代",
};

export function ReleasePane(props: ReleasePaneProps) {
  const { conn, connected } = props;
  const [targets, setTargets] = useState<ReleaseTargetConfig[]>([]);
  const [releases, setReleases] = useState<ReleaseRecord[]>([]);
  const [targetId, setTargetId] = useState("");
  const [commitSha, setCommitSha] = useState(props.defaultCommitSha ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!connected) {
      setTargets([]);
      setReleases([]);
      return;
    }
    try {
      const res = await fetchReleases(conn);
      setTargets(res.targets);
      setReleases(
        [...res.releases].sort((a, b) =>
          b.created_at.localeCompare(a.created_at),
        ),
      );
      setError(null);
      if (!targetId && res.targets[0]) {
        setTargetId(res.targets[0].target_id);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [conn, connected, targetId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (props.defaultCommitSha) setCommitSha(props.defaultCommitSha);
  }, [props.defaultCommitSha]);

  const publish = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { release: draft } = await createReleaseDraft(conn, {
        target_id: targetId,
        commit_sha: commitSha.trim(),
      });
      setMessage(`草稿 ${draft.release_id} 已创建，开始发布…`);
      const { release } = await runRelease(conn, draft.release_id);
      setMessage(
        `发布 ${release.release_id} → ${STATE_LABEL[release.state] ?? release.state}`,
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onRollback = async (id: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { release } = await rollbackRelease(conn, id);
      setMessage(
        `回滚发布 ${release.release_id} → ${STATE_LABEL[release.state] ?? release.state}`,
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const selected = targets.find((t) => t.target_id === targetId);
  const labelOf = (t: ReleaseTargetConfig) => t.label ?? t.target_id;

  return (
    <div
      data-testid="release-pane"
      className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-4 text-sm"
    >
      <header>
        <h2 className="text-base font-semibold">发布</h2>
        <p className="mt-1 text-muted-foreground">
          把已合并的提交构建、部署并探活。失败会尽量回到上一个能用的版本。密钥请到设置里保存，这里不会显示。
        </p>
      </header>

      <section
        data-testid="release-compose"
        className="space-y-2 rounded border border-border p-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted-foreground">目标</label>
          <select
            data-testid="release-target"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            disabled={!connected || busy || targets.length === 0}
            className="rounded border border-border bg-background px-2 py-1"
          >
            {targets.length === 0 ? (
              <option value="">（还没有目标，请写 .stagent/release-targets.json）</option>
            ) : (
              targets.map((t) => (
                <option key={t.target_id} value={t.target_id}>
                  {labelOf(t)}
                </option>
              ))
            )}
          </select>
          <label className="text-xs text-muted-foreground">提交</label>
          <input
            data-testid="release-commit-sha"
            value={commitSha}
            onChange={(e) => setCommitSha(e.target.value)}
            placeholder="保护分支上的 commit SHA"
            className="w-64 rounded border border-border bg-background px-2 py-1 font-mono text-xs"
            disabled={busy}
          />
          <button
            type="button"
            data-testid="release-publish"
            disabled={
              busy ||
              !connected ||
              !targetId ||
              commitSha.trim().length < 7
            }
            onClick={() => void publish()}
            className="rounded bg-primary px-3 py-1 text-primary-foreground disabled:opacity-40"
          >
            {busy
              ? "发布中…"
              : selected
                ? `发到「${labelOf(selected)}」`
                : "发布"}
          </button>
        </div>
        {message ? (
          <p data-testid="release-message" className="text-xs text-foreground">
            {message}
          </p>
        ) : null}
        {error ? (
          <p data-testid="release-error" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </section>

      <section data-testid="release-list" className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          最近发布
        </h3>
        {releases.length === 0 ? (
          <p className="text-muted-foreground">还没有发布记录。</p>
        ) : (
          <ul className="space-y-2">
            {releases.map((r) => (
              <li
                key={r.release_id}
                data-testid={`release-card-${r.release_id}`}
                data-state={r.state}
                className="rounded border border-border px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-mono text-xs">{r.release_id}</div>
                    <div className="text-xs text-muted-foreground">
                      {STATE_LABEL[r.state] ?? r.state} · {r.target_id} ·{" "}
                      <span className="font-mono">
                        {r.commit_sha.slice(0, 8)}
                      </span>
                      {r.contract_ids.length > 0
                        ? ` · ${r.contract_ids.length} 份改动`
                        : ""}
                    </div>
                  </div>
                  {(r.state === "LIVE" || r.state === "FAILED") &&
                  r.previous_live_release_id ? (
                    <button
                      type="button"
                      data-testid={`release-rollback-${r.release_id}`}
                      disabled={busy || !connected}
                      onClick={() => void onRollback(r.release_id)}
                      className="rounded border border-border px-2 py-0.5 text-xs disabled:opacity-40"
                    >
                      回滚到上一版
                    </button>
                  ) : null}
                </div>
                {r.incident ? (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    {r.incident}
                  </p>
                ) : null}
                {r.steps.length > 0 ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      步骤日志（已脱敏）
                    </summary>
                    <ul className="mt-1 space-y-1 font-mono text-[11px]">
                      {r.steps.map((s, i) => (
                        <li key={`${s.step}-${i}`}>
                          {s.step} exit={s.exit_code ?? "—"}{" "}
                          <span className="text-muted-foreground">
                            {s.log_tail.slice(0, 200)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
