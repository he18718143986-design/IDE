import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isSandboxWitnessValid,
  sandboxWitness,
  SandboxWitnessValidationError,
  verifySandboxWitness,
  type ContainerHostPort,
  type SandboxRunInput,
  type SandboxRunOutcome,
  type SandboxWitness,
} from "../../daemon/worker/sandbox/container-host";
import { resolveEvidenceControlMode } from "../../daemon/worker/worker-adapter.interface";

describe("TASK-P0.3a: container-witness-verify 单元测试 (P03A-P4)", () => {
  const validWitness: SandboxWitness = {
    host_kind: "docker/29.6.1",
    via: "exit",
    exit_code: 0,
    duration_ms: 125,
    worktree_root: "/path/to/worktree",
  };

  it("合法有效见证：校验通过返回原见证对象", () => {
    const res = verifySandboxWitness(validWitness, "/path/to/worktree");
    expect(res).toBe(validWitness);
    expect(isSandboxWitnessValid(validWitness, "/path/to/worktree")).toBe(true);
  });

  it("exit_code 只记录不断言：非零退出码或 null 退出码依然有效", () => {
    // Worker 业务执行失败由 verdict 阻断，不否定见证真实性
    for (const code of [1, 2, 137, null, -1]) {
      const w: SandboxWitness = {
        ...validWitness,
        exit_code: code,
      };
      expect(() => verifySandboxWitness(w, "/path/to/worktree")).not.toThrow();
      expect(isSandboxWitnessValid(w, "/path/to/worktree")).toBe(true);
    }
  });

  it("见证缺失或非对象：抛出 WITNESS_MISSING", () => {
    for (const missing of [
      undefined,
      null,
      "invalid" as unknown as SandboxWitness,
    ]) {
      expect(() => verifySandboxWitness(missing)).toThrow(
        SandboxWitnessValidationError,
      );
      try {
        verifySandboxWitness(missing);
      } catch (e) {
        expect((e as SandboxWitnessValidationError).code).toBe(
          "WITNESS_MISSING",
        );
      }
      expect(isSandboxWitnessValid(missing)).toBe(false);
    }
  });

  it("终止方式非法（via !== 'exit'）：抛出 WITNESS_VIA_INVALID", () => {
    for (const via of [
      "timeout",
      "rejected",
      "SIGKILL",
      "cancelled",
    ] as const) {
      const badWitness: SandboxWitness = {
        ...validWitness,
        via: via as SandboxRunOutcome["via"],
      };
      expect(() => verifySandboxWitness(badWitness)).toThrow(
        SandboxWitnessValidationError,
      );
      try {
        verifySandboxWitness(badWitness);
      } catch (e) {
        expect((e as SandboxWitnessValidationError).code).toBe(
          "WITNESS_VIA_INVALID",
        );
      }
      expect(isSandboxWitnessValid(badWitness)).toBe(false);
    }
  });

  it("宿主类型非法（unknown, unavailable 或空）：抛出 WITNESS_HOST_KIND_INVALID", () => {
    for (const hostKind of [
      "unknown",
      "docker/unavailable",
      "podman/unavailable",
      "",
      "   ",
    ]) {
      const badWitness: SandboxWitness = {
        ...validWitness,
        host_kind: hostKind,
      };
      expect(() => verifySandboxWitness(badWitness)).toThrow(
        SandboxWitnessValidationError,
      );
      try {
        verifySandboxWitness(badWitness);
      } catch (e) {
        expect((e as SandboxWitnessValidationError).code).toBe(
          "WITNESS_HOST_KIND_INVALID",
        );
      }
      expect(isSandboxWitnessValid(badWitness)).toBe(false);
    }
  });

  it("工作树路径非法或空：抛出 WITNESS_WORKTREE_INVALID", () => {
    for (const badPath of ["", "   ", undefined as unknown as string]) {
      const badWitness: SandboxWitness = {
        ...validWitness,
        worktree_root: badPath,
      };
      expect(() => verifySandboxWitness(badWitness)).toThrow(
        SandboxWitnessValidationError,
      );
      try {
        verifySandboxWitness(badWitness);
      } catch (e) {
        expect((e as SandboxWitnessValidationError).code).toBe(
          "WITNESS_WORKTREE_INVALID",
        );
      }
      expect(isSandboxWitnessValid(badWitness)).toBe(false);
    }
  });

  it("工作树路径不匹配：抛出 WITNESS_WORKTREE_MISMATCH", () => {
    expect(() =>
      verifySandboxWitness(validWitness, "/different/worktree/root"),
    ).toThrow(SandboxWitnessValidationError);
    try {
      verifySandboxWitness(validWitness, "/different/worktree/root");
    } catch (e) {
      expect((e as SandboxWitnessValidationError).code).toBe(
        "WITNESS_WORKTREE_MISMATCH",
      );
    }
    expect(
      isSandboxWitnessValid(validWitness, "/different/worktree/root"),
    ).toBe(false);
  });

  it("工作树路径规范化对比：相对路径或不同分隔符对齐时放行", () => {
    const rawPath = path.resolve("./some/worktree");
    const w: SandboxWitness = {
      ...validWitness,
      worktree_root: rawPath,
    };
    expect(verifySandboxWitness(w, rawPath)).toBe(w);
    expect(isSandboxWitnessValid(w, rawPath)).toBe(true);
  });

  it("sandboxWitness helper 正常构建见证对象", () => {
    const mockHost: ContainerHostPort = {
      kind: "docker/29.6.1",
      isAvailable: () => true,
      run: async () => ({
        exitCode: 0,
        via: "exit",
        durationMs: 42,
        stdout: "",
        stderr: "",
      }),
    };
    const input: SandboxRunInput = {
      worktreeRoot: "/test/worktree",
      argv: ["echo", "hello"],
    };
    const outcome: SandboxRunOutcome = {
      exitCode: 0,
      via: "exit",
      durationMs: 42,
      stdout: "hello\n",
      stderr: "",
    };

    const witness = sandboxWitness(mockHost, input, outcome);
    expect(witness).toEqual({
      host_kind: "docker/29.6.1",
      via: "exit",
      exit_code: 0,
      duration_ms: 42,
      worktree_root: "/test/worktree",
    });
    expect(isSandboxWitnessValid(witness, "/test/worktree")).toBe(true);
  });

  it("resolveEvidenceControlMode 校验见证合法性", () => {
    // GATEWAY_ENFORCED 不受见证影响
    expect(resolveEvidenceControlMode("GATEWAY_ENFORCED", undefined)).toBe(
      "GATEWAY_ENFORCED",
    );
    // SANDBOX_ENFORCED 无见证降为 UNCONTROLLED_EXTERNAL
    expect(resolveEvidenceControlMode("SANDBOX_ENFORCED", undefined)).toBe(
      "UNCONTROLLED_EXTERNAL",
    );
    // SANDBOX_ENFORCED 有合法见证保持 SANDBOX_ENFORCED
    expect(resolveEvidenceControlMode("SANDBOX_ENFORCED", validWitness)).toBe(
      "SANDBOX_ENFORCED",
    );
    // SANDBOX_ENFORCED 有非法见证（如 via=timeout）降为 UNCONTROLLED_EXTERNAL
    expect(
      resolveEvidenceControlMode("SANDBOX_ENFORCED", {
        ...validWitness,
        via: "timeout",
      }),
    ).toBe("UNCONTROLLED_EXTERNAL");
  });
});
