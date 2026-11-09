import { useState } from "react";

/**
 * Studio 视口 3：质疑自查质询台（TASK-C.2 / TASK-S.5）。
 *
 * 输入质疑 → 调用上层 `onSubmit`（对接 POST /api/supervisor/dispute）→
 * 呈现三方比对摘要与下一步动作。本组件不直接打 HTTP，便于单测与外壳保活。
 */

export type DisputeClassificationView =
  "IMPLEMENTATION_BUG" | "REQUIREMENT_DRIFT" | "UNATTRIBUTED";

export interface DisputeReportView {
  report_id: string;
  contract_id: string;
  challenge: string;
  classification: DisputeClassificationView;
  suggested_classification?: DisputeClassificationView | undefined;
  confidence: number;
  degraded: boolean;
  plain_summary: string;
  rationale?: string[] | undefined;
  facts: {
    prompt: {
      original_request: string | null;
      matched_quotes: string[];
      confirmations: number;
    };
    spec: {
      matched_entries: string[];
      version?: number | undefined;
    } | null;
    code: {
      worktree_available: boolean;
      changed_files: string[];
      evidence_id: string | null;
    };
  };
  next_action?:
    | {
        kind: "REWORK" | "REQUIREMENT_CHANGE" | "MANUAL_ARBITRATION";
        message?: string | undefined;
      }
    | undefined;
}

export interface DisputeConsolePaneProps {
  contractId?: string | null | undefined;
  report?: DisputeReportView | null | undefined;
  busy?: boolean | undefined;
  error?: string | null | undefined;
  onSubmit?: ((challenge: string) => void | Promise<void>) | undefined;
  /** 用户在降级场景下点选「按缺陷修复」 */
  onChooseBugFix?: (() => void) | undefined;
  /** 用户在降级场景下点选「按新需求演进」 */
  onChooseRequirementChange?: (() => void) | undefined;
}

const CLASSIFICATION_LABEL: Record<DisputeClassificationView, string> = {
  IMPLEMENTATION_BUG: "更像是实现缺陷",
  REQUIREMENT_DRIFT: "更像是需求有偏差",
  UNATTRIBUTED: "暂时分不清，需要你拍板",
};

const ACTION_LABEL = {
  REWORK: "建议在原范围内返工修复",
  REQUIREMENT_CHANGE: "建议开新需求演进",
  MANUAL_ARBITRATION: "请你手动裁决",
} as const;

export function DisputeConsolePane(props: DisputeConsolePaneProps) {
  const [challenge, setChallenge] = useState("");
  const canSubmit =
    props.contractId != null &&
    props.contractId.length > 0 &&
    challenge.trim().length >= 4 &&
    props.busy !== true;

  const report = props.report ?? null;

  return (
    <div
      data-testid="dispute-console-pane"
      className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-3 text-sm"
    >
      <div>
        <h3 className="text-xs font-semibold text-foreground">质疑自查</h3>
        <p className="mt-1 text-[11px] text-muted-foreground">
          说出哪里不对劲。系统会对照「你怎么说的 / 需求怎么写的 /
          代码实际改了什么」给出一份白话报告，不会擅自改代码。
        </p>
      </div>

      <label className="block space-y-1">
        <span className="text-[11px] text-muted-foreground">你的质疑</span>
        <textarea
          data-testid="dispute-challenge-input"
          value={challenge}
          disabled={props.busy === true || !props.contractId}
          onChange={(event) => setChallenge(event.target.value)}
          rows={4}
          maxLength={2000}
          placeholder={
            props.contractId
              ? "例如：登录页没有记住我的勾选，和我们说好的不一样"
              : "请先选中一份合同，再提出质疑"
          }
          className="w-full resize-y rounded border border-border bg-background px-2 py-1.5 text-xs disabled:opacity-50"
        />
      </label>

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="dispute-submit"
          disabled={!canSubmit}
          onClick={() => {
            const text = challenge.trim();
            if (text.length < 4) return;
            void props.onSubmit?.(text);
          }}
          className="rounded border border-border px-3 py-1 text-xs font-medium disabled:opacity-40"
        >
          {props.busy === true ? "正在自查…" : "开始自查"}
        </button>
        <span
          data-testid="dispute-challenge-count"
          className="text-[11px] text-muted-foreground"
        >
          {challenge.trim().length}/2000（至少 4 字）
        </span>
      </div>

      {props.error && (
        <div
          data-testid="dispute-error"
          role="alert"
          className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
        >
          {props.error}
        </div>
      )}

      {report && (
        <section
          data-testid="dispute-report-card"
          data-classification={report.classification}
          data-degraded={report.degraded ? "true" : "false"}
          className="space-y-2 rounded border border-border p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold">自查报告</span>
            <span
              data-testid="dispute-classification"
              className="rounded bg-muted px-2 py-0.5 text-[11px]"
            >
              {CLASSIFICATION_LABEL[report.classification]}
            </span>
            {report.degraded && (
              <span
                data-testid="dispute-degraded-badge"
                className="rounded border border-amber-500/50 px-2 py-0.5 text-[11px] text-amber-800"
              >
                已降级呈递事实
              </span>
            )}
          </div>

          <p
            data-testid="dispute-summary"
            className="text-xs leading-relaxed text-foreground"
          >
            {report.plain_summary}
          </p>

          <div className="grid gap-2 md:grid-cols-3">
            <FactBlock
              testId="dispute-fact-prompt"
              title="你怎么说的"
              lines={[
                report.facts.prompt.original_request
                  ? `原始需求：${report.facts.prompt.original_request}`
                  : "没有找到会话里的原始需求",
                ...(report.facts.prompt.matched_quotes.length > 0
                  ? report.facts.prompt.matched_quotes.map(
                      (quote) => `你当时说：「${quote}」`,
                    )
                  : ["没有找到与这次确认的方案对应的你的原话记录"]),
                `确认 ${report.facts.prompt.confirmations} 次`,
              ]}
            />
            <FactBlock
              testId="dispute-fact-spec"
              title="需求怎么写的"
              lines={
                report.facts.spec
                  ? report.facts.spec.matched_entries.length > 0
                    ? report.facts.spec.matched_entries
                    : ["规范里没有直接命中的条目"]
                  : ["还没有冻结的需求快照"]
              }
            />
            <FactBlock
              testId="dispute-fact-code"
              title="代码实际改了什么"
              lines={
                report.facts.code.worktree_available
                  ? report.facts.code.changed_files.length > 0
                    ? report.facts.code.changed_files
                    : ["工作树里没有检测到改动文件"]
                  : ["当前没有可用的工作树"]
              }
            />
          </div>

          {report.next_action && (
            <div
              data-testid="dispute-next-action"
              data-kind={report.next_action.kind}
              className="rounded bg-muted/60 px-2 py-1.5 text-[11px] text-muted-foreground"
            >
              {ACTION_LABEL[report.next_action.kind]}
              {report.next_action.message
                ? ` —— ${report.next_action.message}`
                : ""}
            </div>
          )}

          {(report.degraded || report.classification === "UNATTRIBUTED") && (
            <div
              data-testid="dispute-arbitration"
              className="flex flex-wrap gap-2"
            >
              <button
                type="button"
                data-testid="dispute-choose-bugfix"
                onClick={() => {
                  props.onChooseBugFix?.();
                }}
                className="rounded border border-border px-2 py-1 text-xs"
              >
                这是 Bug，免费修
              </button>
              <button
                type="button"
                data-testid="dispute-choose-requirement"
                onClick={() => {
                  props.onChooseRequirementChange?.();
                }}
                className="rounded border border-border px-2 py-1 text-xs"
              >
                我想要新功能，下一轮做
              </button>
            </div>
          )}
        </section>
      )}

      {!report && !props.error && (
        <div
          data-testid="dispute-empty"
          className="text-xs text-muted-foreground"
        >
          还没有自查报告。写完质疑后点「开始自查」。
        </div>
      )}
    </div>
  );
}

function FactBlock(props: { title: string; lines: string[]; testId: string }) {
  return (
    <div
      data-testid={props.testId}
      className="rounded border border-border/70 p-2"
    >
      <div className="mb-1 text-[11px] font-semibold text-foreground">
        {props.title}
      </div>
      <ul className="space-y-0.5 text-[11px] text-muted-foreground">
        {props.lines.map((line, index) => (
          <li key={`${index}-${line.slice(0, 24)}`} className="break-words">
            · {line}
          </li>
        ))}
      </ul>
    </div>
  );
}
