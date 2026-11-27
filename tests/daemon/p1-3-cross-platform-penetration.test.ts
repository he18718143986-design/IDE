import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";

import { safeRmSync } from "../helpers/tmp";
import { git } from "../helpers/git";
import { DockerContainerHost } from "../../daemon/worker/cli-host/docker-container-host";
import {
  resolveScopedMounts,
  prepareHostPlaceholders,
  assertMountAllowed,
  SandboxRejectedError,
  type ScopedMountSpec,
} from "../../daemon/worker/sandbox/container-host";

/**
 * TASK-P1.3 (P13-P2, P13-P3, P13-P4):
 * P0 跨平台容器隔离渗透与静态/动态规范验收套件。
 *
 * 覆盖判据：
 * - P13-P2: Linux 原生容器环境验收标准（物理只读 EACCES / 占位预建无目录化 / .git 隔离）
 * - P13-P3: macOS 跨 VM 挂载与路径敏感度验证（VirtioFS 跨 VM 可见性 / 大小写混写防逃逸）
 * - P13-P4: Windows WSL2 路径规范化与遮蔽验证（正斜杠规范化无 EINVAL / tmpfs 遮蔽 / readonly 模式强拦截）
 * - 动态渗透场景：
 *   - TC-P0-3A: 根工作树只读写阻断
 *   - TC-P0-3B: .git 目录篡改遮蔽阻断
 *   - TC-P0-3C: 验收阶段全量只读拦截
 *
 * 注意：无 Docker 环境时，真实容器测试标记为 SKIPPED_NO_DOCKER 显式跳过，绝不静默假 pass。
 */

function isDockerImageReady(image: string): boolean {
  try {
    const out = execFileSync("docker", ["images", "-q", image], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function computeGitDirHash(repoPath: string): string {
  const headFile = path.join(repoPath, ".git", "HEAD");
  if (!fs.existsSync(headFile)) return "";
  const content = fs.readFileSync(headFile);
  return crypto.createHash("sha256").update(content).digest("hex");
}

describe("TASK-P1.3 · 跨平台容器隔离渗透与规范验收套件", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), "p1-3-cross-plat-"));
    git(worktree, ["init", "-q", "-b", "main"]);
    git(worktree, ["config", "user.email", "audit@example.com"]);
    git(worktree, ["config", "user.name", "Auditor"]);

    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(worktree, "src", "allowed.ts"),
      "export const ok = 1;\n",
    );
    fs.writeFileSync(
      path.join(worktree, "src", "readonly.ts"),
      "export const ro = 1;\n",
    );
    fs.writeFileSync(
      path.join(worktree, "package.json"),
      '{"name":"cross-plat-test"}\n',
    );

    git(worktree, ["add", "."]);
    git(worktree, ["commit", "-q", "-m", "init: cross platform base"]);
  });

  afterEach(() => {
    safeRmSync(worktree);
  });

  // =========================================================================
  // P13-P2: Linux 原生容器环境判据与验收规范
  // =========================================================================

  describe("P13-P2: Linux 原生容器环境判据", () => {
    it("P13-P2-A: resolveScopedMounts 严格生成 root:ro 与 tmpfs:.git 隔离配置", () => {
      const spec = resolveScopedMounts(worktree, ["src/allowed.ts"]);
      expect(spec.mode).toBe("scoped");
      expect(spec.dockerArgs).toContain("-v");
      expect(spec.dockerArgs).toContain(`${worktree}:/work:ro`);
      expect(spec.dockerArgs).toContain("--tmpfs");
      expect(spec.dockerArgs).toContain("/work/.git:rw,noexec,nosuid");
      expect(spec.dockerArgs).toContain(
        `${path.resolve(worktree, "src/allowed.ts")}:/work/src/allowed.ts:rw`,
      );
    });

    it("P13-P2-B: 占位预建（prepareHostPlaceholders）预建 0 字节文件，杜绝将目标文件误建为目录引发挂载混淆", () => {
      const nonExistentFile = "src/new-feature.ts";
      const spec = resolveScopedMounts(worktree, [nonExistentFile]);
      expect(spec.placeholderPaths).toContain(nonExistentFile);

      const targetPath = path.resolve(worktree, nonExistentFile);
      expect(fs.existsSync(targetPath)).toBe(false);

      const res = prepareHostPlaceholders(spec);
      expect(res.created).toContain(targetPath);
      expect(fs.existsSync(targetPath)).toBe(true);

      const stat = fs.statSync(targetPath);
      expect(stat.isFile()).toBe(true);
      expect(stat.isDirectory()).toBe(false);
      expect(stat.size).toBe(0);
    });

    it("P13-P2-C: .git 目录防篡改与完整性哈希一致性防护", () => {
      const beforeHash = computeGitDirHash(worktree);
      expect(beforeHash).toBeTruthy();

      // 尝试将 .git 下的路径作为 writablePaths 挂载，必须被 fail-closed 拦截
      expect(() => {
        resolveScopedMounts(worktree, [".git/config"]);
      }).toThrowError(SandboxRejectedError);

      expect(() => {
        resolveScopedMounts(worktree, [".git"]);
      }).toThrowError(SandboxRejectedError);

      const afterHash = computeGitDirHash(worktree);
      expect(afterHash).toBe(beforeHash);
    });
  });

  // =========================================================================
  // P13-P3: macOS 跨 VM 挂载与路径敏感度验证
  // =========================================================================

  describe("P13-P3: macOS 跨 VM 挂载与路径敏感度验证", () => {
    it("P13-P3-A: 大小写混合路径挂载防逃逸与受保护边界约束", () => {
      // 验证大小写混合路径合法解析并严格限制在 worktree 内部
      const mixedPath = "src/MixedCaseFile.ts";
      const spec = resolveScopedMounts(worktree, [mixedPath]);
      expect(spec.writablePaths).toContain(mixedPath);

      const resolved = path.resolve(worktree, mixedPath);
      expect(resolved.startsWith(path.resolve(worktree))).toBe(true);

      // 边界检查：assertMountAllowed 校验大小写路径合法性
      expect(() => {
        assertMountAllowed(worktree, resolved);
      }).not.toThrow();

      // 路径穿越即便使用大小写混写与穿越组合也必须拦截
      expect(() => {
        resolveScopedMounts(worktree, ["Src/../Outside.ts"]);
      }).toThrowError(SandboxRejectedError);
    });

    it("P13-P3-B: 路径穿越严格防逃逸（.. 与绝对路径逃逸）", () => {
      expect(() => {
        resolveScopedMounts(worktree, ["src/../../outside.ts"]);
      }).toThrowError(SandboxRejectedError);

      expect(() => {
        resolveScopedMounts(worktree, ["../escape.ts"]);
      }).toThrowError(SandboxRejectedError);
    });
  });

  // =========================================================================
  // P13-P4: Windows WSL2 路径规范化与遮蔽验证
  // =========================================================================

  describe("P13-P4: Windows WSL2 路径规范化与遮蔽验证", () => {
    it("P13-P4-A: 挂载目标使用 POSIX 正斜杠路径杜绝 EINVAL，反斜杠非法输入拒绝", () => {
      // 正斜杠路径生成符合 POSIX 标准的容器挂载点
      const posixPath = "src/allowed.ts";
      const spec = resolveScopedMounts(worktree, [posixPath]);
      expect(spec.dockerArgs).toContain(
        `${path.resolve(worktree, "src/allowed.ts")}:/work/src/allowed.ts:rw`,
      );

      // 反斜杠输入直接被 hasForbiddenPathChars 拦截（fail-closed），防止 Windows 路径转义漏洞
      const backslashPath = "src\\forbidden.ts";
      expect(() => {
        resolveScopedMounts(worktree, [backslashPath]);
      }).toThrowError(SandboxRejectedError);
    });

    it("P13-P4-B: readonly_enforced 模式全量只读拦截，绝不包含任何 bind 卷的 :rw 挂载参数", () => {
      const spec = resolveScopedMounts(worktree, ["src/allowed.ts"], {
        mode: "readonly_enforced",
      });
      expect(spec.mode).toBe("readonly_enforced");
      expect(spec.writablePaths).toEqual([]);

      // 验证 bind 类型的条目全部为 readonly
      const bindEntries = spec.entries.filter((e) => e.type === "bind");
      expect(bindEntries.length).toBe(1);
      expect(bindEntries[0]?.readonly).toBe(true);
      expect(bindEntries[0]?.target).toBe("/work");

      // 验证除了 .git 的 tmpfs 隔离外，没有任何文件系统 bind 带有 :rw
      const bindArgs = spec.dockerArgs.filter(
        (arg) => arg.includes(":") && !arg.includes("tmpfs"),
      );
      for (const arg of bindArgs) {
        expect(arg).not.toMatch(/:rw$/);
      }
      expect(spec.dockerArgs).toContain(`${worktree}:/work:ro`);
      expect(spec.dockerArgs).toContain("/work/.git:rw,noexec,nosuid");
    });
  });

  // =========================================================================
  // 真实 Docker 容器环境动态渗透场景 (TC-P0-3A, TC-P0-3B, TC-P0-3C)
  // 无 Docker 环境时如实标记 SKIPPED_NO_DOCKER
  // =========================================================================

  const testImage =
    process.env["STAGENT_TEST_CONTAINER_IMAGE"] ??
    "ghcr.io/all-hands-ai/openhands:latest";
  const liveHost = new DockerContainerHost({ image: testImage });
  const isDockerAvailable = liveHost.isAvailable();
  const isLiveReady =
    isDockerAvailable &&
    (process.env["STAGENT_LIVE_DOCKER_TEST"] === "1" ||
      isDockerImageReady(testImage));

  describe("Docker 容器环境动态渗透实跑 (TC-P0-3A ~ TC-P0-3C)", () => {
    const testOrSkip = isLiveReady ? it : it.skip;
    const skipReason = isLiveReady
      ? ""
      : " [SKIPPED_NO_DOCKER: Docker daemon or test image unavailable in current environment]";

    testOrSkip(
      `TC-P0-3A: 根工作树只读写阻断 —— 容器内写入只读根目录文件物理返回 EACCES${skipReason}`,
      async () => {
        const outcome = await liveHost.run({
          worktreeRoot: worktree,
          argv: ["sh", "-c", "echo 'hack' >> /work/package.json"],
          timeoutMs: 30000,
          scope: { writable_paths: ["src/allowed.ts"] },
          mountMode: "scoped",
        });

        expect(outcome.exitCode).not.toBe(0);
        expect(outcome.stderr + outcome.stdout).toMatch(
          /Read-only file system|Permission denied|EACCES/i,
        );

        // 宿主文件未被污染
        const pkg = fs.readFileSync(
          path.join(worktree, "package.json"),
          "utf-8",
        );
        expect(pkg).not.toContain("hack");
      },
    );

    testOrSkip(
      `TC-P0-3B: .git 目录篡改遮蔽阻断 —— 容器内篡改 .git 被 tmpfs 隔离且宿主 .git 哈希严格一致${skipReason}`,
      async () => {
        const beforeGitHash = computeGitDirHash(worktree);

        const outcome = await liveHost.run({
          worktreeRoot: worktree,
          argv: [
            "sh",
            "-c",
            "rm -rf /work/.git && mkdir /work/.git && echo hacked > /work/.git/HEAD",
          ],
          timeoutMs: 30000,
          scope: { writable_paths: ["src/allowed.ts"] },
          mountMode: "scoped",
        });

        // 宿主 .git 应当完好无损
        const afterGitHash = computeGitDirHash(worktree);
        expect(afterGitHash).toBe(beforeGitHash);
        expect(fs.existsSync(path.join(worktree, ".git", "HEAD"))).toBe(true);
      },
    );

    testOrSkip(
      `TC-P0-3C: 验收阶段全量只读拦截 —— readonly_enforced 模式即使写授权路径依然物理只读拦截${skipReason}`,
      async () => {
        const outcome = await liveHost.run({
          worktreeRoot: worktree,
          argv: ["sh", "-c", "echo 'mutation' >> /work/src/allowed.ts"],
          timeoutMs: 30000,
          scope: { writable_paths: ["src/allowed.ts"] },
          mountMode: "readonly_enforced",
        });

        expect(outcome.exitCode).not.toBe(0);
        expect(outcome.stderr + outcome.stdout).toMatch(
          /Read-only file system|Permission denied|EACCES/i,
        );

        const content = fs.readFileSync(
          path.join(worktree, "src", "allowed.ts"),
          "utf-8",
        );
        expect(content).not.toContain("mutation");
      },
    );
  });
});
