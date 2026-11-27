import fs from "node:fs";
import {
  parseEnvFile,
  sanitizeEnvironment,
  type EnvSanitizerOptions,
} from "../runner/env-filter";
import { resolveSafeWorktreePath } from "../mcp/path-resolver";

/**
 * TASK-W.3：运行时策略守卫（环境白名单 / env_file_grants / 网络策略）。
 *
 * 原则：
 * 1. 宿主环境默认不继承，只放行基础变量与合同声明的变量名；
 * 2. env_file_grants 只对声明的命令别名生效，越界/缺失按「拿不到」处理，不阻断执行；
 * 3. 网络 DENY 是**非对抗性离线约束**（ADR-003）：通过代理指向黑洞与包管理器
 *    offline 开关降低误联网概率；它不构成对恶意代码的强制隔离，真阻断推迟到后续版本。
 */

export type NetworkPolicy = "DENY" | "EXPLICIT_TARGETS" | "USER_APPROVED";

export interface ExecutionPermissionsView {
  allowed_environment_variable_names?: string[] | undefined;
  env_file_grants?:
    | Array<{
        file: string;
        variable_names: string[];
        command_aliases: string[];
      }>
    | undefined;
  network_policy: NetworkPolicy;
}

export interface BuildCommandEnvironmentParams {
  permissions: ExecutionPermissionsView;
  worktreeRoot: string;
  alias?: string | undefined;
  baseEnv?: NodeJS.ProcessEnv;
}

export interface CommandEnvironment {
  /** 最终传给子进程的环境（已白名单过滤 + 网络策略注入） */
  env: Record<string, string>;
  /** 仅供 runner 兼容旧调用；新调用应直接传 env */
  envOptions: EnvSanitizerOptions;
  /** 需要在输出中遮蔽的秘密值（env_file_grants 注入的值） */
  secretValues: string[];
}

/** ADR-003：DENY 只做离线约束，不做对抗性网络隔离 */
export function applyNetworkPolicy(
  env: Record<string, string>,
  policy: NetworkPolicy | undefined,
): Record<string, string> {
  if (policy !== "DENY") return env;
  return {
    ...env,
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
    ALL_PROXY: "http://127.0.0.1:9",
    NO_PROXY: "",
    npm_config_offline: "true",
    YARN_ENABLE_NETWORK: "0",
    PIP_NO_INDEX: "1",
  };
}

/** 读取合同授权的 env 文件变量（仅对声明别名生效，越界/缺失静默跳过） */
export function collectGrantedEnv(params: {
  permissions: ExecutionPermissionsView;
  worktreeRoot: string;
  alias?: string | undefined;
}): { extraEnv: Record<string, string>; secretValues: string[] } {
  const extraEnv: Record<string, string> = {};
  const secretValues: string[] = [];
  if (params.alias === undefined) return { extraEnv, secretValues };

  for (const grant of params.permissions.env_file_grants ?? []) {
    if (!grant.command_aliases.includes(params.alias)) continue;
    try {
      const safe = resolveSafeWorktreePath(params.worktreeRoot, grant.file);
      const parsedFile = parseEnvFile(
        fs.readFileSync(safe.absolutePath, "utf-8"),
      );
      for (const name of grant.variable_names) {
        const value = parsedFile[name];
        if (value === undefined) continue;
        extraEnv[name] = value;
        if (value.trim().length > 0) secretValues.push(value);
      }
    } catch {
      // 文件缺失/越界：该命令拿不到这些变量，但不阻断执行
    }
  }
  return { extraEnv, secretValues };
}

/**
 * 组装最终子进程环境（白名单 → 网络策略）。
 * 供 `buildCommandEnvironment` 与 command-runner 的旧调用分支共用，
 * 保证「无论是否传 resolvedEnv，都走同一套策略」。
 */
export function resolveEnvironment(
  baseEnv: NodeJS.ProcessEnv,
  envOptions: EnvSanitizerOptions | undefined,
  networkPolicy: NetworkPolicy | undefined,
): Record<string, string> {
  return applyNetworkPolicy(
    sanitizeEnvironment(baseEnv, envOptions),
    networkPolicy,
  );
}

/** 组装子进程环境：白名单 → 合同授权注入 → 网络策略 */
export function buildCommandEnvironment(
  params: BuildCommandEnvironmentParams,
): CommandEnvironment {
  const { extraEnv, secretValues } = collectGrantedEnv(params);
  const envOptions: EnvSanitizerOptions = {
    extraEnv,
    allowedKeyOverrides: [
      ...(params.permissions.allowed_environment_variable_names ?? []),
    ],
  };
  const env = resolveEnvironment(
    params.baseEnv ?? process.env,
    envOptions,
    params.permissions.network_policy,
  );
  return { env, envOptions, secretValues };
}

/**
 * TASK-P1.4: 收集合同所有授权文件的全部凭据值（不仅限于单个别名）。
 * 供网关全局脱敏使用，确保任何已授权凭据即使在未声明别名或其他命令输出中泄露也能被脱敏。
 */
export function collectAllContractSecrets(params: {
  permissions: ExecutionPermissionsView;
  worktreeRoot: string;
}): string[] {
  const secretValues: string[] = [];
  for (const grant of params.permissions.env_file_grants ?? []) {
    try {
      const safe = resolveSafeWorktreePath(params.worktreeRoot, grant.file);
      const parsedFile = parseEnvFile(
        fs.readFileSync(safe.absolutePath, "utf-8"),
      );
      for (const name of grant.variable_names) {
        const value = parsedFile[name];
        if (value !== undefined && value.trim().length > 0) {
          secretValues.push(value);
        }
      }
    } catch {
      // 文件缺失/越界：跳过
    }
  }
  return secretValues;
}
