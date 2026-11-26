import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DockerContainerHost } from "../../daemon/worker/cli-host/docker-container-host";
import {
  type ContainerHostPort,
  type SandboxWitness,
} from "../../daemon/worker/sandbox/container-host";
import {
  assertEvidenceControlAndRevision,
  squashMerge,
} from "../../daemon/pipeline/merger";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import {
  evidenceBundleSchema,
  type EvidenceBundle,
} from "../../src/lib/evidence.schema";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function safeRmSync(targetPath: string): void {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

describe("TASK-P0.3b-2: Container Scope Fail-Closed 负向集成测试", () => {
  let repo: string;
  let worktree: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "p03b2-test-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "test@example.com"]);
    git(repo, ["config", "user.name", "TestRunner"]);

    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, "src", "allowed.ts"),
      "export const allowed = 1;\n",
    );
    fs.writeFileSync(
      path.join(repo, "src", "readonly.ts"),
      "export const readonlyFile = 2;\n",
    );
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);

    worktree = repo;
  });

  afterEach(() => {
    safeRmSync(repo);
  });

  it("宿主 Docker 未运行时（当前 CI/沙箱环境），DockerContainerHost 优雅 fail-closed 绝不降级到本地", async () => {
    const realHost = new DockerContainerHost();
    const isAvail = realHost.isAvailable();

    if (!isAvail) {
      // 诚实记录：无 Docker daemon 时直接拒绝
      const outcome = await realHost.run({
        worktreeRoot: worktree,
        argv: ["echo", "uncontrolled"],
        mountMode: "scoped",
        scope: { writable_paths: ["src/allowed.ts"] },
      });

      expect(outcome.via).toBe("rejected");
      expect(outcome.exitCode).toBeNull();
      expect(outcome.rejection).toBe("HOST_UNAVAILABLE");
    } else {
      expect(isAvail).toBe(true);
    }
  });

  // 真实 Docker 负向集成测试：仅在宿主具备可用 Docker daemon 且已拉取测试镜像时执行
  // 若未预拉取测试镜像（如 CI 无镜像环境），如实跳过，避免长时间拉取巨型镜像超时
  function isDockerImageReady(image: string): boolean {
    try {
      execFileSync("docker", ["image", "inspect", image], {
        stdio: "ignore",
      });
      return true;
    } catch {
      return false;
    }
  }

  const testImage =
    process.env.STAGENT_TEST_CONTAINER_IMAGE ??
    "ghcr.io/all-hands-ai/openhands:latest";
  const liveHost = new DockerContainerHost({ image: testImage });
  const isLiveReady =
    liveHost.isAvailable() &&
    (process.env.STAGENT_LIVE_DOCKER_TEST === "1" ||
      isDockerImageReady(testImage));
  const describeLive = isLiveReady ? describe : describe.skip;

  describeLive(
    "真实 Docker 容器环境挂载作用域隔离验证（需 Docker daemon）",
    () => {
      it("Scope 外文件写入被内核只读文件系统拦截 (EACCES / Read-only file system)", async () => {
        const outcome = await liveHost.run({
          worktreeRoot: worktree,
          argv: ["sh", "-c", "echo 'corrupted' >> /work/src/readonly.ts"],
          mountMode: "scoped",
          scope: {
            writable_paths: ["src/allowed.ts"],
          },
        });

        // 容器内向 scope 外写入必定失败（exitCode != 0，且 stderr 报告 Read-only file system）
        expect(outcome.exitCode).not.toBe(0);
        expect(outcome.stderr).toMatch(
          /Read-only file system|Permission denied/i,
        );
        expect(outcome.mountMode).toBe("scoped");
      });

      it("Scope 内授权文件可正常写入", async () => {
        const outcome = await liveHost.run({
          worktreeRoot: worktree,
          argv: [
            "sh",
            "-c",
            "echo 'export const updated = 42;' >> /work/src/allowed.ts",
          ],
          mountMode: "scoped",
          scope: {
            writable_paths: ["src/allowed.ts"],
          },
        });

        expect(outcome.exitCode).toBe(0);
        expect(outcome.via).toBe("exit");
        const content = fs.readFileSync(
          path.join(worktree, "src", "allowed.ts"),
          "utf-8",
        );
        expect(content).toContain("updated = 42");
      });

      it(".git 目录受 tmpfs 遮蔽保护，无法篡改宿主 .git 真实数据", async () => {
        const outcome = await liveHost.run({
          worktreeRoot: worktree,
          argv: ["sh", "-c", "echo 'evil' > /work/.git/hacked.txt"],
          mountMode: "scoped",
          scope: {
            writable_paths: ["src/allowed.ts"],
          },
        });

        // tmpfs 在容器内独立，且宿主 .git 不受污染
        expect(fs.existsSync(path.join(worktree, ".git", "hacked.txt"))).toBe(
          false,
        );
      });

      it("readonly_enforced 模式全卷只读，即便指定 writable_paths 也不放行写入", async () => {
        const outcome = await liveHost.run({
          worktreeRoot: worktree,
          argv: ["sh", "-c", "echo 'forbidden' >> /work/src/allowed.ts"],
          mountMode: "readonly_enforced",
          scope: {
            writable_paths: ["src/allowed.ts"],
          },
        });

        expect(outcome.exitCode).not.toBe(0);
        expect(outcome.stderr).toMatch(
          /Read-only file system|Permission denied/i,
        );
        expect(outcome.mountMode).toBe("readonly_enforced");
      });
    },
  );

  describe("双重封锁集成：Merger 验证带有 mount_mode 与 mount_count 的合法见证", () => {
    it("assertEvidenceControlAndRevision 在 SANDBOX_ENFORCED 下验证 mount_mode 与 mount_count", () => {
      const validWitness: SandboxWitness = {
        host_kind: "docker/24.0.0",
        via: "exit",
        exit_code: 0,
        duration_ms: 150,
        worktree_root: worktree,
        mount_mode: "scoped",
        mount_count: 4,
      };

      expect(() =>
        assertEvidenceControlAndRevision(
          {
            worker_control_mode: "SANDBOX_ENFORCED",
            contract_revision: 1,
            sandbox_witness: validWitness,
          },
          1,
          worktree,
        ),
      ).not.toThrow();

      const invalidWitness = {
        ...validWitness,
        mount_mode: "arbitrary" as unknown as SandboxWitness["mount_mode"],
      };

      expect(() =>
        assertEvidenceControlAndRevision(
          {
            worker_control_mode: "SANDBOX_ENFORCED",
            contract_revision: 1,
            sandbox_witness: invalidWitness,
          },
          1,
          worktree,
        ),
      ).toThrow(/WITNESS_MOUNT_MODE_INVALID/);
    });
  });
});
