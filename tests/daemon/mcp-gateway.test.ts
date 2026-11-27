import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ScopedWorktreeGateway } from "../../daemon/mcp/gateway";

/** 清理尽力而为：沙箱安全策略可能拒绝删除临时目录 */
function safeRm(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
}
import { CostMonitor } from "../../daemon/guard/cost-monitor";
import { LoopGuard } from "../../daemon/guard/loop-guard";
import type { SoftwareContract } from "../../src/lib/contract.schema";

/** §9.1 结构化命令转为可执行命令行（网关白名单比对格式） */
function commandLine(contract: SoftwareContract, index: number): string {
  const cmd = contract.verification_spec.commands[index];
  if (!cmd) throw new Error(`missing command at index ${index}`);
  return [cmd.executable, ...cmd.args].join(" ");
}

const makeContract = (writablePaths: string[]): SoftwareContract => ({
  contract_id: "test-integrity-001",
  schema_version: "1.2.0",
  contract_revision: 1,
  created_at: new Date().toISOString(),
  creator: "user",
  worker_spec: {
    adapter_id: "stagent.builtin.ai-sdk",
    runtime_kind: "MANAGED_TOOL_CALLING",
    control_mode: "GATEWAY_ENFORCED",
    adapter_version: "0.1.0",
  },
  lifecycle_state: "EXECUTING",
  intent: {
    title: "Test Integrity Guard",
    description: "Prevent agent from tampering tests to fake PASSED",
    acceptance_criteria: ["test writes require explicit test scope"],
    risk_level: "LOW",
  },
  authorization: {
    git: {
      base_branch: "main",
      task_branch: "task/test-integrity-001",
      target_branch: "main",
      use_worktree: true,
    },
    file_system_scope: {
      writable_paths: writablePaths,
      readonly_paths: [],
      strictly_forbidden_paths: [],
    },
    budget_limits: {
      max_file_modifications: 10,
      max_total_diff_lines: 2000,
      max_duration_seconds: 30,
      max_verification_retries: 3,
    },
    cost_limits: {
      max_cost_minor_units: 10000,
      currency: "CNY",
      pricing_version: "test",
      accounting_mode: "ESTIMATED",
    },
    execution_permissions: {
      allowed_commands: ["node"],
      allowed_environment_variable_names: [],
      network_policy: "DENY",
      dependency_changes_allowed: false,
    },
  },
  verification_spec: {
    commands: [
      {
        alias: "test",
        executable: "node",
        args: ["-e", "console.log('ok')"],
        expected_exit_code: 0,
        timeout_seconds: 30,
      },
    ],
  },
  approval: {
    status: "APPROVED",
    approved_by: "tester",
    approved_at: new Date().toISOString(),
  },
});

describe("Task 1.3: Scoped MCP Tool Gateway in Real Worktree", () => {
  let tempWorktree: string;
  let sampleContract: SoftwareContract;

  beforeEach(() => {
    tempWorktree = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-mcp-test-"));
    fs.mkdirSync(path.join(tempWorktree, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(tempWorktree, "src", "index.ts"),
      "export const hello = 'world';",
    );
    fs.writeFileSync(
      path.join(tempWorktree, "src", "read.ts"),
      "export const readOnly = true;",
    );
    fs.writeFileSync(
      path.join(tempWorktree, "secret.env"),
      "PRIVATE_KEY=secret",
    );

    sampleContract = {
      contract_id: "test-contract-001",
      schema_version: "1.2.0",
      contract_revision: 1,
      created_at: new Date().toISOString(),
      creator: "user",
      worker_spec: {
        adapter_id: "stagent.builtin.ai-sdk",
        runtime_kind: "MANAGED_TOOL_CALLING",
        control_mode: "GATEWAY_ENFORCED",
        adapter_version: "0.1.0",
      },
      lifecycle_state: "EXECUTING",
      intent: {
        title: "Test Gateway Scope",
        description: "Testing MCP gateway enforcement",
        acceptance_criteria: ["Must enforce scope"],
        risk_level: "LOW",
      },
      authorization: {
        git: {
          base_branch: "main",
          task_branch: "task/test-contract-001",
          target_branch: "main",
          use_worktree: true,
        },
        file_system_scope: {
          writable_paths: ["src/index.ts", "src/new-*.ts", "src/allowed/**"],
          readonly_paths: ["src/read.ts"],
          strictly_forbidden_paths: ["secret.env", "**/.git/**", "**/*.env*"],
        },
        budget_limits: {
          max_file_modifications: 2,
          max_total_diff_lines: 2000,
          max_duration_seconds: 30,
          max_verification_retries: 3,
        },
        cost_limits: {
          max_cost_minor_units: 10000,
          currency: "CNY",
          pricing_version: "test",
          accounting_mode: "ESTIMATED",
        },
        execution_permissions: {
          allowed_commands: ["node"],
          allowed_environment_variable_names: [],
          network_policy: "DENY",
          dependency_changes_allowed: false,
        },
      },
      verification_spec: {
        commands: [
          {
            alias: "test",
            executable: "node",
            args: ["-e", "console.log('test passed')"],
            expected_exit_code: 0,
            timeout_seconds: 30,
          },
          {
            alias: "lint",
            executable: "node",
            args: ["-e", "console.log('lint passed')"],
            expected_exit_code: 0,
            timeout_seconds: 30,
          },
        ],
      },
      approval: {
        status: "APPROVED",
        approved_by: "tester",
        approved_at: new Date().toISOString(),
      },
    };
  });

  afterEach(() => {
    safeRm(tempWorktree);
  });

  it("should allow reading authorized files and block forbidden / out-of-scope files", async () => {
    const gateway = new ScopedWorktreeGateway(tempWorktree, sampleContract);

    // 1. Authorized read in readonly_paths
    const resRead = await gateway.callTool("stagent_read_file", {
      path: "src/read.ts",
    });
    expect(resRead.isError).toBe(false);
    expect(resRead.content[0]?.text).toContain("export const readOnly = true;");

    // 2. Forbidden path read
    const resForbidden = await gateway.callTool("stagent_read_file", {
      path: "secret.env",
    });
    expect(resForbidden.isError).toBe(true);
    expect(resForbidden.error?.code).toBe("E_FORBIDDEN_PATH");

    // 3. Out-of-scope read
    fs.writeFileSync(path.join(tempWorktree, "other.txt"), "other content");
    const resOutOfScope = await gateway.callTool("stagent_read_file", {
      path: "other.txt",
    });
    expect(resOutOfScope.isError).toBe(true);
    expect(resOutOfScope.error?.code).toBe("E_OUT_OF_SCOPE");

    // 4. Path traversal read
    const resTraversal = await gateway.callTool("stagent_read_file", {
      path: "../outside.txt",
    });
    expect(resTraversal.isError).toBe(true);
    expect(resTraversal.error?.code).toBe("PATH_TRAVERSAL_DETECTED");

    // Check audit log
    const audit = gateway.getAuditLog();
    expect(audit.length).toBe(4);
    expect(audit[0]?.outcome).toBe("SUCCESS");
    expect(audit[1]?.outcome).toBe("BLOCKED");
    expect(audit[2]?.outcome).toBe("BLOCKED");
    expect(audit[3]?.outcome).toBe("BLOCKED");
  });

  it("should allow writing to writable_paths and block forbidden paths or traversal", async () => {
    const gateway = new ScopedWorktreeGateway(tempWorktree, sampleContract);

    // 1. Authorized write
    const resWrite = await gateway.callTool("stagent_write_file", {
      path: "src/index.ts",
      content: "export const hello = 'modified';",
    });
    expect(resWrite.isError).toBe(false);
    expect(
      fs.readFileSync(path.join(tempWorktree, "src", "index.ts"), "utf-8"),
    ).toBe("export const hello = 'modified';");

    // 2. Write to non-writable path (read-only file)
    const resWriteReadonly = await gateway.callTool("stagent_write_file", {
      path: "package.json",
      content: "tampered",
    });
    expect(resWriteReadonly.isError).toBe(true);
    expect(resWriteReadonly.error?.code).toBe("E_OUT_OF_SCOPE");

    // 3. Write to forbidden path
    const resWriteForbidden = await gateway.callTool("stagent_write_file", {
      path: "secret.env",
      content: "tampered",
    });
    expect(resWriteForbidden.isError).toBe(true);
    expect(resWriteForbidden.error?.code).toBe("E_FORBIDDEN_PATH");

    // 4. Path traversal write
    const resWriteTraversal = await gateway.callTool("stagent_write_file", {
      path: "../../etc/shadow",
      content: "evil",
    });
    expect(resWriteTraversal.isError).toBe(true);
    expect(resWriteTraversal.error?.code).toBe("PATH_TRAVERSAL_DETECTED");
  });

  it("should enforce modification budget limits", async () => {
    const gateway = new ScopedWorktreeGateway(tempWorktree, sampleContract);
    // max_file_modifications is 2

    // Mod 1
    const res1 = await gateway.callTool("stagent_write_file", {
      path: "src/new-1.ts",
      content: "console.log(1);",
    });
    expect(res1.isError).toBe(false);

    // Mod 2
    const res2 = await gateway.callTool("stagent_write_file", {
      path: "src/new-2.ts",
      content: "console.log(2);",
    });
    expect(res2.isError).toBe(false);

    // Mod 3 (exceeds budget of 2)
    const res3 = await gateway.callTool("stagent_write_file", {
      path: "src/new-3.ts",
      content: "console.log(3);",
    });
    expect(res3.isError).toBe(true);
    expect(res3.error?.code).toBe("BUDGET_EXCEEDED");
  });

  it("should block write and command execution when circuit breakers are tripped", async () => {
    const costMonitor = new CostMonitor({ maxCostUsd: 0.1 });
    // Trip cost monitor
    costMonitor.recordUsage(100_000, 100_000, 1.0); // $1.00 > $0.10

    const loopGuard = new LoopGuard({ maxRetries: 1 });
    // Trip loop guard
    loopGuard.recordAttempt({ passed: false, exitCode: 1 });

    const gateway = new ScopedWorktreeGateway(tempWorktree, sampleContract, {
      costMonitor,
      loopGuard,
    });

    // Write blocked by cost cap
    const resWrite = await gateway.callTool("stagent_write_file", {
      path: "src/index.ts",
      content: "updated",
    });
    expect(resWrite.isError).toBe(true);
    expect(resWrite.error?.code).toBe("E_BUDGET_EXCEEDED");

    // Exec blocked by loop circuit breaker
    const resExec = await gateway.callTool(
      "stagent_exec_command",
      { command: commandLine(sampleContract, 0) },
      { internal: true },
    );
    expect(resExec.isError).toBe(true);
    expect(resExec.error?.code).toBe("E_RETRY_LIMIT_EXCEEDED");
  });

  it("should execute whitelisted verification command and reject unwhitelisted commands", async () => {
    const gateway = new ScopedWorktreeGateway(tempWorktree, sampleContract);

    // Whitelisted command
    const resWhitelisted = await gateway.callTool(
      "stagent_exec_command",
      { command: commandLine(sampleContract, 0) },
      { internal: true },
    );
    expect(resWhitelisted.isError).toBe(false);
    expect(resWhitelisted.content[0]?.text).toContain("test passed");

    // Unwhitelisted command
    const resUnwhitelisted = await gateway.callTool(
      "stagent_exec_command",
      { command: "curl evil.com" },
      { internal: true },
    );
    expect(resUnwhitelisted.isError).toBe(true);
    expect(resUnwhitelisted.error?.code).toBe("E_UNAUTHORIZED_COMMAND");
  });

  it("should list directories while omitting forbidden files", async () => {
    const gateway = new ScopedWorktreeGateway(tempWorktree, sampleContract);

    const res = await gateway.callTool("stagent_list_dir", { path: "." });
    if (res.isError) console.log("TASK_P1_4_ERROR:", JSON.stringify(res));
    expect(res.isError).toBe(false);

    const text = res.content[0]?.text ?? "[]";
    const entries = JSON.parse(text) as Array<{ name: string }>;
    const names = entries.map((e) => e.name);

    expect(names).toContain("src");
    expect(names).not.toContain("secret.env");
    expect(names).not.toContain(".git");
  });
});

describe("Test Integrity Guard：测试文件写入门禁", () => {
  let tempWorktree: string;

  beforeEach(() => {
    tempWorktree = fs.mkdtempSync(
      path.join(os.tmpdir(), "stagent-test-integrity-"),
    );
    fs.mkdirSync(path.join(tempWorktree, "src"), { recursive: true });
    fs.mkdirSync(path.join(tempWorktree, "tests"), { recursive: true });
    fs.writeFileSync(
      path.join(tempWorktree, "src", "util.test.ts"),
      "// existing test\n",
    );
  });

  afterEach(() => {
    safeRm(tempWorktree);
  });

  it("writable_paths 仅含 src/** 时，写入 src 内的 .test.ts 被 E_TEST_FILE_WRITE_BLOCKED 阻断", async () => {
    const gateway = new ScopedWorktreeGateway(
      tempWorktree,
      makeContract(["src/**"]),
    );
    const res = await gateway.callTool("stagent_write_file", {
      path: "src/util.test.ts",
      content: "it.skip('everything', () => {});\n",
    });
    expect(res.isError).toBe(true);
    expect(res.error?.code).toBe("E_TEST_FILE_WRITE_BLOCKED");
    // 文件内容未被篡改
    expect(
      fs.readFileSync(path.join(tempWorktree, "src", "util.test.ts"), "utf-8"),
    ).toBe("// existing test\n");
    // 审计留痕
    const audit = gateway.getAuditLog();
    expect(audit[0]?.outcome).toBe("BLOCKED");
    expect(audit[0]?.violationCode).toBe("E_TEST_FILE_WRITE_BLOCKED");
  });

  it("writable_paths 仅含 src/** 时，写入 tests/ 目录被范围门禁阻断", async () => {
    const gateway = new ScopedWorktreeGateway(
      tempWorktree,
      makeContract(["src/**"]),
    );
    const res = await gateway.callTool("stagent_write_file", {
      path: "tests/new.test.ts",
      content: "// forged\n",
    });
    expect(res.isError).toBe(true);
    expect(res.error?.code).toBe("E_OUT_OF_SCOPE");
    expect(fs.existsSync(path.join(tempWorktree, "tests", "new.test.ts"))).toBe(
      false,
    );
  });

  it("writable_paths 显式包含 tests/** 时允许写入，并记录 tests_modified 留痕", async () => {
    const gateway = new ScopedWorktreeGateway(
      tempWorktree,
      makeContract(["src/**", "tests/**"]),
    );
    const res = await gateway.callTool("stagent_write_file", {
      path: "tests/feature.test.ts",
      content: "// legitimate new test\n",
    });
    expect(res.isError).toBe(false);
    expect(gateway.wasTestsModified()).toBe(true);
    expect(gateway.getModifiedTestFiles()).toContain("tests/feature.test.ts");
  });

  it("writable_paths 显式包含 **/*.spec.ts 模式时允许写入对应测试文件", async () => {
    const gateway = new ScopedWorktreeGateway(
      tempWorktree,
      makeContract(["src/**", "**/*.spec.ts"]),
    );
    const res = await gateway.callTool("stagent_write_file", {
      path: "src/util.spec.ts",
      content: "// spec\n",
    });
    expect(res.isError).toBe(false);
    expect(gateway.wasTestsModified()).toBe(true);
  });

  it("非测试文件的正常写入不受测试门禁影响", async () => {
    const gateway = new ScopedWorktreeGateway(
      tempWorktree,
      makeContract(["src/**"]),
    );
    const res = await gateway.callTool("stagent_write_file", {
      path: "src/feature.ts",
      content: "export const feature = 1;\n",
    });
    expect(res.isError).toBe(false);
    expect(gateway.wasTestsModified()).toBe(false);
  });
});

describe("TASK-P1.4: Gateway 凭据脱敏与日志防泄漏", () => {
  let tempWorktree: string;

  beforeEach(() => {
    tempWorktree = fs.mkdtempSync(
      path.join(os.tmpdir(), "stagent-mcp-redact-test-"),
    );
    fs.mkdirSync(path.join(tempWorktree, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(tempWorktree, "src", "index.ts"),
      "export const a = 1;",
    );
    fs.writeFileSync(
      path.join(tempWorktree, "src", "read.ts"),
      "export const r = 1;",
    );
  });

  afterEach(() => {
    if (fs.existsSync(tempWorktree)) {
      fs.rmSync(tempWorktree, { recursive: true, force: true });
    }
  });

  it("[TASK-P1.4] 凭据值泄漏进 stdout 时被强制脱敏替换为 [REDACTED]，且审计日志中无明文", async () => {
    fs.writeFileSync(
      path.join(tempWorktree, "config.env"),
      "API_SECRET=super_secret_token_value_xyz123\nOTHER_KEY=ignore\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tempWorktree, "leak.js"),
      'console.log("Leaked output: super_secret_token_value_xyz123 and env=" + process.env.API_SECRET);\n',
      "utf-8",
    );

    const secretContract: SoftwareContract = {
      ...makeContract(["src/**"]),
      authorization: {
        ...makeContract(["src/**"]).authorization,
        execution_permissions: {
          ...makeContract(["src/**"]).authorization.execution_permissions,
          allowed_commands: ["node"],
          env_file_grants: [
            {
              file: "config.env",
              command_aliases: ["leak_test"],
              variable_names: ["API_SECRET"],
            },
          ],
        },
      },
      verification_spec: {
        commands: [
          {
            alias: "leak_test",
            executable: "node",
            args: ["leak.js"],
            expected_exit_code: 0,
            timeout_seconds: 30,
          },
        ],
      },
    };

    const gateway = new ScopedWorktreeGateway(tempWorktree, secretContract);

    const res = await gateway.callTool(
      "stagent_exec_command",
      { command: commandLine(secretContract, 0) },
      { internal: true },
    );

    expect(res.isError).toBe(false);
    const outputText = res.content[0]?.text ?? "";

    // 严密断言：stdout 中绝无凭据明文，均已被替换为 [REDACTED]
    expect(outputText).not.toContain("super_secret_token_value_xyz123");
    expect(outputText).toContain("[REDACTED]");

    // 审计日志中亦不含任何凭据明文
    const auditLogs = gateway.getAuditLog();
    const auditJson = JSON.stringify(auditLogs);
    expect(auditJson).not.toContain("super_secret_token_value_xyz123");
  });

  it("[TASK-P1.4] 工具参数或回包包含敏感凭据时被脱敏且审计日志脱敏", async () => {
    fs.writeFileSync(
      path.join(tempWorktree, "secret.env"),
      "MY_KEY=token_for_param_leak_888\n",
      "utf-8",
    );

    const contractWithSecret: SoftwareContract = {
      ...makeContract(["src/**"]),
      authorization: {
        ...makeContract(["src/**"]).authorization,
        file_system_scope: {
          writable_paths: ["src/**"],
          readonly_paths: ["src/read.ts"],
          strictly_forbidden_paths: [],
        },
        execution_permissions: {
          ...makeContract(["src/**"]).authorization.execution_permissions,
          env_file_grants: [
            {
              file: "secret.env",
              command_aliases: ["*"],
              variable_names: ["MY_KEY"],
            },
          ],
        },
      },
    };

    const gateway = new ScopedWorktreeGateway(tempWorktree, contractWithSecret);

    // 尝试写入包含凭据的文件到只读路径（触发阻断）
    const res = await gateway.callTool("stagent_write_file", {
      path: "package.json",
      content: "const key = token_for_param_leak_888;",
    });

    expect(res.isError).toBe(true);

    // 审计日志输入与详情已脱敏
    const auditLogs = gateway.getAuditLog();
    const auditJson = JSON.stringify(auditLogs);
    expect(auditJson).not.toContain("token_for_param_leak_888");
  });
});
