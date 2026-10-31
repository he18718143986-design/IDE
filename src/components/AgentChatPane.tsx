import { useEffect, useRef, useState } from "react";
import {
  useAgentSession,
  type AgentSessionTransport,
  type UseAgentSession,
} from "@/hooks/use-agent-session";
import {
  hasRealAssistantAvailable,
  pickPreferredAdapterId,
} from "@/lib/pick-chat-adapter";
import {
  resolveAssistantMode,
  type AssistantModeSurface,
} from "@/lib/assistant-mode";
import { relaunchCurrentSession } from "@/lib/daemon-api";
import { ClarificationChoiceCard } from "@/components/supervisor/ClarificationChoiceCard";
import type { ClarificationQuestion } from "@/lib/journey/clarification";
import { traceCtaClick, traceCtaDisabled } from "@/lib/ui-trace";

export interface JourneyChatCard {
  id: string;
  /** DISPUTE / FAST_PATH / MAJOR_DRAFT / SYSTEM */
  kind: string;
  text: string;
}

export interface AgentChatPaneProps {
  transport: AgentSessionTransport | null;
  /**
   * C.10l：父级注入的共享会话（与设置「高级」同实例）。
   * 未传时组件自管（UI 单测仍可只传 transport）。
   */
  session?: UseAgentSession | undefined;
  /**
   * TASK-S.6：发送前分流。返回 `handled` 则不再发给 Worker；
   * 返回 `passthrough`（或未提供）则走原会话。
   */
  onBeforeSend?:
    ((text: string) => Promise<"handled" | "passthrough">) | undefined;
  /** 旅程系统卡（质疑白话摘要 / Fast Path 说明 / 草案就绪） */
  journeyCards?: JourneyChatCard[] | undefined;
  journeyBusy?: boolean | undefined;
  /**
   * TASK-C.11a：白话推荐选择题（右栏可点选；算对话内容，不破坏 C.10k 主视线）。
   */
  clarificationQuestions?: ClarificationQuestion[] | undefined;
  clarificationRoundIndex?: number | undefined;
  clarificationSelections?: Record<string, string> | undefined;
  clarificationDisabled?: boolean | undefined;
  onClarificationSelect?:
    ((questionId: string, optionId: string) => void) | undefined;
  /**
   * TASK-C.8a：打开设置里的「模型钥匙」向导（由布局切到设置 Tab）。
   * 未配 Key 时右栏给一键入口，不甩工程师后台话术。
   */
  onConfigureKey?: (() => void) | undefined;
  /** 模型钥匙是否已就绪（用于向导状态文案） */
  keyConfigured?: boolean | undefined;
  /**
   * TASK-C.9a：指挥面相位。用于给唯一主 CTA 打 data-primary-cta。
   * 不传则按本地状态推断（无 transport / 缺钥匙 / 空闲）。
   */
  commandPhase?: "no_key" | "idle" | "in_progress" | undefined;
  /** 与指挥面一致的主 CTA test id */
  primaryCtaTestId?: string | undefined;
  /** J.7：交接瞬态锁定右侧输入；COMMIT 成功后由调用方解锁（D9）。 */
  locked?: boolean | undefined;
  /** 锁定原因（白话） */
  lockedReason?: string | undefined;
  /**
   * TASK-C.9b：模式变化时通知父级（中栏提示与右栏一致）。
   * 不含设置深链回跳（归 C.9d）。
   */
  onAssistantModeChange?: ((surface: AssistantModeSurface) => void) | undefined;
}

/**
 * TASK-C.6 右栏 Coding Agent 会话；TASK-C.10k：老板主视线只留双方对话，
 * 去掉适配器/历史会话/会话元信息/工具 JSON 等工程师噪声。
 */
export function AgentChatPane({
  transport,
  session: injectedSession,
  onBeforeSend,
  journeyCards,
  journeyBusy,
  clarificationQuestions,
  clarificationRoundIndex = 0,
  clarificationSelections,
  clarificationDisabled,
  onClarificationSelect,
  onConfigureKey,
  keyConfigured,
  commandPhase,
  primaryCtaTestId,
  locked,
  lockedReason,
  onAssistantModeChange,
}: AgentChatPaneProps) {
  // C.10l：有注入则复用父级实例；否则自管（测试路径）
  const owned = useAgentSession(injectedSession ? null : transport);
  const chat = injectedSession ?? owned;
  const [draft, setDraft] = useState("");
  const [routing, setRouting] = useState(false);
  const [relaunchBusy, setRelaunchBusy] = useState(false);
  const [relaunchError, setRelaunchError] = useState<string | null>(null);
  const ensuringSessionRef = useRef(false);
  const [sessionReady, setSessionReady] = useState(false);
  const current = chat.sessions.find((s) => s.id === chat.sessionId);
  const currentAdapterAvailable = chat.adapters.some(
    (a) => a.id === current?.adapter_id && a.available,
  );
  const adapterChoice = pickPreferredAdapterId(
    chat.adapters,
    currentAdapterAvailable ? (current?.adapter_id ?? null) : null,
  );
  const realReady = hasRealAssistantAvailable(chat.adapters);
  const assistant = resolveAssistantMode({
    keyReady: keyConfigured === true,
    hasRealAssistant: realReady,
    activeAdapterId: current?.adapter_id ?? null,
  });
  useEffect(() => {
    onAssistantModeChange?.(assistant);
    // 只在模式/文案变化时同步中栏；assistant 对象每渲新建，故按字段订阅
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 见上
  }, [
    assistant.mode,
    assistant.middleHint,
    assistant.canSendAsWork,
    onAssistantModeChange,
  ]);

  // C.10k：无工程师「新会话」按钮时，自动用首选助手开会话，老板只说话。
  const newSession = chat.newSession;
  useEffect(() => {
    if (chat.sessionId) {
      setSessionReady(true);
      return;
    }
    setSessionReady(false);
    if (!transport) return;
    if (!adapterChoice) return;
    if (assistant.mode === "wizard") return;
    if (ensuringSessionRef.current) return;
    ensuringSessionRef.current = true;
    void newSession(adapterChoice).finally(() => {
      ensuringSessionRef.current = false;
    });
  }, [transport, chat.sessionId, adapterChoice, assistant.mode, newSession]);

  if (!transport) {
    const doRelaunch = () => {
      setRelaunchBusy(true);
      setRelaunchError(null);
      void relaunchCurrentSession()
        .then((result) => {
          window.location.assign(result.launchUrl);
        })
        .catch((err) => {
          setRelaunchError(
            (err as Error).message ||
              "一键重开失败。可点左栏「打开项目」，或到设置粘贴钥匙。",
          );
          setRelaunchBusy(false);
        });
    };
    return (
      <div
        data-testid="agent-chat"
        role="status"
        className="m-3 rounded border border-amber-500/60 bg-amber-500/10 p-3 text-sm leading-relaxed"
      >
        <p className="font-semibold">还没连上工作台，暂时不能和助手对话。</p>
        <p className="mt-2">
          多半是这个标签页没带上访问钥匙。先点下面一键重开——不必去终端，也不必手拷
          Token。
        </p>
        <button
          type="button"
          data-testid="chat-relaunch-with-token"
          data-primary-cta={
            !primaryCtaTestId || primaryCtaTestId === "chat-relaunch-with-token"
              ? "true"
              : undefined
          }
          disabled={relaunchBusy}
          onClick={doRelaunch}
          className="mt-3 w-full rounded border border-amber-700/50 bg-background px-3 py-2 text-left font-medium hover:bg-accent disabled:opacity-50"
        >
          {relaunchBusy ? "正在重开…" : "一键重开（带钥匙）"}
        </button>
        {relaunchError ? (
          <p
            role="alert"
            data-testid="chat-relaunch-error"
            className="mt-2 text-destructive"
          >
            {relaunchError}
          </p>
        ) : null}
        <p className="mt-3 text-xs opacity-70">
          若按钮失败：再到左栏「打开项目」备用入口，或左下角 ⚙️ 设置粘贴钥匙。
        </p>
      </div>
    );
  }

  const submit = () => {
    if (locked === true) {
      traceCtaDisabled("journey-send", "scheme_confirmation_locked");
      return;
    }
    // C.9b：向导态不得假装流式干活——点发送只导向配置
    if (assistant.mode === "wizard") {
      onConfigureKey?.();
      return;
    }
    const text = draft.trim();
    if (!text) return;
    if (routing || journeyBusy) {
      traceCtaDisabled(
        "journey-send",
        journeyBusy ? "journey_busy" : "routing",
      );
      return;
    }
    if (!assistant.canSendAsWork) {
      traceCtaDisabled("journey-send", "assistant_cannot_send");
      return;
    }
    traceCtaClick("chat-submit");
    setDraft("");
    if (onBeforeSend) {
      setRouting(true);
      void onBeforeSend(text)
        .then((decision) => {
          if (decision === "passthrough") {
            void chat.send(text);
          }
        })
        .finally(() => setRouting(false));
      return;
    }
    void chat.send(text);
  };

  const sendDisabled =
    locked === true ||
    routing ||
    journeyBusy === true ||
    (!sessionReady && !chat.sessionId) ||
    !assistant.canSendAsWork ||
    (!onBeforeSend && !chat.sessionId);

  const showJourneyActive =
    commandPhase === "in_progress" ||
    primaryCtaTestId === "journey-active" ||
    journeyBusy === true;

  const dialogueMessages = chat.messages.filter((m) => m.role !== "tool");

  return (
    <div
      data-testid="agent-chat"
      data-command-phase={commandPhase ?? (transport ? "idle" : "no_key")}
      data-assistant-mode={assistant.mode}
      className="flex h-full flex-col gap-2 text-xs"
    >
      {locked === true ? (
        <div
          data-testid="agent-chat-locked"
          className="rounded border border-emerald-700/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-950"
        >
          {lockedReason ?? "方案已进入确认/施工，右栏本轮已锁定。"}
        </div>
      ) : null}
      {showJourneyActive ? (
        <div
          data-testid="journey-active"
          data-primary-cta={
            primaryCtaTestId === "journey-active" ? "true" : undefined
          }
          className="rounded border border-sky-600/40 bg-sky-500/10 px-2 py-1 text-[11px] font-medium text-sky-950"
        >
          进行中：请看对话、中间确认或三步台
        </div>
      ) : null}
      {/* C.10k：主 CTA 锚点保留（指挥面），视觉不再占一整条说明书 */}
      <span
        data-testid="journey-entry-hint"
        data-primary-cta={
          primaryCtaTestId === "journey-entry-hint" ||
          (commandPhase === "idle" && !primaryCtaTestId)
            ? "true"
            : undefined
        }
        data-command-role={
          commandPhase === "idle" || !commandPhase ? "primary" : "secondary"
        }
        className="sr-only"
      >
        在下方输入框说出你的需求
      </span>
      {assistant.mode === "wizard" && (
        <div
          data-testid="key-need-wizard"
          data-assistant-mode="wizard"
          className="rounded border border-sky-600/40 bg-sky-500/10 px-2 py-1.5 text-[11px] leading-relaxed"
        >
          <p className="font-semibold text-sky-950">
            {keyConfigured
              ? "钥匙已就绪：直接在下方说话即可。"
              : "还差一步：配好模型钥匙，真助手就能干活。"}
          </p>
          {!keyConfigured && (
            <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-sky-950/90">
              <li>点下方按钮打开设置里的「模型钥匙」</li>
              <li>粘贴钥匙并保存（不会显示在聊天里）</li>
              <li>回到这里，在下方直接说话</li>
            </ol>
          )}
          {onConfigureKey && (
            <button
              type="button"
              data-testid="open-key-settings"
              data-primary-cta={
                primaryCtaTestId === "open-key-settings" ||
                (commandPhase === "no_key" &&
                  primaryCtaTestId !== "chat-relaunch-with-token")
                  ? "true"
                  : undefined
              }
              className="mt-1.5 rounded border border-sky-700/50 bg-background px-2 py-0.5 text-sky-900 hover:bg-sky-500/10"
              onClick={onConfigureKey}
            >
              {keyConfigured ? "打开设置核对钥匙" : "去配置模型钥匙"}
            </button>
          )}
        </div>
      )}
      {assistant.mode === "practice" ? (
        <div
          data-testid="assistant-practice-banner"
          data-assistant-mode="practice"
          className="rounded border border-border/70 bg-muted/40 px-2 py-1 text-[11px] leading-relaxed text-muted-foreground"
        >
          当前是练习沙箱（不可当真）。
          {realReady ? (
            <> 真助手已就绪，新开的对话会自动用真助手。</>
          ) : onConfigureKey ? (
            <>
              {" "}
              要真干活请先
              <button
                type="button"
                data-testid="practice-to-configure"
                className="mx-1 underline"
                onClick={onConfigureKey}
              >
                配置模型钥匙
              </button>
              。
            </>
          ) : (
            " 要真干活请先配置模型钥匙。"
          )}
        </div>
      ) : null}
      <div
        data-testid="chat-messages"
        className="min-h-0 flex-1 space-y-2 overflow-auto"
      >
        {dialogueMessages.map((m) => (
          <div
            key={m.id}
            data-role={m.role}
            className={
              m.role === "user"
                ? "ml-6 rounded bg-primary/10 p-2"
                : m.role === "system"
                  ? "text-center text-[10px] opacity-60"
                  : "whitespace-pre-wrap p-1"
            }
          >
            {m.text}
          </div>
        ))}
        {(journeyCards ?? []).map((card) => (
          <div
            key={card.id}
            data-testid="journey-card"
            data-journey-kind={card.kind}
            className="rounded border border-sky-600/40 bg-sky-500/10 p-2 text-[11px] leading-relaxed"
          >
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-sky-900/80">
              {card.kind === "DISPUTE"
                ? "质疑自查"
                : card.kind === "FAST_PATH"
                  ? "小事快通道"
                  : card.kind === "MAJOR_DRAFT"
                    ? "需求草案"
                    : "系统"}
            </div>
            <div className="whitespace-pre-wrap">{card.text}</div>
          </div>
        ))}
        {(clarificationQuestions ?? []).map((q) => (
          <ClarificationChoiceCard
            key={q.id}
            question={q}
            roundIndex={clarificationRoundIndex}
            selectedOptionId={clarificationSelections?.[q.id] ?? null}
            disabled={clarificationDisabled === true}
            onSelect={(questionId, optionId) =>
              onClarificationSelect?.(questionId, optionId)
            }
          />
        ))}
      </div>
      {chat.error && <div className="text-destructive">{chat.error}</div>}
      <div className="flex gap-1">
        <textarea
          aria-label="给 Agent 的消息"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            locked === true
              ? (lockedReason ?? "正在交接，几秒后可以继续聊")
              : assistant.mode === "wizard"
                ? "先配置模型钥匙，再回来说话（不会假装发送）"
                : assistant.mode === "practice"
                  ? "练习沙箱：可试界面，不会改项目"
                  : routing || journeyBusy
                    ? "正在分流处理…"
                    : chat.busy
                      ? "助手正在回答，可继续输入排队"
                      : "说出你的需求：质疑、新功能或小改…"
          }
          disabled={sendDisabled}
          className="min-h-[48px] flex-1 rounded border p-1"
        />
        <div className="flex flex-col gap-1">
          <button
            type="button"
            data-testid="chat-send"
            data-assistant-mode={assistant.mode}
            data-can-send={assistant.canSendAsWork ? "true" : "false"}
            onClick={submit}
            disabled={sendDisabled}
            title={
              assistant.mode === "wizard"
                ? "还差钥匙：请点上方「去配置模型钥匙」"
                : assistant.mode === "practice"
                  ? "练习发送（不会改项目）"
                  : undefined
            }
            className="rounded border px-2"
          >
            {assistant.mode === "practice" ? "练习发送" : "发送"}
          </button>
          <button
            type="button"
            onClick={() => void chat.stop()}
            disabled={!chat.busy}
            className="rounded border border-destructive/50 px-2 text-destructive disabled:opacity-40"
          >
            停止
          </button>
        </div>
      </div>
    </div>
  );
}
