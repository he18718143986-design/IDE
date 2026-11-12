/**
 * 方案验收条目 ID 撞号复现与解决（TASK-J.16 K-14 前置挂账⑪，TASK-J.21 挂账⑫）。
 *
 * ITEM-n 的两处生成点都不从台账恢复：
 *  - assembleCompilerOutput 的默认 newId 闭包每次调用重置为 ITEM-1（同进程内每批都从 1 开始）；
 *  - IntentCompileLoop.seqCounter 是进程内实例字段，重启归零。
 * 新批次的 new:ac 因此可能拿到与既有验收条目相同的 ID；upsert 按 id 替换 → 旧条目被覆盖。
 *
 * TASK-J.21（挂账⑫）：transcript 从磁盘持久化与恢复后，新 host 仅从磁盘加载，
 * 删掉空补丁回放的变通手段，证据 turn 跨重启可解析，不触发 E_STATE_CORRUPT。
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
import { readSchemeLedger } from "../../daemon/supervisor/intent-compiler/scheme-ledger-store";
import { safeRmSync } from "../helpers/tmp";

let repo: string | null = null;
const hosts: IntentCompilerHost[] = [];

afterEach(() => {
  for (const h of hosts.splice(0)) h.dispose();
  if (repo) safeRmSync(repo);
  repo = null;
});

/**
 * 每次模型调用返回一条 new:ac 验收条目（文本取 `state.nextText`）。
 */
function acceptanceModel(state: {
  nextText: string;
}): IntentCompilerModelClient {
  return {
    async generate(req) {
      const from = req.enums.ub[req.enums.ub.length - 1] ?? "U1";
      const text = state.nextText;
      return {
        ok: true,
        raw: {
          quotes: [{ qid: "q1", from, text }],
          ops: [
            {
              op: "upsert_acceptance",
              source: "user_said",
              item: { id: "new:ac", text, check: "auto" },
              evidence: [{ qid: "q1" }],
              revival: null,
            },
          ],
        },
        input_tokens: 1,
        output_tokens: 1,
        model_id: "stub-item-id",
      };
    },
  };
}

function makeHost(
  root: string,
  state: { nextText: string },
): IntentCompilerHost {
  const host = createIntentCompilerHost({
    repoRoot: root,
    modelClient: acceptanceModel(state),
    hasModelKey: () => true,
    // 测试模式：登记防抖回调，由 flushForTest 立即触发
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => undefined,
  });
  hosts.push(host);
  return host;
}

function newRepo(): string {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-item-id-"));
  return repo;
}

describe("验收条目 ID 撞号复现与解决", () => {
  it("同一进程内连续两批新验收条目，二者 ID 必须不同且都保留", async () => {
    const root = newRepo();
    const state = { nextText: "登录成功后要显示欢迎语" };
    const host = makeHost(root, state);

    host.commitUserTurn({ text: "登录成功后要显示欢迎语" });
    await host.flushForTest();

    state.nextText = "导出失败时要提示原因";
    host.commitUserTurn({ text: "导出失败时要提示原因" });
    await host.flushForTest();

    const acc = readSchemeLedger(root)!.state.draft.acceptance;
    expect(acc.map((a) => a.text).sort()).toEqual(
      ["导出失败时要提示原因", "登录成功后要显示欢迎语"].sort(),
    );
    expect(new Set(acc.map((a) => a.id)).size).toBe(acc.length);
  });

  it("模拟进程重启（新 host 仅从磁盘加载）：新批次不得覆盖台账中已有的验收条目", async () => {
    const root = newRepo();
    const first = makeHost(root, { nextText: "登录成功后要显示欢迎语" });
    first.commitUserTurn({ text: "登录成功后要显示欢迎语", turnId: "T1" });
    await first.flushForTest();
    first.dispose();

    // 新进程：仅从磁盘加载，删掉空补丁回放变通手段，直接提交 T2
    const second = makeHost(root, { nextText: "导出失败时要提示原因" });
    second.commitUserTurn({ text: "导出失败时要提示原因", turnId: "T2" });
    await second.flushForTest();

    const acc = readSchemeLedger(root)!.state.draft.acceptance;
    expect(acc.map((a) => a.text)).toContain("登录成功后要显示欢迎语");
    expect(acc.map((a) => a.text)).toContain("导出失败时要提示原因");
    expect(new Set(acc.map((a) => a.id)).size).toBe(acc.length);
  });

  it("重启后 transcript 恢复（挂账⑫）：台账证据引用的旧 turn 必须可解析，否则不得 E_STATE_CORRUPT", async () => {
    const root = newRepo();
    const first = makeHost(root, { nextText: "必须支持手机号一键登录" });
    first.commitUserTurn({ text: "必须支持手机号一键登录", turnId: "T1" });
    await first.flushForTest();
    first.dispose();

    const ledgerBefore = readSchemeLedger(root)!;
    expect(ledgerBefore.state.draft.acceptance.length).toBe(1);
    expect(ledgerBefore.state.draft.acceptance[0]?.text).toBe(
      "必须支持手机号一键登录",
    );

    // 新 host 实例：仅从磁盘加载，不回放空补丁
    const second = makeHost(root, { nextText: "退出登录后清除本地缓存" });
    second.commitUserTurn({ text: "退出登录后清除本地缓存", turnId: "T2" });
    await second.flushForTest();

    // 验证新批次正常应用，未被 E_STATE_CORRUPT 拒绝
    const stats = second.getStats();
    expect(stats.failureCount).toBe(0);
    expect(stats.lastStatus).toBe("applied");
    expect(stats.batchCursor).toBe("T2");

    const ledgerAfter = readSchemeLedger(root)!;
    expect(ledgerAfter.state.draft.acceptance.map((a) => a.text)).toEqual(
      expect.arrayContaining([
        "必须支持手机号一键登录",
        "退出登录后清除本地缓存",
      ]),
    );
  });
});
