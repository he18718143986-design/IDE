import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  contractLockPath,
  isContractLockResource,
  resetContractLocks,
  setContractLockLeaseObserver,
  withContractLock,
} from "../../daemon/core/contract-mutex";
import {
  ScopedWorktreeGateway,
  resolveCommandTimeoutSeconds,
  resolveCommandTimeoutTier,
  type CommandTimeoutTracker,
} from "../../daemon/mcp/gateway";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import { initRepo } from "../helpers/e2e-repo";
import { diskDeleteBlocked, safeRmSync } from "../helpers/tmp";

/**
 * TASK-D.3：D-2 / D-5 的**生产调用点**验收。
 *
 * 引擎本身的行为已由 deadlock-resilience.test.ts 覆盖；这里只回答一个问题：
 * 真实的互斥锁与 Gateway 是否真的把事件交给了看门狗（而不是只写了个钩子没人调用）。
 */

const tmpDirs: string[] = [];

/**
 * 受限环境探测：沙箱的 safe-delete 垫片在同一轮内累计 50 次删除后，会以
 * `SAFE_DELETE_BULK_CONFIRM_REQUIRED` 拒绝后续删除调用。
 *
 * 后果：`withContractLock` 释放锁时的 `unlinkSync` 被环境拒绝（代码里的
 * try/catch 会吞掉），于是「锁文件已消失」在**全量运行**里不可观测——
 * 那不是锁没释放，而是环境拒绝执行删除。此时只断言租约事件
 * （D-2 真正的契约），盘上断言退化为跳过，并在用例名/注释里写明原因。
 * 探测逻辑已抽到 `tests/helpers/tmp.ts`，与各文件的临时目录清理共用同一判据。
 */

function newRepo(): string {
  const base = path.join(process.cwd(), ".tmp", "unit-d3-sites");
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, "case-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  setContractLockLeaseObserver(null);
  for (const dir of tmpDirs.splice(0)) {
    try {
      resetContractLocks(dir);
      safeRmSync(dir);
    } catch {
      /* 受限环境可能拦截删除 */
    }
  }
});

describe("D-2：withContractLock 真实产生租约事件", () => {
  // 盘上断言在全量运行里可能被沙箱配额挡住，见 diskDeleteBlocked() 的说明；
  // 租约事件（acquire / renew / release）的断言在任何环境下都是严格的。
  it("持锁期间续租，结束后释放（同一 lockKey）", async () => {
    const repo = newRepo();
    const lockKey = contractLockPath(repo, "contract_1");

    const acquired: Array<[string, string]> = [];
    const released: Array<[string, string | undefined]> = [];
    let renewed = 0;

    setContractLockLeaseObserver({
      acquireLease(resource, owner) {
        acquired.push([resource, owner]);
      },
      renewLease() {
        renewed += 1;
        return true;
      },
      releaseLease(resource, owner) {
        released.push([resource, owner]);
        return true;
      },
    });

    const value = await withContractLock(
      lockKey,
      async () => {
        // 续租由真实计时器驱动：CI runner 一卡，固定 sleep 70ms 可能只跑到 1 次
        // （macOS runner 上稳定只跑到 1 次）。这里等到「真的续上两次」再放行，
        // 断言仍然是「持锁期间定时续租在跑」，但不再拿墙钟赌调度。
        const deadline = Date.now() + 2_000;
        while (renewed < 2 && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return 42;
      },
      { heartbeatMs: 15 },
    );

    expect(value).toBe(42);
    expect(acquired).toHaveLength(1);
    expect(acquired[0]?.[0]).toBe(lockKey);
    expect(acquired[0]?.[1]).toBe(`pid:${process.pid}`);
    // 70ms / 15ms ≈ 4 次，至少证明定时续租真的在跑
    expect(renewed).toBeGreaterThanOrEqual(2);
    expect(released).toEqual([[lockKey, `pid:${process.pid}`]]);
    if (!diskDeleteBlocked()) expect(fs.existsSync(lockKey)).toBe(false);
  });

  it("fn 抛错时同样释放租约与盘锁（不留幽灵占用）", async () => {
    const repo = newRepo();
    const lockKey = contractLockPath(repo, "contract_2");

    let released = 0;
    setContractLockLeaseObserver({
      acquireLease() {
        return undefined;
      },
      renewLease() {
        return true;
      },
      releaseLease() {
        released += 1;
        return true;
      },
    });

    await expect(
      withContractLock(lockKey, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(released).toBe(1);
    if (!diskDeleteBlocked()) expect(fs.existsSync(lockKey)).toBe(false);
  });

  it("观察者为空时退化为原有行为（不抛错、锁照常释放）", async () => {
    const repo = newRepo();
    setContractLockLeaseObserver(null);
    const lockKey = contractLockPath(repo, "contract_3");
    await expect(withContractLock(lockKey, async () => "ok")).resolves.toBe(
      "ok",
    );
    if (!diskDeleteBlocked()) expect(fs.existsSync(lockKey)).toBe(false);
  });

  /**
   * D-2 的处置是五类看门狗里唯一带破坏性的动作（删文件）。
   * 白名单必须与锁路径同源：合同、证据、Worktree 一个都不许被当成「陈旧资源」。
   */
  it("回收白名单只放行 .stagent/locks/*.lock", () => {
    const repo = newRepo();
    expect(isContractLockResource(repo, contractLockPath(repo, "c1"))).toBe(
      true,
    );

    const evidence = path.join(repo, ".stagent", "evidence", "c1-evi_1.json");
    const worktree = path.join(repo, ".stagent", "worktrees", "task-c1");
    const contractFile = path.join(repo, ".stagent", "contracts", "c1.json");
    const sourceFile = path.join(repo, "src", "a.ts");
    // 越界尝试：锁目录之外、以及锁目录内但后缀不对
    const traversal = path.join(
      repo,
      ".stagent",
      "locks",
      "..",
      "contracts",
      "c1.json",
    );
    const wrongSuffix = path.join(repo, ".stagent", "locks", "notes.txt");

    expect(isContractLockResource(repo, evidence)).toBe(false);
    expect(isContractLockResource(repo, worktree)).toBe(false);
    expect(isContractLockResource(repo, contractFile)).toBe(false);
    expect(isContractLockResource(repo, sourceFile)).toBe(false);
    expect(isContractLockResource(repo, traversal)).toBe(false);
    expect(isContractLockResource(repo, wrongSuffix)).toBe(false);
    // 另一个仓库的锁也不在本仓白名单内（多仓并存时互不越界）
    expect(
      isContractLockResource(newRepo(), contractLockPath(repo, "c1")),
    ).toBe(false);
  });
});

describe("D-5：Gateway 真实登记 / 撤销命令超时", () => {
  function contractWithCommands(): SoftwareContract {
    const draft = createContractDraft({
      title: "D-5 接线",
      description: "命令超时登记",
      acceptanceCriteria: ["ok"],
      writablePaths: ["src/**"],
      commands: [
        {
          alias: "verify",
          executable: "node",
          args: ["-e", "process.exit(0)"],
          expected_exit_code: 0,
          timeout_seconds: 60,
        },
      ],
    });
    return softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "EXECUTING",
      approval: {
        status: "APPROVED",
        approved_by: "tina",
        approved_at: "2026-10-23T09:00:00.000Z",
        approved_revision: 1,
      },
    });
  }

  function recordingTracker(): CommandTimeoutTracker & {
    tracked: Array<Record<string, unknown>>;
    settled: string[];
    pids: Array<[string, number]>;
  } {
    const tracked: Array<Record<string, unknown>> = [];
    const settled: string[] = [];
    const pids: Array<[string, number]> = [];
    let seq = 0;
    return {
      tracked,
      settled,
      pids,
      trackCommand(input) {
        tracked.push(input as unknown as Record<string, unknown>);
        seq += 1;
        return { id: `cmd_${seq}` };
      },
      updateCommandPid(id, pid) {
        pids.push([id, pid]);
      },
      settleCommand(id) {
        settled.push(id);
      },
    };
  }

  it("执行命令时登记 tier/timeout，并在结束后撤销", async () => {
    const repo = initRepo("stagent-d5-");
    tmpDirs.push(repo);
    const tracker = recordingTracker();
    const contract = contractWithCommands();
    const gateway = new ScopedWorktreeGateway(repo, contract, {
      deadlock: tracker,
    });

    const result = await gateway.callTool("stagent_exec_command", {
      command_alias: "verify",
    });

    expect(result.isError).toBeFalsy();
    expect(tracker.tracked).toHaveLength(1);
    expect(tracker.tracked[0]).toMatchObject({
      contractId: contract.contract_id,
      command: "node -e process.exit(0)",
      tier: "SHORT",
      timeoutMs: 60_000,
    });
    // spawn 后回填过 pid，证明超时兜底能精确回收这棵树
    expect(tracker.pids.length).toBeGreaterThanOrEqual(1);
    expect(tracker.settled).toHaveLength(1);
  });

  it("分层换算：≤60 SHORT / ≤300 MEDIUM / >300 LONG", () => {
    expect(resolveCommandTimeoutTier(30)).toBe("SHORT");
    expect(resolveCommandTimeoutTier(60)).toBe("SHORT");
    expect(resolveCommandTimeoutTier(61)).toBe("MEDIUM");
    expect(resolveCommandTimeoutTier(300)).toBe("MEDIUM");
    expect(resolveCommandTimeoutTier(301)).toBe("LONG");
    expect(resolveCommandTimeoutTier(600)).toBe("LONG");
  });

  it("按合同声明的 timeout_seconds 取值，未声明时回退 60s", () => {
    const commands = [
      { executable: "node", args: ["-e", "x"], timeout_seconds: 120 },
      { executable: "npm", args: ["test"], timeout_seconds: 600 },
    ];
    expect(resolveCommandTimeoutSeconds("node -e x", commands)).toBe(120);
    expect(resolveCommandTimeoutSeconds("npm test", commands)).toBe(600);
    expect(resolveCommandTimeoutSeconds("bash script.sh", commands)).toBe(60);
  });
});
