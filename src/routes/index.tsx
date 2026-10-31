import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  GitCompare,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "@/lib/contract.schema";
import type { EvidenceBundle } from "@/lib/evidence.schema";
import {
  abortContract,
  applyProtectionRecommendations,
  createChatSession,
  decideProtectionCard,
  fetchProtection,
  fetchProtectionRecommendations,
  getChatSession,
  interruptChat,
  listChatAdapters,
  listChatSessions,
  sendChatMessage,
  readWorktreeFile,
  saveWorktreeFile,
  approveContract,
  createContractWithAdmission,
  admitContract,
  executeContract,
  fetchArchGraph,
  fetchBaselineArchive,
  acceptBaselineArchive,
  rescanBaselineArchive,
  fetchRepoTree,
  deleteRepoPath,
  createRepoPath,
  renameRepoPath,
  revealRepoPath,
  fetchDiff,
  fetchDiffFiles,
  fetchEvidence,
  fetchHealth,
  fetchSettings,
  fetchTaskGraph,
  generateSupervisorDraft,
  submitDisputeSelfCheck,
  submitJourneyMessage,
  fetchJourneyHistory,
  startRealPlaytest,
  stopRealPlaytest,
  getRealPlaytestStatus,
  startTaskGraphNode,
  verifyTaskGraphNode,
  createTaskGraph,
  createSupervisorPrototype,
  confirmSupervisorPrototype,
  freezeSchemeSnapshot,
  preflightScope,
  fetchPresentationSnapshot,
  listContracts,
  loadConnection,
  mergeContract,
  resumeContract,
  runWorker,
  saveConnection,
  saveOpenAiKey,
  undoProtectionRound,
  unlockProtectionEntry,
  type ArchGraphPayload,
  type BaselineArchivePayload,
  type AdmissionView,
  type DaemonConnection,
  type DiffFilesView,
  type ModelSettings,
  type ProtectionRecommendationView,
  type ProtectionStateView,
  type SupervisorDraftResult,
  type SupervisorDraftResponse,
  type WorkerRunResult,
  DaemonApiError,
} from "@/lib/daemon-api";
import { ContractCard } from "@/components/contract/ContractCard";
import { ScopeList } from "@/components/contract/ScopeList";
import { BudgetVisualizer } from "@/components/contract/BudgetVisualizer";
import { RadarGraph } from "@/components/radar/RadarGraph";
import { FilterToolbar } from "@/components/radar/FilterToolbar";
import { ScopeSelector } from "@/components/radar/ScopeSelector";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { StructuredTerminal } from "@/components/StructuredTerminal";
import { EditorOpener } from "@/components/editor/EditorOpener";
import { EvidenceChecklist } from "@/components/evidence/EvidenceChecklist";
import { useDaemonStream } from "@/hooks/use-daemon-stream";
import { WorkspaceLayout } from "@/components/WorkspaceLayout";
import {
  AgentChatPane,
  type JourneyChatCard,
} from "@/components/AgentChatPane";
import { buildProposalFromContract } from "@/lib/journey/proposal-from-contract";
import { resolveCommandSurface } from "@/lib/command-surface";
import {
  resolveActiveInProgress,
  resolveInProgressCta,
} from "@/lib/in-progress-lifecycle";
import type { AssistantModeSurface } from "@/lib/assistant-mode";
import type { StudioViewportId } from "@/components/studio/viewport-routing";
import { traceCtaClick, traceCtaDisabled } from "@/lib/ui-trace";
import { MonacoEditorPane } from "@/components/MonacoEditorPane";
import {
  ProtectionApprovalCard,
  ProtectionRecommendationCard,
} from "@/components/ProtectionCard";
import { ProtectionConfirmCard } from "@/components/ProtectionConfirmCard";
import { SupervisorStudioPane } from "@/components/SupervisorStudioPane";
import { StudioViewportShell } from "@/components/studio/StudioViewportShell";
import { SchemeReviewPane } from "@/components/studio/SchemeReviewPane";
import { DemoPreviewPane } from "@/components/studio/DemoPreviewPane";
import { PlainContractAuthorizeCard } from "@/components/supervisor/PlainContractAuthorizeCard";
import { ScopePausedDialog } from "@/components/supervisor/ScopePausedDialog";
import {
  formatClarificationDefaultsSummary,
  type ClarificationRound,
  type ClarificationSessionState,
} from "@/lib/journey/clarification";
import {
  rebuildSchemeFromCorpus,
  confirmSchemeDecision,
  resolveSchemeConflict,
  updateSchemeNotes,
  evaluateSchemeConfirmation,
  freezeScheme,
  EMPTY_DEMO_GATE,
  type DemoGate,
  type SchemeDraft,
} from "@/lib/journey/scheme-draft";
import { buildConfirmContractFromScopePlan } from "@/lib/journey/confirm-scheme-contract";
import type { ScopePlan } from "@/lib/journey/scope-plan";
import {
  newSchemeConfirmationId,
  runConfirmSchemeAtomic,
} from "@/lib/journey/confirm-scheme-atomic";
import {
  grayOutTaskGraphNodes,
  shouldGrayAfterDispute,
} from "@/lib/graph/dispute-gray";
import { RealPlaytestPane } from "@/components/studio/RealPlaytestPane";
import {
  isDeliveredLifecycle,
  MERGED_PRODUCT_PREVIEW_URLS,
  pickDefaultContractId,
} from "@/lib/contract-selection";
import { TaskGraphPane } from "@/components/studio/TaskGraphPane";
import {
  DisputeConsolePane,
  type DisputeReportView,
} from "@/components/studio/DisputeConsolePane";
import { SupervisorTab } from "@/components/supervisor/SupervisorTab";
import { SettingsTab } from "@/components/settings/SettingsTab";
import { applyTaskGraphFrame } from "@/components/graph/graph-view-model";
import {
  FileTreeSpecsSection,
  type SpecAsset,
} from "@/components/FileTreeSpecsSection";
import type { TaskGraph } from "@/lib/graph/task-graph";
import {
  buildBossFastPathSummary,
  isBossFastPathPresentation,
  shouldConfirmAdmission,
  seedDraftForm,
  toStudioDraft,
  toSupervisorContractView,
} from "@/components/supervisor-view-model";
import { BossFastPathDesk } from "@/components/studio/BossFastPathDesk";
import type { WorktreeFileIO } from "@/hooks/useWorktreeFile";
import {
  useAgentSession,
  type AgentSessionTransport,
} from "@/hooks/use-agent-session";
import type { ChatEvent } from "@/lib/chat-events";
import {
  APPROVED_STATES,
  buildFileTree,
  toExecutionStatus,
} from "@/components/workspace-adapters";
import {
  EXECUTION_STATUS_LABEL,
  type ActiveContract,
} from "@/components/workspace-types";
import { createProtectionPoller } from "@/lib/perf-guards";
import type {
  ContractUpdatePayload,
  DemoPreviewStatusPayload,
  RealPlaytestStatusPayload,
  EvidenceReadyPayload,
  StateChangedPayload,
  TaskGraphUpdatedPayload,
  BaselineProgressPayload,
} from "@/lib/ipc/frames";
import type { PresentationState } from "@/lib/state/presentation-state";
import { PRESENTATION_STATES } from "@/lib/state/presentation-state";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Stagent — 工作台" },
      {
        name: "description",
        content:
          "Stagent 本地任务副驾：架构雷达、合同审批、受限执行与 Evidence 验收。",
      },
    ],
  }),
  component: Console,
});

function Console() {
  const [conn, setConn] = useState<DaemonConnection>(() => loadConnection());
  const [connected, setConnected] = useState(false);
  const [daemonPort, setDaemonPort] = useState<number | null>(null);
  const [repoRoot, setRepoRoot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [contracts, setContracts] = useState<SoftwareContract[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<EvidenceBundle | null>(null);
  const [workerResult, setWorkerResult] = useState<WorkerRunResult | null>(
    null,
  );
  const [showForm, setShowForm] = useState(false);
  const [scopeDraft, setScopeDraft] = useState<string[]>([]);
  /**
   * `POST /api/supervisor/draft` 刚返回的**未落盘草案**。
   *
   * 为什么要有这个状态：草案在用户点「提交给 Daemon」之前根本不存在于仓库里，
   * 却又必须让 Supervisor Tab / Studio 显示它的白话理由与未决问题——
   * 不能伪造一个假合同塞进 contracts 列表，那会让"已落盘"和"未提交"混为一谈。
   */
  const [draft, setDraft] = useState<SupervisorDraftResult | null>(null);

  const [graph, setGraph] = useState<ArchGraphPayload | null>(null);
  /** C.10f 热修：资源管理器文件来自 /api/repo/tree，不绑架构图 */
  const [repoPaths, setRepoPaths] = useState<string[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [showCycles, setShowCycles] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);

  /**
   * Task Graph 权威快照（TASK-C.7）。
   * 首屏 GET 一次，之后全部由 `TASK_GRAPH_UPDATED` 帧覆盖；
   * 页面不读 `.stagent/specs/task_graph.json`，也不自行推导节点状态。
   */
  const [taskGraph, setTaskGraph] = useState<TaskGraph | null>(null);
  const [taskGraphLoading, setTaskGraphLoading] = useState(false);
  const [taskGraphError, setTaskGraphError] = useState<string | null>(null);
  const [specsOpen, setSpecsOpen] = useState(true); // C.10f：审阅页内默认展开本轮依据

  /** TASK-C.2：Daemon 权威展示态（STATE_CHANGED），驱动 Studio 默认视口 */
  const [presentationByContract, setPresentationByContract] = useState<
    Record<string, { state: PresentationState; message: string }>
  >({});
  const [demoPreview, setDemoPreview] =
    useState<DemoPreviewStatusPayload | null>(null);
  const [realPlaytest, setRealPlaytest] =
    useState<RealPlaytestStatusPayload | null>(null);
  const [realPlaytestBusy, setRealPlaytestBusy] = useState(false);
  const [realPlaytestError, setRealPlaytestError] = useState<string | null>(
    null,
  );
  const [disputeReport, setDisputeReport] = useState<DisputeReportView | null>(
    null,
  );
  const [disputeBusy, setDisputeBusy] = useState(false);
  const [disputeError, setDisputeError] = useState<string | null>(null);
  /** TASK-S.6：右侧旅程卡与确认原型忙态 */
  const [journeyCards, setJourneyCards] = useState<JourneyChatCard[]>([]);
  const [journeyBusy, setJourneyBusy] = useState(false);

  // TASK-C.17：刷新还原旅程（从 `.stagent/logs/journey-*.jsonl`）
  useEffect(() => {
    if (!conn || !connected) return;
    let cancelled = false;
    void (async () => {
      try {
        const hist = await fetchJourneyHistory(conn, selectedId ?? undefined);
        if (cancelled) return;
        const cards: JourneyChatCard[] = [];
        for (const turn of hist.turns) {
          if (turn.role === "user") {
            cards.push({
              id: `hist-user-${turn.ts}`,
              kind: "SYSTEM",
              text: `你：${turn.text}`,
            });
          } else if (turn.role === "assistant") {
            cards.push({
              id: `hist-as-${turn.ts}`,
              kind: (turn.route as JourneyChatCard["kind"]) || "SYSTEM",
              text: turn.text,
            });
          }
        }
        if (cards.length > 0) {
          setJourneyCards(cards.slice(-20));
        }
      } catch {
        /* 还原失败不挡主路径 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conn, connected, selectedId]);

  const [confirmPrototypeBusy, setConfirmPrototypeBusy] = useState(false);
  /** TASK-C.14：项目现状基线档案（打开即扫） */
  const [baselinePayload, setBaselinePayload] =
    useState<BaselineArchivePayload | null>(null);
  const [baselineBusy, setBaselineBusy] = useState(false);

  const [confirmPrototypeError, setConfirmPrototypeError] = useState<
    string | null
  >(null);

  /** TASK-C.11a：澄清会话（fixture ≤2 轮） */
  const [clarificationState, setClarificationState] =
    useState<ClarificationSessionState | null>(null);
  const [clarificationRound, setClarificationRound] =
    useState<ClarificationRound | null>(null);
  const [clarificationPendingText, setClarificationPendingText] = useState<
    string | null
  >(null);
  /** TASK-C.18：中间方案审阅（随右栏自由对话更新） */
  const [schemeDraft, setSchemeDraft] = useState<SchemeDraft | null>(null);
  const [schemeCorpus, setSchemeCorpus] = useState("");
  const [schemeDemoBusy, setSchemeDemoBusy] = useState(false);
  const [schemeDemoGate, setSchemeDemoGate] =
    useState<DemoGate>(EMPTY_DEMO_GATE);
  const [schemeConfirmBusy, setSchemeConfirmBusy] = useState(false);
  const [schemeChatLocked, setSchemeChatLocked] = useState(false);
  /**
   * TASK-C.22：确认方案的幂等键。
   * 同一修订重试必须复用同一 id——否则网络抖动会签出两份合同；
   * 修订变了就换新 id，旧 id 再由 Daemon 侧 `E_CONFIRMATION_ID_REUSED` 兜底。
   */
  const schemeConfirmIdRef = useRef<{ revision: number; id: string } | null>(
    null,
  );
  /**
   * TASK-J.5：与当前 scheme_revision 绑定的范围预检结果。
   * 修订变化后先清空，300ms 防抖再拉；在途请求被新修订作废。
   */
  const [scopePlan, setScopePlan] = useState<ScopePlan | null>(null);
  const scopePreflightSeqRef = useRef(0);
  /** TASK-C.11b：感官确认 + prototype id */
  const [demoConfirmed, setDemoConfirmed] = useState(false);
  const [activePrototypeId, setActivePrototypeId] = useState<string | null>(
    null,
  );
  const [retainedDemoUrl, setRetainedDemoUrl] = useState<string | null>(null);
  /** TASK-C.11c：白话合同卡可见 + 草案版本 */
  const [plainContractVisible, setPlainContractVisible] = useState(false);
  const [draftVersion, setDraftVersion] = useState(1);
  const [authorizeBusy, setAuthorizeBusy] = useState(false);
  /** TASK-C.11d：越界挂起 */
  const [scopePaused, setScopePaused] = useState<{
    contract_id: string;
    code: string;
    message: string;
    attempted_path?: string;
  } | null>(null);
  const [scopePausedBusy, setScopePausedBusy] = useState(false);

  const schemeConfirmation = useMemo(
    () =>
      schemeDraft
        ? evaluateSchemeConfirmation(schemeDraft, schemeDemoGate, scopePlan)
        : null,
    [schemeDraft, schemeDemoGate, scopePlan],
  );

  /** TASK-J.5：方案修订变化 → 300ms 防抖 preflightScope；修订号不匹配则丢弃。 */
  useEffect(() => {
    if (!conn || !schemeDraft || schemeDraft.frozen) {
      setScopePlan(null);
      return;
    }
    const revision = schemeDraft.scheme_revision;
    const seq = ++scopePreflightSeqRef.current;
    let cancelled = false;
    setScopePlan(null);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const { scope_plan } = await preflightScope(conn, {
            scheme: schemeDraft,
          });
          if (cancelled || scopePreflightSeqRef.current !== seq) return;
          if (scope_plan.scheme_revision !== revision) return;
          setScopePlan(scope_plan);
        } catch {
          if (cancelled || scopePreflightSeqRef.current !== seq) return;
          setScopePlan(null);
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [conn, schemeDraft]);

  /** C.10o：图谱开工/核销忙态与失败黄条（与建图错误共用顶栏） */
  const [graphActionBusy, setGraphActionBusy] = useState(false);
  const [studioViewportOverride, setStudioViewportOverride] =
    useState<StudioViewportId | null>(null);
  const [requirementsHint, setRequirementsHint] = useState<string | null>(null);

  const [diff, setDiff] = useState<{ patch: string; stat: string } | null>(
    null,
  );
  const [diffFiles, setDiffFiles] = useState<DiffFilesView | null>(null);
  const [mergeInfo, setMergeInfo] = useState<string | null>(null);
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [currentBranch, setCurrentBranch] = useState("main");
  const [protection, setProtection] = useState<ProtectionStateView | null>(
    null,
  );
  const [recommendations, setRecommendations] = useState<
    ProtectionRecommendationView[]
  >([]);
  const [protectionBusy, setProtectionBusy] = useState(false);
  const [undoInfo, setUndoInfo] = useState<string | null>(null);
  const [recDismissed, setRecDismissed] = useState(false);
  /**
   * C.2 准入裁决结果。只保存"需要人看的那一次"：
   * AUTO_APPROVED / SKIPPED 一律置 null → 确认卡结构性不渲染（无交集 0 弹窗）。
   */
  const [admission, setAdmission] = useState<AdmissionView | null>(null);
  /**
   * 布局持有 Tab 状态，「打开合同操作台」这类外部跳转用递增信号驱动
   * （与 openRequest 的 nonce 同一套路，避免把 Tab 状态提到页面上）。
   */
  const [studioNonce, setStudioNonce] = useState(0);
  /** C.16：操作台左侧栏打开「项目全景」深页 */
  const [supervisorNonce, setSupervisorNonce] = useState(0);
  const [settingsNonce, setSettingsNonce] = useState(0);
  const [settingsDeepFocus, setSettingsDeepFocus] = useState<
    "model-key" | null
  >(null);
  const [settingsReturnArmed, setSettingsReturnArmed] = useState(false);
  const [closeSettingsNonce, setCloseSettingsNonce] = useState(0);
  /** TASK-C.9b：右栏助手模式 → 中栏同口径提示 */
  const [assistantMode, setAssistantMode] =
    useState<AssistantModeSurface | null>(null);
  /**
   * 打开「新建需求」：带上草稿范围、展开创建表单、并切到方案工作台。
   * 必须一起做——首屏不再默认打开 Studio，只 setShowForm 会让表单渲染在看不见的标签里。
   * 同时丢弃上一份未提交草案：换需求就该重新生成，不能让旧理由挂在新意图上。
   */
  const openNewRequirement = useCallback((paths: string[]) => {
    setScopeDraft(paths);
    setDraft(null);
    setShowForm(true);
    setStudioNonce((n) => n + 1);
    /**
     * 已签署的方案是冻结态：`rebuildSchemeFromCorpus` 会原样返回冻结稿，
     * 右栏看起来能打字、其实改动全被丢弃。所以换需求必须同时丢弃旧方案
     * 与确认幂等键，让右栏回到可写态。
     */
    setSchemeDraft(null);
    setSchemeCorpus("");
    setSchemeDemoGate(EMPTY_DEMO_GATE);
    setSchemeChatLocked(false);
    setDemoConfirmed(false);
    setActivePrototypeId(null);
    schemeConfirmIdRef.current = null;
  }, []);

  const fileTree = useMemo(() => buildFileTree(repoPaths), [repoPaths]);

  const selected = useMemo(
    () => contracts.find((c) => c.contract_id === selectedId) ?? null,
    [contracts, selectedId],
  );

  /** 仓库相对路径集合：判断 Demo 等资产是否已生成（来自纯文件树，非 AST） */
  const repoRelativePaths = useMemo(() => new Set(repoPaths), [repoPaths]);

  /**
   * 左栏【规范与资产】的数据。只列真实存在或真实缺失的东西：
   * 需求标题来自合同、合同路径来自 `.stagent/contracts`，
   * Demo 只在文件树里真出现时才标「就绪」。
   */
  const specAssets = useMemo<SpecAsset[]>(() => {
    if (!selected) return [];
    const assets: SpecAsset[] = [
      {
        id: "requirement",
        kind: "requirement",
        label: selected.intent.title,
        status: "READY",
        hint: requirementsHint
          ? `${requirementsHint} · ${selected.intent.acceptance_criteria.length} 条验收 · ${selected.intent.risk_level}`
          : `${selected.intent.acceptance_criteria.length} 条验收标准 · ${selected.intent.risk_level} 风险`,
      },
      {
        id: "contract",
        kind: "contract",
        label: `合同 ${selected.contract_id.slice(-8)}.json`,
        path: `.stagent/contracts/${selected.contract_id}.json`,
        status: "READY",
        hint: `${selected.lifecycle_state} · rev ${selected.contract_revision}`,
      },
    ];

    const demoCandidates = [
      "demo/index.html",
      "prototype/index.html",
      ".stagent/demo/index.html",
    ];
    const demoPath = demoCandidates.find((path) => repoRelativePaths.has(path));
    assets.push(
      demoPath
        ? {
            id: "demo",
            kind: "demo",
            label: demoPath.split("/").pop() ?? demoPath,
            path: demoPath,
            status: "READY" as const,
            hint: demoPath,
          }
        : {
            id: "demo",
            kind: "demo",
            label: "Demo 原型",
            status: "MISSING" as const,
            hint: "尚未生成原型；生成后会自动出现在这里",
          },
    );
    return assets;
  }, [selected, repoRelativePaths, requirementsHint]);

  /** 本轮生成进度：只认当前合同自己的图，别把 A 的进度显示在 B 上 */
  const specsGeneration = useMemo(() => {
    if (
      !taskGraph ||
      !selected ||
      taskGraph.contract_id !== selected.contract_id
    ) {
      return null;
    }
    return {
      percent: taskGraph.progress.percent,
      illuminated: taskGraph.progress.illuminated,
      total: taskGraph.progress.total,
      updatedAt: taskGraph.updated_at.slice(11, 19),
    };
  }, [taskGraph, selected]);

  const matches = useMemo(() => {
    if (!graph || !query.trim()) return 0;
    const needle = query.toLowerCase();
    return graph.graph.nodes.filter((n) =>
      n.filePath.toLowerCase().includes(needle),
    ).length;
  }, [graph, query]);

  const focusPath = useMemo(() => {
    if (!graph || !query.trim()) return undefined;
    const needle = query.toLowerCase();
    return graph.graph.nodes.find((n) =>
      n.filePath.toLowerCase().includes(needle),
    )?.filePath;
  }, [graph, query]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const health = await fetchHealth(conn);
      setConnected(health.status === "ok");
      setDaemonPort(health.port);
      setRepoRoot(health.repoRoot);
      setCurrentBranch(health.currentBranch || "main");
      const listed = await listContracts(conn);
      setContracts(listed);
      setSelectedId((prev) => pickDefaultContractId(listed, prev));
      // P.1：保护清单/本轮授权/快照状态（轮询兜底；卡片靠它出现）
      try {
        const p = await fetchProtection(conn);
        setProtection(p);
        if (p.entries.length === 0 && !p.corrupt) {
          setRecommendations(await fetchProtectionRecommendations(conn));
        } else {
          setRecommendations([]);
        }
      } catch {
        // 保护接口异常不阻断主流程；门卫在后台仍按失败关闭运行
      }
      // TASK-C.2：展示态快照与保护清单解耦——失败/挂起不得挡住 P.1 横幅
      void fetchPresentationSnapshot(conn)
        .then((snap) => {
          const next: Record<
            string,
            { state: PresentationState; message: string }
          > = {};
          for (const [id, rec] of Object.entries(snap.contracts)) {
            if (
              (PRESENTATION_STATES as readonly string[]).includes(
                rec.presentation_state,
              )
            ) {
              next[id] = {
                state: rec.presentation_state as PresentationState,
                message: rec.message?.trim() || "",
              };
            }
          }
          setPresentationByContract(next);
        })
        .catch(() => {
          // 投影文件缺失不阻断主流程；保持内存态或空
        });
    } catch (err) {
      setConnected(false);
      setDaemonPort(null);
      setError((err as Error).message);
    }
  }, [conn]);

  // P.1：推荐卡「以后再说」按仓库记住，不反复打扰
  useEffect(() => {
    if (!repoRoot) return;
    try {
      setRecDismissed(
        localStorage.getItem(`stagent.protectionRecDismissed:${repoRoot}`) ===
          "1",
      );
    } catch {
      setRecDismissed(false);
    }
  }, [repoRoot]);

  const dismissRecommendations = useCallback(() => {
    setRecDismissed(true);
    try {
      if (repoRoot)
        localStorage.setItem(`stagent.protectionRecDismissed:${repoRoot}`, "1");
    } catch {
      // 隐私模式下写不了，只影响本次会话
    }
  }, [repoRoot]);

  const onDecideProtection = useCallback(
    async (cardId: string, decision: "approve" | "deny") => {
      setProtectionBusy(true);
      try {
        await decideProtectionCard(conn, cardId, decision);
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setProtectionBusy(false);
      }
    },
    [conn, refresh],
  );

  const onApplyRecommendations = useCallback(
    async (names: string[]) => {
      setProtectionBusy(true);
      try {
        await applyProtectionRecommendations(conn, names);
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setProtectionBusy(false);
      }
    },
    [conn, refresh],
  );

  /** C.2：Studio 内逐条解锁保护条目（不提供"一键全解"，安全网不该被一次误点清空） */
  const onUnlockProtection = useCallback(
    async (id: string) => {
      setProtectionBusy(true);
      try {
        await unlockProtectionEntry(conn, id);
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setProtectionBusy(false);
      }
    },
    [conn, refresh],
  );

  const onUndoRound = useCallback(async () => {
    // 白话确认：必须写明「这期间你手动改的也会一起撤销」（P1 卡核心目标 9）
    const ok = window.confirm(
      "回到这轮开始前的样子？这轮改过的文件会恢复；这期间你自己手动改的部分也会一起撤销。（只撤 AI、保留手改的能力以后再做）",
    );
    if (!ok) return;
    setProtectionBusy(true);
    try {
      const result = await undoProtectionRound(conn);
      setUndoInfo(
        result.undone
          ? `已回到本轮开始前${result.deletedFiles?.length ? `，并删除本轮新建的 ${result.deletedFiles.length} 个文件` : ""}。`
          : (result.reason ?? "没有可撤销的一轮改动"),
      );
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProtectionBusy(false);
    }
  }, [conn, refresh]);

  // 右栏会话：CHAT_EVENT 经同一条 WS 推送，这里做一个简单的订阅分发
  const chatListeners = useRef(new Set<(e: ChatEvent) => void>());
  const chatTransport = useMemo<AgentSessionTransport | null>(
    () =>
      connected
        ? {
            listAdapters: () => listChatAdapters(conn),
            listSessions: () => listChatSessions(conn),
            createSession: (a) => createChatSession(conn, a),
            getSession: (id) => getChatSession(conn, id),
            send: (id, text) => sendChatMessage(conn, id, text),
            interrupt: (id) => interruptChat(conn, id),
            subscribe: (listener) => {
              chatListeners.current.add(listener);
              return () => chatListeners.current.delete(listener);
            },
          }
        : null,
    [connected, conn],
  );

  // C.10l：右栏与设置「高级」共用同一会话实例
  const chatSession = useAgentSession(chatTransport);

  /** 把 Daemon 质疑报告压成控制台视图（TASK-S.6 / S.5） */
  const toDisputeView = useCallback(
    (
      report: import("@/lib/daemon-api").DisputeReportApiView,
      degraded?: boolean,
    ): DisputeReportView => ({
      report_id: report.report_id,
      contract_id: report.contract_id,
      challenge: report.challenge,
      classification: report.classification,
      suggested_classification: report.suggested_classification,
      confidence: report.confidence,
      degraded: report.degraded || degraded === true,
      plain_summary: report.plain_summary,
      rationale: report.rationale,
      facts: {
        prompt: {
          original_request: report.facts.prompt.original_request,
          matched_messages: report.facts.prompt.matched_messages.length,
          confirmations: report.facts.prompt.confirmations.length,
        },
        spec: report.facts.spec
          ? {
              matched_entries: report.facts.spec.matched_entries,
              version: report.facts.spec.version,
            }
          : null,
        code: {
          worktree_available: report.facts.code.available,
          changed_files: report.facts.code.changed_files,
          evidence_id: report.facts.code.evidence_id,
        },
      },
      next_action: report.next_action
        ? {
            kind: report.next_action.kind,
            message: report.next_action.message,
          }
        : undefined,
    }),
    [],
  );

  const runDisputeSelfCheckUi = useCallback(
    async (
      challenge: string,
      userChoice?: import("@/lib/daemon-api").DisputeUserChoice,
    ) => {
      if (!selected) return;
      const textIn = challenge.trim();
      if (textIn.length < 4) return;
      setDisputeBusy(true);
      setDisputeError(null);
      try {
        const result = await submitDisputeSelfCheck(conn, {
          contract_id: selected.contract_id,
          challenge: textIn,
          ...(userChoice === undefined ? {} : { user_choice: userChoice }),
        });
        setDisputeReport(
          toDisputeView(result.report, result.degraded === true),
        );
        if (userChoice !== undefined) {
          setJourneyCards((prev) => [
            ...prev.slice(-19),
            {
              id: `dispute-choice-${Date.now()}`,
              kind: "DISPUTE" as const,
              text:
                userChoice === "BUG_FIX"
                  ? `已按你的选择记为「缺陷修复」。${result.report.plain_summary}`
                  : `已按你的选择记为「新需求演进」。${result.report.plain_summary}`,
            },
          ]);
          if (userChoice === "REQUIREMENT_CHANGE") {
            setStudioViewportOverride("contract");
            setShowForm(true);
            setStudioNonce((n) => n + 1);
          } else {
            setStudioViewportOverride("dispute");
          }
        }
        // TASK-C.11e：自查失败或需求演进 → 相关节点回灰，禁止假绿
        const reportFailed =
          result.degraded === true ||
          result.report.degraded === true ||
          result.report.next_action.kind === "REQUIREMENT_CHANGE" ||
          result.report.classification === "REQUIREMENT_DRIFT";
        if (
          taskGraph &&
          shouldGrayAfterDispute({
            userChoice,
            reportFailed: reportFailed === true,
          })
        ) {
          setTaskGraph(
            grayOutTaskGraphNodes(taskGraph, {
              reason:
                userChoice === "REQUIREMENT_CHANGE"
                  ? "需求演进：图谱回灰待重做"
                  : "质疑自查未通过：点亮已回灰",
            }),
          );
          setJourneyCards((prev) => [
            ...prev.slice(-19),
            {
              id: `dispute-gray-${Date.now()}`,
              kind: "DISPUTE",
              text: "相关任务灯已回灰。修完或重签后再验证点亮——不会假绿。",
            },
          ]);
        }
      } catch (err) {
        setDisputeError((err as Error).message);
      } finally {
        setDisputeBusy(false);
      }
    },
    [conn, selected, toDisputeView, taskGraph],
  );

  /** TASK-C.18：右栏真正自由对话；去掉 ≤2 轮选择题门控。Supervisor 旁观更新中间方案。 */
  const handleJourneyBeforeSend = useCallback(
    async (text: string): Promise<"handled" | "passthrough"> => {
      if (!conn || !connected) return "passthrough";
      traceCtaClick("journey-send", {
        ...(selectedId ? { contractId: selectedId } : {}),
        detail: { text_len: text.trim().length },
      });
      const trimmed = text.trim();
      if (!trimmed) return "passthrough";

      // 随对话刷新方案（不锁用户进选择题）
      const nextCorpus = schemeCorpus
        ? `${schemeCorpus}
${trimmed}`
        : trimmed;
      setSchemeCorpus(nextCorpus);
      setSchemeDraft((cur) =>
        rebuildSchemeFromCorpus(cur, nextCorpus, {
          titleHint: trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed,
        }),
      );
      setStudioNonce((n) => n + 1);

      const looksDispute = /不对|质疑|有问题|bug|缺陷|验收失败/.test(
        trimmed.toLowerCase(),
      );
      if (!looksDispute) {
        // 自由聊：交给右侧 Agent；中间方案已更新
        return "passthrough";
      }

      // 质疑仍走旅程分流（不阻断后续自由聊）
      setJourneyBusy(true);
      try {
        const result = await submitJourneyMessage(conn, {
          message: trimmed,
          ...(selectedId ? { contract_id: selectedId } : {}),
        });
        const kind = result.route;
        if (kind === "CHAT") return "passthrough";
        const card: JourneyChatCard = {
          id: `journey-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          kind,
          text: result.plain_summary,
        };
        setJourneyCards((prev) => [...prev.slice(-19), card]);
        if (kind === "DISPUTE" && result.dispute_report) {
          setDisputeReport(toDisputeView(result.dispute_report));
          setDisputeError(null);
          setStudioNonce((n) => n + 1);
        }
        if (result.draft) {
          setDraft(result.draft);
          setShowForm(false);
        }
        return "handled";
      } catch (error) {
        const card: JourneyChatCard = {
          id: `journey-err-${Date.now()}`,
          kind: "SYSTEM",
          text:
            error instanceof Error
              ? `分流暂时不可用：${error.message}。已改走普通对话。`
              : "分流暂时不可用，已改走普通对话。",
        };
        setJourneyCards((prev) => [...prev.slice(-19), card]);
        return "passthrough";
      } finally {
        setJourneyBusy(false);
      }
    },
    [conn, connected, selectedId, toDisputeView, schemeCorpus],
  );

  const handleSchemeConfirmDecision = useCallback((decisionId: string) => {
    setSchemeDraft((cur) =>
      cur ? confirmSchemeDecision(cur, decisionId) : cur,
    );
  }, []);

  const handleSchemeResolveConflict = useCallback(
    (conflictId: string, optionId: string) => {
      setSchemeDraft((cur) =>
        cur ? resolveSchemeConflict(cur, conflictId, optionId) : cur,
      );
    },
    [],
  );

  const handleSchemeNotesChange = useCallback((notes: string) => {
    setSchemeDraft((cur) => (cur ? updateSchemeNotes(cur, notes) : cur));
  }, []);

  const handleGenerateSchemeDemo = useCallback(async () => {
    if (!conn || !schemeDraft) return;
    const generatedForRevision = schemeDraft.scheme_revision;
    setSchemeDemoBusy(true);
    setConfirmPrototypeError(null);
    setSchemeDemoGate({
      status: "building",
      scheme_revision: generatedForRevision,
      decision_revision: null,
      prototype_id: activePrototypeId,
    });
    try {
      const proto = await createSupervisorPrototype(conn, {
        title: schemeDraft.title.slice(0, 60) || "方案 Demo",
      });
      setActivePrototypeId(proto.prototype_id);
      setDemoConfirmed(false);
      if (proto.preview_url) {
        setRetainedDemoUrl(proto.preview_url);
        setDemoPreview({
          url: proto.preview_url,
          port: Number(new URL(proto.preview_url).port) || 4100,
          status: (proto.preview_status as "RUNNING") ?? "RUNNING",
          updated_at: new Date().toISOString(),
          ...(proto.message ? { message: proto.message } : {}),
        });
      }
      setSchemeDemoGate({
        status: "ready",
        scheme_revision: generatedForRevision,
        decision_revision: null,
        prototype_id: proto.prototype_id,
      });
      setJourneyCards((prev) => [
        ...prev.slice(-19),
        {
          id: `scheme-demo-${Date.now()}`,
          kind: "SYSTEM",
          text: `已按当前方案生成隔离 Demo（${proto.relative_root}）。请在中间方案区试玩并显式确认 Demo，再确认方案。`,
        },
      ]);
    } catch (err) {
      setSchemeDemoGate({
        status: "failed",
        scheme_revision: generatedForRevision,
        decision_revision: null,
        prototype_id: null,
      });
      setConfirmPrototypeError(
        err instanceof Error ? err.message : "Demo 生成失败",
      );
    } finally {
      setSchemeDemoBusy(false);
    }
  }, [conn, schemeDraft, activePrototypeId]);

  const handleConfirmSchemeDemo = useCallback(async () => {
    if (!conn || !schemeDraft || !activePrototypeId) return;
    const decisionRevision = schemeDraft.scheme_revision;
    setSchemeDemoBusy(true);
    setConfirmPrototypeError(null);
    try {
      await confirmSupervisorPrototype(conn, {
        prototype_id: activePrototypeId,
      });
      setDemoConfirmed(true);
      setSchemeDemoGate((current) => ({
        ...current,
        status: "ready",
        decision_revision: decisionRevision,
        prototype_id: activePrototypeId,
      }));
      setJourneyCards((prev) => [
        ...prev.slice(-19),
        {
          id: `scheme-demo-confirmed-${Date.now()}`,
          kind: "SYSTEM",
          text: "Demo 已对当前方案确认。现在可以点「确认方案」开工。",
        },
      ]);
    } catch (err) {
      setConfirmPrototypeError(
        err instanceof Error ? err.message : "Demo 确认失败",
      );
    } finally {
      setSchemeDemoBusy(false);
    }
  }, [conn, schemeDraft, activePrototypeId]);

  const handleAcceptDegradedDemo = useCallback(() => {
    if (!schemeDraft) return;
    const revision = schemeDraft.scheme_revision;
    setDemoConfirmed(true);
    setConfirmPrototypeError(null);
    setSchemeDemoGate({
      status: "degraded_flowcard",
      scheme_revision: revision,
      decision_revision: revision,
      prototype_id: activePrototypeId,
      risk_flags: ["NO_INTERACTIVE_DEMO"],
    });
    setJourneyCards((prev) => [
      ...prev.slice(-19),
      {
        id: `scheme-demo-degraded-${Date.now()}`,
        kind: "SYSTEM",
        text: "已接受仅用流程图/架构图说明开工。合同将带 NO_INTERACTIVE_DEMO 风险标记。",
      },
    ]);
  }, [schemeDraft, activePrototypeId]);

  /**
   * TASK-C.22 / SSOT v2.0.2 §5.2.1：「确认方案」= 五阶段原子事务。
   *
   * 顺序不可调整：静默右栏 → 在冻结修订上求值 → 快照 → 签署+备工 → 提交。
   * - 求值统一走 `evaluateSchemeConfirmation`（与 Daemon 同一谓词）；
   * - 快照后的任何失败都必须 `compensate`，不允许半签半开；
   * - 补偿失败保持右栏锁定并明确告知需人工处理，不假装成功。
   */
  const handleConfirmScheme = useCallback(async () => {
    if (!conn || !schemeDraft || schemeDraft.frozen || schemeConfirmBusy)
      return;
    setSchemeConfirmBusy(true);
    setConfirmPrototypeError(null);

    const expectedRevision = schemeDraft.scheme_revision;
    if (schemeConfirmIdRef.current?.revision !== expectedRevision) {
      schemeConfirmIdRef.current = {
        revision: expectedRevision,
        id: newSchemeConfirmationId(),
      };
    }
    const confirmationId = schemeConfirmIdRef.current.id;

    // J.5：范围须在点击前算好；不再走 formatSchemeAsIntent → submitJourneyMessage。
    const planForConfirm = scopePlan;
    if (
      !planForConfirm ||
      planForConfirm.scheme_revision !== expectedRevision
    ) {
      setConfirmPrototypeError("正在核对要改哪些地方…");
      setSchemeConfirmBusy(false);
      return;
    }

    /**
     * signAndPrepare 内部暂存，供 compensate 精确回收本次已建的合同。
     * 用对象而不是两个 let：签名在回调里赋值，TS 无法对 `let` 做跨闭包收窄，
     * 直接读会得到 `never`。
     */
    const staging: {
      contractId: string | null;
      target: SoftwareContract | null;
    } = { contractId: null, target: null };

    const result = await runConfirmSchemeAtomic({
      confirmationId,
      scheme: schemeDraft,
      demo: schemeDemoGate,
      expectedRevision,
      scopePlan: planForConfirm,

      // 1. 先停流式，再禁右栏；右栏一旦锁定就不再接受 Supervisor Patch。
      quiesceRightChat: async () => {
        await chatSession.stop();
        setSchemeChatLocked(true);
      },

      // 2. 不可变快照（幂等：同 id + 同内容返回原快照）；绑定当前 ScopePlan。
      persistSnapshot: async ({ confirmation_id, scheme, demo, decision }) => {
        try {
          const view = await freezeSchemeSnapshot(conn, {
            confirmation_id,
            scheme,
            demo,
            decision: {
              code: decision.code,
              message: decision.message,
              demo_mode: decision.demo_mode,
            },
            scope_plan: planForConfirm,
          });
          return {
            snapshot_id: view.snapshot_id,
            digest: view.digest,
            idempotent: view.idempotent,
          };
        } catch (err) {
          if (
            err instanceof DaemonApiError &&
            err.code === "E_SCOPE_PLAN_DRIFT"
          ) {
            const body = err.body as { scope_plan?: ScopePlan } | undefined;
            const drift = Object.assign(new Error(err.message), {
              code: "E_SCOPE_PLAN_DRIFT" as const,
              ...(body?.scope_plan ? { scope_plan: body.scope_plan } : {}),
            });
            throw drift;
          }
          throw err;
        }
      },

      // 3. 签署 + 施工准备：按 ScopePlan 投影建合同 → 批准 → 建任务图。
      signAndPrepare: async ({ confirmation_id, onContractCreated }) => {
        const fromPlan = buildConfirmContractFromScopePlan(
          schemeDraft,
          planForConfirm,
        );
        const created = await createContractWithAdmission(
          conn,
          softwareContractSchema.parse({
            ...fromPlan,
            lifecycle_state: "PENDING_APPROVAL",
            approval: { status: "PENDING_REVIEW" },
          }),
          { confirmationId: confirmation_id },
        );
        const saved = created.admission?.contract ?? created.contract;
        staging.contractId = saved.contract_id;
        // 合同一落库就回报事务：后面建任务图失败时，补偿拿得到要吊销的那一份
        onContractCreated?.(saved.contract_id);
        setContracts((prev) => [
          ...prev.filter((c) => c.contract_id !== saved.contract_id),
          saved,
        ]);
        setSelectedId(saved.contract_id);

        await approveContract(conn, saved.contract_id, "local-user", {
          confirmationId: confirmation_id,
        });
        const list = await listContracts(conn);
        setContracts(list);
        const approved =
          list.find((c) => c.contract_id === saved.contract_id) ?? saved;
        staging.target = approved;

        const graph = await createTaskGraph(
          conn,
          buildProposalFromContract(approved),
        );
        setTaskGraph(graph);
        setStudioNonce((n) => n + 1);
        setJourneyCards((prev) => [
          ...prev.slice(-19),
          {
            id: `scheme-confirmed-${Date.now()}`,
            kind: "SYSTEM",
            text: `方案已确认并冻结。「${approved.intent.title}」任务图已建（${graph.nodes.length} 节点），开始写代码。`,
          },
        ]);
        return { contract_id: saved.contract_id };
      },

      // 4. 补偿：终止本次已建合同（吊销 token、清 Worktree 由 Daemon 负责）。
      compensate: async ({ contract_id, cause }) => {
        const target = contract_id ?? staging.contractId;
        if (!target) return;
        await abortContract(conn, target, "local-user");
        setContracts((prev) => prev.filter((c) => c.contract_id !== target));
        setJourneyCards((prev) => [
          ...prev.slice(-19),
          {
            id: `scheme-compensated-${Date.now()}`,
            kind: "SYSTEM",
            text: `确认失败已回滚：${cause}`,
          },
        ]);
      },

      // 5. 只有成功提交才恢复右栏；失败保持锁定（已签署态不允许再聊改本轮）。
      //    例外：漂移等冻结前失败由事务内 restoreRightChat 解锁。
      restoreRightChat: () => setSchemeChatLocked(false),
    });

    if (!result.ok) {
      const compensationFailed = result.code === "E_COMPENSATION_FAILED";
      const drifted = result.code === "E_SCOPE_PLAN_DRIFT";
      if (drifted && result.scope_plan) {
        setScopePlan(result.scope_plan);
      }
      setConfirmPrototypeError(
        drifted
          ? "项目刚刚有变化，我重新核对了改动范围，请再看一眼"
          : (result.reason ?? "确认方案失败，请检查方案与 Demo 状态后重试。"),
      );
      setJourneyCards((prev) => [
        ...prev.slice(-19),
        {
          id: `scheme-confirm-failed-${Date.now()}`,
          kind: "SYSTEM",
          text: compensationFailed
            ? `确认在「${result.failedAt}」阶段失败且补偿未完成，右栏保持锁定，需人工处理：${result.reason ?? ""}`
            : drifted
              ? "项目刚刚有变化，我重新核对了改动范围，请再看一眼"
              : `确认未生效（${result.failedAt}）：${result.reason ?? "未知原因"}`,
        },
      ]);
      setSchemeConfirmBusy(false);
      return;
    }

    // COMMIT：方案冻结，右栏保持锁定——冻结后右栏的修改只会被静默丢弃。
    setSchemeDraft(result.frozen ?? freezeScheme(schemeDraft));
    setDemoConfirmed(true);
    setPlainContractVisible(false);
    if (result.idempotent) {
      setJourneyCards((prev) => [
        ...prev.slice(-19),
        {
          id: `scheme-confirm-replay-${Date.now()}`,
          kind: "SYSTEM",
          text: "这次确认与上一笔相同，已按幂等处理，未重复签署。",
        },
      ]);
    }

    const committed = staging.target;
    if (committed) {
      // 自动拉起 Worker：失败不回滚签署（合同已生效），只如实告知可重试。
      try {
        const worker = await runWorker(conn, committed.contract_id);
        setWorkerResult(worker);
      } catch (err) {
        setJourneyCards((prev) => [
          ...prev.slice(-19),
          {
            id: `scheme-worker-${Date.now()}`,
            kind: "SYSTEM",
            text:
              err instanceof Error
                ? `已确认方案；Worker 稍后可在状态就绪后重试：${err.message}`
                : "已确认方案；Worker 稍后可重试。",
          },
        ]);
      }
    }
    setSchemeConfirmBusy(false);
  }, [
    conn,
    schemeDraft,
    scopePlan,
    schemeDemoGate,
    schemeConfirmBusy,
    chatSession,
  ]);


  // C.18：选择题流程废弃；保留空实现避免旧引用崩（若有）
  const handleClarificationSelect = useCallback(
    (_questionId: string, _optionId: string) => {
      /* no-op: free chat */
    },
    [],
  );

  const handleStartRealPlaytest = useCallback(async () => {
    if (!conn) {
      setRealPlaytestError("还没连上工作台，请先一键重开。");
      setStudioViewportOverride("playtest");
      return;
    }
    // 无选中合同时仍可起试玩桩（空态文案承诺）；Daemon 接受任意 contract_id 写 stub。
    const playtestContractId = selectedId ?? "playtest-local-stub";
    setRealPlaytestBusy(true);
    setRealPlaytestError(null);
    try {
      const delivered = isDeliveredLifecycle(selected?.lifecycle_state);
      const preview = await startRealPlaytest(conn, {
        contract_id: playtestContractId,
        title: selected?.intent.title ?? "真机试玩",
        ...(delivered
          ? {
              // 合入后挂业务成品（本机 Vite 常见端口），不再只起白话桩
              attach_url: MERGED_PRODUCT_PREVIEW_URLS[0],
              stub: false,
            }
          : { stub: true }),
      });
      setRealPlaytest({
        contract_id: preview.contract_id,
        url: preview.url,
        port: preview.port,
        status: preview.status,
        owned: preview.owned,
        updated_at: preview.updated_at,
        ...(preview.message ? { message: preview.message } : {}),
      });
      setStudioViewportOverride("playtest");
      setJourneyCards((prev) => [
        ...prev.slice(-19),
        {
          id: `journey-playtest-${Date.now()}`,
          kind: "REAL_PLAYTEST",
          text: preview.plain_summary ?? `真机预览已就绪：${preview.url}`,
        },
      ]);
    } catch (err) {
      setRealPlaytestError(
        err instanceof Error ? err.message : "真机预览启动失败",
      );
    } finally {
      setRealPlaytestBusy(false);
    }
  }, [conn, selectedId, selected]);

  const handleStopRealPlaytest = useCallback(async () => {
    if (!conn) return;
    const playtestContractId =
      selectedId ?? realPlaytest?.contract_id ?? "playtest-local-stub";
    setRealPlaytestBusy(true);
    try {
      const preview = await stopRealPlaytest(conn, {
        contract_id: playtestContractId,
      });
      setRealPlaytest({
        contract_id: preview.contract_id,
        url: preview.url,
        port: preview.port,
        status: preview.status,
        owned: preview.owned,
        updated_at: preview.updated_at,
      });
    } catch (err) {
      setRealPlaytestError(
        err instanceof Error ? err.message : "停止真机预览失败",
      );
    } finally {
      setRealPlaytestBusy(false);
    }
  }, [conn, selectedId, realPlaytest]);

  /** TASK-C.11b：确认 Demo 感官对齐 → 展示白话合同卡（不立刻写真码） */
  const handleConfirmPrototype = useCallback(async () => {
    traceCtaClick("confirm-prototype", {
      ...(selectedId ? { contractId: selectedId } : {}),
    });
    if (!conn) {
      setConfirmPrototypeError("请先连接 Daemon。");
      return;
    }
    setConfirmPrototypeBusy(true);
    setConfirmPrototypeError(null);
    try {
      let pid = activePrototypeId;
      if (!pid) {
        const title =
          selected?.intent.title ?? draft?.contract.intent.title ?? "隔离 Demo";
        const proto = await createSupervisorPrototype(conn, { title });
        pid = proto.prototype_id;
        setActivePrototypeId(pid);
        if (proto.preview_url) {
          setRetainedDemoUrl(proto.preview_url);
          setDemoPreview({
            url: proto.preview_url,
            port: Number(new URL(proto.preview_url).port) || 4100,
            status: (proto.preview_status as "RUNNING") ?? "RUNNING",
            updated_at: new Date().toISOString(),
          });
        }
      }
      const confirmed = await confirmSupervisorPrototype(conn, {
        prototype_id: pid,
      });
      setDemoConfirmed(true);
      setPlainContractVisible(true);
      setStudioViewportOverride("contract");
      setJourneyCards((prev) => [
        ...prev.slice(-19),
        {
          id: `demo-confirmed-${Date.now()}`,
          kind: "SYSTEM",
          text: `Demo 已确认（${confirmed.relative_root}）。请审阅白话合同并一键授权；拒约将保留 Demo。`,
        },
      ]);
    } catch (error) {
      setConfirmPrototypeError(
        error instanceof Error ? error.message : "确认 Demo 失败",
      );
    } finally {
      setConfirmPrototypeBusy(false);
    }
  }, [conn, selectedId, selected, draft, activePrototypeId]);

  const plainAuthorizeView = useMemo(() => {
    const src = selected ?? draft?.contract ?? null;
    if (!src || !plainContractVisible) return null;
    const criteria = src.intent.acceptance_criteria ?? [];
    const writable =
      src.authorization?.file_system_scope?.writable_paths?.slice(0, 6) ??
      draft?.plan.writable_paths?.slice(0, 6) ??
      [];
    return {
      contract_id: src.contract_id ?? `draft-${draftVersion}`,
      title: src.intent.title,
      intent_summary: src.intent.description || src.intent.title,
      scope_summary:
        writable.length > 0
          ? `可改：${writable.join("、")}`
          : "范围将在授权后按草案锁定",
      acceptance_summary:
        criteria.length > 0
          ? criteria.slice(0, 4).join("；")
          : "按 Demo 主流程可走通即为验收",
      draft_version: `v${draftVersion}-draft`,
      demo_confirmed: demoConfirmed,
      lifecycle_hint: demoConfirmed
        ? "已确认 Demo · 等待授权"
        : "请先确认 Demo",
    };
  }, [selected, draft, plainContractVisible, draftVersion, demoConfirmed]);

  const handlePlainAuthorize = useCallback(async () => {
    if (!conn || !demoConfirmed) return;
    setAuthorizeBusy(true);
    setConfirmPrototypeError(null);
    try {
      // 与老板快路径一致：落盘须为 PENDING_APPROVAL。
      // 直接把 DRAFT 交给 approve 会 E_INVALID_STATE_TRANSITION。
      const asPendingApproval = (
        contract: SoftwareContract,
      ): SoftwareContract =>
        softwareContractSchema.parse({
          ...contract,
          lifecycle_state: "PENDING_APPROVAL",
          approval: { status: "PENDING_REVIEW" },
        });

      let contractId = selected?.contract_id;
      let target = selected;
      const needsPersist =
        (!contractId && draft?.contract) ||
        (target != null &&
          (target.lifecycle_state === "DRAFT" ||
            target.approval?.status === "DRAFT"));
      const source = needsPersist
        ? !contractId && draft?.contract
          ? draft.contract
          : target!
        : null;

      if (source) {
        const created = await createContractWithAdmission(
          conn,
          asPendingApproval(source),
        );
        const saved = created.admission?.contract ?? created.contract;
        contractId = saved.contract_id;
        target = saved;
        setContracts((prev) => {
          const without = prev.filter(
            (c) => c.contract_id !== saved.contract_id,
          );
          return [...without, saved];
        });
        setSelectedId(contractId);
      }
      if (!contractId) {
        setConfirmPrototypeError("没有可授权的合同或草案。");
        return;
      }

      // 创建时 admit 可能已自动批准；仅仍待审批时再显式签署
      let list = await listContracts(conn);
      setContracts(list);
      let approved = list.find((c) => c.contract_id === contractId) ?? target;
      if (approved?.lifecycle_state === "PENDING_APPROVAL") {
        await approveContract(conn, contractId, "local-user");
        list = await listContracts(conn);
        setContracts(list);
        approved = list.find((c) => c.contract_id === contractId) ?? approved;
      }
      target = approved ?? target ?? selected;
      if (target) {
        const proposal = buildProposalFromContract(target);
        const graph = await createTaskGraph(conn, proposal);
        setTaskGraph(graph);
        setStudioViewportOverride("graph");
        setStudioNonce((n) => n + 1);
        setJourneyCards((prev) => [
          ...prev.slice(-19),
          {
            id: `authorized-${Date.now()}`,
            kind: "SYSTEM",
            text: `已授权「${target.intent.title}」。任务图已建好（${graph.nodes.length} 节点），将随 Evidence 点亮——不会假绿。`,
          },
        ]);
      }
      setPlainContractVisible(false);
    } catch (error) {
      setConfirmPrototypeError(
        error instanceof Error ? error.message : "授权失败",
      );
    } finally {
      setAuthorizeBusy(false);
    }
  }, [conn, demoConfirmed, selected, draft]);

  const handlePlainReject = useCallback(() => {
    setDraftVersion((v) => v + 1);
    setPlainContractVisible(true);
    setJourneyCards((prev) => [
      ...prev.slice(-19),
      {
        id: `reject-${Date.now()}`,
        kind: "SYSTEM",
        text: `已拒绝本版合同（草案升为 v${draftVersion + 1}-draft）。Demo 仍保留可继续试玩；改完细节后再授权。`,
      },
    ]);
    if (retainedDemoUrl) {
      setStudioViewportOverride("demo");
    }
  }, [draftVersion, retainedDemoUrl]);

  const handlePlainRevise = useCallback(() => {
    setShowForm(true);
    setStudioViewportOverride("contract");
    setDraftVersion((v) => v + 1);
    setJourneyCards((prev) => [
      ...prev.slice(-19),
      {
        id: `revise-${Date.now()}`,
        kind: "SYSTEM",
        text: "可以改合同细节。Demo 默认保留；大改流程时再重做原型。",
      },
    ]);
  }, []);

  // C.3：Agent 改完文件 → 中栏自动打开并刷新（Sprint 1 门禁「中栏实时可见」）
  const [openRequest, setOpenRequest] = useState<{
    path: string;
    nonce: number;
  } | null>(null);
  const [reloadKeys, setReloadKeys] = useState<Record<string, number>>({});
  const pendingEdits = useRef(new Map<string, string>());
  const [staleContracts, setStaleContracts] = useState<Set<string>>(new Set());
  const toRepoRelative = useCallback(
    (p: string) => {
      if (repoRoot && p.startsWith(repoRoot + "/"))
        return p.slice(repoRoot.length + 1);
      const wt = p.match(/\/\.stagent\/worktrees\/task-[^/]+\/(.+)$/);
      return wt?.[1] ?? p.replace(/^\.\//, "");
    },
    [repoRoot],
  );
  const onAgentFileEvent = useCallback(
    (e: ChatEvent) => {
      if (e.kind === "tool_call" && /^(Edit|Write|MultiEdit)$/.test(e.name)) {
        const fp = (e.input as { file_path?: unknown } | null)?.file_path;
        if (typeof fp === "string") pendingEdits.current.set(e.tool_id, fp);
      }
      if (e.kind === "tool_result") {
        const fp = pendingEdits.current.get(e.tool_id);
        pendingEdits.current.delete(e.tool_id);
        if (!fp || e.is_error) return;
        const rel = toRepoRelative(fp);
        setReloadKeys((k) => ({ ...k, [rel]: (k[rel] ?? 0) + 1 }));
        setOpenRequest({ path: rel, nonce: Date.now() });
      }
    },
    [toRepoRelative],
  );

  // 编辑器 IO 必须稳定（否则每次渲染都会重新读文件）
  const fileIoFor = useMemo(() => {
    const cache = new Map<string, WorktreeFileIO>();
    return (contractId: string | null): WorktreeFileIO | null => {
      if (!connected) return null;
      const key = contractId ?? "";
      let io = cache.get(key);
      if (!io) {
        io = {
          read: (fp) => readWorktreeFile(conn, fp, contractId),
          save: (fp, content) =>
            saveWorktreeFile(conn, fp, content, contractId),
        };
        cache.set(key, io);
      }
      return io;
    };
  }, [connected, conn]);

  // 实时流（WebSocket）：状态/日志/告警由 Daemon 推送，轮询退化为兜底
  const stream = useDaemonStream({
    port: daemonPort,
    token: conn.token,
    baseUrl: conn.baseUrl,
    enabled: connected,
    onContractUpdate: (_p: ContractUpdatePayload) => {
      void refresh();
    },
    onChatEvent: (e: ChatEvent) => {
      onAgentFileEvent(e);
      for (const l of chatListeners.current) l(e);
    },
    onEvidenceStatus: (p) => {
      setStaleContracts((prev) => {
        const next = new Set(prev);
        if (p.status === "STALE") next.add(p.contract_id);
        else next.delete(p.contract_id);
        return next;
      });
    },
    onEvidenceReady: (p: EvidenceReadyPayload) => {
      if (p.contract_id !== selectedId) return;
      void fetchEvidence(conn, p.contract_id, p.evidence_id)
        .then(setEvidence)
        .catch(() => {
          // 证据拉取失败不阻断：用户仍可手动执行验证
        });
    },
    onTaskGraphUpdate: (p: TaskGraphUpdatedPayload) => {
      // 帧按合同隔离：正在看 B 时收到 A 的快照，不覆盖当前视图
      if (selectedId !== null && p.contract_id !== selectedId) return;
      setTaskGraph((prev) => applyTaskGraphFrame(prev, p));
      setTaskGraphError(null);
      setTaskGraphLoading(false);
    },
    onBaselineProgress: (p: BaselineProgressPayload) => {
      // TASK-C.14f：WS 覆盖基线；保留 GET 首屏与手动重扫
      setBaselinePayload({
        archive: (p.archive as BaselineArchivePayload["archive"]) ?? null,
        scanning: p.scanning,
        accept_label: p.accept_label ?? "认可此基线作为后续参考",
        grants_construction: false,
      });
    },
    onStateChanged: (p: StateChangedPayload) => {
      const state = p.presentation_state;
      if (!(PRESENTATION_STATES as readonly string[]).includes(state)) {
        return;
      }
      setPresentationByContract((prev) => ({
        ...prev,
        [p.contract_id]: {
          state: state as PresentationState,
          message: p.message?.trim() || "",
        },
      }));
    },
    onDemoPreviewStatus: (p: DemoPreviewStatusPayload) => {
      setDemoPreview(p);
    },
    onRealPlaytestStatus: (p: RealPlaytestStatusPayload) => {
      setRealPlaytest(p);
      if (p.status === "RUNNING") {
        setRealPlaytestError(null);
      }
      if (p.status === "ERROR") {
        setRealPlaytestError(p.message ?? "真机预览启动失败");
      }
    },
    onDisputeReportReady: (p) => {
      // 完整报告仍以 HTTP 响应为准；这里只在切合同后避免错挂摘要
      if (selectedId !== null && p.contract_id !== selectedId) return;
    },
  });

  const selectedLogs = useMemo(
    () => stream.logs.filter((l) => l.contractId === selectedId),
    [stream.logs, selectedId],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // WebSocket 已连接时轮询只是兜底，降到 60s；未连接时 15s 保持可用
  useEffect(() => {
    const interval = stream.status === "connected" ? 60_000 : 15_000;
    const timer = setInterval(() => {
      // 页面隐藏时不发起任何后台刷新（含 protection），避免空转
      if (document.hidden) return;
      void refresh();
    }, interval);
    return () => clearInterval(timer);
  }, [refresh, stream.status]);

  // 缺口 4.4：有活跃合同/待审批时 3s，否则 60s；隐藏页暂停、回前台补偿一次
  const hasActiveWork =
    (protection?.round.pending.length ?? 0) > 0 ||
    contracts.some((contract) =>
      ["PREPARING", "EXECUTING", "VERIFYING", "PENDING_RESUME"].includes(
        contract.lifecycle_state,
      ),
    );

  useEffect(() => {
    if (!connected) return;
    const poller = createProtectionPoller({
      fetchProtection: async () => {
        setProtection(await fetchProtection(conn));
      },
      hasActiveWork: () => hasActiveWork,
    });
    poller.start();
    return () => poller.stop();
  }, [connected, conn, hasActiveWork]);

  // 选中已验收合同时自动恢复 Evidence：否则刷新页面后结论与「核销」按钮都消失
  useEffect(() => {
    if (!selectedId || selected?.lifecycle_state !== "AUDITED") return;
    let cancelled = false;
    void fetchEvidence(conn, selectedId)
      .then((restored) => {
        if (!cancelled) setEvidence(restored);
      })
      .catch(() => {
        // 无落盘证据时保持空态，用户仍可重新执行验证
      });
    return () => {
      cancelled = true;
    };
  }, [conn, selectedId, selected?.lifecycle_state]);

  // 缺口 4.2：建连不再自动拉取架构图；仅在用户显式点击时按需加载。
  // 设置读取与架构图解耦，避免一次建连触发全仓 AST 计算。
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    void (async () => {
      try {
        const modelSettings = await fetchSettings(conn);
        if (!cancelled) setSettings(modelSettings);
      } catch {
        // 设置读取失败不阻断主流程
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connected, conn]);

  const loadArchGraph = useCallback(async () => {
    try {
      const payload = await fetchArchGraph(conn);
      setGraph(payload);
    } catch {
      // 架构图失败不阻断主流程
    }
  }, [conn]);

  /** C.10f：轻量文件树（无 AST）；建连即拉，供资源管理器展示 */
  const loadRepoTree = useCallback(async () => {
    setFilesLoading(true);
    try {
      const payload = await fetchRepoTree(conn);
      setRepoPaths(payload.files);
    } catch {
      // 列表失败不阻断主流程；保留上一份树
    } finally {
      setFilesLoading(false);
    }
  }, [conn]);

  useEffect(() => {
    if (!connected) return;
    void loadRepoTree();
  }, [connected, loadRepoTree]);

  /**
   * 拉取 Task Graph 权威快照。切合同立即重拉：图谱属于合同，
   * 把 A 的图挂在 B 的页面上比空态更危险。
   */
  const loadTaskGraph = useCallback(
    async (contractId?: string) => {
      setTaskGraphLoading(true);
      setTaskGraphError(null);
      try {
        setTaskGraph(await fetchTaskGraph(conn, contractId));
      } catch (err) {
        setTaskGraphError((err as Error).message);
      } finally {
        setTaskGraphLoading(false);
      }
    },
    [conn],
  );

  // 合同切换/首次连上时拉一次图谱；后续靠 TASK_GRAPH_UPDATED 帧
  useEffect(() => {
    if (!connected) return;
    void loadTaskGraph(selectedId ?? undefined);
  }, [connected, loadTaskGraph, selectedId]);

  /**
   * 刷新后恢复真机试玩：Daemon 可能仍在跑（status API），但内存态丢了会空屏。
   * 已合入合同优先挂业务成品 URL，避免只显示签署前的白话桩。
   *
   * 依赖只取真正用到的两个原语（生命周期 / 标题），而不是整个 `selected`：
   * 把对象塞进依赖会让任何字段变化都重启一次试玩进程。
   */
  const selectedLifecycle = selected?.lifecycle_state;
  const selectedTitle = selected?.intent.title ?? "";
  useEffect(() => {
    if (!connected || !conn || !selectedId || !selectedLifecycle) return;
    let cancelled = false;
    void (async () => {
      const delivered = isDeliveredLifecycle(selectedLifecycle);
      if (delivered) {
        try {
          const preview = await startRealPlaytest(conn, {
            contract_id: selectedId,
            attach_url: MERGED_PRODUCT_PREVIEW_URLS[0],
            stub: false,
            title: selectedTitle,
          });
          if (cancelled) return;
          setRealPlaytest({
            contract_id: preview.contract_id,
            url: preview.url,
            port: preview.port,
            status: preview.status,
            owned: preview.owned,
            updated_at: preview.updated_at,
            ...(preview.message ? { message: preview.message } : {}),
          });
          setRealPlaytestError(null);
          return;
        } catch (err) {
          if (!cancelled) {
            setRealPlaytestError(
              err instanceof Error
                ? err.message
                : "合入成品预览挂载失败；可点启动或直接打开本机 Vite 地址",
            );
          }
        }
      }
      try {
        const status = await getRealPlaytestStatus(conn, selectedId);
        if (cancelled) return;
        if (status.status === "RUNNING" && status.url) {
          setRealPlaytest({
            contract_id: status.contract_id,
            url: status.url,
            port: status.port,
            status: status.status,
            owned: status.owned,
            updated_at: status.updated_at,
            ...(status.message ? { message: status.message } : {}),
          });
          setRealPlaytestError(null);
        }
      } catch {
        // status 缺失不阻断；用户仍可手动启动
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connected, conn, selectedId, selectedLifecycle, selectedTitle]);

  const loadBaseline = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!connected || !conn) return;
      // 首屏/无档案时立刻亮基线卡（scanning），避免只剩旧「还没有可展示的项目摘要」空态
      if (!opts?.quiet) {
        setBaselinePayload((prev) =>
          prev?.archive
            ? prev
            : {
                archive: null,
                scanning: true,
                accept_label: "认可此基线作为后续参考",
                grants_construction: false,
              },
        );
      }
      try {
        const payload = await fetchBaselineArchive(conn);
        setBaselinePayload(payload);
      } catch {
        // 基线失败不挡主界面；保留 scanning 占位或上一份
        setBaselinePayload((prev) =>
          prev?.archive
            ? { ...prev, scanning: false }
            : {
                archive: null,
                scanning: false,
                accept_label: "认可此基线作为后续参考",
                grants_construction: false,
              },
        );
      }
    },
    [connected, conn],
  );

  // TASK-C.14f：首屏 GET 一次；后续由 BASELINE_PROGRESS WS 覆盖（不再 2s 轮询）
  useEffect(() => {
    if (!connected) return;
    void loadBaseline();
  }, [connected, loadBaseline]);

  const handleAcceptBaseline = useCallback(async () => {
    if (!conn) return;
    setBaselineBusy(true);
    try {
      const res = await acceptBaselineArchive(
        conn,
        baselinePayload?.archive?.scan_id,
      );
      setBaselinePayload((prev) =>
        prev
          ? {
              ...prev,
              archive: res.archive,
              scanning: false,
              grants_construction: false,
            }
          : {
              archive: res.archive,
              scanning: false,
              accept_label: "认可此基线作为后续参考",
              grants_construction: false,
            },
      );
    } catch {
      // ignore
    } finally {
      setBaselineBusy(false);
    }
  }, [conn, baselinePayload?.archive?.scan_id]);

  const handleRescanBaseline = useCallback(async () => {
    if (!conn) return;
    setBaselineBusy(true);
    try {
      const payload = await rescanBaselineArchive(conn);
      setBaselinePayload(payload);
    } catch {
      // ignore
    } finally {
      setBaselineBusy(false);
    }
  }, [conn]);

  /** C.10o：PENDING→RUNNING（按依赖；Daemon startNode 校验前置已点亮） */
  const handleStartGraphNode = useCallback(
    async (nodeId: string) => {
      setGraphActionBusy(true);
      setTaskGraphError(null);
      setConfirmPrototypeError(null);
      try {
        const graph = await startTaskGraphNode(conn, nodeId);
        setTaskGraph(graph);
      } catch (err) {
        setTaskGraphError((err as Error).message);
      } finally {
        setGraphActionBusy(false);
      }
    },
    [conn],
  );

  /**
   * C.10o：提交核销 → Daemon 现算写入/Scope/SHA，再判定点亮。
   * COMMAND、SYNTAX_CHECK 与 IMPLICIT_SIDE_EFFECT 的退出码暂为声明性证据，
   * 真实采集归 OP-32；MANUAL 必须经 UI 单独明确确认（OP-27）。
   */
  const handleVerifyGraphNode = useCallback(
    async (nodeId: string) => {
      setGraphActionBusy(true);
      setTaskGraphError(null);
      setConfirmPrototypeError(null);
      try {
        const node = taskGraph?.nodes.find((item) => item.node_id === nodeId);
        if (!node) {
          setTaskGraphError(`图中不存在节点 ${nodeId}`);
          return;
        }
        // MANUAL 节点必须经过独立的 UI 明确确认；取消时完全不提交 verify。
        const manualApproved =
          node.verification_mode === "MANUAL"
            ? window.confirm(`确认已完成此人工检查：${node.title}？`)
            : false;
        if (node.verification_mode === "MANUAL" && !manualApproved) return;

        // OP-32-A：前端只传 node_id，实采命令退出码由 Daemon 在 Worktree 执行；
        // MANUAL 节点保留 manual_approved 显式点击标记。
        const response = await verifyTaskGraphNode(conn, {
          node_id: nodeId,
          ...(manualApproved
            ? {
                manual_approved: true,
                manual_approved_source: "ui_click" as const,
              }
            : {}),
        });
        setTaskGraph(response.graph);
        if (!response.illuminated) {
          const detail = [response.code, response.message]
            .filter((part): part is string => Boolean(part && part.trim()))
            .join(" · ");
          setTaskGraphError(
            detail ||
              "核销未点亮：还缺物理证据（受控写入 / 验证通过 / Commit SHA）",
          );
        }
      } catch (err) {
        setTaskGraphError((err as Error).message);
      } finally {
        setGraphActionBusy(false);
      }
    },
    [conn, taskGraph],
  );

  /**
   * 文件树跟随真实变更：Task Graph 更新 → 重拉轻量目录树。
   * 若用户已打开过架构图，顺带刷新 AST 图（不自动首次拉取，避免缺口 4.2 回潮）。
   * `lastTreeSync` 防止刷新循环。
   */
  const lastTreeSync = useRef<string | null>(null);
  useEffect(() => {
    if (!connected || !taskGraph) return;
    if (lastTreeSync.current === taskGraph.updated_at) return;
    lastTreeSync.current = taskGraph.updated_at;
    void loadRepoTree();
    if (graph) void loadArchGraph();
  }, [connected, taskGraph, graph, loadRepoTree, loadArchGraph]);

  const runAction = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /**
   * C.2：只有"确实需要人看"的裁决才进状态。
   * 无交集（AUTO_APPROVED）与已推进（SKIPPED）一律置 null，
   * 于是 `ProtectionConfirmCard` 结构性不渲染——这就是"0 弹窗"的实现方式。
   */
  const applyAdmission = (next: AdmissionView | null) => {
    setAdmission(shouldConfirmAdmission(next) ? next : null);
  };

  /** 点「同意」：先记本轮放行（这张卡上的文件），再请求 Daemon 重跑准入裁决 */
  const onApproveAdmission = (view: AdmissionView) => {
    void runAction("admit", async () => {
      if (view.cardId) {
        await decideProtectionCard(conn, view.cardId, "approve");
      }
      const next = await admitContract(conn, view.contract.contract_id);
      applyAdmission(next);
    });
  };

  /** 点「不同意」：记拒绝并直接中止合同——"坚决取消"，不留半开状态 */
  const onDenyAdmission = (view: AdmissionView) => {
    void runAction("deny-admission", async () => {
      if (view.cardId) {
        await decideProtectionCard(conn, view.cardId, "deny");
      }
      await abortContract(
        conn,
        view.contract.contract_id,
        "local-user",
        "用户在保护确认卡上选择「不同意」",
      );
      applyAdmission(null);
    });
  };

  const repoName = repoRoot
    ? (repoRoot.split("/").filter(Boolean).pop() ?? "stagent")
    : "stagent";
  const workspaceContract: ActiveContract | null = selected
    ? {
        contractId: selected.contract_id,
        worktreePath: `${repoRoot ?? "."}/.stagent/worktrees/task-${selected.contract_id}`,
        approved: APPROVED_STATES.has(selected.lifecycle_state),
        status: toExecutionStatus(selected.lifecycle_state),
      }
    : null;

  /**
   * 提意图 → 草案：只调 `POST /api/supervisor/draft`（Zero-Tool 只读），
   * 不创建合同、不写入 `.stagent/contracts`。显式 `enrich:true`；若 Daemon
   * 未配置 L1 则回退纯 L0。其它失败（402 预算耗尽 / 502 上游错误）由
   * `runAction` 落到页面 error 条。
   */
  const requestDraft = (intent: string) => {
    void runAction("draft", async () => {
      // 显式要 L1；若 Daemon 未注入补全器（409），回退纯 L0，不静默吞错以外的失败。
      let outcome: SupervisorDraftResponse;
      try {
        outcome = await generateSupervisorDraft(conn, {
          intent,
          context_paths: scopeDraft,
          enrich: true,
        });
      } catch (err) {
        if (
          err instanceof DaemonApiError &&
          err.status === 409 &&
          err.message === "ENRICH_NOT_CONFIGURED"
        ) {
          outcome = await generateSupervisorDraft(conn, {
            intent,
            context_paths: scopeDraft,
          });
        } else {
          throw err;
        }
      }
      setDraft(outcome.draft);
    });
  };

  /**
   * Supervisor Tab 的视图数据：只做字段搬运，不做推断。
   * 合同里没有的东西（健康度 / 成熟度 / 风险分 / 用例通过率）这里一律不补。
   *
   * 草案优先于选中合同：草案代表"刚刚这个意图"的最新推导结果；
   * 用户点左侧合同列表时会清掉 draft，因此两者不会互相遮挡。
   */
  const supervisorContract = draft
    ? toSupervisorContractView(draft.contract, { isDraft: true })
    : selected
      ? toSupervisorContractView(selected)
      : null;

  /** TASK-C.8b：小事默认老板三步；大事仍走完整合同台（只看合同风险/态，不改准入） */
  const bossSourceContract = draft?.contract ?? selected ?? null;
  const bossMode = isBossFastPathPresentation(bossSourceContract);
  const bossSummary =
    bossMode && bossSourceContract
      ? buildBossFastPathSummary({
          title: bossSourceContract.intent.title,
          writablePaths:
            draft?.plan.writable_paths ??
            bossSourceContract.authorization.file_system_scope.writable_paths,
          needsProtectionApproval:
            draft?.plan.needs_protection_approval === true ||
            admission?.decision === "NEEDS_APPROVAL",
          protectedEntryNames:
            draft?.plan.protected_entry_names ?? admission?.entryNames ?? [],
          protectedFiles:
            draft?.plan.protected_files ?? admission?.protectedFiles ?? [],
        })
      : null;

  const confirmBossFastPath = () => {
    if (draft) {
      const built = softwareContractSchema.parse({
        ...draft.contract,
        lifecycle_state: "PENDING_APPROVAL",
        approval: { status: "PENDING_REVIEW" },
        intent: {
          ...draft.contract.intent,
          risk_level: "LOW",
        },
      });
      void runAction("create", async () => {
        const saved = await createContractWithAdmission(conn, built);
        setSelectedId(saved.contract.contract_id);
        setShowForm(false);
        setDraft(null);
        applyAdmission(saved.admission);
      });
      return;
    }
    if (selected && selected.lifecycle_state === "PENDING_APPROVAL") {
      void runAction("approve", async () => {
        await approveContract(conn, selected.contract_id, "local-user");
      });
    }
  };

  const renderEngineerContractDesk = () => (
    <>
      <SupervisorStudioPane
        runMode={
          protection && protection.mode !== "VIBE" ? "PROTECTED" : "VIBE"
        }
        protectedEntries={protection?.entries ?? []}
        draft={
          draft
            ? // 未提交草案优先：`toStudioDraft` 读的就是 `supervisor_metadata`，
              // 所以白话理由 / 未决问题在这里同样不再是「（无）」
              toStudioDraft(draft.contract)
            : selected
              ? toStudioDraft(selected)
              : null
        }
        execution={
          selected
            ? {
                contractId: selected.contract_id,
                status: toExecutionStatus(selected.lifecycle_state),
                workerControl: selected.worker_spec.control_mode,
              }
            : null
        }
        busy={busy !== null || protectionBusy}
        onEmergencyPause={() => {
          if (!selected) return;
          void runAction("abort", async () => {
            await abortContract(
              conn,
              selected.contract_id,
              "local-user",
              "Studio 紧急暂停",
            );
            setAdmission(null);
          });
        }}
        onUnlockEntry={(id) => void onUnlockProtection(id)}
      />
      {showForm && (
        <ContractForm
          busy={busy === "create"}
          initialPaths={scopeDraft}
          draft={draft}
          draftBusy={busy === "draft"}
          onRequestDraft={requestDraft}
          onCreate={(contract) =>
            runAction("create", async () => {
              const saved = await createContractWithAdmission(conn, contract);
              setSelectedId(saved.contract.contract_id);
              setShowForm(false);
              // 草案已落盘成合同：清掉内存草案，避免与真实合同双份显示
              setDraft(null);
              applyAdmission(saved.admission);
            })
          }
        />
      )}

      {!selected ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          到「合同操作台」左侧点开需求（合同）查看详情；若本仓库只有一份合入合同，刷新后会自动选中。也可在雷达中圈选文件后新建合同
        </div>
      ) : (
        <div className="space-y-4 p-4">
          <ContractCard
            contract={selected}
            busy={busy === "approve"}
            onApprove={(id) =>
              void runAction("approve", async () => {
                await approveContract(conn, id, "local-user");
              })
            }
          />

          <div className="grid gap-3 md:grid-cols-2">
            <ScopeList scope={selected.authorization.file_system_scope} />
            <BudgetVisualizer
              costLimits={selected.authorization.cost_limits}
              budgetLimits={selected.authorization.budget_limits}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              disabled={
                busy !== null || selected.lifecycle_state !== "EXECUTING"
              }
              onClick={() =>
                runAction("worker", async () => {
                  const result = await runWorker(conn, selected.contract_id);
                  setWorkerResult(result);
                })
              }
              className="flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-40"
            >
              {busy === "worker" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5" />
              )}
              运行 Worker
            </button>
            <button
              disabled={
                busy !== null || selected.lifecycle_state !== "EXECUTING"
              }
              onClick={() =>
                runAction("execute", async () => {
                  const outcome = await executeContract(
                    conn,
                    selected.contract_id,
                  );
                  setEvidence(outcome.evidence);
                })
              }
              className="flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-40"
            >
              {busy === "execute" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              执行验证
            </button>
            <button
              disabled={
                busy !== null || selected.lifecycle_state !== "PENDING_RESUME"
              }
              onClick={() =>
                void runAction("resume", async () => {
                  await resumeContract(conn, selected.contract_id);
                })
              }
              className="flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-40"
            >
              {busy === "resume" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              恢复执行
            </button>
            <button
              disabled={
                busy !== null ||
                selected.lifecycle_state === "MERGED" ||
                selected.lifecycle_state === "ABORTED"
              }
              onClick={() => {
                const confirmed = window.confirm(
                  `确认中止合同 ${selected.contract_id}？\n` +
                    "在途进程将被强杀，Worktree 与任务分支会被清理，合同进入终态 ABORTED，不可撤销。",
                );
                if (!confirmed) return;
                void runAction("abort", async () => {
                  await abortContract(conn, selected.contract_id, "local-user");
                  setEvidence(null);
                });
              }}
              className="flex items-center gap-1 rounded border border-destructive/50 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-40"
            >
              {busy === "abort" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <XCircle className="h-3.5 w-3.5" />
              )}
              {selected.lifecycle_state === "PENDING_APPROVAL"
                ? "驳回合同"
                : "中止任务"}
            </button>
            <button
              onClick={() =>
                void runAction("diff", async () => {
                  const [patch, files] = await Promise.all([
                    fetchDiff(conn, selected.contract_id),
                    fetchDiffFiles(conn, selected.contract_id).catch(
                      () => null,
                    ),
                  ]);
                  setDiff(patch);
                  setDiffFiles(files);
                })
              }
              className="flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs hover:bg-accent"
            >
              <GitCompare className="h-3.5 w-3.5" /> 查看 Diff
            </button>
            <EditorOpener conn={conn} contractId={selected.contract_id} />
            {busy && (
              <span className="text-[10px] text-muted-foreground">
                正在{busy}…
              </span>
            )}
          </div>

          {workerResult && (
            <section className="rounded border border-border bg-card p-3">
              <h3 className="text-sm font-semibold">Worker 执行记录</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                应用 {workerResult.changes.length} 个文件 · tokens{" "}
                {workerResult.usage.inputTokens}↑ /{" "}
                {workerResult.usage.outputTokens}↓
              </p>
              <ul className="mt-2 space-y-0.5 text-[11px]">
                {workerResult.log.map((line) => (
                  <li key={line} className="text-chart-2">
                    {line}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {selectedLogs.length > 0 && (
            <section
              data-testid="live-log"
              className="rounded border border-border bg-card p-3"
            >
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">实时日志</h3>
                <span className="text-[10px] text-muted-foreground">
                  {selectedLogs.length} 行 · WebSocket 推送（保留最近 500 行）
                </span>
                <button
                  onClick={stream.clearLogs}
                  className="ml-auto text-[10px] text-muted-foreground hover:text-foreground"
                >
                  清空
                </button>
              </div>
              <pre className="mt-2 max-h-48 overflow-auto rounded bg-black/80 p-2 text-[10px] leading-relaxed text-zinc-300">
                {selectedLogs.map((line, i) => (
                  <div key={`${line.at}-${i}`}>
                    <span className="text-zinc-500">
                      {line.at.slice(11, 19)}{" "}
                    </span>
                    {line.line}
                  </div>
                ))}
              </pre>
            </section>
          )}

          {diff && (
            <DiffViewer
              patch={diff.patch}
              files={diffFiles?.files}
              truncatedList={diffFiles?.truncatedList}
            />
          )}
          {selected && (
            <StructuredTerminal
              lines={stream.terminal
                .filter((t) => t.contractId === selected.contract_id)
                .map((t) => ({
                  stream: t.stream,
                  line: t.line,
                  at: t.at,
                }))}
            />
          )}
          {evidence && (
            <>
              <EvidenceChecklist
                evidence={evidence}
                busy={busy === "merge"}
                onMerge={() =>
                  void runAction("merge", async () => {
                    const result = await mergeContract(
                      conn,
                      selected.contract_id,
                      evidence.evidence_id,
                      "local-user",
                    );
                    setMergeInfo(
                      result.nothingToMerge
                        ? (result.message ??
                            "本轮改动与你的修改冲突，已全部以你为准")
                        : `已合并 ${result.commitSha.slice(0, 8)} · worktree ${
                            result.worktreeRemoved ? "已清理" : "保留"
                          }${
                            result.conflictResolution === "USER_FIRST_DISCARD"
                              ? " · 有冲突：已保留你的版本，AI 需基于最新代码重做冲突部分"
                              : ""
                          }`,
                    );
                  })
                }
              />
              {mergeInfo && (
                <div className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-700">
                  {mergeInfo}
                </div>
              )}
              <EvidenceView evidence={evidence} />
            </>
          )}
        </div>
      )}
    </>
  );

  // TASK-C.9a：三态单一指挥面（无钥匙 / 有钥匙空闲 / 进行中）
  // TASK-C.11d：越界告警 → 挂起弹窗（扩权 / 回滚）
  useEffect(() => {
    const hit = stream.alerts.find((a) =>
      /OUT_OF_SCOPE|FORBIDDEN|GATEWAY_VIOLATION|SCOPE/i.test(a.code),
    );
    if (!hit) return;
    setScopePaused({
      contract_id: hit.contractId,
      code: hit.code,
      message: hit.message,
      ...(hit.path ? { attempted_path: hit.path } : {}),
    });
  }, [stream.alerts]);

  const needsProtectionConfirm =
    admission != null && shouldConfirmAdmission(admission);
  // C.10a：进行中只跟忙碌/确认/三步台；历史 journeyCards 不粘住 in_progress
  const activeProgress = {
    journeyBusy,
    bossMode,
    needsProtectionConfirm,
    confirmPrototypeBusy,
  };
  const commandSurface = resolveCommandSurface({
    hasSession: connected,
    keyReady: settings?.configured === true,
    inProgress: resolveActiveInProgress(activeProgress),
    inProgressCta: resolveInProgressCta(activeProgress),
  });

  return (
    <div className="flex h-screen flex-col bg-background text-sm text-foreground">
      <>
        <ScopePausedDialog
          view={scopePaused}
          busy={scopePausedBusy}
          onExpandScope={() => {
            setScopePausedBusy(true);
            setJourneyCards((prev) => [
              ...prev.slice(-19),
              {
                id: `scope-expand-${Date.now()}`,
                kind: "SYSTEM",
                text: "已记录扩权意向。请在白话合同里改 Scope 后重签；本轮仍保持暂停，不会静默放行。",
              },
            ]);
            setScopePaused(null);
            setScopePausedBusy(false);
            setPlainContractVisible(true);
            setStudioViewportOverride("contract");
          }}
          onRollback={() => {
            setScopePausedBusy(true);
            setJourneyCards((prev) => [
              ...prev.slice(-19),
              {
                id: `scope-rollback-${Date.now()}`,
                kind: "SYSTEM",
                text: "已选择回滚本轮越界改动。任务保持暂停，可重新确认范围后再开工。",
              },
            ]);
            setScopePaused(null);
            setScopePausedBusy(false);
          }}
          onDismiss={() => setScopePaused(null)}
        />
        <WorkspaceLayout
          repoName={repoName}
          repoPath={repoRoot ?? "（连接 Daemon 后显示仓库路径）"}
          baseBranch={currentBranch}
          runMode={
            protection && protection.mode !== "VIBE" ? "PROTECTED" : "VIBE"
          }
          contract={workspaceContract}
          protectedCount={protection?.entries.length ?? 0}
          files={fileTree}
          filesLoading={filesLoading}
          onDeletePath={async (relPath) => {
            await deleteRepoPath(conn, relPath);
            await loadRepoTree();
          }}
          onCreatePath={async ({ parent, name, kind }) => {
            const r = await createRepoPath(conn, { parent, name, kind });
            await loadRepoTree();
            return r.path;
          }}
          onRenamePath={async ({ from, to }) => {
            await renameRepoPath(conn, { from, to });
            await loadRepoTree();
          }}
          onRevealPath={async (relPath) => {
            await revealRepoPath(conn, relPath);
          }}
          confirmSlot={
            // C.2：至多一张白话是/否卡；无交集时 applyAdmission 已置 null，此处不渲染
            <ProtectionConfirmCard
              admission={admission}
              busy={busy === "admit" || busy === "deny-admission"}
              onApprove={onApproveAdmission}
              onDeny={onDenyAdmission}
            />
          }
          rightPanel={
            // C.18：右栏真正自由对话；授权入口收敛到中间「确认方案」
            <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
              <AgentChatPane
                transport={chatTransport}
                session={chatSession}
                onBeforeSend={handleJourneyBeforeSend}
                journeyCards={journeyCards}
                journeyBusy={journeyBusy}
                keyConfigured={settings?.configured === true}
                onConfigureKey={() => {
                  setSettingsDeepFocus("model-key");
                  setSettingsReturnArmed(true);
                  setSettingsNonce((n) => n + 1);
                }}
                commandPhase={commandSurface.phase}
                primaryCtaTestId={commandSurface.primaryCtaTestId}
                onAssistantModeChange={setAssistantMode}
                locked={schemeChatLocked}
                lockedReason={
                  schemeDraft?.frozen
                    ? "方案已签署并冻结，右栏本轮已锁定。要改需求请点「新建需求」重新开始。"
                    : "正在确认方案，本轮右栏已暂停接收新输入；确认完成后自动解除。"
                }
              />
            </div>
          }
          supervisorContent={
            // C.16：项目全景深页（操作台左侧栏次入口）；数据全部来自合同/保护清单
            <SupervisorTab
              repoName={repoName}
              repoPath={repoRoot ?? "（连接 Daemon 后显示仓库路径）"}
              baseBranch={currentBranch}
              contractCount={contracts.length}
              contract={supervisorContract}
              architecture={
                // 架构总览：原来挤在左栏 260px 里，现在在中央宽屏铺开
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="opacity-60">
                      {graph
                        ? `${graph.stats.nodes} 节点 · ${graph.stats.edges} 条依赖 · ${graph.cycles.length} 处环`
                        : "尚未加载依赖拓扑"}
                    </span>
                    <button
                      type="button"
                      data-testid="load-arch-graph"
                      onClick={() => void loadArchGraph()}
                      className="shrink-0 rounded border border-border px-2 py-0.5 text-xs hover:bg-accent"
                    >
                      {graph ? "刷新依赖拓扑" : "加载架构图"}
                    </button>
                  </div>
                  {graph ? (
                    <div className="flex h-[520px] flex-col overflow-hidden rounded border border-border">
                      <FilterToolbar
                        query={query}
                        onQueryChange={setQuery}
                        showCycles={showCycles}
                        onToggleCycles={setShowCycles}
                        nodeCount={graph.stats.nodes}
                        edgeCount={graph.stats.edges}
                        selectedCount={selectedPaths.length}
                        matches={matches}
                      />
                      <RadarGraph
                        nodes={graph.graph.nodes}
                        edges={graph.graph.edges}
                        cycles={graph.cycles}
                        selected={selectedPaths}
                        onSelectionChange={setSelectedPaths}
                        focusPath={focusPath}
                        showCycles={showCycles}
                        className="min-h-0 flex-1"
                      />
                      <ScopeSelector
                        selected={selectedPaths}
                        onApply={(paths) => openNewRequirement(paths)}
                        onClear={() => setSelectedPaths([])}
                      />
                    </div>
                  ) : (
                    <p className="opacity-70">
                      连接 Daemon
                      后可加载依赖拓扑；圈选出的文件会直接带进新建需求的范围。
                    </p>
                  )}
                </div>
              }
              protection={{
                mode: protection?.mode ?? "VIBE",
                entries: protection?.entries.length ?? 0,
                checkpoint: protection?.checkpoint?.at ?? null,
              }}
              admission={
                admission
                  ? {
                      decision: admission.decision,
                      reason: admission.reason ?? null,
                      cardId: admission.cardId ?? null,
                    }
                  : null
              }
              busy={busy === "admit" || busy === "deny-admission"}
              onApprove={
                admission ? () => onApproveAdmission(admission) : undefined
              }
              onDeny={admission ? () => onDenyAdmission(admission) : undefined}
              onOpenConsole={() => setStudioNonce((n) => n + 1)}
            />
          }
          openStudioRequest={studioNonce}
          openSupervisorRequest={supervisorNonce}
          onOpenStudioGraph={() => {
            setStudioViewportOverride("graph");
            setStudioNonce((n) => n + 1);
          }}
          studioGraphActive={studioViewportOverride === "graph"}
          openSettingsRequest={settingsNonce}
          settingsDeepFocus={settingsDeepFocus}
          closeSettingsRequest={closeSettingsNonce}
          commandSurface={commandSurface}
          terminalPanel={
            // 底栏验证输出抽屉，数据源与合同操作台内终端一致
            <StructuredTerminal
              lines={stream.terminal
                .filter(
                  (t) => !selected || t.contractId === selected.contract_id,
                )
                .map((t) => ({ stream: t.stream, line: t.line, at: t.at }))}
            />
          }
          openRequest={openRequest}
          renderFile={(filePath, bound) => {
            const contractId = bound
              ? (workspaceContract?.contractId ?? null)
              : null;
            const io = fileIoFor(contractId);
            return (
              <MonacoEditorPane
                key={`${contractId ?? "main"}:${filePath}`}
                path={filePath}
                io={io}
                reloadKey={reloadKeys[filePath] ?? 0}
              />
            );
          }}
          graphContent={
            /*
            Task Graph Tab（C.7 + C.10q）：全景/施工双视角；施工侧为本轮功能汇总与执行 DAG。
            数据全部来自 Daemon 快照：首屏 GET + TASK_GRAPH_UPDATED 帧。
          */
            <TaskGraphPane
              graph={taskGraph}
              loading={taskGraphLoading}
              error={confirmPrototypeError ?? taskGraphError}
              deliveryNote={
                isDeliveredLifecycle(selected?.lifecycle_state)
                  ? "本合同已合入。下方施工图是合入前的核销快照（可能仍显示失败）；成品请看「真机试玩」，或打开仓库 / 本机 Vite（如 http://127.0.0.1:5180/）。归档在 .stagent/records/。"
                  : null
              }
              onRefresh={() => void loadTaskGraph(selectedId ?? undefined)}
              onConfirmPrototype={() => {
                void handleConfirmPrototype();
              }}
              confirmPrototypeBusy={confirmPrototypeBusy}
              onStartNode={(nodeId) => {
                void handleStartGraphNode(nodeId);
              }}
              onVerifyNode={(nodeId) => {
                void handleVerifyGraphNode(nodeId);
              }}
              actionBusy={graphActionBusy}
              onRunWorker={() => {
                if (!selected) return;
                void runAction("worker", async () => {
                  const result = await runWorker(conn, selected.contract_id);
                  setWorkerResult(result);
                  const restored = await fetchEvidence(
                    conn,
                    selected.contract_id,
                  );
                  setEvidence(restored);
                });
              }}
              canRunWorker={
                selected?.lifecycle_state === "EXECUTING" &&
                evidence?.verdict.status !== "PASSED"
              }
              runWorkerBusy={busy === "worker"}
              runWorkerLabel={
                evidence?.verdict.status === "FAILED"
                  ? "再跑 Worker"
                  : "运行 Worker"
              }
              baseline={baselinePayload}
              baselineBusy={baselineBusy}
              onAcceptBaseline={() => {
                void handleAcceptBaseline();
              }}
              onRescanBaseline={() => {
                void handleRescanBaseline();
              }}
              panoramaSummary={
                selected
                  ? {
                      contractTitle: selected.intent.title,
                      contractDescription: selected.intent.description,
                      acceptanceCriteria: selected.intent.acceptance_criteria,
                      requirementsHint,
                      riskLevel: selected.intent.risk_level,
                    }
                  : null
              }
            />
          }
          middleBanner={
            <>
              {assistantMode && assistantMode.mode !== "real" ? (
                <div
                  data-testid="assistant-mode-middle-hint"
                  data-assistant-mode={assistantMode.mode}
                  className="border-b border-border/60 bg-muted/40 px-3 py-1 text-xs text-muted-foreground"
                >
                  {assistantMode.middleHint}
                </div>
              ) : null}
              {selected && staleContracts.has(selected.contract_id) ? (
                <div
                  data-testid="evidence-stale-banner"
                  role="alert"
                  className="border-b border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-800"
                >
                  ⚠
                  代码在验证之后被改动过，之前的验收证据已失效（STALE），请重新「执行验证」后再合并。
                </div>
              ) : null}
            </>
          }
          onNewRequirement={() => openNewRequirement(selectedPaths)}
          settingsContent={
            /*
            设置 Tab：连接地址、Session Token、实时流、网关受控、模型 Key、
            Worktree 绝对路径、撤销本轮——原来全堆在顶栏，现在只在这里。
          */
            <SettingsTab
              conn={conn}
              onConnChange={(next) => {
                // 先落盘（saveConnection 会归一 Token/地址），再回读进内存：
                // 界面上看到的连接，必须与实际发出去的 header 完全一致
                saveConnection(next);
                setConn(loadConnection());
              }}
              connected={connected}
              daemonPort={daemonPort}
              repoPath={repoRoot ?? "（连接 Daemon 后显示仓库路径）"}
              baseBranch={currentBranch}
              runMode={
                protection && protection.mode !== "VIBE" ? "PROTECTED" : "VIBE"
              }
              protectedCount={protection?.entries.length ?? 0}
              workerControl={
                selected?.worker_spec.control_mode ?? "GATEWAY_ENFORCED"
              }
              streamStatus={stream.status}
              worktreePath={workspaceContract?.worktreePath ?? null}
              executionStatus={
                selected
                  ? EXECUTION_STATUS_LABEL[
                      toExecutionStatus(selected.lifecycle_state)
                    ]
                  : null
              }
              modelKeySlot={
                <ModelKeyPanel
                  conn={conn}
                  settings={settings}
                  onSaved={(next) => setSettings(next)}
                />
              }
              checkpoint={protection?.checkpoint?.roundId ?? null}
              onUndoRound={
                protection?.checkpoint ? () => void onUndoRound() : undefined
              }
              undoBusy={protectionBusy}
              onRefresh={() => void refresh()}
              focusSection={settingsDeepFocus}
              onReturnToChat={
                settingsReturnArmed
                  ? () => {
                      setCloseSettingsNonce((n) => n + 1);
                      setSettingsReturnArmed(false);
                      setSettingsDeepFocus(null);
                    }
                  : undefined
              }
              chatSession={
                chatTransport
                  ? {
                      adapters: chatSession.adapters,
                      sessions: chatSession.sessions,
                      sessionId: chatSession.sessionId,
                      newSession: chatSession.newSession,
                      selectSession: chatSession.selectSession,
                    }
                  : null
              }
            />
          }
          banner={
            <>
              {protection?.corrupt && (
                <div
                  data-testid="protection-corrupt-banner"
                  role="alert"
                  className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
                >
                  保护清单损坏，AI 所有改动暂时被拦。请修复或删除{" "}
                  <code>.stagent/protection.json</code> 后刷新页面（原因：
                  {protection.corrupt}）
                </div>
              )}
              {/* 至多一张卡：合同准入正在等用户决策时，不再叠加 P.1 的通用命中卡 */}
              {!shouldConfirmAdmission(admission) &&
                protection?.round.pending[0] && (
                  <ProtectionApprovalCard
                    card={protection.round.pending[0]}
                    busy={protectionBusy}
                    onDecide={(id, d) => void onDecideProtection(id, d)}
                  />
                )}
              {!recDismissed &&
                recommendations.length > 0 &&
                (protection?.entries.length ?? 0) === 0 && (
                  <ProtectionRecommendationCard
                    recommendations={recommendations}
                    busy={protectionBusy}
                    onApply={(names) => void onApplyRecommendations(names)}
                    onDismiss={dismissRecommendations}
                  />
                )}
              {undoInfo && (
                <div
                  data-testid="undo-info"
                  className="border-b border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-700"
                >
                  {undoInfo}
                </div>
              )}
              {error && (
                <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
                  {error}
                </div>
              )}

              {stream.alerts.length > 0 && (
                <div
                  data-testid="scope-alerts"
                  className="space-y-1 border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700"
                >
                  {stream.alerts.map((alert) => (
                    <div key={alert.id} className="flex items-center gap-2">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      <span className="font-mono font-semibold">
                        {alert.code}
                      </span>
                      <span className="truncate">{alert.message}</span>
                      <span className="text-[10px] opacity-70">
                        {alert.contractId.slice(-8)}
                      </span>
                      <button
                        onClick={() => stream.dismissAlert(alert.id)}
                        className="ml-auto shrink-0 px-1 text-amber-700/70 hover:text-amber-900"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          }
          studioContent={
            <StudioViewportShell
              presentationState={
                selectedId
                  ? (presentationByContract[selectedId]?.state ?? null)
                  : null
              }
              presentationMessage={
                selectedId
                  ? presentationByContract[selectedId]?.message || null
                  : null
              }
              contractRail={
                // C.16：需求列表 + 规范与资产在合同操作台左侧栏（单门）
                <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 text-xs">
                  <div className="text-[11px] font-medium text-foreground">
                    本项目需求
                  </div>
                  <div data-testid="requirement-list" className="min-h-[80px]">
                    <div className="px-1 py-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                      需求（合同 {contracts.length}）
                    </div>
                    {contracts.length === 0 && (
                      <div className="px-1 py-2 text-xs leading-relaxed text-muted-foreground">
                        暂无需求。点右上角「新建需求」，或在右侧对话里说清目标。
                      </div>
                    )}
                    {contracts.map((contract) => (
                      <button
                        key={contract.contract_id}
                        type="button"
                        data-testid="requirement-list-item"
                        onClick={() => {
                          setSelectedId(contract.contract_id);
                          setEvidence(null);
                          setWorkerResult(null);
                          setDiff(null);
                          setDiffFiles(null);
                          setAdmission(null);
                          setDraft(null);
                          setDisputeReport(null);
                          setDisputeError(null);
                          setStudioViewportOverride(null);
                          setConfirmPrototypeError(null);
                          setRequirementsHint(null);
                          setStudioNonce((n) => n + 1);
                        }}
                        className={`block w-full border-b border-border/50 px-2 py-2 text-left hover:bg-sidebar-accent ${
                          selectedId === contract.contract_id
                            ? "bg-sidebar-accent"
                            : ""
                        }`}
                      >
                        <div className="truncate text-xs">
                          {contract.intent.title}
                        </div>
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {contract.lifecycle_state} ·{" "}
                          {contract.contract_id.slice(-8)}
                        </div>
                      </button>
                    ))}
                  </div>
                  <div className="border-t border-border pt-2">
                    <div className="mb-1 text-[11px] font-medium text-foreground">
                      规范与资产
                    </div>
                    <FileTreeSpecsSection
                      assets={specAssets}
                      open={specsOpen}
                      onToggle={() => setSpecsOpen((v) => !v)}
                      onOpen={(path) =>
                        setOpenRequest({ path, nonce: Date.now() })
                      }
                      generation={specsGeneration}
                    />
                  </div>
                  <button
                    type="button"
                    data-testid="studio-open-panorama"
                    onClick={() => setSupervisorNonce((n) => n + 1)}
                    className="mt-auto rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    项目全景与准入
                  </button>
                </div>
              }
              scheme={
                <div className="flex min-h-0 flex-1 flex-col overflow-auto">
                  {showForm ? (
                    <ContractForm
                      busy={busy === "create"}
                      initialPaths={scopeDraft}
                      draft={draft}
                      draftBusy={busy === "draft"}
                      onRequestDraft={requestDraft}
                      onCreate={(contract) =>
                        runAction("create", async () => {
                          const saved = await createContractWithAdmission(
                            conn,
                            contract,
                          );
                          setSelectedId(saved.contract.contract_id);
                          setShowForm(false);
                          setDraft(null);
                          applyAdmission(saved.admission);
                        })
                      }
                    />
                  ) : null}
                  <SchemeReviewPane
                    scheme={schemeDraft}
                    demoUrl={demoPreview?.url ?? retainedDemoUrl ?? null}
                    demoStatus={demoPreview?.status ?? null}
                    demoGate={schemeDemoGate}
                    demoBusy={schemeDemoBusy}
                    confirmBusy={schemeConfirmBusy || authorizeBusy}
                    errorMessage={confirmPrototypeError}
                    confirmation={schemeConfirmation ?? undefined}
                    onConfirmDecision={handleSchemeConfirmDecision}
                    onResolveConflict={handleSchemeResolveConflict}
                    onNotesChange={handleSchemeNotesChange}
                    onGenerateDemo={() => {
                      void handleGenerateSchemeDemo();
                    }}
                    onRetryDemo={() => {
                      void handleGenerateSchemeDemo();
                    }}
                    onConfirmDemo={() => {
                      void handleConfirmSchemeDemo();
                    }}
                    onAcceptDegradedDemo={() => {
                      handleAcceptDegradedDemo();
                    }}
                    onConfirmScheme={() => {
                      void handleConfirmScheme();
                    }}
                  />
                </div>
              }
            />
          }
          footer={
            <footer className="flex h-6 items-center gap-4 bg-primary px-3 text-xs text-primary-foreground">
              <span>本机服务：{conn.baseUrl}</span>
              <span className="ml-auto">v0.1 · 有证据才合入</span>
            </footer>
          }
        />
      </>
    </div>
  );
}

function ModelKeyPanel({
  conn,
  settings,
  onSaved,
}: {
  conn: DaemonConnection;
  settings: ModelSettings | null;
  onSaved: (next: ModelSettings) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(settings?.model ?? "gpt-4o-mini");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [message, setMessage] = useState<string | null>(null);

  const save = async () => {
    setState("saving");
    setMessage(null);
    try {
      const next = await saveOpenAiKey(conn, apiKey.trim(), model.trim());
      onSaved(next);
      setApiKey("");
      setState("saved");
      setMessage(
        "已就绪。钥匙只留在本机这次运行里，不会写进项目、也不会在聊天里显示。回到右侧点「新会话」即可用真助手。",
      );
    } catch (err) {
      setState("error");
      setMessage((err as Error).message);
    }
  };

  const ready = settings?.configured === true;

  return (
    <section
      data-testid="model-key-wizard"
      className="space-y-2 text-[11px] leading-relaxed"
    >
      <p className="text-muted-foreground">
        三步配好模型钥匙（OpenAI 兼容接口均可）：
      </p>
      <ol className="list-decimal space-y-0.5 pl-4 text-muted-foreground">
        <li>在下方粘贴钥匙（密码框，页面不会明文回显）</li>
        <li>确认模型名（可按服务商说明改）</li>
        <li>点「保存」→ 状态变成「已就绪」，再回右侧开新会话</li>
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">模型钥匙</span>
        <input
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={ready ? "已就绪（重新输入可覆盖）" : "粘贴你的钥匙…"}
          className="w-64 rounded border border-border bg-background px-2 py-1 outline-none"
        />
        <span className="text-muted-foreground">模型</span>
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-40 rounded border border-border bg-background px-2 py-1 outline-none"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={state === "saving" || apiKey.trim().length < 8}
          className="rounded bg-primary px-2 py-1 text-primary-foreground disabled:opacity-40"
        >
          {state === "saving" ? "保存中…" : "保存"}
        </button>
      </div>
      <p
        data-testid="model-key-status"
        className={ready ? "text-emerald-700" : "text-amber-800"}
      >
        状态：
        {ready
          ? `已就绪（来源 ${settings?.source ?? "本机"}）`
          : "还差一步：尚未配置"}
      </p>
      {message && (
        <p
          className={
            state === "error" ? "text-destructive" : "text-emerald-700"
          }
        >
          {message}
        </p>
      )}
    </section>
  );
}

function EvidenceView({ evidence }: { evidence: EvidenceBundle }) {
  const passed =
    evidence.verdict.status === "PASSED" && evidence.verdict.can_merge;
  return (
    <section className="rounded border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        {passed ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        ) : (
          <XCircle className="h-4 w-4 text-destructive" />
        )}
        <h3 className="text-sm font-semibold">
          Evidence {evidence.evidence_id}
        </h3>
        <span className="text-[10px] text-muted-foreground">
          {evidence.verdict.status} · can_merge=
          {String(evidence.verdict.can_merge)}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {evidence.verdict.summary}
        {evidence.verdict.reason_code
          ? ` · reason: ${evidence.verdict.reason_code}`
          : ""}
      </p>
      <div className="mt-2 space-y-1">
        {evidence.verification_results.map((result) => (
          <div
            key={result.command_alias}
            className="flex items-center gap-2 text-[11px]"
          >
            <span>{result.command_alias}</span>
            <span
              className={
                result.passed ? "text-emerald-500" : "text-destructive"
              }
            >
              exit={result.exit_code}
            </span>
            <span className="text-muted-foreground">
              {result.duration_ms}ms
            </span>
          </div>
        ))}
      </div>
      <pre className="mt-2 max-h-56 overflow-auto rounded bg-black/80 p-2 text-[10px] text-zinc-300">
        {JSON.stringify(evidence, null, 2)}
      </pre>
    </section>
  );
}

function splitPaths(raw: string): string[] {
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * 新建需求表单。
 *
 * 两步：① 用一句白话提意图 → `POST /api/supervisor/draft` 拿**未落盘草案**；
 * ② 在草案预填的基础上微调，再「提交给 Daemon」真正落盘成合同。
 *
 * 为什么不让 Daemon 一步到位直接落盘：草案是给人审的，人有权在落盘前改标题/范围/
 * 命令；直接落盘等于把"AI 的建议"变成"既成事实"，违反 §9.1.1 的 DRAFT 阶段语义。
 */
function ContractForm({
  busy,
  initialPaths,
  draft,
  draftBusy,
  onCreate,
  onRequestDraft,
}: {
  busy: boolean;
  initialPaths: string[];
  draft: SupervisorDraftResult | null;
  draftBusy: boolean;
  onCreate: (contract: SoftwareContract) => void;
  onRequestDraft: (intent: string) => void;
}) {
  /**
   * 预填必须在**渲染期**完成，不能只靠 effect。
   *
   * 原因（离线诊断的结论）：草案由异步请求返回，`draft` 一到就会先提交一帧
   * 「有草案、但 value 还是默认 `src/**`」的 DOM，effect 要到之后的被动刷新
   * 才把 value 改过来。全量跑时调度被拖慢，观测点正好落在这一帧上，
   * 就会读到「预填没生效」。同理，草案已就绪时切 Tab 会让表单重挂载，
   * 首帧也不该先闪默认值。
   *
   * 两处一起兜住：
   * 1. 挂载时若已有草案，直接用 seed 作为初始 state；
   * 2. 渲染期比较 `draft` 引用，发现新草案就在同一帧套用 seed（React 官方的
   *    "adjusting state when a prop changes" 写法，不会多提交一帧）。
   */
  const mountSeed = draft ? seedDraftForm(draft) : null;
  const [intent, setIntent] = useState("");
  const [title, setTitle] = useState(() => mountSeed?.title ?? "");
  const [description, setDescription] = useState(
    () => mountSeed?.description ?? "",
  );
  const [paths, setPaths] = useState(
    () => mountSeed?.paths || initialPaths.join(", ") || "src/**",
  );
  const [command, setCommand] = useState(
    () => mountSeed?.command ?? "npm test",
  );
  const [acceptance, setAcceptance] = useState<string[]>(
    () => mountSeed?.acceptance ?? [],
  );
  const [formError, setFormError] = useState<string | null>(null);

  /** 已经套用过预填的那份草案（按引用比较）；之后用户改字段不会被它覆盖 */
  const [seededDraft, setSeededDraft] = useState<SupervisorDraftResult | null>(
    draft,
  );
  if (draft !== seededDraft) {
    setSeededDraft(draft);
    if (draft) {
      const seed = seedDraftForm(draft);
      setTitle(seed.title);
      setDescription(seed.description);
      setPaths(seed.paths || initialPaths.join(", ") || "src/**");
      setCommand(seed.command);
      setAcceptance(seed.acceptance);
    }
  }

  /**
   * 圈选只在「还没有草案」时决定范围。
   *
   * 草案的 `plan.writable_paths` 是「圈选 + 规则推断」的结果（绿野仓库还会并入
   * 脚手架种子），它表达的是 Supervisor 真正允许写的范围；表单是审批面，
   * 这里若让圈选回写，字段就会从草案范围缩回圈选列表。
   *
   * 这个 effect 在挂载时也会跑，所以必须显式挡掉草案在场的情况——否则切个
   * Tab 让表单重挂载，预填就会被圈选覆盖，和「首帧闪 src/**」是同一类问题。
   */
  useEffect(() => {
    if (draft) return;
    if (initialPaths.length > 0) setPaths(initialPaths.join(", "));
  }, [draft, initialPaths]);

  const submit = () => {
    setFormError(null);
    try {
      const parts = command.trim().split(/\s+/);
      const draftContract = draft?.contract;
      // 草案的只读/禁区/白话元数据必须原样带入，否则落盘后的合同会丢掉
      // `supervisor_metadata`，Supervisor Tab 与 Studio 又退回「（无）」
      const fromDraft = draftContract
        ? {
            readonlyPaths:
              draftContract.authorization.file_system_scope.readonly_paths,
            strictlyForbiddenPaths:
              draftContract.authorization.file_system_scope
                .strictly_forbidden_paths,
            supervisorMetadata: draftContract.supervisor_metadata,
          }
        : {};
      const built = createContractDraft({
        title: title.trim() || "未命名任务",
        description: description.trim() || "（无描述）",
        acceptanceCriteria:
          acceptance.length > 0 ? acceptance : ["验证命令通过"],
        writablePaths: splitPaths(paths),
        commands: [
          {
            alias: "verify",
            executable: parts[0] ?? "npm",
            args: parts.slice(1),
            expected_exit_code: 0,
            timeout_seconds: 60,
          },
        ],
        ...fromDraft,
      });
      onCreate(
        softwareContractSchema.parse({
          ...built,
          lifecycle_state: "PENDING_APPROVAL",
          approval: { status: "PENDING_REVIEW" },
        }),
      );
    } catch (err) {
      setFormError((err as Error).message);
    }
  };

  const canRequestDraft = !draftBusy && intent.trim().length > 0;

  return (
    <section className="border-b border-border bg-card p-3">
      <div className="mb-2 rounded border border-border/70 p-2">
        <label className="text-[11px]">
          用一句话说清要改什么（先出草案，不落盘）
          <textarea
            data-testid="intent-input"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            rows={2}
            placeholder="例如：把登录页的按钮换成圆角，顺便补一个空状态提示"
            className="mt-0.5 w-full resize-y rounded border border-border bg-background px-2 py-1 outline-none"
          />
        </label>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="request-draft"
            onClick={() => onRequestDraft(intent.trim())}
            disabled={!canRequestDraft}
            className="rounded border border-border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-40"
          >
            {draftBusy ? "推导中…" : "让 Supervisor 出草案"}
          </button>
          {draft ? (
            <span
              data-testid="draft-ready"
              className="text-[10px] text-muted-foreground"
            >
              草案就绪：白话理由 {draft.rationale.length} 条 · 未决问题{" "}
              {draft.unresolved_questions.length} 条 · 涉及{" "}
              {draft.plan.writable_paths.length} 处 · 模型调用{" "}
              {draft.model_calls} 次
              {draft.plan.needs_protection_approval
                ? " · 命中保护清单，提交后会再问一次"
                : ""}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">
              有模型配置时会做 L1 白话补全（记入 Supervisor 独立账本）；否则纯
              L0，不会写任何文件
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <label className="text-[11px]">
          标题
          <input
            data-testid="intent-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 outline-none"
          />
        </label>
        <label className="text-[11px]">
          可写路径（逗号分隔）
          <input
            data-testid="intent-paths"
            value={paths}
            onChange={(e) => setPaths(e.target.value)}
            className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 outline-none"
          />
        </label>
        <label className="text-[11px] md:col-span-2">
          描述
          <input
            data-testid="intent-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 outline-none"
          />
        </label>
        <label className="text-[11px] md:col-span-2">
          验证命令
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 outline-none"
          />
        </label>
      </div>
      {formError && (
        <div className="mt-2 text-[11px] text-destructive">{formError}</div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-40"
        >
          {busy ? "创建中…" : "提交给 Daemon"}
        </button>
        <span className="text-[10px] text-muted-foreground">
          合同由 Daemon 校验并写入 .stagent/contracts
        </span>
      </div>
    </section>
  );
}
