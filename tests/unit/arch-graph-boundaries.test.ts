import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildDependencyGraph,
  clearArchGraphCache,
  DependencyGraph,
} from "../../daemon/arch/graph";
import {
  loadPathAliases,
  parseFile,
  parseSource,
} from "../../daemon/arch/parser";

/**
 * JSON/CJS/MJS 边界恶魔测试与防御用例
 */
describe("TASK-B.1 依赖图边界与异常防御测试", () => {
  let root: string;
  let srcDir: string;

  beforeEach(() => {
    clearArchGraphCache();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-arch-boundary-"));
    srcDir = path.join(root, "src");
    fs.mkdirSync(srcDir, { recursive: true });
  });

  afterEach(() => {
    clearArchGraphCache();
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it(".json 文件作为叶子节点：有入边、无出边、不参与环检测", () => {
    const jsonPath = path.join(srcDir, "config.json");
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({
        database: "postgres",
        port: 5432,
        // 即使 json 内写了形如 import 的字符串，也不得作为出边
        bogusImport: 'import "./other.ts"',
      }),
      "utf-8",
    );

    const consumerPath = path.join(srcDir, "app.ts");
    fs.writeFileSync(
      consumerPath,
      `import config from "./config.json";\nexport const db = config.database;\n`,
      "utf-8",
    );

    const { graph } = buildDependencyGraph({ root });

    expect(graph.hasNode(jsonPath)).toBe(true);
    expect(graph.hasNode(consumerPath)).toBe(true);

    // 有入边：app.ts -> config.json
    expect(graph.getDependencies(consumerPath)).toContain(jsonPath);
    expect(graph.getDependents(jsonPath)).toContain(consumerPath);

    // 无出边：config.json 必须是叶子节点
    expect(graph.getDependencies(jsonPath)).toEqual([]);

    // 构成包含 .json 的闭环路径时，.json 也不得形成环
    const otherPath = path.join(srcDir, "other.ts");
    fs.writeFileSync(
      otherPath,
      `import "./app.ts";\nexport const x = 1;\n`,
      "utf-8",
    );
    // app.ts 引入 config.json 与 other.ts
    fs.writeFileSync(
      consumerPath,
      `import "./config.json";\nimport "./other.ts";\n`,
      "utf-8",
    );

    const res = buildDependencyGraph({ root });
    const cycles = res.graph.detectCycles();

    // 环只存在于 app.ts <-> other.ts 之间，不得拉入 config.json
    expect(cycles.length).toBe(1);
    const cycleNodes = cycles[0]!;
    expect(cycleNodes).toContain(consumerPath);
    expect(cycleNodes).toContain(otherPath);
    expect(cycleNodes).not.toContain(jsonPath);
  });

  it("支持 CJS require 与 MJS dynamic import 解析", () => {
    const libPath = path.join(srcDir, "lib.cjs");
    const mjsPath = path.join(srcDir, "async.mjs");
    const entryPath = path.join(srcDir, "entry.ts");

    fs.writeFileSync(
      libPath,
      `const fs = require("node:fs");\nmodule.exports = { val: 42 };\n`,
      "utf-8",
    );

    fs.writeFileSync(
      mjsPath,
      `export async function run() {\n  const mod = await import("./lib.cjs");\n  return mod;\n}\n`,
      "utf-8",
    );

    fs.writeFileSync(
      entryPath,
      `const lib = require("./lib.cjs");\nimport("./async.mjs");\n`,
      "utf-8",
    );

    const { graph } = buildDependencyGraph({ root });

    expect(graph.hasNode(libPath)).toBe(true);
    expect(graph.hasNode(mjsPath)).toBe(true);
    expect(graph.hasNode(entryPath)).toBe(true);

    const entryDeps = graph.getDependencies(entryPath);
    expect(entryDeps).toContain(libPath);
    expect(entryDeps).toContain(mjsPath);

    const mjsDeps = graph.getDependencies(mjsPath);
    expect(mjsDeps).toContain(libPath);
  });

  it("外部 node_modules 导入不被解析为图内物理节点，不炸拓扑", () => {
    const filePath = path.join(srcDir, "external.ts");
    fs.writeFileSync(
      filePath,
      `import React from "react";\nimport { useState } from "react";\nimport lodash from "lodash";\nexport const test = 1;\n`,
      "utf-8",
    );

    const { graph } = buildDependencyGraph({ root });
    expect(graph.hasNode(filePath)).toBe(true);
    // 外部包 specifier 无法解析为 src 内部真实物理文件，解析结果为空，出边不挂载
    expect(graph.getDependencies(filePath)).toEqual([]);
  });

  it("单文件畸形语法或解析失败防御：降级为空出边，不中断整图构建", () => {
    const brokenFile = path.join(srcDir, "broken.ts");
    const normalFile = path.join(srcDir, "normal.ts");

    fs.writeFileSync(
      brokenFile,
      "export const = ;; {{{ function !!@@## random syntax garbage\n",
      "utf-8",
    );

    fs.writeFileSync(normalFile, "export const ok = 100;\n", "utf-8");

    // 即使 broken.ts 语法支离破碎，仍能完成整图构建，两文件均入图，broken 出边降级为空
    const { graph } = buildDependencyGraph({ root });
    expect(graph.hasNode(brokenFile)).toBe(true);
    expect(graph.hasNode(normalFile)).toBe(true);
    expect(graph.getDependencies(brokenFile)).toEqual([]);
  });

  it("purgeDeletedModule 彻底清理出边与悬空反向边（dangling reverse edges）", () => {
    const graph = new DependencyGraph();
    const a = path.resolve(root, "src/a.ts");
    const b = path.resolve(root, "src/b.ts");
    const c = path.resolve(root, "src/c.ts");

    graph.addModule({
      filePath: a,
      imports: [
        { specifier: "./b", resolved: b, typeOnly: false, dynamic: false },
      ],
      exports: ["a"],
    });

    graph.addModule({
      filePath: b,
      imports: [
        { specifier: "./c", resolved: c, typeOnly: false, dynamic: false },
      ],
      exports: ["b"],
    });

    graph.addModule({
      filePath: c,
      imports: [],
      exports: ["c"],
    });

    expect(graph.getDependencies(a)).toEqual([b]);
    expect(graph.getDependents(b)).toEqual([a]);
    expect(graph.getDependencies(b)).toEqual([c]);
    expect(graph.getDependents(c)).toEqual([b]);

    // 彻底删除 b
    graph.purgeDeletedModule(b);

    expect(graph.hasNode(b)).toBe(false);
    // a 依赖 b 的边已被切断
    expect(graph.getDependencies(a)).toEqual([]);
    // b 自身的反向边集合已被清除
    expect(graph.getDependents(b)).toEqual([]);
    // c 不再被 b 依赖
    expect(graph.getDependents(c)).toEqual([]);
  });
});
