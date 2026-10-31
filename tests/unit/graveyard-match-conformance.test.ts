/**
 * TM-GM：G-MATCH 单一语义源一致性（TASK-J.18a）。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  dice,
  GRAVEYARD_DICE_THRESHOLD,
  matchArtifactUnit,
  matchesTombstoneText,
  matchNormalize,
  lexemes,
} from "../../src/lib/journey/graveyard-match";
import { matchesTombstone } from "../../src/lib/journey/graveyard-revival";
import type { GraveyardEntry } from "../../src/lib/journey/scheme-patch-types";
import type {
  GateUnit,
  GateUnitKind,
} from "../../src/lib/journey/artifact-projection";
import { ALIAS_LEXICON_VERSION } from "../../src/lib/journey/artifact-alias-lexicon";

type FixtureTomb = {
  fingerprint: { key: string; lexemes: string[] };
  revival_keys: string[];
  status: "active" | "revived";
  disallow_revival: boolean;
  rejected_by: "user" | "security_gate";
};

type NlCase = {
  id: string;
  text: string;
  tombstone: string;
  expect: { b: boolean; c: boolean; d: boolean };
};

type CodeCase = {
  id: string;
  unit: GateUnitKind;
  text: string;
  tombstone: string;
  expect: { hit: boolean; via?: string };
};

type Fixture = {
  version: number;
  alias_lexicon_version: number;
  tombstones: Record<string, FixtureTomb>;
  nl_cases: NlCase[];
  code_cases: CodeCase[];
};

const fixturePath = path.resolve(
  __dirname,
  "../fixtures/graveyard-match/cases.json",
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;

function toEntry(id: string, t: FixtureTomb): GraveyardEntry {
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
  };
}

function entryOf(id: string): GraveyardEntry {
  const t = fixture.tombstones[id];
  if (!t) throw new Error(`missing tombstone ${id}`);
  return toEntry(id, t);
}

describe("TM-GM G-MATCH conformance", () => {
  it("夹具 version / alias_lexicon_version 对齐", () => {
    expect(fixture.version).toBe(1);
    expect(fixture.alias_lexicon_version).toBe(ALIAS_LEXICON_VERSION);
  });

  it("TM-GM-01 nl_cases：引擎 matchesTombstone 与门禁 matchesTombstoneText (b)(c)(d) 逐位相等", () => {
    for (const c of fixture.nl_cases) {
      const entry = entryOf(c.tombstone);
      const gate = matchesTombstoneText(c.text, entry);
      const engine = matchesTombstone({ texts: [c.text] }, entry);
      expect(gate.b, `${c.id} b`).toBe(engine.via.includes("b"));
      expect(gate.c, `${c.id} c`).toBe(engine.via.includes("c"));
      expect(gate.d, `${c.id} d`).toBe(engine.via.includes("d"));
      expect(gate.b, `${c.id} expect.b`).toBe(c.expect.b);
      expect(gate.c, `${c.id} expect.c`).toBe(c.expect.c);
      expect(gate.d, `${c.id} expect.d`).toBe(c.expect.d);
    }
  });

  it("TM-GM-02 「用 MongoDB 存数据」vs T-MONGO → b/c/d 全真", () => {
    const m = matchesTombstoneText("用 MongoDB 存数据", entryOf("T-MONGO"));
    expect(m).toMatchObject({ b: true, c: true, d: true });
    expect(matchNormalize("用 MongoDB 存数据")).toBe("用mongodb存数据");
  });

  it("TM-GM-03 「MongoDB 存储」vs T-MONGO → 全假", () => {
    const m = matchesTombstoneText("MongoDB 存储", entryOf("T-MONGO"));
    expect(m).toMatchObject({ b: false, c: false, d: false });
  });

  it("TM-GM-04 Dice 恰为阈值 / 低于阈值", () => {
    // 2*3/(4+4)=0.75
    expect(dice(["a", "b", "c", "d"], ["a", "b", "c", "x"])).toBe(
      GRAVEYARD_DICE_THRESHOLD,
    );
    expect(GRAVEYARD_DICE_THRESHOLD).toBe(0.75);
    // 2*37/(50+50)=0.74
    const left = Array.from({ length: 50 }, (_, i) => `L${i}`);
    const right = [
      ...left.slice(0, 37),
      ...Array.from({ length: 13 }, (_, i) => `R${i}`),
    ];
    expect(dice(left, right)).toBe(0.74);
    expect(0.74).toBeLessThan(GRAVEYARD_DICE_THRESHOLD);
  });

  it("TM-GM-05 revival_keys 含 3 字素 key → d 假", () => {
    const m = matchesTombstoneText("我们需要存数据能力", entryOf("T-SHORTKEY"));
    expect(m.d).toBe(false);
    // 对照：同文若 key 够长则会 d 真——此处仅断言短 key 不触发
    expect(entryOf("T-SHORTKEY").revival_keys.some((k) => k === "存数据")).toBe(
      true,
    );
  });

  it("TM-GM-06 夹具 fingerprint.lexemes 与 matchNormalize/lexemes 投影一致（改阈值必挂）", () => {
    const entry = entryOf("T-MONGO");
    expect(lexemes("用 MongoDB 存数据")).toEqual(entry.fingerprint.lexemes);
    expect(matchNormalize("用 MongoDB 存数据")).toBe(entry.fingerprint.key);
  });

  it("TM-GM-07 源码扫描：graveyard-match.ts 之外不得出现墓地阈值字面量 0.75", () => {
    const root = path.resolve(__dirname, "../../src");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) {
          walk(full);
          continue;
        }
        if (!name.endsWith(".ts")) continue;
        if (name === "graveyard-match.ts") continue;
        const raw = readFileSync(full, "utf8");
        const stripped = raw
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/.*$/gm, "");
        if (/\b0\.75\b/.test(stripped))
          offenders.push(path.relative(root, full));
      }
    };
    walk(root);
    expect(offenders, `0.75 literal in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("code_cases：matchArtifactUnit 与夹具 expect 一致", () => {
    for (const c of fixture.code_cases) {
      const unit: GateUnit = {
        kind: c.unit,
        text: c.text,
        source: "change",
      };
      const hit = matchArtifactUnit(unit, entryOf(c.tombstone));
      if (c.expect.hit) {
        expect(hit, c.id).not.toBeNull();
        if (c.expect.via) expect(hit!.via).toBe(c.expect.via);
      } else {
        expect(hit, c.id).toBeNull();
      }
    }
  });
});
