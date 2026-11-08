/**
 * 合同卡（ContractCard）：SoftwareContract + DesignNote 的可入库导出形态。
 *
 * 一份合同拆成两半：
 * - 卡（本文件的 `contractCardSchema`）：「要做什么、改哪里、怎么验收」，随代码入库、随评审变化；
 * - 运行时（`ContractRuntime`）：审批、Worker、预算、Git 授权、快照绑定等，只属于 `.stagent/`。
 * `splitContract` 与 `joinContract` 互逆：`joinContract(...splitContract(c))` 与 `c` 深相等，
 * 所以 docs/ 里的任务卡就是导出的合同，而不是另一份手抄的清单。
 *
 * 卡比合同多两类字段，都只服务于入库文档、不回写合同：
 * - `design.touches[].symbols` / `design.test_plan[].case|debt`：让门禁能在代码里核对交付；
 * - `governance`：任务卡就绪标准 R-1～R-12 中合同不承载的部分（依赖、非目标、不变声明等）。
 */
import yaml from "js-yaml";
import { z } from "zod";
import {
  acceptanceRefSchema,
  manualConfirmationSpecSchema,
  riskLevelSchema,
  safePathString,
  softwareContractSchema,
  verificationCommandSchema,
  type AcceptanceRef,
  type LifecycleState,
  type ApprovalStatus,
  type SoftwareContract,
} from "./contract.schema";
import { designNoteSchema, type DesignNote } from "./design/design-note";

export const CONTRACT_CARD_FENCE_INFO = "yaml task-card";

export const CARD_STATUSES = [
  "NEW_TASK",
  "READY",
  "IN_PROGRESS",
  "BLOCKED",
  "COMPLETED",
  "DEFERRED",
  "SPLIT",
  "ABORTED",
] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

/** 进入这些状态后，DoR 必须成立（依赖已完成、无未决问题、不是 L）。 */
export const COMMITTED_STATUSES: readonly CardStatus[] = [
  "READY",
  "IN_PROGRESS",
  "COMPLETED",
];

/** 合同双状态机 → 卡状态。BLOCKED / DEFERRED / SPLIT 是排期概念，合同里没有对应。 */
export function cardStatusOf(
  lifecycle: LifecycleState,
  approval: ApprovalStatus,
): CardStatus {
  switch (lifecycle) {
    case "DRAFT":
    case "PENDING_APPROVAL":
      return "NEW_TASK";
    case "PREPARING":
      return approval === "APPROVED" ? "READY" : "NEW_TASK";
    case "EXECUTING":
    case "VERIFYING":
    case "PENDING_RESUME":
    case "AUDITED":
      return "IN_PROGRESS";
    case "MERGED":
      return "COMPLETED";
    case "ABORTED":
      return "ABORTED";
  }
}

const IDENTIFIER = z.string().regex(/^[A-Za-z_$][\w$]*$/);

/** 文档引用：`docs/x.md` 或 `docs/x.md#anchor`。 */
const DOC_REF = z.string().regex(/^docs\/[^#\s]+\.md(#[^\s]+)?$/, {
  message: "规格引用形如 docs/specs/x.md#anchor",
});

/** 代码事实：`path::symbol` 或 `path:line` / `path:start-end`。 */
const CODE_REF = z
  .string()
  .regex(/^[^:\s]+(::[A-Za-z_$][\w$.]*|:\d+(-\d+)?)$/, {
    message: "代码事实形如 path::symbol 或 path:10-20",
  });

const intentShape = softwareContractSchema.shape.intent.shape;
const noteShape = designNoteSchema.shape;

const cardContractSchema = z
  .object({
    intent: z
      .object({
        title: intentShape.title,
        description: intentShape.description,
        /** 省略即等于 acceptance 各条的 text；只有两者不同的旧合同才会写出 */
        acceptance_criteria: intentShape.acceptance_criteria.optional(),
        risk_level: riskLevelSchema,
      })
      .strict(),
    acceptance: z
      .array(acceptanceRefSchema.strict())
      .min(1)
      .max(12, { message: "验收超过 12 条必须拆卡（任务卡标准 §4）" }),
    scheme_item_ids: z.array(z.string().min(1)).default([]),
    scope: z
      .object({
        writable_paths: z.array(safePathString).min(1, "empty scope rejected"),
        readonly_paths: z.array(safePathString).default([]),
        strictly_forbidden_paths: z.array(z.string()).default([]),
      })
      .strict(),
    verification: z
      .object({
        commands: z.array(verificationCommandSchema.strict()),
        manual_confirmation: manualConfirmationSpecSchema.optional(),
      })
      .strict(),
    dependency_changes_allowed: z.boolean().default(false),
  })
  .strict();

const cardDesignSchema = z
  .object({
    approach: noteShape.approach,
    touches: z
      .array(
        noteShape.touches.element
          .extend({ symbols: z.array(IDENTIFIER).default([]) })
          .strict(),
      )
      .min(1),
    interfaces: noteShape.interfaces.default([]),
    data_changes: noteShape.data_changes.default([]),
    dependencies: noteShape.dependencies.default([]),
    decisions: noteShape.decisions.default([]),
    test_plan: z.array(
      noteShape.test_plan.element
        .extend({
          /** 用例标题里的一段原文，用来在测试文件里定位 it(...) */
          case: z.string().min(1).optional(),
          /** 已知没有测试兑现时写明原因与台账去向；补上测试后必须删掉 */
          debt: z.string().min(1).optional(),
        })
        .strict(),
    ),
    knowledge_delta: noteShape.knowledge_delta.default({
      modules_upsert: [],
      decisions_add: [],
      overview_changed: false,
    }),
  })
  .strict();

const governanceSchema = z
  .object({
    /** R-1：docs/ 内的规格出处；合同侧的出处是 contract.scheme_item_ids */
    spec_refs: z.array(DOC_REF).default([]),
    /** R-3：soft 不阻断开工 */
    depends_on: z
      .array(
        z
          .object({
            id: z.string().min(1),
            kind: z.enum(["hard", "soft"]).default("hard"),
          })
          .strict(),
      )
      .default([]),
    /** R-4：今天的代码哪里不对 */
    code_facts: z
      .array(z.object({ ref: CODE_REF, note: z.string().min(1) }).strict())
      .default([]),
    /** R-6 */
    non_goals: z.array(z.string().min(1)).default([]),
    /** R-8 */
    fail: z.array(z.string().min(1)).default([]),
    /** R-9 */
    adr_revisions: z
      .array(
        z
          .object({
            adr: z.string().regex(/^ADR-\d{4}$/),
            change: z.string().min(1),
          })
          .strict(),
      )
      .default([]),
    /** R-10 */
    defaults: z.array(z.string().min(1)).default([]),
    open_questions: z.array(z.string().min(1)).default([]),
    /** R-11 */
    estimate: z.enum(["S", "M", "L"]).optional(),
    /** R-12：unchanged，或写明变更及依据 */
    invariants: z
      .object({
        auth: z.string().min(1),
        demo_origin: z.string().min(1),
        illumination: z.string().min(1),
        gateway_write_scope: z.string().min(1),
      })
      .strict()
      .optional(),
    delivered: z
      .object({
        pr: z.number().int().positive(),
        commit: z.string().regex(/^[0-9a-f]{7,40}$/),
      })
      .strict()
      .optional(),
  })
  .strict();

export const contractCardSchema = z
  .object({
    /** = contract_id */
    id: z.string().min(1),
    status: z.enum(CARD_STATUSES),
    contract: cardContractSchema,
    design: cardDesignSchema,
    governance: governanceSchema.default(() => ({
      spec_refs: [],
      depends_on: [],
      code_facts: [],
      non_goals: [],
      fail: [],
      adr_revisions: [],
      defaults: [],
      open_questions: [],
    })),
  })
  .strict()
  .superRefine((card, ctx) => {
    const ids = card.contract.acceptance.map((a) => a.id);
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dup) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contract", "acceptance"],
        message: `验收 id 重复：${dup}`,
      });
    }
    for (const [i, t] of card.design.test_plan.entries()) {
      if (!ids.includes(t.acceptance_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["design", "test_plan", i, "acceptance_id"],
          message: `test_plan 指向不存在的验收：${t.acceptance_id}`,
        });
      }
    }
    if (
      card.contract.verification.commands.length === 0 &&
      !card.contract.verification.manual_confirmation
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contract", "verification"],
        message:
          "至少一条验证命令，或声明 manual_confirmation（与合同 §1.1 同一条不变式）",
      });
    }
    if (COMMITTED_STATUSES.includes(card.status)) {
      if (card.governance.estimate === "L") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["governance", "estimate"],
          message: "估算 L 的卡不得进入 READY 及之后的状态，必须拆分（R-11）",
        });
      }
      if (card.governance.open_questions.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["governance", "open_questions"],
          message: "仍有未决问题的卡不得进入 READY 及之后的状态（R-10）",
        });
      }
    }
  });

export type ContractCard = z.infer<typeof contractCardSchema>;
export type ContractCardInput = z.input<typeof contractCardSchema>;
export type CardGovernance = z.infer<typeof governanceSchema>;
export type CardGovernanceInput = z.input<typeof governanceSchema>;

// ── 合同 ⇄ 卡 ──────────────────────────────────────────────────────────────

type SupervisorMetadata = NonNullable<SoftwareContract["supervisor_metadata"]>;

/** 合同里不进卡的那一半；原样留在 `.stagent/`。 */
export interface ContractRuntime {
  schema_version: SoftwareContract["schema_version"];
  contract_revision: number;
  created_at: string;
  creator: SoftwareContract["creator"];
  conversation_ref?: SoftwareContract["conversation_ref"];
  /** 去掉 acceptance_refs / scheme_item_ids 之后的元数据；合同原本没有则为 undefined */
  supervisor_metadata?: Omit<
    SupervisorMetadata,
    "acceptance_refs" | "scheme_item_ids"
  >;
  /** 合同原本是否携带 acceptance_refs / scheme_item_ids（决定 join 时是否写回） */
  carried: { acceptance_refs: boolean; scheme_item_ids: boolean };
  worker_spec: SoftwareContract["worker_spec"];
  contract_type?: SoftwareContract["contract_type"];
  lifecycle_state: LifecycleState;
  authorization: {
    git: SoftwareContract["authorization"]["git"];
    budget_limits: SoftwareContract["authorization"]["budget_limits"];
    cost_limits: SoftwareContract["authorization"]["cost_limits"];
    execution_permissions: Omit<
      SoftwareContract["authorization"]["execution_permissions"],
      "dependency_changes_allowed"
    >;
  };
  approval: SoftwareContract["approval"];
  scheme_binding?: SoftwareContract["scheme_binding"];
  references?: SoftwareContract["references"];
}

export interface CardDesignExtras {
  /** 按 path 补 touches[].symbols */
  symbols?: Record<string, string[]>;
  /** 按 acceptance_id 补 test_plan[].case / debt */
  cases?: Record<
    string,
    { case?: string | undefined; debt?: string | undefined }
  >;
}

function acceptanceOf(contract: SoftwareContract): AcceptanceRef[] {
  const refs = contract.supervisor_metadata?.acceptance_refs;
  if (refs && refs.length > 0) return refs;
  return contract.intent.acceptance_criteria.map((text, i) => ({
    id: `AC-${i + 1}`,
    text,
    check: "auto",
  }));
}

function sameTexts(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

function omitUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as T;
}

/**
 * 合同 + DesignNote → 卡 + 运行时。
 * 卡的 status 由合同双状态机推出；排期类状态（BLOCKED / DEFERRED / SPLIT）只能由文档侧改写。
 */
export function splitContract(
  contract: SoftwareContract,
  note: DesignNote,
  governance: CardGovernanceInput = {},
  extras: CardDesignExtras = {},
): { card: ContractCard; runtime: ContractRuntime } {
  if (note.contract_id !== contract.contract_id) {
    throw new Error(
      `DesignNote.contract_id=${note.contract_id} 与合同 ${contract.contract_id} 不一致`,
    );
  }
  const acceptance = acceptanceOf(contract);
  const { acceptance_refs, scheme_item_ids, ...metaRest } =
    contract.supervisor_metadata ?? ({} as Partial<SupervisorMetadata>);
  const { dependency_changes_allowed, ...permRest } =
    contract.authorization.execution_permissions;
  const fs = contract.authorization.file_system_scope;

  const cardInput: ContractCardInput = {
    id: contract.contract_id,
    status: cardStatusOf(contract.lifecycle_state, contract.approval.status),
    contract: {
      intent: omitUndefined({
        title: contract.intent.title,
        description: contract.intent.description,
        acceptance_criteria: sameTexts(
          contract.intent.acceptance_criteria,
          acceptance.map((a) => a.text),
        )
          ? undefined
          : contract.intent.acceptance_criteria,
        risk_level: contract.intent.risk_level,
      }),
      acceptance,
      scheme_item_ids: scheme_item_ids ?? [],
      scope: {
        writable_paths: fs.writable_paths,
        readonly_paths: fs.readonly_paths,
        strictly_forbidden_paths: fs.strictly_forbidden_paths,
      },
      verification: omitUndefined({
        commands: contract.verification_spec.commands,
        manual_confirmation: contract.verification_spec.manual_confirmation,
      }),
      dependency_changes_allowed,
    },
    design: {
      approach: note.approach,
      touches: note.touches.map((t) => ({
        ...t,
        symbols: extras.symbols?.[t.path] ?? [],
      })),
      interfaces: note.interfaces,
      data_changes: note.data_changes,
      dependencies: note.dependencies,
      decisions: note.decisions,
      test_plan: note.test_plan.map((t) => ({
        ...t,
        ...omitUndefined(extras.cases?.[t.acceptance_id] ?? {}),
      })),
      knowledge_delta: note.knowledge_delta,
    },
    governance,
  };

  const runtime = omitUndefined({
    schema_version: contract.schema_version,
    contract_revision: contract.contract_revision,
    created_at: contract.created_at,
    creator: contract.creator,
    conversation_ref: contract.conversation_ref,
    supervisor_metadata: contract.supervisor_metadata
      ? (metaRest as ContractRuntime["supervisor_metadata"])
      : undefined,
    carried: {
      acceptance_refs: acceptance_refs !== undefined,
      scheme_item_ids: scheme_item_ids !== undefined,
    },
    worker_spec: contract.worker_spec,
    contract_type: contract.contract_type,
    lifecycle_state: contract.lifecycle_state,
    authorization: {
      git: contract.authorization.git,
      budget_limits: contract.authorization.budget_limits,
      cost_limits: contract.authorization.cost_limits,
      execution_permissions: permRest,
    },
    approval: contract.approval,
    scheme_binding: contract.scheme_binding,
    references: contract.references,
  }) as ContractRuntime;

  return { card: contractCardSchema.parse(cardInput), runtime };
}

/** 卡 + 运行时 → 合同（经 softwareContractSchema 校验）。 */
export function joinContract(
  card: ContractCard,
  runtime: ContractRuntime,
): SoftwareContract {
  const c = card.contract;
  const acceptanceTexts = c.acceptance.map((a) => a.text);
  const meta =
    runtime.supervisor_metadata ??
    (runtime.carried.acceptance_refs || runtime.carried.scheme_item_ids
      ? { suggestion_id: `card:${card.id}` }
      : undefined);
  const supervisor_metadata = meta
    ? omitUndefined({
        ...meta,
        acceptance_refs: runtime.carried.acceptance_refs
          ? c.acceptance
          : undefined,
        scheme_item_ids: runtime.carried.scheme_item_ids
          ? c.scheme_item_ids
          : undefined,
      })
    : undefined;

  return softwareContractSchema.parse(
    omitUndefined({
      contract_id: card.id,
      schema_version: runtime.schema_version,
      contract_revision: runtime.contract_revision,
      created_at: runtime.created_at,
      creator: runtime.creator,
      conversation_ref: runtime.conversation_ref,
      supervisor_metadata,
      worker_spec: runtime.worker_spec,
      contract_type: runtime.contract_type,
      lifecycle_state: runtime.lifecycle_state,
      intent: {
        title: c.intent['title'],
        description: c.intent['description'],
        acceptance_criteria: c.intent['acceptance_criteria'] ?? acceptanceTexts,
        risk_level: c.intent.risk_level,
      },
      authorization: {
        git: runtime.authorization.git,
        file_system_scope: c.scope,
        budget_limits: runtime.authorization.budget_limits,
        cost_limits: runtime.authorization.cost_limits,
        execution_permissions: {
          ...runtime.authorization.execution_permissions,
          dependency_changes_allowed: c.dependency_changes_allowed,
        },
      },
      verification_spec: omitUndefined({
        commands: c.verification.commands,
        manual_confirmation: c.verification.manual_confirmation,
      }),
      approval: runtime.approval,
      scheme_binding: runtime.scheme_binding,
      references: runtime.references,
    }),
  );
}

/** 卡里的设计部分去掉卡扩展字段，即合同的 DesignNote。 */
export function designNoteFromCard(card: ContractCard): DesignNote {
  const d = card.design;
  return designNoteSchema.parse({
    schema_version: "1.0.0",
    contract_id: card.id,
    approach: d.approach,
    touches: d.touches.map(({ symbols: _s, ...t }) => t),
    interfaces: d.interfaces,
    data_changes: d.data_changes,
    dependencies: d.dependencies,
    decisions: d.decisions,
    test_plan: d.test_plan.map(({ case: _c, debt: _d, ...t }) => t),
    knowledge_delta: d.knowledge_delta,
  }) as DesignNote;
}

/**
 * DesignNote 校验（validateDesignNote）只读合同的这几个字段；卡自己就带着它们，
 * 不需要伪造运行时就能跑 DN-1～DN-5。
 */
export function designContractViewOfCard(card: ContractCard) {
  return {
    contract_id: card.id,
    authorization: {
      file_system_scope: { writable_paths: card.contract.scope.writable_paths },
      execution_permissions: {
        dependency_changes_allowed: card.contract.dependency_changes_allowed,
      },
    },
    supervisor_metadata: { acceptance_refs: card.contract.acceptance },
  };
}

/** 渲染成可直接贴进任务卡正文的代码块。 */
export function renderContractCard(card: ContractCard): string {
  const body = yaml.dump(card, { lineWidth: 100, noRefs: true });
  return "```" + CONTRACT_CARD_FENCE_INFO + "\n" + body + "```\n";
}
