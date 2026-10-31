// @vitest-environment jsdom
/**
 * TASK-L.10：项目地图同页嵌 + 补丁操作 + 禁止技术单位 / 禁止本地算下一份。
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ProjectMapPane } from "../../src/components/project/ProjectMapPane";
import { SchemeReviewPane } from "../../src/components/studio/SchemeReviewPane";
import type { ProjectPlan } from "../../src/lib/project/project-plan";
import {
  EMPTY_DEMO_GATE,
  evaluateSchemeConfirmation,
  rebuildSchemeFromCorpus,
} from "../../src/lib/journey/scheme-draft";

function makePlan(): ProjectPlan {
  return {
    schema_version: "1.0.0",
    project_id: "proj-1",
    plan_revision: 3,
    architecture_baseline_ref: {
      baseline_id: "pab-1",
      baseline_revision: 1,
      baseline_digest: "digest-1",
    },
    scheme_id: "scheme-1",
    scheme_revision: 1,
    milestones: [
      {
        milestone_id: "ms-1",
        title: "先能登录",
        exit_acceptance_ids: ["acc-1"],
        contract_ids: ["cs-1", "cs-2"],
      },
      {
        milestone_id: "ms-2",
        title: "再能看板",
        exit_acceptance_ids: ["acc-2"],
        contract_ids: ["cs-3"],
      },
    ],
    contracts: [
      {
        stub_id: "cs-1",
        milestone_id: "ms-1",
        kind: "test_foundation",
        origin: "system",
        title: "搭测试底子",
        scheme_item_ids: ["goal-1"],
        acceptance_ids: ["sys-acc-test-foundation"],
        area_hints: ["tests"],
        depends_on: [],
        size_estimate: { files: 3, diff_lines: 100, minutes: 20 },
        status: "merged",
        contract_id: "ctr-1",
      },
      {
        stub_id: "cs-2",
        milestone_id: "ms-1",
        kind: "feature",
        origin: "scheme",
        title: "登录页",
        scheme_item_ids: ["goal-1"],
        acceptance_ids: ["acc-1"],
        area_hints: ["auth"],
        depends_on: ["cs-1"],
        size_estimate: { files: 5, diff_lines: 200, minutes: 25 },
        status: "planned",
        contract_id: null,
      },
      {
        stub_id: "cs-3",
        milestone_id: "ms-2",
        kind: "feature",
        origin: "scheme",
        title: "逾期看板",
        scheme_item_ids: ["goal-2"],
        acceptance_ids: ["acc-2"],
        area_hints: ["dashboard"],
        depends_on: ["cs-2"],
        size_estimate: { files: 4, diff_lines: 180, minutes: 25 },
        status: "planned",
        contract_id: null,
      },
    ],
    graveyard: [],
  };
}

function makeScheme() {
  return rebuildSchemeFromCorpus(
    null,
    "我要做一个能登录的看板，先登录再看逾期项目。",
    { titleHint: "示例方案" },
  );
}

describe("TASK-L.10 ProjectMapPane", () => {
  it("renders two milestones and three stubs; next highlight is unique", () => {
    const plan = makePlan();
    render(
      <ProjectMapPane plan={plan} nextStubId="cs-2" />,
    );

    expect(screen.getAllByTestId("project-map-milestone")).toHaveLength(2);
    expect(screen.getAllByTestId("project-map-stub")).toHaveLength(3);
    const nextBadges = screen.getAllByTestId("project-map-next-badge");
    expect(nextBadges).toHaveLength(1);
    expect(nextBadges[0].textContent).toContain("下一份");

    const nextStub = screen
      .getAllByTestId("project-map-stub")
      .find((el) => el.getAttribute("data-next") === "true");
    expect(nextStub).toBeTruthy();
    expect(nextStub!.getAttribute("data-stub-id")).toBe("cs-2");
    expect(
      within(nextStub!).getByTestId("project-map-confirm-start").textContent,
    ).toContain("确认开工");
  });

  it("page text has no **, glob, or token technical units", () => {
    const plan = makePlan();
    const { container } = render(
      <ProjectMapPane plan={plan} nextStubId="cs-2" />,
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\*\*/);
    expect(text.toLowerCase()).not.toContain("glob");
    expect(text.toLowerCase()).not.toContain("token");
  });

  it("defer button calls onDefer once (removed_by user path owned by parent)", () => {
    const plan = makePlan();
    const onDefer = vi.fn();
    render(
      <ProjectMapPane
        plan={plan}
        nextStubId="cs-2"
        onDefer={onDefer}
      />,
    );
    const deferButtons = screen.getAllByTestId("project-map-defer");
    expect(deferButtons.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(deferButtons[0]!);
    expect(onDefer).toHaveBeenCalledTimes(1);
    expect(onDefer).toHaveBeenCalledWith("cs-2");
  });

  it("uses server nextStubId only — wrong id does not auto-highlight cs-2", () => {
    const plan = makePlan();
    // Server says null → no next highlight even if cs-2 is planned
    render(<ProjectMapPane plan={plan} nextStubId={null} />);
    expect(screen.queryByTestId("project-map-next-badge")).toBeNull();
    expect(screen.queryByTestId("project-map-confirm-start")).toBeNull();
  });

  it("embeds inside SchemeReviewPane (same-page, not independent Tab)", () => {
    const plan = makePlan();
    const scheme = makeScheme();
    const confirmation = evaluateSchemeConfirmation(scheme, EMPTY_DEMO_GATE);
    render(
      <SchemeReviewPane
        scheme={scheme}
        confirmation={confirmation}
        projectPlan={plan}
        projectNextStubId="cs-2"
      />,
    );
    const pane = screen.getByTestId("scheme-review-pane");
    expect(within(pane).getByTestId("project-map-pane")).toBeTruthy();
    // FAIL guard: no independent project tab chrome
    expect(screen.queryByTestId("project-tab")).toBeNull();
    expect(screen.queryByLabelText("项目")).toBeNull();
  });
});
