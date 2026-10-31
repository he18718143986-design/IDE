/**
 * 意图编译器状态横幅（TASK-J.10 / V-06）。
 * 纯展示：不触发模型、不回流右栏。
 */
import type { ReactElement } from "react";
import { OFFLINE_BANNER_TEXT } from "../../lib/journey/compiler-banners";

export interface CompilerStatusBannerProps {
  text: string | null;
  /** 测试与无障碍：data-testid */
  testId?: string;
}

export function CompilerStatusBanner(
  props: CompilerStatusBannerProps,
): ReactElement | null {
  if (!props.text) return null;
  return (
    <div
      role="status"
      data-testid={props.testId ?? "compiler-status-banner"}
      className="stagent-compiler-banner"
    >
      {props.text}
    </div>
  );
}

export { OFFLINE_BANNER_TEXT };
