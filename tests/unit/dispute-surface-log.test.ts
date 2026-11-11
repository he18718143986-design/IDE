/**
 * TASK-J.16 · J16-P1：surface_log 随 §15.4 投影写入（GAP-P8）。
 * 只记录确已呈现的条目；每条含 item_ref 与呈现时间；只追加。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SURFACE_LOG_ROOT,
  appendSurfaceLog,
  buildSurfaceLogEntries,
  readSurfaceLog,
} from "../../daemon/supervisor/dispute/surface-log";

const AT = "2026-11-11T10:00:00.000Z";
let repo: string;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "j16-surface-log-"));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("J16-P1 · buildSurfaceLogEntries 只收确已呈现的条目", () => {
  it("每条记录含 item_ref、呈现时间与分区，去掉空引用与重复项", () => {
    const entries = buildSurfaceLogEntries({
      confirmation_id: "conf_01",
      plain_text_version: "v1",
      presented_at: AT,
      shown: [
        { item_ref: "dec_1", section: "decision" },
        { item_ref: "dec_1", section: "decision" },
        { item_ref: "  ", section: "acceptance" },
        { item_ref: "acc_2", section: "acceptance" },
      ],
    });
    expect(entries).toEqual([
      {
        confirmation_id: "conf_01",
        item_ref: "dec_1",
        section: "decision",
        presented_at: AT,
        plain_text_version: "v1",
      },
      {
        confirmation_id: "conf_01",
        item_ref: "acc_2",
        section: "acceptance",
        presented_at: AT,
        plain_text_version: "v1",
      },
    ]);
  });

  it("没有任何展示条目时不产生记录，也不创建文件", () => {
    const entries = buildSurfaceLogEntries({
      confirmation_id: "conf_empty",
      plain_text_version: "v1",
      presented_at: AT,
      shown: [],
    });
    expect(entries).toEqual([]);
    appendSurfaceLog(repo, entries);
    expect(fs.existsSync(path.join(repo, SURFACE_LOG_ROOT))).toBe(false);
    expect(readSurfaceLog(repo, "conf_empty")).toBeNull();
  });

  it("非法 confirmation_id 与非法时间被拒绝", () => {
    expect(() =>
      buildSurfaceLogEntries({
        confirmation_id: "../escape",
        plain_text_version: "v1",
        presented_at: AT,
        shown: [{ item_ref: "x", section: "area" }],
      }),
    ).toThrow(/非法 confirmation_id/);
    expect(() =>
      buildSurfaceLogEntries({
        confirmation_id: "conf_ok",
        plain_text_version: "v1",
        presented_at: "not-a-date",
        shown: [{ item_ref: "x", section: "area" }],
      }),
    ).toThrow(/presented_at/);
  });
});

describe("J16-P1 · 追加写入与读回", () => {
  it("两次呈现追加到同一文件，旧行保持不变", () => {
    const first = buildSurfaceLogEntries({
      confirmation_id: "conf_02",
      plain_text_version: "v1",
      presented_at: AT,
      shown: [{ item_ref: "dec_1", section: "decision" }],
    });
    const second = buildSurfaceLogEntries({
      confirmation_id: "conf_02",
      plain_text_version: "v1",
      presented_at: "2026-11-11T10:05:00.000Z",
      shown: [{ item_ref: "area_9", section: "area" }],
    });
    appendSurfaceLog(repo, first);
    const before = fs.readFileSync(
      path.join(repo, SURFACE_LOG_ROOT, "conf_02.jsonl"),
      "utf-8",
    );
    appendSurfaceLog(repo, second);
    const after = fs.readFileSync(
      path.join(repo, SURFACE_LOG_ROOT, "conf_02.jsonl"),
      "utf-8",
    );

    expect(after.startsWith(before)).toBe(true);
    const read = readSurfaceLog(repo, "conf_02");
    expect(read?.map((e) => e.item_ref)).toEqual(["dec_1", "area_9"]);
  });

  it("按 confirmation_id 分文件存放", () => {
    appendSurfaceLog(repo, [
      ...buildSurfaceLogEntries({
        confirmation_id: "conf_a",
        plain_text_version: "v1",
        presented_at: AT,
        shown: [{ item_ref: "a1", section: "approval" }],
      }),
      ...buildSurfaceLogEntries({
        confirmation_id: "conf_b",
        plain_text_version: "v1",
        presented_at: AT,
        shown: [{ item_ref: "b1", section: "high_risk" }],
      }),
    ]);
    expect(readSurfaceLog(repo, "conf_a")?.map((e) => e.item_ref)).toEqual([
      "a1",
    ]);
    expect(readSurfaceLog(repo, "conf_b")?.map((e) => e.item_ref)).toEqual([
      "b1",
    ]);
  });

  it("损坏的行或归属不符的行直接报错，不当作完整证据", () => {
    const dir = path.join(repo, SURFACE_LOG_ROOT);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "conf_bad.jsonl"), "{not json\n", "utf-8");
    expect(() => readSurfaceLog(repo, "conf_bad")).toThrow(/不是合法 JSON/);

    fs.writeFileSync(
      path.join(dir, "conf_mix.jsonl"),
      `${JSON.stringify({
        confirmation_id: "conf_other",
        item_ref: "x",
        section: "area",
        presented_at: AT,
        plain_text_version: "v1",
      })}\n`,
      "utf-8",
    );
    expect(() => readSurfaceLog(repo, "conf_mix")).toThrow(/归属不符/);
  });
});
