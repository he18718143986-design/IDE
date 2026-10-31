/**
 * TASK-L.9 / project-decomposition.md §5.1：按桩种类的签署前范围规则。
 *
 * 结果写入 ScopePlan（进入 plan_digest），再由签署链投影到
 * authorization.execution_permissions / needs_approval。
 */

import type { NetworkPolicy } from "../contract.schema";
import type {
  ScopePlan,
  ScopePlanNeedsApproval,
} from "../journey/scope-plan";
import { scopePlanDigest } from "../journey/scope-plan";
import type { ContractStub, StubKind } from "./project-plan";

/** 包管理器注册表域名（EXPLICIT_TARGETS） */
export const PACKAGE_REGISTRY_TARGETS = [
  "registry.npmjs.org",
  "registry.yarnpkg.com",
  "registry.npmmirror.com",
] as const;

/** 常见锁文件：进入 needs_approval，由「确认开工」一次授权 */
export const LOCKFILE_PATHS = [
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "Cargo.lock",
  "poetry.lock",
  "Pipfile.lock",
] as const;

export interface StubExecutionExtras {
  dependency_changes_allowed: boolean;
  network_policy: NetworkPolicy;
  allowed_commands: string[];
  network_targets: string[];
}

function installCommandForStub(stub: ContractStub): string {
  const dep = stub.context?.dependency;
  if (dep?.name) {
    const ver = dep.version ? `@${dep.version}` : "";
    return `npm install -D ${dep.name}${ver}`;
  }
  if (stub.kind === "test_foundation") {
    return "npm install -D vitest";
  }
  if (stub.kind === "dependency") {
    return "npm install";
  }
  return "npm install";
}

function lockfileApprovals(): ScopePlanNeedsApproval[] {
  return [
    {
      id: "lockfiles",
      label: "依赖锁文件",
      why: "安装或升级依赖会改动锁文件，需要你点头一次",
      paths: [...LOCKFILE_PATHS],
      approved: null,
    },
    {
      id: "package-json",
      label: "项目依赖清单（package.json）",
      why: "安装依赖会改动 package.json",
      paths: ["package.json"],
      approved: null,
    },
  ];
}

export function stubKindsWithDependencyRules(
  kind: StubKind,
): kind is "test_foundation" | "dependency" {
  return kind === "test_foundation" || kind === "dependency";
}

/**
 * 在已有 ScopePlan 上叠加 §5.1 规则；返回新对象并重算 digest。
 */
export function applyStubKindScopeRules(
  plan: ScopePlan,
  stub: ContractStub,
): ScopePlan {
  if (stubKindsWithDependencyRules(stub.kind)) {
    const cmd = installCommandForStub(stub);
    const existingApprovalIds = new Set(plan.needs_approval.map((n) => n.id));
    const extraApprovals = lockfileApprovals().filter(
      (a) => !existingApprovalIds.has(a.id),
    );
    const allowed = [
      ...new Set([...(plan.allowed_commands ?? []), cmd, "npm", "npx", "node"]),
    ];
    const next: ScopePlan = {
      ...plan,
      needs_approval: [...plan.needs_approval, ...extraApprovals],
      dependency_changes_allowed: true,
      network_policy: "EXPLICIT_TARGETS",
      network_targets: [...PACKAGE_REGISTRY_TARGETS],
      allowed_commands: allowed,
      plan_digest: "",
    };
    next.plan_digest = scopePlanDigest(next);
    return next;
  }

  if (stub.kind === "knowledge_bootstrap") {
    const knowledgeArea = {
      id: "knowledge-docs-system",
      label: "系统知识库",
      why: "本份只维护 docs/system 下的模块说明",
      module_ids: [],
      kind: "change_existing" as const,
      paths: ["docs/system/**"],
      excluded_by_user: false,
    };
    const commands = [
      ...plan.verification.commands,
      {
        command_id: "stagent-check-knowledge",
        command: "stagent",
        args: ["check", "knowledge", "--all"],
        cwd: ".",
      },
    ];
    // 去重 command_id
    const seen = new Set<string>();
    const deduped = commands.filter((c) => {
      if (seen.has(c.command_id)) return false;
      seen.add(c.command_id);
      return true;
    });
    const next: ScopePlan = {
      ...plan,
      areas: [knowledgeArea],
      verification: {
        ...plan.verification,
        commands: deduped,
        plain: [
          ...plan.verification.plain.filter(
            (p) => !p.includes("知识库"),
          ),
          "系统知识库检查全部通过",
        ],
        manual_only: false,
      },
      plan_digest: "",
    };
    next.plan_digest = scopePlanDigest(next);
    return next;
  }

  return plan;
}
