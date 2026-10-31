/**
 * TASK-J.2 / SSOT §15.3：Daemon 范围预检构建器。
 *
 * - 由方案结构（标题/摘要/模块/备注）派生 ScopePlan，不把原始聊天当签署输入
 *   （ADR-0018 INV-SEAL-01）；
 * - 组合既有 buildL0Plan / gradeWritableScope / isGreenfieldRepo / 保护清单 /
 *   dirty_exclusions / DEFAULT_FORBIDDEN_PATHS；
 * - 自动收敛 bare_top_glob（只落真实存在的子目录；禁止编造路径）；
 * - verification 以 package.json scripts 为准；
 * - 来源可追加（为 TASK-L.3 withSystemScope 留扩展点）。
 */

import fs from "node:fs";
import path from "node:path";
import { gradeWritableScope } from "../../src/lib/writable-scope-grade";
import {
  applyScopeDecisions,
  formatBudgetPlain,
  plainAreaLabel,
  scopePlanDigest,
  type ScopePlan,
  type ScopePlanDecisions,
  type ScopePlanNeedsApproval,
  type ScopePlanNeverTouch,
} from "../../src/lib/journey/scope-plan";
import { applyStubKindScopeRules } from "../../src/lib/project/stub-scope-rules";
import type { SchemeDraft } from "../../src/lib/journey/scheme-draft";
import type {
  BudgetLimits,
  VerificationCommand,
} from "../../src/lib/contract.schema";
import {
  detectRunner,
  obligationCommand,
  repoFactsFromPackageJson,
  type DetectedRunner,
  type RepoFacts,
} from "../../src/lib/verification/obligations";
import {
  DEFAULT_DRAFT_BUDGET,
  DEFAULT_FORBIDDEN_PATHS,
  buildL0Plan,
  extractPathsFromText,
  isGreenfieldRepo,
} from "./rules-l0";
import type { SupervisorMessage } from "./types";

/** 构建器接受的方案输入：兼容现行 SchemeDraft 与未来 SchemeDraftV2 子集 */
export type SchemeAcceptanceItem = {
  id: string;
  text: string;
  check: "auto" | "playtest" | "both";
};

export type ScopePlanSchemeInput = Pick<
  SchemeDraft,
  "scheme_revision" | "title" | "summary" | "modules" | "notes"
> & {
  /** V2：结构化模块（可选） */
  modules_v2?: ReadonlyArray<{
    id?: string;
    name: string;
    purpose?: string;
    kind?: "new" | "change_existing";
    project_anchor?: string;
  }>;
  out_of_scope?: ReadonlyArray<{ text: string }>;
  /** V2：白话验收条目（TASK-L.3 withSystemScope / 合同元数据） */
  acceptance?: ReadonlyArray<SchemeAcceptanceItem>;
};

export interface BuildScopePlanInput {
  repoRoot: string;
  scheme: ScopePlanSchemeInput;
  decisions?: ScopePlanDecisions;
  /** TASK-L.9：合同桩 → 应用 §5.1 种类规则 */
  stub?: import("../../src/lib/project/project-plan").ContractStub | null;
}

/** 可追加来源的贡献（L.3 withSystemScope 等往这里挂） */
export interface ScopePlanSourceContribution {
  writable_paths?: string[];
  forbidden_paths?: string[];
  never_touch?: ScopePlanNeverTouch[];
  needs_approval?: ScopePlanNeedsApproval[];
  commands?: VerificationCommand[];
  budget_limits?: Partial<BudgetLimits>;
}

export interface ScopePlanSourceContext {
  repoRoot: string;
  scheme: ScopePlanSchemeInput;
  /** 当前已汇合的路径/禁写等（只读快照） */
  accumulated: Readonly<ScopePlanSourceContribution>;
}

export interface ScopePlanSource {
  id: string;
  contribute(ctx: ScopePlanSourceContext): ScopePlanSourceContribution;
}

export interface BuildScopePlanOptions {
  /** 额外来源；按数组顺序追加合并（后写覆盖同 id 敏感项时去重保序） */
  extraSources?: readonly ScopePlanSource[];
}

const FIXED_NEVER_TOUCH: readonly ScopePlanNeverTouch[] = [
  { label: "密码与钥匙文件", paths: [".env*"] },
  { label: "版本库元数据", paths: ["**/.git/**"] },
  { label: "Stagent 自身", paths: ["**/.stagent/**"] },
  {
    label: "依赖锁文件",
    paths: ["package-lock.json", "pnpm-lock.yaml"],
  },
];

function moduleNames(scheme: ScopePlanSchemeInput): string[] {
  if (scheme.modules_v2 && scheme.modules_v2.length > 0) {
    return scheme.modules_v2.map((m) => m.name);
  }
  return [...scheme.modules];
}

/** 方案结构 → 合成文本（供路径提取 / token 匹配；不是聊天旁路） */
export function synthesizeSchemeScopeText(scheme: ScopePlanSchemeInput): string {
  const parts: string[] = [
    scheme.title ?? "",
    scheme.summary ?? "",
    ...moduleNames(scheme),
    scheme.notes ?? "",
  ];
  if (scheme.modules_v2) {
    for (const m of scheme.modules_v2) {
      if (m.purpose) parts.push(m.purpose);
      if (m.project_anchor) parts.push(m.project_anchor);
    }
  }
  if (scheme.out_of_scope) {
    for (const item of scheme.out_of_scope) parts.push(item.text);
  }
  return parts.filter((p) => p.trim().length > 0).join("\n");
}

function syntheticMessages(text: string): SupervisorMessage[] {
  return [
    {
      message_id: "scheme-scope-synth",
      role: "user",
      text,
      // 固定时间戳：构建器输出不得因时钟漂移
      created_at: "1970-01-01T00:00:00.000Z",
      source: "ui",
    },
  ];
}

function dedupePreserve(paths: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of paths) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

function mergeContribution(
  base: ScopePlanSourceContribution,
  extra: ScopePlanSourceContribution,
): ScopePlanSourceContribution {
  const merged: ScopePlanSourceContribution = {
    writable_paths: dedupePreserve([
      ...(base.writable_paths ?? []),
      ...(extra.writable_paths ?? []),
    ]),
    forbidden_paths: dedupePreserve([
      ...(base.forbidden_paths ?? []),
      ...(extra.forbidden_paths ?? []),
    ]),
    never_touch: [
      ...(base.never_touch ?? []),
      ...(extra.never_touch ?? []),
    ],
    needs_approval: [
      ...(base.needs_approval ?? []),
      ...(extra.needs_approval ?? []),
    ],
    budget_limits: { ...(base.budget_limits ?? {}), ...(extra.budget_limits ?? {}) },
  };
  const commands =
    extra.commands !== undefined && extra.commands.length > 0
      ? extra.commands
      : base.commands;
  if (commands !== undefined) {
    merged.commands = commands;
  }
  return merged;
}

/** 英文 token（大小写不敏感匹配子目录名） */
function englishTokens(text: string): string[] {
  const found = text.match(/[A-Za-z][A-Za-z0-9_-]*/g) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of found) {
    const key = raw.toLowerCase();
    if (key.length < 2) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

function listImmediateSubdirs(repoRoot: string, top: string): string[] {
  const abs = path.join(repoRoot, top);
  try {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return [];
    return fs
      .readdirSync(abs, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

function pathExistsInRepo(repoRoot: string, rel: string): boolean {
  try {
    return fs.existsSync(path.join(repoRoot, rel));
  } catch {
    return false;
  }
}

/**
 * 自动收敛 bare_top_glob（确定性）：
 * ① 方案 token 命中真实子目录 → `<top>/<dir>/**`
 * ② 显式相对路径 → 精确保留（且路径在仓库中存在，或为带扩展名的文件候选且父目录存在）
 * 全部未命中 → 返回 null（保留在 rejected，禁止编造）
 */
export function convergeBareTopGlob(input: {
  repoRoot: string;
  rejectedPath: string;
  schemeText: string;
  explicitPaths: readonly string[];
}): string[] | null {
  const bare = input.rejectedPath.match(/^([^/]+)\/\*\*?$/);
  if (!bare) return null;
  const top = bare[1]!;

  const subdirs = listImmediateSubdirs(input.repoRoot, top);
  if (subdirs.length === 0 && input.explicitPaths.length === 0) return null;

  const tokens = englishTokens(input.schemeText).map((t) => t.toLowerCase());
  const matchedDirs = subdirs.filter((dir) =>
    tokens.includes(dir.toLowerCase()),
  );

  if (matchedDirs.length > 0) {
    return matchedDirs.map((dir) => `${top}/${dir}/**`);
  }

  // ② 显式路径精确保留
  const kept: string[] = [];
  for (const raw of input.explicitPaths) {
    const p = raw.replace(/\\/g, "/");
    if (p === top || p === `${top}/**` || p === `${top}/*`) continue;
    if (!(p === top || p.startsWith(`${top}/`))) continue;
    // 真实存在的文件/目录；或父目录存在的文件路径（尚未创建的新文件，父级须在）
    if (pathExistsInRepo(input.repoRoot, p)) {
      kept.push(p);
      continue;
    }
    const parent = path.posix.dirname(p);
    if (
      parent !== "." &&
      parent.startsWith(top) &&
      pathExistsInRepo(input.repoRoot, parent) &&
      /\.[A-Za-z0-9]+$/.test(p)
    ) {
      kept.push(p);
    }
  }
  return kept.length > 0 ? dedupePreserve(kept) : null;
}

/**
 * verification：只认 package.json 里真实存在的 typecheck / test 脚本。
 * 一个都没有 → manual_only。
 */
export function verificationFromPackageJson(repoRoot: string): {
  commands: VerificationCommand[];
  plain: string[];
  manual_only: boolean;
} {
  const pkgPath = path.join(repoRoot, "package.json");
  let scripts: Record<string, string> = {};
  try {
    if (!fs.existsSync(pkgPath)) {
      return {
        commands: [],
        plain: ["这个项目没有自动检查，完成后需要你试玩确认"],
        manual_only: true,
      };
    }
    const raw = fs.readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    scripts = parsed.scripts ?? {};
  } catch {
    return {
      commands: [],
      plain: ["这个项目没有自动检查，完成后需要你试玩确认"],
      manual_only: true,
    };
  }

  const commands: VerificationCommand[] = [];
  const plain: string[] = [];
  if (typeof scripts["typecheck"] === "string") {
    commands.push({
      alias: "typecheck",
      executable: "npm",
      args: ["run", "typecheck"],
      expected_exit_code: 0,
      timeout_seconds: 120,
    });
    plain.push("代码能通过类型检查");
  }
  if (typeof scripts["test"] === "string") {
    commands.push({
      alias: "test",
      executable: "npm",
      args: ["test"],
      expected_exit_code: 0,
      timeout_seconds: 300,
    });
    plain.push("自动测试全部通过");
  }

  if (commands.length === 0) {
    return {
      commands: [],
      plain: ["这个项目没有自动检查，完成后需要你试玩确认"],
      manual_only: true,
    };
  }
  return { commands, plain, manual_only: false };
}

function buildNeverTouch(
  dirtyExclusions: readonly string[],
  extraForbidden: readonly string[],
  outOfScopeTexts: readonly string[],
): ScopePlanNeverTouch[] {
  const groups: ScopePlanNeverTouch[] = FIXED_NEVER_TOUCH.map((g) => ({
    label: g.label,
    paths: [...g.paths],
  }));

  // DEFAULT_FORBIDDEN 已体现在 FIXED；额外禁写（除默认外）归入「其它禁区」
  const defaultSet = new Set(DEFAULT_FORBIDDEN_PATHS);
  const extras = extraForbidden.filter((p) => !defaultSet.has(p));
  const dirty = dirtyExclusions.filter(Boolean);
  if (dirty.length > 0) {
    groups.push({
      label: "本地未保存或未跟踪的文件",
      paths: [...dirty],
    });
  }
  const extrasNotDirty = extras.filter((p) => !dirty.includes(p));
  if (extrasNotDirty.length > 0) {
    groups.push({ label: "其它禁区", paths: extrasNotDirty });
  }
  if (outOfScopeTexts.length > 0) {
    groups.push({
      label: "你说过这次先别做的事",
      paths: outOfScopeTexts.map((t) => `out_of_scope:${t}`),
    });
  }
  return groups;
}

function findModuleForPath(
  pathPattern: string,
  scheme: ScopePlanSchemeInput,
): { id: string; name: string; kind: "change_existing" | "create_new" } | null {
  const cleaned = pathPattern
    .replace(/\/\*\*$/, "")
    .replace(/\/\*$/, "")
    .toLowerCase();
  if (scheme.modules_v2) {
    for (const [index, m] of scheme.modules_v2.entries()) {
      const anchor = (m.project_anchor ?? m.name).toLowerCase();
      if (
        cleaned.includes(anchor) ||
        englishTokens(m.name).some((t) =>
          cleaned.includes(t.toLowerCase()),
        )
      ) {
        return {
          id: m.id ?? `mod-${index}`,
          name: m.name,
          kind: m.kind === "new" ? "create_new" : "change_existing",
        };
      }
    }
  }
  for (const [index, name] of moduleNames(scheme).entries()) {
    const tokens = englishTokens(name);
    if (
      tokens.some((t) => cleaned.includes(t.toLowerCase())) ||
      cleaned.includes(name.toLowerCase())
    ) {
      return {
        id: `mod-${index}`,
        name,
        kind: "change_existing",
      };
    }
  }
  return null;
}

function buildAreas(
  writablePaths: readonly string[],
  scheme: ScopePlanSchemeInput,
): ScopePlan["areas"] {
  return writablePaths.map((p, index) => {
    const mod = findModuleForPath(p, scheme);
    const label = plainAreaLabel(p, mod?.name);
    return {
      id: `area-${index}`,
      label,
      why: mod
        ? `因为要做「${mod.name}」`
        : "根据当前方案整理出的改动范围",
      module_ids: mod ? [mod.id] : [],
      kind: mod?.kind ?? "change_existing",
      paths: [p],
      excluded_by_user: false,
    };
  });
}

function buildNeedsApproval(
  protectedFiles: readonly string[],
  protectedNames: readonly string[],
): ScopePlanNeedsApproval[] {
  return protectedFiles.map((file, index) => ({
    id: `prot-${index}`,
    label: protectedNames[index] ?? file,
    why: "命中保护清单，开工前需要你点头",
    paths: [file],
    approved: null,
  }));
}

/**
 * 组合各来源 → 分级 / 收敛 → ScopePlan（含 digest）。
 */
export function buildScopePlan(
  input: BuildScopePlanInput,
  options?: BuildScopePlanOptions,
): ScopePlan {
  const repoRoot = input.repoRoot;
  const scheme = input.scheme;
  const schemeText = synthesizeSchemeScopeText(scheme);
  const explicitPaths = extractPathsFromText(schemeText);

  const l0 = buildL0Plan({
    repoRoot,
    messages: syntheticMessages(schemeText),
  });

  let contribution: ScopePlanSourceContribution = {
    writable_paths: [...l0.writable_paths],
    forbidden_paths: [...l0.strictly_forbidden_paths],
    never_touch: buildNeverTouch(
      l0.dirty_exclusions,
      l0.strictly_forbidden_paths,
      (scheme.out_of_scope ?? []).map((o) => o.text),
    ),
    needs_approval: buildNeedsApproval(
      l0.protected_files,
      l0.protected_entry_names,
    ),
    commands: [...l0.commands],
    budget_limits: { ...l0.budget },
  };

  for (const source of options?.extraSources ?? []) {
    const piece = source.contribute({
      repoRoot,
      scheme,
      accumulated: contribution,
    });
    contribution = mergeContribution(contribution, piece);
  }

  // verification 以 package.json scripts 为准（覆盖 L0 默认命令）
  const verification = verificationFromPackageJson(repoRoot);

  const greenfield = isGreenfieldRepo(repoRoot);
  let writable = dedupePreserve(contribution.writable_paths ?? []);

  // 先分级，再对 bare_top_glob 做自动收敛（失败则保留原路径以便 grade.rejected 可见）
  let grade = gradeWritableScope({
    writable_paths: writable,
    greenfield,
  });

  if (!grade.ok) {
    const nextWritable: string[] = [];
    const acceptedSet = new Set(grade.accepted.map((a) => a.path));

    for (const pathPattern of writable) {
      if (acceptedSet.has(pathPattern)) {
        nextWritable.push(pathPattern);
        continue;
      }
      const hit = grade.rejected.find((r) => r.path === pathPattern);
      if (!hit) {
        nextWritable.push(pathPattern);
        continue;
      }
      if (hit.kind === "bare_top_glob" && !greenfield) {
        const converged = convergeBareTopGlob({
          repoRoot,
          rejectedPath: pathPattern,
          schemeText,
          explicitPaths,
        });
        if (converged && converged.length > 0) {
          nextWritable.push(...converged);
          continue;
        }
      }
      // 未收敛：原样保留，重分级后仍进入 grade.rejected（禁止编造路径）
      nextWritable.push(pathPattern);
    }

    writable = dedupePreserve(nextWritable);
    grade = gradeWritableScope({
      writable_paths: writable,
      greenfield,
    });
  }

  // 最终进入 areas 的路径 = 分级接受的路径；拒绝项只留在 grade.rejected
  const acceptedPaths = grade.accepted.map((a) => a.path);
  // 绿野种子：若全部被拒但绿野放行过，accepted 已含；老项目无收敛则 areas 可能为空
  const areas = buildAreas(
    acceptedPaths.length > 0 ? acceptedPaths : [],
    scheme,
  );

  const limits: BudgetLimits = {
    ...DEFAULT_DRAFT_BUDGET,
    ...(contribution.budget_limits ?? {}),
  };

  let plan: ScopePlan = {
    scheme_revision: scheme.scheme_revision,
    plan_digest: "",
    areas,
    never_touch: contribution.never_touch ?? [],
    needs_approval: contribution.needs_approval ?? [],
    verification: {
      commands: verification.commands,
      plain: verification.plain,
      manual_only: verification.manual_only,
    },
    budget: {
      limits,
      plain: formatBudgetPlain(limits),
    },
    grade: {
      ok: grade.ok,
      rejected: grade.rejected.map((r) => ({
        path: r.path,
        kind: r.kind,
      })),
    },
  };

  // TASK-L.3：签署前并入系统范围（义务测试路径 + stagent check 命令）
  const withSystem = withSystemScope(plan, {
    repoRoot,
    scheme,
  });
  plan = withSystem;

  plan.plan_digest = scopePlanDigest(plan);

  // TASK-L.9：按桩种类叠加签署前范围规则（进入 plan_digest）
  if (input.stub) {
    plan = applyStubKindScopeRules(plan, input.stub);
  }

  if (input.decisions) {
    return applyScopeDecisions(plan, input.decisions);
  }
  return plan;
}

/** 系统范围上下文（L.3 / L.12 共用形状） */
export interface SystemScopeContext {
  repoRoot: string;
  scheme: ScopePlanSchemeInput;
  /** 可注入；缺省时从 package.json / go.mod / pytest 线索探测 */
  repoFacts?: RepoFacts;
  runner?: DetectedRunner;
}

const SYSTEM_TESTS_PATH = "tests/stagent/**";
const SYSTEM_AREA_ID = "system-tests-stagent";

function readRepoFacts(repoRoot: string): RepoFacts {
  const facts: RepoFacts = {};
  const pkgPath = path.join(repoRoot, "package.json");
  try {
    if (fs.existsSync(pkgPath)) {
      const raw = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      Object.assign(facts, repoFactsFromPackageJson(raw));
    }
  } catch {
    // ignore malformed package.json
  }
  try {
    if (fs.existsSync(path.join(repoRoot, "go.mod"))) {
      facts.has_go_mod = true;
    }
  } catch {
    // ignore
  }
  const pytestHints = [
    "pytest.ini",
    "pyproject.toml",
    "setup.cfg",
    "tox.ini",
  ];
  for (const hint of pytestHints) {
    try {
      if (fs.existsSync(path.join(repoRoot, hint))) {
        facts.has_pytest = true;
        break;
      }
    } catch {
      // ignore
    }
  }
  return facts;
}

function hasAutoAcceptance(
  scheme: ScopePlanSchemeInput,
): boolean {
  return (scheme.acceptance ?? []).some(
    (a) => a.check === "auto" || a.check === "both",
  );
}

/**
 * TASK-L.3：签署前系统贡献。
 *
 * - 方案含 check: auto/both 且 detectRunner 非空 → 写范围 tests/stagent/**
 * - 追加义务命令 + `stagent check obligations` + `stagent check test-integrity`
 * - 无 auto 条目或无运行器时原样返回（digest 不变）
 */
export function withSystemScope(
  plan: ScopePlan,
  ctx: SystemScopeContext,
): ScopePlan {
  if (!hasAutoAcceptance(ctx.scheme)) {
    return plan;
  }

  const facts = ctx.repoFacts ?? readRepoFacts(ctx.repoRoot);
  const runner = ctx.runner ?? detectRunner(facts);
  if (runner.kind === null) {
    return plan;
  }

  const next: ScopePlan = {
    ...plan,
    areas: plan.areas.map((a) => ({
      ...a,
      paths: [...a.paths],
      module_ids: [...a.module_ids],
    })),
    never_touch: plan.never_touch.map((g) => ({
      ...g,
      paths: [...g.paths],
    })),
    needs_approval: plan.needs_approval.map((item) => ({
      ...item,
      paths: [...item.paths],
    })),
    verification: {
      commands: plan.verification.commands.map((c) => ({
        ...c,
        args: [...c.args],
      })),
      plain: [...plan.verification.plain],
      manual_only: plan.verification.manual_only,
    },
    budget: {
      limits: { ...plan.budget.limits },
      plain: plan.budget.plain,
    },
    grade: {
      ok: plan.grade.ok,
      rejected: plan.grade.rejected.map((r) => ({ ...r })),
    },
    plan_digest: "",
  };

  const alreadyHasTestsPath = next.areas.some((a) =>
    a.paths.includes(SYSTEM_TESTS_PATH),
  );
  if (!alreadyHasTestsPath) {
    next.areas.push({
      id: SYSTEM_AREA_ID,
      label: plainAreaLabel(SYSTEM_TESTS_PATH),
      why: "本合同验收条目需要自动测试义务",
      module_ids: [],
      kind: "create_new",
      paths: [SYSTEM_TESTS_PATH],
      excluded_by_user: false,
    });
  }

  const obligationPaths = (ctx.scheme.acceptance ?? [])
    .filter((a) => a.check === "auto" || a.check === "both")
    .map((a) => `tests/stagent/${a.id}.test.${runner.kind === "pytest" ? "py" : runner.kind === "go" ? "go" : "ts"}`);

  const cmd = obligationCommand(runner, obligationPaths);
  const extraCommands: VerificationCommand[] = [];
  if (cmd) {
    extraCommands.push({
      alias: "obligation-tests",
      executable: cmd.executable,
      args: cmd.args,
      expected_exit_code: 0,
      timeout_seconds: 300,
    });
  }
  extraCommands.push(
    {
      alias: "check-obligations",
      executable: "stagent",
      args: [
        "check",
        "obligations",
        "--report",
        ".stagent/records/obligation-report.json",
      ],
      expected_exit_code: 0,
      timeout_seconds: 60,
    },
    {
      alias: "check-test-integrity",
      executable: "stagent",
      args: [
        "check",
        "test-integrity",
        "--base",
        ".stagent/records/test-baseline",
        "--candidate",
        ".stagent/records/test-candidate",
        "--lang",
        runner.kind === "pytest" ? "py" : runner.kind === "go" ? "go" : "ts",
      ],
      expected_exit_code: 0,
      timeout_seconds: 60,
    },
  );

  const existingAliases = new Set(
    next.verification.commands.map((c) => c.alias),
  );
  for (const c of extraCommands) {
    if (existingAliases.has(c.alias)) continue;
    next.verification.commands.push(c);
    existingAliases.add(c.alias);
  }
  if (next.verification.commands.length > 0) {
    next.verification.manual_only = false;
    if (
      !next.verification.plain.includes("义务测试先红后绿，且既有测试不被削弱")
    ) {
      next.verification.plain.push(
        "义务测试先红后绿，且既有测试不被削弱",
      );
    }
  }

  next.plan_digest = scopePlanDigest(next);
  return next;
}
