/**
 * 意图编译器重启后状态恢复集成测试（TASK-J.21 / J21-P1）。
 *
 * 验收目标：
 *  - 模拟进程重启（新 host 实例仅从磁盘加载）；
 *  - 台账中已引用的证据 turn（用户轮次、AI 轮次）跨重启均可从磁盘解析；
 *  - A-01 审计通过，后续新批次正常提交并成功 CAS，不以 E_STATE_CORRUPT 拒绝；
 *  - seq 与 userAliasSeq 序号跨重启单调递增连续。
 */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createIntentCompilerHost,
  type IntentCompilerHost,
} from "../../daemon/supervisor/intent-compiler/host";
import type { IntentCompilerModelClient } from "../../daemon/supervisor/intent-compiler/compile-loop";
import {
  readSchemeLedger,
  readTranscript,
} from "../../daemon/supervisor/intent-compiler/scheme-ledger-store";
import { auditLedgerState } from "../../src/lib/journey/scheme-patch-engine";
import { safeRmSync } from "../helpers/tmp";

let repo: string | null = null;
const hosts: IntentCompilerHost[] = [];

afterEach(() => {
  for (const h of hosts.splice(0)) h.dispose();
  if (repo) safeRmSync(repo);
  repo = null;
});

function newRepo(): string {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-restart-recovery-"));
  return repo;
}

function dynamicModel(
  getOutput: (reqEnums: { ub: readonly string[] }) => {
    quotes: Array<{ qid: string; from: string; text: string }>;
    ops: Array<Record<string, unknown>>;
  },
): IntentCompilerModelClient {
  return {
    async generate(req) {
      const generated = getOutput(req.enums);
      return {
        ok: true,
        raw: generated,
        input_tokens: 10,
        output_tokens: 20,
        model_id: "stub-restart-recovery",
      };
    },
  };
}

function makeHost(
  root: string,
  modelClient: IntentCompilerModelClient,
): IntentCompilerHost {
  const host = createIntentCompilerHost({
    repoRoot: root,
    modelClient,
    hasModelKey: () => true,
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => undefined,
  });
  hosts.push(host);
  return host;
}

describe("intent-compiler 重启后状态恢复 (TASK-J.21)", () => {
  it("J21-P1: 模拟进程冷重启后，历史证据 turn 可解析，审计通过，新批次不以 E_STATE_CORRUPT 拒绝", async () => {
    const root = newRepo();

    // ── 第一代宿主（初始会话） ──
    let currentText = "必须支持导出 Markdown 格式";
    const host1 = makeHost(
      root,
      dynamicModel((enums) => {
        const from = enums.ub[enums.ub.length - 1] ?? "U1";
        return {
          quotes: [{ qid: "q1", from, text: currentText }],
          ops: [
            {
              op: "upsert_acceptance",
              source: "user_said",
              item: { id: "new:ac", text: currentText, check: "auto" },
              evidence: [{ qid: "q1" }],
              revival: null,
            },
          ],
        };
      }),
    );

    // 提交用户轮次 T1
    host1.commitUserTurn({ text: currentText });
    await host1.flushForTest();

    // 记录 AI 回复
    host1.recordAssistantTurn("已为您规划 Markdown 导出条目");

    // 验证第一代落盘状态
    const ledger1 = readSchemeLedger(root);
    expect(ledger1).not.toBeNull();
    expect(ledger1!.state.draft.scheme_revision).toBe(1);
    expect(ledger1!.state.draft.acceptance).toHaveLength(1);
    const acc0 = ledger1!.state.draft.acceptance[0];
    expect(acc0?.text).toBe("必须支持导出 Markdown 格式");
    expect(
      (acc0?.evidence?.[0]?.ref as { turn_id: string } | undefined)?.turn_id,
    ).toBe("T1");

    const transcript1 = readTranscript(root);
    expect(transcript1).not.toBeNull();
    expect(transcript1!.seq).toBe(2); // T1 (user) + T2 (assistant)
    expect(transcript1!.user_alias_seq).toBe(1);
    expect(transcript1!.turns).toHaveLength(2);

    // 第一代宿主退出/销毁
    host1.dispose();

    // ── 第二代宿主（冷重启：仅从磁盘加载） ──
    currentText = "导出文件需包含 Frontmatter 元数据";
    const host2 = makeHost(
      root,
      dynamicModel((enums) => {
        const from = enums.ub[enums.ub.length - 1] ?? "U2";
        return {
          quotes: [{ qid: "q2", from, text: currentText }],
          ops: [
            {
              op: "upsert_acceptance",
              source: "user_said",
              item: { id: "new:ac", text: currentText, check: "auto" },
              evidence: [{ qid: "q2" }],
              revival: null,
            },
          ],
        };
      }),
    );

    // 验证冷重启后内存台账与转录已恢复
    expect(host2.getLedger().draft.scheme_revision).toBe(1);
    expect(host2.getLedger().draft.acceptance).toHaveLength(1);

    // 提交新批次（用户轮次 T3）
    const commitRes = host2.commitUserTurn({ text: currentText });
    expect(commitRes.seq).toBe(3); // 序号平滑续号
    expect(commitRes.turn_id).toBe("T3");

    // 触发编译与 merge（内含 stageAuditBase A-01 审计）
    await host2.flushForTest();

    // 验证编译循环正常应用，绝未抛出或被 E_STATE_CORRUPT 拒绝
    const stats2 = host2.getStats();
    expect(stats2.failureCount).toBe(0);
    expect(stats2.lastStatus).toBe("applied");
    expect(stats2.batchCursor).toBe("T3");

    // 验证台账成功演进到 revision 2，且新旧验收条目并存
    const ledger2 = readSchemeLedger(root);
    expect(ledger2).not.toBeNull();
    expect(ledger2!.state.draft.scheme_revision).toBe(2);
    expect(ledger2!.state.draft.acceptance).toHaveLength(2);
    expect(ledger2!.state.draft.acceptance.map((a) => a.text)).toEqual(
      expect.arrayContaining([
        "必须支持导出 Markdown 格式",
        "导出文件需包含 Frontmatter 元数据",
      ]),
    );

    // 验证直接调用底座审计函数，0 缺陷
    const transcriptView = {
      get: (id: string) => {
        const rec = readTranscript(root);
        const t = rec?.turns.find((x) => x.turn_id === id);
        if (!t) return undefined;
        return {
          turn_id: t.turn_id,
          role: t.role,
          seq: t.seq,
          text: t.text,
          text_sha256: t.text_sha256,
        };
      },
    };
    const auditIssues = auditLedgerState(ledger2!.state, transcriptView);
    expect(auditIssues).toHaveLength(0);
  });

  it("连续多次冷重启：多代 host 实例序号与转录单调递增连续", async () => {
    const root = newRepo();

    for (let i = 1; i <= 3; i++) {
      const text = `需求第 ${i} 项说明`;
      const host = makeHost(
        root,
        dynamicModel((enums) => {
          const from = enums.ub[enums.ub.length - 1] ?? `U${i}`;
          return {
            quotes: [{ qid: `q${i}`, from, text }],
            ops: [
              {
                op: "upsert_acceptance",
                source: "user_said",
                item: { id: "new:ac", text, check: "auto" },
                evidence: [{ qid: `q${i}` }],
                revival: null,
              },
            ],
          };
        }),
      );

      const res = host.commitUserTurn({ text });
      expect(res.seq).toBe(i);
      expect(res.turn_id).toBe(`T${i}`);
      await host.flushForTest();

      const stats = host.getStats();
      expect(stats.failureCount).toBe(0);
      expect(stats.lastStatus).toBe("applied");

      host.dispose();
    }

    const finalTranscript = readTranscript(root);
    expect(finalTranscript).not.toBeNull();
    expect(finalTranscript!.seq).toBe(3);
    expect(finalTranscript!.user_alias_seq).toBe(3);
    expect(finalTranscript!.turns).toHaveLength(3);

    const finalLedger = readSchemeLedger(root);
    expect(finalLedger).not.toBeNull();
    expect(finalLedger!.state.draft.scheme_revision).toBe(3);
    expect(finalLedger!.state.draft.acceptance).toHaveLength(3);
  });

  it("空仓库冷启动：无 transcript.json 时视为空基线，不报错并正常接收第一轮提交", async () => {
    const root = newRepo();
    const host = makeHost(
      root,
      dynamicModel(() => ({ quotes: [], ops: [] })),
    );

    expect(host.readPersistedTranscript()).toBeNull();
    const res = host.commitUserTurn({ text: "首条测试轮次" });
    expect(res.seq).toBe(1);
    expect(res.turn_id).toBe("T1");

    const created = readTranscript(root);
    expect(created).not.toBeNull();
    expect(created!.seq).toBe(1);
    expect(created!.turns).toHaveLength(1);
  });
});
