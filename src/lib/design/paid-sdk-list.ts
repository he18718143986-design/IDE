/**
 * TASK-L.11：付费 SDK 初版名单（DesignNote 二次判定 `costs_money`）。
 * `@aws-sdk/*` 以前缀匹配；其余精确匹配包名。
 */

export const PAID_SDK_NAMES = [
  "stripe",
  "twilio",
  "@google/maps",
  "openai",
  "@anthropic-ai/sdk",
  "aws-sdk",
] as const;

export type PaidSdkName = (typeof PAID_SDK_NAMES)[number];

/** 是否命中付费 SDK 清单（含 `@aws-sdk/` 前缀）。 */
export function isPaidSdk(packageName: string): boolean {
  const name = packageName.trim();
  if (!name) return false;
  if ((PAID_SDK_NAMES as readonly string[]).includes(name)) return true;
  if (name === "@aws-sdk" || name.startsWith("@aws-sdk/")) return true;
  return false;
}

/** 稳定导出供 detectEscalations / 测试使用 */
export const PAID_SDK_LIST: readonly string[] = [
  ...PAID_SDK_NAMES,
  "@aws-sdk/*",
];
