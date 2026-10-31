import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { createDaemon, StagentDaemon } from "../../daemon/server";
import { safeRmSync } from "../helpers/tmp";
import type { SupervisorProposalV1 } from "../../src/lib/graph/task-graph";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";
import { ContractStore } from "../../daemon/pipeline/contract-store";
import { E_UNAUTHORIZED_COMMAND } from "../../daemon/runner/command-runner";

interface ErrorResponseBody {
  code?: string;
}

interface VerifyResponseBody {
  illuminated?: boolean;
  code?: string;
}

function postJson<T = Record<string, unknown>>(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ statusCode: number; body: T }> {
  return new Promise((resolve, reject) => {
    const raw = JSON.stringify(body);
    const req = http.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(raw),
          ...headers,
        },
      },
      (res) => {
        let resBody = "";
        res.on("data", (chunk) => (resBody += chunk));
        res.on("end", () => {
          try {
            resolve({
              statusCode: res.statusCode ?? 0,
              body: JSON.parse(resBody) as T,
            });
          } catch {
            resolve({
              statusCode: res.statusCode ?? 0,
              body: resBody as unknown as T,
            });
          }
        });
      },
    );
    req.on("error", reject);
    req.write(raw);
    req.end();
  });
}

describe("OP-32-A: daemon task-graph verify command execution", () => {
  let tempDir: string;
  let daemon: StagentDaemon | null = null;
  let contractId: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-op32-test-"));
    // Init git repo
    execFileSync("git", ["init", "-b", "main"], {
      cwd: tempDir,
      stdio: "ignore",
    });
    execFileSync("git", ["config", "user.name", "Tester"], {
      cwd: tempDir,
      stdio: "ignore",
    });
    execFileSync("git", ["config", "user.email", "tester@example.com"], {
      cwd: tempDir,
      stdio: "ignore",
    });
    fs.writeFileSync(path.join(tempDir, "README.md"), "# Test\n");
    execFileSync("git", ["add", "README.md"], {
      cwd: tempDir,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "initial commit"], {
      cwd: tempDir,
      stdio: "ignore",
    });

    // Store a valid contract via ContractStore using createContractDraft
    const store = new ContractStore(tempDir);
    const draft = createContractDraft({
      title: "OP-32 Test Contract",
      description: "Testing OP-32-A verification execution",
      acceptanceCriteria: ["verify passed"],
      writablePaths: ["src/**"],
      commands: [
        {
          alias: "test-pass",
          executable: "node",
          args: ["-e", "process.exit(0)"],
          expected_exit_code: 0,
          timeout_seconds: 30,
        },
        {
          alias: "test-fail",
          executable: "node",
          args: ["-e", "process.exit(2)"],
          expected_exit_code: 0,
          timeout_seconds: 30,
        },
      ],
    });

    const parsed = softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "EXECUTING",
      approval: {
        status: "APPROVED",
        approved_at: new Date().toISOString(),
        approved_by: "test-user",
      },
    });

    const saved = store.save(parsed);
    contractId = saved.contract_id;
  });

  afterEach(async () => {
    if (daemon && daemon.isRunning) {
      await daemon.stop();
    }
    daemon = null;
    try {
      safeRmSync(tempDir);
    } catch {
      // ignore
    }
  });

  async function startAndInitGraph() {
    daemon = createDaemon({
      repoRoot: tempDir,
      startPort: 3960,
      endPort: 3969,
    });
    const info = await daemon.start();
    const token = daemon.getSessionToken() ?? "";
    const headers = { authorization: `Bearer ${token}` };

    const proposal: SupervisorProposalV1 = {
      schema_version: "1.0",
      contract_id: contractId,
      proposal_id: "prop-1",
      functional_tree: [{ id: "main", title: "Main", parent_id: null }],
      nodes: [
        {
          node_id: "node-cmd-pass",
          title: "Pass Node",
          kind: "CODE_MODIFICATION",
          depends_on: [],
          functional_area: "main",
          target_files: ["src/index.ts"],
          verification_mode: "COMMAND",
          verification_commands: ["test-pass"],
        },
        {
          node_id: "node-cmd-fail",
          title: "Fail Node",
          kind: "CODE_MODIFICATION",
          depends_on: [],
          functional_area: "main",
          target_files: ["src/index.ts"],
          verification_mode: "COMMAND",
          verification_commands: ["test-fail"],
        },
        {
          node_id: "node-manual",
          title: "Manual Node",
          kind: "MANUAL_REVIEW",
          depends_on: [],
          functional_area: "main",
          target_files: ["src/index.ts"],
          verification_mode: "MANUAL",
          verification_commands: [],
        },
      ],
    };

    const propRes = await postJson(
      `http://127.0.0.1:${info.port}/api/graph/proposal`,
      { proposal },
      headers,
    );
    expect(propRes.statusCode).toBe(200);

    return { info, headers };
  }

  it("拒收请求体携带的 command_results（防造假门禁，返回 E_UNAUTHORIZED_COMMAND）", async () => {
    const { info, headers } = await startAndInitGraph();

    const res = await postJson<ErrorResponseBody>(
      `http://127.0.0.1:${info.port}/api/graph/verify`,
      {
        node_id: "node-cmd-pass",
        command_results: [{ alias: "test-pass", exit_code: 0 }],
      },
      headers,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe(E_UNAUTHORIZED_COMMAND);
  });

  it("拒收请求体携带的 execution_exit_code（防造假门禁，返回 E_UNAUTHORIZED_COMMAND）", async () => {
    const { info, headers } = await startAndInitGraph();

    const res = await postJson<ErrorResponseBody>(
      `http://127.0.0.1:${info.port}/api/graph/verify`,
      {
        node_id: "node-cmd-pass",
        execution_exit_code: 0,
      },
      headers,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe(E_UNAUTHORIZED_COMMAND);
  });

  it("指定合同外命令别名时拒绝（E_UNAUTHORIZED_COMMAND）", async () => {
    const { info, headers } = await startAndInitGraph();

    const res = await postJson<ErrorResponseBody>(
      `http://127.0.0.1:${info.port}/api/graph/verify`,
      {
        node_id: "node-cmd-pass",
        command_alias: "unauthorized-alias",
      },
      headers,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe(E_UNAUTHORIZED_COMMAND);
  });

  it("在 Worktree 内真实执行验证命令：实测非零退出码不点亮", async () => {
    const { info, headers } = await startAndInitGraph();

    // 先开工 node-cmd-fail 以创建并切换到 worktree
    const startRes = await postJson(
      `http://127.0.0.1:${info.port}/api/graph/nodes/start`,
      { node_id: "node-cmd-fail" },
      headers,
    );
    expect(startRes.statusCode).toBe(200);

    // 在 Worktree 中写入 target_file，使文件存在
    const worktreePath = path.join(
      tempDir,
      ".stagent",
      "worktrees",
      `task-${contractId}`,
    );
    fs.mkdirSync(path.join(worktreePath, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(worktreePath, "src", "index.ts"),
      "export const a = 1;\n",
    );
    execFileSync("git", ["add", "src/index.ts"], {
      cwd: worktreePath,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "write index.ts"], {
      cwd: worktreePath,
      stdio: "ignore",
    });

    const verifyRes = await postJson<VerifyResponseBody>(
      `http://127.0.0.1:${info.port}/api/graph/verify`,
      { node_id: "node-cmd-fail" },
      headers,
    );

    expect(verifyRes.statusCode).toBe(200);
    // test-fail 产生 exit code 2，期望 0，故不点亮
    expect(verifyRes.body.illuminated).toBe(false);
    expect(verifyRes.body.code).toBe("E_COMMAND_FAILED");
  });

  it("在 Worktree 内真实执行验证命令：实测零码且文件就绪点亮", async () => {
    const { info, headers } = await startAndInitGraph();

    // 先开工 node-cmd-pass
    const startRes = await postJson(
      `http://127.0.0.1:${info.port}/api/graph/nodes/start`,
      { node_id: "node-cmd-pass" },
      headers,
    );
    expect(startRes.statusCode).toBe(200);

    // 在 Worktree 中写入 target_file 并提交
    const worktreePath = path.join(
      tempDir,
      ".stagent",
      "worktrees",
      `task-${contractId}`,
    );
    fs.mkdirSync(path.join(worktreePath, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(worktreePath, "src", "index.ts"),
      "export const ok = true;\n",
    );
    execFileSync("git", ["add", "src/index.ts"], {
      cwd: worktreePath,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "feat: pass index.ts"], {
      cwd: worktreePath,
      stdio: "ignore",
    });

    const verifyRes = await postJson<VerifyResponseBody>(
      `http://127.0.0.1:${info.port}/api/graph/verify`,
      { node_id: "node-cmd-pass" },
      headers,
    );

    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.body.illuminated).toBe(true);
  });

  it("MANUAL 节点 manual_approved 放行路径保留且正常核销", async () => {
    const { info, headers } = await startAndInitGraph();

    // 开工 manual 节点
    const startRes = await postJson(
      `http://127.0.0.1:${info.port}/api/graph/nodes/start`,
      { node_id: "node-manual" },
      headers,
    );
    expect(startRes.statusCode).toBe(200);

    const worktreePath = path.join(
      tempDir,
      ".stagent",
      "worktrees",
      `task-${contractId}`,
    );
    fs.mkdirSync(path.join(worktreePath, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(worktreePath, "src", "index.ts"),
      "export const m = true;\n",
    );
    execFileSync("git", ["add", "src/index.ts"], {
      cwd: worktreePath,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "manual commit"], {
      cwd: worktreePath,
      stdio: "ignore",
    });

    // 显式点击确认 (ui_click)
    const verifyApproved = await postJson<VerifyResponseBody>(
      `http://127.0.0.1:${info.port}/api/graph/verify`,
      {
        node_id: "node-manual",
        manual_approved: true,
        manual_approved_source: "ui_click",
      },
      headers,
    );
    expect(verifyApproved.statusCode).toBe(200);
    expect(verifyApproved.body.illuminated).toBe(true);
  });

  it("MANUAL 节点未确认时不放行（illuminated=false, E_MANUAL_APPROVAL_MISSING）", async () => {
    const { info, headers } = await startAndInitGraph();

    const startRes = await postJson(
      `http://127.0.0.1:${info.port}/api/graph/nodes/start`,
      { node_id: "node-manual" },
      headers,
    );
    expect(startRes.statusCode).toBe(200);

    const worktreePath = path.join(
      tempDir,
      ".stagent",
      "worktrees",
      `task-${contractId}`,
    );
    fs.mkdirSync(path.join(worktreePath, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(worktreePath, "src", "index.ts"),
      "export const m = true;\n",
    );
    execFileSync("git", ["add", "src/index.ts"], {
      cwd: worktreePath,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "manual commit"], {
      cwd: worktreePath,
      stdio: "ignore",
    });

    const verifyUnapproved = await postJson<VerifyResponseBody>(
      `http://127.0.0.1:${info.port}/api/graph/verify`,
      { node_id: "node-manual" },
      headers,
    );
    expect(verifyUnapproved.statusCode).toBe(200);
    expect(verifyUnapproved.body.illuminated).toBe(false);
    expect(verifyUnapproved.body.code).toBe("E_MANUAL_APPROVAL_MISSING");
  });
});
