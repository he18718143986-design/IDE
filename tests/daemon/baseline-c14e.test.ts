/**
 * TASK-C.14e：OS 级只读 + 断网沙盒反向证伪。
 * Darwin：写拒 EPERM（平台等价 EROFS）；断网 ENOTFOUND 等。
 *
 * 关于跳过：`sandbox-exec` 二进制存在 ≠ 能用。实测 macOS 26.6 上，只要
 * seatbelt 配置里出现 `deny` 子句，内核就拒绝应用（`sandbox_apply:
 * Operation not permitted`，退出码 71），子进程压根没跑起来，任何「已被
 * 拒绝」的结论都不成立。这类环境跳过「真跑一次」的用例，改用两条纯函数
 * 用例守住判定口径，另加一条「无法应用时不得声称已证明」的诚实性用例。
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  proveScanWriteDenied,
  proveScanNetworkDenied,
  proveOsSandbox,
  osSandboxFullyProven,
  detectPreferredOsSandboxMode,
  buildDarwinSeatbeltProfile,
  runProgressiveBaselineScan,
  isOsSandboxApplicable,
  isSandboxLaunchFailure,
  probeDeniedFromOutput,
  probeVerdictFromOutput,
} from "../../daemon/baseline/index";

function mkRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "c14e-"));
  execSync("git init", { cwd: root });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "c14e-fixture", version: "0.0.1" }),
  );
  fs.writeFileSync(path.join(root, "README.md"), "# c14e\n");
  execSync("git add . && git -c user.email=t@t -c user.name=t commit -m init", {
    cwd: root,
  });
  return root;
}

describe("TASK-C.14e OS sandbox", () => {
  let root = "";

  /** 沙箱能否真正应用；不能时「真跑一次」的用例跳过，而不是报假红 */
  const SANDBOX_APPLICABLE = isOsSandboxApplicable();
  const CAN_PROVE = process.platform === "darwin" ? SANDBOX_APPLICABLE : true;

  beforeEach(() => {
    root = mkRepo();
  });

  afterEach(() => {
    try {
      safeRmSync(root);
    } catch {
      // ignore
    }
  });

  it("detects sandbox-exec on Darwin", () => {
    const mode = detectPreferredOsSandboxMode();
    if (process.platform === "darwin") {
      expect(mode).toBe("sandbox-exec");
    }
  });

  it("Darwin seatbelt profile denies network and repo writes", () => {
    if (process.platform !== "darwin") return;
    const profile = buildDarwinSeatbeltProfile(root);
    expect(profile).toContain("(deny network*)");
    expect(profile).toContain(
      `(deny file-write* (subpath "${path.resolve(root)}")`,
    );
    expect(profile).toContain('(subpath "/private/tmp")');
  });

  it.skipIf(!CAN_PROVE)(
    "test_scan_fails_on_write: sandbox write to repo is denied (EPERM/EROFS)",
    () => {
      if (process.platform !== "darwin") {
        const r = proveScanWriteDenied(root);
        expect(r).toHaveProperty("denied");
        expect(r).toHaveProperty("mode");
        return;
      }
      const r = proveScanWriteDenied(root);
      expect(r.denied).toBe(true);
      expect(r.mode).toBe("sandbox-exec");
      // Darwin 平台等价：EPERM（非 Linux EROFS）
      expect(["EPERM", "EROFS", "EACCES"]).toContain(r.code);
      const probe = path.join(
        root,
        `.stagent-c14e-write-probe-${process.pid}.tmp`,
      );
      expect(fs.existsSync(probe)).toBe(false);
    },
  );

  it.skipIf(!CAN_PROVE)(
    "test_scan_fails_on_outbound_network: sandbox outbound fails",
    () => {
      if (process.platform !== "darwin") {
        const r = proveScanNetworkDenied(root);
        expect(r).toHaveProperty("denied");
        return;
      }
      const r = proveScanNetworkDenied(root);
      expect(r.denied).toBe(true);
      expect(r.mode).toBe("sandbox-exec");
      expect(r.code).not.toBe("CONNECTED");
      expect(r.code).toBeTruthy();
    },
  );

  it.skipIf(!CAN_PROVE)(
    "proveOsSandbox aggregates write+network on Darwin",
    () => {
      if (process.platform !== "darwin") return;
      const proof = proveOsSandbox(root);
      expect(proof.platform).toBe("darwin");
      expect(proof.write_denied).toBe(true);
      expect(proof.network_denied).toBe(true);
      expect(proof.mode).toBe("sandbox-exec");
      expect(osSandboxFullyProven(proof)).toBe(true);
      expect(proof.notes.some((n) => n.includes("EPERM"))).toBe(true);
    },
  );

  it.skipIf(!CAN_PROVE)(
    "progressive scan attaches os_sandbox proof to archive",
    async () => {
      const archive = await runProgressiveBaselineScan({
        repoRoot: root,
        toolVersion: "0.1.0-c14e-test",
        p0TimeoutMs: 5_000,
        deepTimeoutMs: 5_000,
      });
      expect(archive.os_sandbox).toBeTruthy();
      expect(archive.os_sandbox!.platform).toBe(process.platform);
      if (process.platform === "darwin") {
        expect(archive.os_sandbox!.write_denied).toBe(true);
        expect(archive.os_sandbox!.network_denied).toBe(true);
        expect(archive.os_sandbox!.mode).toBe("sandbox-exec");
        expect(archive.notes.some((n) => n.includes("OS 沙盒已证明"))).toBe(
          true,
        );
      }
    },
  );

  // ── 判定口径（纯函数，任何平台都跑）──────────────────────────────
  // 这组用例守的是一个真实缺陷：网络探针原先用 `code !== "CONNECTED"` 判定，
  // 沙箱应用失败时 stdout 为空、code 为 null，于是被算成「断网已证明」。

  it("沙箱应用失败（无输出）不得判定为「已拒绝」", () => {
    expect(probeDeniedFromOutput("", "CONNECTED")).toBe(false);
    expect(probeDeniedFromOutput("", "WROTE")).toBe(false);
    expect(probeDeniedFromOutput("   \n", "CONNECTED")).toBe(false);
    expect(
      isSandboxLaunchFailure(
        "sandbox-exec: sandbox_apply: Operation not permitted",
      ),
    ).toBe(true);
    expect(isSandboxLaunchFailure("")).toBe(false);
  });

  it("沙箱网络探测三态修证与 UNKNOWN 降级（P01A-P4）", () => {
    // 外部不可达 / DNS 失败 / 超时 降级为 UNKNOWN，不计入 denied
    expect(probeVerdictFromOutput("ENOTFOUND", "CONNECTED")).toBe("UNKNOWN");
    expect(probeDeniedFromOutput("ENOTFOUND", "CONNECTED")).toBe(false);

    expect(probeVerdictFromOutput("TIMEOUT", "CONNECTED")).toBe("UNKNOWN");
    expect(probeDeniedFromOutput("TIMEOUT", "CONNECTED")).toBe(false);

    expect(probeVerdictFromOutput("EAI_AGAIN", "CONNECTED")).toBe("UNKNOWN");
    expect(probeDeniedFromOutput("EAI_AGAIN", "CONNECTED")).toBe(false);

    // 交叉校验：宿主自身不可达时，任何网络错误一律降级为 UNKNOWN
    expect(
      probeVerdictFromOutput("EPERM", "CONNECTED", { hostReachable: false }),
    ).toBe("UNKNOWN");
    expect(
      probeDeniedFromOutput("EPERM", "CONNECTED", { hostReachable: false }),
    ).toBe(false);

    // 沙箱内核级明确拦截（EPERM/EACCES）判定为 DENIED，计入 denied
    expect(probeVerdictFromOutput("EPERM", "CONNECTED")).toBe("DENIED");
    expect(probeDeniedFromOutput("EPERM", "CONNECTED")).toBe(true);
    expect(probeVerdictFromOutput("EACCES", "CONNECTED")).toBe("DENIED");
    expect(probeDeniedFromOutput("EACCES", "CONNECTED")).toBe(true);

    // 成功连通判定为 ALLOWED，不计入 denied
    expect(probeVerdictFromOutput("CONNECTED", "CONNECTED")).toBe("ALLOWED");
    expect(probeDeniedFromOutput("CONNECTED", "CONNECTED")).toBe(false);

    // 文件系统写拦截：EPERM / EROFS / EACCES 判定为 DENIED
    expect(probeVerdictFromOutput("EPERM", "WROTE")).toBe("DENIED");
    expect(probeDeniedFromOutput("EPERM", "WROTE")).toBe(true);
    expect(probeVerdictFromOutput("EROFS", "WROTE")).toBe("DENIED");
    expect(probeDeniedFromOutput("EROFS", "WROTE")).toBe(true);
    expect(probeVerdictFromOutput("WROTE", "WROTE")).toBe("ALLOWED");
    expect(probeDeniedFromOutput("WROTE", "WROTE")).toBe(false);
  });

  it("沙箱无法应用时：结论为「未证明」，且归档注明原因", () => {
    if (CAN_PROVE && SANDBOX_APPLICABLE) {
      // 沙箱可用的机器上，这条诚实性断言没有触发条件
      return;
    }
    const proof = proveOsSandbox(root);
    expect(proof.write_denied).toBe(false);
    expect(proof.network_denied).toBe(false);
    expect(proof.mode).toBe("logical_fallback");
    expect(osSandboxFullyProven(proof)).toBe(false);
    expect(proof.notes.join("\n")).toContain("OS 沙箱无法应用");
  });
});
