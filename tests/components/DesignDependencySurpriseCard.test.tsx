// @vitest-environment jsdom
/**
 * TASK-J.19：画布意外卡按钮必须走真实 handler（禁止假闭环）。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DesignDependencySurpriseCard } from "../../src/components/supervisor/DesignDependencySurpriseCard";

describe("TASK-J.19 DesignDependencySurpriseCard", () => {
  it("点「可以/不行」触发 props handler", () => {
    const onAllow = vi.fn();
    const onDeny = vi.fn();
    render(
      <DesignDependencySurpriseCard
        view={{
          contract_id: "ctr-1",
          detail: "需要 left-pad",
          dependencies: [
            { name: "left-pad", version: "1.3.0", why: "必须用" },
          ],
        }}
        onAllow={onAllow}
        onDeny={onDeny}
      />,
    );
    expect(
      screen.getByTestId("design-dependency-surprise-card"),
    ).toBeInTheDocument();
    expect(screen.getByText(/left-pad@1\.3\.0/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("design-dependency-allow"));
    expect(onAllow).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("design-dependency-deny"));
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it("view 为空时不渲染", () => {
    const { container } = render(
      <DesignDependencySurpriseCard
        view={null}
        onAllow={() => {}}
        onDeny={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
