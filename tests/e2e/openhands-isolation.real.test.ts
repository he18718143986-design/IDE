/**
 * TASK-W.5c-iii：真实容器隔离实测（**需要容器运行时 + `STAGENT_REAL_OPENHANDS=1`**）。
 *
 * 运行：
 *   STAGENT_REAL_OPENHANDS=1 npx vitest run tests/e2e/openhands-isolation.real.test.ts
 *
 * 门禁纪律：未设 `STAGENT_REAL_OPENHANDS=1` 时整文件 **skip**——**跳过 ≠ 通过**。
 * 无容器环境的 CI 不得据此判绿；PR 描述必须贴出实际运行输出。
 *
 * 本文件证明的是「隔离负例失败关闭」，**不**证明「模型驱动的端到端改动」：容器
 * 出站恒为 DENY，模型 API 不可达，端到端场景未实测（见 `OPENHANDS_VERIFIED_ON`
 * 注释与 `known_limitations`）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { safeRmSync } from "../helpers/tmp";
import {
  SandboxRejectedError,
  runInSandbox,
  type SandboxRunOutcome,
} from "../../daemon/worker/sandbox/container-host";
import { DockerContainerHost } from "../../daemon/worker/cli-host/docker-container-host";
import {
  OPENHANDS_CAPABILITY,
  OPENHANDS_IMAGE,
  OPENHANDS_VERIFIED_ON,
  OpenHandsSandboxAdapter,
} from "../../daemon/worker/cli-host/openhands-adapter";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";

const REAL = process.env["STAGENT_REAL_OPENHANDS"] === "1";

/** 容器内唯一挂载点 */
const WORK = "/work";

describe.skipIf(!REAL)("TASK-W.5c-iii 真实容器隔离负例", () => {
  let root: string;
  let worktree: string;
  let outsideSecret: string;
  let host: DockerContainerHost;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-oh-real-"));
    worktree = path.join(root, "wt");
    const outside = path.join(root, "outside");
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
    fs.mkdirSync(path.join(worktree, ".stagent"), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(
      path.join(worktree, "src", "a.ts"),
      "export const a = 1;\n",
    );
    fs.writeFileSync(
      path.join(worktree, ".stagent", "protection.json"),
      JSON.stringify({ version: 1, entries: [] }),
    );
    outsideSecret = path.join(outside, "secret.txt");
    fs.writeFileSync(outsideSecret, "TOPSECRET-HOST-ONLY\n");
    spawnSync("git", ["init", "-q"], { cwd: worktree });

    host = new DockerContainerHost({ image: OPENHANDS_IMAGE });
  }, 120_000);

  afterAll(() => {
    if (root !== undefined) safeRmSync(root);
  });

  /** 便捷执行：默认 DENY 网络、2 分钟超时 */
  function run(
    argv: string[],
    over: { timeoutMs?: number } = {},
  ): Promise<SandboxRunOutcome> {
    return runInSandbox(host, {
      worktreeRoot: worktree,
      argv,
      networkPolicy: "DENY",
      timeoutMs: over.timeoutMs ?? 120_000,
    });
  }

  function py(code: string, over: { timeoutMs?: number } = {}) {
    return run(["python", "-c", code], over);
  }

  it("OH-R00：环境自证——daemon 可达、镜像可用、宿主自报身份", () => {
    const probe = host.probeDetail();
    expect(
      host.isAvailable(),
      `docker 不可用：${probe.detail}（不得在无容器环境下判绿）`,
    ).toBe(true);
    expect(probe.server_version.length).toBeGreaterThan(0);
    expect(host.kind).toMatch(/^docker\/\d+\./);
    // 镜像摘要固定 → 实测对象可复现
    expect(OPENHANDS_IMAGE).toMatch(/@sha256:[0-9a-f]{64}$/);
  });

  it("OH-R01：OpenHands headless CLI 在容器内可启动（版本与 verified_on 一致）", async () => {
    const help = await run(["python", "-m", "openhands.core.main", "--help"]);
    expect(help.via).toBe("exit");
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toMatch(/--task|usage: main\.py/);

    const ver = await py("import openhands;print(openhands.__version__)");
    expect(ver.exitCode).toBe(0);
    // 镜像 entrypoint.sh 会先打两行横幅（"Starting OpenHands..." / "Running OpenHands as root"），
    // 版本号是其中的独立一行——按行取，不靠整段拼接
    const versionLine = ver.stdout
      .split("\n")
      .map((line) => line.trim())
      .find((line) => /^\d+\.\d+\.\d+$/.test(line));
    expect(versionLine, `容器内版本号未取到：${ver.stdout}`).toBe("0.59.0");
    // verified_on 里写的版本必须就是容器里真跑出来的版本
    expect(OPENHANDS_VERIFIED_ON.cli_version).toContain(versionLine!);
  }, 240_000);

  it("OH-R02 / OH-03：容器内只看得见任务 Worktree（cwd=/work，宿主路径不可达）", async () => {
    const out = await py(
      [
        "import os",
        "print('CWD=' + os.getcwd())",
        "print('LS=' + ','.join(sorted(os.listdir('/work'))))",
        `print('HOSTPATH=' + str(os.path.exists(${JSON.stringify(outsideSecret)})))`,
        `print('HOSTROOT=' + str(os.path.exists(${JSON.stringify(root)})))`,
      ].join("\n"),
    );
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain(`CWD=${WORK}`);
    expect(out.stdout).toContain("src");
    expect(out.stdout).toContain("HOSTPATH=False");
    expect(out.stdout).toContain("HOSTROOT=False");
  }, 240_000);

  it("OH-02：逃逸负例——读宿主越界文件 / 相对穿越均失败关闭", async () => {
    const abs = await py(
      `print(open(${JSON.stringify(outsideSecret)}).read())`,
    );
    expect(abs.via).toBe("exit");
    expect(abs.exitCode).not.toBe(0);
    expect(`${abs.stdout}${abs.stderr}`).not.toContain("TOPSECRET-HOST-ONLY");

    const rel = await run(["cat", "../outside/secret.txt"]);
    expect(rel.exitCode).not.toBe(0);
    expect(`${rel.stdout}${rel.stderr}`).not.toContain("TOPSECRET-HOST-ONLY");
  }, 240_000);

  it("OH-02：提权负例——容器内仅剩 DAC_OVERRIDE，无 NET_ADMIN / SYS_ADMIN", async () => {
    const out = await py(
      [
        "import re",
        "s = open('/proc/self/status').read()",
        "print('CAPEFF=' + re.search(r'CapEff:\\s*(\\w+)', s).group(1))",
      ].join("\n"),
    );
    expect(out.exitCode).toBe(0);
    // 0x2 == 只有 CAP_DAC_OVERRIDE（保留原因见 known_limitations）
    expect(out.stdout).toContain("CAPEFF=0000000000000002");
  }, 240_000);

  it("OH-02：出站负例——DENY 下连不出去", async () => {
    const out = await py(
      [
        "import socket",
        "try:",
        "    socket.create_connection(('1.1.1.1', 80), 3)",
        "    print('CONNECTED')",
        "except Exception as e:",
        "    print('BLOCKED:' + type(e).__name__)",
      ].join("\n"),
      { timeoutMs: 60_000 },
    );
    expect(out.stdout).not.toContain("CONNECTED");
    expect(out.stdout).toContain("BLOCKED:");
  }, 240_000);

  it("OH-01：越界挂载在进入容器前即被拒（宿主根 / .git / .stagent）", async () => {
    const cases = [
      path.parse(root).root,
      path.join(worktree, ".git"),
      path.join(worktree, ".stagent"),
      outsideSecret,
    ];
    for (const source of cases) {
      await expect(
        runInSandbox(host, {
          worktreeRoot: worktree,
          argv: ["python", "-c", "print('should not run')"],
          mounts: [{ source, target: "/leak" }],
        }),
      ).rejects.toBeInstanceOf(SandboxRejectedError);
    }
  }, 240_000);

  it("终止态如实回传：非零退出不美化成成功", async () => {
    const out = await py("import sys;sys.exit(3)");
    expect(out.via).toBe("exit");
    expect(out.exitCode).toBe(3);
  }, 240_000);

  it("超时熔断：到点回收，不无限等待", async () => {
    const started = Date.now();
    const out = await run(["sleep", "30"], { timeoutMs: 1_500 });
    expect(out.via).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(25_000);
  }, 240_000);

  it("适配器在真实宿主上失败关闭（无出站 / 无凭据时不得假装成功）", async () => {
    const draft = createContractDraft({
      title: "W.5c-iii 真实容器",
      description: "在容器内创建空文件后结束",
      acceptanceCriteria: ["负例失败关闭"],
      writablePaths: ["**"],
    });
    const contract = softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "EXECUTING",
      approval: {
        status: "APPROVED",
        approved_by: "tina",
        approved_at: "2026-11-02T00:00:00.000Z",
      },
    });
    const adapter = new OpenHandsSandboxAdapter({
      host,
      timeoutMs: 90_000,
      maxIterations: 1,
    });
    const error: unknown = await adapter
      .run({
        contract,
        contract_revision: 1,
        worktree_root: worktree,
        system_prompt: "在 /work 内创建一个空文件 probe.txt，然后结束。",
        exposed_tools: [],
      })
      .catch((e: unknown) => e);
    // 断言「不得成功」：DENY 出站 + 无模型凭据 → 必须抛错，而不是返回假成功
    expect(error).toBeInstanceOf(Error);
  }, 300_000);

  it("OH-05：能力声明与实测一致（声明值就是刚测到的边界）", () => {
    expect(OPENHANDS_CAPABILITY.filesystem_permissions).toBe(
      "DIRECT_UNCONTROLLED",
    );
    expect(OPENHANDS_CAPABILITY.command_permissions).toBe("UNRESTRICTED_SHELL");
    expect(OPENHANDS_CAPABILITY.tool_interception_supported).toBe(false);
    expect(OPENHANDS_CAPABILITY.known_limitations.length).toBeGreaterThan(0);
    expect(OPENHANDS_VERIFIED_ON.verified_at).toBe("2026-11-02");
  });
});
