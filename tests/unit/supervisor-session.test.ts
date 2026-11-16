import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  E_FORBIDDEN_PATH,
  E_SUPERVISOR_SESSION_INVALID,
  SupervisorSessionIdError,
  SupervisorSessionManager,
  SupervisorSessionValidationError,
} from "../../daemon/supervisor/session-manager";
import {
  SUPERVISOR_SYSTEM_PROMPT,
  buildSupervisorPrompt,
  estimateTokens,
} from "../../daemon/supervisor/prompt-builder";
import { SUPERVISOR_SESSION_SCHEMA_VERSION } from "../../daemon/supervisor/types";

/**
 * TASK-S.1 会话持久化 + Prompt 组装。
 *
 * 验收对应：
 * - PASS「会话文件原子落盘与恢复成功」；
 * - 0600 文件权限、0700 目录权限；
 * - 崩溃恢复：损坏文件隔离、孤儿临时文件清理、合法会话不受影响。
 */

const tmpDirs: string[] = [];

function newRepoDir(): string {
  const root = path.join(process.cwd(), ".tmp", "unit-supervisor");
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, "repo-"));
  tmpDirs.push(dir);
  return dir;
}

/** 单调递增时钟，保证 created_at / updated_at 可比较 */
function makeClock(startIso = "2026-10-20T00:00:00.000Z") {
  let tick = 0;
  const start = Date.parse(startIso);
  return () => new Date(start + tick++ * 1000);
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try {
      safeRmSync(dir);
    } catch {
      // 沙箱可能拦截 unlink，不影响断言结论
    }
  }
});

describe("Supervisor 会话落盘（Local-First / 0600 / 原子写入）", () => {
  it("创建会话：落盘到 .stagent/sessions/{id}.json，文件 0600、目录 0700", () => {
    const repo = newRepoDir();
    const manager = new SupervisorSessionManager(repo, { clock: makeClock() });

    const session = manager.create({ contractId: "c-001" });
    const file = manager.filePath(session.session_id);

    expect(file).toBe(
      path.join(repo, ".stagent", "sessions", `${session.session_id}.json`),
    );
    expect(fs.existsSync(file)).toBe(true);
    expect(session.schema_version).toBe(SUPERVISOR_SESSION_SCHEMA_VERSION);
    expect(session.contract_id).toBe("c-001");
    expect(session.messages).toEqual([]);
    expect(session.observation).toBe("ACTIVE");

    if (process.platform !== "win32") {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    }
  });

  it("加载与恢复：消息落盘后可原样读回，updated_at 随写入推进", () => {
    const repo = newRepoDir();
    const clock = makeClock();
    const manager = new SupervisorSessionManager(repo, { clock });

    const created = manager.create();
    const afterAppend = manager.appendMessage(created.session_id, {
      role: "user",
      source: "ui",
      text: "帮我把合同范围收窄到 src/lib",
    });

    expect(afterAppend.messages).toHaveLength(1);
    expect(afterAppend.updated_at > created.updated_at).toBe(true);
    expect(afterAppend.messages[0]?.message_id).toMatch(/^msg_/);

    const reloaded = manager.load(created.session_id);
    expect(reloaded).not.toBeNull();
    expect(reloaded?.messages).toHaveLength(1);
    expect(reloaded?.messages[0]?.text).toBe("帮我把合同范围收窄到 src/lib");
    expect(reloaded?.messages[0]?.source).toBe("ui");
  });

  it("列表按更新时间倒序，并统计消息数", () => {
    const repo = newRepoDir();
    const manager = new SupervisorSessionManager(repo, { clock: makeClock() });
    const first = manager.create({ contractId: "c-a" });
    manager.appendMessage(first.session_id, {
      role: "user",
      source: "ui",
      text: "第一条",
    });
    const second = manager.create({ contractId: "c-b" });

    const list = manager.list();
    expect(list.map((item) => item.session_id)).toEqual([
      second.session_id,
      first.session_id,
    ]);
    const firstSummary = list.find(
      (item) => item.session_id === first.session_id,
    );
    expect(firstSummary?.message_count).toBe(1);
    expect(firstSummary?.contract_id).toBe("c-a");
  });

  it("观察状态与预算快照可持久化（快照仅供展示）", () => {
    const repo = newRepoDir();
    const manager = new SupervisorSessionManager(repo, { clock: makeClock() });
    const session = manager.create();

    manager.setObservationState(session.session_id, "PAUSED");
    manager.updateUsage(session.session_id, {
      input_tokens: 1200,
      output_tokens: 300,
      cost_minor_units: 42,
      currency: "CNY",
    });

    const reloaded = manager.load(session.session_id);
    expect(reloaded?.observation).toBe("PAUSED");
    expect(reloaded?.usage).toMatchObject({
      input_tokens: 1200,
      output_tokens: 300,
      cost_minor_units: 42,
      currency: "CNY",
    });
  });

  it("清除单个会话与全部会话（§2.2 用户可清除本地会话）", () => {
    const repo = newRepoDir();
    const manager = new SupervisorSessionManager(repo, { clock: makeClock() });
    const first = manager.create();
    const second = manager.create();

    expect(manager.clear(first.session_id)).toBe(true);
    expect(manager.load(first.session_id)).toBeNull();
    expect(manager.clear(first.session_id)).toBe(false);
    expect(manager.clearAll()).toBe(1);
    expect(manager.load(second.session_id)).toBeNull();
  });
});

describe("损坏文件隔离与原子恢复", () => {
  it("崩溃残留的半截 JSON 被隔离为 .corrupt-*，健康会话完好保留", () => {
    const repo = newRepoDir();
    const clock = makeClock();
    const manager = new SupervisorSessionManager(repo, { clock });
    const healthy = manager.create();
    manager.appendMessage(healthy.session_id, {
      role: "user",
      source: "ui",
      text: "保留我",
    });

    const sessionsDir = manager.directory;
    const brokenId = "ses_broken0000000001";
    const brokenFile = path.join(sessionsDir, `${brokenId}.json`);
    fs.writeFileSync(
      brokenFile,
      '{"schema_version":"1.0.0","session_id":"ses_',
    );

    const report = manager.recover();

    expect(report.sessions.map((item) => item.session_id)).toEqual([
      healthy.session_id,
    ]);
    expect(report.quarantined).toHaveLength(1);
    expect(report.quarantined[0]?.file).toBe(`${brokenId}.json`);
    expect(report.quarantined[0]?.quarantined_as).toMatch(
      new RegExp(`^${brokenId}\\.json\\.corrupt-\\d+$`),
    );
    expect(fs.existsSync(brokenFile)).toBe(false);
    // 隔离而非删除：排障证据仍在
    const quarantined = fs
      .readdirSync(sessionsDir)
      .filter((name) => name.includes(".corrupt-"));
    expect(quarantined).toHaveLength(1);
    expect(manager.load(healthy.session_id)?.messages).toHaveLength(1);
  });

  it("孤儿临时文件（写中断残留）在恢复时清理", () => {
    const repo = newRepoDir();
    const manager = new SupervisorSessionManager(repo, { clock: makeClock() });
    const session = manager.create();

    const orphan = path.join(
      manager.directory,
      `.${session.session_id}.json.tmp-999-1700000000000`,
    );
    fs.writeFileSync(orphan, '{"partial": tru');

    const report = manager.recover();

    expect(report.removed_temp_files).toEqual([
      `.${session.session_id}.json.tmp-999-1700000000000`,
    ]);
    expect(fs.existsSync(orphan)).toBe(false);
    expect(report.sessions).toHaveLength(1);
    expect(report.quarantined).toHaveLength(0);
  });

  it("schema_version 不匹配的会话被隔离，不允许静默按新结构读取", () => {
    const repo = newRepoDir();
    const manager = new SupervisorSessionManager(repo, { clock: makeClock() });
    const session = manager.create();
    const file = manager.filePath(session.session_id);
    const payload = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<
      string,
      unknown
    >;
    fs.writeFileSync(
      file,
      JSON.stringify({ ...payload, schema_version: "0.9.0" }),
    );

    const report = manager.recover();

    expect(report.sessions).toHaveLength(0);
    expect(report.quarantined[0]?.reason).toContain(
      "unsupported schema_version",
    );
  });

  it("原子写入不留中间态：并发保存后读到的始终是完整结构", () => {
    const repo = newRepoDir();
    const manager = new SupervisorSessionManager(repo, { clock: makeClock() });
    const session = manager.create();

    for (let i = 0; i < 20; i += 1) {
      manager.appendMessage(session.session_id, {
        role: "user",
        source: "ui",
        text: `第 ${i} 条`,
      });
      const current = manager.load(session.session_id);
      expect(current?.messages).toHaveLength(i + 1);
    }

    const leftovers = fs
      .readdirSync(manager.directory)
      .filter((name) => name.includes(".tmp-"));
    expect(leftovers).toEqual([]);
  });
});

describe("session_id 白名单（阻断路径穿越）", () => {
  it.each([
    "../../etc/passwd",
    "../secrets",
    "ses/../../x",
    ".hidden-id",
    "short",
  ])("拒绝非法 id：%s", (bad) => {
    const repo = newRepoDir();
    const manager = new SupervisorSessionManager(repo);
    expect(() => manager.filePath(bad)).toThrow(SupervisorSessionIdError);
    expect(() => manager.load(bad)).toThrow(SupervisorSessionIdError);
    try {
      manager.filePath(bad);
    } catch (err) {
      expect((err as SupervisorSessionIdError).code).toBe(E_FORBIDDEN_PATH);
    }
  });
});

describe("非法会话结构拒绝落盘", () => {
  it("消息角色非法时抛 E_SUPERVISOR_SESSION_INVALID，且不覆盖已有文件", () => {
    const repo = newRepoDir();
    const manager = new SupervisorSessionManager(repo, { clock: makeClock() });
    const session = manager.create();
    const before = fs.readFileSync(
      manager.filePath(session.session_id),
      "utf-8",
    );

    const invalid = {
      ...session,
      messages: [
        {
          message_id: "msg_1",
          role: "tool" as unknown as "user",
          text: "越权工具消息",
          created_at: new Date().toISOString(),
          source: "ui" as const,
        },
      ],
    };

    expect(() => manager.save(invalid)).toThrow(
      SupervisorSessionValidationError,
    );
    try {
      manager.save(invalid);
    } catch (err) {
      expect((err as SupervisorSessionValidationError).code).toBe(
        E_SUPERVISOR_SESSION_INVALID,
      );
    }

    const after = fs.readFileSync(
      manager.filePath(session.session_id),
      "utf-8",
    );
    expect(after).toBe(before);
  });
});

describe("Prompt 组装流水线", () => {
  it("包含权限边界 / 项目现状 / 架构约束 / 对话上下文 / 输出格式五段", () => {
    const repo = newRepoDir();
    const manager = new SupervisorSessionManager(repo, { clock: makeClock() });
    const session = manager.create({ contractId: "c-prompt" });

    const prompt = buildSupervisorPrompt({
      session,
      context: {
        project: {
          repo_root: repo,
          branch: "feat/supervisor",
          dirty: true,
          recent_files: ["daemon/supervisor/session-manager.ts"],
          contract: {
            contract_id: "c-prompt",
            lifecycle_state: "EXECUTING",
            approval_status: "APPROVED",
            contract_revision: 3,
            objective: "实现 Supervisor 会话",
            scope_paths: ["daemon/supervisor/**"],
            cost_limits: { max_cost_minor_units: 20000, currency: "CNY" },
          },
        },
        architecture: {
          constraints: ["Daemon 是唯一权威控制面"],
          forbidden_dependencies: ["supervisor -> mcp/gateway"],
        },
        event_digests: ["EVIDENCE_STATUS_CHANGED: STALE"],
      },
    });

    expect(prompt.sections.map((section) => section.title)).toEqual([
      "角色与权限边界",
      "项目现状",
      "架构约束",
      "最近事件摘要",
      "对话上下文",
      "输出格式",
    ]);
    expect(prompt.text).toContain("feat/supervisor");
    expect(prompt.text).toContain("c-prompt");
    expect(prompt.text).toContain("supervisor -> mcp/gateway");
    expect(prompt.text).toContain("unresolved_questions");
    expect(prompt.truncated).toBe(false);
    expect(prompt.estimated_input_tokens).toBe(estimateTokens(prompt.text, 4));
  });

  it("系统提示明确声明零工具与不可批准/合并（G-11b 语义前置）", () => {
    expect(SUPERVISOR_SYSTEM_PROMPT).toContain("没有任何工具");
    expect(SUPERVISOR_SYSTEM_PROMPT).toContain("不能批准合同");
    expect(SUPERVISOR_SYSTEM_PROMPT).toContain("不能触发合并");
    expect(SUPERVISOR_SYSTEM_PROMPT).toContain("unresolved_questions");
  });

  it("按预算从新到旧裁剪对话窗口，并登记被丢弃的消息 id", () => {
    const repo = newRepoDir();
    const manager = new SupervisorSessionManager(repo, { clock: makeClock() });
    const session = manager.create();

    const messages = Array.from({ length: 30 }, (_, index) => ({
      message_id: `msg_${String(index).padStart(3, "0")}`,
      role: "user" as const,
      source: "ui" as const,
      text: `第 ${index} 条消息：${"上下文".repeat(30)}`,
      created_at: new Date(
        Date.parse("2026-10-20T00:00:00.000Z") + index * 1000,
      ).toISOString(),
    }));

    const prompt = buildSupervisorPrompt({
      session: { ...session, messages },
      context: {
        project: { repo_root: repo },
        architecture: { constraints: ["单一职责"] },
      },
      policy: { max_input_tokens: 500, max_messages: 30 },
    });

    expect(prompt.truncated).toBe(true);
    expect(prompt.dropped_message_ids.length).toBeGreaterThan(0);
    expect(prompt.text).toContain("第 29 条消息");
    expect(prompt.text).not.toContain("第 0 条消息");
  });

  it("单条消息超预算时按字符截断，且不把已纳入的消息误记为丢弃", () => {
    const repo = newRepoDir();
    const manager = new SupervisorSessionManager(repo, { clock: makeClock() });
    const session = manager.create();

    const messages = [
      {
        message_id: "msg_old",
        role: "user" as const,
        source: "ui" as const,
        text: "更早的上下文",
        created_at: "2026-10-20T00:00:00.000Z",
      },
      {
        message_id: "msg_huge",
        role: "user" as const,
        source: "ui" as const,
        text: "长".repeat(4000),
        created_at: "2026-10-20T00:00:01.000Z",
      },
    ];

    const prompt = buildSupervisorPrompt({
      session: { ...session, messages },
      context: {
        project: { repo_root: repo },
        architecture: { constraints: [] },
      },
      policy: { max_input_tokens: 600 },
    });

    expect(prompt.truncated).toBe(true);
    expect(prompt.dropped_message_ids).toEqual(["msg_old"]);
    expect(prompt.dropped_message_ids).not.toContain("msg_huge");
    expect(prompt.text).toContain("…[truncated]");
  });

  it("窗口条数上限生效，且保留最近 N 条", () => {
    const repo = newRepoDir();
    const manager = new SupervisorSessionManager(repo, { clock: makeClock() });
    const session = manager.create();
    const messages = Array.from({ length: 12 }, (_, index) => ({
      message_id: `msg_${index}`,
      role: "user" as const,
      source: "ui" as const,
      text: `消息 ${index}`,
      created_at: new Date(
        Date.parse("2026-10-20T00:00:00.000Z") + index * 1000,
      ).toISOString(),
    }));

    const prompt = buildSupervisorPrompt({
      session: { ...session, messages },
      context: {
        project: { repo_root: repo },
        architecture: { constraints: [] },
      },
      policy: { max_messages: 3, max_input_tokens: 100_000 },
    });

    expect(prompt.dropped_message_ids).toEqual([
      "msg_0",
      "msg_1",
      "msg_2",
      "msg_3",
      "msg_4",
      "msg_5",
      "msg_6",
      "msg_7",
      "msg_8",
    ]);
    expect(prompt.text).toContain("消息 11");
    expect(prompt.text).not.toContain("消息 8");
  });

  it("J.35：有台账/信任档/回链字段时插入三段；缺省不伪造", () => {
    const repo = newRepoDir();
    const manager = new SupervisorSessionManager(repo, { clock: makeClock() });
    const session = manager.create();

    const without = buildSupervisorPrompt({
      session,
      context: {
        project: { repo_root: repo },
        architecture: { constraints: ["单一职责"] },
      },
    });
    expect(without.sections.map((s) => s.title)).not.toContain("台账方案摘要");
    expect(without.sections.map((s) => s.title)).not.toContain("信任档");
    expect(without.sections.map((s) => s.title)).not.toContain("回链核对摘要");
    expect(without.text).not.toContain("已覆盖");

    const withFields = buildSupervisorPrompt({
      session,
      context: {
        project: { repo_root: repo },
        architecture: { constraints: ["单一职责"] },
        scheme_summary: {
          title: "走查用方案",
          summary: "只改文案",
          scheme_revision: 3,
        },
        trust_tier: "standard",
        backlink_summary: {
          evaluation_ok: true,
          items: [
            { id: "ITEM-1", covered: true, turn_id: "turn_a" },
            { id: "ITEM-2", covered: false, reason: "unregistered" },
          ],
        },
      },
    });
    const titles = withFields.sections.map((s) => s.title);
    expect(titles).toContain("台账方案摘要");
    expect(titles).toContain("信任档");
    expect(titles).toContain("回链核对摘要");
    // 三段插在「对话上下文」之前
    expect(titles.indexOf("台账方案摘要")).toBeLessThan(
      titles.indexOf("对话上下文"),
    );
    expect(withFields.text).toContain("走查用方案");
    expect(withFields.text).toContain("只改文案");
    expect(withFields.text).toContain("方案修订号：3");
    expect(withFields.text).toContain("信任档：标准（standard）");
    expect(withFields.text).toContain("ITEM-1：已覆盖");
    expect(withFields.text).toContain("ITEM-2：未覆盖（unregistered）");
  });

  it("J.35：缺登记 / ai_inferred / 哈希不一致不得写成已覆盖", () => {
    const repo = newRepoDir();
    const manager = new SupervisorSessionManager(repo, { clock: makeClock() });
    const session = manager.create();

    const prompt = buildSupervisorPrompt({
      session,
      context: {
        project: { repo_root: repo },
        architecture: { constraints: [] },
        backlink_summary: {
          evaluation_ok: true,
          items: [
            { id: "G-1", covered: false, reason: "unregistered" },
            { id: "G-2", covered: false, reason: "ai_inferred" },
            { id: "G-3", covered: false, reason: "no_turn_evidence" },
          ],
        },
      },
    });
    expect(prompt.text).toContain("G-1：未覆盖（unregistered）");
    expect(prompt.text).toContain("G-2：未覆盖（ai_inferred）");
    expect(prompt.text).toContain("G-3：未覆盖（no_turn_evidence）");
    expect(prompt.text).not.toMatch(/G-1：已覆盖/);
    expect(prompt.text).not.toMatch(/G-2：已覆盖/);
    expect(prompt.text).not.toMatch(/G-3：已覆盖/);

    const hashFail = buildSupervisorPrompt({
      session,
      context: {
        project: { repo_root: repo },
        architecture: { constraints: [] },
        backlink_summary: {
          evaluation_ok: false,
          failure_reason: "hash_mismatch",
          items: [{ id: "G-4", covered: true, turn_id: "turn_x" }],
        },
      },
    });
    expect(hashFail.text).toContain("回链核对失败：hash_mismatch");
    expect(hashFail.text).toContain("G-4：未覆盖（evaluation_failed）");
    expect(hashFail.text).not.toMatch(/G-4：已覆盖/);
  });

  it("J.35：插入对齐段后对话窗裁剪与 dropped_message_ids 仍按预算生效", () => {
    const repo = newRepoDir();
    const manager = new SupervisorSessionManager(repo, { clock: makeClock() });
    const session = manager.create();
    const messages = Array.from({ length: 30 }, (_, index) => ({
      message_id: `msg_${String(index).padStart(3, "0")}`,
      role: "user" as const,
      source: "ui" as const,
      text: `第 ${index} 条消息：${"上下文".repeat(30)}`,
      created_at: new Date(
        Date.parse("2026-10-20T00:00:00.000Z") + index * 1000,
      ).toISOString(),
    }));

    const prompt = buildSupervisorPrompt({
      session: { ...session, messages },
      context: {
        project: { repo_root: repo },
        architecture: { constraints: ["单一职责"] },
        scheme_summary: {
          title: "对齐段",
          summary: "不改裁剪",
          scheme_revision: 1,
        },
        trust_tier: "light",
        backlink_summary: {
          evaluation_ok: true,
          items: [{ id: "X", covered: false, reason: "unregistered" }],
        },
      },
      policy: { max_input_tokens: 500, max_messages: 30 },
    });

    expect(prompt.truncated).toBe(true);
    expect(prompt.dropped_message_ids.length).toBeGreaterThan(0);
    expect(prompt.text).toContain("第 29 条消息");
    expect(prompt.text).not.toContain("第 0 条消息");
    expect(prompt.text).toContain("台账方案摘要");
  });
});
