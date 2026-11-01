/** TASK-C.1 工作台共享类型（v1.3.3：运行模式为 VIBE / PROTECTED，见架构规范 §0.6） */
export type RunMode = "VIBE" | "PROTECTED";
/**
 * TASK-W.5c-i：与合同 `worker_spec.control_mode` 同步为三值。
 * 本类型仅用于工作台**展示**，不涉及门禁判定；窗口期 `SANDBOX_ENFORCED`
 * 不改变右栏 `role:"partner"` 只读白名单（J.1）与任何既有门禁。
 */
export type WorkerControl =
  | "GATEWAY_ENFORCED"
  | "SANDBOX_ENFORCED"
  | "UNCONTROLLED_EXTERNAL";
export type ExecutionStatus =
  "IDLE" | "APPROVED" | "EXECUTING" | "PAUSED" | "DONE";

export interface ActiveContract {
  contractId: string;
  worktreePath: string;
  approved: boolean;
  status: ExecutionStatus;
}

export interface FileNode {
  name: string;
  path: string;
  children?: FileNode[];
}

export const RUN_MODE_LABEL: Record<RunMode, string> = {
  VIBE: "自由模式 VIBE",
  PROTECTED: "保护模式 PROTECTED",
};

export const EXECUTION_STATUS_LABEL: Record<ExecutionStatus, string> = {
  IDLE: "空闲",
  APPROVED: "已批准，待执行",
  EXECUTING: "执行中",
  PAUSED: "已暂停",
  DONE: "已完成",
};
