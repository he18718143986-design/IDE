/**
 * TASK-L.17c：中栏方案审阅同页 —— 对照试玩挂载 + 原话「认可完成」。
 *
 * - 复用既有 CompareView（不改组件本体 / props 契约）
 * - 提交只走 submitPlaytestEvidence（contract_id + user_verdict）
 * - 读侧走 GET /api/playtest/status（薄路由委托 evaluatePlaytestGuard）
 * - 原话框默认空：禁止把引导/说明文字自动填入；可选手点「引用」会话原话（原样写入，不改写）
 * - 不碰 orchestrator / 派工 / AdapterRegistry；不复活多视口 Tab / 右栏入口
 */
import { useCallback, useEffect, useState } from "react";
import {
  CompareView,
  type ReferenceSnapshotView,
} from "@/components/project/CompareView";
import type { DaemonConnection } from "@/lib/daemon-api";
import {
  fetchPlaytestStatus,
  submitPlaytestEvidence,
  type PlaytestStatusView,
} from "@/lib/journey/playtest-evidence";

export interface PlaytestAcceptBlockProps {
  contractId?: string | null | undefined;
  references?: readonly string[] | undefined;
  snapshots?: readonly ReferenceSnapshotView[] | undefined;
  previewUrl?: string | null | undefined;
  previewStatus?: "RUNNING" | "STOPPED" | "ERROR" | null | undefined;
  previewError?: string | null | undefined;
  /** 有值才可提交 / 拉状态；缺省时只展示对照区 */
  conn?: DaemonConnection | null | undefined;
  /**
   * 既有会话原话候选：用户手点「引用」才写入输入框（原样），
   * **绝不**自动填入；也不得把引导文案塞进此列表当默认值。
   */
  sessionVerbatimCandidates?: readonly string[] | undefined;
}

function gateBlocksSubmit(status: PlaytestStatusView | null): boolean {
  if (!status) return false;
  return (
    status.status === "NOT_NORTHSTAR_SCENARIO" ||
    status.status === "CONTRACT_NOT_FOUND"
  );
}

export function PlaytestAcceptBlock(props: PlaytestAcceptBlockProps) {
  const contractId = props.contractId?.trim() || "";
  const conn = props.conn ?? null;
  const [verbatim, setVerbatim] = useState("");
  const [status, setStatus] = useState<PlaytestStatusView | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitOk, setSubmitOk] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (!conn || !contractId) {
      setStatus(null);
      setStatusError(null);
      return;
    }
    try {
      const next = await fetchPlaytestStatus(conn, contractId);
      setStatus(next);
      setStatusError(null);
    } catch (err) {
      setStatus(null);
      setStatusError((err as Error).message);
    }
  }, [conn, contractId]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const trimmed = verbatim.trim();
  const blockedByGate = gateBlocksSubmit(status);
  const canSubmit =
    Boolean(conn) &&
    contractId.length > 0 &&
    trimmed.length > 0 &&
    !submitBusy &&
    !blockedByGate;

  const handleSubmit = async () => {
    if (!conn || !contractId) return;
    if (trimmed.length === 0) {
      setSubmitError("请填写你的试玩认可原话（不能为空）");
      setSubmitOk(false);
      return;
    }
    setSubmitBusy(true);
    setSubmitError(null);
    setSubmitOk(false);
    try {
      // 原话原样提交（仅 trim 空白），不做摘要/改写
      await submitPlaytestEvidence(conn, {
        contract_id: contractId,
        user_verdict: trimmed,
      });
      setSubmitOk(true);
      await refreshStatus();
    } catch (err) {
      setSubmitError((err as Error).message);
      setSubmitOk(false);
      await refreshStatus();
    } finally {
      setSubmitBusy(false);
    }
  };

  const candidates =
    props.sessionVerbatimCandidates?.filter((c) => c.trim().length > 0) ?? [];

  return (
    <section
      data-testid="playtest-accept-block"
      className="mb-3 flex min-h-[280px] flex-col gap-3 rounded border border-border"
    >
      <div className="min-h-[220px] overflow-hidden rounded-t border-b border-border">
        <CompareView
          contractId={contractId || null}
          references={props.references}
          snapshots={props.snapshots}
          previewUrl={props.previewUrl}
          previewStatus={props.previewStatus}
          errorMessage={props.previewError}
        />
      </div>

      <div className="space-y-2 px-3 pb-3">
        <h3 className="text-xs font-semibold text-foreground">
          试玩认可（原话）
        </h3>
        <p className="text-[10px] text-muted-foreground">
          对照左栏参考站与右栏 LIVE
          后，用你自己的话写下认可（或点选下方会话原话引用）。说明/引导文字不会自动填入。
        </p>

        {candidates.length > 0 ? (
          <div
            data-testid="playtest-verbatim-candidates"
            className="flex flex-wrap gap-1.5"
          >
            {candidates.map((c, idx) => (
              <button
                key={`verbatim-cite-${idx}`}
                type="button"
                data-testid="playtest-verbatim-cite"
                onClick={() => {
                  // 原样引用，不改写/摘要
                  setVerbatim(c);
                  setSubmitOk(false);
                  setSubmitError(null);
                }}
                className="max-w-full truncate rounded border border-border px-2 py-0.5 text-[10px] hover:bg-accent"
                title={c}
              >
                引用：{c.length > 40 ? `${c.slice(0, 40)}…` : c}
              </button>
            ))}
          </div>
        ) : null}

        <textarea
          data-testid="playtest-verbatim-input"
          value={verbatim}
          onChange={(e) => {
            setVerbatim(e.target.value);
            setSubmitOk(false);
            setSubmitError(null);
          }}
          rows={3}
          placeholder="在此手输认可原话，例如：我对照参考站点了一遍，一模一样，认可完成"
          className="w-full resize-y rounded border border-border bg-background px-2 py-1.5 text-xs outline-none"
        />

        <div
          data-testid="playtest-guard-status"
          data-status={status?.status ?? (statusError ? "ERROR" : "IDLE")}
          data-ok={status ? (status.ok ? "true" : "false") : undefined}
          className="rounded border border-border bg-muted/30 px-2 py-1.5 text-[11px] leading-relaxed"
        >
          {statusError ? (
            <span className="text-destructive">
              门禁状态读取失败：{statusError}
            </span>
          ) : status ? (
            <span className={status.ok ? "text-emerald-800" : "text-amber-900"}>
              门禁 {status.status}
              {status.code ? ` · ${status.code}` : ""}：{status.message}
            </span>
          ) : contractId ? (
            <span className="text-muted-foreground">
              {conn ? "正在读取试玩门禁状态…" : "未连接工作台，暂无法读取门禁"}
            </span>
          ) : (
            <span className="text-muted-foreground">
              先选一份合同，再对照试玩并认可
            </span>
          )}
        </div>

        <button
          type="button"
          data-testid="playtest-accept-submit"
          disabled={!canSubmit}
          onClick={() => {
            void handleSubmit();
          }}
          className="rounded border border-emerald-800 bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
        >
          {submitBusy ? "提交中…" : "认可完成"}
        </button>

        {submitError ? (
          <p
            data-testid="playtest-accept-error"
            className="text-[11px] text-destructive"
          >
            {submitError}
          </p>
        ) : null}
        {submitOk ? (
          <p
            data-testid="playtest-accept-success"
            className="text-[11px] text-emerald-800"
          >
            认可证据已提交（经 submitPlaytestEvidence）
          </p>
        ) : null}
      </div>
    </section>
  );
}
