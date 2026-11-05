import { z } from "zod";

/**
 * 任务卡头：嵌在卡正文里的 ```yaml task-card 代码块。
 * 字段与 docs/specs/task-card-standard.md 的 R-1～R-12 一一对应；
 * 卡头是机器读的权威，正文只写背景与取舍。
 */

export const CARD_STATUSES = [
  "NEW_TASK",
  "READY",
  "IN_PROGRESS",
  "BLOCKED",
  "COMPLETED",
  "DEFERRED",
  "SPLIT",
] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

/** 进入这些状态后，DoR 必须成立（依赖已完成、无未决问题、不是 L）。 */
export const COMMITTED_STATUSES: readonly CardStatus[] = [
  "READY",
  "IN_PROGRESS",
  "COMPLETED",
];

const TASK_ID = z.string().regex(/^TASK-[A-Z0-9]+(\.[0-9a-z-]+)*$/, {
  message: "卡号形如 TASK-C.4 / TASK-W.5c-iii",
});

const REPO_PATH = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith("/") && !p.includes(".."), {
    message: "路径必须是仓库内相对路径",
  });

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

const IDENTIFIER = z.string().regex(/^[A-Za-z_$][\w$]*$/);

export const cardHeaderSchema = z
  .object({
    id: TASK_ID,
    title: z.string().min(1),
    status: z.enum(CARD_STATUSES),
    /** R-1 溯源 */
    spec_refs: z.array(DOC_REF).min(1),
    /** R-2 一句话目标：谁能看见什么变化 */
    goal: z.string().min(1),
    /** R-3 前置依赖；soft 不阻断开工 */
    depends_on: z
      .array(
        z
          .object({
            id: TASK_ID,
            kind: z.enum(["hard", "soft"]).default("hard"),
          })
          .strict(),
      )
      .default([]),
    /** R-4 今天的代码哪里不对 */
    code_facts: z
      .array(z.object({ ref: CODE_REF, note: z.string().min(1) }).strict())
      .min(1),
    /** R-5 要碰的文件与要交付的符号 */
    touches: z
      .array(
        z
          .object({
            path: REPO_PATH,
            action: z.enum(["create", "modify", "delete", "read"]),
            symbols: z.array(IDENTIFIER).default([]),
          })
          .strict(),
      )
      .min(1),
    /** R-6 */
    non_goals: z.array(z.string().min(1)).min(1),
    /** R-7 每条断言落到一个测试文件里的一个用例 */
    pass: z
      .array(
        z
          .object({
            id: z.string().min(1),
            test: REPO_PATH,
            /** 用例标题中的一段原文，用来在测试文件里定位 it(...) */
            case: z.string().min(1),
            assert: z.string().min(1),
            /** 已知没有测试兑现这条断言时，写明原因与台账去向；补上测试后必须删掉 */
            debt: z.string().min(1).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(12, { message: "PASS 超过 12 条必须拆卡（标准 §4）" }),
    /** R-8 */
    fail: z.array(z.string().min(1)).min(1),
    /** R-9 与 ACCEPTED ADR 冲突时的修订说明；无冲突留空 */
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
    /** R-10 采用的默认值与仍未决的问题 */
    defaults: z.array(z.string().min(1)).default([]),
    open_questions: z.array(z.string().min(1)).default([]),
    /** R-11 */
    estimate: z.enum(["S", "M", "L"]),
    /** R-12 安全门禁：unchanged 或写明依据的变更 */
    invariants: z
      .object({
        auth: z.string().min(1),
        demo_origin: z.string().min(1),
        illumination: z.string().min(1),
        gateway_write_scope: z.string().min(1),
      })
      .strict(),
    /** COMPLETED 时必填 */
    delivered: z
      .object({
        pr: z.number().int().positive(),
        commit: z.string().regex(/^[0-9a-f]{7,40}$/),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((card, ctx) => {
    if (card.status === "COMPLETED" && !card.delivered) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["delivered"],
        message: "COMPLETED 的卡必须写 delivered.pr 与 delivered.commit",
      });
    }
    if (COMMITTED_STATUSES.includes(card.status)) {
      if (card.estimate === "L") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["estimate"],
          message: "估算 L 的卡不得进入 READY 及之后的状态，必须拆分（R-11）",
        });
      }
      if (card.open_questions.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["open_questions"],
          message: "仍有未决问题的卡不得进入 READY 及之后的状态（R-10）",
        });
      }
    }
  });

export type CardHeader = z.infer<typeof cardHeaderSchema>;
