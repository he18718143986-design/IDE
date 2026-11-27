import { describe, expect, it } from "vitest";
import {
  aggregateVerdict,
  computeEvidenceDigest,
  resolvePlatformCriterionStatus,
  type VerificationVerdict,
} from "../../scripts/verify-p0-independent-suite";

describe("TASK-P1.3a 裁决聚合与平台判据状态修证纯函数单测", () => {
  describe("P13a-P1: aggregateVerdict 三态聚合判定与降级", () => {
    it("零失败且零跳过（全实跑）时判定为 PASSED", () => {
      const verdict: VerificationVerdict = aggregateVerdict(0, 0);
      expect(verdict).toBe("PASSED");
    });

    it("无失败且存在跳过项（skippedNoDocker > 0）时准确降级为 PARTIAL", () => {
      expect(aggregateVerdict(0, 1)).toBe("PARTIAL");
      expect(aggregateVerdict(0, 3)).toBe("PARTIAL");
      expect(aggregateVerdict(0, 6)).toBe("PARTIAL");
    });

    it("只要存在任何执行失败（failed > 0），无论跳过数多少均判定为 FAILED 阻断", () => {
      expect(aggregateVerdict(1, 0)).toBe("FAILED");
      expect(aggregateVerdict(1, 3)).toBe("FAILED");
      expect(aggregateVerdict(5, 6)).toBe("FAILED");
    });
  });

  describe("P13a-P2: resolvePlatformCriterionStatus 跨平台判据状态映射", () => {
    it("在无真实 Docker 容器环境（dockerAvailable = false）下，容器隔离与挂载判据（P13-P2, P13-P3, P13-P4）标记为 SKIPPED_NO_DOCKER", () => {
      expect(resolvePlatformCriterionStatus("passed", false, "P13-P2")).toBe(
        "SKIPPED_NO_DOCKER",
      );
      expect(resolvePlatformCriterionStatus("passed", false, "P13-P3")).toBe(
        "SKIPPED_NO_DOCKER",
      );
      expect(resolvePlatformCriterionStatus("passed", false, "P13-P4")).toBe(
        "SKIPPED_NO_DOCKER",
      );
    });

    it("在无真实 Docker 容器环境（dockerAvailable = false）下，纯逻辑跨平台防嫁接判据（P13-P5）仍为 PASSED", () => {
      expect(resolvePlatformCriterionStatus("passed", false, "P13-P5")).toBe(
        "PASSED",
      );
    });

    it("在具备真实 Docker 环境（dockerAvailable = true）下，测试通过时判据标记为 PASSED", () => {
      expect(resolvePlatformCriterionStatus("passed", true, "P13-P2")).toBe(
        "PASSED",
      );
      expect(resolvePlatformCriterionStatus("passed", true, "P13-P3")).toBe(
        "PASSED",
      );
      expect(resolvePlatformCriterionStatus("passed", true, "P13-P4")).toBe(
        "PASSED",
      );
      expect(resolvePlatformCriterionStatus("passed", true, "P13-P5")).toBe(
        "PASSED",
      );
    });

    it("当底层断言失败时，无论 Docker 是否可用，均标记为 FAILED", () => {
      expect(resolvePlatformCriterionStatus("failed", false, "P13-P2")).toBe(
        "FAILED",
      );
      expect(resolvePlatformCriterionStatus("failed", true, "P13-P2")).toBe(
        "FAILED",
      );
      expect(resolvePlatformCriterionStatus("failed", false, "P13-P5")).toBe(
        "FAILED",
      );
      expect(resolvePlatformCriterionStatus("failed", true, "P13-P5")).toBe(
        "FAILED",
      );
    });

    it("当底层断言显式跳过时，标记为 SKIPPED_NO_DOCKER", () => {
      expect(resolvePlatformCriterionStatus("skipped", true, "P13-P5")).toBe(
        "SKIPPED_NO_DOCKER",
      );
    });
  });

  describe("P13a-P3 / P13a-P4: Evidence Digest 计算与一致性防篡改", () => {
    it("Evidence Digest 基于规范化 JSON SHA-256 计算，具备确定性", () => {
      const mockReport = {
        schema_version: "1.0.0" as const,
        task_id: "TASK-P1.3" as const,
        task_alias: "P0-INDEPENDENT-DYNAMIC-ACCEPTANCE" as const,
        fingerprint: {
          os_platform: "linux",
          os_release: "5.15.0",
          os_arch: "x64",
          node_version: "v22.0.0",
          git_commit: "abc1234",
          git_branch: "test",
          docker_available: false,
          docker_version: "NOT_AVAILABLE",
          timestamp: "2026-11-27T00:00:00.000Z",
        },
        summary: {
          total_tests: 14,
          passed: 8,
          skipped_no_docker: 6,
          failed: 0,
          verdict: "PARTIAL" as const,
        },
        scenarios: [
          {
            id: "TC-P0-1A",
            title: "合同版本过期阻断",
            gate_layer: "Merger",
            status: "PASSED" as const,
            duration_ms: 100,
            mechanism: "test",
            error_code_or_evidence: "E_EVIDENCE_REVISION_MISMATCH",
          },
        ],
        platform_criteria: [
          {
            id: "P13-P2",
            platform: "Linux",
            criterion: "挂载规范",
            status: "SKIPPED_NO_DOCKER" as const,
            details: "details",
          },
        ],
      };

      const digest1 = computeEvidenceDigest(mockReport);
      const digest2 = computeEvidenceDigest(mockReport);

      expect(digest1).toBe(digest2);
      expect(digest1).toMatch(/^[a-f0-9]{64}$/);

      // 篡改 summary verdict 导致 digest 变化
      const tamperedReport = {
        ...mockReport,
        summary: {
          ...mockReport.summary,
          verdict: "PASSED" as const,
        },
      };
      const digestTampered = computeEvidenceDigest(tamperedReport);
      expect(digestTampered).not.toBe(digest1);
    });
  });
});
