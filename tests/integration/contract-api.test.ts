import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";
import { git } from "../helpers/git";

describe("M5 / 合同 HTTP API（Bearer 保护）", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  let base: string;
  let token: string;

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-m5-api-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);

    daemon = createDaemon({
      repoRoot: repo,
      startPort: 3680,
      endPort: 3685,
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
    // 避免 undici 连接池在 Daemon 重启后复用已关闭的 socket
    connection: "close",
  });

  it("未授权请求返回 401", async () => {
    const res = await fetch(`${base}/api/contracts`);
    expect(res.status).toBe(401);
  });

  it("创建 → 审批 → 执行闭环：合同进入 AUDITED 且生成 PASSED 证据", async () => {
    const draft = createContractDraft({
      title: "api flow",
      description: "M5 API test",
      acceptanceCriteria: ["verify passes"],
      writablePaths: ["src/**"],
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
    const contract = softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "PENDING_APPROVAL",
      approval: { status: "PENDING_REVIEW" },
    });

    const created = await fetch(`${base}/api/contracts`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ contract }),
    });
    expect(created.status).toBe(201);
    // TASK-D.2（v1.3.3 §0.2）：无保护清单交集 → 创建即自动批准，无需用户点击审批
    const createdBody = (await created.json()) as {
      contract: { lifecycle_state: string; approval: { approved_by?: string } };
    };
    expect(createdBody.contract.lifecycle_state).toBe("EXECUTING");
    expect(createdBody.contract.approval.approved_by).toBe("stagent-auto");

    // 已自动批准的合同再次显式审批，必须被状态机拒绝（不允许重复建 Worktree）
    const reApproved = await fetch(
      `${base}/api/contracts/${contract.contract_id}/approve`,
      {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ reviewer: "api-tester" }),
      },
    );
    expect(reApproved.status).toBe(409);

    const executed = await fetch(
      `${base}/api/contracts/${contract.contract_id}/execute`,
      { method: "POST", headers: auth() },
    );
    expect(executed.status).toBe(200);
    const executedBody = (await executed.json()) as {
      contract: { lifecycle_state: string };
      evidence: { verdict: { status: string; can_merge: boolean } };
    };
    expect(executedBody.contract.lifecycle_state).toBe("AUDITED");
    expect(executedBody.evidence.verdict).toMatchObject({
      status: "PASSED",
      can_merge: true,
    });

    const listed = await fetch(`${base}/api/contracts`, { headers: auth() });
    const listBody = (await listed.json()) as { contracts: unknown[] };
    expect(listBody.contracts).toHaveLength(1);
  });

  it("命中保护清单 → 创建后停在待审批并登记白话卡，用户审批后才开工", async () => {
    fs.mkdirSync(path.join(repo, ".stagent"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, ".stagent", "protection.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "pe-src",
            name: "源码",
            patterns: ["src/**"],
            createdAt: new Date().toISOString(),
          },
        ],
      }),
      "utf8",
    );

    const draft = createContractDraft({
      title: "protected flow",
      description: "TASK-D.2 有交集路径",
      acceptanceCriteria: ["verify passes"],
      writablePaths: ["src/**"],
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
    const contract = softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "PENDING_APPROVAL",
      approval: { status: "PENDING_REVIEW" },
    });

    const created = await fetch(`${base}/api/contracts`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ contract }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      contract: { lifecycle_state: string };
      admission: {
        decision: string;
        protectedFiles: string[];
        cardId?: string;
      };
    };
    expect(createdBody.admission.decision).toBe("NEEDS_APPROVAL");
    expect(createdBody.contract.lifecycle_state).toBe("PENDING_APPROVAL");
    expect(createdBody.admission.protectedFiles).toContain("src/**");
    expect(createdBody.admission.cardId).toBeTruthy();

    // 白话待审批卡已登记到本轮（前端据 /api/protection/pending 展示）
    const pendingRes = await fetch(`${base}/api/protection/pending`, {
      headers: auth(),
    });
    const pendingBody = (await pendingRes.json()) as {
      pending: Array<{ id: string; files: string[] }>;
    };
    expect(pendingBody.pending).toHaveLength(1);
    expect(pendingBody.pending[0]!.files).toContain("src/**");

    // 用户显式审批后才推进（有交集路径保留人工决策）
    const approved = await fetch(
      `${base}/api/contracts/${contract.contract_id}/approve`,
      {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ reviewer: "api-tester" }),
      },
    );
    expect(approved.status).toBe(200);
    const approvedBody = (await approved.json()) as {
      contract: { lifecycle_state: string; approval: { approved_by: string } };
    };
    expect(approvedBody.contract.lifecycle_state).toBe("EXECUTING");
    expect(approvedBody.contract.approval.approved_by).toBe("api-tester");
  });

  it("非法合同返回 400", async () => {
    const res = await fetch(`${base}/api/contracts`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ contract: { contract_id: "bad" } }),
    });
    expect(res.status).toBe(400);
  });

  it("模型 Key 设置：需鉴权、不回显、状态可查", async () => {
    const unauth = await fetch(`${base}/api/settings`);
    expect(unauth.status).toBe(401);

    const before = await fetch(`${base}/api/settings`, { headers: auth() });
    expect(before.status).toBe(200);
    const beforeBody = (await before.json()) as {
      settings: { configured: boolean };
    };
    expect(beforeBody.settings.configured).toBe(false);

    const secret = "sk-test-abcdef1234567890";
    const saved = await fetch(`${base}/api/settings/openai-key`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ api_key: secret, model: "gpt-4o-mini" }),
    });
    expect(saved.status).toBe(200);
    const savedText = await saved.text();
    expect(savedText).not.toContain(secret);
    expect(JSON.parse(savedText)).toMatchObject({
      settings: { configured: true, source: "runtime" },
    });

    const after = await fetch(`${base}/api/settings`, { headers: auth() });
    const afterBody = (await after.json()) as {
      settings: { configured: boolean; model: string };
    };
    expect(afterBody.settings.configured).toBe(true);
    expect(afterBody.settings.model).toBe("gpt-4o-mini");
  });

  it("本地 Origin 的 CORS 预检被放行，异源被拒绝", async () => {
    const ok = await fetch(`${base}/api/contracts`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST",
        connection: "close",
      },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173",
    );

    const evil = await fetch(`${base}/api/contracts`, {
      method: "OPTIONS",
      headers: {
        origin: "https://evil.example.com",
        "access-control-request-method": "POST",
        connection: "close",
      },
    });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("架构图 API 返回文件级拓扑", async () => {
    const res = await fetch(`${base}/api/arch/graph`, { headers: auth() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      stats: { nodes: number; edges: number; cycles: number };
      graph: {
        nodes: Array<{
          filePath: string;
          exports: string[];
          imports: Array<{
            specifier: string;
            resolved: string | null;
            typeOnly: boolean;
          }>;
        }>;
        edges: Array<{ from: string; to: string }>;
      };
    };
    expect(body.stats.nodes).toBeGreaterThan(0);
    expect(body.graph.nodes.length).toBe(body.stats.nodes);
    // 加强契约防线：断言节点包含完整 filePath/exports/imports，且 edges 为扁平数组
    const firstNode = body.graph.nodes[0];
    expect(firstNode).toBeDefined();
    if (firstNode) {
      expect(typeof firstNode.filePath).toBe("string");
      expect(Array.isArray(firstNode.exports)).toBe(true);
      expect(Array.isArray(firstNode.imports)).toBe(true);
    }
    expect(Array.isArray(body.graph.edges)).toBe(true);
    if (body.graph.edges.length > 0) {
      const firstEdge = body.graph.edges[0];
      if (firstEdge) {
        expect(typeof firstEdge.from).toBe("string");
        expect(typeof firstEdge.to).toBe("string");
      }
    }
  });

  it("执行通过后外部修改 Worktree 会把 Evidence 置为 STALE（B.2 联动）", async () => {
    const draft = createContractDraft({
      title: "stale flow",
      description: "watch",
      acceptanceCriteria: ["pass"],
      writablePaths: ["src/**"],
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
    const contract = softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "PENDING_APPROVAL",
      approval: { status: "PENDING_REVIEW" },
    });

    await fetch(`${base}/api/contracts`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ contract }),
    });
    await fetch(`${base}/api/contracts/${contract.contract_id}/approve`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ reviewer: "t" }),
    });
    const executed = await fetch(
      `${base}/api/contracts/${contract.contract_id}/execute`,
      { method: "POST", headers: auth() },
    );
    const executedBody = (await executed.json()) as {
      evidence: { evidence_id: string };
    };

    const evidencePath = path.join(
      repo,
      ".stagent",
      "evidence",
      `${contract.contract_id}-${executedBody.evidence.evidence_id}.json`,
    );
    // 等待 watcher 就绪
    await new Promise((r) => setTimeout(r, 300));

    fs.writeFileSync(
      path.join(
        repo,
        ".stagent",
        "worktrees",
        `task-${contract.contract_id}`,
        "src",
        "a.ts",
      ),
      "export const a = 999;\n",
    );

    const deadline = Date.now() + 4000;
    let status = "";
    while (Date.now() < deadline) {
      const parsed = JSON.parse(fs.readFileSync(evidencePath, "utf8")) as {
        verdict: { status: string; can_merge: boolean };
      };
      status = parsed.verdict.status;
      if (status === "STALE") {
        expect(parsed.verdict.can_merge).toBe(false);
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(status).toBe("STALE");
  });
});
