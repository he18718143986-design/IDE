// @vitest-environment jsdom
/**
 * TASK-L.18：系统地图同页嵌 + 空态 / 有 modules 渲染 + impact 查询烟测。
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SystemMapPane } from "../../src/components/project/SystemMapPane";
import { SchemeReviewPane } from "../../src/components/studio/SchemeReviewPane";
import {
  EMPTY_DEMO_GATE,
  evaluateSchemeConfirmation,
  rebuildSchemeFromCorpus,
} from "../../src/lib/journey/scheme-draft";
import type { KnowledgeImpactResult, KnowledgeModulesResult } from "../../src/lib/daemon-api";

const modulesOk: KnowledgeModulesResult = {
  ok: true,
  modules: [
    {
      id: "auth",
      name: "认证",
      purpose: "登录会话",
      paths: ["src/auth/**"],
      depends_on: ["db"],
      interfaces: [],
    },
    {
      id: "db",
      name: "数据库",
      purpose: "持久化",
      paths: ["src/db/**"],
      depends_on: [],
      interfaces: [],
    },
  ],
  edges: [{ from: "auth", to: "db" }],
  message: null,
  reason: null,
};

const impactOk: KnowledgeImpactResult = {
  path: "src/db/client.ts",
  owners: [{ id: "db", name: "数据库", purpose: "持久化" }],
  affected: [
    {
      id: "auth",
      name: "认证",
      purpose: "登录会话",
      via: ["depends_on"],
    },
  ],
  edges: [{ from: "auth", to: "db" }],
  empty_reason: "ok",
};

describe("TASK-L.18 SystemMapPane", () => {
  it("无 modules 时诚实空态", async () => {
    render(
      <SystemMapPane
        modulesLoader={async () => ({
          ok: false,
          modules: [],
          edges: [],
          reason: "missing",
          message: "还没有系统模块地图。",
        })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("system-map-empty").textContent).toMatch(
        /还没有系统模块地图/,
      );
    });
    expect(screen.queryByTestId("system-map-modules")).toBeNull();
  });

  it("有 modules 时渲染模块卡与依赖边", async () => {
    render(
      <SystemMapPane
        modulesLoader={async () => modulesOk}
        impactLoader={async () => impactOk}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("system-map-modules")).toBeTruthy();
    });
    const cards = screen.getAllByTestId("system-map-module-card");
    expect(cards).toHaveLength(2);
    expect(screen.getByTestId("system-map-edges").textContent).toMatch(/认证/);
    expect(screen.getByTestId("system-map-edge").textContent).toMatch(
      /认证 → 数据库|认证/,
    );
  });

  it("impact 查询展示受影响模块", async () => {
    const impactLoader = vi.fn(async () => impactOk);
    render(
      <SystemMapPane
        modulesLoader={async () => modulesOk}
        impactLoader={impactLoader}
      />,
    );
    await waitFor(() => screen.getByTestId("system-map-modules"));
    fireEvent.change(screen.getByTestId("system-map-impact-path"), {
      target: { value: "src/db/client.ts" },
    });
    fireEvent.click(screen.getByTestId("system-map-impact-run"));
    await waitFor(() => {
      expect(screen.getByTestId("system-map-impact-list")).toBeTruthy();
    });
    expect(impactLoader).toHaveBeenCalledWith("src/db/client.ts");
    expect(screen.getByTestId("system-map-impact-list").textContent).toMatch(
      /认证/,
    );
  });

  it("同页嵌于 SchemeReviewPane（非独立 Tab）", async () => {
    const scheme = rebuildSchemeFromCorpus(
      null,
      "我要做一个能登录的看板，先登录再看逾期项目。",
      { titleHint: "示例方案" },
    );
    const confirmation = evaluateSchemeConfirmation(scheme, EMPTY_DEMO_GATE);
    render(
      <SchemeReviewPane
        scheme={scheme}
        confirmation={confirmation}
        demoGate={EMPTY_DEMO_GATE}
      />,
    );
    const pane = screen.getByTestId("scheme-review-pane");
    expect(within(pane).getByTestId("system-map-pane")).toBeTruthy();
    expect(screen.queryByTestId("activity-project-tab")).toBeNull();
  });
});
