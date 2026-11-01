import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";
import { emptySchemeDraft } from "../../src/lib/journey/scheme-draft";
import {
  writeSchemeSnapshot,
  readSchemeSnapshot,
  schemeSnapshotDigest,
} from "../../daemon/pipeline/scheme-snapshot-store";
import { buildConfirmContractFromScopePlan } from "../../src/lib/journey/confirm-scheme-contract";
import { scopePlanDigest, type ScopePlan } from "../../src/lib/journey/scope-plan";

function makeMinimalPlan(revision = 1): ScopePlan {
  const plan: ScopePlan = {
    scheme_revision: revision,
    plan_digest: "",
    areas: [
      {
        id: "area-src",
        label: "源码",
        why: "改源码",
        module_ids: [],
        kind: "change_existing",
        paths: ["src/**"],
        excluded_by_user: false,
      },
    ],
    never_touch: [],
    needs_approval: [],
    verification: {
      commands: [
        {
          alias: "test",
          executable: "npm",
          args: ["test"],
          expected_exit_code: 0,
          timeout_seconds: 60,
        },
      ],
      plain: ["按方案验收"],
      manual_only: false,
    },
    budget: {
      limits: {
        max_file_modifications: 10,
        max_total_diff_lines: 2000,
        max_duration_seconds: 1800,
        max_verification_retries: 2,
      },
      plain: "默认预算",
    },
    grade: { ok: true, rejected: [] },
  };
  plan.plan_digest = scopePlanDigest(plan);
  return plan;
}

describe("TASK-C.22: contract schema references[] and scheme snapshot", () => {
  let tempRepo: string;

  beforeEach(() => {
    tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), "c22-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempRepo, { recursive: true, force: true });
  });

  it("allows omitting references (default compatibility for legacy and draft contracts)", () => {
    const draft = createContractDraft({
      title: "C.22 legacy draft",
      description: "testing contract without references",
      acceptanceCriteria: ["criterion 1"],
      writablePaths: ["src/lib/contract.schema.ts"],
    });

    expect(draft.references).toBeUndefined();
    const parsed = softwareContractSchema.parse(draft);
    expect(parsed.references).toBeUndefined();
  });

  it("accepts empty array references []", () => {
    const draft = createContractDraft({
      title: "C.22 empty references",
      description: "testing contract with empty references",
      acceptanceCriteria: ["criterion 1"],
      writablePaths: ["src/lib/contract.schema.ts"],
      references: [],
    });

    expect(draft.references).toEqual([]);
    const parsed = softwareContractSchema.parse(draft);
    expect(parsed.references).toEqual([]);
  });

  it("accepts valid URL references and preserves them", () => {
    const urls = [
      "https://example.com/api/v1",
      "https://docs.github.com/en/rest",
      "http://internal.service.local:8080/spec",
    ];

    const draft = createContractDraft({
      title: "C.22 valid URLs",
      description: "testing contract with valid references",
      acceptanceCriteria: ["criterion 1"],
      writablePaths: ["src/lib/contract.schema.ts"],
      references: urls,
    });

    expect(draft.references).toEqual(urls);
    const parsed = softwareContractSchema.parse(draft);
    expect(parsed.references).toEqual(urls);
  });

  it("rejects invalid URL entries with ZodError", () => {
    const base = createContractDraft({
      title: "C.22 invalid URL base",
      description: "testing invalid reference URL rejection",
      acceptanceCriteria: ["criterion 1"],
      writablePaths: ["src/lib/contract.schema.ts"],
    });

    expect(() => {
      softwareContractSchema.parse({
        ...base,
        references: ["not-a-valid-url"],
      });
    }).toThrow(/references must be valid URLs/);

    expect(() => {
      softwareContractSchema.parse({
        ...base,
        references: ["https://valid.com", "relative/path/only"],
      });
    }).toThrow(/references must be valid URLs/);
  });

  it("persists references into SchemeDraft and frozen SchemeSnapshot", () => {
    const testUrls = ["https://example.com/ref1", "https://example.org/ref2"];
    const scheme = emptySchemeDraft({
      title: "Ref Scheme",
      summary: "Scheme with references",
      modules: ["module1"],
      references: testUrls,
    });

    expect(scheme.references).toEqual(testUrls);

    const demo = {
      status: "none" as const,
      scheme_revision: null,
      decision_revision: null,
    };
    const decision = {
      code: "OK",
      message: "Ready",
      demo_mode: "none" as const,
    };
    const scopePlan = makeMinimalPlan(scheme.scheme_revision);

    const { snapshot } = writeSchemeSnapshot(tempRepo, {
      confirmation_id: "conf-scheme-c22-01",
      scheme,
      demo,
      decision,
      scope_plan: scopePlan,
    });

    expect(snapshot.references).toEqual(testUrls);
    expect(snapshot.scheme.references).toEqual(testUrls);

    const loaded = readSchemeSnapshot(tempRepo, "conf-scheme-c22-01");
    expect(loaded).not.toBeNull();
    expect(loaded?.references).toEqual(testUrls);
    expect(loaded?.scheme.references).toEqual(testUrls);
  });

  it("changes snapshot digest when references change in scheme", () => {
    const baseScheme = emptySchemeDraft({
      title: "Digest Scheme",
      summary: "Digest testing",
      modules: ["module1"],
    });

    const demo = {
      status: "none" as const,
      scheme_revision: null,
      decision_revision: null,
    };

    const digestWithout = schemeSnapshotDigest({
      scheme_revision: baseScheme.scheme_revision,
      scheme: baseScheme,
      demo,
    });

    const schemeWithRefs = emptySchemeDraft({
      ...baseScheme,
      references: ["https://example.com/digest-diff"],
    });

    const digestWith = schemeSnapshotDigest({
      scheme_revision: schemeWithRefs.scheme_revision,
      scheme: schemeWithRefs,
      demo,
    });

    expect(digestWithout).not.toEqual(digestWith);
  });

  it("projects scheme.references into contract via buildConfirmContractFromScopePlan", () => {
    const urls = ["https://partner.com/spec", "https://api.partner.com/docs"];
    const scheme = emptySchemeDraft({
      title: "Projected Scheme",
      summary: "Testing contract projection",
      modules: ["module1"],
      references: urls,
    });

    const scopePlan = makeMinimalPlan(scheme.scheme_revision);
    const contract = buildConfirmContractFromScopePlan(scheme, scopePlan);
    expect(contract.references).toEqual(urls);
  });
});
