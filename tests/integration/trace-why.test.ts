/**
 * TASK-L.13：追踪链 Trailer + explainLine + GET /api/trace/why
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { safeRmSync } from "../helpers/tmp";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import {
  buildMergeCommitMessage,
  ensureChangelogSchemeItemIds,
  MAX_TRAILER_LINE_BYTES,
  measureTrailerBounds,
  resolveSchemeItemsTrailerValue,
  assertTrailerBounds,
} from "../../daemon/pipeline/merger";
import {
  explainLine,
  TraceBrokenError,
  E_TRACE_BROKEN,
} from "../../daemon/trace/why";
import { ContractStore } from "../../daemon/pipeline/contract-store";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import {
  casWriteSchemeLedger,
  emptyLedgerState,
  emptySchemeDraftV2,
} from "../../daemon/supervisor/intent-compiler/scheme-ledger-store";
import type { EvidenceBundle } from "../../src/lib/evidence.schema";
import { ERROR_CODES, ERROR_CODE_CATALOG } from "../../src/lib/error-codes";

function git(repo: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
  }).trim();
}

function requestJson<T>(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; body: T }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: init.method ?? "GET",
        headers: init.headers ?? {},
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let body: T;
          try {
            body = raw ? (JSON.parse(raw) as T) : ({} as T);
          } catch {
            body = raw as unknown as T;
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function baseEvidence(contractId: string, evidenceId: string): EvidenceBundle {
  return {
    evidence_id: evidenceId,
    contract_id: contractId,
    generated_at: new Date().toISOString(),
    usage: {
      currency: "CNY",
      pricing_version: "v1",
      accounting_mode: "UNAVAILABLE",
      limit_reached: false,
    },
    worktree_snapshot: {
      head_sha: "a",
      snapshot_fingerprint: "b",
      captured_at: new Date().toISOString(),
    },
    verdict: { status: "PASSED", can_merge: true, summary: "ok" },
    scope_audit: {
      passed: true,
      files_changed: [],
      forbidden_violations: [],
      budget_exhausted: false,
    },
    verification_results: [],
    git_info: {
      base_commit_sha: "a",
      task_commit_sha: "b",
      diff_stat: "",
      patch_fingerprint: "c",
    },
  };
}

function makeContract(opts: {
  title: string;
  schemeItemIds: string[];
  acceptanceText?: string;
}): SoftwareContract {
  const draft = createContractDraft({
    title: opts.title,
    description: "l13",
    acceptanceCriteria: ["pass"],
    writablePaths: ["src/**", "docs/system/**"],
    commands: [
      {
        alias: "verify",
        executable: "node",
        args: ["-e", "process.exit(0)"],
        expected_exit_code: 0,
        timeout_seconds: 30,
      },
    ],
  });
  return softwareContractSchema.parse({
    ...draft,
    lifecycle_state: "PENDING_APPROVAL",
    approval: { status: "PENDING_REVIEW" },
    supervisor_metadata: {
      suggestion_id: "sug-l13",
      scheme_item_ids: opts.schemeItemIds,
      acceptance_refs: [
        {
          id: opts.schemeItemIds[0] ?? "acc-1",
          text: opts.acceptanceText ?? "用户要能看见追踪",
          check: "playtest",
        },
      ],
    },
  });
}

function plantLedger(
  repo: string,
  itemId: string,
  quote: string,
  turnId = "q1",
): void {
  const draft = emptySchemeDraftV2({
    scheme_id: "scheme-l13",
    scheme_revision: 1,
    frozen: true,
    title: "L13",
    goals: [
      {
        id: itemId,
        text: "把追踪链接到编辑器",
        source: "user_said",
        evidence: [
          {
            kind: "turn",
            ref: { turn_id: turnId, quote },
          },
        ],
        user_pinned: false,
        updated_in_revision: 1,
      },
    ],
  });
  const next = emptyLedgerState({ draft });
  const written = casWriteSchemeLedger(repo, {
    expectedPrevRevision: 0,
    next,
    journal: null,
    modelId: null,
    promptVersion: null,
    offline: true,
  });
  if (!written.ok) throw new Error(`ledger write failed: ${written.reason}`);
}

describe("TASK-L.13 trace why", () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l13-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, "src", "legacy.ts"),
      "export const legacy = 1;\n",
    );
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init without stagent trailer"]);
  });

  afterEach(() => {
    safeRmSync(repo);
  });

  it("E_TRACE_BROKEN 已登记", () => {
    expect(ERROR_CODES).toContain(E_TRACE_BROKEN);
    expect(ERROR_CODE_CATALOG.E_TRACE_BROKEN.task).toBe("TASK-L.13");
  });

  it("超长 scheme_item_ids 时 Trailer 单行 ≤512B 且截断为合同号", () => {
    const ids = Array.from({ length: 80 }, (_, i) => `goal-very-long-id-${i}`);
    const contract = makeContract({
      title: "truncate",
      schemeItemIds: ids,
    });
    const resolved = resolveSchemeItemsTrailerValue(
      contract.contract_id,
      ids,
    );
    expect(resolved.truncated).toBe(true);
    expect(resolved.value).toBe(contract.contract_id);

    const message = buildMergeCommitMessage(
      contract,
      baseEvidence(contract.contract_id, "evi_trunc"),
      "tina",
    );
    const schemeLine = message
      .split("\n")
      .find((l) => l.startsWith("Stagent-Scheme-Items:"));
    expect(schemeLine).toBe(
      `Stagent-Scheme-Items: ${contract.contract_id}`,
    );
    expect(Buffer.byteLength(schemeLine!, "utf-8")).toBeLessThanOrEqual(
      MAX_TRAILER_LINE_BYTES,
    );
    expect(() => assertTrailerBounds(message)).not.toThrow();
    const bounds = measureTrailerBounds(message);
    expect(bounds.maxLineBytes).toBeLessThanOrEqual(MAX_TRAILER_LINE_BYTES);

    const rel = ensureChangelogSchemeItemIds(
      repo,
      contract.contract_id,
      resolved.fullIds,
    );
    const cl = fs.readFileSync(path.join(repo, rel), "utf8");
    expect(cl).toContain(`## ${contract.contract_id}`);
    expect(cl).toContain(ids[0]!);
    expect(cl).toContain(ids[ids.length - 1]!);
  });

  it("合入行 explainLine 返回原话；合入前行断在提交无 Stagent Trailer", async () => {
    const quote = "我想右键问这段代码为什么存在";
    const itemId = "goal-trace-1";
    const contract = makeContract({
      title: "trace happy",
      schemeItemIds: [itemId],
    });
    const store = new ContractStore(repo);
    store.save(contract);
    plantLedger(repo, itemId, quote);

    // 手工构造带 Stagent Trailer 的合入提交（覆盖新增行）
    fs.writeFileSync(
      path.join(repo, "src", "feature.ts"),
      "export const feature = 42;\n",
    );
    git(repo, ["add", "src/feature.ts"]);
    const message = buildMergeCommitMessage(
      contract,
      baseEvidence(contract.contract_id, "evi_happy"),
      "tina",
      null,
      { evidenceHash: "a".repeat(64) },
    );
    expect(message).toContain(`Stagent-Scheme-Items: ${itemId}`);
    // 多行 -m 用文件更稳
    const msgFile = path.join(repo, ".stagent-commit-msg");
    fs.mkdirSync(path.join(repo, ".stagent"), { recursive: true });
    fs.writeFileSync(msgFile, message);
    git(repo, ["commit", "-q", "-F", msgFile]);
    fs.unlinkSync(msgFile);

    const explained = await explainLine({
      repoRoot: repo,
      path: "src/feature.ts",
      line: 1,
    });
    expect(explained.contract_id).toBe(contract.contract_id);
    expect(explained.scheme_items).toHaveLength(1);
    expect(explained.scheme_items[0]!.id).toBe(itemId);
    expect(explained.scheme_items[0]!.quotes[0]!.text).toBe(quote);
    expect(explained.scheme_items[0]!.quotes[0]!.qid).toBe("q1");

    await expect(
      explainLine({ repoRoot: repo, path: "src/legacy.ts", line: 1 }),
    ).rejects.toMatchObject({
      code: E_TRACE_BROKEN,
      ring: "提交无 Stagent Trailer",
    });

    try {
      await explainLine({ repoRoot: repo, path: "src/legacy.ts", line: 1 });
      throw new Error("expected TraceBrokenError");
    } catch (err) {
      expect(err).toBeInstanceOf(TraceBrokenError);
      expect((err as TraceBrokenError).message).toContain("提交无 Stagent Trailer");
    }
  });

  it("截断 Trailer 时仍能经合同 metadata + changelog 反查原话", async () => {
    const quote = "条目太多也要能追到原话";
    const ids = Array.from({ length: 60 }, (_, i) => `goal-pad-${i}-xxxxxxxx`);
    ids[0] = "goal-real";
    const contract = makeContract({
      title: "trunc resolve",
      schemeItemIds: ids,
    });
    // 账本只种真实条目；其余 id 会被 explain 在「方案条目」环失败——
    // 截断场景下我们只保留可解析的子集到 metadata 供反查？规格是全量进 changelog，
    // explain 用 metadata 全量。为测通：账本为 goal-real 提供证据，其余用同 quote 种子。
    const draft = emptySchemeDraftV2({
      scheme_id: "scheme-l13-trunc",
      scheme_revision: 1,
      frozen: true,
      goals: ids.map((id) => ({
        id,
        text: `条目 ${id}`,
        source: "user_said" as const,
        evidence: [
          {
            kind: "turn" as const,
            ref: { turn_id: `turn-${id}`, quote },
          },
        ],
        user_pinned: false,
        updated_in_revision: 1,
      })),
    });
    casWriteSchemeLedger(repo, {
      expectedPrevRevision: 0,
      next: emptyLedgerState({ draft }),
      journal: null,
      modelId: null,
      promptVersion: null,
      offline: true,
    });
    const store = new ContractStore(repo);
    store.save(contract);
    ensureChangelogSchemeItemIds(repo, contract.contract_id, ids);

    const resolved = resolveSchemeItemsTrailerValue(contract.contract_id, ids);
    expect(resolved.truncated).toBe(true);

    fs.writeFileSync(
      path.join(repo, "src", "wide.ts"),
      "export const wide = true;\n",
    );
    git(repo, ["add", "src/wide.ts", "docs/system/changelog.md"]);
    const message = buildMergeCommitMessage(
      contract,
      baseEvidence(contract.contract_id, "evi_wide"),
      "tina",
    );
    expect(message).toContain(
      `Stagent-Scheme-Items: ${contract.contract_id}`,
    );
    const msgFile = path.join(repo, ".git", "STAGENT_MSG");
    fs.writeFileSync(msgFile, message);
    git(repo, ["commit", "-q", "-F", msgFile]);

    const explained = await explainLine({
      repoRoot: repo,
      path: "src/wide.ts",
      line: 1,
    });
    expect(explained.scheme_items_trailer_truncated).toBe(true);
    expect(explained.scheme_items.length).toBe(ids.length);
    expect(explained.scheme_items[0]!.quotes[0]!.text).toBe(quote);
  });
});

describe("TASK-L.13 GET /api/trace/why", () => {
  let repoRoot: string;
  let daemon: StagentDaemon;
  let baseUrl: string;
  let token: string;

  beforeEach(async () => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l13-http-"));
    git(repoRoot, ["init", "-q", "-b", "main"]);
    git(repoRoot, ["config", "user.email", "t@example.com"]);
    git(repoRoot, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "src", "a.ts"), "export const a = 1;\n");
    git(repoRoot, ["add", "."]);
    git(repoRoot, ["commit", "-q", "-m", "init"]);

    const quote = "HTTP 也能反查";
    const itemId = "goal-http";
    const contract = makeContract({
      title: "http",
      schemeItemIds: [itemId],
    });
    new ContractStore(repoRoot).save(contract);
    plantLedger(repoRoot, itemId, quote);

    fs.writeFileSync(
      path.join(repoRoot, "src", "b.ts"),
      "export const b = 2;\n",
    );
    git(repoRoot, ["add", "src/b.ts"]);
    const message = buildMergeCommitMessage(
      contract,
      baseEvidence(contract.contract_id, "evi_http"),
      "tina",
    );
    const msgFile = path.join(repoRoot, ".git", "MSG");
    fs.writeFileSync(msgFile, message);
    git(repoRoot, ["commit", "-q", "-F", msgFile]);

    daemon = createDaemon({
      repoRoot,
      startPort: 3891,
      endPort: 3920,
      consolePublicDir: null,
    });
    const info = await daemon.start();
    baseUrl = `http://127.0.0.1:${info.port}`;
    token = daemon.getSessionToken()!;
  });

  afterEach(async () => {
    await daemon.stop();
    safeRmSync(repoRoot);
  });

  it("200 返回原话；无 Trailer 行 404 E_TRACE_BROKEN", async () => {
    const ok = await requestJson<{
      contract_id: string;
      scheme_items: { quotes: { text: string }[] }[];
    }>(`${baseUrl}/api/trace/why?path=src%2Fb.ts&line=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.scheme_items[0]!.quotes[0]!.text).toBe("HTTP 也能反查");

    const broken = await requestJson<{
      code?: string;
      ring?: string;
    }>(`${baseUrl}/api/trace/why?path=src%2Fa.ts&line=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(broken.status).toBe(404);
    expect(broken.body.code).toBe(E_TRACE_BROKEN);
    expect(broken.body.ring).toBe("提交无 Stagent Trailer");
  });
});
