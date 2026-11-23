/**
 * TASK-J.50a-1：architecture-baseline-store 读写、修订归档不可变、
 * 以及落盘可被 decompose.ts 现有 ReadyPabView 类型消费。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeRmSync } from "../helpers/tmp";
import {
  ArchitectureBaselineStoreError,
  architectureBaselinePath,
  architectureBaselineRevisionPath,
  readArchitectureBaselineRevision,
  readCurrentArchitectureBaseline,
  writeCurrentArchitectureBaseline,
} from "../../daemon/project/architecture-baseline-store";
import type { ReadyPabView } from "../../daemon/supervisor/decomposer/decompose";

function samplePab(overrides: Partial<ReadyPabView> = {}): ReadyPabView {
  return {
    baseline_id: "pab-1",
    baseline_revision: 1,
    baseline_digest: "caller-supplied-digest-v1",
    status: "ready",
    ...overrides,
  };
}

/** 用现有 ReadyPabView 类型消费落盘结果，禁止在本测试另写平行类型。 */
function consumeAsReadyPabView(pab: ReadyPabView): ReadyPabView {
  return pab;
}

describe("daemon/project/architecture-baseline-store", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "stagent-architecture-baseline-store-"),
    );
  });

  afterEach(() => {
    try {
      safeRmSync(tempDir);
    } catch {
      /* ignore */
    }
  });

  it("J50a1-P1: 当前 PAB 写入后读回等值，digest 原样保留", () => {
    const pab = samplePab({
      baseline_digest: "verbatim-not-a-computed-hash",
      open_decisions: [{ blocking: false }],
    });
    writeCurrentArchitectureBaseline(tempDir, pab);

    expect(fs.existsSync(architectureBaselinePath(tempDir))).toBe(true);
    const read = readCurrentArchitectureBaseline(tempDir);
    expect(read).toEqual(pab);
    expect(read?.baseline_digest).toBe("verbatim-not-a-computed-hash");
  });

  it("J50a1-P2: 写入新当前 PAB 时先归档上一份，已归档修订不可改写", () => {
    const v1 = samplePab({
      baseline_revision: 1,
      baseline_digest: "digest-v1",
      status: "draft",
    });
    const v2 = samplePab({
      baseline_revision: 2,
      baseline_digest: "digest-v2",
      status: "ready",
    });
    writeCurrentArchitectureBaseline(tempDir, v1);
    writeCurrentArchitectureBaseline(tempDir, v2);

    const archive = architectureBaselineRevisionPath(tempDir, 1);
    expect(fs.existsSync(archive)).toBe(true);
    const archivedRaw = fs.readFileSync(archive, "utf8");
    expect(JSON.parse(archivedRaw)).toEqual(v1);
    expect(readArchitectureBaselineRevision(tempDir, 1)).toEqual(v1);
    expect(readCurrentArchitectureBaseline(tempDir)).toEqual(v2);

    expect(() => writeCurrentArchitectureBaseline(tempDir, v1)).toThrow(
      ArchitectureBaselineStoreError,
    );
    expect(() => writeCurrentArchitectureBaseline(tempDir, v1)).toThrow(
      /E_PAB_REVISION_EXISTS/,
    );
    expect(fs.readFileSync(archive, "utf8")).toBe(archivedRaw);
    expect(readCurrentArchitectureBaseline(tempDir)).toEqual(v2);
  });

  it("J50a1-P2: 归档目标已存在时失败关闭，不覆盖归档也不改写当前文件", () => {
    const v1 = samplePab({
      baseline_revision: 1,
      baseline_digest: "digest-v1",
    });
    const v2 = samplePab({
      baseline_revision: 2,
      baseline_digest: "digest-v2",
    });
    writeCurrentArchitectureBaseline(tempDir, v1);

    const archive = architectureBaselineRevisionPath(tempDir, 1);
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    const sentinel = '{"sentinel":true,"must_not_overwrite":1}\n';
    fs.writeFileSync(archive, sentinel, "utf8");

    expect(() => writeCurrentArchitectureBaseline(tempDir, v2)).toThrow(
      /E_PAB_REVISION_EXISTS/,
    );
    expect(fs.readFileSync(archive, "utf8")).toBe(sentinel);
    expect(readCurrentArchitectureBaseline(tempDir)).toEqual(v1);
  });

  it("J50a1-P3: 读出的落盘文件能被 decompose.ts 现有 ReadyPabView 类型消费", () => {
    const pab = samplePab({
      baseline_id: "pab-ready-view",
      baseline_revision: 3,
      baseline_digest: "digest-for-ready-pab-view",
      status: "ready",
      open_decisions: [{ blocking: false }],
    });
    writeCurrentArchitectureBaseline(tempDir, pab);

    const stored = readCurrentArchitectureBaseline(tempDir);
    expect(stored).not.toBeNull();
    const view: ReadyPabView = consumeAsReadyPabView(stored!);
    expect(view.baseline_id).toBe("pab-ready-view");
    expect(view.baseline_revision).toBe(3);
    expect(view.baseline_digest).toBe("digest-for-ready-pab-view");
    expect(["draft", "ready", "stale"]).toContain(view.status);
    expect(view.status).toBe("ready");
    expect(view.open_decisions).toEqual([{ blocking: false }]);
  });

  it("缺省当前文件时 readCurrentArchitectureBaseline 返回 null", () => {
    expect(readCurrentArchitectureBaseline(tempDir)).toBeNull();
    expect(readArchitectureBaselineRevision(tempDir, 1)).toBeNull();
  });

  it("写入时按需创建 .stagent/project 与 revisions 目录", () => {
    const v1 = samplePab({ baseline_revision: 1 });
    const v2 = samplePab({ baseline_revision: 2 });
    writeCurrentArchitectureBaseline(tempDir, v1);
    writeCurrentArchitectureBaseline(tempDir, v2);

    expect(
      fs.existsSync(
        path.join(tempDir, ".stagent", "project", "architecture-baseline.json"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          tempDir,
          ".stagent",
          "project",
          "architecture-baseline.revisions",
          "1.json",
        ),
      ),
    ).toBe(true);
  });

  it("status 仅接受 draft / ready / stale，非法字段写入失败关闭", () => {
    for (const status of ["draft", "ready", "stale"] as const) {
      const isolated = fs.mkdtempSync(
        path.join(os.tmpdir(), "stagent-architecture-baseline-status-"),
      );
      try {
        writeCurrentArchitectureBaseline(
          isolated,
          samplePab({ status, baseline_revision: 1 }),
        );
        expect(readCurrentArchitectureBaseline(isolated)?.status).toBe(status);
      } finally {
        try {
          safeRmSync(isolated);
        } catch {
          /* ignore */
        }
      }
    }

    expect(() =>
      writeCurrentArchitectureBaseline(
        tempDir,
        samplePab({ status: "published" as ReadyPabView["status"] }),
      ),
    ).toThrow(/E_PAB_INVALID/);
    expect(() =>
      writeCurrentArchitectureBaseline(tempDir, samplePab({ baseline_id: "" })),
    ).toThrow(/E_PAB_INVALID/);
    expect(readCurrentArchitectureBaseline(tempDir)).toBeNull();
  });
});
