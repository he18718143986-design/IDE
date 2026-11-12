import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readTranscript,
  transcriptPath,
  TranscriptStoreError,
  writeTranscript,
  TRANSCRIPT_SCHEMA_VERSION,
} from "../../daemon/supervisor/intent-compiler/transcript-store";
import { SCHEME_LEDGER_DIR } from "../../daemon/supervisor/intent-compiler/scheme-ledger-store";
import { safeRmSync } from "../helpers/tmp";

let repo: string | null = null;

function newRepo(): string {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-transcript-store-"));
  return repo;
}

afterEach(() => {
  if (repo) safeRmSync(repo);
  repo = null;
});

describe("transcript-store 单元测试 (TASK-J.21 / J21-P3)", () => {
  it("文件不存在时视为空基线，返回 null，不抛出异常", () => {
    const root = newRepo();
    expect(readTranscript(root)).toBeNull();
  });

  it("正常写入与恢复：字段、轮次及哈希完整还原", () => {
    const root = newRepo();
    const turns = [
      {
        turn_id: "T1",
        role: "user" as const,
        seq: 1,
        text: "支持导出 PDF",
        text_sha256: "abc1",
        user_alias_seq: 1,
      },
      {
        turn_id: "T2",
        role: "assistant" as const,
        seq: 2,
        text: "好的，开始规划导出模块",
        text_sha256: "abc2",
      },
    ];

    writeTranscript(root, {
      seq: 2,
      user_alias_seq: 1,
      turns,
    });

    const file = transcriptPath(root);
    expect(fs.existsSync(file)).toBe(true);
    expect(file).toContain(path.join(SCHEME_LEDGER_DIR, "transcript.json"));

    const loaded = readTranscript(root);
    expect(loaded).not.toBeNull();
    expect(loaded!.schema_version).toBe(TRANSCRIPT_SCHEMA_VERSION);
    expect(loaded!.seq).toBe(2);
    expect(loaded!.user_alias_seq).toBe(1);
    expect(loaded!.turns).toEqual(turns);
  });

  describe("版本校验失败关闭（抛 E_TRANSCRIPT_SCHEMA_VERSION）", () => {
    it("缺少 schema_version 字段时抛出 E_TRANSCRIPT_SCHEMA_VERSION", () => {
      const root = newRepo();
      const file = transcriptPath(root);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify({
          updated_at: new Date().toISOString(),
          seq: 1,
          user_alias_seq: 1,
          turns: [],
        }),
        "utf8",
      );

      expect(() => readTranscript(root)).toThrowError(TranscriptStoreError);
      try {
        readTranscript(root);
      } catch (err) {
        expect(err).toBeInstanceOf(TranscriptStoreError);
        expect((err as TranscriptStoreError).code).toBe(
          "E_TRANSCRIPT_SCHEMA_VERSION",
        );
        expect((err as Error).message).toContain("E_TRANSCRIPT_SCHEMA_VERSION");
      }
    });

    it("schema_version 不识别时抛出 E_TRANSCRIPT_SCHEMA_VERSION", () => {
      const root = newRepo();
      const file = transcriptPath(root);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify({
          schema_version: "2.0-unknown",
          updated_at: new Date().toISOString(),
          seq: 1,
          user_alias_seq: 1,
          turns: [],
        }),
        "utf8",
      );

      expect(() => readTranscript(root)).toThrowError(TranscriptStoreError);
      try {
        readTranscript(root);
      } catch (err) {
        expect(err).toBeInstanceOf(TranscriptStoreError);
        expect((err as TranscriptStoreError).code).toBe(
          "E_TRANSCRIPT_SCHEMA_VERSION",
        );
      }
    });
  });

  describe("文件损坏与格式错误校验（抛 E_TRANSCRIPT_CORRUPT）", () => {
    it("JSON 语法错误抛出 E_TRANSCRIPT_CORRUPT", () => {
      const root = newRepo();
      const file = transcriptPath(root);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "{ broken json", "utf8");

      expect(() => readTranscript(root)).toThrowError(TranscriptStoreError);
      try {
        readTranscript(root);
      } catch (err) {
        expect(err).toBeInstanceOf(TranscriptStoreError);
        expect((err as TranscriptStoreError).code).toBe("E_TRANSCRIPT_CORRUPT");
        expect((err as Error).message).toContain("E_TRANSCRIPT_CORRUPT");
      }
    });

    it("根节点非对象抛出 E_TRANSCRIPT_CORRUPT", () => {
      const root = newRepo();
      const file = transcriptPath(root);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(["not", "an", "object"]), "utf8");

      expect(() => readTranscript(root)).toThrowError(TranscriptStoreError);
      try {
        readTranscript(root);
      } catch (err) {
        expect((err as TranscriptStoreError).code).toBe("E_TRANSCRIPT_CORRUPT");
      }
    });

    it("缺少根字段 (seq, user_alias_seq, turns) 抛出 E_TRANSCRIPT_CORRUPT", () => {
      const root = newRepo();
      const file = transcriptPath(root);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify({
          schema_version: TRANSCRIPT_SCHEMA_VERSION,
          updated_at: new Date().toISOString(),
          // 缺少 seq, user_alias_seq, turns
        }),
        "utf8",
      );

      expect(() => readTranscript(root)).toThrowError(TranscriptStoreError);
      try {
        readTranscript(root);
      } catch (err) {
        expect((err as TranscriptStoreError).code).toBe("E_TRANSCRIPT_CORRUPT");
      }
    });

    it("轮次数据字段缺失或损坏抛出 E_TRANSCRIPT_CORRUPT", () => {
      const root = newRepo();
      const file = transcriptPath(root);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify({
          schema_version: TRANSCRIPT_SCHEMA_VERSION,
          updated_at: new Date().toISOString(),
          seq: 1,
          user_alias_seq: 1,
          turns: [
            {
              turn_id: "T1",
              role: "invalid_role",
              seq: 1,
              text: "abc",
              text_sha256: "def",
            },
          ],
        }),
        "utf8",
      );

      expect(() => readTranscript(root)).toThrowError(TranscriptStoreError);
      try {
        readTranscript(root);
      } catch (err) {
        expect((err as TranscriptStoreError).code).toBe("E_TRANSCRIPT_CORRUPT");
      }
    });
  });
});
