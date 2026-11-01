/**
 * TASK-W.6：受控 Worker 派工门禁与 OCP 验收。
 *
 * 覆盖：
 * A. 门禁函数：已注册受控 / 未注册 / UNCONTROLLED_EXTERNAL / 已注册但未挂工厂，
 *    分别返回工厂或抛带 `code` 的 `WorkerDispatchError`，绝不静默降级。
 * B. 默认注册表：内置两个 id 受控可解析；Claude Code worker 登记为
 *    UNCONTROLLED_EXTERNAL、不可派工（红线：外部助手不得当受控证据）。
 * C. OCP 静态边界：orchestrator 源码不得 import 具体适配器类、不得写死
 *    `new AiWorker(...)`；Fake 只能经 Registry 到达派工。
 * D. 真实派工路径（repo + orchestrator）：
 *    - 正例：合同 adapter_id 指向 FakeControlledWorkerAdapter 时派工与产物收集完成；
 *    - 负例：未注册 adapter_id → `E_ADAPTER_NOT_REGISTERED`；
 *    - 负例：指向 UNCONTROLLED_EXTERNAL 适配器 → `E_ADAPTER_NOT_CONTROLLED`。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeRmSync } from "../helpers/tmp";
import { git } from "../helpers/git";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import { ContractStore } from "../../daemon/pipeline/contract-store";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import { AdapterRegistry } from "../../daemon/worker/adapter-registry";
import {
  MANAGED_AI_CAPABILITY,
  type CodingWorkerAdapter,
} from "../../daemon/worker/worker-adapter.interface";
import {
  E_ADAPTER_NOT_REGISTERED,
  E_ADAPTER_NOT_CONTROLLED,
  E_ADAPTER_NO_DISPATCH_FACTORY,
  WorkerDispatchError,
  requireControlledDispatch,
  type WorkerDispatchContext,
  type WorkerDispatchFactory,
} from "../../daemon/worker/worker-dispatch";
import {
  createDefaultWorkerRegistry,
  BUILTIN_AI_SDK_ADAPTER_ID,
  MANAGED_AI_ADAPTER_ID,
  CLAUDE_CODE_WORKER_ADAPTER_ID,
} from "../../daemon/worker/default-worker-registry";
import type {
  WorkerChange,
  WorkerModelClient,
} from "../../daemon/worker/ai-worker";

const FAKE_ADAPTER_ID = "test.fake-controlled.v0";
const UNCONTROLLED_ID = "test.uncontrolled-external.v0";

/** 测试用受控适配器：能力声明克隆内置声明并改 id，保证能过 GATEWAY_ENFORCED 校验 */
function fakeControlledAdapter(adapterId: string): CodingWorkerAdapter {
  return {
    declaration: { ...MANAGED_AI_CAPABILITY, adapter_id: adapterId },
    kind: "MANAGED_AI",
    run: async () => ({
      changes: [],
      log: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    }),
  };
}

const FAKE_CHANGES: WorkerChange[] = [
  { path: "src/from-fake.ts", content: "export const fromFake = true;\n" },
];

/** 不会被真实调用的模型客户端桩：Fake 工厂返回固定产物，不触发任何网络 */
const stubModelClient: WorkerModelClient = {
  generateChanges: async () => ({
    changes: [],
    log: [],
    usage: { inputTokens: 0, outputTokens: 0 },
  }),
};

describe("A. 派工门禁 requireControlledDispatch", () => {
  it("已注册受控 + 已挂工厂 → 返回工厂", () => {
    const registry = new AdapterRegistry();
    registry.register(fakeControlledAdapter(FAKE_ADAPTER_ID), "GATEWAY_ENFORCED");
    const factory: WorkerDispatchFactory = () => ({
      run: async () => ({
        applied: true,
        changes: [],
        log: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        blockers: [],
      }),
    });
    registry.registerDispatchFactory(FAKE_ADAPTER_ID, factory);

    expect(requireControlledDispatch(registry, FAKE_ADAPTER_ID)).toBe(factory);
  });

  it("未注册 adapter_id → E_ADAPTER_NOT_REGISTERED（明确错误码，不降级）", () => {
    const registry = new AdapterRegistry();
    const err: unknown = (() => {
      try {
        requireControlledDispatch(registry, "test.never-registered");
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(WorkerDispatchError);
    expect((err as WorkerDispatchError).code).toBe(E_ADAPTER_NOT_REGISTERED);
    expect((err as WorkerDispatchError).adapter_id).toBe(
      "test.never-registered",
    );
  });

  it("UNCONTROLLED_EXTERNAL 适配器 → E_ADAPTER_NOT_CONTROLLED（不得当受控证据）", () => {
    const registry = new AdapterRegistry();
    registry.register(
      fakeControlledAdapter(UNCONTROLLED_ID),
      "UNCONTROLLED_EXTERNAL",
    );
    // 即使挂了工厂，受控门禁也必须先拒绝
    registry.registerDispatchFactory(UNCONTROLLED_ID, () => ({
      run: async () => ({
        applied: true,
        changes: [],
        log: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        blockers: [],
      }),
    }));

    const err: unknown = (() => {
      try {
        requireControlledDispatch(registry, UNCONTROLLED_ID);
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(WorkerDispatchError);
    expect((err as WorkerDispatchError).code).toBe(E_ADAPTER_NOT_CONTROLLED);
  });

  it("已注册受控但未挂派工工厂 → E_ADAPTER_NO_DISPATCH_FACTORY", () => {
    const registry = new AdapterRegistry();
    registry.register(fakeControlledAdapter(FAKE_ADAPTER_ID), "GATEWAY_ENFORCED");
    const err: unknown = (() => {
      try {
        requireControlledDispatch(registry, FAKE_ADAPTER_ID);
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(WorkerDispatchError);
    expect((err as WorkerDispatchError).code).toBe(
      E_ADAPTER_NO_DISPATCH_FACTORY,
    );
  });
});

describe("B. createDefaultWorkerRegistry 默认注册", () => {
  it("内置两个 id 均以 GATEWAY_ENFORCED 注册且都挂了派工工厂", () => {
    const registry = createDefaultWorkerRegistry();
    for (const id of [BUILTIN_AI_SDK_ADAPTER_ID, MANAGED_AI_ADAPTER_ID]) {
      expect(registry.has(id)).toBe(true);
      expect(registry.get(id)?.control_mode).toBe("GATEWAY_ENFORCED");
      expect(() => requireControlledDispatch(registry, id)).not.toThrow();
    }
  });

  it("Claude Code worker 登记为 UNCONTROLLED_EXTERNAL，派工被明确拒绝", () => {
    const registry = createDefaultWorkerRegistry();
    expect(registry.has(CLAUDE_CODE_WORKER_ADAPTER_ID)).toBe(true);
    expect(registry.get(CLAUDE_CODE_WORKER_ADAPTER_ID)?.control_mode).toBe(
      "UNCONTROLLED_EXTERNAL",
    );
    // 未挂工厂是第二重保险；但受控门禁必须先以 E_ADAPTER_NOT_CONTROLLED 拒绝
    expect(registry.getDispatchFactory(CLAUDE_CODE_WORKER_ADAPTER_ID)).toBeUndefined();
    const err: unknown = (() => {
      try {
        requireControlledDispatch(registry, CLAUDE_CODE_WORKER_ADAPTER_ID);
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(WorkerDispatchError);
    expect((err as WorkerDispatchError).code).toBe(E_ADAPTER_NOT_CONTROLLED);
  });

  it("每次调用返回独立实例（无全局单例，测试间不串味）", () => {
    const a = createDefaultWorkerRegistry();
    const b = createDefaultWorkerRegistry();
    expect(a).not.toBe(b);
    expect(a.list()).toHaveLength(3);
  });
});

describe("C. OCP 静态边界：orchestrator 不绑定具体适配器类", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "daemon", "pipeline", "orchestrator.ts"),
    "utf8",
  );

  it("不再写死 new AiWorker(...)", () => {
    expect(source).not.toContain("new AiWorker(");
  });

  it("不 import 具体适配器类（Fake / ClaudeCode / AiWorker 值导入）", () => {
    expect(source).not.toContain("FakeControlledWorkerAdapter");
    expect(source).not.toContain("ClaudeCodeAdapter");
    expect(source).not.toMatch(/import\s*\{\s*AiWorker\b/);
  });

  it("派工经 Registry 单一门禁（requireControlledDispatch）而非具体类", () => {
    expect(source).toContain("requireControlledDispatch");
    expect(source).toContain("createDefaultWorkerRegistry");
  });
});

describe("D. 真实派工路径：orchestrator 经 Registry 派工", () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-w6-dispatch-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(
      path.join(repo, "package.json"),
      JSON.stringify({
        name: "w6",
        private: true,
        scripts: { test: 'node -e "process.exit(0)"' },
      }),
      "utf8",
    );
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);
  });

  afterEach(() => {
    safeRmSync(repo);
  });

  function seed(adapterId: string): SoftwareContract {
    const draft = createContractDraft({
      title: "W.6 dispatch",
      description: "registry-driven worker dispatch",
      acceptanceCriteria: ["能用"],
      writablePaths: ["src/**"],
      workerSpec: { adapter_id: adapterId },
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
    new ContractStore(repo).save(contract);
    return contract;
  }

  async function toExecuting(
    orchestrator: ContractOrchestrator,
    contract: SoftwareContract,
  ): Promise<void> {
    await orchestrator.approve(contract.contract_id, "tina");
  }

  it("正例：合同指向 FakeControlledWorkerAdapter → 派工与产物收集完成", async () => {
    const registry = new AdapterRegistry();
    registry.register(fakeControlledAdapter(FAKE_ADAPTER_ID), "GATEWAY_ENFORCED");

    let factoryCalls = 0;
    let workerRuns = 0;
    let captured: WorkerDispatchContext | null = null;
    const fakeFactory: WorkerDispatchFactory = (context) => {
      factoryCalls += 1;
      captured = context;
      return {
        run: async () => {
          workerRuns += 1;
          return {
            applied: true,
            changes: [...FAKE_CHANGES],
            log: ["fake worker ran"],
            usage: { inputTokens: 3, outputTokens: 7 },
            blockers: [],
          };
        },
      };
    };
    registry.registerDispatchFactory(FAKE_ADAPTER_ID, fakeFactory);

    const orchestrator = new ContractOrchestrator({ repoRoot: repo, registry });
    const contract = seed(FAKE_ADAPTER_ID);
    await toExecuting(orchestrator, contract);

    const result = await orchestrator.runWorker(contract.contract_id, {
      modelClient: stubModelClient,
      skipDesignStep: true,
      twoPhase: { obligations: [], waived: [] },
    });

    // Fake 只能经 Registry 到达派工：工厂与执行器都被真实调用
    expect(factoryCalls).toBe(1);
    expect(workerRuns).toBe(1);
    expect(captured).not.toBeNull();
    expect((captured as unknown as WorkerDispatchContext).contract.contract_id).toBe(
      contract.contract_id,
    );
    expect((captured as unknown as WorkerDispatchContext).repoRoot).toBe(repo);
    // 产物收集：Fake 执行器的结果原样出现在 runWorker 返回中
    expect(result.changes).toEqual(FAKE_CHANGES);
    expect(result.log).toContain("fake worker ran");
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 7 });
  });

  it("负例：未注册 adapter_id 的合同 → 派工拒绝 E_ADAPTER_NOT_REGISTERED", async () => {
    const registry = new AdapterRegistry(); // 空注册表
    const orchestrator = new ContractOrchestrator({ repoRoot: repo, registry });
    const contract = seed("test.never-registered");
    await toExecuting(orchestrator, contract);

    const err: unknown = await orchestrator
      .runWorker(contract.contract_id, {
        modelClient: stubModelClient,
        skipDesignStep: true,
        twoPhase: { obligations: [], waived: [] },
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(WorkerDispatchError);
    expect((err as WorkerDispatchError).code).toBe(E_ADAPTER_NOT_REGISTERED);
  });

  it("负例：指向 UNCONTROLLED_EXTERNAL 适配器 → 派工拒绝 E_ADAPTER_NOT_CONTROLLED", async () => {
    const registry = new AdapterRegistry();
    registry.register(
      fakeControlledAdapter(UNCONTROLLED_ID),
      "UNCONTROLLED_EXTERNAL",
    );
    const orchestrator = new ContractOrchestrator({ repoRoot: repo, registry });
    const contract = seed(UNCONTROLLED_ID);
    await toExecuting(orchestrator, contract);

    const err: unknown = await orchestrator
      .runWorker(contract.contract_id, {
        modelClient: stubModelClient,
        skipDesignStep: true,
        twoPhase: { obligations: [], waived: [] },
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(WorkerDispatchError);
    expect((err as WorkerDispatchError).code).toBe(E_ADAPTER_NOT_CONTROLLED);
  });
});
