import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  computeTurnTextSha256,
  readTranscript,
  writeTranscript,
  type PersistedTranscriptTurn,
} from "../../daemon/supervisor/intent-compiler/transcript-store";
import { createIntentCompilerHost } from "../../daemon/supervisor/intent-compiler/host";

function referenceSha256Utf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("TASK-J.23 / J23-P3 · 会话哈希与落盘口径对齐", () => {
  it("computeTurnTextSha256 与 sha256(utf8 原文) 严格一致", () => {
    const samples = [
      "这里不对",
      "登录页没有记住我的勾选，和我们说好的不一样",
      "Hello Stagent",
      "多行文本\n第二行内容\n\t缩进与特殊符号：¥#%*~🎉",
      "",
    ];

    for (const sample of samples) {
      const expected = referenceSha256Utf8(sample);
      const computed = computeTurnTextSha256(sample);
      expect(computed).toBe(expected);
      expect(computed).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("writeTranscript 与 readTranscript 保证 turn_text_sha256 与 text_sha256 正确落盘与读回", () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "j23-transcript-test-"),
    );
    try {
      const turnText = "这里不对，需要重新检查需求与代码";
      const expectedHash = referenceSha256Utf8(turnText);

      const turn: PersistedTranscriptTurn = {
        turn_id: "turn_1",
        role: "user",
        seq: 1,
        text: turnText,
        text_sha256: expectedHash,
      };

      writeTranscript(tmpDir, {
        seq: 1,
        user_alias_seq: 1,
        turns: [turn],
      });

      const transcriptFile = path.join(
        tmpDir,
        ".stagent/drafts/scheme-ledger/transcript.json",
      );
      expect(fs.existsSync(transcriptFile)).toBe(true);

      const rawJson = JSON.parse(fs.readFileSync(transcriptFile, "utf8"));
      expect(rawJson.turns).toHaveLength(1);
      expect(rawJson.turns[0].text_sha256).toBe(expectedHash);
      expect(rawJson.turns[0].turn_text_sha256).toBe(expectedHash);

      const loaded = readTranscript(tmpDir);
      expect(loaded).not.toBeNull();
      expect(loaded!.turns).toHaveLength(1);
      expect(loaded!.turns[0]!.text_sha256).toBe(expectedHash);
      expect(loaded!.turns[0]!.turn_text_sha256).toBe(expectedHash);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("IntentCompilerHost.commitUserTurn 落盘 transcript 含匹配的 turn_text_sha256", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "j23-host-test-"));
    try {
      const host = createIntentCompilerHost({
        repoRoot: tmpDir,
        modelClient: null,
      });

      const userText = "记住我要勾上";
      const expectedHash = referenceSha256Utf8(userText);

      const res = host.commitUserTurn({ text: userText });
      expect(res.turn_id).toBeDefined();

      const loaded = readTranscript(tmpDir);
      expect(loaded).not.toBeNull();
      expect(loaded!.turns.length).toBeGreaterThanOrEqual(1);

      const savedTurn = loaded!.turns.find((t) => t.turn_id === res.turn_id);
      expect(savedTurn).toBeDefined();
      expect(savedTurn!.text).toBe(userText);
      expect(savedTurn!.text_sha256).toBe(expectedHash);
      expect(savedTurn!.turn_text_sha256).toBe(expectedHash);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
