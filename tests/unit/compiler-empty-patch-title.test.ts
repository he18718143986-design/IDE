/**
 * TASK-J.49：空补丁时用台账里已有模块名补 set_title。
 */
import { describe, expect, it } from "vitest";
import { maybeFillEmptyPatchTitle } from "../../daemon/supervisor/intent-compiler/compile-loop";
import {
  aiModule,
  emptyDraft,
  makeTranscript,
  userModule,
} from "../helpers/scheme-patch-fixtures";
import type { SchemePatch } from "../../src/lib/journey/scheme-patch-types";

function emptyPatch(): SchemePatch {
  return {
    base_revision: 5,
    compiled_from_turns: ["T1"],
    ops: [],
  };
}

describe("J.49 空补丁补标题", () => {
  it("空补丁且标题不足 2 字时补上已有模块名", () => {
    const tr = makeTranscript([{ role: "user", text: "我要一个登录页" }]);
    const login = userModule(
      tr,
      "ITEM-1",
      "登录页",
      "用户登录入口",
      "T1",
      "我要一个登录页",
    );
    const draft = emptyDraft({
      title: "",
      modules: [aiModule("ITEM-0", "x", "太短且无证据"), login],
    });
    const next = maybeFillEmptyPatchTitle(emptyPatch(), draft);
    const titles = next.ops.filter((op) => op.op === "set_title");
    expect(titles).toHaveLength(1);
    const title = titles[0];
    expect(title?.op).toBe("set_title");
    if (title?.op !== "set_title") return;
    expect(title.value).toBe("登录页");
    expect(title.evidence).toEqual(
      login.evidence.filter((e) => e.kind === "turn").map((e) => e.ref),
    );
    expect(title.evidence.length).toBeGreaterThan(0);
  });

  it("标题已够 2 字则不补", () => {
    const tr = makeTranscript([{ role: "user", text: "我要一个登录页" }]);
    const draft = emptyDraft({
      title: "已有标题",
      modules: [
        userModule(
          tr,
          "ITEM-1",
          "登录页",
          "用户登录入口",
          "T1",
          "我要一个登录页",
        ),
      ],
    });
    const next = maybeFillEmptyPatchTitle(emptyPatch(), draft);
    expect(next.ops).toEqual([]);
  });

  it("没有合格模块则不补", () => {
    const draft = emptyDraft({
      title: "",
      modules: [aiModule("ITEM-1", "登录页", "无证据不算合格")],
    });
    const next = maybeFillEmptyPatchTitle(emptyPatch(), draft);
    expect(next.ops).toEqual([]);
  });
});
