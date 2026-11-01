/**
 * TASK-H.9：废止 `.stagent/metadata/` 写入；Demo 确认态迁 `.stagent/records/`。
 * 夹具中可出现 legacy 字面量（只读迁移源），生产写入路径不得再含 metadata。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { safeRmSync } from "../helpers/tmp";
import {
  DEMO_CONFIRM_STATE_FILE,
  LEGACY_DEMO_CONFIRM_STATE_FILE,
  buildMinimalPrototypeDemo,
  confirmDemoPrototype,
  readDemoConfirm,
  upsertDemoConfirm,
  writePrototype,
} from "../../daemon/supervisor/demo/prototypes";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    safeRmSync(d);
  }
});

describe("TASK-H.9 drop .stagent/metadata writes", () => {
  it("DEMO_CONFIRM_STATE_FILE 落在 records，不含 metadata", () => {
    expect(DEMO_CONFIRM_STATE_FILE).toBe(".stagent/records/demo-confirm.json");
    expect(DEMO_CONFIRM_STATE_FILE.includes(".stagent/metadata")).toBe(false);
    expect(LEGACY_DEMO_CONFIRM_STATE_FILE).toBe(
      ".stagent/metadata/demo-confirm.json",
    );
  });

  it("writePrototype / confirm 只写 records，不 mkdir metadata", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-h9-"));
    dirs.push(root);
    const demo = buildMinimalPrototypeDemo("H9 Demo");
    const result = writePrototype(root, "h9-demo", demo);
    const newAbs = path.join(root, DEMO_CONFIRM_STATE_FILE);
    const legacyAbs = path.join(root, LEGACY_DEMO_CONFIRM_STATE_FILE);
    expect(fs.existsSync(newAbs)).toBe(true);
    expect(fs.existsSync(legacyAbs)).toBe(false);
    expect(fs.existsSync(path.join(root, ".stagent", "metadata"))).toBe(false);
    confirmDemoPrototype(root, result.prototype_id);
    expect(fs.existsSync(legacyAbs)).toBe(false);
    const rec = readDemoConfirm(root, result.prototype_id);
    expect(rec?.confirmed).toBe(true);
    const written = fs.readFileSync(newAbs, "utf8");
    expect(written).toContain("h9-demo");
  });

  it("旧 metadata 文件只读迁移到 records，且不再回写旧路径", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-h9-legacy-"));
    dirs.push(root);
    const legacyAbs = path.join(root, LEGACY_DEMO_CONFIRM_STATE_FILE);
    const newAbs = path.join(root, DEMO_CONFIRM_STATE_FILE);
    fs.mkdirSync(path.dirname(legacyAbs), { recursive: true });
    fs.writeFileSync(
      legacyAbs,
      JSON.stringify(
        {
          records: [
            {
              prototype_id: "old-proto",
              confirmed: true,
              confirmed_at: "2026-01-01T00:00:00.000Z",
              relative_root: ".stagent/prototypes/old-proto",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    const before = fs.readFileSync(legacyAbs, "utf8");
    const rec = readDemoConfirm(root, "old-proto");
    expect(rec?.confirmed).toBe(true);
    expect(fs.existsSync(newAbs)).toBe(true);
    // 旧文件内容不被 upsert 改写（只读迁移）
    expect(fs.readFileSync(legacyAbs, "utf8")).toBe(before);

    upsertDemoConfirm(root, {
      prototype_id: "old-proto",
      confirmed: true,
      confirmed_at: "2026-11-01T00:00:00.000Z",
      relative_root: ".stagent/prototypes/old-proto",
      demo_mode: "INTERACTIVE_DEMO",
    });
    expect(fs.readFileSync(legacyAbs, "utf8")).toBe(before);
    const updated = JSON.parse(fs.readFileSync(newAbs, "utf8")) as {
      records: Array<{ confirmed_at: string | null }>;
    };
    expect(updated.records[0]?.confirmed_at).toBe("2026-11-01T00:00:00.000Z");
  });
});
