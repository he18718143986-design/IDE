import { createHash } from "node:crypto";
import { isTestPath, normalizeTestRelPath } from "../../daemon/guard/test-integrity";

/**
 * 测试资产类型：
 * - test_suite: 测试用例文件 (*.test.*, *.spec.*)
 * - config: 测试与类型配置文件 (vitest.config.ts, tsconfig.json 等)
 * - fixture: 测试夹具、样例数据与 Mock 文件 (fixtures/**, mocks/**)
 * - helper: 测试共享辅助函数库 (helpers/**, test-utils/**)
 * - script: 测试验证脚本 (scripts/verify-*.ts, scripts/check-*.ts)
 */
export type TestAssetKind =
  | "test_suite"
  | "config"
  | "fixture"
  | "helper"
  | "script";

/**
 * 判定级别：
 * - BLOCKING: 篡改或缺失必须阻断（fail-closed）或触发基线重跑/还原
 * - AUDIT_ONLY: 仅留存审计日志，不直接阻断
 */
export type TestAssetCriticality = "BLOCKING" | "AUDIT_ONLY";

export interface TestAssetItem {
  relPath: string;
  assetKind: TestAssetKind;
  sha256: string;
  criticality: TestAssetCriticality;
}

export interface TestAssetManifest {
  manifestVersion: "1.0.0";
  baseCommit: string;
  assets: Record<string, TestAssetItem>;
}

const CONFIG_FILE_PATTERNS = [
  /^vitest\.config\.(ts|js|mjs|mts)$/i,
  /^tsconfig(\.[^/]+)?\.json$/i,
  /^playwright\.config\.(ts|js|mjs)$/i,
  /^jest\.config\.(ts|js|mjs)$/i,
  /^pytest\.ini$/i,
  /^\.mocharc\.(json|yaml|yml|js)$/i,
];

const FIXTURE_SEGMENTS = new Set(["fixtures", "__fixtures__", "mocks", "__mocks__"]);
const HELPER_SEGMENTS = new Set(["helpers", "helper", "utils", "util", "support"]);

export function normalizeAssetRelPath(relPath: string): string {
  return normalizeTestRelPath(relPath);
}

export function computeSha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * 识别测试资产类型（纯函数）
 */
export function classifyTestAssetKind(relPath: string): TestAssetKind | null {
  const normalized = normalizeAssetRelPath(relPath);
  if (!normalized) return null;

  const segments = normalized.split("/");
  const basename = segments[segments.length - 1] ?? "";

  // 1. 配置文件识别
  if (segments.length === 1 && CONFIG_FILE_PATTERNS.some((p) => p.test(basename))) {
    return "config";
  }
  // 子目录下的 tsconfig 等配置（如 configs/tsconfig.base.json）
  if (CONFIG_FILE_PATTERNS.some((p) => p.test(basename))) {
    return "config";
  }

  // 2. 夹具与 mock 识别
  if (segments.some((seg) => FIXTURE_SEGMENTS.has(seg.toLowerCase()))) {
    return "fixture";
  }

  // 3. 测试目录内的 helper 识别
  const isInsideTestDir = segments
    .slice(0, -1)
    .some((seg) => ["tests", "test", "__tests__"].includes(seg.toLowerCase()));

  if (isInsideTestDir) {
    if (segments.some((seg) => HELPER_SEGMENTS.has(seg.toLowerCase()))) {
      return "helper";
    }
    if (/(^|[._-])(helper|support|test-util)(s)?(\.|$)/i.test(basename)) {
      return "helper";
    }
  }

  // 4. 测试套件识别 (isTestPath)
  if (isTestPath(normalized)) {
    return "test_suite";
  }

  // 5. 校验/验证脚本
  if (
    segments[0] === "scripts" &&
    /^(verify-|check-|test-).*\.(ts|js|mjs)$/i.test(basename)
  ) {
    return "script";
  }

  return null;
}

export function isTestAsset(relPath: string): boolean {
  return classifyTestAssetKind(relPath) !== null;
}

export function determineAssetCriticality(
  kind: TestAssetKind,
): TestAssetCriticality {
  switch (kind) {
    case "test_suite":
    case "config":
    case "fixture":
    case "helper":
      return "BLOCKING";
    case "script":
      return "AUDIT_ONLY";
  }
}

/**
 * 基于基准文件列表构建不可变 TestAssetManifest
 */
export function buildTestAssetManifest(
  baseCommit: string,
  files: Array<{ relPath: string; content: string | Buffer }>,
): TestAssetManifest {
  const assets: Record<string, TestAssetItem> = {};

  for (const file of files) {
    const normalized = normalizeAssetRelPath(file.relPath);
    const kind = classifyTestAssetKind(normalized);
    if (!kind) continue;

    assets[normalized] = {
      relPath: normalized,
      assetKind: kind,
      sha256: computeSha256(file.content),
      criticality: determineAssetCriticality(kind),
    };
  }

  return {
    manifestVersion: "1.0.0",
    baseCommit,
    assets,
  };
}

/**
 * 计算 Manifest 的完整哈希签名摘要
 */
export function computeManifestDigest(manifest: TestAssetManifest): string {
  const sortedKeys = Object.keys(manifest.assets).sort();
  const sortedPayload = sortedKeys.map((k) => ({
    path: k,
    sha: manifest.assets[k]!.sha256,
    kind: manifest.assets[k]!.assetKind,
    criticality: manifest.assets[k]!.criticality,
  }));
  const serialized = JSON.stringify({
    version: manifest.manifestVersion,
    baseCommit: manifest.baseCommit,
    assets: sortedPayload,
  });
  return computeSha256(serialized);
}

export interface TestAssetAuditResult {
  passed: boolean;
  modifiedConfigs: string[];
  modifiedFixtures: string[];
  modifiedHelpers: string[];
  modifiedSuites: string[];
  deletedSuites: string[];
  deletedFixturesOrHelpers: string[];
  addedSuites: string[];
  unregisteredAssets: string[];
  unregisteredConfigs: string[];
  /** 需要纳入还原路径集并在基线重跑前恢复的文件列表 */
  pathsToRestore: string[];
  /** 违规原因说明 */
  violations: string[];
}

/**
 * 比对工作区文件与 Manifest 审计变动（纯函数）
 */
export function auditTestAssetsAgainstManifest(options: {
  manifest: TestAssetManifest;
  currentFiles: Record<string, string | Buffer | null>; // null 表示被删除
  allowTestConfigMutation?: boolean;
}): TestAssetAuditResult {
  const { manifest, currentFiles, allowTestConfigMutation = false } = options;

  const modifiedConfigs: string[] = [];
  const modifiedFixtures: string[] = [];
  const modifiedHelpers: string[] = [];
  const modifiedSuites: string[] = [];
  const deletedSuites: string[] = [];
  const deletedFixturesOrHelpers: string[] = [];
  const addedSuites: string[] = [];
  const unregisteredAssets: string[] = [];
  const unregisteredConfigs: string[] = [];
  const violations: string[] = [];

  // 1. 检查基线清单中的资产在当前工作区的状态
  for (const [relPath, baseAsset] of Object.entries(manifest.assets)) {
    if (!(relPath in currentFiles)) {
      // 当前文件集合未提及，假设未变更
      continue;
    }

    const currentContent = currentFiles[relPath];
    if (currentContent === null) {
      // 资产被删除
      if (baseAsset.assetKind === "test_suite") {
        deletedSuites.push(relPath);
      } else if (
        baseAsset.assetKind === "fixture" ||
        baseAsset.assetKind === "helper"
      ) {
        deletedFixturesOrHelpers.push(relPath);
      } else if (baseAsset.assetKind === "config") {
        modifiedConfigs.push(relPath);
        if (!allowTestConfigMutation) {
          violations.push(`Test configuration deleted: ${relPath}`);
        }
      }
      continue;
    }

    // 比较哈希
    const currentSha = computeSha256(currentContent);
    if (currentSha !== baseAsset.sha256) {
      switch (baseAsset.assetKind) {
        case "config":
          modifiedConfigs.push(relPath);
          if (!allowTestConfigMutation) {
            violations.push(`Test configuration mutated without exemption: ${relPath}`);
          }
          break;
        case "fixture":
          modifiedFixtures.push(relPath);
          break;
        case "helper":
          modifiedHelpers.push(relPath);
          break;
        case "test_suite":
          modifiedSuites.push(relPath);
          break;
        case "script":
          // audit only
          break;
      }
    }
  }

  // 2. 检查新增的文件是否属于未登记资产
  for (const [rawPath, content] of Object.entries(currentFiles)) {
    if (content === null) continue;
    const relPath = normalizeAssetRelPath(rawPath);
    if (manifest.assets[relPath]) continue; // 已在基线中

    const detectedKind = classifyTestAssetKind(relPath);
    if (detectedKind === null) continue; // 不是测试资产

    if (detectedKind === "test_suite") {
      addedSuites.push(relPath);
    } else if (detectedKind === "config") {
      unregisteredConfigs.push(relPath);
      if (!allowTestConfigMutation) {
        violations.push(`Unregistered test configuration added: ${relPath}`);
      }
    } else {
      unregisteredAssets.push(relPath);
    }
  }

  // 3. 汇总基线重跑还原集：包括被修改或删除的测试套件、夹具与 helper
  const pathsToRestore = Array.from(
    new Set([
      ...modifiedSuites,
      ...deletedSuites,
      ...modifiedFixtures,
      ...modifiedHelpers,
      ...deletedFixturesOrHelpers,
    ]),
  ).sort();

  const passed = violations.length === 0;

  return {
    passed,
    modifiedConfigs,
    modifiedFixtures,
    modifiedHelpers,
    modifiedSuites,
    deletedSuites,
    deletedFixturesOrHelpers,
    addedSuites,
    unregisteredAssets,
    unregisteredConfigs,
    pathsToRestore,
    violations,
  };
}
