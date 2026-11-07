/**
 * TASK-L.17e：会话原话候选纯函数。
 *
 * L17E-P1：只收 user 非空原话
 * L17E-P4：排除 system/assistant/引导
 * 另：去重保序、上限截断写死
 */
import { describe, expect, it } from "vitest";
import {
  SESSION_VERBATIM_CANDIDATE_LIMIT,
  selectSessionVerbatimCandidates,
} from "../../src/lib/journey/session-verbatim-candidates";
import { buildPlaytestGuidance } from "../../src/lib/journey/playtest-guidance";

describe("TASK-L.17e selectSessionVerbatimCandidates", () => {
  it("只收 user 非空原话（L17E-P1）", () => {
    const out = selectSessionVerbatimCandidates([
      { role: "user", text: "  一模一样，认可完成  " },
      { role: "user", text: "   " },
      { role: "user", text: "" },
      { role: "assistant", text: "好的，请对照参考站试玩" },
      { role: "system", text: "已排队：x" },
      { role: "tool", text: "read_file" },
      { role: "user", text: "标题字号再大一点" },
    ]);
    expect(out).toEqual(["一模一样，认可完成", "标题字号再大一点"]);
  });

  it("去重保序：首次出现保留，后续重复丢弃", () => {
    const out = selectSessionVerbatimCandidates([
      { role: "user", text: "A" },
      { role: "user", text: "B" },
      { role: "user", text: "A" },
      { role: "user", text: "  A  " },
      { role: "user", text: "C" },
    ]);
    expect(out).toEqual(["A", "B", "C"]);
  });

  it("排除 system/assistant/引导（L17E-P4）", () => {
    const guidance = buildPlaytestGuidance({
      contractLabel: "登录页 v2",
      referenceUrls: ["https://ref.example.com"],
    });
    const guidanceTexts = guidance.map((m) => m.text);
    const out = selectSessionVerbatimCandidates([
      { role: "assistant", text: "助手回复不该进候选" },
      { role: "system", text: "系统提示不该进候选" },
      { role: "tool", text: "tool_name" },
      // 即便误标为 user，引导常量也必须被挡下
      ...guidanceTexts.map((text) => ({ role: "user" as const, text })),
      { role: "user", text: "用户真原话：可以上线" },
    ]);
    expect(out).toEqual(["用户真原话：可以上线"]);
    for (const g of guidanceTexts) {
      expect(out).not.toContain(g);
    }
  });

  it(`上限截断写死为 ${SESSION_VERBATIM_CANDIDATE_LIMIT}`, () => {
    const messages = Array.from(
      { length: SESSION_VERBATIM_CANDIDATE_LIMIT + 5 },
      (_, i) => ({ role: "user", text: `msg-${i}` }),
    );
    const out = selectSessionVerbatimCandidates(messages);
    expect(out).toHaveLength(SESSION_VERBATIM_CANDIDATE_LIMIT);
    expect(out[0]).toBe("msg-0");
    expect(out.at(-1)).toBe(`msg-${SESSION_VERBATIM_CANDIDATE_LIMIT - 1}`);
  });

  it("空列表 / 全非 user → 空候选", () => {
    expect(selectSessionVerbatimCandidates([])).toEqual([]);
    expect(
      selectSessionVerbatimCandidates([
        { role: "assistant", text: "hi" },
        { role: "system", text: "sys" },
      ]),
    ).toEqual([]);
  });
});
