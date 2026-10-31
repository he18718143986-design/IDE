/**
 * TM-GH：CLI PreToolUse gate pack 集合查找（TASK-J.18d / GAP-W4）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { safeRmSync } from "../helpers/tmp";
import { matchArtifactUnit } from "../../src/lib/journey/graveyard-match";
import type { GateUnit } from "../../src/lib/journey/artifact-projection";
import type { GraveyardEntry } from "../../src/lib/journey/scheme-patch-types";
import { buildGatePack } from "../../daemon/guard/worker-graveyard-gate";

const HOOK = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../daemon/worker/cli-host/pretool-hook.mjs",
);

const fixture = JSON.parse(
  fs.readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../fixtures/graveyard-match/cases.json",
    ),
    "utf8",
  ),
) as {
  tombstones: Record<
    string,
    {
      fingerprint: { key: string; lexemes: string[] };
      revival_keys: string[];
      status: "active" | "revived";
      disallow_revival: boolean;
      rejected_by: "user" | "security_gate";
    }
  >;
  code_cases: Array<{
    id: string;
    unit: string;
    text: string;
    tombstone: string;
    expect: { hit: boolean; via?: string };
  }>;
};

const tempDirs: string[] = [];

afterEach(() => {
  for (const d of tempDirs.splice(0)) {
    try {
      safeRmSync(d);
    } catch {
      /* ignore */
    }
  }
});

function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-tm-gh-"));
  tempDirs.push(dir);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  return dir;
}

function entryOf(id: string): GraveyardEntry {
  const t = fixture.tombstones[id];
  if (!t) throw new Error(`missing ${id}`);
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

function writePack(root: string, ids: string[] = ["T-MONGO"]) {
  const pack = buildGatePack(ids.map(entryOf));
  const abs = path.join(root, ".stagent", "claude-config", "graveyard-pack.json");
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
  return pack;
}

async function loadHook() {
  return import(pathToFileURL(HOOK).href) as Promise<{
    loadGatePackKeys: (mainRoot: string) =>
      | { ok: true; keys: Set<string>; byKey: Map<string, string> }
      | { ok: false; warning: "W_GATE_PACK_MISSING" };
    extractInstallPackages: (command: string) => string[];
    extractContentKeys: (filePath: string, content: string) => string[];
    evaluateGatePackHit: (
      packKeys:
        | { ok: true; keys: Set<string>; byKey: Map<string, string> }
        | { ok: false; warning: string },
      candidates: string[],
    ) =>
      | { hit: false }
      | { hit: true; rejected_id: string; key: string };
  }>;
}

function runHook(opts: {
  root: string;
  tool: string;
  toolInput: Record<string, unknown>;
  allowBash?: boolean;
}): { status: number | null; stdout: string; stderr: string; log: string } {
  const logFile = path.join(opts.root, "hook.log");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    STAGENT_HOOK_ROOT: opts.root,
    STAGENT_HOOK_LOG: logFile,
  };
  if (opts.allowBash) env.STAGENT_HOOK_ALLOW_BASH = "1";
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      tool_name: opts.tool,
      tool_input: opts.toolInput,
    }),
    encoding: "utf8",
    env,
    cwd: opts.root,
  });
  const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    log,
  };
}

describe("TM-GH CLI hook graveyard pack", () => {
  it("TM-GH-01 Bash npm install mongoose + pack T-MONGO → deny", async () => {
    const root = makeRoot();
    writePack(root, ["T-MONGO"]);
    const r = runHook({
      root,
      tool: "Bash",
      toolInput: { command: "npm install mongoose" },
      allowBash: true,
    });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('"permissionDecision":"deny"');
    expect(r.log).toContain("E_PROPOSAL_PREVIOUSLY_REJECTED");
  });

  it("TM-GH-02 Write package.json 新增 mongoose → deny", () => {
    const root = makeRoot();
    writePack(root, ["T-MONGO"]);
    const content = JSON.stringify(
      { name: "app", dependencies: { mongoose: "^8.0.0" } },
      null,
      2,
    );
    const r = runHook({
      root,
      tool: "Write",
      toolInput: {
        file_path: path.join(root, "package.json"),
        content,
      },
    });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('"permissionDecision":"deny"');
    expect(r.log).toContain("E_PROPOSAL_PREVIOUSLY_REJECTED");
  });

  it("TM-GH-03 Edit .ts import mongoose → deny", () => {
    const root = makeRoot();
    writePack(root, ["T-MONGO"]);
    const file = path.join(root, "src", "db.ts");
    fs.writeFileSync(file, "export {};\n", "utf8");
    const r = runHook({
      root,
      tool: "Edit",
      toolInput: {
        file_path: file,
        old_string: "export {};\n",
        new_string: 'import mongoose from "mongoose";\nexport {};\n',
      },
    });
    expect(r.status).toBe(2);
    expect(r.log).toContain("E_PROPOSAL_PREVIOUSLY_REJECTED");
  });

  it("TM-GH-04 pack 缺失 → allow + W_GATE_PACK_MISSING", () => {
    const root = makeRoot();
    const r = runHook({
      root,
      tool: "Bash",
      toolInput: { command: "npm install mongoose" },
      allowBash: true,
    });
    expect(r.status).toBe(0);
    expect(r.log).toContain("W_GATE_PACK_MISSING");
    expect(r.log).toContain('"decision":"allow"');
  });

  it("TM-GH-05 pack JSON 损坏 → allow + W_GATE_PACK_MISSING", async () => {
    const root = makeRoot();
    const abs = path.join(root, ".stagent", "claude-config", "graveyard-pack.json");
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "{not-json", "utf8");
    const hook = await loadHook();
    const loaded = hook.loadGatePackKeys(root);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.warning).toBe("W_GATE_PACK_MISSING");

    const r = runHook({
      root,
      tool: "Write",
      toolInput: {
        file_path: path.join(root, "package.json"),
        content: JSON.stringify({ dependencies: { mongoose: "1" } }),
      },
    });
    expect(r.status).toBe(0);
    expect(r.log).toContain("W_GATE_PACK_MISSING");
  });

  it("TM-GH-06 code_cases U-DEP/U-CMD 与 matchArtifactUnit 一致", async () => {
    const hook = await loadHook();
    const cases = fixture.code_cases.filter(
      (c) => c.unit === "U-DEP" || c.unit === "U-CMD",
    );
    expect(cases.length).toBeGreaterThan(0);

    for (const c of cases) {
      const entry = entryOf(c.tombstone);
      const unit: GateUnit = {
        kind: c.unit as GateUnit["kind"],
        text: c.text,
        source: "change",
      };
      const tsHit = matchArtifactUnit(unit, entry);
      expect(Boolean(tsHit), c.id).toBe(c.expect.hit);

      const root = makeRoot();
      writePack(root, [c.tombstone]);
      const pack = hook.loadGatePackKeys(root);
      expect(pack.ok, c.id).toBe(true);
      if (!pack.ok) continue;

      const candidates =
        c.unit === "U-CMD"
          ? hook.extractInstallPackages(`npm install ${c.text}`)
          : hook.extractContentKeys(
              "package.json",
              JSON.stringify({ dependencies: { [c.text]: "^1.0.0" } }),
            );
      const hookHit = hook.evaluateGatePackHit(pack, candidates);
      expect(hookHit.hit, `${c.id} hook`).toBe(c.expect.hit);
      if (c.expect.hit && hookHit.hit) {
        expect(hookHit.rejected_id).toBe(c.tombstone);
      }
    }
  });
});
