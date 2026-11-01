/**
 * TASK-L.15：部署目标适配器接口。
 */
import type { ReleaseRecord, ReleaseTargetConfig } from "../../src/lib/release/release";

export interface StepResult {
  ok: boolean;
  exit_code: number;
  argv: string[];
  log_tail: string;
  started_at: string;
  ended_at: string;
}

export interface ReleaseContext {
  release: ReleaseRecord;
  checkoutDir: string;
  /** deploy / health：含保险库注入；install / build：仅明文 build_env */
  env: Record<string, string>;
  target: ReleaseTargetConfig;
  repoRoot: string;
}

export interface ReleaseTargetAdapter {
  readonly kind: "local_process" | "user_command";
  build(ctx: ReleaseContext): Promise<StepResult>;
  deploy(ctx: ReleaseContext): Promise<StepResult>;
  health(ctx: ReleaseContext): Promise<StepResult>;
  stop?(ctx: ReleaseContext): Promise<StepResult>;
}
