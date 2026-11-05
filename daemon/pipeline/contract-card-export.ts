import fs from "node:fs";
import {
  renderContractCard,
  splitContract,
  type CardGovernanceInput,
  type ContractCard,
} from "../../src/lib/contract-card";
import {
  designNoteSchema,
  type DesignNote,
} from "../../src/lib/design/design-note";
import { designNotePath } from "../supervisor/design/design-step";
import { ContractStore } from "./contract-store";

export type ExportContractCardResult =
  | { ok: true; card: ContractCard; markdown: string }
  | {
      ok: false;
      reason:
        "CONTRACT_NOT_FOUND" | "DESIGN_NOTE_MISSING" | "DESIGN_NOTE_INVALID";
      message: string;
    };

/**
 * 把 `.stagent/` 里的合同 + design-note.json 导出成可入库的任务卡代码块。
 * 只读：不改合同、不写文件；运行时字段（审批、Worker、预算等）不进卡。
 */
export function exportContractCard(
  repoRoot: string,
  contractId: string,
  governance: CardGovernanceInput = {},
): ExportContractCardResult {
  const contract = new ContractStore(repoRoot).get(contractId);
  if (!contract) {
    return {
      ok: false,
      reason: "CONTRACT_NOT_FOUND",
      message: `合同不存在或无法解析：${contractId}`,
    };
  }
  const notePath = designNotePath(repoRoot, contractId);
  if (!fs.existsSync(notePath)) {
    return {
      ok: false,
      reason: "DESIGN_NOTE_MISSING",
      message: `合同 ${contractId} 还没有 DesignNote（设计步骤未完成），导不出卡：${notePath}`,
    };
  }
  const parsed = designNoteSchema.safeParse(
    JSON.parse(fs.readFileSync(notePath, "utf8")),
  );
  if (!parsed.success) {
    return {
      ok: false,
      reason: "DESIGN_NOTE_INVALID",
      message: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { card } = splitContract(
    contract,
    parsed.data as DesignNote,
    governance,
  );
  return { ok: true, card, markdown: renderContractCard(card) };
}
