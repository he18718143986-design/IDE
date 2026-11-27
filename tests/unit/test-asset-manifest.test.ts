import { describe, expect, it } from "vitest";
import {
  classifyTestAssetKind,
  buildTestAssetManifest,
  auditTestAssetsAgainstManifest,
  computeManifestDigest,
} from "../../src/lib/test-asset-manifest";

describe("TestAssetManifest & Classification (P014-P1 ~ P014-P4)", () => {
  describe("P014-P1: 识别机制与分类", () => {
    it("识别各类测试套件", () => {
      expect(classifyTestAssetKind("tests/unit/example.test.ts")).toBe(
        "test_suite",
      );
      expect(classifyTestAssetKind("src/components/button.spec.tsx")).toBe(
        "test_suite",
      );
      expect(classifyTestAssetKind("__tests__/foo.test.js")).toBe("test_suite");
    });

    it("识别测试与构建配置文件", () => {
      expect(classifyTestAssetKind("vitest.config.ts")).toBe("config");
      expect(classifyTestAssetKind("tsconfig.json")).toBe("config");
      expect(classifyTestAssetKind("configs/tsconfig.base.json")).toBe(
        "config",
      );
      expect(classifyTestAssetKind("playwright.config.ts")).toBe("config");
      expect(classifyTestAssetKind("jest.config.js")).toBe("config");
      expect(classifyTestAssetKind("pytest.ini")).toBe("config");
    });

    it("识别测试夹具与 Mock 文件", () => {
      expect(classifyTestAssetKind("tests/fixtures/contract.sample.json")).toBe(
        "fixture",
      );
      expect(classifyTestAssetKind("tests/mocks/agent-gateway.ts")).toBe(
        "fixture",
      );
      expect(classifyTestAssetKind("__fixtures__/payload.json")).toBe(
        "fixture",
      );
    });

    it("识别测试共享 Helper 与 Utils", () => {
      expect(classifyTestAssetKind("tests/helpers/test-runner.ts")).toBe(
        "helper",
      );
      expect(classifyTestAssetKind("tests/utils/crypto-stub.ts")).toBe(
        "helper",
      );
      expect(classifyTestAssetKind("tests/unit/support/mock-ipc.ts")).toBe(
        "helper",
      );
    });

    it("识别测试校验脚本", () => {
      expect(
        classifyTestAssetKind("scripts/verify-p0-independent-suite.ts"),
      ).toBe("script");
      expect(classifyTestAssetKind("scripts/check-docs.ts")).toBe("script");
    });

    it("非测试资产返回 null", () => {
      expect(classifyTestAssetKind("src/lib/contract.schema.ts")).toBe(null);
      expect(classifyTestAssetKind("daemon/server.ts")).toBe(null);
      expect(classifyTestAssetKind("README.md")).toBe(null);
    });
  });

  describe("P014-P2: Base Commit 绑定与不可变清单", () => {
    it("基于文件集生成强绑定不可变清单与摘要", () => {
      const baseCommit = "abc1234567890abcdef1234567890abcdef123456";
      const files = [
        { relPath: "vitest.config.ts", content: "export default {};" },
        { relPath: "tests/fixtures/data.json", content: '{"sample": 1}' },
        {
          relPath: "tests/helpers/runner.ts",
          content: "export const run = () => {};",
        },
        {
          relPath: "tests/unit/core.test.ts",
          content: "test('ok', () => {});",
        },
        { relPath: "src/index.ts", content: "console.log('ignored');" },
      ];

      const manifest = buildTestAssetManifest(baseCommit, files);
      expect(manifest.manifestVersion).toBe("1.0.0");
      expect(manifest.baseCommit).toBe(baseCommit);
      expect(Object.keys(manifest.assets)).toHaveLength(4);
      expect(manifest.assets["vitest.config.ts"]?.criticality).toBe("BLOCKING");
      expect(manifest.assets["tests/fixtures/data.json"]?.criticality).toBe(
        "BLOCKING",
      );
      expect(manifest.assets["tests/helpers/runner.ts"]?.criticality).toBe(
        "BLOCKING",
      );
      expect(manifest.assets["tests/unit/core.test.ts"]?.criticality).toBe(
        "BLOCKING",
      );

      const digest = computeManifestDigest(manifest);
      expect(digest).toBeDefined();
      expect(digest.length).toBe(64);
    });
  });

  describe("P014-P3 & P014-P4: 未登记检测、配置篡改拦截与还原集计算", () => {
    const baseCommit = "deadbeef1234567890deadbeef1234567890deadbeef";
    const baseFiles = [
      { relPath: "vitest.config.ts", content: "export default {};" },
      { relPath: "tests/fixtures/data.json", content: "fixture_original" },
      { relPath: "tests/helpers/runner.ts", content: "helper_original" },
      { relPath: "tests/unit/a.test.ts", content: "test_a_original" },
      { relPath: "tests/unit/b.test.ts", content: "test_b_original" },
    ];
    const manifest = buildTestAssetManifest(baseCommit, baseFiles);

    it("无篡改与合规增补测试用例通过审计", () => {
      const current = {
        "tests/unit/a.test.ts": "test_a_original",
        "tests/unit/c.test.ts": "test_c_new", // 新增测试套件
      };
      const res = auditTestAssetsAgainstManifest({
        manifest,
        currentFiles: current,
      });
      expect(res.passed).toBe(true);
      expect(res.addedSuites).toEqual(["tests/unit/c.test.ts"]);
      expect(res.violations).toHaveLength(0);
      expect(res.pathsToRestore).toHaveLength(0);
    });

    it("未豁免篡改测试配置文件时确定性 fail-closed", () => {
      const current = {
        "vitest.config.ts":
          "export default { test: { passWithNoTests: true } };",
      };
      const res = auditTestAssetsAgainstManifest({
        manifest,
        currentFiles: current,
        allowTestConfigMutation: false,
      });
      expect(res.passed).toBe(false);
      expect(res.modifiedConfigs).toEqual(["vitest.config.ts"]);
      expect(res.violations[0]).toContain(
        "Test configuration mutated without exemption",
      );
    });

    it("合同显式豁免时允许配置修改并记录明细", () => {
      const current = {
        "vitest.config.ts":
          "export default { test: { passWithNoTests: true } };",
      };
      const res = auditTestAssetsAgainstManifest({
        manifest,
        currentFiles: current,
        allowTestConfigMutation: true,
      });
      expect(res.passed).toBe(true);
      expect(res.modifiedConfigs).toEqual(["vitest.config.ts"]);
      expect(res.violations).toHaveLength(0);
    });

    it("未登记的配置文件新增被检测并阻断", () => {
      const current = {
        "tsconfig.test.json": "{}",
      };
      const res = auditTestAssetsAgainstManifest({
        manifest,
        currentFiles: current,
        allowTestConfigMutation: false,
      });
      expect(res.passed).toBe(false);
      expect(res.unregisteredConfigs).toEqual(["tsconfig.test.json"]);
    });

    it("测试夹具与 helper 篡改自动纳入 pathsToRestore 集合", () => {
      const current = {
        "tests/fixtures/data.json": "fixture_tampered",
        "tests/helpers/runner.ts": "helper_tampered",
        "tests/unit/a.test.ts": "test_a_weakened",
        "tests/unit/b.test.ts": null, // 删除测试套件
      };
      const res = auditTestAssetsAgainstManifest({
        manifest,
        currentFiles: current,
      });
      expect(res.modifiedFixtures).toEqual(["tests/fixtures/data.json"]);
      expect(res.modifiedHelpers).toEqual(["tests/helpers/runner.ts"]);
      expect(res.modifiedSuites).toEqual(["tests/unit/a.test.ts"]);
      expect(res.deletedSuites).toEqual(["tests/unit/b.test.ts"]);

      // 验证 pathsToRestore 完整包含被篡改的夹具、辅助库与测试用例
      expect(res.pathsToRestore).toEqual([
        "tests/fixtures/data.json",
        "tests/helpers/runner.ts",
        "tests/unit/a.test.ts",
        "tests/unit/b.test.ts",
      ]);
    });
  });
});
