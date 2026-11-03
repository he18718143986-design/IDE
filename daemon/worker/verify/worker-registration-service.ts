/**
 * TASK-W.7：Worker 自助注册服务——把「填表 → 探测 → 升格」串起来。
 *
 * 分层与职责：
 * - `worker-registration.ts`：领域模型与判定（纯函数）
 * - `worker-probe.ts`：探测包与升格判定（纯逻辑 + 注入执行面）
 * - `probe-execution-sandbox.ts`：容器执行面（经 `runInSandbox`）
 * - **本文件**：编排 + 持久化 + 注册表同步（唯一有副作用的一层）
 *
 * ## 一处必须说清的边界（不宣称端到端闭环）
 * 用户自注册的 Worker 只有「启动命令 + 能力声明」，**没有** `CodingWorkerAdapter.run()`
 * 实现，因此：
 * - 档位可以升到 `SANDBOX_ENFORCED`（这是**探测结论**，如实记录）；
 * - 但**派工仍然不可用**——没有派工工厂（`E_ADAPTER_NO_DISPATCH_FACTORY`）。
 * 本层绝不为了「看起来闭环」造一个假执行器：`declarationOnlyAdapter()` 的 `run()`
 * 只会抛 `E_WORKER_NO_EXECUTOR`。
 */

import { AdapterRegistry, AdapterRegistrationError } from "../adapter-registry";
import {
  isControlledDispatchable,
  isAdapterExecutable,
  requireControlledDispatch,
  WorkerDispatchError,
  E_ADAPTER_SANDBOX_LOCKED,
  type WorkerDispatchFactory,
  type WorkerDispatchContext,
  type DispatchedWorker,
} from "../worker-dispatch";
import { ContainerCliAdapter } from "../sandbox/container-cli-executor";
import {
  validateAdapterCapability,
  type AdapterCapabilityDeclaration,
  type AdapterControlMode,
  type AdapterRunOutcome,
  type AdapterTaskInput,
  type CodingWorkerAdapter,
} from "../worker-adapter.interface";
import { DockerContainerHost } from "../cli-host/docker-container-host";
import type { ContainerHostPort } from "../sandbox/container-host";
import {
  E_PROBE_EXECUTOR_UNIMPLEMENTED,
  E_WORKER_BUILTIN_LOCKED,
  E_WORKER_DUPLICATED,
  E_WORKER_NOT_FOUND,
  E_WORKER_PROMOTION_REFUSED,
  WorkerRegistrationError,
  effectiveControlMode,
  fingerprintOf,
  normalizeRegistration,
  type WorkerLaunchSpec,
  type WorkerProbeReportSummary,
  type WorkerRecord,
} from "./worker-registration";
import {
  runProbePack,
  type ProbeExecutionPort,
  type ProbePackResult,
} from "./worker-probe";
import { SandboxProbeExecutionPort } from "./probe-execution-sandbox";
import { loadWorkerStore, upsertWorker, deleteWorker } from "./worker-store";

/** 可升格的目标档位（`UNCONTROLLED_EXTERNAL` 不是「目标」，降级不需要探测） */
export type ProbeTargetMode = "GATEWAY_ENFORCED" | "SANDBOX_ENFORCED";

/** 对外视图（列表 / 详情共用） */
export interface WorkerView {
  adapter_id: string;
  adapter_version: string;
  /** 生效档位（指纹失效即降级后的结果） */
  control_mode: AdapterControlMode;
  /** 记录里写的档位（与 `control_mode` 不同即表示已被降级） */
  declared_control_mode: AdapterControlMode;
  builtin: boolean;
  kind?: string | undefined;
  /** 是否可派工；用户自注册项恒为 false（无执行器） */
  dispatchable: boolean;
  /** 不可派工的原因 */
  dispatch_blocked_reason?: string | undefined;
  demoted_reason?: string | undefined;
  launch: WorkerLaunchSpec;
  verified_on?: WorkerRecord["verified_on"] | undefined;
  last_report?: WorkerProbeReportSummary | undefined;
  created_at: string;
  updated_at: string;
}

export interface VerifyOutcome {
  worker: WorkerView;
  report: WorkerProbeReportSummary;
  control_mode: AdapterControlMode;
  promoted: boolean;
  refusals: string[];
}

export interface WorkerRegistrationServiceOptions {
  repoRoot: string;
  registry: AdapterRegistry;
  /** 时间源（测试注入；缺省 `new Date().toISOString()`） */
  now?: () => string;
  /**
   * 探测执行面工厂。缺省：
   * - `SANDBOX_ENFORCED` 目标 → 真实 `DockerContainerHost`（宿主不可用即拒，不降级）
   * - `GATEWAY_ENFORCED` 目标 → **未实现**（今日无 Gateway 探测执行器），抛
   *   `E_PROBE_EXECUTOR_UNIMPLEMENTED`
   */
  probePortFactory?: (input: {
    target_mode: ProbeTargetMode;
    record: WorkerRecord;
  }) => ProbeExecutionPort;
  /** 构造容器宿主（测试注入桩；缺省 `new DockerContainerHost()`） */
  createContainerHost?: () => ContainerHostPort;
}

/** 内建标识：无启动命令的内建适配器在视图里没有 `launch` */
const BUILTIN_LAUNCH: WorkerLaunchSpec = { command: "<builtin>", args: [] };

/**
 * 仅声明的适配器：让注册表能统一持有用户自注册项（`promoteControlMode` 才有对象可改）。
 *
 * `run()` **不实现任何执行**，只抛错——这是刻意的：假装能跑等于伪造执行器，
 * 而「谁执行用户装的 CLI」是独立问题（需要派工工厂），不在 W.7 范围内。
 */
function declarationOnlyAdapter(
  adapterId: string,
  declaration: AdapterCapabilityDeclaration,
): CodingWorkerAdapter & { has_executor: false } {
  return {
    kind: "CLI",
    declaration,
    has_executor: false,
    async run(
      _input: AdapterTaskInput,
      _signal?: AbortSignal,
    ): Promise<AdapterRunOutcome> {
      throw new WorkerRegistrationError(
        "E_WORKER_NO_EXECUTOR",
        `worker ${adapterId} 只有能力声明，没有执行器；请为其接入派工工厂后再派工`,
      );
    },
  };
}

export class WorkerRegistrationService {
  private readonly repoRoot: string;
  private readonly registry: AdapterRegistry;
  private readonly now: () => string;
  private readonly probePortFactory:
    WorkerRegistrationServiceOptions["probePortFactory"] | undefined;
  private readonly createContainerHost: () => ContainerHostPort;

  constructor(options: WorkerRegistrationServiceOptions) {
    this.repoRoot = options.repoRoot;
    this.registry = options.registry;
    this.registry.bindProbeReportAuthority((reportId) => {
      const match = loadWorkerStore(this.repoRoot).workers.find(
        (worker) => worker.last_report?.report_id === reportId,
      );
      if (!match?.last_report) return undefined;
      // The report and current worker snapshot are both read from the server-owned store.
      // Return both so the registry can distinguish a stale/mismatched report from absence.
      return {
        report: match.last_report,
        current_adapter_id: match.adapter_id,
        current_fingerprint: fingerprintOf(match),
      };
    });
    this.now = options.now ?? (() => new Date().toISOString());
    this.probePortFactory = options.probePortFactory;
    this.createContainerHost =
      options.createContainerHost ?? (() => new DockerContainerHost());
  }

  /** 列表：内建（来自注册表）+ 自注册（来自 `.stagent/workers.json`） */
  /**
   * TASK-W.9c：注销 / 撤销自注册 Worker。
   * - 从持久化存储删除记录；
   * - 同步从注册中心注销，并吊销其已绑定的派工工厂与受控控制档（撤销归零）。
   */
  unregister(adapterId: string): boolean {
    const deletedFromStore = deleteWorker(this.repoRoot, adapterId);
    const deletedFromRegistry = this.registry.unregister(adapterId);
    return deletedFromStore || deletedFromRegistry;
  }

  /** TASK-W.9c：撤销注册（unregister 别名） */
  revoke(adapterId: string): boolean {
    return this.unregister(adapterId);
  }

  /**
   * TASK-W.9c：为自注册 Worker 挂接派工工厂，强绑定协议版本。
   */
  registerDispatchFactory(
    adapterId: string,
    factory: WorkerDispatchFactory,
    expectedVersion?: string,
  ): void {
    this.registry.registerDispatchFactory(adapterId, factory, expectedVersion);
  }

  /**
   * TASK-W.9c：为已通过探测升格的自注册 Worker 构造标准容器沙箱派工工厂。
   * 严格复用 W.9b 的 ContainerCliAdapter + executeContainerCli 桥，产出合法 SandboxWitness。
   */
  createContainerCliDispatchFactory(
    record: WorkerRecord,
    options?: {
      expectedArtifacts?: (input: AdapterTaskInput) => readonly string[];
      env?: Record<string, string>;
    },
  ): WorkerDispatchFactory {
    return (context: WorkerDispatchContext): DispatchedWorker => {
      const host = context.containerHost;
      if (!host || host.isAvailable() !== true) {
        throw new WorkerDispatchError(
          E_ADAPTER_SANDBOX_LOCKED,
          record.adapter_id,
          "未注入可用容器宿主 ContainerHostPort",
        );
      }
      const adapter = new ContainerCliAdapter({
        host,
        declaration: record.declaration,
        declaredControlMode: "SANDBOX_ENFORCED",
        buildArgv: (_taskInput) => [
          record.launch.command,
          ...record.launch.args,
        ],
        ...(options?.env === undefined ? {} : { env: options.env }),
        ...(options?.expectedArtifacts === undefined
          ? {}
          : { expectedArtifacts: options.expectedArtifacts }),
      });
      return {
        run: async (signal?: AbortSignal) => {
          const outcome = await adapter.run(
            {
              contract: context.contract,
              contract_revision: context.contract.contract_revision,
              worktree_root: context.worktreeRoot,
              system_prompt: "",
              exposed_tools: [],
            },
            signal,
          );
          return {
            applied: outcome.changes.length > 0,
            changes: outcome.changes,
            log: outcome.log,
            usage: outcome.usage,
            blockers: [],
            sandbox: outcome.sandbox,
          };
        },
      };
    };
  }

  /**
   * TASK-W.9c：为已通过探测升格的自注册 Worker 接入真实容器执行面与派工工厂。
   * 严格复用 W.9b 的 ContainerCliAdapter + executeContainerCli 桥，产出合法 SandboxWitness。
   */
  attachContainerCliExecutor(
    adapterId: string,
    options?: {
      expectedArtifacts?: (input: AdapterTaskInput) => readonly string[];
      env?: Record<string, string>;
    },
  ): void {
    const record = loadWorkerStore(this.repoRoot).workers.find(
      (w) => w.adapter_id === adapterId,
    );
    if (!record) {
      throw new WorkerRegistrationError(
        E_WORKER_NOT_FOUND,
        `worker not found: ${adapterId}`,
      );
    }
    const effective = effectiveControlMode(record);
    if (effective.mode !== "SANDBOX_ENFORCED") {
      throw new WorkerRegistrationError(
        E_WORKER_PROMOTION_REFUSED,
        `worker ${adapterId} 当前档位为 ${effective.mode}，只有 SANDBOX_ENFORCED 档位允许挂接容器执行面`,
      );
    }
    let host: ContainerHostPort;
    try {
      host = this.createContainerHost();
    } catch (err) {
      throw new WorkerDispatchError(
        E_ADAPTER_SANDBOX_LOCKED,
        adapterId,
        `容器宿主不可用: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const adapter = new ContainerCliAdapter({
      host,
      declaration: record.declaration,
      declaredControlMode: "SANDBOX_ENFORCED",
      buildArgv: (_taskInput) => [record.launch.command, ...record.launch.args],
      ...(options?.env === undefined ? {} : { env: options.env }),
      ...(options?.expectedArtifacts === undefined
        ? {}
        : { expectedArtifacts: options.expectedArtifacts }),
    });

    this.registry.attachExecutableAdapter(adapterId, adapter);

    const factory = this.createContainerCliDispatchFactory(record, options);
    this.registry.registerDispatchFactory(
      adapterId,
      factory,
      record.declaration?.protocol_version,
    );
  }

  list(): WorkerView[] {
    const store = loadWorkerStore(this.repoRoot).workers;
    // 自注册项在注册时也会挂进注册表（升格需要同一对象），故这里按**存储**判定归属：
    // 有存储记录的自注册项以存储为准，避免同一条在列表里出现两次。
    const selfIds = new Set(store.map((record) => record.adapter_id));
    const builtins = this.registry
      .list()
      .filter((entry) => !selfIds.has(entry.declaration.adapter_id))
      .map((entry) => this.builtinView(entry));
    return [...builtins, ...store.map((record) => this.storedView(record))];
  }

  get(adapterId: string): WorkerView {
    // 存储优先：自注册项的记录才是权威（注册表里那份只是「仅声明适配器」句柄）
    const record = loadWorkerStore(this.repoRoot).workers.find(
      (item) => item.adapter_id === adapterId,
    );
    if (record !== undefined) return this.storedView(record);
    const builtin = this.registry.get(adapterId);
    if (builtin !== undefined) return this.builtinView(builtin);
    throw new WorkerRegistrationError(
      E_WORKER_NOT_FOUND,
      `未注册的 worker：${adapterId}`,
    );
  }

  /**
   * 自助注册：**恒以 `UNCONTROLLED_EXTERNAL` 收进来**，档位只能靠探测升。
   * 请求体出现档位 / 实测类字段时 `normalizeRegistration` 直接拒绝（不是忽略）。
   */
  register(raw: unknown): WorkerView {
    const record = normalizeRegistration(raw, this.now());

    // 先查存储（自注册项），再查注册表（内建项）：自注册项也挂在注册表里，
    // 顺序颠倒会把「重复注册」误报成「被内建占用」。
    const existing = loadWorkerStore(this.repoRoot).workers.find(
      (item) => item.adapter_id === record.adapter_id,
    );
    if (existing !== undefined) {
      throw new WorkerRegistrationError(
        E_WORKER_DUPLICATED,
        `adapter_id 已注册：${record.adapter_id}（如需换版本请先改版本号再重验，避免覆盖已验证结论）`,
      );
    }
    if (this.registry.has(record.adapter_id)) {
      throw new WorkerRegistrationError(
        E_WORKER_DUPLICATED,
        `adapter_id 已被内建适配器占用：${record.adapter_id}`,
      );
    }

    upsertWorker(this.repoRoot, record);
    this.attachToRegistry(record);
    return this.storedView(record);
  }

  /**
   * 探测并（通过时）升格。
   *
   * 失败路径也落盘：`last_report` 记录失败项、档位保持 `UNCONTROLLED_EXTERNAL`——
   * 「探测失败但档位升了」这种状态在本流程里不存在。
   */
  async verify(
    adapterId: string,
    options: { target_mode: ProbeTargetMode },
  ): Promise<VerifyOutcome> {
    const targetMode = options.target_mode;
    // 判定顺序很重要：先看存储（自注册项），再看注册表（内建项）。
    // 自注册项在注册时也挂在注册表里，若先看注册表会把它们误判成内建项而永久锁死。
    const record = loadWorkerStore(this.repoRoot).workers.find(
      (item) => item.adapter_id === adapterId,
    );
    if (record === undefined) {
      if (this.registry.has(adapterId)) {
        // 内建项的档位是代码事实，不许经 API 改写
        throw new WorkerRegistrationError(
          E_WORKER_BUILTIN_LOCKED,
          `${adapterId} 是内建适配器，档位由代码决定，不接受自助探测改写`,
        );
      }
      throw new WorkerRegistrationError(
        E_WORKER_NOT_FOUND,
        `未注册的 worker：${adapterId}`,
      );
    }

    const port = this.resolveProbePort(targetMode, record);
    const result: ProbePackResult = await runProbePack({
      record,
      targetMode,
      port,
      now: this.now(),
    });
    // 探测工作区是临时目录：跑完即清（内含容器写过的文件，不该留在机器上）
    (port as { dispose?: () => void }).dispose?.();

    const updated: WorkerRecord = {
      ...record,
      last_report: result.report,
      updated_at: this.now(),
    };

    // Persist the authoritative report before the registry consumes it. On rejection,
    // this leaves the worker at its prior (non-controlled) mode with an auditable report.
    upsertWorker(this.repoRoot, updated);

    let promoted = false;
    if (result.promotion.allowed) {
      // 双写：存储记录（供 UI/列表）+ 注册表（供 `/api/adapters` 与派工门禁）
      updated.control_mode = result.promotion.control_mode;
      updated.verified_on = {
        cli_version: record.adapter_version,
        verified_at: result.report.verified_at,
        fingerprint: result.report.fingerprint,
      };
      this.attachToRegistry(updated);
      promoted = this.promoteInRegistry(
        updated,
        targetMode,
        result.report.fingerprint,
      );
    } else {
      updated.control_mode = "UNCONTROLLED_EXTERNAL";
      updated.verified_on = undefined;
    }
    upsertWorker(this.repoRoot, updated);

    return {
      worker: this.storedView(updated),
      report: result.report,
      control_mode: result.promotion.control_mode,
      promoted,
      refusals: result.promotion.refusals,
    };
  }

  /** 仅把档位在注册表里推进一格；未注册时返回 false（不假装成功） */
  private promoteInRegistry(
    record: WorkerRecord,
    targetMode: ProbeTargetMode,
    fingerprint: string,
  ): boolean {
    if (!this.registry.has(record.adapter_id)) return false;
    try {
      this.registry.promoteControlMode(record.adapter_id, targetMode, {
        report_id: record.last_report?.report_id,
        report_fingerprint: fingerprint,
        decided_at: this.now(),
      });
      return true;
    } catch (err) {
      if (err instanceof AdapterRegistrationError) {
        const reportRejection = err.rejection.startsWith("E_PROBE_REPORT_")
          ? err.rejection
          : E_WORKER_PROMOTION_REFUSED;
        throw new WorkerRegistrationError(
          reportRejection,
          `注册表拒绝升格：${err.message}`,
        );
      }
      throw err;
    }
  }

  /** 把记录以「仅声明适配器」挂进注册表（标识档校验，只登记不授予受控） */
  private attachToRegistry(record: WorkerRecord): void {
    if (this.registry.has(record.adapter_id)) return;
    const adapter = declarationOnlyAdapter(
      record.adapter_id,
      record.declaration,
    );
    const validation = validateAdapterCapability(
      record.declaration,
      "UNCONTROLLED_EXTERNAL",
    );
    if (!validation.ok) {
      throw new WorkerRegistrationError(
        validation.code,
        `能力声明不满足登记要求：${validation.reason}`,
      );
    }
    // 标识档：只登记 id / 协议版本，不授予受控
    this.registry.register(adapter, "UNCONTROLLED_EXTERNAL");
  }

  private resolveProbePort(
    targetMode: ProbeTargetMode,
    record: WorkerRecord,
  ): ProbeExecutionPort {
    if (this.probePortFactory !== undefined) {
      return this.probePortFactory({ target_mode: targetMode, record });
    }
    if (targetMode === "GATEWAY_ENFORCED") {
      // 诚实报未实现：今日没有「经 Gateway 的 CLI 探测执行器」。
      // 不用 mock 冒充生产，也不把 GATEWAY 目标偷偷降成 SANDBOX 探。
      throw new WorkerRegistrationError(
        E_PROBE_EXECUTOR_UNIMPLEMENTED,
        "GATEWAY_ENFORCED 目标的探测执行器尚未实现（今日无通用 Gateway CLI 适配器）；请选择 SANDBOX_ENFORCED 目标或注入自定义探测执行面",
      );
    }
    const host = this.createContainerHost();
    return new SandboxProbeExecutionPort({ host });
  }

  private builtinView(entry: {
    adapter: CodingWorkerAdapter;
    control_mode: AdapterControlMode;
    declaration: AdapterCapabilityDeclaration;
  }): WorkerView {
    let host: ContainerHostPort | undefined;
    try {
      host = this.createContainerHost();
    } catch {
      host = undefined;
    }
    const dispatchable = isControlledDispatchable(
      this.registry,
      entry.declaration.adapter_id,
      { containerHost: host },
    );
    return {
      adapter_id: entry.declaration.adapter_id,
      adapter_version: entry.declaration.protocol_version,
      control_mode: entry.control_mode,
      declared_control_mode: entry.control_mode,
      builtin: true,
      kind: entry.adapter.kind,
      dispatchable,
      dispatch_blocked_reason: dispatchable
        ? undefined
        : `档位为 ${entry.control_mode}，未通过派工门禁（门禁仅放行 GATEWAY_ENFORCED 或宿主可用的 SANDBOX_ENFORCED 且已挂接工厂）`,
      launch: BUILTIN_LAUNCH,
      created_at: "",
      updated_at: "",
    };
  }

  private storedView(record: WorkerRecord): WorkerView {
    const effective = effectiveControlMode(record);
    let host: ContainerHostPort | undefined;
    try {
      host = this.createContainerHost();
    } catch {
      host = undefined;
    }
    const dispatchable = isControlledDispatchable(
      this.registry,
      record.adapter_id,
      { containerHost: host },
    );
    let dispatchBlockedReason: string | undefined;
    if (!dispatchable) {
      const entry = this.registry.get(record.adapter_id);
      const factory = entry
        ? this.registry.getDispatchFactory(
            record.adapter_id,
            entry.declaration?.protocol_version,
          )
        : undefined;
      const isExec = entry ? isAdapterExecutable(entry.adapter) : false;

      if (effective.mode === "UNCONTROLLED_EXTERNAL") {
        dispatchBlockedReason =
          "自注册 worker 未接入派工工厂（UNCONTROLLED_EXTERNAL 且无 CodingWorkerAdapter.run 实现），档位记录不代表可派工";
      } else if (!factory) {
        dispatchBlockedReason =
          "自注册 worker 未接入派工工厂（dispatchFactory）；档位记录不代表可派工";
      } else if (!isExec) {
        dispatchBlockedReason =
          "自注册 worker 缺少合规执行面（无真实 run() 实现，仅有能力声明）；不可派工";
      } else {
        try {
          requireControlledDispatch(this.registry, record.adapter_id, {
            containerHost: host,
          });
        } catch (err) {
          dispatchBlockedReason =
            err instanceof Error ? err.message : String(err);
        }
      }
    }
    return {
      adapter_id: record.adapter_id,
      adapter_version: record.adapter_version,
      control_mode: effective.mode,
      declared_control_mode: record.control_mode,
      builtin: record.builtin,
      kind: "CLI",
      dispatchable,
      dispatch_blocked_reason: dispatchBlockedReason,
      demoted_reason: effective.demoted_reason,
      launch: record.launch,
      verified_on: record.verified_on,
      last_report: record.last_report,
      created_at: record.created_at,
      updated_at: record.updated_at,
    };
  }
}
