import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { DOM_INCLUDE, NODE_INCLUDE, PIPELINE_EXCLUDE } from "./vitest.globs";

/**
 * 测试环境策略（2026-10 修订，修复全量 34 suites "Timeout waiting for worker to respond"）
 *
 * 根因：此前 `environment: "jsdom"` 全局生效。jsdom 单文件初始化约 7s，但在 8 路并发下
 * 被放大到约 38s，全量 38 文件时 worker 握手被拖过 vitest 超时，表现为 suite **启动失败**
 * 而不是断言失败。对照实验（同一组 2 个 daemon 测试文件）：
 *   jsdom + forks   = 26.51s（environment 34.64s）
 *   jsdom + threads = 22.58s（environment 32.05s）
 *   node  + forks   =  4.98s（environment 0ms）
 *   node  + threads =  4.87s（environment 0ms）
 * 结论：瓶颈是 DOM 环境而非池类型，故拆成两个 project：
 *   - `node`：daemon / lib / integration / e2e / unit（33 文件），默认环境，8 并发
 *   - `dom` ：组件与 hook（5 文件），jsdom 环境，仅 2 并发（jsdom 并发代价极高）
 * 池保持 `forks`：daemon 测试涉及 PID 锁、端口占用与子进程，进程级隔离更可靠。
 */

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          globals: true,
          globalSetup: ["./vitest.global-setup.ts"],
          setupFiles: ["./src/tests/setup.ts"],
          include: NODE_INCLUDE,
          exclude: PIPELINE_EXCLUDE,
          pool: "forks",
          maxWorkers: 8,
          // 与 dom project 的 maxWorkers 不同，必须指定唯一 groupOrder
          sequence: { groupOrder: 0 },
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          globals: true,
          globalSetup: ["./vitest.global-setup.ts"],
          setupFiles: ["./src/tests/setup.ts"],
          include: DOM_INCLUDE,
          pool: "forks",
          // jsdom 环境代价高，限制为 2 并发可稳定在 worker 握手超时之内
          maxWorkers: 2,
          sequence: { groupOrder: 1 },
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
