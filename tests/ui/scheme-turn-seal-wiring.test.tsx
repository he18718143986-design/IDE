// @vitest-environment jsdom
/**
 * TASK-J.16 · J16-P5（P-201）：右栏原话先登记再折进方案。
 * 语料与已登记原话清单放在同一个状态对象里，一起换、一起清；登记失败不折进方案。
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_SCHEME_SOURCES,
  applySchemeTurnRegistration,
  schemeTurnNotFoldedNotice,
} from "../../src/routes/index";

const T1 = { turn_id: "T1", turn_text_sha256: "a".repeat(64) };
const T2 = { turn_id: "T2", turn_text_sha256: "b".repeat(64) };

describe("P-201 · 右栏原话登记与方案语料", () => {
  it("登记失败不折进方案并提示没记进方案", () => {
    const prev = applySchemeTurnRegistration(
      EMPTY_SCHEME_SOURCES,
      "做一个记账小程序",
      { ok: true, turn: T1 },
    ).sources;
    const result = applySchemeTurnRegistration(prev, "首页要有月度汇总", {
      ok: false,
      reason: "这句话没能登记下来",
    });
    expect(result.sources).toBe(prev);
    expect(result.sources.corpus).not.toContain("首页要有月度汇总");
    expect(result.sources.turns).toEqual([T1]);
    expect(result.notice).toContain("没记进方案");
    expect(result.notice).toContain("这句话没能登记下来");
  });

  it("语料与原话清单同批更新：折进同增、新建需求同清", () => {
    const first = applySchemeTurnRegistration(
      EMPTY_SCHEME_SOURCES,
      "做一个记账小程序",
      { ok: true, turn: T1 },
    );
    const second = applySchemeTurnRegistration(
      first.sources,
      "首页要有月度汇总",
      { ok: true, turn: T2 },
    );
    expect(first.notice).toBeNull();
    expect(second.notice).toBeNull();
    // 同一个新对象里语料与清单一起前进，条数与折进的句数一致
    expect(second.sources).toEqual({
      corpus: "做一个记账小程序\n首页要有月度汇总",
      turns: [T1, T2],
    });
    expect(second.sources.corpus.split("\n")).toHaveLength(
      second.sources.turns.length,
    );
    // 旧对象不被改写：上一版的语料与清单原样保留
    expect(first.sources).toEqual({ corpus: "做一个记账小程序", turns: [T1] });
    // 新建需求换成同一个空对象：语料与清单一起清空
    expect(EMPTY_SCHEME_SOURCES).toEqual({ corpus: "", turns: [] });
    expect(
      applySchemeTurnRegistration(EMPTY_SCHEME_SOURCES, "重新开始", {
        ok: true,
        turn: T2,
      }).sources,
    ).toEqual({ corpus: "重新开始", turns: [T2] });
  });

  it("提示文案只说没记进方案的原因，右栏照常聊天", () => {
    expect(schemeTurnNotFoldedNotice("这句超过 4000 字")).toBe(
      "这句没记进方案：这句超过 4000 字。右栏照常聊天；需要进方案请重发这句。",
    );
  });
});
