/**
 * TASK-L.15：local_process 目标 —— 本机拉起应用并保活。
 */
import { spawnManaged } from "../../worker/cli-host/process-host";
import type { ReleaseTargetAdapter, ReleaseContext, StepResult } from "../target-adapter";
import {
  detectInstallArgv,
  hostEnvAllowlist,
  httpHealthCheck,
  readPackageScripts,
  runReleaseCommand,
} from "../step-runner";
import {
  clearLiveProcess,
  getLiveProcess,
  setLiveProcess,
} from "../process-registry";
import { redactSecrets } from "../../runner/command-runner";

function nowIso(): string {
  return new Date().toISOString();
}

function emptyOk(argv: string[]): StepResult {
  const t = nowIso();
  return {
    ok: true,
    exit_code: 0,
    argv,
    log_tail: "(skipped)",
    started_at: t,
    ended_at: t,
  };
}

export class LocalProcessAdapter implements ReleaseTargetAdapter {
  readonly kind = "local_process" as const;

  async build(ctx: ReleaseContext): Promise<StepResult> {
    const secrets: string[] = [];
    const install = detectInstallArgv(ctx.checkoutDir);
    if (install) {
      const inst = await runReleaseCommand({
        argv: install,
        cwd: ctx.checkoutDir,
        env: { ...ctx.env },
        secretValues: secrets,
        allowNetwork: true,
      });
      if (!inst.ok) return inst;
    }
    const scripts = readPackageScripts(ctx.checkoutDir);
    if (!scripts["build"]) {
      return emptyOk(["(no build script)"]);
    }
    return runReleaseCommand({
      argv: ["npm", "run", "build"],
      cwd: ctx.checkoutDir,
      env: { ...ctx.env },
      secretValues: secrets,
      allowNetwork: true,
    });
  }

  async stop(ctx: ReleaseContext): Promise<StepResult> {
    const started_at = nowIso();
    const live = getLiveProcess(ctx.target.target_id);
    if (!live) {
      return {
        ok: true,
        exit_code: 0,
        argv: ["(no live process)"],
        log_tail: "no process to stop",
        started_at,
        ended_at: nowIso(),
      };
    }
    const stopResult = await live.process.stop();
    clearLiveProcess(ctx.target.target_id);
    return {
      ok: true,
      exit_code: 0,
      argv: ["spawnManaged.stop"],
      log_tail: `stopped via ${stopResult.via} in ${stopResult.ms}ms`,
      started_at,
      ended_at: nowIso(),
    };
  }

  async deploy(ctx: ReleaseContext): Promise<StepResult> {
    const started_at = nowIso();
    const port = ctx.target.port ?? 4300;
    const scripts = readPackageScripts(ctx.checkoutDir);
    if (!scripts["start"]) {
      return {
        ok: false,
        exit_code: 1,
        argv: ["npm", "run", "start"],
        log_tail: "package.json 缺少 start 脚本",
        started_at,
        ended_at: nowIso(),
      };
    }

    // 停当前 LIVE
    await this.stop(ctx);

    // spawnManaged 在传入 env 时整表替换（不合并 process.env）；必须带白名单基底。
    const env: Record<string, string> = hostEnvAllowlist({
      ...ctx.env,
      PORT: String(port),
      STAGENT_RELEASE_PORT: String(port),
    });
    const secretValues = Object.values(ctx.env).filter((v) => v.length >= 6);

    const proc = spawnManaged({
      command: "npm",
      args: ["run", "start"],
      cwd: ctx.checkoutDir,
      env,
    });

    // 给进程一点启动时间；失败时 stop 会回收
    await new Promise((r) => setTimeout(r, 400));

    // 若已立即退出，视为部署失败
    const raced = await Promise.race([
      proc.exited.then((e) => ({ kind: "exit" as const, e })),
      new Promise<{ kind: "alive" }>((r) => setTimeout(() => r({ kind: "alive" }), 200)),
    ]);
    if (raced.kind === "exit") {
      const stderr = proc.stderr();
      const { text } = redactSecrets(stderr, secretValues);
      return {
        ok: false,
        exit_code: raced.e.code ?? 1,
        argv: ["npm", "run", "start"],
        log_tail: text.slice(-8_000) || "process exited immediately",
        started_at,
        ended_at: nowIso(),
      };
    }

    setLiveProcess({
      release_id: ctx.release.release_id,
      target_id: ctx.target.target_id,
      checkout_dir: ctx.checkoutDir,
      process: proc,
      port,
    });

    return {
      ok: true,
      exit_code: 0,
      argv: ["npm", "run", "start"],
      log_tail: `started pid=${proc.pid ?? "?"} port=${port}`,
      started_at,
      ended_at: nowIso(),
    };
  }

  async health(ctx: ReleaseContext): Promise<StepResult> {
    const started_at = nowIso();
    const port = ctx.target.port ?? 4300;
    const healthPath = ctx.target.health_path ?? "/";
    const url = `http://127.0.0.1:${port}${healthPath.startsWith("/") ? healthPath : `/${healthPath}`}`;
    const check = await httpHealthCheck({ url, timeoutMs: 3_000 });
    const secretValues = Object.values(ctx.env).filter((v) => v.length >= 6);
    const { text } = redactSecrets(
      `HTTP ${check.status}\n${check.body_tail}`,
      secretValues,
    );
    return {
      ok: check.ok,
      exit_code: check.ok ? 0 : 1,
      argv: ["GET", url],
      log_tail: text.slice(-8_000),
      started_at,
      ended_at: nowIso(),
    };
  }
}
