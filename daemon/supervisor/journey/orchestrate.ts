/**
 * 旅程编排入口（TASK-S.6）：右侧一句话 → 分流 → 复用既有引擎。
 *
 * 不重砌 S.2 / S.5 / C.7：只做粘合。
 * - LIVE_INCIDENT（TASK-L.16 E 类）→ 指引到发布页「线上」卡
 * - DISPUTE → runDisputeSelfCheck
 * - REAL_PLAYTEST → 提示前端挂真机预览（实际启动由 Daemon HTTP / 前端触发）
 * - MAJOR_DRAFT / FAST_PATH → generateContractDraft（Fast Path 标 LOW + skip_demo）
 * - CHAT → 透传提示，由前端交给 Worker
 */

import {
  classifyJourneyIntent,
  type JourneyIntentKind,
  type JourneyIntentResult,
} from "../../../src/lib/journey/intent-router";
import type { SoftwareContract } from "../../../src/lib/contract.schema";
import {
  generateContractDraft,
  type ContractDraftGenerated,
  type DraftEnrichment,
} from "../draft-generator";
import { runDisputeSelfCheck } from "../dispute/index";
import type { DisputeReport } from "../dispute/types";
import type { RequirementsStore } from "../specs/requirements-store";
import type { SupervisorBudgetLedger } from "../budget";
import type { SupervisorMessage } from "../types";
import { readBaselineArchive } from "../../baseline/store";
import {
  guardSupervisorAgainstBaselineRace,
  prependBaselineGuardNotice,
} from "../../baseline/supervisor-guard";
import type { ContractStore } from "../../pipeline/contract-store";
import {
  DraftContractIdError,
  persistJourneyDraft,
  journeyDraftSuccessFields,
  requireDraftContractId,
} from "./draft-contract-id";

export interface JourneyOrchestrateInput {
  message: string;
  repoRoot: string;
  /** TASK-L.16：LIVE 目标名，供 E 类分流 */
  liveTargetNames?: string[] | undefined;
  /** TASK-L.16：有施工中合同时禁止 E */
  hasInProgressContract?: boolean | undefined;
  /** 当前选中合同；质疑路径必需 */
  contract?: SoftwareContract | undefined;
  sessionId?: string | undefined;
  requirementsStore?: RequirementsStore | undefined;
  budgetLedger?: SupervisorBudgetLedger | undefined;
  enrich?:
    | ((prompt: string) => Promise<DraftEnrichment> | DraftEnrichment)
    | undefined;
  /** 注入时钟（测试） */
  now?: (() => Date) | undefined;
  /** 测试替身：覆盖 dispute 执行。生产不传。 */
  runDispute?: typeof runDisputeSelfCheck | undefined;
  /** 测试替身：覆盖草案生成。生产不传。 */
  runDraft?:
    | ((
        intent: string,
        risk: "LOW" | "MEDIUM",
      ) => Promise<ContractDraftGenerated>)
    | undefined;
  /** TASK-H.5：落盘草案并回传顶层 contract_id；生产必传 */
  contractStore?: ContractStore | undefined;
}

export interface JourneyOrchestrateResult {
  intent: JourneyIntentResult;
  route: JourneyIntentKind;
  plain_summary: string;
  dispute_report?: DisputeReport | undefined;
  draft?: ContractDraftGenerated | undefined;
  /** TASK-H.5：顶层必带，与落盘合同一致 */
  contract_id?: string | undefined;
  requirements_updated?: boolean | undefined;
  requirements_hint?: string | undefined;
  skip_demo?: boolean | undefined;
  suggest_viewport?:
    "dispute" | "demo" | "graph" | "contract" | "playtest" | undefined;
  code?: string | undefined;
}

function formatLocalTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export async function orchestrateJourney(
  input: JourneyOrchestrateInput,
): Promise<JourneyOrchestrateResult> {
  const intent = classifyJourneyIntent(input.message, {
    liveTargetNames: input.liveTargetNames,
    hasInProgressContract: input.hasInProgressContract,
  });
  const now = input.now?.() ?? new Date();
  // TASK-C.14c：深度扫未完时防抢跑（不抛异常、不空白）
  const baselineGuard = guardSupervisorAgainstBaselineRace(
    readBaselineArchive(input.repoRoot),
  );
  const withGuard = (summary: string) =>
    prependBaselineGuardNotice(summary, baselineGuard);

  if (intent.kind === "CHAT") {
    return {
      intent,
      route: "CHAT",
      plain_summary: withGuard(
        intent.reasons.join(" ") || "好的，我们慢慢聊。",
      ),
    };
  }

  // TASK-L.16 E 类：不直接改合同；指引发布页「线上」卡
  if (intent.kind === "LIVE_INCIDENT") {
    return {
      intent,
      route: "LIVE_INCIDENT",
      plain_summary: withGuard(
        intent.reasons.join(" ") ||
          "这像是线上问题。请打开发布页的「线上」卡，点「让 AI 看看」。",
      ),
      skip_demo: true,
    };
  }

  if (intent.kind === "DISPUTE") {
    if (!input.contract) {
      return {
        intent,
        route: "DISPUTE",
        plain_summary: withGuard(
          "我听出你在质疑「这里做错了」。请先在左侧点一份合同（或先让我出草案），我才能对照蓝图帮你查。",
        ),
        code: "CONTRACT_REQUIRED",
        suggest_viewport: "contract",
      };
    }

    if (input.requirementsStore) {
      input.requirementsStore.ensureBaseline(input.contract);
    }

    const run = input.runDispute ?? runDisputeSelfCheck;
    const report = await run({
      contract: input.contract,
      challenge: input.message.trim(),
      repoRoot: input.repoRoot,
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    });

    return {
      intent,
      route: "DISPUTE",
      plain_summary: withGuard(report.plain_summary),
      dispute_report: report,
      suggest_viewport: "dispute",
      requirements_updated: true,
      requirements_hint: `需求基准已对齐 · ${formatLocalTime(now)}`,
    };
  }

  if (intent.kind === "REAL_PLAYTEST") {
    if (!input.contract) {
      return {
        intent,
        route: "REAL_PLAYTEST",
        plain_summary: withGuard(
          "要打开真机预览，请先在左侧选一个合同（或先确认原型开工）。选好后再说「打开真机预览」。",
        ),
        code: "CONTRACT_REQUIRED",
        suggest_viewport: "contract",
        skip_demo: true,
      };
    }
    return {
      intent,
      route: "REAL_PLAYTEST",
      plain_summary: withGuard(
        [
          "好，去开真机预览。",
          ...intent.reasons,
          "中栏会挂上真实页面，也可以点「在浏览器打开」。没有业务产物时会先放一页试玩桩，方便你点通流程。",
        ].join(" "),
      ),
      suggest_viewport: "playtest",
      skip_demo: true,
      code: "START_REAL_PLAYTEST",
    };
  }

  // MAJOR_DRAFT / FAST_PATH → 出草案
  const risk: "LOW" | "MEDIUM" = intent.kind === "FAST_PATH" ? "LOW" : "MEDIUM";

  let draft: ContractDraftGenerated;
  if (input.runDraft) {
    draft = await input.runDraft(input.message.trim(), risk);
  } else {
    const message: SupervisorMessage = {
      message_id: `msg_journey_${now.getTime()}`,
      role: "user",
      text: input.message.trim(),
      created_at: now.toISOString(),
      source: "ui",
    };
    const generated = await generateContractDraft({
      repoRoot: input.repoRoot,
      messages: [message],
      trigger: "USER_REQUEST",
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      ...(input.budgetLedger === undefined
        ? {}
        : { budgetLedger: input.budgetLedger }),
      ...(input.enrich === undefined ? {} : { enrich: input.enrich }),
      now: () => now,
    });
    if (!generated.generated) {
      return {
        intent,
        route: intent.kind,
        plain_summary: withGuard(
          "这次没有生成草案（触发条件不满足）。请换一句更具体的需求再试。",
        ),
        code: "DRAFT_SKIPPED",
        skip_demo: intent.skip_demo,
      };
    }
    // Fast Path：强制 LOW 风险，便于后续 system:fast-path 准入
    if (
      intent.kind === "FAST_PATH" &&
      generated.contract.intent.risk_level !== "LOW"
    ) {
      generated.contract = {
        ...generated.contract,
        intent: { ...generated.contract.intent, risk_level: "LOW" },
      };
    }
    draft = generated;
  }

  let requirementsUpdated = false;
  let requirementsHint: string | undefined;
  if (input.requirementsStore) {
    input.requirementsStore.ensureBaseline(draft.contract);
    requirementsUpdated = true;
    requirementsHint = `需求说明已更新 · ${formatLocalTime(now)}`;
  }

  const plain =
    intent.kind === "FAST_PATH"
      ? [
          "这是小事，走快速通道——不必再强制整套 Demo。",
          ...intent.reasons,
          `已为你备好低风险草案「${draft.contract.intent.title}」。确认范围后可直接小修；越权会自动停住并升成标准审批。`,
        ].join(" ")
      : [
          "我按大事帮你出了草案。",
          ...intent.reasons,
          `标题：${draft.contract.intent.title}。左侧需求说明已刷新，你可以先看再决定是否开工。`,
        ].join(" ");

  // TASK-H.5：成功草案必须带回顶层 contract_id；有 store 则落盘校验
  let contract_id: string;
  let draftOut: ContractDraftGenerated = draft;
  if (input.contractStore) {
    try {
      const persisted = persistJourneyDraft(input.contractStore, draft);
      contract_id = persisted.contract_id;
      draftOut = { ...draft, contract: persisted.contract };
    } catch (err) {
      if (err instanceof DraftContractIdError) {
        return {
          intent,
          route: intent.kind,
          plain_summary: withGuard(err.message),
          code: err.code,
          skip_demo: intent.skip_demo,
          suggest_viewport: "contract",
        };
      }
      throw err;
    }
  } else {
    try {
      contract_id = requireDraftContractId(draft);
    } catch (err) {
      if (err instanceof DraftContractIdError) {
        return {
          intent,
          route: intent.kind,
          plain_summary: withGuard(err.message),
          code: err.code,
          skip_demo: intent.skip_demo,
          suggest_viewport: "contract",
        };
      }
      throw err;
    }
  }

  return {
    intent,
    route: intent.kind,
    plain_summary: withGuard(plain),
    draft: draftOut,
    ...journeyDraftSuccessFields(contract_id),
    requirements_updated: requirementsUpdated,
    ...(requirementsHint === undefined
      ? {}
      : { requirements_hint: requirementsHint }),
    skip_demo: intent.skip_demo,
    suggest_viewport: intent.kind === "FAST_PATH" ? "contract" : "demo",
  };
}
