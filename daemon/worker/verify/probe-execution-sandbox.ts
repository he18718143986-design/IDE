/**
 * TASK-W.7：`ProbeExecutionPort` 的容器实现——三类围栏探测的真实执行面。
 *
 * ## 边界（先把「不做什么」写清）
 * - **不启动任何进程**：全部经 `runInSandbox(host, ...)` 交宿主执行，故本文件无需
 *   落在 `cli-host/`（`tests/unit/spawn-whitelist.test.ts` 的静态闸门照常成立）。
 * - **不评测第三方 CLI 本体**：探测对象是「目标档位提供的执行环境」是否兑现围栏
 *   （挂载唯一性 / 出口封锁 / 能力收敛 / 写操作可观测），不是把用户装的 CLI 跑一遍
 *   审计其全部行为。CLI 本体的实测另由适配器的 `verified_on` 记录（W.5c-iii），
 *   两者不互相冒充。
 * - **拿不到宿主就 throw**：`isAvailable()` 由 `runProbePack()` 先判，这里不再兜底；
 *   绝不出现「容器不可用 → 退回主树跑探针」的降级路径。
 *
 * ## 探测脚本为什么用 `sh -c`
 * 探测本身要在容器内做多步断言，`argv` 一次性表达不完；但**输入不含用户数据**
 * （adapter_id / launch 不拼进脚本），脚本是常量，宿主侧仍是结构化 argv +
 * `shell:false`（`sh -c` 是容器内那一个进程的参数，不是宿主 shell）。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  runInSandbox,
  sandboxWitness,
  type ContainerHostPort,
  type SandboxRunInput,
  type SandboxRunOutcome,
  type SandboxWitness,
} from "../sandbox/container-host";
import type {
  FenceProbeInput,
  ProbeExecutionPort,
  ProbeFinding,
} from "./worker-probe";

/** 能力收敛白名单：`0x0`（全丢）或 `0x2`（仅 DAC_OVERRIDE，见 W.5c-iii 实测） */
const ALLOWED_CAP_EFF = ["0000000000000000", "0000000000000002"];

export interface SandboxProbeExecutionOptions {
  /** 容器宿主（生产注入 `DockerContainerHost`，测试注入桩） */
  host: ContainerHostPort;
  /**
   * 探测工作区（宿主临时目录）。容器内唯一挂载点即此目录——
   * 探测绝不挂载仓库主树：那等于把主树交给被测环境。
   */
  workspaceRoot?: string;
  /** 单次探测超时（ms），默认 30s */
  timeoutMs?: number;
  /** 测试可替换执行入口（默认 `runInSandbox`） */
  runSandbox?: typeof runInSandbox;
}

/** 容器 stdout 的 `KEY=VALUE` 行解析（缺失 → undefined，不猜默认值） */
function readKey(stdout: string, key: string): string | undefined {
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith(`${key}=`)) continue;
    return line.slice(key.length + 1).trim();
  }
  return undefined;
}

export class SandboxProbeExecutionPort implements ProbeExecutionPort {
  readonly kind = "container";
  private readonly host: ContainerHostPort;
  private readonly workspaceRoot: string;
  private readonly ownsWorkspace: boolean;
  private readonly timeoutMs: number;
  private readonly runSandbox: typeof runInSandbox;
  private witness: SandboxWitness | undefined;
  private readonly escapeNames: string[] = [];

  constructor(options: SandboxProbeExecutionOptions) {
    this.host = options.host;
    if (options.workspaceRoot !== undefined) {
      this.workspaceRoot = path.resolve(options.workspaceRoot);
      this.ownsWorkspace = false;
    } else {
      this.workspaceRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "stagent-probe-"),
      );
      this.ownsWorkspace = true;
    }
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.runSandbox = options.runSandbox ?? runInSandbox;
  }

  isAvailable(): boolean {
    // 宿主同步可用性（`docker info` 已在构造期探测并缓存），不在这里再起进程
    return this.host.isAvailable() === true;
  }

  /** P5：本次探测派工确有入箱见证（唯一产出点 `sandboxWitness()`） */
  getWitness(): SandboxWitness | undefined {
    return this.witness;
  }

  /** 清理探测工作区（仅当由本对象创建） */
  dispose(): void {
    if (!this.ownsWorkspace) return;
    try {
      fs.rmSync(this.workspaceRoot, { recursive: true, force: true });
    } catch {
      // 清理失败不影响探测结论；残留目录在系统临时目录内，由 OS 回收
    }
  }

  async runFenceProbes(input: FenceProbeInput): Promise<ProbeFinding[]> {
    if (!this.isAvailable()) {
      // 理论上不会到这里（runProbePack 先判）；到这一步也必须失败关闭
      throw new Error(
        `probe host unavailable (${this.host.kind ?? "unknown"}); refusing to run probe pack`,
      );
    }
    return [
      await this.probeFilesystemFence(input),
      await this.probeCommandFence(input),
      await this.probeEvidenceIntegrity(input),
    ];
  }

  /** 在容器内执行一段常量脚本；返回 outcome 与解析出的 stdout */
  private async execContainer(
    script: string,
  ): Promise<{ outcome: SandboxRunOutcome; stdout: string }> {
    const argv = ["sh", "-c", script];
    const sandboxInput: SandboxRunInput = {
      // 唯一挂载点＝探测工作区：不是仓库主树、不是任务 Worktree
      worktreeRoot: this.workspaceRoot,
      // **不传 cwd**：`SandboxRunInput.cwd` 是宿主侧语义（必须落在 worktreeRoot 内），
      // 容器内工作目录由宿主实现落定为 `containerWorkRoot`（＝挂载点）。
      // 传 "/work" 会被围栏判为 CWD_OUTSIDE_WORKTREE——那是宿主路径，不是容器路径。
      argv,
      // 探测期一律断网：`DENY` 是唯一被真实兑现的策略
      networkPolicy: "DENY",
      timeoutMs: this.timeoutMs,
    };
    const outcome = await this.runSandbox(this.host, sandboxInput);
    // 首次成功执行的见证即为「本次探测确实入过箱」的证据；失败重建不覆盖
    if (outcome.via !== "rejected" && this.witness === undefined) {
      this.witness = sandboxWitness(this.host, sandboxInput, outcome);
    }
    return { outcome, stdout: outcome.stdout ?? "" };
  }

  private rejectedDetail(name: string, outcome: SandboxRunOutcome): string {
    const reason =
      outcome.rejection ?? (outcome.via === "timeout" ? "timeout" : "exit");
    return `${name}: 容器未正常执行（${reason}）${outcome.stderr ? `：${outcome.stderr.slice(0, 200)}` : ""}`;
  }

  /**
   * P1 文件围栏。
   *
   * 断言两件事：
   * 1. **正向**：容器内写 Worktree 内路径 → 宿主侧能读到相同内容（挂载是活的）；
   * 2. **负向**：容器内写容器外路径（`/tmp/<uuid>`）→ **宿主侧不得出现该文件**
   *    （写到容器外不会漏到宿主）。
   *
   * 负向断言是这一项的关键：只看「Worktree 内能写」证明不了隔离，必须证明
   * 「工作区外写了宿主看不见」。
   */
  private async probeFilesystemFence(
    _input: FenceProbeInput,
  ): Promise<ProbeFinding> {
    const escapeName = `stagent-probe-${randomUUID()}.escape`;
    this.escapeNames.push(escapeName);
    const script = [
      "printf 'ok' > .probe-fs-inside.txt 2>/dev/null && echo INSIDE_WRITE=ok || echo INSIDE_WRITE=fail",
      `printf 'x' > /tmp/${escapeName} 2>/dev/null && echo ESCAPE_WRITE=ok || echo ESCAPE_WRITE=blocked`,
      "cat .probe-fs-inside.txt 2>/dev/null && echo READ_BACK=ok || echo READ_BACK=fail",
    ].join("; ");

    const { outcome, stdout } = await this.execContainer(script);
    if (outcome.via === "rejected") {
      return {
        id: "filesystem_fence",
        status: "fail",
        detail: this.rejectedDetail("文件围栏探测", outcome),
        required: true,
      };
    }

    const insideWrite = readKey(stdout, "INSIDE_WRITE");
    const readBack = readKey(stdout, "READ_BACK");
    const hostInside = path.join(this.workspaceRoot, ".probe-fs-inside.txt");
    const hostVisible =
      fs.existsSync(hostInside) &&
      fs.readFileSync(hostInside, "utf8").trim() === "ok";
    const escaped = fs.existsSync(path.join("/tmp", escapeName));

    if (escaped) {
      return {
        id: "filesystem_fence",
        status: "fail",
        // 宿主 /tmp 出现容器内文件 = 容器文件系统与宿主共享，围栏不成立
        detail:
          "容器内写到 /tmp 的文件出现在宿主 /tmp 上：文件系统围栏不成立（挂载点不止工作区）",
        required: true,
      };
    }
    if (insideWrite !== "ok" || readBack !== "ok" || !hostVisible) {
      return {
        id: "filesystem_fence",
        status: "fail",
        detail: `工作区内写入未生效（容器内=${insideWrite ?? "?"}，回读=${readBack ?? "?"}，宿主可见=${hostVisible ? "yes" : "no"}）`,
        required: true,
      };
    }
    return {
      id: "filesystem_fence",
      status: "pass",
      detail:
        "工作区内写入在宿主侧可见且内容一致；容器内写到 `/tmp` 的文件未出现在宿主 `/tmp`（唯一挂载点为探测工作区）",
      required: true,
    };
  }

  /**
   * P2 命令围栏。
   *
   * 断言：容器 socket 不可达、网络只剩环回、能力集收敛。
   * 这三项对应卡正文「白名单外命令 / 宿主二进制不可达、出站被拒」中**可确定性观测**
   * 的部分；白名单外命令的枚举依赖具体 CLI，属未完成项（见 PR 说明）。
   */
  private async probeCommandFence(
    _input: FenceProbeInput,
  ): Promise<ProbeFinding> {
    const script = [
      "test -S /var/run/docker.sock && echo DOCKER_SOCK=present || echo DOCKER_SOCK=absent",
      "echo NET_IFACES=$(ls /sys/class/net 2>/dev/null | tr '\\n' ',')",
      "echo CAP_EFF=$(awk '/^CapEff/{print $2}' /proc/self/status 2>/dev/null)",
    ].join("; ");

    const { outcome, stdout } = await this.execContainer(script);
    if (outcome.via === "rejected") {
      return {
        id: "command_fence",
        status: "fail",
        detail: this.rejectedDetail("命令围栏探测", outcome),
        required: true,
      };
    }

    const dockerSock = readKey(stdout, "DOCKER_SOCK");
    const ifaces = (readKey(stdout, "NET_IFACES") ?? "")
      .split(",")
      .filter((item) => item.length > 0);
    const capEff = readKey(stdout, "CAP_EFF");

    const problems: string[] = [];
    if (dockerSock !== "absent") {
      problems.push("容器内可见 docker socket（宿主二进制可达路径存在）");
    }
    const nonLoopback = ifaces.filter((item) => item !== "lo");
    if (ifaces.length === 0 || nonLoopback.length > 0) {
      problems.push(
        `网络接口未收敛到环回（实际：${ifaces.join(",") || "未知"}）`,
      );
    }
    if (capEff === undefined || !ALLOWED_CAP_EFF.includes(capEff)) {
      problems.push(`能力集未收敛（CapEff=${capEff ?? "未知"}）`);
    }

    if (problems.length > 0) {
      return {
        id: "command_fence",
        status: "fail",
        detail: `命令围栏未全部成立：${problems.join("；")}`,
        required: true,
      };
    }
    return {
      id: "command_fence",
      status: "pass",
      detail: `容器 socket 不可见、网络仅环回（${ifaces.join(",")}）、CapEff=${capEff}（已收敛）`,
      required: true,
    };
  }

  /**
   * P3 证据完整性。
   *
   * 断言：容器内每一次写操作都能在宿主侧**逐条**读到，且内容可区分——
   * 否则「未经 Gateway 的直写」与「经 Gateway 的写」在证据面上无法区分，
   * 受控档位的证据就是空的。
   */
  private async probeEvidenceIntegrity(
    _input: FenceProbeInput,
  ): Promise<ProbeFinding> {
    const script = [
      "printf 'a' > .probe-ev-1.txt 2>/dev/null",
      "printf 'bb' > .probe-ev-2.txt 2>/dev/null",
      "echo EV_MARK=2",
    ].join("; ");

    const { outcome, stdout } = await this.execContainer(script);
    if (outcome.via === "rejected") {
      return {
        id: "evidence_integrity",
        status: "fail",
        detail: this.rejectedDetail("证据完整性探测", outcome),
        required: true,
      };
    }
    const mark = readKey(stdout, "EV_MARK");
    const file1 = path.join(this.workspaceRoot, ".probe-ev-1.txt");
    const file2 = path.join(this.workspaceRoot, ".probe-ev-2.txt");
    const c1 = fs.existsSync(file1) ? fs.readFileSync(file1, "utf8") : null;
    const c2 = fs.existsSync(file2) ? fs.readFileSync(file2, "utf8") : null;

    if (mark !== "2" || c1 !== "a" || c2 !== "bb") {
      return {
        id: "evidence_integrity",
        status: "fail",
        detail: `写操作未能逐条在宿主侧复现（mark=${mark ?? "?"}，file1=${c1 === null ? "缺失" : JSON.stringify(c1)}，file2=${c2 === null ? "缺失" : JSON.stringify(c2)}）`,
        required: true,
      };
    }
    return {
      id: "evidence_integrity",
      status: "pass",
      detail:
        "两次容器内写操作均在宿主侧逐条可读且内容互不相同（直写与受控写可区分）",
      required: true,
    };
  }
}
