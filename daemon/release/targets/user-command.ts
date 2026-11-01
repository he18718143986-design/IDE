/**
 * TASK-L.15：user_command 目标 —— 执行用户自有部署脚本。
 */
import type { ReleaseTargetAdapter, ReleaseContext, StepResult } from "../target-adapter";
import {
  detectInstallArgv,
  httpHealthCheck,
  readPackageScripts,
  runReleaseCommand,
} from "../step-runner";
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

export class UserCommandAdapter implements ReleaseTargetAdapter {
  readonly kind = "user_command" as const;

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
    if (!scripts["build"]) return emptyOk(["(no build script)"]);
    return runReleaseCommand({
      argv: ["npm", "run", "build"],
      cwd: ctx.checkoutDir,
      env: { ...ctx.env },
      secretValues: secrets,
      allowNetwork: true,
    });
  }

  async deploy(ctx: ReleaseContext): Promise<StepResult> {
    const secretValues = Object.values(ctx.env).filter((v) => v.length >= 6);
    let argv: string[];
    if (ctx.target.deploy_argv && ctx.target.deploy_argv.length > 0) {
      argv = [...ctx.target.deploy_argv];
    } else if (ctx.target.deploy_script) {
      const scripts = readPackageScripts(ctx.checkoutDir);
      if (!scripts[ctx.target.deploy_script]) {
        const t = nowIso();
        return {
          ok: false,
          exit_code: 1,
          argv: ["npm", "run", ctx.target.deploy_script],
          log_tail: `package.json 没有脚本「${ctx.target.deploy_script}」`,
          started_at: t,
          ended_at: t,
        };
      }
      argv = ["npm", "run", ctx.target.deploy_script];
    } else {
      const t = nowIso();
      return {
        ok: false,
        exit_code: 1,
        argv: [],
        log_tail: "目标未配置 deploy_script 或 deploy_argv",
        started_at: t,
        ended_at: t,
      };
    }
    return runReleaseCommand({
      argv,
      cwd: ctx.checkoutDir,
      env: { ...ctx.env },
      secretValues,
      allowNetwork: true,
    });
  }

  async health(ctx: ReleaseContext): Promise<StepResult> {
    const started_at = nowIso();
    const secretValues = Object.values(ctx.env).filter((v) => v.length >= 6);

    if (ctx.target.health_argv && ctx.target.health_argv.length > 0) {
      return runReleaseCommand({
        argv: ctx.target.health_argv,
        cwd: ctx.checkoutDir,
        env: { ...ctx.env },
        secretValues,
        allowNetwork: true,
        timeoutMs: 30_000,
      });
    }

    if (ctx.target.health_url) {
      const check = await httpHealthCheck({
        url: ctx.target.health_url,
        timeoutMs: 5_000,
      });
      const { text } = redactSecrets(
        `HTTP ${check.status}\n${check.body_tail}`,
        secretValues,
      );
      return {
        ok: check.ok,
        exit_code: check.ok ? 0 : 1,
        argv: ["GET", ctx.target.health_url],
        log_tail: text.slice(-8_000),
        started_at,
        ended_at: nowIso(),
      };
    }

    return {
      ok: false,
      exit_code: 1,
      argv: [],
      log_tail: "目标未配置 health_url 或 health_argv",
      started_at,
      ended_at: nowIso(),
    };
  }
}
