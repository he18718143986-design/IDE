/**
 * TASK-P0.3b-1: 容器文件系统 Scope 挂载规格生成纯函数、合法性校验与宿主占位单测。
 *
 * 覆盖验收项（DoD P03B1-P1 ～ P03B1-P5）：
 * - P03B1-P1: 纯函数 resolveScopedMounts 准确计算 Worktree 根只读（:ro）与授权路径读写（:rw）
 * - P03B1-P2: /work/.git tmpfs 隔离遮蔽
 * - P03B1-P3: 宿主侧 0 字节空占位文件计算规格与 prepareHostPlaceholders 辅助逻辑
 * - P03B1-P4: 路径逃逸（..）、越界、非法字符、重复与嵌套冲突 fail-closed 抛 MOUNT_SCOPE_INVALID
 * - P03B1-P5: 纯函数无 Docker 环境全面覆盖
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SandboxRejectedError,
  resolveScopedMounts,
  prepareHostPlaceholders,
  type ScopedMountSpec,
} from "../../daemon/worker/sandbox/container-host";
import { safeRmSync } from "../helpers/tmp";

describe("TASK-P0.3b-1: 容器文件系统 Scope 挂载规格纯函数与合法性校验", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p03b1-mount-test-"));
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      safeRmSync(tmpDir);
    }
  });

  describe("P03B1-P1: resolveScopedMounts 细粒度规格生成 (scoped & readonly_enforced)", () => {
    it("正确生成 scoped 模式挂载规格：根目录 :ro + 授权路径逐项 :rw + .git 遮蔽", () => {
      const worktreeRoot = path.join(tmpDir, "worktree");
      fs.mkdirSync(worktreeRoot, { recursive: true });

      const spec = resolveScopedMounts(worktreeRoot, [
        "src/index.ts",
        "docs/readme.md",
      ]);

      expect(spec.mode).toBe("scoped");
      expect(spec.worktreeRoot).toBe(path.resolve(worktreeRoot));
      expect(spec.containerWorkRoot).toBe("/work");
      expect(spec.writablePaths).toEqual(["src/index.ts", "docs/readme.md"]);

      // 挂载项顺序：根只读 -> .git tmpfs -> 逐项 rw
      expect(spec.entries).toHaveLength(4);

      // 1. Worktree 根只读
      expect(spec.entries[0]).toEqual({
        type: "bind",
        source: path.resolve(worktreeRoot),
        target: "/work",
        readonly: true,
      });

      // 2. .git tmpfs 遮蔽
      expect(spec.entries[1]).toEqual({
        type: "tmpfs",
        target: "/work/.git",
        readonly: false,
      });

      // 3. 授权路径 1
      expect(spec.entries[2]).toEqual({
        type: "bind",
        source: path.resolve(worktreeRoot, "src/index.ts"),
        target: "/work/src/index.ts",
        readonly: false,
      });

      // 4. 授权路径 2
      expect(spec.entries[3]).toEqual({
        type: "bind",
        source: path.resolve(worktreeRoot, "docs/readme.md"),
        target: "/work/docs/readme.md",
        readonly: false,
      });

      // dockerArgs 参数序列验证
      expect(spec.dockerArgs).toEqual([
        "-v",
        `${path.resolve(worktreeRoot)}:/work:ro`,
        "--tmpfs",
        "/work/.git:rw,noexec,nosuid",
        "-v",
        `${path.resolve(worktreeRoot, "src/index.ts")}:/work/src/index.ts:rw`,
        "-v",
        `${path.resolve(worktreeRoot, "docs/readme.md")}:/work/docs/readme.md:rw`,
      ]);
    });

    it("支持自定义 containerWorkRoot（如 /workspace）", () => {
      const worktreeRoot = path.join(tmpDir, "worktree");
      fs.mkdirSync(worktreeRoot, { recursive: true });

      const spec = resolveScopedMounts(worktreeRoot, ["main.go"], {
        containerWorkRoot: "/workspace",
      });

      expect(spec.containerWorkRoot).toBe("/workspace");
      expect(spec.entries[0]!.target).toBe("/workspace");
      expect(spec.entries[1]!.target).toBe("/workspace/.git");
      expect(spec.entries[2]!.target).toBe("/workspace/main.go");
      expect(spec.dockerArgs).toContain(
        `${path.resolve(worktreeRoot)}:/workspace:ro`,
      );
      expect(spec.dockerArgs).toContain("/workspace/.git:rw,noexec,nosuid");
      expect(spec.dockerArgs).toContain(
        `${path.resolve(worktreeRoot, "main.go")}:/workspace/main.go:rw`,
      );
    });

    it("空 writablePaths 场景：生成根 :ro 与 .git 遮蔽，无 :rw 挂载项", () => {
      const worktreeRoot = path.join(tmpDir, "worktree");
      fs.mkdirSync(worktreeRoot, { recursive: true });

      const spec = resolveScopedMounts(worktreeRoot, []);

      expect(spec.mode).toBe("scoped");
      expect(spec.writablePaths).toEqual([]);
      expect(spec.placeholderPaths).toEqual([]);
      expect(spec.entries).toHaveLength(2);
      expect(spec.entries[0]!.readonly).toBe(true);
      expect(spec.entries[1]!.type).toBe("tmpfs");
      expect(spec.dockerArgs).toEqual([
        "-v",
        `${path.resolve(worktreeRoot)}:/work:ro`,
        "--tmpfs",
        "/work/.git:rw,noexec,nosuid",
      ]);
    });

    it("readonly_enforced 模式：严格仅生成根目录 :ro 挂载与 .git 遮蔽，坚决不生成任何 :rw 挂载", () => {
      const worktreeRoot = path.join(tmpDir, "worktree");
      fs.mkdirSync(worktreeRoot, { recursive: true });

      // 即使调用方传入了 writablePaths，readonly_enforced 也坚决不生成读写挂载
      const spec = resolveScopedMounts(
        worktreeRoot,
        ["src/app.ts", "package.json"],
        { mode: "readonly_enforced" },
      );

      expect(spec.mode).toBe("readonly_enforced");
      expect(spec.writablePaths).toEqual([]);
      expect(spec.placeholderPaths).toEqual([]);
      expect(spec.entries).toHaveLength(2);
      expect(
        spec.entries.some((e) => e.readonly === false && e.type === "bind"),
      ).toBe(false);
      expect(spec.dockerArgs).toEqual([
        "-v",
        `${path.resolve(worktreeRoot)}:/work:ro`,
        "--tmpfs",
        "/work/.git:rw,noexec,nosuid",
      ]);
    });
  });

  describe("P03B1-P2: .git 元数据隔离遮蔽", () => {
    it(".git tmpfs 挂载项始终位于根挂载之后、授权读写项之前", () => {
      const worktreeRoot = path.join(tmpDir, "worktree");
      fs.mkdirSync(worktreeRoot, { recursive: true });

      const spec = resolveScopedMounts(worktreeRoot, ["file.txt"]);
      expect(spec.entries[1]).toEqual({
        type: "tmpfs",
        target: "/work/.git",
        readonly: false,
      });

      // 验证 dockerArgs 参数位置
      const rootIdx = spec.dockerArgs.indexOf("-v");
      const tmpfsIdx = spec.dockerArgs.indexOf("--tmpfs");
      expect(rootIdx).toBe(0);
      expect(tmpfsIdx).toBe(2);
    });

    it("严禁将 .git 或其内部路径显式加入 writablePaths（fail-closed 抛 MOUNT_SCOPE_INVALID）", () => {
      const worktreeRoot = path.join(tmpDir, "worktree");
      fs.mkdirSync(worktreeRoot, { recursive: true });

      const targets = [
        ".git",
        ".git/config",
        "sub/.git",
        ".git/HEAD",
        ".stagent",
        ".stagent/config.json",
      ];

      for (const target of targets) {
        expect(
          () => resolveScopedMounts(worktreeRoot, [target]),
          `Target '${target}' must be rejected`,
        ).toThrowError(
          expect.objectContaining({
            name: "SandboxRejectedError",
            code: "MOUNT_SCOPE_INVALID",
          }),
        );
      }
    });
  });

  describe("P03B1-P3: 宿主侧 0 字节空占位文件计算与预置逻辑", () => {
    it("纯函数计算：通过 fileExists 探测函数计算需要预创建占位的路径", () => {
      const worktreeRoot = path.join(tmpDir, "worktree");

      const existingSet = new Set(["src/existing.ts"]);
      const spec = resolveScopedMounts(
        worktreeRoot,
        ["src/existing.ts", "src/new-feature.ts", "docs/new-api.md"],
        {
          fileExists: (rel) => existingSet.has(rel),
        },
      );

      expect(spec.placeholderPaths).toEqual([
        "src/new-feature.ts",
        "docs/new-api.md",
      ]);
    });

    it("prepareHostPlaceholders 在真实文件系统上预置空文件并递归创建目录", () => {
      const worktreeRoot = path.join(tmpDir, "worktree");
      fs.mkdirSync(worktreeRoot, { recursive: true });

      // 事先存在的真实文件
      const existingFile = path.join(worktreeRoot, "existing.txt");
      fs.writeFileSync(existingFile, "hello existing content", "utf-8");

      const spec = resolveScopedMounts(worktreeRoot, [
        "existing.txt",
        "nested/sub/dir/new-file.ts",
        "another-new.json",
      ]);

      const result = prepareHostPlaceholders(spec);

      // 验证返回值
      expect(result.existing).toEqual([existingFile]);
      expect(result.created).toEqual([
        path.join(worktreeRoot, "nested/sub/dir/new-file.ts"),
        path.join(worktreeRoot, "another-new.json"),
      ]);

      // 验证磁盘实际状态：新建占位文件必须为 0 字节普通文件
      const newFile1 = path.join(worktreeRoot, "nested/sub/dir/new-file.ts");
      const newFile2 = path.join(worktreeRoot, "another-new.json");

      expect(fs.existsSync(newFile1)).toBe(true);
      expect(fs.statSync(newFile1).isFile()).toBe(true);
      expect(fs.statSync(newFile1).size).toBe(0);

      expect(fs.existsSync(newFile2)).toBe(true);
      expect(fs.statSync(newFile2).isFile()).toBe(true);
      expect(fs.statSync(newFile2).size).toBe(0);

      // 验证原有已存在文件内容未被破坏
      expect(fs.readFileSync(existingFile, "utf-8")).toBe(
        "hello existing content",
      );
    });

    it("prepareHostPlaceholders 支持直接传入 { worktreeRoot, writablePaths }", () => {
      const worktreeRoot = path.join(tmpDir, "worktree");
      fs.mkdirSync(worktreeRoot, { recursive: true });

      const result = prepareHostPlaceholders({
        worktreeRoot,
        writablePaths: ["one.txt", "two.txt"],
      });

      expect(result.created).toHaveLength(2);
      expect(fs.statSync(path.join(worktreeRoot, "one.txt")).size).toBe(0);
      expect(fs.statSync(path.join(worktreeRoot, "two.txt")).size).toBe(0);
    });
  });

  describe("P03B1-P4: 挂载合法性校验与 fail-closed 拦截 (MOUNT_SCOPE_INVALID)", () => {
    let worktreeRoot: string;

    beforeEach(() => {
      worktreeRoot = path.join(tmpDir, "worktree");
      fs.mkdirSync(worktreeRoot, { recursive: true });
    });

    const assertInvalid = (
      paths: string[],
      desc: string,
      options?: Parameters<typeof resolveScopedMounts>[2],
    ) => {
      try {
        resolveScopedMounts(worktreeRoot, paths, options);
        expect.fail(`Expected MOUNT_SCOPE_INVALID for case: ${desc}`);
      } catch (err) {
        expect(err).toBeInstanceOf(SandboxRejectedError);
        expect((err as SandboxRejectedError).code).toBe("MOUNT_SCOPE_INVALID");
      }
    };

    it("路径逃逸（.. 穿越）严格拦截", () => {
      assertInvalid(["../outside.ts"], "leading .. traversal");
      assertInvalid(["src/../../escape.ts"], "middle .. traversal");
      assertInvalid(["src/.."], "trailing ..");
      assertInvalid([".."], "single ..");
    });

    it("越出 Worktree 根的绝对路径拦截", () => {
      assertInvalid(["/etc/passwd"], "absolute system file");
      assertInvalid(["/var/log/syslog"], "absolute var log");
      assertInvalid(
        [path.join(tmpDir, "outside-worktree.txt")],
        "absolute outside worktree",
      );
    });

    it("禁止将 Worktree 根目录作为可写路径挂载", () => {
      assertInvalid(["."], "dot root");
      assertInvalid(["./"], "dot slash root");
    });

    it("禁止非法字符（空字节、冒号、换行控制字符、反斜杠）", () => {
      assertInvalid(["src/foo\0bar.ts"], "null byte");
      assertInvalid(["src/host:container.ts"], "colon delimiter injection");
      assertInvalid(["src/foo\nbar.ts"], "newline character");
      assertInvalid(["src/foo\rbar.ts"], "carriage return");
      assertInvalid(["src/foo\tbar.ts"], "tab character");
      assertInvalid(["src\\foo\\bar.ts"], "backslash path");
    });

    it("重复挂载路径严格拦截（fail-closed）", () => {
      assertInvalid(["src/app.ts", "src/app.ts"], "exact duplicates");
      assertInvalid(["src/./app.ts", "src/app.ts"], "normalized duplicates");
      assertInvalid(["src//app.ts", "src/app.ts"], "duplicate slashes");
    });

    it("嵌套读写冲突严格拦截（父目录与子文件同在可写列表）", () => {
      assertInvalid(["src", "src/index.ts"], "parent dir and child file");
      assertInvalid(
        ["src/components", "src/components/button.tsx"],
        "ancestor dir and descendant",
      );
      assertInvalid(
        ["src/components/button.tsx", "src/components"],
        "descendant first then ancestor",
      );
    });

    it("入参基础合法性校验（空 worktreeRoot、非法 mode、非法 containerWorkRoot）", () => {
      try {
        resolveScopedMounts("", ["src/index.ts"]);
        expect.fail("Expected failure for empty worktreeRoot");
      } catch (err) {
        expect((err as SandboxRejectedError).code).toBe("MOUNT_SCOPE_INVALID");
      }

      try {
        resolveScopedMounts(worktreeRoot, ["src/index.ts"], {
          mode: "invalid_mode" as unknown as "scoped",
        });
        expect.fail("Expected failure for invalid mode");
      } catch (err) {
        expect((err as SandboxRejectedError).code).toBe("MOUNT_SCOPE_INVALID");
      }

      try {
        resolveScopedMounts(worktreeRoot, ["src/index.ts"], {
          containerWorkRoot: "relative/path",
        });
        expect.fail("Expected failure for relative containerWorkRoot");
      } catch (err) {
        expect((err as SandboxRejectedError).code).toBe("MOUNT_SCOPE_INVALID");
      }

      try {
        resolveScopedMounts(worktreeRoot, ["src/index.ts"], {
          containerWorkRoot: "/",
        });
        expect.fail("Expected failure for root containerWorkRoot");
      } catch (err) {
        expect((err as SandboxRejectedError).code).toBe("MOUNT_SCOPE_INVALID");
      }

      try {
        resolveScopedMounts(worktreeRoot, null as unknown as readonly string[]);
        expect.fail("Expected failure for non-array writablePaths");
      } catch (err) {
        expect((err as SandboxRejectedError).code).toBe("MOUNT_SCOPE_INVALID");
      }
    });
  });

  describe("P03B1-P5: 纯函数无需 Docker 环境全面执行验证", () => {
    it("整个测试套件在纯内存/本地临时文件下极速完成，无任何真实 Docker 依赖", () => {
      const spec = resolveScopedMounts(
        "/fake/host/worktree",
        ["pkg/mod.go", "pkg/util.go"],
        {
          fileExists: () => false,
        },
      );

      expect(spec.placeholderPaths).toEqual(["pkg/mod.go", "pkg/util.go"]);
      expect(spec.dockerArgs).toHaveLength(8);
    });
  });
});
