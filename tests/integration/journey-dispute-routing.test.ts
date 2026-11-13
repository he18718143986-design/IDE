import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { orchestrateJourney } from "../../daemon/supervisor/journey/orchestrate";
import type { DisputeReport } from "../../daemon/supervisor/dispute/types";
import { partnerMessageMayRebuildScheme } from "../../src/lib/journey/handoff-progress";
import { classifyJourneyIntent } from "../../src/lib/journey/intent-router";
import { appendSurfaceLog } from "../../daemon/supervisor/dispute/surface-log";
import type { SoftwareContract } from "../../src/lib/contract.schema";
import {
  casWriteSchemeLedger,
  emptyLedgerState,
  emptySchemeDraftV2,
} from "../../daemon/supervisor/intent-compiler/scheme-ledger-store";

describe("TASK-J.23 / J23-P2 · 冻结后「这里不对」走 DISPUTE 路由与归因校验", () => {
  it("方案冻结判定与意图分类：冻结后「这里不对」属于 DISPUTE，不应盲目 passthrough", () => {
    // 冻结态（已确认方案草案）
    const frozenDraft = { frozen: true };
    expect(partnerMessageMayRebuildScheme(frozenDraft)).toBe(false);

    // 意图分类：这里不对 / 质疑 应判为 DISPUTE
    const intentDispute = classifyJourneyIntent("这里不对");
    expect(intentDispute.kind).toBe("DISPUTE");

    const intentBug =
      classifyJourneyIntent("方案里写了这一条，是施工漏了，有问题");
    expect(intentBug.kind).toBe("DISPUTE");
  });

  it("orchestrateJourney 在 DISPUTE 路由下透传 confirmation_id：查证存在时 recorded，不存在时 rejected 失败关闭", async () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "j23-journey-dispute-"),
    );
    try {
      casWriteSchemeLedger(tmpDir, {
        expectedPrevRevision: 0,
        next: emptyLedgerState({
          draft: emptySchemeDraftV2({ scheme_revision: 2 }),
        }),
        modelId: null,
        offline: false,
      });

      const contract = {
        contract_id: "contract-test-1",
        authorization: { file_system_scope: {} },
      } as unknown as SoftwareContract;

      const validConfirmId = "confirm-uuid-valid-1234";

      // 预先写入一条合法 surface_log 记录
      appendSurfaceLog(tmpDir, [
        {
          confirmation_id: validConfirmId,
          item_ref: "item_1",
          section: "acceptance",
          presented_at: new Date().toISOString(),
          plain_text_version: "v1",
        },
      ]);

      const mockDisputeReport = {
        report_id: "rep-1",
        contract_id: contract.contract_id,
        challenge: "这里不对",
        plain_summary: "自查发现记住我勾选漏项",
        classification: "BUG_FIX",
        confidence: 0.9,
        degraded: false,
        rationale: "代码未持久化存储",
        facts: {
          challenge: "这里不对",
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

      // 1. 透传合法的 confirmation_id → 归因 recorded
      const resSuccess = await orchestrateJourney({
        message: "这里不对",
        repoRoot: tmpDir,
        contract,
        confirmationId: validConfirmId,
        runDispute: async () => mockDisputeReport,
      });

      expect(resSuccess.route).toBe("DISPUTE");
      expect(resSuccess.suggest_viewport).toBe("dispute");
      expect(resSuccess.attribution).toBeDefined();
      expect(resSuccess.attribution?.status).toBe("recorded");

      // 2. 透传不存在的 confirmation_id → 严格失败关闭 rejected，不写归因
      const resNotFound = await orchestrateJourney({
        message: "这里不对",
        repoRoot: tmpDir,
        contract,
        confirmationId: "confirm-does-not-exist",
        runDispute: async () => mockDisputeReport,
      });

      expect(resNotFound.route).toBe("DISPUTE");
      expect(resNotFound.attribution).toBeDefined();
      expect(resNotFound.attribution?.status).toBe("rejected");
      if (resNotFound.attribution?.status === "rejected") {
        expect(resNotFound.attribution.reason).toBe("confirmation_not_found");
      }

      // 3. 未透传 confirmation_id (null / undefined) → 严格失败关闭 rejected
      const resMissing = await orchestrateJourney({
        message: "这里不对",
        repoRoot: tmpDir,
        contract,
        confirmationId: null,
        runDispute: async () => mockDisputeReport,
      });

      expect(resMissing.route).toBe("DISPUTE");
      expect(resMissing.attribution).toBeDefined();
      expect(resMissing.attribution?.status).toBe("rejected");
      if (resMissing.attribution?.status === "rejected") {
        expect(resMissing.attribution.reason).toBe("confirmation_id_missing");
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
