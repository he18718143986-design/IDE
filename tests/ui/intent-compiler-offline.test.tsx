/**
 * TASK-J.10 / V-06：离线横幅展示；不回流右栏。
 */
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  CompilerStatusBanner,
  OFFLINE_BANNER_TEXT,
} from "../../src/components/scheme/CompilerStatusBanner";
import {
  BUDGET_EXCEEDED_BANNER_TEXT,
  COMPILING_BANNER_TEXT,
  FAILURE_BANNER_TEXT,
} from "../../src/lib/journey/compiler-banners";

describe("V-06 离线 / 状态横幅", () => {
  it("text=null 时不渲染", () => {
    const { container } = render(<CompilerStatusBanner text={null} />);
    expect(container.querySelector("[data-testid='compiler-status-banner']")).toBeNull();
  });

  it("展示离线文案「方案助手未连接」", () => {
    render(<CompilerStatusBanner text={OFFLINE_BANNER_TEXT} />);
    expect(screen.getByTestId("compiler-status-banner").textContent).toBe(
      "方案助手未连接",
    );
  });

  it("文案常量与 compile-loop 口径一致", () => {
    expect(COMPILING_BANNER_TEXT).toBe("正在整理你刚说的…");
    expect(BUDGET_EXCEEDED_BANNER_TEXT).toContain("额度用完了");
    expect(FAILURE_BANNER_TEXT).toContain("连续整理失败");
  });
});
