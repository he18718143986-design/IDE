/**
 * TASK-L.7：plan-store 读写与修订归档（含 PD-12 落盘半截）。
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeRmSync } from "../helpers/tmp";
import {
  planPath,
  planRevisionPath,
  readPlan,
  writePlan,
} from "../../daemon/project/plan-store";
import type { ProjectPlan } from "../../src/lib/project/project-plan";

function samplePlan(revision: number): ProjectPlan {
  return {
    schema_version: "1.0.0",
    project_id: "proj-1",
    plan_revision: revision,
    architecture_baseline_ref: {
      baseline_id: "pab-1",
      baseline_revision: 1,
      baseline_digest: "digest-1",
    },
    scheme_id: "S1",
    scheme_revision: 5,
    milestones: [
      {
        milestone_id: "ms-1",
        title: "第一期",
        exit_acceptance_ids: ["acc-1"],
        contract_ids: ["cs-1"],
      },
    ],
    contracts: [
      {
        stub_id: "cs-1",
        milestone_id: "ms-1",
        kind: "feature",
        origin: "scheme",
        title: "做登录",
        scheme_item_ids: ["g-1", "m-1"],
        acceptance_ids: ["acc-1"],
        area_hints: ["src"],
        depends_on: [],
        size_estimate: { files: 3, diff_lines: 80, minutes: 10 },
        status: "planned",
        contract_id: null,
      },
    ],
    graveyard: [],
  };
}

describe("daemon/project/plan-store", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-plan-store-"));
  });

  afterEach(() => {
    try {
      safeRmSync(tempDir);
    } catch {
      /* ignore */
    }
  });

  it("写入后读回等值（round-trip）", () => {
    const plan = samplePlan(1);
    writePlan(tempDir, plan);
    expect(fs.existsSync(planPath(tempDir))).toBe(true);
    const read = readPlan(tempDir);
    expect(read).toEqual(plan);
  });

  it("PD-12: 第二次写入后 plan.revisions/1.json 存在且内容为旧版", () => {
    const v1 = samplePlan(1);
    writePlan(tempDir, v1);

    const v2: ProjectPlan = {
      ...samplePlan(2),
      contracts: [
        {
          ...samplePlan(2).contracts[0]!,
          title: "做登录（修订）",
        },
      ],
    };
    writePlan(tempDir, v2);

    const archive = planRevisionPath(tempDir, 1);
    expect(fs.existsSync(archive)).toBe(true);
    const archived = JSON.parse(fs.readFileSync(archive, "utf8")) as ProjectPlan;
    expect(archived).toEqual(v1);
    expect(readPlan(tempDir)).toEqual(v2);
  });

  it("缺省文件时 readPlan 返回 null", () => {
    expect(readPlan(tempDir)).toBeNull();
  });
});
