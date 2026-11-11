/**
 * 方案验收条目 ID 撞号复现（TASK-J.16 K-14 前置，挂账⑪）。
 *
 * ITEM-n 的两处生成点都不从台账恢复：
 *  - assembleCompilerOutput 的默认 newId 闭包每次调用重置为 ITEM-1（同进程内每批都从 1 开始）；
 *  - IntentCompileLoop.seqCounter 是进程内实例字段，重启归零。
 * 新批次的 new:ac 因此可能拿到与既有验收条目相同的 ID；upsert 按 id 替换 → 旧条目被覆盖。
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
 * `state.replay` 为真时返回空补丁，用于把历史轮次回放进新进程的 transcript，
 * 避免台账证据指向不存在的 turn（那会先触发 E_STATE_CORRUPT，与本测试无关）。
 */
function acceptanceModel(state: {
  nextText: string;
  replay: boolean;
}): IntentCompilerModelClient {
  return {
    async generate(req) {
      if (state.replay) {
        return {
          ok: true,
          raw: { quotes: [], ops: [] },
          input_tokens: 1,
          output_tokens: 1,
          model_id: "stub-item-id",
        };
      }
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
  state: { nextText: string; replay: boolean },
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

describe("验收条目 ID 撞号复现", () => {
  it("同一进程内连续两批新验收条目，二者 ID 必须不同且都保留", async () => {
    const root = newRepo();
    const state = { nextText: "登录成功后要显示欢迎语", replay: false };
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

  it("模拟进程重启（回放 T1 后提交 T2）：新批次不得覆盖台账中已有的验收条目", async () => {
    const root = newRepo();
    const first = makeHost(root, {
      nextText: "登录成功后要显示欢迎语",
      replay: false,
    });
    first.commitUserTurn({ text: "登录成功后要显示欢迎语", turnId: "T1" });
    await first.flushForTest();
    first.dispose();

    // 新进程：计数器归零；台账从磁盘恢复；T1 以空补丁回放进 transcript
    const state = { nextText: "", replay: true };
    const second = makeHost(root, state);
    second.commitUserTurn({ text: "登录成功后要显示欢迎语", turnId: "T1" });
    await second.flushForTest();

    state.replay = false;
    state.nextText = "导出失败时要提示原因";
    second.commitUserTurn({ text: "导出失败时要提示原因", turnId: "T2" });
    await second.flushForTest();

    const acc = readSchemeLedger(root)!.state.draft.acceptance;
    expect(acc.map((a) => a.text)).toContain("登录成功后要显示欢迎语");
    expect(acc.map((a) => a.text)).toContain("导出失败时要提示原因");
    expect(new Set(acc.map((a) => a.id)).size).toBe(acc.length);
  });

  // 挂账⑫（未修，另卡）：重启后 transcript 不从磁盘恢复，台账证据指向的旧 turn 不存在，
  // 审计会以 E_STATE_CORRUPT 拒绝之后所有批次。本测试只覆盖撞号，不覆盖该问题。
  it.todo(
    "重启后 transcript 恢复（挂账⑫）：台账证据引用的旧 turn 必须可解析，否则不得 E_STATE_CORRUPT",
  );
});
