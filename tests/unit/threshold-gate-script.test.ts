import { describe, expect, it } from "vitest";
import {
  evaluateGate,
  extractCardIds,
  isPerfTestFile,
  scanDiff,
} from "../../scripts/perf-threshold-gate";

const PRE_MERGE_DIFF = [
  "diff --git a/tests/unit/pre-merge-fingerprint-fallback.test.ts b/tests/unit/pre-merge-fingerprint-fallback.test.ts",
  "index 1111111..2222222 100644",
  "--- a/tests/unit/pre-merge-fingerprint-fallback.test.ts",
  "+++ b/tests/unit/pre-merge-fingerprint-fallback.test.ts",
  "@@ -137 +137 @@ describe",
  "-    expect(medDuration).toBeLessThanOrEqual(50);",
  "+    expect(medDuration).toBeLessThanOrEqual(80);",
  "",
].join("\n");

const DOC_AND_OTHER_DIFF = [
  "diff --git a/docs/specs/development-tasks-changelog.md b/docs/specs/development-tasks-changelog.md",
  "--- a/docs/specs/development-tasks-changelog.md",
  "+++ b/docs/specs/development-tasks-changelog.md",
  "@@ -1,0 +1 @@",
  "+> 177. 立卡 TASK-CI.2 性能门禁抗抖动",
  "diff --git a/tests/unit/foo.test.ts b/tests/unit/foo.test.ts",
  "--- a/tests/unit/foo.test.ts",
  "+++ b/tests/unit/foo.test.ts",
  "@@ -1,2 +1,2 @@",
  "--- old comment",
  "+-- new comment",
  "-    expect(x).toBeLessThan(10);",
  "+    expect(x).toBeLessThan(10);",
  "",
].join("\n");

const KNOWN = new Set(["TASK-CI.1", "TASK-CI.2"]);

describe("perf-threshold gate: 文件分类", () => {
  it("识别 perf 测试与两条已知性能断言文件", () => {
    expect(isPerfTestFile("tests/perf/arch-graph-benchmark.test.ts")).toBe(
      true,
    );
    expect(isPerfTestFile("tests/components/RadarGraph.perf.test.tsx")).toBe(
      true,
    );
    expect(isPerfTestFile("tests/unit/frontend-perf-guards.test.ts")).toBe(
      true,
    );
    expect(isPerfTestFile("tests/unit/arch-graph-cache.test.ts")).toBe(true);
    expect(
      isPerfTestFile("tests/unit/pre-merge-fingerprint-fallback.test.ts"),
    ).toBe(true);
  });

  it("普通测试、产品代码与 docs 不算 perf 测试文件", () => {
    expect(isPerfTestFile("tests/ui/scheme-review-playtest.test.tsx")).toBe(
      false,
    );
    expect(isPerfTestFile("src/lib/perf-guards.ts")).toBe(false);
    expect(isPerfTestFile("docs/specs/perf.md")).toBe(false);
  });
});

describe("perf-threshold gate: diff 扫描", () => {
  it("改数字的阈值行同时记录被删与新增两侧", () => {
    const scan = scanDiff(PRE_MERGE_DIFF);
    expect(scan.touches).toEqual([
      {
        file: "tests/unit/pre-merge-fingerprint-fallback.test.ts",
        side: "-",
        line: "expect(medDuration).toBeLessThanOrEqual(50);",
      },
      {
        file: "tests/unit/pre-merge-fingerprint-fallback.test.ts",
        side: "+",
        line: "expect(medDuration).toBeLessThanOrEqual(80);",
      },
    ]);
  });

  it("被删的 `-- x` 内容行不会被当成文件头吞掉；非 perf 文件不触发；docs 新增行被收集", () => {
    const scan = scanDiff(DOC_AND_OTHER_DIFF);
    // 只有 tests/unit/foo.test.ts 不是 perf 文件，不应产生 touch
    expect(scan.touches).toEqual([]);
    expect(scan.addedDocLines).toEqual([
      "> 177. 立卡 TASK-CI.2 性能门禁抗抖动",
    ]);
  });

  it("perf 文件里的被删注释行与阈值行一样被计入", () => {
    const diff = [
      "diff --git a/tests/perf/x.test.ts b/tests/perf/x.test.ts",
      "--- a/tests/perf/x.test.ts",
      "+++ b/tests/perf/x.test.ts",
      "@@ -1,2 +1,1 @@",
      "--- old comment",
      "-    expect(t).toBeLessThanOrEqual(20);",
      "",
    ].join("\n");
    const scan = scanDiff(diff);
    expect(scan.touches).toEqual([
      {
        file: "tests/perf/x.test.ts",
        side: "-",
        line: "expect(t).toBeLessThanOrEqual(20);",
      },
    ]);
  });
});

describe("perf-threshold gate: 判定", () => {
  const touches = scanDiff(PRE_MERGE_DIFF).touches;

  it("未触及阈值行：放行", () => {
    const v = evaluateGate({
      touches: [],
      prBody: "",
      addedDocLines: [],
      knownCards: KNOWN,
    });
    expect(v.ok).toBe(true);
  });

  it("触及阈值行但无任何卡号引用：失败", () => {
    const v = evaluateGate({
      touches,
      prBody: "调一下阈值",
      addedDocLines: [],
      knownCards: KNOWN,
    });
    expect(v.ok).toBe(false);
    expect(v.message).toContain("没有引用任务卡号");
  });

  it("PR 描述引用真实存在的卡号：放行", () => {
    const v = evaluateGate({
      touches,
      prBody: "依据见 TASK-CI.1",
      addedDocLines: [],
      knownCards: KNOWN,
    });
    expect(v.ok).toBe(true);
  });

  it("docs 新增行引用真实存在的卡号也算：放行", () => {
    const v = evaluateGate({
      touches,
      prBody: "",
      addedDocLines: ["> 177. 立卡 TASK-CI.2"],
      knownCards: KNOWN,
    });
    expect(v.ok).toBe(true);
  });

  it("引用的卡号不存在：失败（防止编造卡号蒙混）", () => {
    const v = evaluateGate({
      touches,
      prBody: "依据 TASK-ZZ.9",
      addedDocLines: [],
      knownCards: KNOWN,
    });
    expect(v.ok).toBe(false);
    expect(v.message).toContain("均不存在");
  });

  it("卡号按整体匹配：TASK-CI.1 不会被 TASK-CI.10 误判为存在", () => {
    expect(extractCardIds("见 TASK-CI.10")).toEqual(["TASK-CI.10"]);
    const v = evaluateGate({
      touches,
      prBody: "见 TASK-CI.10",
      addedDocLines: [],
      knownCards: KNOWN,
    });
    expect(v.ok).toBe(false);
  });
});
