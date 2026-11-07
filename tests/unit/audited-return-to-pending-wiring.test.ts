/**
 * TASK-AUDITED.2：生产接线自证（grep / 装配级）。
 *
 * - server contracts 正则含 return-to-pending
 * - orchestrator 含 returnToPending + USER_RETURN_TO_PENDING
 * - daemon-api 导出 returnContractToPending
 * - ContractCard 含退回待批 testid / 文案
 *
 * 纪律：不宣称端到端闭环；不改 state-machine 语义。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("TASK-AUDITED.2 production wiring self-proof", () => {
  it("orchestrator 暴露 returnToPending 且必带 USER_RETURN_TO_PENDING", () => {
    const src = read("daemon/pipeline/orchestrator.ts");
    expect(src).toContain("async returnToPending(");
    expect(src).toContain('reason: "USER_RETURN_TO_PENDING"');
    expect(src).toContain("withContractLock(");
    // 前置断言 AUDITED + APPROVED
    expect(src).toMatch(/lifecycle_state !== "AUDITED"/);
    expect(src).toMatch(/approval\.status !== "APPROVED"/);
  });

  it("server contracts 正则与 POST 处理器挂 return-to-pending", () => {
    const src = read("daemon/server.ts");
    expect(src).toMatch(
      /admit\|approve\|execute\|run-worker\|open-editor\|diff-files\|diff\|merge-decision\|merge\|evidence\|resume\|abort\|return-to-pending/,
    );
    expect(src).toContain('action === "return-to-pending"');
    expect(src).toContain("this.orchestrator.returnToPending(");
    expect(src).toContain("sendActionError");
  });

  it("daemon-api 导出 returnContractToPending 指向 return-to-pending", () => {
    const src = read("src/lib/daemon-api.ts");
    expect(src).toContain("export async function returnContractToPending");
    expect(src).toContain("/return-to-pending");
  });

  it("ContractCard 在 AUDITED+APPROVED 路径暴露退回待批", () => {
    const src = read("src/components/contract/ContractCard.tsx");
    expect(src).toContain("canReturnToPending");
    expect(src).toContain('data-testid="contract-return-to-pending"');
    expect(src).toContain("退回待批");
    expect(src).toContain("onReturnToPending");
    // 「批准并开工」语义仍在
    expect(src).toContain("批准并开工");
    expect(src).toContain('lifecycle_state === "PENDING_APPROVAL"');
  });
});
