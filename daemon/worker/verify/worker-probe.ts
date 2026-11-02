/**
 * TASK-W.7：自动探测任务包（五类断言）+ 升格判定（纯逻辑 + 注入执行面）。
 *
 * ## 为什么探测要在沙箱里跑，而且拿不到沙箱就**拒绝探测**
 * 卡正文 FAIL 红线：「探测无沙箱直接跑主树」。若拿不到隔离执行面就退回主树跑
 * 探针，评测一个「任意用户装的 CLI」等于把主树交给它——这才是本卡最危险的一步。
 * 因此 `runProbePack()` 在 `port.isAvailable() === false` 时**直接抛错不产报告**
 * （`E_PROBE_SANDBOX_UNAVAILABLE`），既不给「无报告也算过」的缝，也不留下
 * 「探测失败但档位升了」的状态。
 *
 * ## 五类断言（卡正文范围 2）
 * | id | 断言 | 依赖 |
 * | --- | --- | --- |
 * | `filesystem_fence` | 诱导越权写须失败关闭；Worktree 内写须成功 | 注入执行面（沙箱） |
 * | `command_fence` | 白名单外命令 / 宿主二进制不可达；出站被拒 | 注入执行面（沙箱） |
 * | `evidence_integrity` | 写操作可被逐次观测（未经 Gateway 的直写不得计为证据） | 注入执行面（沙箱） |
 * | `capability_declaration` | 声明与目标档位口径对账（`validateAdapterCapability`） | 纯函数 |
 * | `dispatch_witness` | `SANDBOX_ENFORCED` 派工是否带 `SandboxWitness` | `resolveEvidenceControlMode` |
 *
 * ## 第五项为什么必须「复用」而不是新写
 * `resolveEvidenceControlMode()` 是「记实不记名」的**唯一**强制点（W.5c-iii）。
 * 若这里另写一份「有没有见证」的判定，将来两处口径一旦分叉，就会出现
 * 「探测说受控、证据说不受控」的自相矛盾。故本文件只调用它，不复制它的规则。
 *
 * ## 不宣称什么
 * 探测覆盖的是「该档位执行环境对声明的兑现」+「声明本身是否自洽」，
 * **不是**对第三方 CLI 全部行为的穷尽审计。因此报告措辞固定为
 * 「通过已知探测集」，并对「绝对受控」类表述做机制性拦截
 * （`assertReportWording`）——报告文本由代码生成，任何一方（含注入的执行面）
 * 写出该措辞都会抛错，而不是悄悄落盘。
 */
import {
  resolveEvidenceControlMode,
  validateAdapterCapability,
  type AdapterCapabilityDeclaration,
  type AdapterControlMode,
} from "../worker-adapter.interface";
import type { SandboxWitness } from "../sandbox/container-host";
import {
  E_PROBE_REPORT_WORDING,
  WorkerRegistrationError,
  fingerprintOf,
  type WorkerLaunchSpec,
  type WorkerProbeReportSummary,
  type WorkerRecord,
} from "./worker-registration";

/** 探测项 id（顺序即报告顺序） */
export const PROBE_IDS = [
  "filesystem_fence",
  "command_fence",
  "evidence_integrity",
  "capability_declaration",
  "dispatch_witness",
] as const;
export type ProbeId = (typeof PROBE_IDS)[number];

export type ProbeStatus = "pass" | "fail" | "not_verified";

export interface ProbeFinding {
  id: ProbeId;
  status: ProbeStatus;
  /** 一句话说明（会进报告；不得含「绝对受控」类措辞） */
  detail: string;
  /**
   * 是否为升格**必需**项。
   * `dispatch_witness` 对 `GATEWAY_ENFORCED` 目标不适用（该档位本就不进容器），
   * 故标 false——不能把「不适用」算成「通过」，也不能算成「失败」。
   */
  required: boolean;
}

/** 交付给执行面的探测输入（不含任何宿主句柄；句柄在实现内部自己拿） */
export interface FenceProbeInput {
  adapter_id: string;
  launch: WorkerLaunchSpec;
  declaration: AdapterCapabilityDeclaration;
  target_mode: "GATEWAY_ENFORCED" | "SANDBOX_ENFORCED";
}

/**
 * 探测执行面端口（P1–P3 的实际观测）。
 *
 * 实现约定：
 * - `isAvailable()` 为 false 时**不得**执行任何探针（`runProbePack` 会先判）；
 * - 返回的三条 finding 必须覆盖 `filesystem_fence` / `command_fence` /
 *   `evidence_integrity`，缺项按 `not_verified` 处理（不补假通过）。
 */
export interface ProbeExecutionPort {
  readonly kind: string;
  isAvailable(): boolean;
  runFenceProbes(input: FenceProbeInput): Promise<ProbeFinding[]>;
  /**
   * P5 用：本次探测派工**经 `runInSandbox()` 入箱**的见证。
   *
   * 只能由执行面依据宿主实际返回的 `SandboxRunOutcome` 产出
   * （`sandboxWitness()` 是唯一产出点）。执行面未实现该方法 → 返回 undefined
   * → P5 判 `fail`（缺见证不得记受控档），不允许由探测包替它编一个。
   */
  getWitness?(): SandboxWitness | undefined;
}

/**
 * 报告的固定结语：措辞上限写死在这里，避免各处自由发挥。
 *
 * 注意这里**不能出现** `FORBIDDEN_WORDING` 里的任何一个短语——包括「不等于『绝对受控』」
 * 这种否定式引用：闸门是严格匹配，不做语义判断，否则「否定句放行」本身就成了可绕过的口子
 * （例如「并不『绝对受控』」与「绝对受控」共用正则时会互相牵连）。
 * 施工期这条约束被测试逮到过一次，故在此写明。
 */
export const PROBE_REPORT_WORDING =
  "结论：通过已知探测集（仅覆盖上述探测项）。这不等于「任何行为都已被控制」，也不构成对第三方 CLI 全部行为的安全保证。";

/** 禁用措辞：命中即拒绝写入报告（机制性拦截，不靠人自觉） */
const FORBIDDEN_WORDING = [
  /绝对受控/,
  /绝对安全/,
  /完全安全/,
  /100\s*%\s*(安全|受控)/,
  /零风险/,
];

/**
 * 报告措辞闸门。
 *
 * 为什么连注入执行面给出的 `detail` 也要过闸：执行面是端口，可能是第三方实现；
 * 若它返回「本适配器绝对受控」，这句话会原样进报告、进而成为升格依据的注脚。
 */
export function assertReportWording(text: string): string {
  for (const pattern of FORBIDDEN_WORDING) {
    if (pattern.test(text)) {
      throw new WorkerRegistrationError(
        E_PROBE_REPORT_WORDING,
        `报告文本含禁用措辞（${pattern.source}）：探测结论的上限是「通过已知探测集」，不得写成绝对判断`,
      );
    }
  }
  return text;
}

const FENCE_IDS: ProbeId[] = [
  "filesystem_fence",
  "command_fence",
  "evidence_integrity",
];

function normalizeFenceFindings(raw: ProbeFinding[]): ProbeFinding[] {
  return FENCE_IDS.map((id) => {
    const hit = raw.find((item) => item.id === id);
    if (hit === undefined) {
      return {
        id,
        status: "not_verified" as const,
        detail: "执行面未返回该项结果（视为未验证，不补假通过）",
        required: true,
      };
    }
    return {
      id,
      status: hit.status,
      detail: assertReportWording(hit.detail),
      required: true,
    };
  });
}

/**
 * 能力声明对账（P4）。
 *
 * 直接调 `validateAdapterCapability(declaration, targetMode)`：三档口径的唯一
 * 实现就在那里（严格档 / 围栏档 / 标识档），这里不重复写校验规则。
 */
export function probeCapabilityDeclaration(
  declaration: AdapterCapabilityDeclaration,
  targetMode: "GATEWAY_ENFORCED" | "SANDBOX_ENFORCED",
): ProbeFinding {
  const validation = validateAdapterCapability(declaration, targetMode);
  if (validation.ok) {
    return {
      id: "capability_declaration",
      status: "pass",
      detail: `声明与 ${targetMode} 口径一致（按该档位的校验档判定）`,
      required: true,
    };
  }
  return {
    id: "capability_declaration",
    status: "fail",
    detail: `声明未通过 ${targetMode} 档校验：${validation.code} — ${validation.reason}`,
    required: true,
  };
}

/**
 * 派工见证校验（P5 · P-122 追加）。
 *
 * **判定完全复用 `resolveEvidenceControlMode()`**：
 * 声明档经「见证」校正后若仍是目标档 → 见证成立；被校正成
 * `UNCONTROLLED_EXTERNAL` → 缺见证，判定不成立。
 * 本函数不自己判断 `witness === undefined`，以免两处口径分叉。
 */
export function probeDispatchWitness(
  targetMode: "GATEWAY_ENFORCED" | "SANDBOX_ENFORCED",
  witness: SandboxWitness | undefined,
): ProbeFinding {
  if (targetMode !== "SANDBOX_ENFORCED") {
    return {
      id: "dispatch_witness",
      status: "not_verified",
      detail: "该目标档位不经容器执行，沙箱见证不适用（N/A）；不作为升格必需项",
      required: false,
    };
  }
  const resolved: AdapterControlMode = resolveEvidenceControlMode(
    "SANDBOX_ENFORCED",
    witness,
  );
  if (resolved === "SANDBOX_ENFORCED") {
    return {
      id: "dispatch_witness",
      status: "pass",
      detail: `派工携带 SandboxWitness（host=${witness?.host_kind ?? "?"}，via=${witness?.via ?? "?"}，exit=${String(witness?.exit_code ?? "?")}）`,
      required: true,
    };
  }
  return {
    id: "dispatch_witness",
    status: "fail",
    detail:
      "缺 SandboxWitness：resolveEvidenceControlMode 将该次执行校正为 UNCONTROLLED_EXTERNAL（未入箱不得记受控档）",
    required: true,
  };
}

export interface RunProbePackInput {
  record: WorkerRecord;
  targetMode: "GATEWAY_ENFORCED" | "SANDBOX_ENFORCED";
  port: ProbeExecutionPort;
  /** 沙箱派工的见证；`SANDBOX_ENFORCED` 目标必需 */
  witness?: SandboxWitness | undefined;
  /** 探测时间（ISO），由调用方注入以便测试确定性 */
  now: string;
}

export interface PromotionDecision {
  allowed: boolean;
  /** 通过时为目标档位；未通过恒为 UNCONTROLLED_EXTERNAL */
  control_mode: AdapterControlMode;
  /** 拒绝原因（逐条，便于报告与排障） */
  refusals: string[];
}

export interface ProbePackResult {
  findings: ProbeFinding[];
  report: WorkerProbeReportSummary;
  promotion: PromotionDecision;
}

/**
 * 跑完整探测包并给出升格判定。
 *
 * 顺序：先判执行面可用性（不可用即**拒绝探测**，不产报告）→ 跑 P1–P3 →
 * 补 P4 / P5 → 汇总判定 → 组装报告。
 */
export async function runProbePack(
  input: RunProbePackInput,
): Promise<ProbePackResult> {
  const { record, targetMode, port } = input;

  if (port.isAvailable() !== true) {
    throw new WorkerRegistrationError(
      "E_PROBE_SANDBOX_UNAVAILABLE",
      `探测执行面不可用（${port.kind}）：探测必须在隔离沙箱内进行，拒绝退回主树执行`,
    );
  }

  const fenceFindings = await port.runFenceProbes({
    adapter_id: record.adapter_id,
    launch: record.launch,
    declaration: record.declaration,
    target_mode: targetMode,
  });
  const fence = normalizeFenceFindings(fenceFindings);

  // P5 的见证来源：调用方显式传入 > 执行面为「本次探测派工」产出的见证。
  // 后者仍是 `sandboxWitness()` 的产物（经 `runInSandbox()` 真实执行），
  // 不是本文件编出来的——探测包不提供任何「补见证」的路径。
  const witness = input.witness ?? port.getWitness?.();

  const findings: ProbeFinding[] = [
    ...fence,
    probeCapabilityDeclaration(record.declaration, targetMode),
    probeDispatchWitness(targetMode, witness),
  ];

  const refusals: string[] = [];
  for (const finding of findings) {
    if (finding.required && finding.status !== "pass") {
      refusals.push(
        `${finding.id}: ${finding.status === "fail" ? "未通过" : "未验证"} — ${finding.detail}`,
      );
    }
  }

  // 沙箱目标：即便其余项全绿，缺见证也**不得**记受控档。这里让
  // resolveEvidenceControlMode 直接给结论，避免与证据面口径分叉。
  if (targetMode === "SANDBOX_ENFORCED" && refusals.length === 0) {
    const resolved = resolveEvidenceControlMode(targetMode, witness);
    if (resolved !== targetMode) {
      refusals.push(
        `dispatch_witness: resolveEvidenceControlMode 将结果校正为 ${resolved}（缺见证）`,
      );
    }
  }

  const allowed = refusals.length === 0;
  const promotion: PromotionDecision = {
    allowed,
    control_mode: allowed ? targetMode : "UNCONTROLLED_EXTERNAL",
    refusals,
  };

  const report: WorkerProbeReportSummary = {
    verified_at: input.now,
    // 绑定「这次探测对应的适配器版本 / 命令 / 声明」：指纹变了报告即失效
    fingerprint: fingerprintOf(record),
    status: allowed ? "passed" : "failed",
    control_mode: promotion.control_mode,
    findings: findings.map((finding) => ({
      id: finding.id,
      status: finding.status,
      detail: assertReportWording(finding.detail),
    })),
    wording: PROBE_REPORT_WORDING,
  };

  return { findings, report, promotion };
}
