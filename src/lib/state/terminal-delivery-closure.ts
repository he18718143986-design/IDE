/**
 * TASK-H.2 / TASK-P0.16：MERGED / DELIVERED 终态收口（方案 B · 精简注记）。
 *
 * 拍板：现网 lifecycle 终态以 **MERGED** 为准（合并 + 本地 records 归档成功路径）。
 * DeliveryState 枚举中的 `DELIVERED` 仅作 EO-01 投影别名 / 内部归档事务成功标记，
 * **不对用户承诺单独的 DELIVERED 运行时 lifecycle 名**，消除规范与代码两层皮。
 *
 * 归档中段失败：停在 MERGED，且不得对外伪造成功「已交付」文案（由
 * `publicDeliveryCopy` 区分 archive_ok）。
 *
 * TASK-P0.16：支持幂等补偿成功后的交付终态无缝收敛（delivery_complete: true，文案收敛为「已交付归档」）。
 */
import type { LifecycleState } from "../contract.schema";
import type { DeliveryState } from "./delivery-state";

/** H.2 方案标识（测试可断言） */
export const H2_TERMINAL_SCHEME = "B_MERGED_IS_TERMINAL" as const;

/** 对外交付终态 = lifecycle MERGED */
export const PUBLIC_DELIVERY_TERMINAL = "MERGED" as const;

export type PublicDeliveryTerminal = typeof PUBLIC_DELIVERY_TERMINAL;

export function isPublicDeliveryTerminal(
  lifecycle: string,
): lifecycle is PublicDeliveryTerminal {
  return lifecycle === PUBLIC_DELIVERY_TERMINAL;
}

/**
 * 将 EO-01 / 内部归档成功的 DELIVERED 投影收敛为对外 MERGED。
 * lifecycle 已是 MERGED 时原样返回。
 */
export function collapseDeliveredAlias(
  state: DeliveryState | LifecycleState | string,
): string {
  if (state === "DELIVERED") return PUBLIC_DELIVERY_TERMINAL;
  return state;
}

export interface PublicDeliveryCopyInput {
  lifecycle_state: string;
  /** records 归档是否完成；缺省视为未知（不宣称已交付完成） */
  archive_ok?: boolean | null;
  /** 可选：是否经历了幂等补偿 */
  compensated?: boolean;
}

/**
 * 用户可见终态文案。归档失败/未知时不得写「已交付完成」。
 * 归档成功或幂等补偿成功后，状态无缝收敛为 delivery_complete: true 与「已交付归档」。
 */
export function publicDeliveryCopy(input: PublicDeliveryCopyInput): {
  terminal: boolean;
  label: string;
  delivery_complete: boolean;
  compensated?: boolean;
} {
  if (input.lifecycle_state === "ABORTED") {
    return {
      terminal: true,
      label: "已中止",
      delivery_complete: false,
    };
  }
  if (!isPublicDeliveryTerminal(input.lifecycle_state)) {
    return {
      terminal: false,
      label: input.lifecycle_state,
      delivery_complete: false,
    };
  }
  if (input.archive_ok === true) {
    return {
      terminal: true,
      label: "已交付归档",
      delivery_complete: true,
      ...(input.compensated !== undefined
        ? { compensated: input.compensated }
        : {}),
    };
  }
  if (input.archive_ok === false) {
    return {
      terminal: true,
      label: "已合入（归档未完成，尚未标交付完成）",
      delivery_complete: false,
      ...(input.compensated !== undefined
        ? { compensated: input.compensated }
        : {}),
    };
  }
  return {
    terminal: true,
    label: "已合入项目",
    delivery_complete: false,
    ...(input.compensated !== undefined
      ? { compensated: input.compensated }
      : {}),
  };
}

/**
 * 检测对外文案是否仍悬空承诺独立 DELIVERED 终态（方案 B 禁止）。
 * 允许出现「DELIVERED 别名」「内部 DELIVERED」等说明性措辞。
 */
export function hasHangingDeliveredPromise(copy: string): boolean {
  const s = copy.trim();
  if (!/DELIVERED/i.test(s)) return false;
  if (/别名|alias|内部|投影|EO-01/i.test(s)) return false;
  return (
    /交付终态\s*[:=]?\s*DELIVERED/i.test(s) ||
    /终态\s*[:=]?\s*DELIVERED/i.test(s) ||
    /单独\s*DELIVERED/i.test(s) ||
    /^\s*DELIVERED\s*$/i.test(s)
  );
}
