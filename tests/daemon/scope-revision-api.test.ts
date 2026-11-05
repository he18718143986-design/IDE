import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import { ContractStore } from "../../daemon/pipeline/contract-store";
import {
  createContractDraft,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import { safeRmSync } from "../helpers/tmp";
import { git } from "../helpers/git";

/**
 * TASK-C.4 返工：POST /api/contracts/:id/scope-revision 的 HTTP 语义。
 * 已批准且处于 PREPARING 的合同派生新 Revision（200，落盘经 transition）；
 * 执行中 / 审计后等非法派生 → 409 + E_SCOPE_CHANGE_FORBIDDEN，磁盘不变。
 */
describe("TASK-C.4 scope-revision API：Fail-Closed 与经 transition 落盘", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  let base: string;
  let token: string;
  let store: ContractStore;

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-c4-scope-api-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);

    store = new ContractStore(repo);
    daemon = createDaemon({
      repoRoot: repo,
      startPort: 4831,
      endPort: 4840,
      enableCrashRecovery: false,
    });
    const info = await daemon.start();
    base = `http://127.0.0.1:${info.port}`;
    token = daemon.getSessionToken() ?? "";
  });

  afterEach(async () => {
    if (daemon?.isRunning) await daemon.stop();
    daemon = null;
    safeRmSync(repo);
  });

  const auth = () => ({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    connection: "close",
  });

  function persist(
    lifecycle: SoftwareContract["lifecycle_state"],
    approvedRevision = 1,
  ): SoftwareContract {
    const draft = createContractDraft({
      title: "scope api",
      description: "C.4 scope-revision HTTP",
      acceptanceCriteria: ["ok"],
      writablePaths: ["src/a.ts"],
    });
    return store.save({
      ...draft,
      lifecycle_state: lifecycle,
      contract_revision: approvedRevision,
      approval: {
        status: "APPROVED",
        approved_by: "boss@test.com",
        approved_at: new Date().toISOString(),
        approved_revision: approvedRevision,
      },
    });
  }

  it("PREPARING 已批准合同：派生新 Revision（200），磁盘为 PENDING_APPROVAL / 新 revision，旧审批清空", async () => {
    const c = persist("PREPARING");
    const res = await fetch(
      `${base}/api/contracts/${c.contract_id}/scope-revision`,
      {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ writable_paths: ["src/a.ts", "src/b.ts"] }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string; new_revision: number };
    expect(body.mode).toBe("derive_revision");
    expect(body.new_revision).toBe(2);

    const onDisk = store.get(c.contract_id);
    expect(onDisk?.lifecycle_state).toBe("PENDING_APPROVAL");
    expect(onDisk?.approval.status).toBe("PENDING_REVIEW");
    expect(onDisk?.approval).not.toHaveProperty("approved_revision");
    expect(onDisk?.contract_revision).toBe(2);
  });

  it("EXECUTING 执行中合同：拒绝（409 + E_SCOPE_CHANGE_FORBIDDEN），磁盘不变", async () => {
    const c = persist("EXECUTING");
    const before = JSON.stringify(store.get(c.contract_id));
    const res = await fetch(
      `${base}/api/contracts/${c.contract_id}/scope-revision`,
      {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ writable_paths: ["src/a.ts", "src/b.ts"] }),
      },
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe(
      "E_SCOPE_CHANGE_FORBIDDEN",
    );
    expect(JSON.stringify(store.get(c.contract_id))).toBe(before);
  });

  it("AUDITED 已批准合同：AUDITED → PENDING_APPROVAL 非法，拒绝（409），磁盘不变", async () => {
    const c = persist("AUDITED", 3);
    const before = JSON.stringify(store.get(c.contract_id));
    const res = await fetch(
      `${base}/api/contracts/${c.contract_id}/scope-revision`,
      {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ writable_paths: ["src/a.ts", "src/b.ts"] }),
      },
    );
    expect(res.status).toBe(409);
    expect(JSON.stringify(store.get(c.contract_id))).toBe(before);
  });
});
