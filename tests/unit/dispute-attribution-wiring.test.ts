/**
 * TASK-J.16 K-16 接线：user_dispute 归因的失败关闭与留痕（P-190）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SoftwareContract } from "../../src/lib/contract.schema";
import { recordUserDisputeAttribution } from "../../daemon/supervisor/dispute/attribution-wiring";
import type { DisputeReport } from "../../daemon/supervisor/dispute/types";
import {
  appendSurfaceLog,
  buildSurfaceLogEntries,
  surfaceLogPath,
} from "../../daemon/supervisor/dispute/surface-log";
import {
  casWriteSchemeLedger,
  emptyLedgerState,
  emptySchemeDraftV2,
  readSchemeLedger,
} from "../../daemon/supervisor/intent-compiler/scheme-ledger-store";

let repo: string;
const contract = {
  contract_id: "c1",
  authorization: { file_system_scope: {} },
} as unknown as SoftwareContract;

function report(id = "dispute_r1"): DisputeReport {
  return {
    report_id: id,
    facts: {
      challenge: "这不对",
      keywords: [],
      prompt: { matched_messages: [] },
      spec: null,
      code: {
        worktree_path: "",
        available: true,
        changed_files: [],
        diff_stat: "",
        diff_excerpt: "",
        added_code_lines: [],
        commit_sha: null,
        terminal_lines: [],
        verification_results: [],
        evidence_id: null,
        tests_modified: false,
      },
    },
  } as unknown as DisputeReport;
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "k16-wire-"));
  casWriteSchemeLedger(repo, {
    expectedPrevRevision: 0,
    next: emptyLedgerState({
      draft: emptySchemeDraftV2({ scheme_revision: 2 }),
    }),
    journal: null,
    modelId: null,
    offline: true,
  });
  appendSurfaceLog(
    repo,
    buildSurfaceLogEntries({
      confirmation_id: "conf_known1",
      plain_text_version: "v1",
      presented_at: "2026-11-12T00:00:00.000Z",
      shown: [{ item_ref: "D-1", section: "decision" }],
    }),
  );
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("K-16 接线：失败关闭", () => {
  it("未提供 confirmation_id：拒绝归因，不写盘", () => {
    const r = recordUserDisputeAttribution({
      repoRoot: repo,
      report: report(),
      contract,
      confirmationId: null,
    });
    expect(r).toEqual({
      status: "rejected",
      reason: "confirmation_id_missing",
    });
    expect(readSchemeLedger(repo)?.state.attributions).toEqual([]);
  });

  it("confirmation_id 在 surface_log 中不存在：拒绝归因，不改用其他值", () => {
    const r = recordUserDisputeAttribution({
      repoRoot: repo,
      report: report(),
      contract,
      confirmationId: "conf_other",
    });
    expect(r).toEqual({ status: "rejected", reason: "confirmation_not_found" });
    expect(readSchemeLedger(repo)?.state.attributions).toEqual([]);
  });

  it("surface_log 损坏：拒绝归因（不把残缺日志当作证据）", () => {
    fs.writeFileSync(surfaceLogPath(repo, "conf_bad1"), "not json\n");
    const r = recordUserDisputeAttribution({
      repoRoot: repo,
      report: report(),
      contract,
      confirmationId: "conf_bad1",
    });
    expect(r).toEqual({ status: "rejected", reason: "surface_log_unreadable" });
    expect(readSchemeLedger(repo)?.state.attributions).toEqual([]);
  });
});

describe("K-16 接线：退化写入（J16-P4）", () => {
  it("surface_log 目录整体不存在：写 no_surface_record 与「无呈现记录」", () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "k16-bare-"));
    try {
      casWriteSchemeLedger(bare, {
        expectedPrevRevision: 0,
        next: emptyLedgerState({
          draft: emptySchemeDraftV2({ scheme_revision: 1 }),
        }),
        journal: null,
        modelId: null,
        offline: true,
      });
      const r = recordUserDisputeAttribution({
        repoRoot: bare,
        report: report("dispute_bare"),
        contract,
        confirmationId: "conf_any1",
      });
      expect(r).toMatchObject({
        status: "recorded",
        category: "no_surface_record",
      });
      const saved = readSchemeLedger(bare)?.state.attributions[0];
      expect(saved?.category).toBe("no_surface_record");
      expect(saved?.resolution_note).toContain("无呈现记录");
      expect(saved?.trigger).toBe("user_dispute");
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });

  it("有效 id 且该确认文件存在但无呈现条目：写 no_surface_record", () => {
    fs.writeFileSync(surfaceLogPath(repo, "conf_empty1"), "");
    const r = recordUserDisputeAttribution({
      repoRoot: repo,
      report: report("dispute_empty"),
      contract,
      confirmationId: "conf_empty1",
    });
    expect(r).toMatchObject({
      status: "recorded",
      category: "no_surface_record",
    });
    expect(
      readSchemeLedger(repo)?.state.attributions[0]?.resolution_note,
    ).toContain("无呈现记录");
  });

  it("目录存在但该 id 无文件：仍失败关闭（不退化）", () => {
    const r = recordUserDisputeAttribution({
      repoRoot: repo,
      report: report("dispute_nofile"),
      contract,
      confirmationId: "conf_nofile",
    });
    expect(r).toEqual({ status: "rejected", reason: "confirmation_not_found" });
    expect(readSchemeLedger(repo)?.state.attributions).toEqual([]);
  });
});

describe("K-16 接线：正常写入", () => {
  it("已知 confirmation_id：写入 user_dispute 归因，键为报告 id", () => {
    const r = recordUserDisputeAttribution({
      repoRoot: repo,
      report: report(),
      contract,
      confirmationId: "conf_known1",
    });
    expect(r).toMatchObject({
      status: "recorded",
      attribution_id: "attr_dispute_r1",
    });
    const saved = readSchemeLedger(repo)?.state.attributions ?? [];
    expect(saved).toHaveLength(1);
    expect(saved[0]?.trigger).toBe("user_dispute");
    expect(saved[0]?.created_in_revision).toBe(2);
  });

  it("同一报告重复提交：只追加一次，第二次为 duplicate", () => {
    recordUserDisputeAttribution({
      repoRoot: repo,
      report: report(),
      contract,
      confirmationId: "conf_known1",
    });
    const again = recordUserDisputeAttribution({
      repoRoot: repo,
      report: report(),
      contract,
      confirmationId: "conf_known1",
    });
    expect(again).toEqual({
      status: "duplicate",
      attribution_id: "attr_dispute_r1",
    });
    expect(readSchemeLedger(repo)?.state.attributions).toHaveLength(1);
  });
});
