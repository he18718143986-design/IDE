import { useState } from "react";

/**
 * Studio 视口 3：质疑自查质询台（TASK-C.2 / TASK-S.5）。
 *
 * 输入质疑 → 调用上层 `onSubmit`（对接 POST /api/supervisor/dispute）→
 * 呈现三方比对摘要与下一步动作。本组件不直接打 HTTP，便于单测与外壳保活。
 */

export type DisputeClassificationView =
  "IMPLEMENTATION_BUG" | "REQUIREMENT_DRIFT" | "UNATTRIBUTED";

export type DisputeSealStatusView =
  "SEALED" | "NOT_SEALED" | "NO_BINDING" | "SNAPSHOT_MISSING" | "TAMPERED";

/** 左栏原话的封存事实（P-201），取自合同绑定的确认快照 */
export interface DisputeSealView {
  status: DisputeSealStatusView;
  bound_snapshot: boolean;
  confirmed_at: string | null;
  frozen_quotes_count: number | null;
  quotes: Array<{ turn_id: string; text: string; turn_text_sha256: string }>;
}

const SEAL_MISSING_VIEW: DisputeSealView = {
  status: "NOT_SEALED",
  bound_snapshot: false,
  confirmed_at: null,
  frozen_quotes_count: null,
  quotes: [],
};

function formatConfirmedAt(iso: string | null): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getMonth() + 1}月${at.getDate()}日 ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** 左栏状态行：只陈述快照事实（是否找到确认记录、封存了几句），不做聊天计数 */
function confirmationFactLine(seal: DisputeSealView): string {
  const at = formatConfirmedAt(seal.confirmed_at);
  const when = at ? `你在 ${at} 确认了这份方案` : "你确认了这份方案";
  switch (seal.status) {
    case "SEALED": {
      const total = seal.frozen_quotes_count ?? seal.quotes.length;
      const listed =
        total > seal.quotes.length
          ? `（下面列出最相关的 ${seal.quotes.length} 句）`
          : "";
      return `${when}，系统封存了你当时说的 ${total} 句话${listed}`;
    }
    case "NOT_SEALED":
      return seal.bound_snapshot
        ? `${when}，但系统没有封存你当时说的话`
        : "没有找到这份合同绑定的确认记录，系统没有封存你当时说的话";
    case "TAMPERED":
      return "这份合同的确认记录校验没有通过，原话不予展示";
    default:
      return "没有找到这份合同绑定的确认记录，系统没有封存你当时说的话";
  }
}

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
      /** P-201 起左栏不再渲染（只作归因信号） */
      matched_quotes?: string[] | undefined;
      /** P-201 起「确认 N 次」改取快照事实，不再渲染 */
      confirmations?: number | undefined;
      /** 缺省按未封存渲染 */
      seal?: DisputeSealView | undefined;
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
  /** 用户在降级场景下点选「这是 Bug，免费修」 */
  onChooseBugFix?: (() => void) | undefined;
  /** 用户在降级场景下点选「我想要新功能，下一轮做」 */
  onChooseRequirementChange?: (() => void) | undefined;
}

const CLASSIFICATION_LABEL: Record<DisputeClassificationView, string> = {
  IMPLEMENTATION_BUG: "方案里写了这一条，是施工漏了",
  REQUIREMENT_DRIFT: "这一条方案里没提到",
  UNATTRIBUTED: "我不确定是谁的问题",
};

const ACTION_LABEL = {
  REWORK: "我安排在原范围内返工，不另算。",
  REQUIREMENT_CHANGE: "这一条可以放到下一轮做。",
  MANUAL_ARBITRATION: "请你选一个，我照你的选择来。",
} as const;

export function DisputeConsolePane(props: DisputeConsolePaneProps) {
  const [challenge, setChallenge] = useState("");
  const canSubmit =
    props.contractId != null &&
    props.contractId.length > 0 &&
    challenge.trim().length >= 4 &&
    props.busy !== true;

  const report = props.report ?? null;
  const seal = report?.facts.prompt.seal ?? SEAL_MISSING_VIEW;
  const sealed = seal.status === "SEALED";

  return (
    <div
      data-testid="dispute-console-pane"
      className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-3 text-sm"
    >
      <div>
        <h3 className="text-xs font-semibold text-foreground">质疑自查</h3>
        <p className="mt-1 text-[11px] text-muted-foreground">
          说出哪里不对劲。系统会对照「你当时说的 / 方案里记的 /
          代码实际做的」给出一份白话报告，不会擅自改代码。
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
          data-seal-status={seal.status}
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
            {report.degraded && sealed && (
              <span
                data-testid="dispute-degraded-badge"
                className="rounded border border-amber-500/50 px-2 py-0.5 text-[11px] text-amber-800"
              >
                已降级呈递事实
              </span>
            )}
            {!sealed && (
              <span
                data-testid="dispute-seal-badge"
                className="rounded border border-destructive/40 px-2 py-0.5 text-[11px] text-destructive"
              >
                {seal.status === "TAMPERED"
                  ? "确认记录校验没有通过"
                  : "系统没有封存原话"}
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
            <SealedQuotesBlock seal={seal} />
            <FactBlock
              testId="dispute-fact-spec"
              title="确认的方案里记的"
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
              title="代码实际做的"
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

/**
 * 左栏「你当时说的」：逐字展示确认时封存的原话，每行带封存哈希供逐句核对；
 * 没有封存段时明说是系统记录缺失，不拿聊天记录或方案正文顶替。
 */
function SealedQuotesBlock(props: { seal: DisputeSealView }) {
  const { seal } = props;
  return (
    <div
      data-testid="dispute-fact-prompt"
      className="rounded border border-border/70 p-2"
    >
      <div className="mb-1 text-[11px] font-semibold text-foreground">
        你当时说的
      </div>
      <p
        data-testid="dispute-confirmation-fact"
        className="mb-1 text-[11px] text-muted-foreground"
      >
        {confirmationFactLine(seal)}
      </p>
      {seal.status === "SEALED" ? (
        <ul className="space-y-0.5 text-[11px] text-muted-foreground">
          {seal.quotes.map((quote) => (
            <li
              key={quote.turn_id}
              data-testid="dispute-sealed-quote"
              data-turn-id={quote.turn_id}
              data-turn-text-sha256={quote.turn_text_sha256}
              className="break-words"
            >
              · 你当时说：「
              <span data-testid="dispute-sealed-quote-text">{quote.text}</span>
              」
            </li>
          ))}
        </ul>
      ) : (
        <p
          data-testid="dispute-seal-missing"
          className="text-[11px] text-muted-foreground"
        >
          {seal.status === "TAMPERED"
            ? "确认记录校验没有通过，系统不展示原话"
            : "系统没有封存你确认方案时的原话（这是系统记录缺失，不代表你没说过）"}
        </p>
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
