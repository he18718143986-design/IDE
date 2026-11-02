import path from "node:path";

/**
 * TASK-W.4：运行时复检拦截器。
 *
 * 每个工具调用前复检 Adapter 能力与调用通道；一旦出现：
 * - 启动配置被改（声明漂移）；
 * - 原生 FS/Shell 未被拦截；
 * - 未知通道 / 绕过 Gateway 的原生工具；
 * - 跨 Worktree 访问主树或 Worktree 外路径；
 * 立即：
 * 1. 降级为 `UNCONTROLLED_EXTERNAL`；
 * 2. 停止受控执行（后续调用一律拒绝）；
 * 3. 禁止产出证据（canProduceEvidence=false）；
 * 4. 广播 `GATEWAY_VIOLATION`。
 */

export const E_UNSAFE_EXECUTION = "E_UNSAFE_EXECUTION";

export type GatewayViolationCode =
  | "CONFIG_CHANGED"
  | "NATIVE_FS_UNCONTROLLED"
  | "NATIVE_SHELL_UNCONTROLLED"
  | "UNKNOWN_CHANNEL"
  | "HOST_PATH_ESCAPE"
  | "CROSS_WORKTREE_ACCESS"
  | "UNAUTHORIZED_SHELL"
  | "EXECUTION_STOPPED";

export interface AdapterSnapshot {
  adapter_id: string;
  /**
   * TASK-W.5c-ii：扩为三值。`SANDBOX_ENFORCED` 是**受控**档位（容器隔离），
   * 降级路径仍统一置 `UNCONTROLLED_EXTERNAL`——不得把沙箱档误判为不受控，
   * 否则拦截器会放行本应拦截的操作。
   */
  control_mode:
    "GATEWAY_ENFORCED" | "SANDBOX_ENFORCED" | "UNCONTROLLED_EXTERNAL";
  tool_interception_supported: boolean;
  filesystem_permissions: "GATEWAY_ONLY" | "DIRECT_UNCONTROLLED";
  command_permissions: "WHITELIST_ONLY" | "UNRESTRICTED_SHELL";
  /** 启动配置指纹（协议版本、平台矩阵、模型等） */
  config_fingerprint: string;
}

export interface GatewayViolation {
  type: "GATEWAY_VIOLATION";
  code: GatewayViolationCode;
  reason: string;
  adapter_id: string;
  at: string;
}

export interface RuntimeInterceptorOptions {
  snapshot: AdapterSnapshot;
  worktreeRoot: string;
  /** 许可的工具名（默认受控 6 工具 + declare_complete） */
  knownTools?: readonly string[];
  /** 已授权的命令别名（exec_command 只允许这些） */
  allowedAliases?: readonly string[];
  broadcast?: ((violation: GatewayViolation) => void) | undefined;
  onDowngrade?: ((violation: GatewayViolation) => void) | undefined;
}

export const DEFAULT_CONTROLLED_TOOLS = [
  "stagent_read_file",
  "stagent_write_file",
  "stagent_exec_command",
  "stagent_list_dir",
  "stagent_list_directory",
  "stagent_delete_file",
  "stagent_declare_complete",
] as const;

export interface ToolGuardResult {
  allowed: boolean;
  violation?: GatewayViolation;
}

export class RuntimeInterceptor {
  private readonly snapshot: AdapterSnapshot;
  private readonly worktreeRoot: string;
  private readonly knownTools: Set<string>;
  private readonly allowedAliases: Set<string>;
  private readonly broadcast?: ((v: GatewayViolation) => void) | undefined;
  private readonly onDowngrade?: ((v: GatewayViolation) => void) | undefined;

  private stopped = false;
  private canEvidence = true;
  private controlMode:
    "GATEWAY_ENFORCED" | "SANDBOX_ENFORCED" | "UNCONTROLLED_EXTERNAL";
  private violation: GatewayViolation | null = null;

  constructor(options: RuntimeInterceptorOptions) {
    this.snapshot = options.snapshot;
    this.worktreeRoot = path.resolve(options.worktreeRoot);
    this.knownTools = new Set(options.knownTools ?? DEFAULT_CONTROLLED_TOOLS);
    this.allowedAliases = new Set(options.allowedAliases ?? []);
    this.broadcast = options.broadcast;
    this.onDowngrade = options.onDowngrade;
    this.controlMode = options.snapshot.control_mode;
  }

  getControlMode():
    "GATEWAY_ENFORCED" | "SANDBOX_ENFORCED" | "UNCONTROLLED_EXTERNAL" {
    return this.controlMode;
  }

  isStopped(): boolean {
    return this.stopped;
  }

  canProduceEvidence(): boolean {
    return this.canEvidence;
  }

  getLastViolation(): GatewayViolation | null {
    return this.violation;
  }

  /** 复检 Adapter 声明是否漂移、是否仍满足受控前提 */
  checkAdapter(current: AdapterSnapshot): ToolGuardResult {
    if (this.stopped) return this.deny("EXECUTION_STOPPED", "受控执行已停止");
    if (
      current.adapter_id !== this.snapshot.adapter_id ||
      current.config_fingerprint !== this.snapshot.config_fingerprint
    ) {
      return this.deny(
        "CONFIG_CHANGED",
        "Adapter 启动配置或能力声明在执行期间被修改，已停止受控执行",
      );
    }
    if (current.filesystem_permissions !== "GATEWAY_ONLY") {
      return this.deny(
        "NATIVE_FS_UNCONTROLLED",
        "Adapter 声明原生文件系统直连，无法保证所有写入经受控 Gateway",
      );
    }
    if (
      current.command_permissions !== "WHITELIST_ONLY" ||
      !current.tool_interception_supported
    ) {
      return this.deny(
        "NATIVE_SHELL_UNCONTROLLED",
        "Adapter 声明无限制 Shell 或无法拦截工具调用，不能作为受控执行",
      );
    }
    return { allowed: true };
  }

  /** 每个工具调用前调用：通道与参数路径复检 */
  checkToolCall(tool: string, input: unknown): ToolGuardResult {
    if (this.stopped) return this.deny("EXECUTION_STOPPED", "受控执行已停止");
    if (!this.knownTools.has(tool)) {
      return this.deny(
        "UNKNOWN_CHANNEL",
        `出现未知工具通道：${tool}（可能是绕过 Gateway 的原生工具调用）`,
      );
    }

    const record =
      typeof input === "object" && input !== null
        ? (input as Record<string, unknown>)
        : {};

    // 写/删/读路径：不得逃逸 Worktree，也不得指向其它 Worktree 或主树
    const rawPath = record["path"];
    if (typeof rawPath === "string") {
      const target = path.resolve(this.worktreeRoot, rawPath);
      const rel = path.relative(this.worktreeRoot, target);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        return this.deny(
          "HOST_PATH_ESCAPE",
          `工具 ${tool} 试图访问 Worktree 之外的路径：${rawPath}`,
        );
      }
      if (
        rawPath.includes(".stagent/worktrees") ||
        rawPath.includes(".stagent\\worktrees")
      ) {
        return this.deny(
          "CROSS_WORKTREE_ACCESS",
          `工具 ${tool} 试图跨 Worktree 访问：${rawPath}`,
        );
      }
    }

    // 执行通道：受控模式只允许合同别名，旧 command/executable 视为原生 Shell
    if (tool === "stagent_exec_command") {
      if (
        record["command"] !== undefined ||
        record["executable"] !== undefined
      ) {
        return this.deny(
          "UNAUTHORIZED_SHELL",
          "检测到绕过 command_alias 的原生命令入口，已拒绝执行",
        );
      }
      const alias = record["command_alias"];
      if (typeof alias !== "string" || !this.allowedAliases.has(alias)) {
        return this.deny(
          "UNAUTHORIZED_SHELL",
          `未授权的命令别名：${String(alias ?? "(missing)")}`,
        );
      }
    }

    return { allowed: true };
  }

  private deny(code: GatewayViolationCode, reason: string): ToolGuardResult {
    const violation: GatewayViolation = {
      type: "GATEWAY_VIOLATION",
      code,
      reason,
      adapter_id: this.snapshot.adapter_id,
      at: new Date().toISOString(),
    };
    if (!this.stopped) {
      this.stopped = true;
      this.canEvidence = false;
      this.controlMode = "UNCONTROLLED_EXTERNAL";
      this.violation = violation;
      this.broadcast?.(violation);
      this.onDowngrade?.(violation);
    }
    return { allowed: false, violation };
  }
}
