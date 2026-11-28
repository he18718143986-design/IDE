# Stagent v0.1 — P0/P1 Security & Assurance Hardening Specification

**Status:** Draft; requires ScopePlan and human approval before implementation.  
**Target:** v0.1 hardening milestone (suggested v0.2).  
**Basis:** Static architecture review. Items are design gaps or validation targets unless independently confirmed.

## Objective
Strengthen effective execution isolation, independent acceptance, Evidence trust, and merge invariants while preserving Stagent's contract/state-machine/Worktree/Evidence/Merger architecture.

## Goals and non-goals
**Goals:** Host-generated isolation attestations; fail-closed assurance; protected acceptance assets; candidate/baseline/environment binding; explicit Evidence trust roots; consistent merge checks and recovery.
**Non-goals:** Claim heuristic test analysis proves test quality; claim local hashes alone are tamper-proof; broad rewrite or concurrency expansion.

## P0 — Execution Assurance

### Requirements
- Introduce versioned schema for requested/effective isolation, backend/platform version, filesystem/network policy digests, execution-context ID, witness, status (`PROVEN`, `UNPROVEN`, `FAILED`), freshness and timestamps.
- Effective configuration and attestation originate from execution host, not Worker input.
- Required isolation unavailable, inconclusive, stale or mismatched must block execution/merge according to policy. Downgrade requires explicit human approval; never silently downgrade.
- Probe outcomes distinguish confirmed blocking, confirmed access, and inconclusive environmental failures. Timeouts, DNS failure, unavailable host or missing tools must not be treated as proof of blocking.
- Bind attestation to backend, config, session and candidate; recheck at merge.
- Document clearly the difference between application-layer controls and OS-enforced boundaries.

### Acceptance
- [ ] Schema rejects malformed, contradictory or incomplete assurance records.
- [ ] Worker cannot override host-generated effective isolation claims.
- [ ] Missing/inconclusive/stale/mismatched required assurance fails closed.
- [ ] Probe semantics correctly represent DENIED/UNKNOWN/ALLOWED (or equivalent).
- [ ] Evidence binds assurance to candidate and execution context.
- [ ] Tests cover unavailable backend, probe error, mismatch, stale witness and policy failure.
- [ ] Product documentation makes no unsupported OS-isolation claims.

## P0 — Independent Acceptance

### Requirements
- Inventory and protect baseline tests, acceptance assertions, scripts, configs and runner identity.
- Store protected baseline metadata/content digests outside Worker-writable scope.
- Changes to protected acceptance assets require explicit contract authorization and review.
- Independently rerun protected tests using a Daemon-controlled verification path.
- Keep Worker-added tests identifiable as supplemental; heuristic weakening detection is a signal, not proof.
- Bind results to contract/criteria digest, candidate snapshot, baseline digest, runner/config and environment.
- Restoration, isolation, cleanup or binding failure makes acceptance invalid.

### Acceptance
- [ ] Protected assets inventoried and classified.
- [ ] Worker cannot alter baseline storage or verification policy through ordinary execution.
- [ ] Authorized test modifications are explicitly approved and reported.
- [ ] Verification binds candidate, contract, baseline and environment.
- [ ] Stale or incomplete binding blocks merge.
- [ ] Cleanup/restoration failure blocks acceptance and is reported.
- [ ] Tests prove baseline substitution or silent weakening cannot pass unnoticed.
- [ ] Documentation distinguishes independent checks from heuristic detection.

## P1 — Evidence trust root

### Requirements
- Explicitly distinguish self-signature consistency, configured trusted-key verification, signer authorization and optional external anchoring.
- Merge uses configured trust policy; a key embedded in Evidence alone does not establish trusted signer identity.
- Specify key provisioning, rotation, revocation, recovery and failure behavior.
- Bind signatures to contract, candidate, acceptance results, isolation record, signer identity/key ID and canonical payload.

### Acceptance
- [ ] Trust mode explicit in Evidence.
- [ ] Untrusted, unknown or revoked keys rejected in trusted-key mode.
- [ ] Payload tampering and binding mismatches fail verification.
- [ ] Key lifecycle documented and tested.
- [ ] Signature validity is not conflated with signer authorization.

## P1 — Merge transaction and invariant audit

### Requirements
- Inventory every merge/delivery entry point; enforce shared gate or prove equivalence.
- Gate must validate contract/approval, Scope, candidate integrity, Evidence trust, acceptance, and required isolation.
- Revalidate immediately before merge; define lock scope and concurrency behavior.
- Define recoverable behavior for interruption during merge, state transition and archival/closure.
- Retries cannot bypass any required gate.

### Acceptance
- [ ] Entry-point inventory reviewed.
- [ ] All entry points enforce required checks.
- [ ] Concurrent mutation is detected or excluded by lock.
- [ ] Retry paths re-run gates.
- [ ] Interrupted delivery and archival/state failures have recovery tests.
- [ ] Invariants tested independently from implementation logic.

## Test matrix

| ID | Area | Scenario | Expected |
|---|---|---|---|
| P0-EX-01 | Schema | Malformed/contradictory record | Reject |
| P0-EX-02 | Attestation | Worker supplies effective claims | Ignore/reject |
| P0-EX-03 | Capability | Required backend capability unavailable | Fail closed |
| P0-EX-04 | Probe | Inconclusive environmental error | UNKNOWN/UNPROVEN |
| P0-EX-05 | Probe | Required isolation contradicted | FAILED; block |
| P0-EX-06 | Binding | Session/config/backend mismatch | Reject |
| P0-EX-07 | Snapshot | Candidate changed after verification | Evidence stale |
| P0-AC-01 | Baseline | Protected asset altered | Detect; fail |
| P0-AC-02 | Authorization | Test change not approved | Block/review |
| P0-AC-03 | Cleanup | Restoration/cleanup failure | Block; diagnostic |
| P0-AC-04 | Binding | Candidate/baseline digest mismatch | Stale |
| P0-AC-05 | Rerun | Protected tests fail | Block merge |
| P1-EV-01 | Trust | Embedded key only | Not trusted |
| P1-EV-02 | Signature | Payload tampered | Reject |
| P1-EV-03 | Binding | Different contract/candidate | Reject |
| P1-EV-04 | Lifecycle | Unknown/revoked key | Reject |
| P1-MG-01 | Coverage | Alternate merge path | Same gates |
| P1-MG-02 | Race | Candidate changes during gate | Abort/revalidate |
| P1-MG-03 | Retry | Partial failure retry | Gates repeated |
| P1-MG-04 | Recovery | State/archive failure | Recover consistently |

Tests should be deterministic and controlled; implementation tests alone must not define their own expected correctness.

## Evidence requirements
Each task Evidence record should include:
- contract/version and approved Scope digest;
- task ID and candidate snapshot digest;
- baseline and acceptance-asset digests;
- runner and verification environment identity;
- checks, results, exit status and bounded output summaries;
- host-produced effective isolation record and attestation;
- trust mode, signer/key ID and signature verification result;
- Scope audit and changed-file classification;
- authorized test changes and review status;
- limitations, inconclusive/stale reasons;
- merge gate decision and reason codes.

Exclude secrets and unnecessary personal data.

## Work packages and sequencing
1. **WP-P0-EX:** assurance schema, attestation binding, enforcement and tri-state probes.
2. **WP-P0-AC:** protected baseline, independent rerun and binding.
3. **WP-P1-EV:** configured trust root, key lifecycle and signature binding.
4. **WP-P1-MG:** entry-point audit, locking, gate consistency and recovery.

P0 items block claiming high-assurance delivery. Work packages must be separately scoped and approved.

## Stagent execution/approval policy
- This spec is not authorization to execute.
- Stagent shall generate ScopePlan for each work package: affected modules/files, risks, budget, commands, acceptance assertions and dependencies.
- Human reviews and freezes acceptance criteria and contract before implementation.
- Worker cannot self-approve, rewrite protected criteria, or declare milestone acceptance.
- Each task produces Evidence; Daemon independently validates currentness, integrity and gates.
- Unresolved P0 failures block milestone completion.
- Final acceptance requires valid Evidence and human approval.

## Checklist
- [ ] ScopePlan reviewed
- [ ] Acceptance criteria frozen
- [ ] Contract approved
- [ ] P0 execution assurance accepted
- [ ] P0 independent acceptance accepted
- [ ] P1 trust-root policy accepted
- [ ] P1 merge/recovery audit accepted
- [ ] Evidence complete, current and valid
- [ ] No unresolved P0 failure
- [ ] Final human approval
