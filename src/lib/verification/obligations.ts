/**
 * TASK-L.3 / verification-strategy §3：测试义务纯函数。
 *
 * - 从合同 `supervisor_metadata.acceptance_refs` 派生义务；
 * - 运行器探测与机器报告分类；
 * - 不写盘、不跑子进程（CLI / L.4 编排再调）。
 */

import type { SoftwareContract } from "../contract.schema";

export type RunnerKind = "vitest" | "jest" | "pytest" | "go";

export interface RepoFacts {
  /** package.json 的 scripts */
  package_scripts?: Record<string, string>;
  /** dependencies + devDependencies 合并名 */
  package_deps?: Record<string, string>;
  /** 是否存在 go.mod */
  has_go_mod?: boolean;
  /** 是否存在 pytest 配置或依赖线索 */
  has_pytest?: boolean;
}

export interface DetectedRunner {
  kind: RunnerKind | null;
  /** 机器报告参数（不含路径） */
  reportArgs: string[];
}

export type ObligationLevel = "unit" | "integration" | "e2e";

export interface TestObligation {
  acceptance_id: string;
  test_path: string;
  level: ObligationLevel;
}

export interface DeriveObligationsResult {
  obligations: TestObligation[];
  waived: Array<{ acceptance_id: string; reason: "no_runner" }>;
}

/** L.11 前约定路径：tests/stagent/<acceptance_id>.test.<ext> */
export function obligationTestPath(
  acceptanceId: string,
  runner: DetectedRunner,
): string {
  const ext =
    runner.kind === "pytest"
      ? "py"
      : runner.kind === "go"
        ? "go"
        : "ts";
  return `tests/stagent/${acceptanceId}.test.${ext}`;
}

export function detectRunner(repoFacts: RepoFacts): DetectedRunner {
  const deps = {
    ...(repoFacts.package_deps ?? {}),
  };
  const scripts = repoFacts.package_scripts ?? {};
  const scriptBlob = Object.values(scripts).join("\n").toLowerCase();

  if (
    "vitest" in deps ||
    scriptBlob.includes("vitest") ||
    /\bvitest\b/.test(scripts["test"] ?? "")
  ) {
    return { kind: "vitest", reportArgs: ["--reporter=json"] };
  }
  if (
    "jest" in deps ||
    "@jest/core" in deps ||
    scriptBlob.includes("jest") ||
    /\bjest\b/.test(scripts["test"] ?? "")
  ) {
    return { kind: "jest", reportArgs: ["--json"] };
  }
  if (repoFacts.has_go_mod === true) {
    return { kind: "go", reportArgs: ["-json"] };
  }
  if (
    repoFacts.has_pytest === true ||
    "pytest" in deps ||
    scriptBlob.includes("pytest")
  ) {
    return {
      kind: "pytest",
      reportArgs: ["--junitxml=.stagent/records/obligation-junit.xml"],
    };
  }
  return { kind: null, reportArgs: [] };
}

/**
 * 从合同元数据派生义务。仅 `check: auto | both` 进入义务；
 * 无运行器时全部记入 waived（reason: no_runner）。
 */
export function deriveObligations(
  contract: SoftwareContract,
  runner: DetectedRunner,
): DeriveObligationsResult {
  const refs = contract.supervisor_metadata?.acceptance_refs ?? [];
  const autoRefs = refs.filter(
    (r) => r.check === "auto" || r.check === "both",
  );

  if (runner.kind === null) {
    return {
      obligations: [],
      waived: autoRefs.map((r) => ({
        acceptance_id: r.id,
        reason: "no_runner" as const,
      })),
    };
  }

  return {
    obligations: autoRefs.map((r) => ({
      acceptance_id: r.id,
      test_path: obligationTestPath(r.id, runner),
      level: "unit" as const,
    })),
    waived: [],
  };
}

/** 生成义务测试命令的结构化 argv（executable + args） */
export function obligationCommand(
  runner: DetectedRunner,
  paths: readonly string[],
): { executable: string; args: string[] } | null {
  if (runner.kind === null) return null;
  const uniquePaths = [...paths];
  switch (runner.kind) {
    case "vitest":
      return {
        executable: "npx",
        args: ["vitest", "run", "--reporter=json", ...uniquePaths],
      };
    case "jest":
      return {
        executable: "npx",
        args: ["jest", "--json", ...uniquePaths],
      };
    case "pytest":
      return {
        executable: "pytest",
        args: [
          "--junitxml=.stagent/records/obligation-junit.xml",
          ...uniquePaths,
        ],
      };
    case "go":
      return {
        executable: "go",
        args: ["test", "-json", ...uniquePaths],
      };
    default:
      return null;
  }
}

/** 规范化运行报告（测试与 CLI 共用） */
export interface NormalizedRunReport {
  test_count: number;
  assertion_failures: number;
  collection_or_compile_errors: number;
}

export type ObligationRunClass = "red" | "red_invalid" | "green";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/** 接受规范化报告或常见运行器 JSON，归一后分类 */
export function normalizeRunReport(report: unknown): NormalizedRunReport {
  const obj = asRecord(report);
  if (!obj) {
    return {
      test_count: 0,
      assertion_failures: 0,
      collection_or_compile_errors: 1,
    };
  }

  // stagent 规范化夹具
  if (
    obj["schema"] === "stagent-obligation-report-v1" ||
    typeof obj["test_count"] === "number"
  ) {
    return {
      test_count: Number(obj["test_count"] ?? 0),
      assertion_failures: Number(obj["assertion_failures"] ?? 0),
      collection_or_compile_errors: Number(
        obj["collection_or_compile_errors"] ?? 0,
      ),
    };
  }

  // vitest / jest JSON 摘要字段
  if (
    typeof obj["numTotalTests"] === "number" ||
    typeof obj["numFailedTests"] === "number"
  ) {
    const total = Number(obj["numTotalTests"] ?? 0);
    const failed = Number(obj["numFailedTests"] ?? 0);
    const compileErrors =
      typeof obj["success"] === "boolean" &&
      obj["success"] === false &&
      total === 0
        ? 1
        : Number(obj["numRuntimeErrorTestSuites"] ?? 0) > 0
          ? Number(obj["numRuntimeErrorTestSuites"])
          : 0;
    return {
      test_count: total,
      assertion_failures: failed,
      collection_or_compile_errors: compileErrors,
    };
  }

  // 无法识别 → 视为收集错误
  return {
    test_count: 0,
    assertion_failures: 0,
    collection_or_compile_errors: 1,
  };
}

/**
 * 规则（verification-strategy §3.2）：
 * - ≥1 用例且 ≥1 断言失败 → red
 * - 收集或编译错误 → red_invalid
 * - 全过 → green
 * - 0 用例 → red_invalid
 */
export function classifyRun(report: unknown): ObligationRunClass {
  const n = normalizeRunReport(report);
  if (n.collection_or_compile_errors > 0) return "red_invalid";
  if (n.test_count <= 0) return "red_invalid";
  if (n.assertion_failures > 0) return "red";
  return "green";
}

/** 从仓库目录拼装 RepoFacts（纯同步读；调用方决定是否使用） */
export function repoFactsFromPackageJson(pkg: {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} | null): RepoFacts {
  if (!pkg) return {};
  return {
    package_scripts: { ...(pkg.scripts ?? {}) },
    package_deps: {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    },
  };
}
