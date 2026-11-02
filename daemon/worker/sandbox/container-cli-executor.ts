/**
 * TASK-W.9b: 外部 CLI 的容器执行桥。选择形态 B（runInSandbox + 产物收集），
 * 不把它包装成 Gateway session/tool mediation：本地 CLI 没有 Gateway capability，
 * 所以这个执行器只允许以 SANDBOX_ENFORCED 的事实产生见证。
 *
 * 执行完全委托给 ContainerHostPort/runInSandbox，不调用本地 spawn。宿主成功后，
 * 只收集调用方列明的 Worktree 相对路径；不扫描或回传任意文件。
 */
import fs from "node:fs";
import path from "node:path";
import {
  resolveEvidenceControlMode,
  type AdapterCapabilityDeclaration,
  type AdapterControlMode,
  type AdapterRunOutcome,
  type AdapterTaskInput,
  type CodingWorkerAdapter,
} from "../worker-adapter.interface";
import {
  runInSandbox,
  sandboxWitness,
  type ContainerHostPort,
  type SandboxRunInput,
  type SandboxRunOutcome,
} from "./container-host";

/**
 * Execution paths considered by W.9b (kept distinct rather than flattened into a generic "controlled" flag).
 * A Gateway session/tool-mediation path can claim GATEWAY_ENFORCED only when every tool call is
 * mediated by an actual Gateway capability and its writes stay within that Gateway scope.
 * B container CLI path does not provide per-tool mediation; it claims SANDBOX_ENFORCED only
 * after successful runInSandbox execution and a SandboxWitness. This implementation selects B.
 */
export const WORKER_EXECUTION_PATH_COMPARISON = {
  gateway: {
    control: "per-tool mediation through a real Gateway capability",
    artifacts:
      "Gateway-authorized writes; no host-side arbitrary artifact harvest",
    evidenceMode: "GATEWAY_ENFORCED only when that capability is present",
    availableHere: false,
  },
  container: {
    control:
      "ContainerHostPort.runInSandbox with Worktree-only mount and explicit network policy",
    artifacts:
      "exact expected relative files collected from task Worktree after successful exit",
    evidenceMode: "SANDBOX_ENFORCED only with this execution's SandboxWitness",
    availableHere: true,
  },
} as const;

const SAFE_CONTAINER_ENV_KEYS = new Set([
  "PATH",
  "HOME",
  "LANG",
  "LLM_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "CURSOR_API_KEY",
]);
const SENSITIVE_ENV_KEYS = new Set([
  "LLM_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "CURSOR_API_KEY",
]);

export interface ContainerCliExecutionInput {
  host: ContainerHostPort;
  worktreeRoot: string;
  argv: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  networkPolicy?: SandboxRunInput["networkPolicy"];
  allowedTargets?: string[];
  /** Exact relative file paths only. Empty means the CLI must write changes into the Worktree itself. */
  expectedArtifacts: readonly string[];
  /** Must reflect an actual declared capability; this executor supports SANDBOX_ENFORCED only. */
  declaredControlMode: AdapterControlMode;
  signal?: AbortSignal;
  maxArtifactBytes?: number;
  runSandbox?: typeof runInSandbox;
}

export interface ContainerCliExecutionResult extends AdapterRunOutcome {
  /** Evidence-facing mode resolved from this execution’s witness, never copied from declaration. */
  evidenceControlMode: AdapterControlMode;
}

export class ContainerCliExecutionError extends Error {
  readonly code:
    | "E_SANDBOX_CLI_REJECTED"
    | "E_SANDBOX_CLI_FAILED"
    | "E_SANDBOX_ARTIFACT_INVALID";
  readonly outcome?: SandboxRunOutcome | undefined;

  constructor(
    code: ContainerCliExecutionError["code"],
    message: string,
    outcome?: SandboxRunOutcome,
  ) {
    super(`[${code}] ${message}`);
    this.name = "ContainerCliExecutionError";
    this.code = code;
    this.outcome = outcome;
  }
}

function artifactPath(root: string, relative: string): string {
  if (
    relative.length === 0 ||
    path.isAbsolute(relative) ||
    relative.includes("\\") ||
    relative
      .split("/")
      .some(
        (part) =>
          part === "" ||
          part === "." ||
          part === ".." ||
          part === ".git" ||
          part === ".stagent",
      )
  ) {
    throw new ContainerCliExecutionError(
      "E_SANDBOX_ARTIFACT_INVALID",
      `expected artifact must be a safe Worktree-relative file path: ${relative}`,
    );
  }
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, ...relative.split("/"));
  const rel = path.relative(resolvedRoot, candidate);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new ContainerCliExecutionError(
      "E_SANDBOX_ARTIFACT_INVALID",
      `expected artifact escapes Worktree: ${relative}`,
    );
  }
  return candidate;
}

function readExpectedArtifact(
  root: string,
  relative: string,
  maxBytes: number,
): string {
  const absolute = artifactPath(root, relative);
  try {
    const resolvedRoot = fs.realpathSync(root);
    const resolved = fs.realpathSync(absolute);
    const rel = path.relative(resolvedRoot, resolved);
    if (
      rel === ".." ||
      rel.startsWith(`..${path.sep}`) ||
      path.isAbsolute(rel)
    ) {
      throw new ContainerCliExecutionError(
        "E_SANDBOX_ARTIFACT_INVALID",
        `artifact resolves outside Worktree: ${relative}`,
      );
    }
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new ContainerCliExecutionError(
        "E_SANDBOX_ARTIFACT_INVALID",
        `expected artifact is not a regular file: ${relative}`,
      );
    }
    if (stat.size > maxBytes) {
      throw new ContainerCliExecutionError(
        "E_SANDBOX_ARTIFACT_INVALID",
        `expected artifact exceeds ${maxBytes} bytes: ${relative}`,
      );
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(
      fs.readFileSync(absolute),
    );
  } catch (error) {
    if (error instanceof ContainerCliExecutionError) throw error;
    throw new ContainerCliExecutionError(
      "E_SANDBOX_ARTIFACT_INVALID",
      `expected artifact could not be safely read: ${relative}`,
    );
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Run one external CLI only inside the injected container and collect exact expected files. */
export async function executeContainerCli(
  input: ContainerCliExecutionInput,
): Promise<ContainerCliExecutionResult> {
  const unsafeEnv = Object.keys(input.env ?? {}).filter(
    (key) => !SAFE_CONTAINER_ENV_KEYS.has(key),
  );
  if (unsafeEnv.length > 0) {
    throw new ContainerCliExecutionError(
      "E_SANDBOX_CLI_REJECTED",
      `container CLI environment contains non-allowlisted key(s): ${unsafeEnv.join(", ")}`,
    );
  }
  const sandboxInput: SandboxRunInput = {
    worktreeRoot: input.worktreeRoot,
    argv: [...input.argv],
    networkPolicy: input.networkPolicy ?? "DENY",
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    ...(input.env === undefined ? {} : { env: input.env }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.allowedTargets === undefined
      ? {}
      : { allowedTargets: input.allowedTargets }),
  };
  const declaredMode = input.declaredControlMode;
  if (declaredMode !== "SANDBOX_ENFORCED") {
    throw new ContainerCliExecutionError(
      "E_SANDBOX_CLI_REJECTED",
      "container CLI executor cannot claim GATEWAY_ENFORCED or UNCONTROLLED_EXTERNAL execution",
    );
  }
  if (input.host.isAvailable() !== true) {
    throw new ContainerCliExecutionError(
      "E_SANDBOX_CLI_REJECTED",
      "container host is unavailable; refusing external execution",
    );
  }
  // Reject unsafe artifact declarations before starting any external process.
  for (const artifact of input.expectedArtifacts)
    artifactPath(input.worktreeRoot, artifact);
  const runner = input.runSandbox ?? runInSandbox;
  const outcome = await runner(input.host, sandboxInput, input.signal);
  if (outcome.via === "rejected") {
    throw new ContainerCliExecutionError(
      "E_SANDBOX_CLI_REJECTED",
      `container host rejected execution (${outcome.rejection ?? "unknown"}); no witness or artifacts accepted`,
      outcome,
    );
  }
  if (outcome.via !== "exit" || outcome.exitCode !== 0) {
    throw new ContainerCliExecutionError(
      "E_SANDBOX_CLI_FAILED",
      `container execution did not succeed (via=${outcome.via}, exit=${String(outcome.exitCode)}); no witness or artifacts accepted`,
      outcome,
    );
  }

  const maxBytes = input.maxArtifactBytes ?? 5 * 1024 * 1024;
  const changes = input.expectedArtifacts.map((relative) => ({
    path: relative,
    content: readExpectedArtifact(input.worktreeRoot, relative, maxBytes),
  }));
  const redact = (text: string): string => {
    let safe = text;
    for (const [key, value] of Object.entries(input.env ?? {})) {
      if (SENSITIVE_ENV_KEYS.has(key) && value.length > 0) {
        safe = safe.split(value).join("[REDACTED]");
      }
    }
    return safe;
  };
  const log = [
    `container-cli: host=${input.host.kind ?? "unknown"} via=${outcome.via} exit=${outcome.exitCode} duration_ms=${outcome.durationMs}`,
    ...redact(outcome.stdout)
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .slice(-40)
      .map((line) => `stdout: ${line}`),
    ...(outcome.stderr.trim().length === 0
      ? []
      : [`stderr: ${redact(outcome.stderr.slice(-2000))}`]),
  ];
  const sandbox = sandboxWitness(input.host, sandboxInput, outcome);
  return {
    changes,
    log,
    usage: {
      inputTokens: 0,
      outputTokens: estimateTokens(outcome.stdout),
    },
    sandbox,
    evidenceControlMode: resolveEvidenceControlMode(declaredMode, sandbox),
  };
}


export interface ContainerCliAdapterOptions {
  host: ContainerHostPort;
  declaration: AdapterCapabilityDeclaration;
  declaredControlMode?: AdapterControlMode;
  buildArgv: (input: AdapterTaskInput) => string[];
  expectedArtifacts?: (input: AdapterTaskInput) => readonly string[];
  networkPolicy?: SandboxRunInput["networkPolicy"];
  timeoutMs?: number;
  env?: Record<string, string>;
  allowedTargets?: string[];
  runSandbox?: typeof runInSandbox;
}

/**
 * TASK-W.9b: 外部 CLI 的容器沙箱适配器。
 * 遵循 CodingWorkerAdapter 契约：
 * - 声明与执行档位严格为 SANDBOX_ENFORCED；
 * - 没有本地 spawn，仅委托 executeContainerCli 在 ContainerHostPort 内部执行；
 * - 只有 exit 0 成功执行才产出 SandboxWitness 与预期的 Worktree 产物；
 * - 取消（signal）与超时按契约向下透传；
 * - 失败 / 拒绝 / 宿主不可用时显式抛错，不产出假 witness 或未验证产物。
 */
export class ContainerCliAdapter implements CodingWorkerAdapter {
  readonly declaration: AdapterCapabilityDeclaration;
  readonly kind = "CLI" as const;

  constructor(private readonly opts: ContainerCliAdapterOptions) {
    const mode = opts.declaredControlMode ?? "SANDBOX_ENFORCED";
    if (mode !== "SANDBOX_ENFORCED") {
      throw new Error(
        `ContainerCliAdapter declaredControlMode must be SANDBOX_ENFORCED, got ${mode}`,
      );
    }
    this.declaration = opts.declaration;
  }

  async run(
    input: AdapterTaskInput,
    signal?: AbortSignal,
  ): Promise<AdapterRunOutcome> {
    const outcome = await executeContainerCli({
      host: this.opts.host,
      worktreeRoot: input.worktree_root,
      argv: this.opts.buildArgv(input),
      expectedArtifacts: this.opts.expectedArtifacts?.(input) ?? [],
      declaredControlMode: "SANDBOX_ENFORCED",
      ...(this.opts.networkPolicy === undefined
        ? {}
        : { networkPolicy: this.opts.networkPolicy }),
      ...(this.opts.timeoutMs === undefined
        ? {}
        : { timeoutMs: this.opts.timeoutMs }),
      ...(this.opts.env === undefined ? {} : { env: this.opts.env }),
      ...(this.opts.allowedTargets === undefined
        ? {}
        : { allowedTargets: this.opts.allowedTargets }),
      ...(this.opts.runSandbox === undefined
        ? {}
        : { runSandbox: this.opts.runSandbox }),
      ...(signal === undefined ? {} : { signal }),
    });
    return {
      changes: outcome.changes,
      log: outcome.log,
      usage: outcome.usage,
      sandbox: outcome.sandbox,
    };
  }
}
