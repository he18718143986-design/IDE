/**
 * TASK-W.7：Worker 自助注册的**领域模型与两级注册语义**（纯函数，无 I/O）。
 *
 * 为什么单独一层：注册 / 探测 / 升格 / 降级这四件事的判定必须可脱离 Daemon、
 * 脱离文件系统、脱离容器做确定性断言；否则「填表即受控」这类红线只能靠人工看。
 *
 * 两级注册语义（卡正文范围 1）：
 * - 直写档**只有** `UNCONTROLLED_EXTERNAL`：注册即非受控，仅 Vibe / 参考；
 * - 升格到受控档**必须**经探测通过（`worker-probe.ts::runProbePack`），
 *   本文件不提供任何「直接写成受控」的入口——这是红线，不是风格问题。
 *
 * 「填表即受控」的第二道物理防线：请求体里**不允许**出现档位 / 实测 / 升格类字段。
 * 前端即便伪造 `control_mode: "GATEWAY_ENFORCED"` 也会被
 * `detectForbiddenRegistrationField()` 显式拒绝，而不是「忽略就好」——忽略会让
 * 调用方以为它生效了。
 */
import crypto from "node:crypto";
import type { AdapterCapabilityDeclaration } from "../worker-adapter.interface";

/** 注册 / 探测 / 升格相关的明确错误码（供 HTTP 路由映射状态码） */
export const E_WORKER_ID_INVALID = "E_WORKER_ID_INVALID";
export const E_WORKER_VERSION_REQUIRED = "E_WORKER_VERSION_REQUIRED";
export const E_WORKER_LAUNCH_REQUIRED = "E_WORKER_LAUNCH_REQUIRED";
export const E_WORKER_DECLARATION_INVALID = "E_WORKER_DECLARATION_INVALID";
export const E_WORKER_FORBIDDEN_FIELD = "E_WORKER_FORBIDDEN_FIELD";
export const E_WORKER_DUPLICATED = "E_WORKER_DUPLICATED";
export const E_WORKER_NOT_FOUND = "E_WORKER_NOT_FOUND";
export const E_WORKER_NOT_VERIFIED = "E_WORKER_NOT_VERIFIED";
export const E_WORKER_PROMOTION_REFUSED = "E_WORKER_PROMOTION_REFUSED";
export const E_WORKER_STORE_CORRUPT = "E_WORKER_STORE_CORRUPT";
export const E_WORKER_BUILTIN_LOCKED = "E_WORKER_BUILTIN_LOCKED";
export const E_PROBE_SANDBOX_UNAVAILABLE = "E_PROBE_SANDBOX_UNAVAILABLE";
export const E_PROBE_EXECUTOR_UNIMPLEMENTED = "E_PROBE_EXECUTOR_UNIMPLEMENTED";
export const E_PROBE_REPORT_WORDING = "E_PROBE_REPORT_WORDING";

/** 带 `code` 的领域错误，供 HTTP 路由统一映射 */
export class WorkerRegistrationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "WorkerRegistrationError";
    this.code = code;
  }
}

/**
 * 启动命令。**结构化 argv，不用 shell 字符串**：
 * 自助注册接受的是「用户自己装的 CLI」，若允许 `command: "foo && rm -rf ~"`，
 * 这道门本身就是注入面。`command` 只允许可执行名 / 绝对路径，
 * 参数逐个给；拼接由调用方负责，不接受隐式 shell 解析。
 */
export interface WorkerLaunchSpec {
  command: string;
  args: string[];
}

/** 注册请求体（服务端只认这些字段；其它一律走 forbidden 检查） */
export interface WorkerRegistrationInput {
  adapter_id: string;
  adapter_version: string;
  launch: WorkerLaunchSpec;
  declaration: AdapterCapabilityDeclaration;
}

/**
 * 请求体里**禁止出现**的字段：出现即拒绝（不是忽略）。
 *
 * `control_mode` / `verified_on` 是「升格 + 实测」的产物，只能由服务端在探测
 * 通过后写入；`probe` / `report` 同理不得由调用方注入。
 */
export const FORBIDDEN_REGISTRATION_FIELDS = [
  "control_mode",
  "worker_control_mode",
  "verified_on",
  "verified",
  "promoted",
  "promotion",
  "probe",
  "probe_report",
  "report",
] as const;

/** 探测报告摘要（存在 WorkerRecord 上，供列表与详情查询） */
export interface WorkerProbeReportSummary {
  verified_at: string;
  /** 探测所依据的指纹；与当前指纹不一致即视为过期 */
  fingerprint: string;
  status: "passed" | "failed";
  /** 升格判定结论（通过时为目标档位，未通过恒为 UNCONTROLLED_EXTERNAL） */
  control_mode: string;
  /** 探测项清单（id + 状态 + 说明），措辞限定「通过已知探测集」 */
  findings: Array<{ id: string; status: string; detail: string }>;
  /** 报告结语（固定措辞，禁「绝对受控」） */
  wording: string;
}

/** 落盘记录 */
export interface WorkerRecord {
  adapter_id: string;
  adapter_version: string;
  launch: WorkerLaunchSpec;
  declaration: AdapterCapabilityDeclaration;
  /** 登记档位：注册时为 UNCONTROLLED_EXTERNAL；升格后为受控档 */
  control_mode:
    "GATEWAY_ENFORCED" | "SANDBOX_ENFORCED" | "UNCONTROLLED_EXTERNAL";
  /** 实测记录（升格后才有；绑定指纹） */
  verified_on?:
    | { cli_version: string; verified_at: string; fingerprint: string }
    | undefined;
  last_report?: WorkerProbeReportSummary | undefined;
  /** 是否内建（内建项由代码注册，不允许经 API 改写档位） */
  builtin: boolean;
  created_at: string;
  updated_at: string;
}

/** 存储文件结构 */
export interface WorkerStoreFile {
  schema_version: "1.0.0";
  workers: WorkerRecord[];
}

export const WORKER_STORE_SCHEMA_VERSION = "1.0.0" as const;

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * 稳定序列化：对声明做**键序无关**的规范化，供指纹使用。
 * 不用 `JSON.stringify(obj)` 直接算——对象键序不同会得到不同指纹，
 * 导致「明明没改却被判定版本变更而降级」。
 */
function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableSerialize(v)}`)
    .join(",")}}`;
}

/**
 * 版本 / 命令指纹（卡正文范围 4「verified_on 绑定适配器版本号 / 命令指纹」）。
 *
 * 参与指纹的三样东西都**可被用户改动**、也都决定「探测结论是否还成立」：
 * 1. `adapter_version`：适配器自称的版本；
 * 2. `launch`：实际启动命令（换命令 = 换被测对象）；
 * 3. `declaration`：能力声明（改声明 = 改被测主张）。
 * 只改 created_at / updated_at **不会**导致降级。
 */
export function workerFingerprint(input: {
  adapter_id: string;
  adapter_version: string;
  launch: WorkerLaunchSpec;
  declaration: AdapterCapabilityDeclaration;
}): string {
  const payload = stableSerialize({
    adapter_id: input.adapter_id,
    adapter_version: input.adapter_version,
    launch: {
      command: input.launch.command,
      args: input.launch.args,
    },
    declaration: input.declaration,
  });
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

export function fingerprintOf(record: WorkerRecord): string {
  return workerFingerprint(record);
}

/**
 * 有效档位（卡正文范围 4「版本或指纹变更 → **自动降级**回 UNCONTROLLED_EXTERNAL 待重验」）。
 *
 * 为什么必须**每次读时重算**而不是写入时改：用户可以直接编辑
 * `.stagent/workers.json`（它就是本机文件），若只在写入时判定，手改即可绕过降级。
 * 因此 `control_mode` 只是「上次升格时记下的档位」，真正生效的是本函数。
 *
 * 降级是**单向安全**的：指纹不一致只会降，不会升。
 */
export function effectiveControlMode(record: WorkerRecord): {
  mode: WorkerRecord["control_mode"];
  /** 被降级的原因；未被降级为 undefined */
  demoted_reason?: string | undefined;
} {
  if (record.control_mode === "UNCONTROLLED_EXTERNAL") {
    return { mode: "UNCONTROLLED_EXTERNAL" };
  }
  const verified = record.verified_on;
  if (verified === undefined) {
    return {
      mode: "UNCONTROLLED_EXTERNAL",
      demoted_reason:
        "记录标为受控档但缺 verified_on 实测记录；按未实测处理，降级为 UNCONTROLLED_EXTERNAL",
    };
  }
  const current = fingerprintOf(record);
  if (verified.fingerprint !== current) {
    return {
      mode: "UNCONTROLLED_EXTERNAL",
      demoted_reason:
        "适配器版本 / 启动命令 / 能力声明已变更（指纹不一致），原探测结论失效；降级为 UNCONTROLLED_EXTERNAL 待重验",
    };
  }
  return { mode: record.control_mode };
}

/**
 * 校验注册请求，产出待落盘记录（档位**恒为** `UNCONTROLLED_EXTERNAL`）。
 *
 * 注意这里不调用 `validateAdapterCapability(decl, "UNCONTROLLED_EXTERNAL")`
 * 之外的任何档位校验：注册阶段的语义就是「先当非受控收进来」，
 * 受控档的能力校验发生在**升格**时（`promoteControlMode` 会重跑）。
 */
export function normalizeRegistration(raw: unknown, now: string): WorkerRecord {
  if (raw === null || typeof raw !== "object") {
    throw new WorkerRegistrationError(
      E_WORKER_DECLARATION_INVALID,
      "注册请求体必须是对象",
    );
  }
  const body = raw as Record<string, unknown>;

  for (const field of FORBIDDEN_REGISTRATION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      throw new WorkerRegistrationError(
        E_WORKER_FORBIDDEN_FIELD,
        `注册请求不得携带 \`${field}\`：档位与实测记录只能由服务端在探测通过后写入（禁止「填表即受控」）`,
      );
    }
  }

  const adapterId = body["adapter_id"];
  if (!isNonEmptyString(adapterId)) {
    throw new WorkerRegistrationError(
      E_WORKER_ID_INVALID,
      "adapter_id 必填（非空字符串）",
    );
  }
  const adapterVersion = body["adapter_version"];
  if (!isNonEmptyString(adapterVersion)) {
    throw new WorkerRegistrationError(
      E_WORKER_VERSION_REQUIRED,
      "adapter_version 必填（非空字符串）；未声明版本无法绑定探测结论",
    );
  }

  const launch = normalizeLaunch(body["launch"]);
  const declaration = normalizeDeclaration(body["declaration"], adapterId);

  return {
    adapter_id: adapterId.trim(),
    adapter_version: adapterVersion.trim(),
    launch,
    declaration,
    // 直写档恒为非受控（红线）
    control_mode: "UNCONTROLLED_EXTERNAL",
    builtin: false,
    created_at: now,
    updated_at: now,
  };
}

function normalizeLaunch(raw: unknown): WorkerLaunchSpec {
  if (raw === null || typeof raw !== "object") {
    throw new WorkerRegistrationError(
      E_WORKER_LAUNCH_REQUIRED,
      "launch 必填（{ command, args? }）；不接受 shell 字符串",
    );
  }
  const obj = raw as Record<string, unknown>;
  const command = obj["command"];
  if (!isNonEmptyString(command)) {
    throw new WorkerRegistrationError(
      E_WORKER_LAUNCH_REQUIRED,
      "launch.command 必填（可执行名或绝对路径）",
    );
  }
  // shell 元字符一律拒绝：这一层不做 shell 解析，混进来只可能是误用或注入
  if (/[;&|`$><\n\r]/.test(command) || /\s/.test(command.trim())) {
    throw new WorkerRegistrationError(
      E_WORKER_LAUNCH_REQUIRED,
      "launch.command 只能是单个可执行名 / 绝对路径（含空格、shell 元字符一律拒绝）",
    );
  }
  const rawArgs = obj["args"];
  if (rawArgs !== undefined && !Array.isArray(rawArgs)) {
    throw new WorkerRegistrationError(
      E_WORKER_LAUNCH_REQUIRED,
      "launch.args 必须是字符串数组",
    );
  }
  const args = (rawArgs ?? []).map((arg) => {
    if (typeof arg !== "string") {
      throw new WorkerRegistrationError(
        E_WORKER_LAUNCH_REQUIRED,
        "launch.args 的每一项都必须是字符串",
      );
    }
    return arg;
  });
  return { command: command.trim(), args };
}

const FILESYSTEM_VALUES = ["GATEWAY_ONLY", "DIRECT_UNCONTROLLED"] as const;
const COMMAND_VALUES = ["WHITELIST_ONLY", "UNRESTRICTED_SHELL"] as const;
const METERING_VALUES = ["PROVIDER", "LOCAL_ESTIMATE"] as const;
const NETWORK_VALUES = ["NONE", "EXPLICIT_ONLY", "DIRECT_INTERNET"] as const;
const PLATFORM_VALUES = [
  "darwin-arm64",
  "darwin-x64",
  "linux-x64",
  "win32-x64",
] as const;

/**
 * 能力声明校验（结构层）。
 *
 * 为什么在 daemon 侧再校验一遍而不是复用 zod：`workerSpecSchema` 描述的是**合同内**
 * 的 worker_spec（5+2 键），不是适配器的 9 项能力声明；两者不是同一个东西，
 * 混用会让「合同字段」和「能力声明」的边界糊掉。
 */
function normalizeDeclaration(
  raw: unknown,
  adapterId: string,
): AdapterCapabilityDeclaration {
  if (raw === null || typeof raw !== "object") {
    throw new WorkerRegistrationError(
      E_WORKER_DECLARATION_INVALID,
      "declaration 必填（9 项能力声明）",
    );
  }
  const obj = raw as Record<string, unknown>;

  const pick = <T extends string>(key: string, allowed: readonly T[]): T => {
    const value = obj[key];
    if (typeof value !== "string" || !allowed.includes(value as T)) {
      throw new WorkerRegistrationError(
        E_WORKER_DECLARATION_INVALID,
        `declaration.${key} 必填，取值限 ${allowed.join(" | ")}`,
      );
    }
    return value as T;
  };

  const knownRaw = obj["known_limitations"];
  const known_limitations = Array.isArray(knownRaw)
    ? knownRaw.filter((item): item is string => typeof item === "string")
    : [];
  if (known_limitations.length === 0) {
    throw new WorkerRegistrationError(
      E_WORKER_DECLARATION_INVALID,
      "declaration.known_limitations 必须至少一条（G-10；不许宣称零限制）",
    );
  }

  const platformRaw = obj["platform_support"];
  const platform_support = Array.isArray(platformRaw)
    ? platformRaw.filter((item): item is (typeof PLATFORM_VALUES)[number] =>
        PLATFORM_VALUES.includes(item as (typeof PLATFORM_VALUES)[number]),
      )
    : [];
  if (platform_support.length === 0) {
    throw new WorkerRegistrationError(
      E_WORKER_DECLARATION_INVALID,
      "declaration.platform_support 至少一个平台",
    );
  }

  const toolInterception = obj["tool_interception_supported"];
  if (typeof toolInterception !== "boolean") {
    throw new WorkerRegistrationError(
      E_WORKER_DECLARATION_INVALID,
      "declaration.tool_interception_supported 必填（布尔）",
    );
  }

  return {
    // adapter_id 以**请求体顶层**为准：声明里的 id 与注册 id 不一致会让
    // 「探测结论绑定的对象」和「注册的对象」错位，这里强制同名而不是信任调用方
    adapter_id: adapterId,
    protocol_version: isNonEmptyString(obj["protocol_version"])
      ? obj["protocol_version"].trim()
      : "1.0.0",
    model_metering_source: pick("model_metering_source", METERING_VALUES),
    tool_interception_supported: toolInterception,
    filesystem_permissions: pick("filesystem_permissions", FILESYSTEM_VALUES),
    command_permissions: pick("command_permissions", COMMAND_VALUES),
    cancellation_supported: obj["cancellation_supported"] !== false,
    session_recovery_supported: obj["session_recovery_supported"] === true,
    network_requirements: pick("network_requirements", NETWORK_VALUES),
    platform_support: [...platform_support],
    known_limitations: [...known_limitations],
  };
}
