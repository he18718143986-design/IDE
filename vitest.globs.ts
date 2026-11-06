/** vitest 两个 project 的收录范围；scripts/check-docs.ts 用同一份判断任务卡的测试是否会被 CI 跑到。 */

export const PIPELINE_EXCLUDE = [
  "**/node_modules/**",
  "src/lib/scope.test.ts",
  "src/lib/pipeline.test.ts",
  "src/lib/git-guard.test.ts",
  "src/lib/stage3.test.ts",
  "src/lib/dual-agent.test.ts",
  "src/lib/arch-map.test.ts",
  "src/lib/mcp/gateway.test.ts",
];

export const NODE_INCLUDE = [
  "tests/daemon/**/*.{test,spec}.{ts,tsx}",
  "tests/perf/**/*.{test,spec}.{ts,tsx}",
  "tests/lib/**/*.{test,spec}.{ts,tsx}",
  "tests/integration/**/*.{test,spec}.{ts,tsx}",
  "tests/e2e/**/*.{test,spec}.{ts,tsx}",
  "tests/unit/**/*.{test,spec}.{ts,tsx}",
  "tests/eval/**/*.{test,spec}.{ts,tsx}",
  "src/lib/**/*.{test,spec}.ts",
  "src/**/*.{test,spec}.ts",
];

export const DOM_INCLUDE = [
  "tests/components/**/*.{test,spec}.tsx",
  "tests/ui/**/*.{test,spec}.tsx",
  "src/hooks/**/*.{test,spec}.tsx",
  "src/tests/**/*.{test,spec}.tsx",
];
