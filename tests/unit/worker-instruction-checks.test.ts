import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildWorkerTaskInstruction,
  renderChecksSection,
} from "../../daemon/worker/session-task-injector";
import { MANAGED_AI_CAPABILITY } from "../../daemon/worker/worker-adapter.interface";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";

/**
 * TASK-L.2：Worker 指令补全「你会被这样检查」。
 *
 * 验收：
 * - 两条命令 → 指令含两条 argv 与期望退出码，且位于「输出契约」之前；
 * - 无命令 + manual_confirmation → 人工确认句，不含命令列表；
 * - renderChecksSection(contract, ["X"]) 输出包含 X。
 */

function canonicalPath(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

const WORKTREE = canonicalPath(
  fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l2-checks-")),
);

function approvedContract(
  overrides: Parameters<typeof createContractDraft>[0],
): SoftwareContract {
  const draft = createContractDraft(overrides);
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

describe("TASK-L.2 renderChecksSection / 你会被这样检查", () => {
  it("两条命令的合同 → 指令含两条 argv 与期望退出码，且位于「输出契约」之前", () => {
    const contract = approvedContract({
      title: "L.2 双命令",
      description: "验证指令列出检查命令",
      acceptanceCriteria: ["检查段完整"],
      writablePaths: ["src/**"],
      commands: [
        {
          alias: "unit",
          executable: "npm",
          args: ["test", "--", "tests/unit"],
          expected_exit_code: 0,
          timeout_seconds: 60,
        },
        {
          alias: "typecheck",
          executable: "npx",
          args: ["tsc", "--noEmit"],
          expected_exit_code: 0,
          timeout_seconds: 120,
        },
      ],
    });

    const section = renderChecksSection(contract);
    expect(section.title).toBe("你会被这样检查");
    expect(section.body).toContain("npm test -- tests/unit");
    expect(section.body).toContain("npx tsc --noEmit");
    expect(section.body).toContain("期望退出码 0");
    expect(section.body).toContain("别名 unit");
    expect(section.body).toContain("别名 typecheck");
    expect(section.body).not.toContain("本合同没有自动检查");

    const instruction = buildWorkerTaskInstruction({
      contract,
      worktreeRoot: WORKTREE,
      declaration: MANAGED_AI_CAPABILITY,
    });

    const titles = instruction.sections.map((s) => s.title);
    const checksIdx = titles.indexOf("你会被这样检查");
    const outputIdx = titles.indexOf("输出契约");
    expect(checksIdx).toBeGreaterThan(-1);
    expect(outputIdx).toBeGreaterThan(-1);
    expect(checksIdx).toBeLessThan(outputIdx);

    expect(instruction.system_prompt).toContain("## 你会被这样检查");
    expect(instruction.system_prompt).toContain("npm test -- tests/unit");
    expect(instruction.system_prompt).toContain("npx tsc --noEmit");

    const checksPos = instruction.system_prompt.indexOf("## 你会被这样检查");
    const outputPos = instruction.system_prompt.indexOf("## 输出契约");
    expect(checksPos).toBeGreaterThan(-1);
    expect(outputPos).toBeGreaterThan(checksPos);
  });

  it("无命令 + manual_confirmation → 指令含人工确认句，不含命令列表", () => {
    const contract = approvedContract({
      title: "L.2 人工确认",
      description: "无自动检查",
      acceptanceCriteria: ["用户点确认"],
      writablePaths: ["docs/**"],
      commands: [],
      manualConfirmation: {
        reason_required: true,
        capture_evidence: ["actor", "confirmed_at", "reason"],
      },
    });

    expect(contract.verification_spec.commands).toEqual([]);
    expect(contract.verification_spec.manual_confirmation).toBeDefined();

    const section = renderChecksSection(contract);
    expect(section.body).toBe("本合同没有自动检查，完成后由用户人工确认");
    expect(section.body).not.toMatch(/期望退出码/);
    expect(section.body).not.toMatch(/别名 /);

    const instruction = buildWorkerTaskInstruction({
      contract,
      worktreeRoot: WORKTREE,
      declaration: MANAGED_AI_CAPABILITY,
    });
    expect(instruction.system_prompt).toContain(
      "本合同没有自动检查，完成后由用户人工确认",
    );
    expect(instruction.system_prompt).not.toMatch(/期望退出码 \d+/);
  });

  it('renderChecksSection(contract, ["X"]) 输出包含 X', () => {
    const contract = approvedContract({
      title: "L.2 extras",
      description: "extras 追加",
      acceptanceCriteria: ["含 X"],
      writablePaths: ["src/**"],
      commands: [
        {
          alias: "test",
          executable: "npm",
          args: ["test"],
          expected_exit_code: 0,
          timeout_seconds: 60,
        },
      ],
    });

    const section = renderChecksSection(contract, ["X"]);
    expect(section.body).toContain("X");
    expect(section.body).toContain("npm test");
    expect(section.body.indexOf("npm test")).toBeLessThan(
      section.body.indexOf("X"),
    );
  });
});
