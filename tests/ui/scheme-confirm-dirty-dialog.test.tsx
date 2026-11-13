// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DirtyWorktreeConfirmDialog } from "../../src/routes/index";

describe("TASK-J.24 缺口 1：生产脏工作区确认弹窗", () => {
  it("T-J24-UI-DIRTY-001 文案对齐禁写名单语义并展示脏文件", () => {
    render(
      <DirtyWorktreeConfirmDialog
        files={["src/app.ts", "secret.txt"]}
        plainMessage="发现本地有未提交改动。"
        busy={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("alertdialog")).toHaveAccessibleName(
      "确认处理本地未提交改动",
    );
    expect(
      screen.getByTestId("dirty-worktree-confirm-dialog"),
    ).toHaveTextContent(/点确认后会列入\s*「绝不触碰」禁写名单/);
    expect(
      screen.getByTestId("dirty-worktree-confirm-dialog"),
    ).toHaveTextContent("secret.txt");
  });

  it("T-J24-UI-DIRTY-002 未操作时不确认；只有显式点击确认才触发回调", () => {
    const onConfirm = vi.fn();
    render(
      <DirtyWorktreeConfirmDialog
        files={["src/app.ts"]}
        plainMessage="发现本地有未提交改动。"
        busy={false}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("dirty-dialog-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("T-J24-UI-DIRTY-003 取消不触发确认回调", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <DirtyWorktreeConfirmDialog
        files={["src/app.ts"]}
        plainMessage="发现本地有未提交改动。"
        busy={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("dirty-dialog-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
