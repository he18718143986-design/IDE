import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  SandboxRejectedError,
  validateSandboxInput,
  type ContainerHostPort,
  type SandboxMount,
  type SandboxRunInput,
  type SandboxRunOutcome,
} from "../sandbox/container-host";
import { spawnManaged, type ManagedProcess } from "./process-host";

/**
 * TASK-W.5c-iii：`ContainerHostPort` 的真实实现——Docker 容器宿主。
 *
 * 为什么落在这里：`cli-host` 是全仓**唯一**允许启动外部进程的目录
 * （`tests/unit/spawn-whitelist.test.ts` 静态闸门）。docker 客户端也是外部进程，
 * 因此实现必须留在本目录，且执行统一走 `spawnManaged`（结构化 argv、`shell:false`、
 * 整树回收），不新开启动入口。
 *
 * 隔离纪律（§4.2.3 P-17）：本文件的 `docker run` 是**真容器**；绝不使用
 * 「本地子进程 + 假装沙箱」的降级路径。宿主不可用 → 执行面返回 `rejected`
 * （`HOST_UNAVAILABLE`），绝不回落本地。
 *
 * 能兑现 / 不能兑现（失败关闭，不糊弄）：
 * - 兑现：唯一宿主挂载点＝任务 Worktree（`/work`）、`--cap-drop ALL` +
 *   `no-new-privileges`（提权负例）、`--network none`（`DENY`）、
 *   `--pids-limit` / `--memory` / `--cpus`（资源围栏）。
 * - **不能兑现**：`EXPLICIT_TARGETS` / `USER_APPROVED` 无法在 `docker run` 层逐目标
 *   限制出站 → **直接拒绝**（`NETWORK_TARGET_NOT_ALLOWED`），不假装放行。
 */

export interface DockerProbe {
  ok: boolean;
  /** 探测到的 Docker Engine 版本；失败为空串 */
  server_version: string;
  /** 探测细节（成功/失败原因），用于错误消息与证据 */
  detail: string;
}

export interface DockerContainerHostOptions {
  /** docker 可执行文件，默认 `docker` */
  dockerPath?: string;
  /** 镜像（默认 OpenHands 实测镜像），可传 `repo@sha256:...` 固定摘要 */
  image?: string;
  /** 容器内 Worktree 挂载点，默认 `/work` */
  containerWorkRoot?: string;
  /** 容器名前缀，默认 `stagent-sbx` */
  namePrefix?: string;
  /** `--memory`，默认 `2g` */
  memoryLimit?: string;
  /** `--cpus`，默认 `2` */
  cpus?: string;
  /** `--pids-limit`，默认 `512` */
  pidsLimit?: number;
  /**
   * 保留的能力（`--cap-add`）。恒先 `--cap-drop ALL`，只回补最小必要集。
   *
   * 默认 `["DAC_OVERRIDE"]` 是**实测约束**，不是偷懒：OpenHands 镜像的 `/app` 属
   * uid 42420、`entrypoint.sh` 为 `0770`，全量 cap-drop 后 root 连 stat 自己的
   * entrypoint 都会被拒（`permission denied`），容器根本起不来。回补这一项后
   * 容器内 `CapEff = 0x2`（只剩 DAC_OVERRIDE），NET_ADMIN / SYS_ADMIN /
   * SYS_PTRACE 等仍然全无。
   */
  capAdd?: string[];
  /** 可用性探测超时毫秒，默认 5000 */
  probeTimeoutMs?: number;
  /**
   * 强制覆盖可用性判定（**仅测试用**）。生产不传：真实判定必须来自 daemon 探测，
   * 否则等于「自报可用」，与本卡 FAIL 红线相悖。
   */
  forceAvailable?: boolean;
  /** 测试可替换探测（默认 `docker info`） */
  probe?: () => DockerProbe;
  /** 测试可替换 spawn（默认 `spawnManaged`） */
  spawn?: typeof spawnManaged;
  /**
   * 测试可替换容器清理（默认 `docker rm -f`）。
   * 容器客户端被 SIGKILL 时容器本身不会随之消失，必须显式清理，避免孤儿容器。
   */
  cleanup?: (name: string) => void;
}

/** 允许透传给 **docker 客户端** 的宿主环境变量（不含任何模型/服务凭据） */
const DOCKER_CLIENT_ENV = [
  "PATH",
  "HOME",
  "TMPDIR",
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_CONFIG",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
] as const;

function clientEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const name of DOCKER_CLIENT_ENV) {
    const value = process.env[name];
    if (value !== undefined) out[name] = value;
  }
  return out;
}

/** 容器内挂载目标必须是绝对路径，且不得覆盖 Worktree 挂载点（否则等于换根） */
function assertMountTarget(target: string, containerWorkRoot: string): string {
  if (!target.startsWith("/")) {
    throw new SandboxRejectedError(
      "MOUNT_OUTSIDE_WORKTREE",
      `container mount target must be absolute: ${target}`,
    );
  }
  const normalized = path.posix.normalize(target);
  if (normalized === containerWorkRoot || normalized === "/") {
    throw new SandboxRejectedError(
      "MOUNT_OUTSIDE_WORKTREE",
      `container mount target must not shadow the worktree root (${containerWorkRoot}): ${target}`,
    );
  }
  return normalized;
}

export class DockerContainerHost implements ContainerHostPort {
  readonly kind: string;
  private readonly probeResult: DockerProbe;
  private readonly image: string;
  private readonly containerWorkRoot: string;

  constructor(private readonly opts: DockerContainerHostOptions = {}) {
    this.image = opts.image ?? "ghcr.io/all-hands-ai/openhands:latest";
    this.containerWorkRoot = path.posix.normalize(
      opts.containerWorkRoot ?? "/work",
    );
    this.probeResult = this.probe();
    this.kind = this.probeResult.ok
      ? `docker/${this.probeResult.server_version}`
      : "docker/unavailable";
  }

  /** 探测细节（写进证据 / PR，不含凭据） */
  probeDetail(): DockerProbe {
    return this.probeResult;
  }

  isAvailable(): boolean {
    return this.probeResult.ok;
  }

  private probe(): DockerProbe {
    if (this.opts.probe !== undefined) return this.opts.probe();
    if (this.opts.forceAvailable !== undefined) {
      return this.opts.forceAvailable
        ? { ok: true, server_version: "forced", detail: "forced by option" }
        : { ok: false, server_version: "", detail: "forced unavailable" };
    }
    const r = spawnSync(
      this.docker(),
      ["info", "--format", "{{.ServerVersion}}"],
      { encoding: "utf8", timeout: this.opts.probeTimeoutMs ?? 5_000 },
    );
    if (r.error) {
      return { ok: false, server_version: "", detail: r.error.message };
    }
    if (r.status !== 0) {
      const raw = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
      return {
        ok: false,
        server_version: "",
        detail: (raw || `docker info exited with ${r.status}`).slice(-400),
      };
    }
    const version = (r.stdout ?? "").trim();
    // 只认「服务端」版本：客户端在但 daemon 不在时，本行会是空串或报错
    return version.length === 0
      ? {
          ok: false,
          server_version: "",
          detail:
            "docker info returned empty server version (daemon unreachable)",
        }
      : {
          ok: true,
          server_version: version,
          detail: `docker server ${version}`,
        };
  }

  private docker(): string {
    return this.opts.dockerPath ?? "docker";
  }

  /** 构造 `docker run` argv（纯构建，便于逐字断言） */
  buildArgs(input: SandboxRunInput, name: string): string[] {
    const hostRoot = path.resolve(input.worktreeRoot);
    const cwd = input.cwd;
    let containerCwd = this.containerWorkRoot;
    if (cwd !== undefined) {
      const rel = path.isAbsolute(cwd)
        ? path.relative(hostRoot, path.resolve(cwd))
        : cwd;
      if (path.isAbsolute(rel) || rel.startsWith("..")) {
        // 兜底：围栏已在 validateSandboxInput 拦过，这里防「宿主实现被单独调用」
        throw new SandboxRejectedError(
          "CWD_OUTSIDE_WORKTREE",
          `cwd must stay inside task worktree (${hostRoot}): ${cwd}`,
        );
      }
      containerCwd =
        rel === ""
          ? this.containerWorkRoot
          : path.posix.join(
              this.containerWorkRoot,
              rel.split(path.sep).join("/"),
            );
    }

    const args: string[] = [
      "run",
      "--rm",
      "--name",
      name,
      "--label",
      "stagent.sandbox=1",
      "--network",
      this.networkMode(input),
      "--cap-drop",
      "ALL",
      ...(this.opts.capAdd ?? ["DAC_OVERRIDE"]).flatMap((cap) => [
        "--cap-add",
        cap,
      ]),
      "--security-opt",
      "no-new-privileges",
      "--pids-limit",
      String(this.opts.pidsLimit ?? 512),
      "--memory",
      this.opts.memoryLimit ?? "2g",
      "--cpus",
      this.opts.cpus ?? "2",
      "-v",
      `${hostRoot}:${this.containerWorkRoot}`,
      "-w",
      containerCwd,
    ];

    for (const mount of input.mounts ?? []) {
      args.push("-v", this.mountArg(mount));
    }
    for (const [key, value] of Object.entries(input.env ?? {})) {
      args.push("-e", `${key}=${value}`);
    }
    args.push(this.image, ...input.argv);
    return args;
  }

  private mountArg(mount: SandboxMount): string {
    const target = assertMountTarget(mount.target, this.containerWorkRoot);
    const source = path.resolve(mount.source);
    return `${source}:${target}${mount.readonly === true ? ":ro" : ""}`;
  }

  /**
   * 网络模式映射。只兑现 `DENY`；其余策略一律**拒绝**而不是降级为 `none`
   * （降级会让「已授权出站」静默失败，比拒绝更误导）。
   */
  private networkMode(input: SandboxRunInput): string {
    const policy = input.networkPolicy ?? "DENY";
    if (policy === "DENY") return "none";
    throw new SandboxRejectedError(
      "NETWORK_TARGET_NOT_ALLOWED",
      `docker host cannot enforce per-target egress (policy: ${policy}); refusing instead of silently allowing or silently denying egress`,
    );
  }

  async run(
    input: SandboxRunInput,
    signal?: AbortSignal,
  ): Promise<SandboxRunOutcome> {
    const started = Date.now();
    const rejected = (
      rejection: SandboxRejectionCodeAlias,
      message: string,
    ): SandboxRunOutcome => ({
      exitCode: null,
      stdout: "",
      stderr: message,
      via: "rejected",
      rejection,
      durationMs: Date.now() - started,
    });

    if (!this.isAvailable()) {
      return rejected(
        "HOST_UNAVAILABLE",
        `container host unavailable: ${this.probeResult.detail}`,
      );
    }

    const name = `${this.opts.namePrefix ?? "stagent-sbx"}-${randomUUID().slice(0, 12)}`;
    let safe: SandboxRunInput;
    let args: string[];
    try {
      // 宿主侧再校验一次（纵深防御）：即便有人绕过 `runInSandbox()` 直接调本类，
      // 也拿不到「挂载宿主根 / cwd 越界」的容器。
      safe = validateSandboxInput(input);
      args = this.buildArgs(safe, name);
    } catch (err) {
      if (err instanceof SandboxRejectedError) {
        return rejected(err.code, err.message);
      }
      throw err;
    }

    let proc: ManagedProcess;
    try {
      proc = (this.opts.spawn ?? spawnManaged)({
        command: this.docker(),
        args,
        cwd: path.resolve(safe.worktreeRoot),
        env: clientEnv(),
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (err) {
      return rejected(
        "HOST_UNAVAILABLE",
        `failed to launch docker client: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const stdout: string[] = [];
    const drain = (async () => {
      for await (const line of proc.lines) stdout.push(line);
    })();

    const timeoutMs = input.timeoutMs ?? 60_000;
    const first = await Promise.race([
      proc.exited.then(() => "exit" as const),
      new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), timeoutMs),
      ),
    ]);

    let via: SandboxRunOutcome["via"] = "exit";
    if (first === "timeout") {
      via = "timeout";
      await proc.stop();
    }
    const { code } = await proc.exited;
    await drain.catch(() => undefined);

    if (via === "exit" && signal?.aborted === true) via = "SIGKILL";

    if (via !== "exit") {
      // docker 客户端被杀不会带走容器：显式清理，避免孤儿容器
      this.cleanupContainer(name);
    }

    return {
      exitCode: code,
      stdout: stdout.join("\n"),
      stderr: proc.stderr(),
      via,
      durationMs: Date.now() - started,
    };
  }

  private cleanupContainer(name: string): void {
    if (this.opts.cleanup !== undefined) {
      this.opts.cleanup(name);
      return;
    }
    try {
      spawnSync(this.docker(), ["rm", "-f", name], {
        encoding: "utf8",
        timeout: 5_000,
      });
    } catch {
      // 清理失败不覆盖真实终止态；容器残留由运维侧 docker ps 可见
    }
  }
}

/** 局部别名：避免在返回构造处重复导入类型名 */
type SandboxRejectionCodeAlias = NonNullable<SandboxRunOutcome["rejection"]>;
