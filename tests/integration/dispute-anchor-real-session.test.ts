/**
 * TASK-J.16 · J16-P5（P-201）进程内全链路：右栏登记原话 → 冻结封存 → 签合同 → 冻结后「这里不对」。
 *
 * 真 Daemon、真 transcript、真快照、真合同，按前端同样的顺序发请求；
 * 不替代 Tina 本机真实试玩（J16-P5 的验收以真实试玩为准）。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import { buildScopePlan } from "../../daemon/supervisor/scope-plan-builder";
import type { SoftwareContract } from "../../src/lib/contract.schema";
import { buildConfirmContractFromScopePlan } from "../../src/lib/journey/confirm-scheme-contract";
import {
  EMPTY_DEMO_GATE,
  freezeScheme,
  rebuildSchemeFromCorpus,
} from "../../src/lib/journey/scheme-draft";
import { git } from "../helpers/git";
import { safeRmSync } from "../helpers/tmp";

interface SealQuote {
  turn_id: string;
  text: string;
  turn_text_sha256: string;
}

interface Body {
  error?: string;
  code?: string;
  reason?: string;
  turn_id?: string;
  turn_text_sha256?: string;
  route?: string;
  contract?: SoftwareContract;
  admission?: { contract: SoftwareContract };
  dispute_report?: {
    facts: {
      prompt: {
        seal: {
          status: string;
          bound_snapshot: boolean;
          frozen_quotes_count: number | null;
          quotes: SealQuote[];
        };
      };
    };
  };
}

interface SnapshotFile {
  digest: string;
  frozen_quotes: { quotes: SealQuote[] };
}

function sha256Utf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const REQUIREMENT = "做一个工程进度管控台，按项目汇总进度与预算，超期要预警";

describe("J16-P5 原话封存全链路（真 Daemon）", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  let base: string;
  let token: string;

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-j16p5-chain-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);
    daemon = createDaemon({
      repoRoot: repo,
      // 端口段登记：与其余套件不重叠（见 tests/unit/test-port-map.test.ts）
      startPort: 4860,
      endPort: 4869,
      enableCrashRecovery: false,
      intentCompilerSetTimeout: () => 0,
      intentCompilerClearTimeout: () => undefined,
    });
    const info = await daemon.start();
    base = `http://127.0.0.1:${info.port}`;
    token = daemon.getSessionToken() ?? "";
  });

  afterEach(async () => {
    try {
      if (daemon?.isRunning) await daemon.stop();
    } catch {
      /* 停服失败不掩盖断言失败 */
    }
    daemon = null;
    try {
      safeRmSync(repo);
    } catch {
      /* 临时目录残留不影响断言 */
    }
  });

  async function call(
    method: string,
    pathname: string,
    body?: unknown,
  ): Promise<{ status: number; body: Body }> {
    const res = await fetch(`${base}${pathname}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        connection: "close",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    return {
      status: res.status,
      body: (text.length > 0 ? JSON.parse(text) : {}) as Body,
    };
  }

  async function register(text: string) {
    const res = await call("POST", "/api/supervisor/turns", { text });
    expect(res.status).toBe(201);
    return {
      turn_id: res.body.turn_id!,
      turn_text_sha256: res.body.turn_text_sha256!,
    };
  }

  /** 与前端同一口径：语料折出启发式方案，冻结的是冻结态方案，范围按冻结态预检。 */
  function confirmInputs() {
    const scheme = rebuildSchemeFromCorpus(null, REQUIREMENT, {
      titleHint: REQUIREMENT.slice(0, 48),
    });
    const frozen = freezeScheme(scheme);
    const plan = buildScopePlan({ repoRoot: repo, scheme: frozen });
    return { scheme, frozen, plan };
  }

  const snapshotFile = (confirmationId: string) =>
    path.join(repo, ".stagent", "drafts", "schemes", `${confirmationId}.json`);

  it("登记原话→冻结封存→「这里不对」：左栏整句与 frozen_quotes 哈希一致", async () => {
    // 1. 右栏说需求：Daemon 登记原话，前端据此折进方案语料
    const requirementTurn = await register(REQUIREMENT);
    expect(requirementTurn.turn_text_sha256).toBe(sha256Utf8(REQUIREMENT));
    const { scheme, frozen, plan } = confirmInputs();

    // 2. 确认方案：冻结时封存已登记的原话
    const confirmationId = "scheme-confirm-j16p5-chain";
    const freeze = await call("POST", "/api/supervisor/scheme/freeze", {
      confirmation_id: confirmationId,
      scheme: frozen,
      demo: EMPTY_DEMO_GATE,
      decision: { code: "OK", message: "按静态方案签署", demo_mode: "none" },
      scope_plan: plan,
      source_turns: [requirementTurn],
    });
    expect(freeze.status).toBe(201);

    // 3. 签合同：合同只经 digest 绑定快照
    const created = await call("POST", "/api/contracts", {
      contract: {
        ...buildConfirmContractFromScopePlan(scheme, plan),
        lifecycle_state: "PENDING_APPROVAL",
        approval: { status: "PENDING_REVIEW" },
      },
      confirmation_id: confirmationId,
    });
    expect(created.status).toBe(201);
    const contract = created.body.admission?.contract ?? created.body.contract!;
    const snapshot = JSON.parse(
      fs.readFileSync(snapshotFile(confirmationId), "utf8"),
    ) as SnapshotFile;
    expect(contract.scheme_binding?.snapshot_digest).toBe(snapshot.digest);
    expect(snapshot.frozen_quotes.quotes).toEqual([
      expect.objectContaining({
        turn_id: requirementTurn.turn_id,
        text: REQUIREMENT,
        turn_text_sha256: sha256Utf8(REQUIREMENT),
      }),
    ]);

    // 4. 冻结后在右栏说「这里不对」：同样先登记，再带着已登记的 turn 进旅程
    const challenge = "这里不对";
    const challengeTurn = await register(challenge);
    const journey = await call("POST", "/api/supervisor/journey", {
      message: challenge,
      contract_id: contract.contract_id,
      ...challengeTurn,
    });
    expect(journey.status).toBe(200);
    expect(journey.body.route).toBe("DISPUTE");

    const seal = journey.body.dispute_report!.facts.prompt.seal;
    expect(seal.status).toBe("SEALED");
    expect(seal.bound_snapshot).toBe(true);
    expect(seal.frozen_quotes_count).toBe(1);
    const sealedHashes = new Set(
      snapshot.frozen_quotes.quotes.map((q) => q.turn_text_sha256),
    );
    for (const quote of seal.quotes) {
      expect(sha256Utf8(quote.text)).toBe(quote.turn_text_sha256);
      expect(sealedHashes.has(quote.turn_text_sha256)).toBe(true);
    }
    // 整句原话在左栏；冻结之后说的话不在封存里
    expect(seal.quotes.map((q) => q.text)).toEqual([REQUIREMENT]);
  });

  it("冻结时原话对不上：409 不写快照，带这个确认 id 也签不了合同", async () => {
    const requirementTurn = await register(REQUIREMENT);
    const { scheme, frozen, plan } = confirmInputs();
    const confirmationId = "scheme-confirm-j16p5-forged";

    const freeze = await call("POST", "/api/supervisor/scheme/freeze", {
      confirmation_id: confirmationId,
      scheme: frozen,
      demo: EMPTY_DEMO_GATE,
      decision: { code: "OK", message: "按静态方案签署", demo_mode: "none" },
      scope_plan: plan,
      source_turns: [
        {
          turn_id: requirementTurn.turn_id,
          turn_text_sha256: sha256Utf8("做一个普通的报表工具"),
        },
      ],
    });
    expect(freeze.status).toBe(409);
    expect(freeze.body.code).toBe("E_SCHEME_SNAPSHOT_MISMATCH");
    expect(freeze.body.reason).toBe("turn_hash_mismatch");
    expect(fs.existsSync(snapshotFile(confirmationId))).toBe(false);

    const created = await call("POST", "/api/contracts", {
      contract: {
        ...buildConfirmContractFromScopePlan(scheme, plan),
        lifecycle_state: "PENDING_APPROVAL",
        approval: { status: "PENDING_REVIEW" },
      },
      confirmation_id: confirmationId,
    });
    expect(created.status).toBe(409);
    expect(created.body.code).toBe("E_SCHEME_SNAPSHOT_NOT_FOUND");
  });
});
