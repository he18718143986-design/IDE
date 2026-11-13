/**
 * TASK-J.16 · J16-P4：缺 surface_log 时退化为「无呈现记录」，不伪造 (a)/(b)。
 * 本文件只覆盖退化判定函数；K-14 账本接入后由其集成测试再次覆盖 resolution_note 写入。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  NO_SURFACE_RECORD_NOTE,
  appendSurfaceLog,
  buildSurfaceLogEntries,
  readSurfaceLog,
  surfaceLogResolutionNote,
} from "../../daemon/supervisor/dispute/surface-log";

const AT = "2026-11-11T10:00:00.000Z";
let repo: string;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "j16-surface-degraded-"));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("J16-P4 · 缺 surface_log 的退化", () => {
  it("日志文件不存在：读取返回 null，resolution_note 标「无呈现记录」", () => {
    const entries = readSurfaceLog(repo, "conf_missing");
    expect(entries).toBeNull();
    expect(surfaceLogResolutionNote(entries)).toBe(NO_SURFACE_RECORD_NOTE);
    expect(NO_SURFACE_RECORD_NOTE).toBe("无呈现记录");
  });

  it("日志存在但该确认下没有任何呈现条目：同样标「无呈现记录」", () => {
    expect(surfaceLogResolutionNote([])).toBe("无呈现记录");
  });

  it("有呈现条目时不产生退化标注", () => {
    appendSurfaceLog(
      repo,
      buildSurfaceLogEntries({
        confirmation_id: "conf_full",
        plain_text_version: "v1",
        presented_at: AT,
        phase: "pre_confirm",
        shown: [{ item_ref: "dec_1", section: "decision" }],
      }),
    );
    const entries = readSurfaceLog(repo, "conf_full");
    expect(entries).not.toBeNull();
    expect(surfaceLogResolutionNote(entries)).toBeNull();
  });

  it("退化路径不写任何日志文件（不得凭空补记录）", () => {
    readSurfaceLog(repo, "conf_missing");
    expect(fs.existsSync(path.join(repo, ".stagent"))).toBe(false);
  });
});
