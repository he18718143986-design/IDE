/**
 * TM-GS / TM-GA / TM-GE：墓地门禁裁决（TASK-J.18c）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { GraveyardEntry } from "../../src/lib/journey/scheme-patch-types";
import {
  assessDiffScan,
  evaluateGraveyardGate,
  GATE_LOG_CODES,
  MAX_DIFF_FILE_BYTES,
  recommendGateCardAction,
  stableStringify,
  type GateInput,
  type GateResult,
} from "../../daemon/guard/worker-graveyard-gate";
import { ERROR_CODES } from "../../src/lib/error-codes";

type FixtureTomb = {
  fingerprint: { key: string; lexemes: string[] };
  revival_keys: string[];
  status: "active" | "revived";
  disallow_revival: boolean;
  rejected_by: "user" | "security_gate";
};

const fixture = JSON.parse(
  readFileSync(
    path.resolve(__dirname, "../fixtures/graveyard-match/cases.json"),
    "utf8",
  ),
) as { tombstones: Record<string, FixtureTomb> };

function toEntry(
  id: string,
  t: FixtureTomb,
  over: Partial<GraveyardEntry> = {},
): GraveyardEntry {
  return {
    rejected_id: id,
    proposal: t.fingerprint.key,
    rejected_by: t.rejected_by,
    rejection_reason: "fixture",
    evidence: [],
    disallow_revival: t.disallow_revival,
    updated_in_revision: 1,
    fingerprint: t.fingerprint,
    revival_keys: t.revival_keys,
    rejected_after_turn_seq: 0,
    status: t.status,
    ...over,
  };
}

function entryOf(id: string, over: Partial<GraveyardEntry> = {}): GraveyardEntry {
  const t = fixture.tombstones[id];
  if (!t) throw new Error(`missing ${id}`);
  return toEntry(id, t, over);
}

function softGraphql(): GraveyardEntry {
  return {
    rejected_id: "T-SOFT-GQL",
    proposal: "用 graphql",
    rejected_by: "user",
    rejection_reason: "先不引入",
    evidence: [],
    disallow_revival: false,
    updated_in_revision: 1,
    fingerprint: {
      key: "用graphql",
      lexemes: ["graphql", "用"],
    },
    revival_keys: ["用graphql", "graphql"],
    rejected_after_turn_seq: 0,
    status: "active",
  };
}

function apiTomb(): GraveyardEntry {
  return {
    rejected_id: "T-API",
    proposal: "做个 API 网关",
    rejected_by: "user",
    rejection_reason: "范围太大",
    evidence: [],
    disallow_revival: true,
    updated_in_revision: 1,
    fingerprint: {
      key: "做个api网关",
      lexemes: ["api", "网关", "做个"],
    },
    revival_keys: ["做个api网关", "api"],
    rejected_after_turn_seq: 0,
    status: "active",
  };
}

function baseInput(over: Partial<GateInput> = {}): GateInput {
  return {
    graveyard: [entryOf("T-MONGO")],
    changes: [],
    commands: [],
    texts: [],
    availability: "snapshot",
    ...over,
  };
}

function pkgChange(deps: Record<string, string>, beforeDeps: Record<string, string> = {}) {
  return {
    path: "package.json",
    before: JSON.stringify({ name: "app", dependencies: beforeDeps }),
    after: JSON.stringify({ name: "app", dependencies: deps }),
  };
}

describe("码表登记 DEC-1", () => {
  it("ERROR_CODES 含 E_PROPOSAL_PREVIOUSLY_REJECTED 与 E_GATE_SCAN_FAILED", () => {
    expect(ERROR_CODES).toContain("E_PROPOSAL_PREVIOUSLY_REJECTED");
    expect(ERROR_CODES).toContain("E_GATE_SCAN_FAILED");
  });

  it("W_* 门禁日志码不进 ERROR_CODES", () => {
    for (const w of GATE_LOG_CODES) {
      expect(ERROR_CODES).not.toContain(w);
    }
  });
});

describe("TM-GS 强弱判定", () => {
  it("TM-GS-01 U-DEP mongodb → block via direct lock user", () => {
    const r = evaluateGraveyardGate(
      baseInput({ changes: [pkgChange({ mongodb: "^6" })] }),
    );
    expect(r.block).toBe(true);
    expect(r.primary).toEqual({
      code: "E_PROPOSAL_PREVIOUSLY_REJECTED",
      rejected_id: "T-MONGO",
      lock: "user",
    });
    expect(r.hits[0]?.via).toBe("direct");
    expect(r.hits[0]?.strength).toBe("strong");
  });

  it("TM-GS-02 U-IMPORT mongodb → block", () => {
    const r = evaluateGraveyardGate(
      baseInput({
        changes: [
          {
            path: "src/db.ts",
            before: "export {};\n",
            after: 'export {};\nimport { MongoClient } from "mongodb";\n',
          },
        ],
      }),
    );
    expect(r.block).toBe(true);
    expect(r.hits[0]?.units.some((u) => u.kind === "U-IMPORT")).toBe(true);
  });

  it("TM-GS-03 U-IDENT 字符串 URL 含 mongodb → 不 block，弱警告", () => {
    const r = evaluateGraveyardGate(
      baseInput({
        changes: [
          {
            path: "src/cfg.ts",
            before: "export {};\n",
            after:
              'export {};\nconst url = "https://cloud.mongodb.com/atlas";\n',
          },
        ],
      }),
    );
    expect(r.block).toBe(false);
    expect(r.warnings).toContain("W_GRAVEYARD_WEAK_MATCH");
    expect(r.hits[0]?.strength).toBe("weak");
  });

  it("TM-GS-04 U-PATH + U-IDENT 同墓碑 → block via path+ident", () => {
    const r = evaluateGraveyardGate(
      baseInput({
        changes: [
          {
            path: "vendor/mongo-driver/client.ts",
            before: null,
            after: "export class MongoClient {}\n",
          },
        ],
      }),
    );
    expect(r.block).toBe(true);
    expect(r.hits[0]?.via).toBe("path+ident");
    expect(r.hits[0]?.strength).toBe("strong");
  });

  it("TM-GS-05 U-NL Worker log → 不 block", () => {
    const r = evaluateGraveyardGate(
      baseInput({
        texts: [{ text: "改用 MongoDB 存数据", source: "log" }],
      }),
    );
    expect(r.block).toBe(false);
    expect(r.warnings).toContain("W_GRAVEYARD_WEAK_MATCH");
    expect(r.hits[0]?.via).toBe("nl");
  });

  it("TM-GS-06 软墓碑 U-DEP graphql → 不 block，soft 警告", () => {
    const r = evaluateGraveyardGate(
      baseInput({
        graveyard: [softGraphql()],
        changes: [pkgChange({ graphql: "^16" })],
      }),
    );
    expect(r.block).toBe(false);
    expect(r.hits[0]?.lock).toBe("soft");
    expect(r.warnings).toContain("W_GRAVEYARD_WEAK_MATCH");
  });

  it("TM-GS-07 revived 墓碑 → 无命中", () => {
    const r = evaluateGraveyardGate(
      baseInput({
        graveyard: [entryOf("T-MONGO", { status: "revived" })],
        changes: [pkgChange({ mongodb: "^6" })],
      }),
    );
    expect(r.hits).toEqual([]);
    expect(r.block).toBe(false);
  });

  it("TM-GS-08 CODE_STOPLIST api → 代码通道无命中", () => {
    const r = evaluateGraveyardGate(
      baseInput({
        graveyard: [apiTomb()],
        changes: [pkgChange({ api: "^1" })],
      }),
    );
    expect(r.hits).toEqual([]);
    expect(r.block).toBe(false);
  });
});

describe("TM-GA 别名改写对抗", () => {
  it("TM-GA-01 mongoose → block via alias", () => {
    const r = evaluateGraveyardGate(
      baseInput({ changes: [pkgChange({ mongoose: "^8" })] }),
    );
    expect(r.block).toBe(true);
    expect(r.hits[0]?.via).toBe("alias");
  });

  it("TM-GA-02 npm:mongodb 别名 → block", () => {
    const r = evaluateGraveyardGate(
      baseInput({
        changes: [pkgChange({ docdb: "npm:mongodb@^6" })],
      }),
    );
    expect(r.block).toBe(true);
  });

  it("TM-GA-03 CLI npm i mongoose → block", () => {
    const r = evaluateGraveyardGate(
      baseInput({ commands: [["npm", "i", "mongoose"]] }),
    );
    expect(r.block).toBe(true);
  });

  it("TM-GA-04 pnpm add @mongodb-js/zstd → block", () => {
    const r = evaluateGraveyardGate(
      baseInput({ commands: [["pnpm", "add", "@mongodb-js/zstd"]] }),
    );
    expect(r.block).toBe(true);
  });

  it("TM-GA-05 requirements motor → block", () => {
    const r = evaluateGraveyardGate(
      baseInput({
        changes: [
          {
            path: "requirements.txt",
            before: "flask==2\n",
            after: "flask==2\nmotor==3.3\n",
          },
        ],
      }),
    );
    expect(r.block).toBe(true);
  });

  it("TM-GA-06 vendor 源码 path+ident → block", () => {
    const r = evaluateGraveyardGate(
      baseInput({
        changes: [
          {
            path: "vendor/mongo-driver/index.ts",
            before: null,
            after: "export const MongoClient = 1;\n",
          },
        ],
      }),
    );
    expect(r.block).toBe(true);
    expect(r.hits[0]?.via).toBe("path+ident");
  });

  it("TM-GA-07 已有依赖 + 变量 require → 放行", () => {
    const r = evaluateGraveyardGate(
      baseInput({
        changes: [
          pkgChange({ mongodb: "^6" }, { mongodb: "^6" }),
          {
            path: "src/x.ts",
            before: "export {};\n",
            after: 'export {};\nconst lib = name;\nconst c = require(lib);\n',
          },
        ],
      }),
    );
    // package.json 无新增 dep；require(lib) 无静态说明符
    expect(r.block).toBe(false);
  });

  it("TM-GA-08 动态拼接 require → 放行", () => {
    const r = evaluateGraveyardGate(
      baseInput({
        changes: [
          {
            path: "src/x.ts",
            before: "export {};\n",
            after:
              'export {};\nconst c = require(["mon","godb"].join(""));\n',
          },
        ],
      }),
    );
    expect(r.block).toBe(false);
  });

  it("TM-GA-09 fetch Atlas URL → 仅弱命中", () => {
    const r = evaluateGraveyardGate(
      baseInput({
        changes: [
          {
            path: "src/x.ts",
            before: "export {};\n",
            after:
              'export {};\nfetch("https://data.mongodb-api.com/v1");\n',
          },
        ],
      }),
    );
    expect(r.block).toBe(false);
    expect(r.warnings).toContain("W_GRAVEYARD_WEAK_MATCH");
  });

  it("TM-GA-10 couchdb / nano → 放行（非同一方案）", () => {
    const r = evaluateGraveyardGate(
      baseInput({ changes: [pkgChange({ couchdb: "^1", nano: "^10" })] }),
    );
    expect(r.block).toBe(false);
    expect(r.hits).toEqual([]);
  });

  it("TM-GA-11 xlsx → block via alias（T-EXCEL）", () => {
    const r = evaluateGraveyardGate(
      baseInput({
        graveyard: [entryOf("T-EXCEL")],
        changes: [pkgChange({ xlsx: "^0.18" })],
      }),
    );
    expect(r.block).toBe(true);
    expect(r.hits[0]?.via).toBe("alias");
  });

  it("TM-GA-12 exceljs → block", () => {
    const r = evaluateGraveyardGate(
      baseInput({
        graveyard: [entryOf("T-EXCEL")],
        changes: [pkgChange({ exceljs: "^4" })],
      }),
    );
    expect(r.block).toBe(true);
  });

  it("TM-GA-13 report.xls 文件名 → 仅弱命中", () => {
    const r = evaluateGraveyardGate(
      baseInput({
        graveyard: [entryOf("T-EXCEL")],
        changes: [
          {
            path: "out/report.xls",
            before: null,
            after: "a,b\n1,2\n",
          },
        ],
      }),
    );
    expect(r.block).toBe(false);
    expect(r.hits[0]?.strength).toBe("weak");
  });

  it("TM-GA-14 拼音标识符 daochuExcel → 仅弱命中", () => {
    const r = evaluateGraveyardGate(
      baseInput({
        graveyard: [entryOf("T-EXCEL")],
        changes: [
          {
            path: "src/export.ts",
            before: "export {};\n",
            after: "export function daochuExcel() { return 1; }\n",
          },
        ],
      }),
    );
    expect(r.block).toBe(false);
    expect(r.warnings).toContain("W_GRAVEYARD_WEAK_MATCH");
  });

  it("TM-GA-15 语义改写 log → 无命中", () => {
    const r = evaluateGraveyardGate(
      baseInput({
        texts: [{ text: "改用文档型数据库", source: "log" }],
      }),
    );
    expect(r.hits).toEqual([]);
  });

  it("TM-GA-16 否定式文档 → 仅弱命中不 block", () => {
    const r = evaluateGraveyardGate(
      baseInput({
        changes: [
          {
            path: "docs/decision.md",
            before: null,
            after: "我们没有选用 MongoDB 存数据\n",
          },
        ],
      }),
    );
    expect(r.block).toBe(false);
    expect(r.warnings).toContain("W_GRAVEYARD_WEAK_MATCH");
  });

  it("TM-GA-17 大小写 Mongoose → block", () => {
    const r = evaluateGraveyardGate(
      baseInput({ changes: [pkgChange({ Mongoose: "^8" })] }),
    );
    expect(r.block).toBe(true);
  });

  it("TM-GA-18 西里尔同形字 → 放行", () => {
    // м о n g o o s e — 西里尔 о (U+043E)
    const weird = "m\u043engooose";
    const r = evaluateGraveyardGate(
      baseInput({ changes: [pkgChange({ [weird]: "^8" })] }),
    );
    expect(r.block).toBe(false);
  });
});

describe("TM-GE 边界与失败关闭", () => {
  it("TM-GE-01 readDiffFiles 抛错 → E_GATE_SCAN_FAILED", () => {
    const a = assessDiffScan({ readError: true, files: [] });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.code).toBe("E_GATE_SCAN_FAILED");
  });

  it("TM-GE-02 truncatedList → E_GATE_SCAN_FAILED", () => {
    const a = assessDiffScan({ truncatedList: true, files: [] });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.code).toBe("E_GATE_SCAN_FAILED");
  });

  it("TM-GE-03 package.json 截断 → E_GATE_SCAN_FAILED", () => {
    const a = assessDiffScan({
      files: [
        {
          path: "package.json",
          before: "{}",
          after: '{"dependencies":{}}',
          truncated: true,
        },
      ],
    });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.code).toBe("E_GATE_SCAN_FAILED");
  });

  it("TM-GE-04 普通源码截断 → 只做 U-PATH + W_GATE_DIFF_TRUNCATED", () => {
    const a = assessDiffScan({
      files: [
        {
          path: "src/big.ts",
          before: null,
          after: "x".repeat(MAX_DIFF_FILE_BYTES + 10),
          truncated: true,
        },
      ],
    });
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.warnings).toContain("W_GATE_DIFF_TRUNCATED");
      const r = evaluateGraveyardGate(
        baseInput({ changes: a.changes }),
      );
      // 仅路径 vendor 不含 mongo → 无命中；这里只断言不因正文误拦
      expect(r.block).toBe(false);
    }
  });

  it("TM-GE-05 二进制 → 只做 U-PATH", () => {
    const a = assessDiffScan({
      files: [
        {
          path: "assets/logo.bin",
          before: null,
          after: "\u0000binary",
          binary: true,
        },
      ],
    });
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.changes).toEqual([
        { path: "assets/logo.bin", before: null, after: "" },
      ]);
    }
  });

  it("TM-GE-06 删除文件 → 无新增单元 / 不命中", () => {
    const a = assessDiffScan({
      files: [
        {
          path: "src/old.ts",
          before: 'import "mongodb";\n',
          after: null,
        },
      ],
    });
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.changes).toEqual([]);
      const r = evaluateGraveyardGate(baseInput({ changes: a.changes }));
      expect(r.hits).toEqual([]);
    }
  });

  it("TM-GE-07 同一墓碑第二次强命中 → 推荐放弃本轮", () => {
    const r = evaluateGraveyardGate(
      baseInput({ changes: [pkgChange({ mongodb: "^6" })] }),
    );
    expect(recommendGateCardAction(r.primary, new Set())).toBe("retry");
    expect(
      recommendGateCardAction(r.primary, new Set(["T-MONGO"])),
    ).toBe("abandon_or_revive");
  });

  it("TM-GE-08 同一输入两次调用 stableStringify 相等", () => {
    const input = baseInput({ changes: [pkgChange({ mongoose: "^8" })] });
    const a = evaluateGraveyardGate(input);
    const b = evaluateGraveyardGate(input);
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(a.hits.map((h) => h.rejected_id)).toEqual(
      [...a.hits.map((h) => h.rejected_id)].sort(),
    );
  });

  it("TM-GE-09 输入深冻结不抛错", () => {
    const input = baseInput({
      changes: [pkgChange({ mongodb: "^6" })],
      texts: [{ text: "x", source: "log" }],
    });
    const freezeDeep = (v: unknown): unknown => {
      if (v && typeof v === "object") {
        Object.freeze(v);
        for (const child of Object.values(v as object)) freezeDeep(child);
      }
      return v;
    };
    freezeDeep(input);
    let result: GateResult | undefined;
    expect(() => {
      result = evaluateGraveyardGate(input);
    }).not.toThrow();
    expect(result?.block).toBe(true);
  });

  it("legacy availability → 不拦截且不静默用墓地", () => {
    const r = evaluateGraveyardGate(
      baseInput({
        availability: "unavailable",
        changes: [pkgChange({ mongodb: "^6" })],
      }),
    );
    expect(r.block).toBe(false);
    expect(r.hits).toEqual([]);
    expect(r.warnings).toEqual(["W_GRAVEYARD_CHECK_UNAVAILABLE"]);
  });
});
