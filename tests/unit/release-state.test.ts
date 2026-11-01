
/**
 * TASK-L.15：Release 状态机与 R-INV-1～3 纯函数。
 */
import { describe, expect, it } from "vitest";
import {
  RELEASE_SCHEMA_VERSION,
  RELEASE_TRANSITIONS,
  ReleaseInvariantError,
  assertAtMostOneActive,
  assertAtMostOneLive,
  assertTransition,
  canTransition,
  isInFlightReleaseState,
  isReservedPort,
  isTerminalReleaseState,
  validateTargetPort,
  type ReleaseRecord,
  type ReleaseState,
} from "../../src/lib/release/release";

function rec(
  over: Partial<ReleaseRecord> & Pick<ReleaseRecord, "release_id" | "state">,
): ReleaseRecord {
  return {
    schema_version: RELEASE_SCHEMA_VERSION,
    target_id: "local",
    commit_sha: "aaaaaaaa",
    contract_ids: [],
    previous_live_release_id: null,
    steps: [],
    created_at: "2026-11-01T00:00:00.000Z",
    triggered_by: "USER",
    ...over,
  };
}

describe("TASK-L.15 release-state", () => {
  it("转移表覆盖规格路径，非法边被拒", () => {
    expect(canTransition("RELEASE_DRAFT", "BUILDING")).toBe(true);
    expect(canTransition("BUILDING", "DEPLOYING")).toBe(true);
    expect(canTransition("DEPLOYING", "CHECKING_HEALTH")).toBe(true);
    expect(canTransition("CHECKING_HEALTH", "LIVE")).toBe(true);
    expect(canTransition("CHECKING_HEALTH", "ROLLING_BACK")).toBe(true);
    expect(canTransition("CHECKING_HEALTH", "FAILED")).toBe(true);
    expect(canTransition("ROLLING_BACK", "ROLLED_BACK")).toBe(true);
    expect(canTransition("LIVE", "SUPERSEDED")).toBe(true);
    // 部署失败恢复不了时，允许去掉假 LIVE
    expect(canTransition("LIVE", "FAILED")).toBe(true);
    expect(canTransition("FAILED", "LIVE")).toBe(false);
    expect(() => assertTransition("LIVE", "FAILED")).not.toThrow();
    // 每个状态的目标都在表内
    for (const [from, tos] of Object.entries(RELEASE_TRANSITIONS) as [
      ReleaseState,
      ReleaseState[],
    ][]) {
      for (const to of tos) {
        expect(canTransition(from, to)).toBe(true);
      }
    }
  });

  it("终态与进行中集合互斥，LIVE 不算进行中（R-INV-2）", () => {
    expect(isTerminalReleaseState("FAILED")).toBe(true);
    expect(isTerminalReleaseState("ROLLED_BACK")).toBe(true);
    expect(isTerminalReleaseState("SUPERSEDED")).toBe(true);
    expect(isTerminalReleaseState("LIVE")).toBe(false);
    expect(isInFlightReleaseState("LIVE")).toBe(false);
    expect(isInFlightReleaseState("DEPLOYING")).toBe(true);
    expect(isInFlightReleaseState("RELEASE_DRAFT")).toBe(true);
  });

  it("R-INV-1：同一目标至多一个 LIVE", () => {
    expect(() =>
      assertAtMostOneLive(
        [
          rec({ release_id: "a", state: "LIVE" }),
          rec({ release_id: "b", state: "LIVE" }),
        ],
        "local",
      ),
    ).toThrow(/E_RELEASE_INV1/);
    expect(() =>
      assertAtMostOneLive(
        [
          rec({ release_id: "a", state: "LIVE" }),
          rec({ release_id: "b", state: "FAILED" }),
        ],
        "local",
      ),
    ).not.toThrow();
  });

  it("R-INV-2：同一目标至多一个进行中；LIVE 不占坑", () => {
    expect(() =>
      assertAtMostOneActive(
        [
          rec({ release_id: "a", state: "DEPLOYING" }),
          rec({ release_id: "b", state: "BUILDING" }),
        ],
        "local",
      ),
    ).toThrow(/E_RELEASE_INV2/);
    expect(() =>
      assertAtMostOneActive(
        [
          rec({ release_id: "a", state: "LIVE" }),
          rec({ release_id: "b", state: "RELEASE_DRAFT" }),
        ],
        "local",
      ),
    ).not.toThrow();
  });

  it("保留端口带被拒绝", () => {
    expect(isReservedPort(4105)).toBe(true);
    expect(isReservedPort(4200)).toBe(true);
    expect(isReservedPort(4300)).toBe(false);
    expect(() => validateTargetPort(4100)).toThrow(/E_RELEASE_RESERVED_PORT/);
    expect(() => validateTargetPort(4300)).not.toThrow();
  });
});
