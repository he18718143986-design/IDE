/**
 * TASK-L.16：画布「线上」卡 —— 目标停了 + 「让 AI 看看」。
 * 不宣称端到端运维闭环；不改 MERGED 合同。
 */
import { useState } from "react";
import type { DaemonConnection } from "@/lib/daemon-api";
import { askAiForReleaseIncident } from "@/lib/daemon-api";
import type { LiveIncidentPayload } from "@/lib/release/release";

export interface LiveIncidentCardProps {
  conn: DaemonConnection;
  connected: boolean;
  incident: LiveIncidentPayload;
  /** 插桩成功后回调（刷新计划 / 发布列表） */
  onStubCreated?: (info: { stub_id: string; release_id: string }) => void;
}

function summarizeTail(tail: string): string {
  const oneLine = tail.replace(/\s+/g, " ").trim();
  if (oneLine.length <= 160) return oneLine || "（没有捕获到错误输出）";
  return `${oneLine.slice(0, 160)}…`;
}

export function LiveIncidentCard(props: LiveIncidentCardProps) {
  const { conn, connected, incident, onStubCreated } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneStub, setDoneStub] = useState<string | null>(
    incident.stub_created ? (incident.stub_id ?? "已生成") : null,
  );

  const askAi = async () => {
    if (doneStub) return;
    setBusy(true);
    setError(null);
    try {
      const res = await askAiForReleaseIncident(conn, incident.release_id);
      setDoneStub(res.stub_id);
      onStubCreated?.({
        stub_id: res.stub_id,
        release_id: incident.release_id,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid={`live-incident-card-${incident.release_id}`}
      data-release-id={incident.release_id}
      className="rounded border border-amber-500/60 bg-amber-50/80 px-3 py-2 text-sm dark:bg-amber-950/30"
    >
      <div className="font-medium text-amber-900 dark:text-amber-200">
        线上 · 「{incident.target_label}」停了
      </div>
      <p className="mt-1 text-xs text-amber-900/90 dark:text-amber-100/90">
        最后的错误是：{summarizeTail(incident.log_tail)}
      </p>
      <div className="mt-1 font-mono text-[11px] text-muted-foreground">
        {incident.release_id} · {incident.commit_sha.slice(0, 8)}
        {incident.exit_code != null ? ` · exit ${incident.exit_code}` : ""}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid={`live-incident-ask-ai-${incident.release_id}`}
          disabled={!connected || busy || Boolean(doneStub)}
          onClick={() => void askAi()}
          className="rounded bg-amber-700 px-3 py-1 text-xs text-white disabled:opacity-40 dark:bg-amber-600"
        >
          {doneStub ? "已生成修复合同" : busy ? "生成中…" : "让 AI 看看"}
        </button>
        {doneStub ? (
          <span
            data-testid={`live-incident-stub-${incident.release_id}`}
            className="text-xs text-muted-foreground"
          >
            桩 {doneStub}
          </span>
        ) : null}
      </div>
      {error ? (
        <p
          data-testid={`live-incident-error-${incident.release_id}`}
          className="mt-1 text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
