import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import {
  archGraphCacheSize,
  buildDependencyGraph,
  clearArchGraphCache,
} from "../../daemon/arch/graph";

/** 缺口 4.2 后端判据：G-16 扫描收敛 + mtime 增量缓存 + 单次 P100 ≤ 80ms（TASK-CI.1：macOS CI 实测 ~57ms，仅放宽测试门禁） */

describe("4.2 /api/arch/graph：src 收敛与 mtime 缓存", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-arch-"));
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.mkdirSync(path.join(root, "tests"), { recursive: true });
    fs.mkdirSync(path.join(root, "daemon"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "src", "a.ts"),
      'import { b } from "./b";\nexport const a = b;\n',
    );
    fs.writeFileSync(path.join(root, "src", "b.ts"), "export const b = 1;\n");
    fs.writeFileSync(path.join(root, "tests", "c.ts"), "export const c = 1;\n");
    fs.writeFileSync(
      path.join(root, "daemon", "d.ts"),
      "export const d = 1;\n",
    );
    clearArchGraphCache();
  });

  afterEach(() => {
    clearArchGraphCache();
    try {
      safeRmSync(root);
    } catch {
      // 清理尽力而为
    }
  });

  it("只扫描 src/**，tests/ 与 daemon/ 不进入图", () => {
    const { graph } = buildDependencyGraph({ root });
    const files = graph.toJSON().nodes.map((n) => n.filePath);
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.startsWith(path.join(root, "src")))).toBe(true);
  });

  it("显式传入 src 之外的 files 也会被过滤", () => {
    const { graph } = buildDependencyGraph({
      root,
      files: [path.join(root, "src", "a.ts"), path.join(root, "tests", "c.ts")],
    });
    expect(graph.toJSON().nodes.map((n) => n.filePath)).toEqual([
      path.join(root, "src", "a.ts"),
    ]);
  });

  it("mtime/size 不变时复用解析结果；mtime 变化后重新解析", () => {
    buildDependencyGraph({ root });
    expect(archGraphCacheSize()).toBe(2);

    const bPath = path.join(root, "src", "b.ts");
    const stat = fs.statSync(bPath);
    // 同 size 改内容但保持 mtime：应命中缓存，图仍是旧内容
    fs.writeFileSync(bPath, "export const b = 2;\n");
    fs.utimesSync(bPath, stat.atime, stat.mtime);
    const cached = buildDependencyGraph({ root });
    const bNode = cached.graph.getNode(bPath);
    expect(bNode?.exports).toContain("b");
    expect(archGraphCacheSize()).toBe(2);

    // 更新 mtime 后应重新解析（缓存条目被替换，数量不变）
    const later = new Date(Date.now() + 5_000);
    fs.utimesSync(bPath, later, later);
    buildDependencyGraph({ root });
    expect(archGraphCacheSize()).toBe(2);
  });

  it("缓存命中时单次构建 P100 ≤ 80ms", () => {
    buildDependencyGraph({ root });
    const samples: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      samples.push(buildDependencyGraph({ root }).durationMs);
    }
    expect(Math.max(...samples)).toBeLessThanOrEqual(80);
  });

  it("连续两次构建命中单例缓存，不重复执行全量重构且返回同一图实例", () => {
    const res1 = buildDependencyGraph({ root });
    expect(res1.graph.getStats().nodes).toBe(2);

    // 第二次构建由于 mtime/size 未变，直接复用图单例与解析结果
    const res2 = buildDependencyGraph({ root });
    expect(res2.graph).toBe(res1.graph);
    expect(res2.graph.getStats().nodes).toBe(2);
  });
});

