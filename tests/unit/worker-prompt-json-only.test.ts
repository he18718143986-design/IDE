import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  WORKER_JSON_ONLY_USER_RULE,
  WORKER_PARSE_RETRY_STRICT_SUFFIX,
} from "../../daemon/worker/openai-client";
import { buildWorkerTaskInstruction } from "../../daemon/worker/session-task-injector";
import { MANAGED_AI_CAPABILITY } from "../../daemon/worker/worker-adapter.interface";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";

/**
 * TASK-J.57：锁系统提示与首轮/重试用户提示的 JSON-only 与禁工具标记。
 * it() 标题与卡面 test_plan.case 逐字一致。
 */

function canonicalPath(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

const WORKTREE = canonicalPath(
  fs.mkdtempSync(path.join(os.tmpdir(), "stagent-j57-prompt-")),
);

function approvedContract(): SoftwareContract {
  const draft = createContractDraft({
    title: "J.57 提示词约束",
    description: "验证 JSON-only 与禁工具标记",
    acceptanceCriteria: ["只返回 JSON 对象"],
    writablePaths: ["src/**"],
  });
  return softwareContractSchema.parse({
    ...draft,
    lifecycle_state: "EXECUTING",
    approval: {
      status: "APPROVED",
      approved_by: "tina",
      approved_at: new Date().toISOString(),
    },
  });
}

function instruction() {
  return buildWorkerTaskInstruction({
    contract: approvedContract(),
    worktreeRoot: WORKTREE,
    declaration: MANAGED_AI_CAPABILITY,
  });
}

function sectionBody(
  inst: ReturnType<typeof instruction>,
  title: string,
): string {
  const section = inst.sections.find((item) => item.title === title);
  expect(section, `missing section ${title}`).toBeDefined();
  return section!.body;
}

describe("TASK-J.57 Worker 提示词 JSON-only 与禁工具标记", () => {
  it("J57-P1: 系统提示输出契约要求本轮只输出 {changes, log} JSON，禁止自然语言开场、围栏和 DSML/<tool_call> 等工具调用标记，并写明写入由 Daemon 落地", () => {
    const inst = instruction();
    const body = sectionBody(inst, "输出契约");
    expect(body).toContain("本轮回复必须是合法 JSON 对象");
    expect(body).toContain("changes:[{path,content}]");
    expect(body).toContain("log:string[]");
    expect(body).toContain("禁止自然语言开场");
    expect(body).toContain("禁止 markdown 围栏");
    expect(body).toContain("DSML");
    expect(body).toContain("<tool_call>");
    expect(body).toContain("写入由 Daemon 根据该 JSON 经受管工具落地");
    expect(inst.system_prompt).toContain("## 输出契约");
    expect(inst.system_prompt).toContain(body);
  });

  it("J57-P2: 角色与边界不再出现「你必须通过受管工具读写」，也不要求模型在回复里发出工具调用", () => {
    const inst = instruction();
    const body = sectionBody(inst, "角色与边界");
    expect(body).not.toContain("你必须通过受管工具读写");
    expect(inst.system_prompt).not.toContain("你必须通过受管工具读写");
    expect(body).toContain("本轮你只返回一个 JSON 对象");
    expect(body).toContain("由 Daemon 在模型之外经 stagent_* 受管工具落地");
    expect(body).toContain("不要在回复里发出工具调用标记");
  });

  it("J57-P3: 可用工具段首标明这是授权范围说明，不是要模型在回复里发工具调用", () => {
    const inst = instruction();
    const body = sectionBody(inst, "可用工具");
    const lead =
      "下列名称是合同授权与范围说明，不是要你在本轮回复里发出工具调用。";
    expect(body.startsWith(lead)).toBe(true);
    expect(body).toContain("写入由 Daemon 根据你返回的 JSON 落地");
    const toolsHeading = inst.system_prompt.indexOf("## 可用工具");
    expect(toolsHeading).toBeGreaterThanOrEqual(0);
    expect(inst.system_prompt.slice(toolsHeading)).toContain(lead);
  });

  it("J57-P4: known_limitations 不再写「仅能调用 stagent_* 受管工具」，改为写入与执行只经 Daemon 侧 stagent_*、模型不得输出工具调用标记", () => {
    const inst = instruction();
    const rewritten =
      "写入与执行只经 Daemon 侧 stagent_* 受管工具，模型不得输出工具调用标记；无原生 Shell 与直接文件系统访问能力";
    expect(MANAGED_AI_CAPABILITY.known_limitations).toContain(rewritten);
    expect(
      MANAGED_AI_CAPABILITY.known_limitations.some((item) =>
        item.includes("仅能调用 stagent_* 受管工具"),
      ),
    ).toBe(false);
    expect(inst.known_limitations).toContain(rewritten);
    expect(inst.system_prompt).toContain(rewritten);
    expect(inst.system_prompt).not.toContain("仅能调用 stagent_* 受管工具");
  });

  it("J57-P5: 首轮用户提示含 JSON-only 与禁工具标记，strictSuffix 同步点名禁止 DSML/<tool_call>", () => {
    expect(WORKER_JSON_ONLY_USER_RULE).toContain("只返回合法 JSON 对象");
    expect(WORKER_JSON_ONLY_USER_RULE).toContain("changes:[{path,content}]");
    expect(WORKER_JSON_ONLY_USER_RULE).toContain("log:string[]");
    expect(WORKER_JSON_ONLY_USER_RULE).toContain("禁止自然语言开场");
    expect(WORKER_JSON_ONLY_USER_RULE).toContain("禁止 markdown 围栏");
    expect(WORKER_JSON_ONLY_USER_RULE).toContain("DSML");
    expect(WORKER_JSON_ONLY_USER_RULE).toContain("<tool_call>");
    expect(WORKER_JSON_ONLY_USER_RULE).toContain("写入由 Daemon 落地");

    expect(WORKER_PARSE_RETRY_STRICT_SUFFIX.startsWith("\n\n【重试】")).toBe(
      true,
    );
    expect(WORKER_PARSE_RETRY_STRICT_SUFFIX).toContain(
      WORKER_JSON_ONLY_USER_RULE,
    );
    expect(WORKER_PARSE_RETRY_STRICT_SUFFIX).toContain("DSML");
    expect(WORKER_PARSE_RETRY_STRICT_SUFFIX).toContain("<tool_call>");

    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../daemon/worker/openai-client.ts"),
      "utf8",
    );
    expect(source).toContain("WORKER_JSON_ONLY_USER_RULE");
    expect(source).toContain(
      "const strictSuffix = WORKER_PARSE_RETRY_STRICT_SUFFIX",
    );
    expect(source).toMatch(
      /attempt === 0 \? basePrompt : basePrompt \+ strictSuffix/,
    );
  });
});
