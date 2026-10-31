#!/usr/bin/env node
/**
 * TASK-H.7：主链路回归入口（本地可重复；CI 可挂）。
 * exit 0 = 绿；非 0 = 回归失败。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MAINLINE_NODES = [
  "open",
  "baseline_dirty",
  "draft_demo",
  "sign",
  "execute",
  "verify",
  "merged",
  "dispute_gray",
  "rework_limit",
  "porcelain_trim",
];

const REGRESSION_FINGERPRINT = [
  "tests/daemon/porcelain-leading-space.test.ts",
  "tests/unit/task-h1-worker-parse-retry.test.ts",
  "tests/unit/task-h2-terminal-state-closure.test.ts",
  "tests/unit/task-h3-scan-hard-cap.test.ts",
  "tests/unit/task-h4-empty-dir-git-init.test.ts",
  "tests/unit/task-c15b-rework-live-path.test.ts",
  "tests/unit/dispute-gray.test.ts",
  "tests/unit/task-h7-mainline-regression.test.ts",
  "tests/e2e/golden-slice.test.ts",
];

const missing = REGRESSION_FINGERPRINT.filter(
  (rel) => !fs.existsSync(path.join(root, rel)),
);
if (missing.length) {
  console.error(
    "[mainline-regression] fingerprint missing:",
    missing.join(", "),
  );
  process.exit(2);
}

console.log("[mainline-regression] nodes:", MAINLINE_NODES.join(" → "));
const r = spawnSync(
  "npx",
  [
    "vitest",
    "run",
    "tests/unit/task-h7-mainline-regression.test.ts",
    "tests/daemon/porcelain-leading-space.test.ts",
    "tests/unit/task-h5-draft-contract-id.test.ts",
    "tests/unit/task-h6-dirty-guidance.test.ts",
    "tests/unit/task-h8-records-export-cleanup.test.ts",
    "tests/e2e/golden-slice.test.ts",
  ],
  { cwd: root, stdio: "inherit" },
);
if (r.status !== 0) process.exit(r.status ?? 1);
console.log("[mainline-regression] PASS");
