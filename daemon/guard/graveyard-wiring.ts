/**
 * TASK-J.18d：墓地门禁生产接线辅助（派工落 pack、diff 全量扫描、白话段）。
 * 纯编排层：复用 J.18c 的 verifyDispatchBinding / evaluateGraveyardGate / assessDiffScan。
 */
import fs from "node:fs";
import path from "node:path";
import type { SoftwareContract } from "../../src/lib/contract.schema";
import type { ArtifactChange } from "../../src/lib/journey/artifact-projection";
import type { GraveyardEntry } from "../../src/lib/journey/scheme-patch-types";
import { readDiffFiles, type DiffFilesResult } from "../diff/diff-files";
import {
  GATE_PACK_RELATIVE_PATH,
  verifyDispatchBinding,
  type DispatchBindingResult,
} from "./dispatch-binding";
import {
  assessDiffScan,
  evaluateGraveyardGate,
  type DiffScanFile,
  type GatePack,
  type GateResult,
  type GateWarningCode,
} from "./worker-graveyard-gate";

export type GraveyardGateContext =
  | {
      availability: "snapshot";
      graveyard: GraveyardEntry[];
      pack: GatePack;
      mode: "bound";
    }
  | {
      availability: "unavailable";
      graveyard: GraveyardEntry[];
      pack: null;
      mode: "legacy";
    };

export type DispatchGateOutcome =
  | { ok: true; context: GraveyardGateContext }
  | {
      ok: false;
      code: "E_SCHEME_SNAPSHOT_NOT_FOUND" | "E_SCHEME_SNAPSHOT_MISMATCH";
      message: string;
    };

/** 派工前：校验绑定 → 写 gate pack（bound）→ 返回施工期上下文。 */
export async function prepareDispatchGate(
  repoRoot: string,
  contract: SoftwareContract,
): Promise<DispatchGateOutcome> {
  const binding = await verifyDispatchBinding(repoRoot, contract);
  if (!binding.ok) {
    return { ok: false, code: binding.code, message: binding.message };
  }
  if (binding.mode === "legacy") {
    return {
      ok: true,
      context: {
        availability: "unavailable",
        graveyard: [],
        pack: null,
        mode: "legacy",
      },
    };
  }
  writeGatePackFile(repoRoot, binding.pack);
  return {
    ok: true,
    context: {
      availability: "snapshot",
      graveyard: binding.graveyard,
      pack: binding.pack,
      mode: "bound",
    },
  };
}

export function writeGatePackFile(repoRoot: string, pack: GatePack): string {
  const abs = path.join(repoRoot, GATE_PACK_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, abs);
  return abs;
}

export function contextFromBinding(
  binding: DispatchBindingResult,
): GraveyardGateContext | null {
  if (!binding.ok) return null;
  if (binding.mode === "legacy") {
    return {
      availability: "unavailable",
      graveyard: [],
      pack: null,
      mode: "legacy",
    };
  }
  return {
    availability: "snapshot",
    graveyard: binding.graveyard,
    pack: binding.pack,
    mode: "bound",
  };
}

/**
 * GAP-W3：注入「用户否决过的方案」白话段。
 * 只列 proposal / rejection_reason；绝不列 artifact_keys / rejected_id。
 * 仅 active 且 disallow_revival 的硬墓碑。
 */
export function renderRejectedProposalsSection(
  graveyard: readonly GraveyardEntry[],
): { title: string; body: string } | null {
  const lines: string[] = [];
  for (const entry of graveyard) {
    if (entry.status !== "active") continue;
    if (!entry.disallow_revival) continue;
    const proposal = entry.proposal.trim();
    const reason = entry.rejection_reason.trim();
    if (!proposal) continue;
    lines.push(
      reason
        ? `- ${proposal}（否决理由：${reason}）`
        : `- ${proposal}`,
    );
  }
  if (lines.length === 0) return null;
  return {
    title: "用户否决过的方案",
    body: [
      "以下方案用户已经明确否决，施工中不得再引入同等方案：",
      ...lines,
    ].join("\n"),
  };
}

/** WorkerChange[] → ArtifactChange[]（读盘取 before）。 */
export function artifactChangesFromProposedWrites(
  worktreeRoot: string,
  changes: readonly { path: string; content: string }[],
): ArtifactChange[] {
  const out: ArtifactChange[] = [];
  for (const change of changes) {
    const abs = path.join(worktreeRoot, change.path);
    let before: string | null = null;
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        before = fs.readFileSync(abs, "utf8");
      }
    } catch {
      before = null;
    }
    out.push({ path: change.path, before, after: change.content });
  }
  return out;
}

/** 单文件写：供 gateway.handleWriteFile 使用。 */
export function artifactChangeForWrite(
  worktreeRoot: string,
  relativePath: string,
  content: string,
): ArtifactChange {
  const abs = path.join(worktreeRoot, relativePath);
  let before: string | null = null;
  try {
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      before = fs.readFileSync(abs, "utf8");
    }
  } catch {
    before = null;
  }
  return { path: relativePath, before, after: content };
}

export function toDiffScanFiles(result: DiffFilesResult): DiffScanFile[] {
  return result.files.map((f) => {
    if (f.binary) {
      return {
        path: f.path,
        before: f.status === "added" ? null : f.before || null,
        after: f.status === "deleted" ? null : f.after || "",
        binary: true,
        truncated: f.truncated,
      };
    }
    if (f.status === "deleted") {
      return {
        path: f.path,
        before: f.before || "",
        after: null,
        truncated: f.truncated,
      };
    }
    if (f.status === "added") {
      return {
        path: f.path,
        before: null,
        after: f.after,
        truncated: f.truncated,
      };
    }
    return {
      path: f.path,
      before: f.before,
      after: f.after,
      truncated: f.truncated,
    };
  });
}

export type WorktreeGraveyardScan =
  | {
      ok: false;
      code: "E_GATE_SCAN_FAILED";
      reason: string;
    }
  | {
      ok: true;
      gate: GateResult;
      warnings: GateWarningCode[];
    };

/**
 * POST_VERIFICATION / PRE_MERGE 全量扫描。
 * 读失败或 assessDiffScan 失败 → E_GATE_SCAN_FAILED。
 */
export async function scanWorktreeGraveyard(input: {
  worktreePath: string;
  baseBranch: string;
  context: GraveyardGateContext;
  texts?: readonly { text: string; source: "change" | "log" | "commit" }[];
  commands?: readonly (readonly string[])[];
}): Promise<WorktreeGraveyardScan> {
  let diff: DiffFilesResult;
  try {
    diff = await readDiffFiles(input.worktreePath, input.baseBranch);
  } catch (err) {
    return {
      ok: false,
      code: "E_GATE_SCAN_FAILED",
      reason: `readDiffFiles 失败：${(err as Error).message}`,
    };
  }

  const assessed = assessDiffScan({
    truncatedList: diff.truncatedList,
    files: toDiffScanFiles(diff),
  });
  if (!assessed.ok) {
    return {
      ok: false,
      code: assessed.code,
      reason: assessed.reason,
    };
  }

  const gate = evaluateGraveyardGate({
    graveyard: input.context.graveyard,
    changes: assessed.changes,
    commands: input.commands ?? [],
    texts: input.texts ?? [],
    availability: input.context.availability,
  });

  const warnings = [
    ...new Set<GateWarningCode>([...assessed.warnings, ...gate.warnings]),
  ];
  return { ok: true, gate: { ...gate, warnings }, warnings };
}

/** evidence.forbidden_violations 条目：`graveyard:<rejected_id>` */
export function graveyardViolationTags(
  gate: GateResult,
): string[] {
  if (!gate.block || !gate.primary) return [];
  return [`graveyard:${gate.primary.rejected_id}`];
}

export function graveyardBlockMessage(gate: GateResult): string {
  const id = gate.primary?.rejected_id ?? "unknown";
  const lock = gate.primary?.lock ?? "user";
  return (
    `[E_PROPOSAL_PREVIOUSLY_REJECTED] 施工触及用户否决过的方案` +
    `（${id}，lock=${lock}）；隔离区未写入该批改动`
  );
}

/**
 * TM-GI-03 / §5.1「我改主意了」：右栏预填文案（不发送）。
 * 施工期无复活捷径——仅预填，墓碑保持 active，直至用户亲口发出并由引擎判定。
 */
export function buildRevivalPrefillMessage(proposal: string): string {
  const p = proposal.trim();
  return p ? `我想恢复：${p}` : "我想恢复：";
}
