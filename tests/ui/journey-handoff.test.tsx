// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { SchemeReviewPane } from "../../src/components/studio/SchemeReviewPane";
import { AgentChatPane } from "../../src/components/AgentChatPane";
import type {
  AgentSessionTransport,
  UseAgentSession,
} from "../../src/hooks/use-agent-session";
import {
  EMPTY_DEMO_GATE,
  emptySchemeDraft,
  evaluateSchemeConfirmation,
  type DemoGate,
  type SchemeDraft,
} from "../../src/lib/journey/scheme-draft";
import {
  formatBudgetPlain,
  scopePlanDigest,
  type ScopePlan,
} from "../../src/lib/journey/scope-plan";
import {
  newSchemeConfirmationId,
  resetConfirmSchemeTransactionsForTest,
  runConfirmSchemeAtomic,
  type ConfirmSchemeStepId,
} from "../../src/lib/journey/confirm-scheme-atomic";
import {
  HANDOFF_COMPENSATION_FAILED_MESSAGE,
  HANDOFF_LOCK_HINT,
  HANDOFF_UI_STEPS,
  confirmStepToHandoffUi,
  formatHandoffStartedCard,
  partnerMessageMayRebuildScheme,
  type HandoffUiStepId,
} from "../../src/lib/journey/handoff-progress";
import * as schemeDraftMod from "../../src/lib/journey/scheme-draft";

/**
 * TASK-J.7 / SSOT §18 J-02：交接三步进度、右栏瞬态锁定、COMMIT 后解锁、
 * 中栏画布卡（DEC-005 右栏零系统消息）、失败分支。
 */

function makeScheme(partial: Partial<SchemeDraft> = {}): SchemeDraft {
  return emptySchemeDraft({
    title: "工程项目进度管控台",
    summary: "按项目维度汇总进度与预算，并对超期节点发出预警。",
    modules: ["工程进度管控", "财务数据与预算"],
    mermaidFlow: "flowchart LR\n  A[录入进度] --> B[汇总]",
    business_input_rounds: 1,
    scheme_revision: 2,
    ...partial,
  });
}

function compliantScopePlan(partial: Partial<ScopePlan> = {}): ScopePlan {
  const plan: ScopePlan = {
    scheme_revision: 2,
    plan_digest: "",
    areas: [
      {
        id: "area-0",
        label: "工程进度管控",
        why: "因为要做进度汇总",
        module_ids: ["mod-0"],
        kind: "change_existing",
        paths: ["src/pages/**"],
        excluded_by_user: false,
      },
    ],
    never_touch: [{ label: "密码与钥匙文件", paths: [".env*"] }],
    needs_approval: [],
    verification: {
      commands: [],
      plain: ["页面能打开并看到进度数字"],
      manual_only: true,
    },
    budget: {
      limits: {
        max_file_modifications: 10,
        max_total_diff_lines: 2000,
        max_duration_seconds: 1800,
        max_verification_retries: 3,
        max_command_executions: 40,
        max_tool_calls: 200,
      },
      plain: formatBudgetPlain({
        max_file_modifications: 10,
        max_duration_seconds: 1800,
      }),
    },
    grade: { ok: true, rejected: [] },
    ...partial,
  };
  const withDigest: ScopePlan = { ...plan, plan_digest: "" };
  withDigest.plan_digest = scopePlanDigest(withDigest);
  return withDigest;
}

function stubTransport(): AgentSessionTransport {
  return {
    listAdapters: async () => [
      {
        id: "demo",
        label: "练习沙箱",
        control_mode: "GATEWAY_ENFORCED",
        verified_on: "",
        tool_mode: "read_only",
        available: true,
      },
    ],
    listSessions: async () => [],
    createSession: async () => {
      throw new Error("not used");
    },
    getSession: async () => {
      throw new Error("not used");
    },
    send: async () => "started",
    interrupt: async () => true,
    subscribe: () => () => {},
  };
}

function stubSession(
  overrides: Partial<UseAgentSession> = {},
): UseAgentSession {
  return {
    adapters: [
      {
        id: "demo",
        label: "练习沙箱",
        control_mode: "GATEWAY_ENFORCED",
        verified_on: "",
        tool_mode: "read_only",
        available: true,
      },
    ],
    sessions: [
      {
        id: "s1",
        adapter_id: "demo",
        title: "方案讨论",
        created_at: new Date().toISOString(),
      },
    ],
    sessionId: "s1",
    events: [],
    messages: [],
    busy: false,
    error: null,
    firstTokenMs: null,
    selectSession: async () => {},
    newSession: async () => {},
    send: async () => {},
    stop: async () => {},
    refresh: async () => {},
    ...overrides,
  } as UseAgentSession;
}

describe("J-02 handoff progress helpers", () => {
  it("五阶段映射到三步人话", () => {
    expect(confirmStepToHandoffUi("CLAIM_AND_QUIESCE")).toBe("save_scheme");
    expect(confirmStepToHandoffUi("VALIDATE_CONFIRMATION")).toBe("save_scheme");
    expect(confirmStepToHandoffUi("FREEZE_SNAPSHOT")).toBe("save_scheme");
    expect(confirmStepToHandoffUi("SIGN_AND_PREPARE")).toBe(
      "prepare_workspace",
    );
    expect(confirmStepToHandoffUi("COMMIT")).toBe("arrange_steps");
    expect(HANDOFF_UI_STEPS).toHaveLength(3);
  });

  it("交接卡含节点数与预算白话", () => {
    const text = formatHandoffStartedCard({
      nodeCount: 6,
      budgetPlain: "最多改约 10 个文件，预计 20～30 分钟",
    });
    expect(text).toContain("一共 6 步");
    expect(text).toContain("预计 20～30 分钟");
    expect(text).toContain("你可以离开");
  });

  it("冻结后不得回写方案", () => {
    expect(partnerMessageMayRebuildScheme(null)).toBe(true);
    expect(partnerMessageMayRebuildScheme(makeScheme())).toBe(true);
    expect(
      partnerMessageMayRebuildScheme(makeScheme({ frozen: true })),
    ).toBe(false);
  });
});

describe("J-02 SchemeReviewPane 三步进度与中栏卡", () => {
  const scheme = makeScheme();
  const demo: DemoGate = EMPTY_DEMO_GATE;
  const confirmation = evaluateSchemeConfirmation(
    scheme,
    demo,
    compliantScopePlan({ scheme_revision: scheme.scheme_revision }),
  );

  it("交接中显示三步进度，确认按钮被进度取代", () => {
    render(
      <SchemeReviewPane
        scheme={scheme}
        demoGate={demo}
        confirmation={confirmation}
        confirmBusy
        handoffStep="prepare_workspace"
      />,
    );
    expect(screen.getByTestId("handoff-progress")).toBeInTheDocument();
    expect(screen.getByTestId("handoff-step-save_scheme")).toHaveAttribute(
      "data-handoff-state",
      "done",
    );
    expect(
      screen.getByTestId("handoff-step-prepare_workspace"),
    ).toHaveAttribute("data-handoff-state", "active");
    expect(screen.getByTestId("handoff-step-arrange_steps")).toHaveAttribute(
      "data-handoff-state",
      "pending",
    );
    expect(screen.getByTestId("handoff-progress-hint").textContent).toContain(
      HANDOFF_LOCK_HINT,
    );
    expect(screen.queryByTestId("scheme-confirm")).toBeNull();
  });

  it("成功卡在中栏且含节点数", () => {
    const card = formatHandoffStartedCard({
      nodeCount: 6,
      budgetPlain: "预计 20～30 分钟",
    });
    render(
      <SchemeReviewPane
        scheme={{ ...scheme, frozen: true }}
        demoGate={demo}
        confirmation={confirmation}
        handoffCardText={card}
      />,
    );
    const el = screen.getByTestId("handoff-started-card");
    expect(el.textContent).toContain("一共 6 步");
  });

  it("补偿失败显示诊断入口", () => {
    const onOpen = vi.fn();
    render(
      <SchemeReviewPane
        scheme={scheme}
        demoGate={demo}
        confirmation={confirmation}
        handoffCompensationFailed
        onOpenHandoffDiagnose={onOpen}
      />,
    );
    expect(screen.getByTestId("handoff-compensation-failed").textContent).toContain(
      HANDOFF_COMPENSATION_FAILED_MESSAGE,
    );
    fireEvent.click(screen.getByTestId("handoff-compensation-diagnose"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("J-02 右栏锁定 / 解锁与零系统消息", () => {
  it("交接期间输入框 disabled，文案为交接提示", () => {
    render(
      <AgentChatPane
        transport={stubTransport()}
        session={stubSession()}
        locked
        lockedReason={HANDOFF_LOCK_HINT}
        journeyCards={[]}
      />,
    );
    expect(screen.getByTestId("agent-chat-locked").textContent).toContain(
      "正在交接",
    );
    const input = screen.getByLabelText("给 Agent 的消息");
    expect(input).toBeDisabled();
    expect((input as HTMLTextAreaElement).placeholder).toContain("正在交接");
  });

  it("成功解锁后输入框可用，且右栏无新增系统 journey 卡", () => {
    render(
      <AgentChatPane
        transport={stubTransport()}
        session={stubSession()}
        locked={false}
        journeyCards={[]}
      />,
    );
    expect(screen.queryByTestId("agent-chat-locked")).toBeNull();
    expect(screen.getByLabelText("给 Agent 的消息")).not.toBeDisabled();
    expect(screen.queryAllByTestId("journey-card")).toHaveLength(0);
  });
});

describe("J-02 runConfirmSchemeAtomic onStage 与失败解锁", () => {
  beforeEach(() => {
    resetConfirmSchemeTransactionsForTest();
  });

  it("成功路径依次上报五阶段，且 restore 可由调用方在 COMMIT 后执行", async () => {
    const stages: ConfirmSchemeStepId[] = [];
    let locked = true;
    const result = await runConfirmSchemeAtomic({
      confirmationId: "scheme-confirm-j7-ok-0001",
      scheme: makeScheme(),
      demo: EMPTY_DEMO_GATE,
      expectedRevision: 2,
      scopePlan: compliantScopePlan(),
      quiesceRightChat: async () => {
        locked = true;
      },
      persistSnapshot: async ({ confirmation_id }) => ({
        snapshot_id: confirmation_id,
        digest: "d1",
      }),
      signAndPrepare: async () => ({ contract_id: "c-j7-1" }),
      restoreRightChat: () => {
        locked = false;
      },
      onStage: (s) => stages.push(s),
    });
    expect(result.ok).toBe(true);
    expect(stages).toEqual([
      "CLAIM_AND_QUIESCE",
      "VALIDATE_CONFIRMATION",
      "FREEZE_SNAPSHOT",
      "SIGN_AND_PREPARE",
      "COMMIT",
    ]);
    // 事务本身不自动解锁；调用方 COMMIT 后解锁
    locked = false;
    expect(locked).toBe(false);
  });

  it("E_SIGN_AND_PREPARE_FAILED（补偿成功）→ restore 被调用", async () => {
    let restored = 0;
    const result = await runConfirmSchemeAtomic({
      confirmationId: "scheme-confirm-j7-sign-0001",
      scheme: makeScheme(),
      demo: EMPTY_DEMO_GATE,
      expectedRevision: 2,
      scopePlan: compliantScopePlan(),
      quiesceRightChat: async () => {},
      persistSnapshot: async ({ confirmation_id }) => ({
        snapshot_id: confirmation_id,
        digest: "d1",
      }),
      signAndPrepare: async () => {
        throw new Error("签署失败");
      },
      compensate: async () => {},
      restoreRightChat: () => {
        restored += 1;
      },
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("E_SIGN_AND_PREPARE_FAILED");
    expect(restored).toBe(1);
  });

  it("E_COMPENSATION_FAILED → 不 restore，保持锁定", async () => {
    let restored = 0;
    const result = await runConfirmSchemeAtomic({
      confirmationId: "scheme-confirm-j7-comp-0001",
      scheme: makeScheme(),
      demo: EMPTY_DEMO_GATE,
      expectedRevision: 2,
      scopePlan: compliantScopePlan(),
      quiesceRightChat: async () => {},
      persistSnapshot: async ({ confirmation_id }) => ({
        snapshot_id: confirmation_id,
        digest: "d1",
      }),
      signAndPrepare: async () => {
        throw new Error("签署失败");
      },
      compensate: async () => {
        throw new Error("补偿也失败");
      },
      restoreRightChat: () => {
        restored += 1;
      },
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("E_COMPENSATION_FAILED");
    expect(restored).toBe(0);
  });
});

describe("J-02 冻结后发送不回写方案", () => {
  it("冻结后：搭档 send 1 次，rebuildSchemeFromCorpus 0 次，revision 不变", async () => {
    resetConfirmSchemeTransactionsForTest();
    const rebuildSpy = vi.spyOn(schemeDraftMod, "rebuildSchemeFromCorpus");
    const send = vi.fn(async () => {});
    const frozen = makeScheme({ frozen: true, scheme_revision: 5 });
    let revision = frozen.scheme_revision;

    function Harness() {
      return (
        <AgentChatPane
          transport={stubTransport()}
          session={stubSession({ send })}
          locked={false}
          onBeforeSend={async () => {
            if (!partnerMessageMayRebuildScheme(frozen)) {
              return "passthrough";
            }
            schemeDraftMod.rebuildSchemeFromCorpus(frozen, "x", {
              titleHint: "x",
            });
            revision += 1;
            return "passthrough";
          }}
        />
      );
    }

    render(<Harness />);
    const input = screen.getByLabelText("给 Agent 的消息");
    fireEvent.change(input, { target: { value: "施工期补充一句" } });
    fireEvent.click(screen.getByTestId("chat-send"));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(rebuildSpy).toHaveBeenCalledTimes(0);
    expect(revision).toBe(5);
    rebuildSpy.mockRestore();
  });
});

describe("J-02 集成：点击确认驱动三步并解锁", () => {
  it("点击后依次出现三步；成功后输入可用且右栏系统卡仍为 0", async () => {
    resetConfirmSchemeTransactionsForTest();
    const scheme = makeScheme();
    const plan = compliantScopePlan({
      scheme_revision: scheme.scheme_revision,
    });
    const confirmation = evaluateSchemeConfirmation(
      scheme,
      EMPTY_DEMO_GATE,
      plan,
    );

    function Flow() {
      const [step, setStep] = useState<HandoffUiStepId | null>(null);
      const [locked, setLocked] = useState(false);
      const [card, setCard] = useState<string | null>(null);
      const [busy, setBusy] = useState(false);
      const [cards] = useState<
        { id: string; kind: "SYSTEM"; text: string }[]
      >([]);

      const onConfirm = async () => {
        setBusy(true);
        setLocked(true);
        setStep("save_scheme");
        const stages: ConfirmSchemeStepId[] = [];
        const result = await runConfirmSchemeAtomic({
          confirmationId: newSchemeConfirmationId(),
          scheme,
          demo: EMPTY_DEMO_GATE,
          expectedRevision: scheme.scheme_revision,
          scopePlan: plan,
          quiesceRightChat: async () => setLocked(true),
          persistSnapshot: async ({ confirmation_id }) => ({
            snapshot_id: confirmation_id,
            digest: "d",
          }),
          signAndPrepare: async () => {
            setStep("arrange_steps");
            return { contract_id: "c-flow" };
          },
          restoreRightChat: () => {
            setLocked(false);
            setStep(null);
          },
          onStage: (s) => {
            stages.push(s);
            setStep(confirmStepToHandoffUi(s));
          },
        });
        expect(result.ok).toBe(true);
        expect(stages[0]).toBe("CLAIM_AND_QUIESCE");
        setStep(null);
        setLocked(false);
        setCard(
          formatHandoffStartedCard({
            nodeCount: 6,
            budgetPlain: plan.budget.plain,
          }),
        );
        setBusy(false);
      };

      return (
        <div>
          <SchemeReviewPane
            scheme={scheme}
            demoGate={EMPTY_DEMO_GATE}
            confirmation={confirmation}
            confirmBusy={busy}
            handoffStep={step}
            handoffCardText={card}
            onConfirmScheme={() => {
              void onConfirm();
            }}
          />
          <AgentChatPane
            transport={stubTransport()}
            session={stubSession()}
            locked={locked}
            lockedReason={locked ? HANDOFF_LOCK_HINT : undefined}
            journeyCards={cards}
          />
        </div>
      );
    }

    render(<Flow />);
    fireEvent.click(screen.getByTestId("scheme-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("handoff-started-card").textContent).toContain(
        "一共 6 步",
      ),
    );
    expect(screen.queryByTestId("agent-chat-locked")).toBeNull();
    expect(screen.getByLabelText("给 Agent 的消息")).not.toBeDisabled();
    expect(screen.queryAllByTestId("journey-card")).toHaveLength(0);
  });
});
