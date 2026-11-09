/**
 * TASK-J.16 · 试玩自查七处缺陷修复的回归门禁（playtest-self-check §1 P-1～P-7、§7.3）。
 *
 * P-7（验收条目到命令/模块的链接）本版未实现，见 PR 说明，不在此断言。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createContractDraft } from "../../src/lib/contract.schema";
import type { SchemeDraftV2 } from "../../src/lib/journey/scheme-patch-types";
import { addedCodeLines } from "../../daemon/supervisor/dispute/added-code";
import { buildTimeoutFallbackReport } from "../../daemon/supervisor/dispute";
import {
  anchoredQuotesFromDraft,
  collectGitRangeFacts,
  extractKeywords,
  matchesKeywords,
  specFactFromSnapshot,
} from "../../daemon/supervisor/dispute/evidence-triad";
import { E_DISPUTE_TIMEOUT } from "../../daemon/supervisor/dispute/types";
import type { SchemeSnapshot } from "../../daemon/pipeline/scheme-snapshot-store";
import type { SupervisorMessage } from "../../daemon/supervisor/types";

const CONTRACT = createContractDraft({
  title: "月度报表",
  description: "首页与报表页。",
  acceptanceCriteria: ["报表页能按月份切换"],
  writablePaths: ["src/**"],
  commands: [
    {
      alias: "test",
      executable: "npm",
      args: ["test"],
      expected_exit_code: 0,
      timeout_seconds: 60,
    },
  ],
});

describe("P-4 · 新增代码行去掉注释与字符串（TM-PX-04）", () => {
  const patch = [
    "diff --git a/src/report/month.ts b/src/report/month.ts",
    "--- a/src/report/month.ts",
    "+++ b/src/report/month.ts",
    "+// 实现按月份切换",
    '+const label = "按月份切换";',
    "+const monthSwitch = 1;",
    "+/* 按月份切换",
    "+ 注释续行 */",
    "+const x = 2; // 按月份切换",
  ].join("\n");

  it("保留代码行，剔除注释与字符串里的关键词", () => {
    const lines = addedCodeLines(patch);
    expect(lines).toContain("const monthSwitch = 1;");
    expect(lines).toContain("const x = 2;");
    expect(lines.join("\n")).not.toContain("按月份切换");
    expect(matchesKeywords(lines.join("\n"), ["按月份切换"])).toBe(false);
  });
});

describe("P-6 · 词法实现复用 G-MATCH", () => {
  it("extractKeywords 剥离停用词，词素来自 lexemes", () => {
    const keywords = extractKeywords("订单页面没有满减折扣功能");
    expect(keywords).toContain("满减");
    expect(keywords).toContain("折扣");
    expect(keywords).not.toContain("没有");
  });

  it("matchesKeywords 与 G-MATCH 同一规范化：标点与空白不影响命中", () => {
    expect(matchesKeywords("满减，折扣 已上线", ["满减折扣"])).toBe(true);
  });
});

describe("P-5 · 错误码不写进 reason_code", () => {
  it("超时报告的 E_DISPUTE_TIMEOUT 只出现在 error_code", () => {
    const report = buildTimeoutFallbackReport({
      contract: CONTRACT,
      challenge: "报表页没有按月份切换",
    });
    expect(report.error_code).toBe(E_DISPUTE_TIMEOUT);
    expect(report).not.toHaveProperty("reason_code");
    expect(report.plain_summary).not.toMatch(/E_DISPUTE|ms|置信度/);
  });
});

describe("P-1 · 中栏取确认快照，不读 requirements.md（TM-PF-03）", () => {
  const snapshot = {
    snapshot_id: "snap_month_1",
    digest: "d".repeat(64),
    scheme: {
      scheme_id: "scheme_month",
      scheme_revision: 3,
      modules: ["首页看板", "月度报表"],
      acceptance: [
        { id: "AC-1", text: "首页能看到本月逾期项目数", check: "both" },
        { id: "AC-2", text: "报表页能按月份切换", check: "playtest" },
      ],
    },
  } as unknown as SchemeSnapshot;

  it("条目来自快照，版本与 digest 取自快照", () => {
    const fact = specFactFromSnapshot(
      snapshot,
      extractKeywords("报表页没有按月份切换"),
    );
    expect(fact.snapshot_id).toBe("snap_month_1");
    expect(fact.version).toBe(3);
    expect(fact.sha256).toBe("d".repeat(64));
    expect(fact.matched_entries.some((entry) => entry.includes("AC-2"))).toBe(
      true,
    );
    expect(fact.content).toContain("验收 AC-1");
  });
});

describe("P-2 · 左栏取台账 evidence 的锚定原话（TM-PF-04 / TM-PF-05）", () => {
  const text = "我想要满减折扣，最好能看到";
  const sha = createHash("sha256").update(text, "utf8").digest("hex");
  const messages = [
    { message_id: "msg_1", role: "user", text, created_at: "t" },
  ] as unknown as SupervisorMessage[];

  function draftWith(turnSha: string, rawStart: number, rawEnd: number) {
    return {
      goals: [],
      out_of_scope: [],
      modules: [],
      flows: [],
      entities: [],
      decisions: [],
      conflicts: [],
      open_questions: [],
      acceptance: [
        {
          id: "AC-1",
          text: "满减折扣",
          source: "user_said",
          user_pinned: false,
          updated_in_revision: 1,
          evidence: [
            {
              kind: "turn",
              ref: {
                turn_id: "msg_1",
                anchor: {
                  kind: "span",
                  norm_start: 0,
                  norm_end: 0,
                  raw_start: rawStart,
                  raw_end: rawEnd,
                  occurrence_index: 0,
                  occurrence_count: 1,
                  turn_text_sha256: turnSha,
                },
              },
            },
          ],
        },
      ],
    } as unknown as SchemeDraftV2;
  }

  it("高亮区间切自原话，并带 raw_start/raw_end", () => {
    const quotes = anchoredQuotesFromDraft(
      draftWith(sha, 3, 7),
      messages,
      extractKeywords("满减折扣没有"),
    );
    expect(quotes).toEqual([
      expect.objectContaining({ text: "满减折扣", raw_start: 3, raw_end: 7 }),
    ]);
  });

  it("锚点 sha 与会话原文不一致 → 丢弃（失败关闭）", () => {
    const quotes = anchoredQuotesFromDraft(
      draftWith("0".repeat(64), 3, 7),
      messages,
      extractKeywords("满减折扣没有"),
    );
    expect(quotes).toEqual([]);
  });
});

describe("P-3 · 右栏取 base..task 区间（TM-PF-01）", () => {
  it("施工已提交、worktree 干净时，仍能拿到区间内的改动", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "j16-range-"));
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
    try {
      git("init", "-q");
      git("config", "user.email", "t@example.com");
      git("config", "user.name", "t");
      fs.mkdirSync(path.join(dir, "src"));
      fs.writeFileSync(path.join(dir, "src/a.ts"), "export const a = 1;\n");
      git("add", "-A");
      git("commit", "-qm", "base");
      const base = git("rev-parse", "HEAD");
      fs.writeFileSync(path.join(dir, "src/a.ts"), "export const a = 2;\n");
      fs.writeFileSync(path.join(dir, "src/b.ts"), "export const b = 1;\n");
      git("add", "-A");
      git("commit", "-qm", "task");
      const task = git("rev-parse", "HEAD");
      expect(git("status", "--porcelain")).toBe("");

      const facts = await collectGitRangeFacts(dir, base, task);
      expect(facts?.changed_files).toEqual(["src/a.ts", "src/b.ts"]);
      expect(facts?.patch).toContain("+export const a = 2;");
      expect(facts?.diff_stat).toContain("src/a.ts");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("非 SHA 形式的端点被拒绝（防止选项注入）", async () => {
    await expect(
      collectGitRangeFacts("/tmp", "--output=/tmp/x", "HEAD"),
    ).resolves.toBeNull();
  });
});
