import { describe, expect, it } from "vitest";
import { createContractDraft } from "../../src/lib/contract.schema";
import {
  assertReworkScopeSubset,
  buildReworkProposal,
  classifyDispute,
  finalizeClassification,
} from "../../daemon/supervisor/dispute/classification";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SchemeDraftV2 } from "../../src/lib/journey/scheme-patch-types";
import type { SupervisorMessage } from "../../daemon/supervisor/types";
import type {
  PersistedTranscriptTurn,
  TranscriptRecord,
} from "../../daemon/supervisor/intent-compiler/transcript-store";
import {
  anchoredQuotesFromDraft,
  extractKeywords,
  type CodeFactSource,
  type SessionFactSource,
  type SpecFactSource,
} from "../../daemon/supervisor/dispute/evidence-triad";
import {
  buildTimeoutFallbackReport,
  runDisputeSelfCheck,
  withDisputeWatchdog,
} from "../../daemon/supervisor/dispute";
import {
  DISPUTE_TIMEOUT_MS,
  E_DISPUTE_TIMEOUT,
  type DiffFact,
  type PromptFact as PromptFactType,
  type TriadFacts,
} from "../../daemon/supervisor/dispute/types";

/**
 * TASK-S.5 门禁：三方事实、60s 看门狗、三类分流、Scope 子集返工。
 *
 * 全部用注入事实源，不依赖真实 git / 真实会话目录：
 * 归因是纯规则，测试必须能逐条钉住"什么证据 → 什么结论 → 什么动作"。
 */

const CONTRACT = createContractDraft({
  title: "订单满减",
  description: "订单页支持满 100 减 20。",
  acceptanceCriteria: ["满 100 减 20", "优惠金额在订单页可见"],
  writablePaths: ["src/**"],
  strictlyForbiddenPaths: [".env*"],
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

function promptFact(matched: number): PromptFactType {
  const messages = Array.from({ length: matched }, (_, index) => ({
    message_id: `msg_${index}`,
    role: "user" as const,
    text: "订单页面要支持满减折扣",
    created_at: "2026-10-23T07:00:00.000Z",
  }));
  return {
    session_id: matched > 0 ? "ses_dispute_1" : null,
    source: matched > 0 ? "SESSION" : "CHALLENGE_ONLY",
    original_request: matched > 0 ? "订单页面要支持满减折扣" : null,
    confirmations: [],
    matched_messages: messages,
  };
}

function diffFact(params: {
  changed?: string[];
  tests?: Array<{ exit_code: number; passed: boolean }>;
  worktree?: boolean;
}): DiffFact {
  return {
    worktree_path: "/tmp/task-order",
    available: params.worktree !== false,
    changed_files: params.changed ?? ["src/order.ts"],
    diff_stat: "",
    diff_excerpt: "",
    commit_sha: "abc123",
    terminal_lines: [],
    verification_results: (params.tests ?? []).map((result, index) => ({
      alias: index === 0 ? "test" : `check_${index}`,
      exit_code: result.exit_code,
      passed: result.passed,
    })),
    evidence_id: "ev_1",
    tests_modified: false,
  };
}

function triad(params: {
  specEntries?: string[];
  promptMatched?: number;
  changed?: string[];
  tests?: Array<{ exit_code: number; passed: boolean }>;
  worktree?: boolean;
}): TriadFacts {
  return {
    challenge: "订单页面没有满减折扣功能",
    keywords: extractKeywords("订单页面没有满减折扣功能"),
    prompt: promptFact(params.promptMatched ?? 1),
    spec: {
      snapshot_id: "req_contract_v1_abcd",
      version: 1,
      sha256: "a".repeat(64),
      content: "# 订单满减\n\n## 验收标准\n",
      matched_entries: params.specEntries ?? [],
    },
    code: diffFact({
      ...(params.changed === undefined ? {} : { changed: params.changed }),
      ...(params.tests === undefined ? {} : { tests: params.tests }),
      ...(params.worktree === undefined ? {} : { worktree: params.worktree }),
    }),
  };
}

class FakeSessionSource implements SessionFactSource {
  constructor(private readonly fact: PromptFactType) {}
  collect(): PromptFactType {
    return this.fact;
  }
}

class FakeSpecSource implements SpecFactSource {
  constructor(private readonly facts: TriadFacts["spec"]) {}
  collect(): TriadFacts["spec"] {
    return this.facts;
  }
}

class FakeCodeSource implements CodeFactSource {
  constructor(private readonly fact: DiffFact) {}
  async collect(): Promise<DiffFact> {
    return this.fact;
  }
}

function depsFor(facts: TriadFacts) {
  return {
    sessions: new FakeSessionSource(facts.prompt),
    spec: new FakeSpecSource(facts.spec),
    code: new FakeCodeSource(facts.code),
  };
}

describe("关键词提取与命中", () => {
  it('剥离中文停用词并保留 2-gram，避免"没有/功能"把每行都命中', () => {
    const keywords = extractKeywords("订单页面没有满减折扣功能");
    expect(keywords).toContain("订单");
    expect(keywords).toContain("满减");
    expect(keywords).not.toContain("没有");
    expect(keywords).not.toContain("功能");
  });
});

describe("60 秒看门狗", () => {
  it("默认超时为 60s", () => {
    expect(DISPUTE_TIMEOUT_MS).toBe(60_000);
  });

  it("超时以 E_DISPUTE_TIMEOUT 安全中止，不挂死调用方", async () => {
    const slow = new Promise<number>((resolve) => {
      setTimeout(() => resolve(1), 50);
    });
    await expect(withDisputeWatchdog(slow, 5)).rejects.toMatchObject({
      code: E_DISPUTE_TIMEOUT,
    });
  });

  it("按时完成时正常返回", async () => {
    await expect(withDisputeWatchdog(Promise.resolve("ok"), 50)).resolves.toBe(
      "ok",
    );
  });

  it("runDisputeSelfCheck 在慢事实源下抛 E_DISPUTE_TIMEOUT", async () => {
    const slowCode: CodeFactSource = {
      collect: () =>
        new Promise<DiffFact>((resolve) => {
          setTimeout(() => resolve(diffFact({})), 50);
        }),
    };
    await expect(
      runDisputeSelfCheck(
        {
          contract: CONTRACT,
          challenge: "订单页面没有满减折扣功能",
          repoRoot: "/tmp/not-used",
          timeoutMs: 5,
        },
        {
          sessions: new FakeSessionSource(promptFact(1)),
          spec: new FakeSpecSource(triad({}).spec),
          code: slowCode,
        },
      ),
    ).rejects.toMatchObject({ code: E_DISPUTE_TIMEOUT });
  });
});

describe("三类归因分流", () => {
  it("规范有要求 + 验证失败 → 实现偏差（≥0.7），生成受限返工提案", async () => {
    const facts = triad({
      specEntries: ["- 订单金额满 100 元时自动减 20 元"],
      tests: [{ exit_code: 1, passed: false }],
    });
    const report = await runDisputeSelfCheck(
      {
        contract: CONTRACT,
        challenge: facts.challenge,
        repoRoot: "/tmp/not-used",
      },
      depsFor(facts),
    );

    expect(report.classification).toBe("IMPLEMENTATION_BUG");
    expect(report.confidence).toBeGreaterThanOrEqual(0.7);
    expect(report.degraded).toBe(false);
    expect(report.next_action.kind).toBe("REWORK");
    expect(report.next_action.rework?.target_files).toEqual(["src/order.ts"]);
    expect(report.next_action.rework?.scope_subset_valid).toBe(true);
    expect(report.next_action.rework?.requires_scope_expansion).toBe(false);
    expect(report.plain_summary).toContain("这是 Bug，免费修");
  });

  it("规范缺失 + 用户原始意图存在 → 需求遗漏，生成待审批的新合同草案", async () => {
    const facts = triad({
      specEntries: [],
      promptMatched: 1,
      tests: [{ exit_code: 0, passed: true }],
    });
    const report = await runDisputeSelfCheck(
      {
        contract: CONTRACT,
        challenge: facts.challenge,
        repoRoot: "/tmp/not-used",
      },
      depsFor(facts),
    );

    expect(report.classification).toBe("REQUIREMENT_DRIFT");
    expect(report.confidence).toBeGreaterThanOrEqual(0.7);
    expect(report.next_action.kind).toBe("REQUIREMENT_CHANGE");
    const draft = report.next_action.change_request?.draft_contract;
    expect(draft?.lifecycle_state).toBe("DRAFT");
    expect(draft?.approval.status).toBe("DRAFT");
    expect(draft?.authorization.file_system_scope.writable_paths).toEqual([
      "src/**",
    ]);
    expect(report.next_action.change_request?.change_request_id).toBe(
      report.change_request_id,
    );
    expect(report.plain_summary).toContain("我想要新功能，下一轮做");
  });

  it("三方信号不足 → UNATTRIBUTED，降级人工裁决", async () => {
    const facts = triad({
      specEntries: [],
      promptMatched: 0,
      tests: [],
    });
    const report = await runDisputeSelfCheck(
      {
        contract: CONTRACT,
        challenge: facts.challenge,
        repoRoot: "/tmp/not-used",
      },
      depsFor(facts),
    );

    expect(report.classification).toBe("UNATTRIBUTED");
    expect(report.degraded).toBe(true);
    expect(report.next_action.kind).toBe("MANUAL_ARBITRATION");
    expect(report.plain_summary).toContain("我还不能确定是哪一边的问题");
    expect(report.next_action.rework).toBeUndefined();
  });

  it("置信度门槛是硬边界：0.69 降级、0.70 保留", () => {
    expect(finalizeClassification("REQUIREMENT_DRIFT", 0.69)).toBe(
      "UNATTRIBUTED",
    );
    expect(finalizeClassification("REQUIREMENT_DRIFT", 0.7)).toBe(
      "REQUIREMENT_DRIFT",
    );
  });
});

describe("返工边界：严格限制在原合同 Scope 子集", () => {
  it("只保留已授权文件，越界候选记录但不进入目标", () => {
    const facts = triad({
      changed: ["src/order.ts", "docs/spec.md", "../evil.ts"],
      specEntries: ["- 订单金额满 100 元时自动减 20 元"],
      tests: [{ exit_code: 1, passed: false }],
    });
    const outcome = classifyDispute(facts, CONTRACT);
    expect(outcome.classification).toBe("IMPLEMENTATION_BUG");

    const reportAction = buildReworkProposal(CONTRACT, facts, "cr_test_1");
    expect(reportAction.target_files).toEqual(["src/order.ts"]);
    expect(reportAction.rejected_paths).toEqual(["docs/spec.md", "../evil.ts"]);
    expect(reportAction.requires_scope_expansion).toBe(true);
    expect(reportAction.instructions).toContain("EXPANDED_SCOPE_REQUIRED");
    expect(
      assertReworkScopeSubset(CONTRACT, reportAction.target_files),
    ).toEqual([]);
    expect(assertReworkScopeSubset(CONTRACT, ["docs/spec.md"])).toEqual([
      "docs/spec.md",
    ]);
  });

  it("全部变更都在 Scope 外时降级人工裁决，绝不生成越界返工", () => {
    const facts = triad({
      changed: ["docs/spec.md"],
      specEntries: ["- 订单金额满 100 元时自动减 20 元"],
      tests: [{ exit_code: 1, passed: false }],
    });
    const outcome = classifyDispute(facts, CONTRACT);
    expect(outcome.suggested).toBe("IMPLEMENTATION_BUG");
    expect(outcome.classification).toBe("UNATTRIBUTED");
    expect(outcome.confidence).toBeLessThan(0.7);
    expect(outcome.rationale.join(" ")).toContain("Scope 之外");
  });
});

describe("超时降级报告", () => {
  it("携带 E_DISPUTE_TIMEOUT 并保持 UNATTRIBUTED", () => {
    const report = buildTimeoutFallbackReport({
      contract: CONTRACT,
      challenge: "订单页面没有满减折扣功能",
      timeoutMs: 60_000,
    });
    expect(report.classification).toBe("UNATTRIBUTED");
    expect(report.degraded).toBe(true);
    expect(report.error_code).toBe(E_DISPUTE_TIMEOUT);
    expect(report).not.toHaveProperty("reason_code");
    expect(report.next_action.kind).toBe("MANUAL_ARBITRATION");
    expect(report.plain_summary).toContain("花的时间比预期长");
  });
});

describe("用户白话裁决 userChoice", () => {
  it("BUG_FIX 强制 IMPLEMENTATION_BUG + REWORK，不经置信度门槛", async () => {
    const facts = triad({
      changed: ["src/order.ts"],
      specEntries: [],
      promptMatched: 0,
      tests: [],
    });
    const report = await runDisputeSelfCheck(
      {
        contract: CONTRACT,
        challenge: facts.challenge,
        repoRoot: "/tmp/not-used",
        userChoice: "BUG_FIX",
      },
      depsFor(facts),
    );
    expect(report.classification).toBe("IMPLEMENTATION_BUG");
    expect(report.degraded).toBe(false);
    expect(report.next_action.kind).toBe("REWORK");
    expect(report.rationale.join(" ")).toContain("这是 Bug，免费修");
  });

  it("REQUIREMENT_CHANGE 强制 REQUIREMENT_DRIFT + 新需求提案", async () => {
    const facts = triad({
      changed: ["src/order.ts"],
      specEntries: ["- 订单金额满 100 元时自动减 20 元"],
      promptMatched: 0,
      tests: [{ exit_code: 1, passed: false }],
    });
    const report = await runDisputeSelfCheck(
      {
        contract: CONTRACT,
        challenge: facts.challenge,
        repoRoot: "/tmp/not-used",
        userChoice: "REQUIREMENT_CHANGE",
      },
      depsFor(facts),
    );
    expect(report.classification).toBe("REQUIREMENT_DRIFT");
    expect(report.degraded).toBe(false);
    expect(report.next_action.kind).toBe("REQUIREMENT_CHANGE");
    expect(report.next_action.change_request).toBeDefined();
    expect(report.rationale.join(" ")).toContain("我想要新功能，下一轮做");
  });
});

describe("J16-P5 · 左栏原话反查与哈希校验（路线 2）", () => {
  function sha256(text: string): string {
    return createHash("sha256").update(text, "utf8").digest("hex");
  }

  const sampleText = "我需要一个订单满减折扣功能支持满100减20";
  const sampleSha = sha256(sampleText);
  // "订单满减折扣" 为 sampleText.slice(5, 11)
  const quoteStart = 5;
  const quoteEnd = 11;

  function draftWithEvidence(
    turnId: string,
    turnSha: string,
    rawStart: number,
    rawEnd: number,
  ): SchemeDraftV2 {
    return {
      scheme_id: "sch_1",
      scheme_revision: 1,
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
          text: "订单满减折扣",
          source: "user_said",
          user_pinned: false,
          updated_in_revision: 1,
          evidence: [
            {
              kind: "turn",
              ref: {
                turn_id: turnId,
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

  it("T1/T2 原生键反查：按 ref.turn_id 从 transcript 成功反查原话切片并校验哈希", () => {
    const draft = draftWithEvidence("T1", sampleSha, quoteStart, quoteEnd);
    const messages: SupervisorMessage[] = [
      {
        message_id: "msg_c3b5d2e1-4f8a-4932-b7e1-8f2a3c4d5e6f",
        role: "user",
        text: "普通会话消息",
        created_at: "2026-11-13T04:00:00.000Z",
        source: "ui",
      },
    ];
    const transcriptTurns: PersistedTranscriptTurn[] = [
      {
        turn_id: "T1",
        role: "user",
        seq: 1,
        text: sampleText,
        text_sha256: sampleSha,
        turn_text_sha256: sampleSha,
      },
    ];

    const quotes = anchoredQuotesFromDraft(
      draft,
      messages,
      extractKeywords("订单满减折扣"),
      transcriptTurns,
    );

    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({
      message_id: "T1",
      role: "user",
      text: "订单满减折扣",
      raw_start: quoteStart,
      raw_end: quoteEnd,
    });
  });

  it("失败关闭：turn_text_sha256 不匹配或切片越界时拒绝伪造，返回空原话", () => {
    const transcriptTurns: PersistedTranscriptTurn[] = [
      {
        turn_id: "T1",
        role: "user",
        seq: 1,
        text: sampleText,
        text_sha256: sampleSha,
        turn_text_sha256: sampleSha,
      },
    ];

    // 1. 哈希不匹配
    const forgedShaDraft = draftWithEvidence(
      "T1",
      "0".repeat(64),
      quoteStart,
      quoteEnd,
    );
    expect(
      anchoredQuotesFromDraft(
        forgedShaDraft,
        [],
        extractKeywords("订单满减折扣"),
        transcriptTurns,
      ),
    ).toEqual([]);

    // 2. 切片越界 (raw_end 超过文本长度)
    const outOfBoundsDraft = draftWithEvidence("T1", sampleSha, 0, 9999);
    expect(
      anchoredQuotesFromDraft(
        outOfBoundsDraft,
        [],
        extractKeywords("订单满减折扣"),
        transcriptTurns,
      ),
    ).toEqual([]);

    // 3. 切片无效区间 (raw_start < 0 或 raw_start >= raw_end)
    const invalidRangeDraft = draftWithEvidence("T1", sampleSha, -1, 5);
    expect(
      anchoredQuotesFromDraft(
        invalidRangeDraft,
        [],
        extractKeywords("订单满减折扣"),
        transcriptTurns,
      ),
    ).toEqual([]);
  });

  it("降级兼容：transcript 缺失时按 message_id/turn_id 退化 session.messages（不宽松匹配）", () => {
    // 1. transcript 缺失且 message_id 严格等于 ref.turn_id -> 成功退化
    const matchedDraft = draftWithEvidence(
      "msg_legacy_100",
      sampleSha,
      quoteStart,
      quoteEnd,
    );
    const messages: SupervisorMessage[] = [
      {
        message_id: "msg_legacy_100",
        role: "user",
        text: sampleText,
        created_at: "2026-11-13T04:00:00.000Z",
        source: "ui",
      },
    ];

    const quotes = anchoredQuotesFromDraft(
      matchedDraft,
      messages,
      extractKeywords("订单满减折扣"),
      null,
    );
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({
      message_id: "msg_legacy_100",
      role: "user",
      text: "订单满减折扣",
      raw_start: quoteStart,
      raw_end: quoteEnd,
    });

    // 2. transcript 缺失但 ref.turn_id 与 session.messages 的 message_id 不匹配 -> 严格拒绝，不宽松匹配
    const unmatchedDraft = draftWithEvidence(
      "T1",
      sampleSha,
      quoteStart,
      quoteEnd,
    );
    const unmatchedQuotes = anchoredQuotesFromDraft(
      unmatchedDraft,
      messages,
      extractKeywords("订单满减折扣"),
      null,
    );
    expect(unmatchedQuotes).toEqual([]);
  });

  it("通过 repoRoot 从物理磁盘 transcript.json 读取并反查", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "j16-transcript-"));
    try {
      const ledgerDir = path.join(
        tmpDir,
        ".stagent",
        "drafts",
        "scheme-ledger",
      );
      fs.mkdirSync(ledgerDir, { recursive: true });
      const record: TranscriptRecord = {
        schema_version: "1.0",
        updated_at: "2026-11-13T04:15:00.000Z",
        seq: 1,
        user_alias_seq: 1,
        turns: [
          {
            turn_id: "T2",
            role: "user",
            seq: 1,
            text: sampleText,
            text_sha256: sampleSha,
            turn_text_sha256: sampleSha,
          },
        ],
      };
      fs.writeFileSync(
        path.join(ledgerDir, "transcript.json"),
        JSON.stringify(record),
      );

      const draft = draftWithEvidence("T2", sampleSha, quoteStart, quoteEnd);
      const quotes = anchoredQuotesFromDraft(
        draft,
        [],
        extractKeywords("订单满减折扣"),
        tmpDir,
      );
      expect(quotes).toHaveLength(1);
      expect(quotes[0]).toMatchObject({
        message_id: "T2",
        role: "user",
        text: "订单满减折扣",
        created_at: "2026-11-13T04:15:00.000Z",
        raw_start: quoteStart,
        raw_end: quoteEnd,
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
