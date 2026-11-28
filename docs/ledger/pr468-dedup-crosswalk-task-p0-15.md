# PR #468 Deduplication Crosswalk and Incremental Disposition

**Status:** Audit input / proposed disposition; requires repository owner review.  
**Reference:** Draft PR #468, `docs/specs/stagent-v01-p0-p1-hardening.md`.  
**Purpose:** Avoid duplicating completed hardening work; isolate genuinely incremental items before task intake.

## Executive disposition

Do not merge PR #468 as-is and do not use its four broad work packages as implementation scope. Preserve the document as an audit input. This crosswalk narrows the proposed increment to:

1. **TASK-P0.15 Scope A — Evidence signature trust-root enforcement** (confirmed by owner review of `verifyEvidenceSignature` and `assertEvidenceSignatureGate`): merge-controlled verification must not accept Evidence-supplied public key as the sole trust basis.
2. **TASK-P0.15 Scope B — Merge transaction audit**: inventory delivery/merge entry points, gate-to-Git critical boundary, lock and concurrency semantics, retry/recovery behavior; record findings and remediate only approved gaps.
3. **Deferred design debt — Execution Assurance Model**: effective isolation and software-level host attestation binding; distinguish this from already delivered container fence/probe work and from hardware attestation.
4. **Deferred design debt — Cross-layer invariants**: independent tests of Lifecycle, Delivery projection, Presentation projection and authorization invariants; only expand into a task after inventory identifies a gap.

## Deduplication crosswalk

| PR #468 work item | Existing delivery / evidence cited by owner | Disposition | Incremental work |
|---|---|---|---|
| WP-P0-EX: sandbox/probe assurance | P0.1a #455 tri-state probe verdict and UNKNOWN semantics | **Mostly duplicate** | Retain only the distinct effective-isolation/host-attestation model as deferred design; avoid redoing probe logic |
| WP-P0-EX: container host fences | P0.3b-2 #434; P1.5 #463 runtime validation (read-only denial, Git masking, network DENY) | **Delivered per cited evidence** | No duplicate implementation; audit the evidence linkage only if needed |
| WP-P0-AC: protected baseline and rerun | P0.4 #426; P0.13 #459 recovery fail-closed; P0.14 #466 test-asset inventory and E_TEST_CONFIG_MUTATED | **Mostly duplicate** | No broad rewrite; verify only uncovered acceptance binding/entry paths |
| WP-P1-EV: Evidence trust | P1.2 #420 signature gate mechanism | **Mechanism exists; defect confirmed** | Scope A: trusted-key enforcement and negative tests |
| WP-P1-MG: merge gates | P0.2a #452 and P0.14 #466 checks | **Gate coverage substantially delivered** | Scope B: transaction boundary, locks, race, retries, interrupted recovery, archive/closure consistency |
| Cross-layer invariants | Not established by PR #468 itself | **Deferred** | Gap inventory first; task only for uncovered invariants |

## Scope A — TASK-P0.15: Evidence trust-root enforcement

### Problem statement
The signature verification path can fall back to the Evidence record's own `public_key` when no explicit expected key, configured key path, or environment key is supplied. This verifies payload/signature consistency but does not establish signer identity or authorization.

### Intended policy
- Controlled merge paths require a trusted key or explicitly configured trust policy.
- Evidence-supplied public key alone must not qualify as trusted identity for controlled merge.
- If a compatibility mode supports self-contained verification, label it integrity-only and do not permit it to authorize controlled merge.
- Bind trusted signer/key ID and verification policy to the Evidence record and merge decision.
- Provide negative tests for unknown/untrusted key, tampered payload, signature mismatch, and mismatched contract/candidate binding.

### Acceptance
- [ ] Controlled merge requires explicit trust policy / expected trusted key.
- [ ] No merge path silently falls back to Evidence-supplied key as identity trust.
- [ ] Integrity-only mode cannot authorize controlled merge.
- [ ] Negative tests cover untrusted key and signature/payload/binding failures.
- [ ] Positive tests prove configured trusted key path still works.
- [ ] Gate result and trust mode are recorded in Evidence/diagnostics.
- [ ] Documentation distinguishes integrity from identity and authorization.

## Scope B — TASK-P0.15: Merge transaction audit

### Audit scope
- Enumerate merge/delivery entry points and call graph.
- Identify state/evidence/contract checks and their order relative to Git mutation.
- Identify lock acquisition, release, critical-section scope and concurrency assumptions.
- Examine failure, retry, cancellation and partial-delivery recovery semantics.
- Examine archival/closure failures and reconciliation behavior.
- Map all findings to existing gates/cards; propose implementation only for uncovered defects.

### Acceptance
- [ ] Entry-point inventory and call graph recorded in ledger.
- [ ] Gate-to-mutation boundary and lock scope documented.
- [ ] Race/TOCTOU assumptions documented and tested where applicable.
- [ ] Retry and partial-failure paths mapped; uncovered bypasses corrected.
- [ ] Archive/closure failure recovery documented and tested.
- [ ] Existing delivery coverage is cross-referenced; duplicate work excluded.
- [ ] Audit conclusions and residual risks are recorded in Evidence/ledger.

## Deferred items

### Execution Assurance Model
Define effective isolation and host-produced attestation fields, binding, freshness, policy downgrade, and fail-closed behavior. This is a separate design item; it must not reimplement already delivered sandbox probes or container fences. Prioritize only after a dedicated gap analysis.

### Cross-layer invariants
Inventory lifecycle/state projection/presentation and authorization invariants. Establish independently authored expected outcomes. Create a task only where coverage is demonstrably missing.

## Proposed TASK-P0.15 intake

**Estimate:** M  
**Scope:** A (signature trust-root enforcement) + B (merge transaction audit).  
**Excluded:** Broad sandbox rewrite, baseline isolation rewrite, container-host rewrite, hardware attestation, cross-layer expansion.

This crosswalk is a pre-intake audit artifact, not an approved implementation Contract. Task scope, budget, files, commands and acceptance assertions must be frozen through Stagent's normal approval flow.
