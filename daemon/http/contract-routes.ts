import type http from "node:http";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import type { StagentDaemon } from "../server";
import {
  assertDemoConfirmedForWrite,
  readDemoConfirm,
} from "../supervisor/demo/prototypes";
import {
  evaluateLatestDemoGate,
  evaluateSnapshotDemoGate,
  type DemoSignGateDecision,
} from "../supervisor/demo/signing-gate";
import {
  findFrozenSnapshotBySchemeRevision,
  readSchemeSnapshot,
  schemeBindingFromSnapshot,
  type SchemeSnapshot,
} from "../pipeline/scheme-snapshot-store";
import { readSchemeLedger } from "../supervisor/intent-compiler/scheme-ledger-store";
import {
  assertContractScopeAllowed,
  WritableScopePolicyError,
} from "../supervisor/scope-gate";
import {
  assertSignedContractMatchesSnapshot,
  SchemeSnapshotMismatchError,
  ScopeInvariantBrokenError,
} from "../supervisor/scope-preflight";
import { recordConfirmAuthorizations } from "../supervisor/authorization-allowlist-store";
import {
  clearGatewayViolation,
  loadCurrentGatewayViolation,
} from "../guard/gateway-violation-store";
import { projectDeliveryState } from "../../src/lib/state/delivery-state";
import { IllegalContractTransitionError } from "../pipeline/contract-store";
import {
  loadEvidenceSnapshot,
  loadLatestEvidenceSnapshot,
  squashMerge,
  TargetBranchAdvancedError,
} from "../pipeline/merger";
import { closeRound } from "../protection/protection-list";
import { clearCheckpoint } from "../protection/auto-checkpoint";
import {
  softwareContractSchema,
  applyContractScopeChange,
  ScopeChangeForbiddenError,
} from "../../src/lib/contract.schema";
import { readPlan } from "../project/plan-store";
import { readDiffFiles } from "../diff/diff-files";
import { launchEditor } from "../editor/launcher";
import {
  applyContractStubTerminal,
  findInFlightContract,
  stubIdFromContract,
  triggerRedecomposeIfNeeded,
} from "../project/contract-sequence";
import { nextStub } from "../../src/lib/project/next-stub";
import { DirtyWorktreeConfirmationRequiredError } from "../git/worktree-manager";

/**
 * TASK-J.42 过渡：本文件直接拿 Daemon 实例。
 * 窄上下文还没抽。调用顺序与从 handleHttpRequest 搬出前一致。
 */

/**
 * 先按 confirmation_id 读快照；读不到时再按台账草案的 scheme_id+修订号
 * 定位规划阶段已冻结快照。不写盘。找不到或内容冲突时返回 null。
 */
function resolveSchemeSnapshotForConfirmation(
  repoRoot: string,
  confirmationId: string,
): SchemeSnapshot | null {
  const byId = readSchemeSnapshot(repoRoot, confirmationId);
  if (byId) return byId;
  const draft = readSchemeLedger(repoRoot)?.state.draft;
  if (!draft?.scheme_id || typeof draft.scheme_revision !== "number") {
    return null;
  }
  const found = findFrozenSnapshotBySchemeRevision(
    repoRoot,
    draft.scheme_id,
    draft.scheme_revision,
  );
  return found.ok ? found.snapshot : null;
}

export async function handleContractRoutes(
  server: StagentDaemon,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  method: string,
  pathname: string,
): Promise<void> {
  const store = server.orchestrator.getStore();

  if (method === "GET" && pathname === "/api/contracts") {
    server.sendJson(res, 200, { contracts: store.list() });
    return;
  }

  if (method === "POST" && pathname === "/api/contracts") {
    try {
      const body = (await server.readJsonBody(req)) as {
        contract?: unknown;
        confirmation_id?: string;
      };
      if (!body.contract) {
        server.sendJson(res, 400, { error: "contract is required" });
        return;
      }
      let contract = softwareContractSchema.parse(body.contract);
      // TASK-L.9：合同级互斥——已有 PREPARING～AUDITED 则拒绝签署下一份
      const inFlight = findInFlightContract(store.list());
      if (inFlight) {
        server.sendJson(res, 409, {
          error: "contract_in_flight",
          code: "E_CONTRACT_IN_FLIGHT",
          message: "上一份还没做完，做完我再开下一份。",
          in_flight_contract_id: inFlight.contract_id,
          in_flight_lifecycle_state: inFlight.lifecycle_state,
        });
        return;
      }
      let snapshotDemoGate: DemoSignGateDecision | undefined;
      if (body.confirmation_id) {
        const snapshot = resolveSchemeSnapshotForConfirmation(
          server.repoRoot,
          body.confirmation_id,
        );
        if (!snapshot) {
          server.sendJson(res, 409, {
            error: "scheme_snapshot_not_found",
            code: "E_SCHEME_SNAPSHOT_NOT_FOUND",
            message: "确认快照不存在或已损坏，拒绝创建可签署合同",
          });
          return;
        }
        try {
          assertSignedContractMatchesSnapshot({
            repoRoot: server.repoRoot,
            contract,
            snapshot,
          });
        } catch (scopeErr) {
          const code = (scopeErr as { code?: string }).code;
          if (code === "E_SCHEME_SNAPSHOT_NOT_FOUND") {
            server.sendJson(res, 409, {
              error: "scheme_snapshot_not_found",
              code: "E_SCHEME_SNAPSHOT_NOT_FOUND",
              message: (scopeErr as Error).message,
            });
            return;
          }
          if (scopeErr instanceof SchemeSnapshotMismatchError) {
            server.sendJson(res, 409, {
              error: "scheme_snapshot_mismatch",
              code: scopeErr.code,
              message: scopeErr.message,
            });
            return;
          }
          if (scopeErr instanceof ScopeInvariantBrokenError) {
            server.sendJson(res, 500, {
              error: "scope_invariant_broken",
              code: scopeErr.code,
              message: scopeErr.message,
            });
            return;
          }
          throw scopeErr;
        }
        // 与快照一致：跳过 assertContractScopeAllowed（预检已保证合规）
        snapshotDemoGate = evaluateSnapshotDemoGate(snapshot, (prototypeId) =>
          readDemoConfirm(server.repoRoot, prototypeId),
        );
        if (!snapshotDemoGate.ok) {
          server.sendJson(res, 409, {
            error: snapshotDemoGate.message,
            code: snapshotDemoGate.code,
          });
          return;
        }
        // TASK-J.18b / GAP-W1：校验通过后永久写入 scheme_binding（旧直签不走此支）
        contract = softwareContractSchema.parse({
          ...contract,
          scheme_binding: schemeBindingFromSnapshot(
            snapshot.confirmation_id,
            snapshot,
          ),
        });
      } else {
        assertContractScopeAllowed(
          server.repoRoot,
          contract.authorization.file_system_scope.writable_paths,
        );
      }
      const saved = store.save(contract);
      server.emitContractUpdate(saved);
      // TASK-D.2 核心目标 1：创建即准入裁决——无交集自动批准（零点击），有交集登记白话卡
      let admission: Awaited<
        ReturnType<typeof server.orchestrator.admit>
      > | null = null;
      if (saved.lifecycle_state === "PENDING_APPROVAL") {
        admission = await server.orchestrator.admit(saved.contract_id, {
          ...(snapshotDemoGate ? { demoGate: snapshotDemoGate } : {}),
        });
        if (admission.contract.lifecycle_state !== saved.lifecycle_state) {
          server.emitContractUpdate(admission.contract);
        }
      }
      const created = admission?.contract ?? saved;
      // TASK-J.20：确认开工成功 → 点名敏感项写入授权清单（跨合同自动放行；可失效）
      if (body.confirmation_id) {
        const snapForAllow = resolveSchemeSnapshotForConfirmation(
          server.repoRoot,
          body.confirmation_id,
        );
        if (snapForAllow?.scope_plan) {
          recordConfirmAuthorizations(server.repoRoot, {
            scopePlan: snapForAllow.scope_plan,
            source_contract_id: created.contract_id,
            source_confirmation_id: snapForAllow.confirmation_id,
          });
        }
      }
      // TASK-L.9：合同生成回填桩 status=signed + contract_id
      const createdStubId = stubIdFromContract(created);
      if (createdStubId) {
        applyContractStubTerminal(
          server.repoRoot,
          createdStubId,
          "signed",
          created.contract_id,
        );
        if (!server.activeContracts.includes(created.contract_id)) {
          server.activeContracts.push(created.contract_id);
        }
      }
      server.sendJson(res, 201, {
        contract: created,
        admission,
      });
    } catch (err) {
      if (err instanceof WritableScopePolicyError) {
        server.sendJson(res, 403, {
          error: err.message,
          code: err.code,
          rejected: err.rejected,
        });
        return;
      }
      server.sendJson(res, 400, { error: (err as Error).message });
    }
    return;
  }

  // TASK-C.4: Scope 变更派生新 Revision 生产接口 (同 contract_id + 修订历史)
  const scopeRevisionMatch = pathname.match(
    /^\/api\/contracts\/([^/]+)\/scope-revision$/,
  );
  if (scopeRevisionMatch) {
    let contractId: string;
    try {
      contractId = decodeURIComponent(scopeRevisionMatch[1] as string);
    } catch {
      server.sendJson(res, 400, { error: "Invalid URL encoding" });
      return;
    }
    if (method !== "POST") {
      server.sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const body = (await server.readJsonBody(req)) as {
        writable_paths?: string[];
      };
      if (!body || !Array.isArray(body.writable_paths)) {
        server.sendJson(res, 400, {
          error: "writable_paths array is required",
        });
        return;
      }
      const current = store.get(contractId);
      if (!current) {
        server.sendJson(res, 404, { error: "Contract not found" });
        return;
      }
      assertContractScopeAllowed(server.repoRoot, body.writable_paths);
      // Fail-Closed 裁决在 applyContractScopeChange 内（终态 / 执行中 / 非法边 → 抛错，不落盘）
      const result = applyContractScopeChange(current, body.writable_paths);
      const saved =
        result.mode === "draft"
          ? store.save(result.contract)
          : store.transition({
              contractId,
              lifecycleState: "PENDING_APPROVAL",
              approvalStatus: "PENDING_REVIEW",
              nextContract: result.contract,
            });
      server.emitContractUpdate(saved);
      server.sendJson(res, 200, {
        contract: saved,
        mode: result.mode,
        previous_revision: result.previousRevision,
        new_revision: result.newRevision,
      });
    } catch (err) {
      if (err instanceof WritableScopePolicyError) {
        server.sendJson(res, 403, {
          error: err.message,
          code: err.code,
          rejected: err.rejected,
        });
        return;
      }
      if (
        err instanceof ScopeChangeForbiddenError ||
        err instanceof IllegalContractTransitionError
      ) {
        server.sendJson(res, 409, { error: err.message, code: err.code });
        return;
      }
      server.sendJson(res, 400, { error: (err as Error).message });
    }
    return;
  }

  const violationMatch = pathname.match(
    /^\/api\/contracts\/([^/]+)\/gateway-violation$/,
  );
  if (violationMatch) {
    let contractId: string;
    try {
      contractId = decodeURIComponent(violationMatch[1] as string);
    } catch {
      server.sendJson(res, 400, { error: "Invalid URL encoding" });
      return;
    }
    const contract = store.get(contractId);
    if (!contract) {
      server.sendJson(res, 404, { error: "Contract not found" });
      return;
    }
    if (method === "GET") {
      const violation = loadCurrentGatewayViolation(
        server.repoRoot,
        contractId,
        contract.contract_revision,
      );
      server.sendJson(res, 200, { violation });
      return;
    }
    // 只允许用户显式清除；Worker 没有 API token，也不暴露 MCP 工具
    if (method === "DELETE") {
      const cleared = clearGatewayViolation(server.repoRoot, contractId);
      server.sendJson(res, 200, { cleared });
      return;
    }
    server.sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  // TASK-C.15b / EO-08：返工计数只读 + Daemon 权威写
  const reworkMatch = pathname.match(
    /^\/api\/contracts\/([^/]+)\/rework(?:\/(failure|assertions|split))?$/,
  );
  if (reworkMatch) {
    let contractId: string;
    try {
      contractId = decodeURIComponent(reworkMatch[1] as string);
    } catch {
      server.sendJson(res, 400, { error: "Invalid URL encoding" });
      return;
    }
    const sub = reworkMatch[2];
    const contract = store.get(contractId);
    if (!contract) {
      server.sendJson(res, 404, { error: "Contract not found" });
      return;
    }
    if (method === "GET" && !sub) {
      const rework = server.orchestrator.getReworkSnapshot(contractId);
      const delivery_state = projectDeliveryState({
        lifecycle_state: contract.lifecycle_state,
        rework_required: rework?.phase === "rework",
        escalated: rework?.phase === "escalated",
      });
      server.sendJson(res, 200, { rework, delivery_state });
      return;
    }
    if (method === "POST" && sub === "failure") {
      try {
        const body = (await server.readJsonBody(req)) as {
          assertion_id?: string;
        };
        if (!body.assertion_id) {
          server.sendJson(res, 400, { error: "assertion_id is required" });
          return;
        }
        const rework = server.orchestrator.recordAssertionFailure(
          contractId,
          body.assertion_id,
        );
        const after = store.get(contractId) ?? contract;
        server.emitContractUpdate(after);
        server.sendJson(res, 200, {
          rework,
          delivery_state: projectDeliveryState({
            lifecycle_state: after.lifecycle_state,
            rework_required: rework.phase === "rework",
            escalated: rework.phase === "escalated",
          }),
          contract: after,
        });
      } catch (err) {
        const code = (err as Error & { code?: string }).code;
        if (code === "E_ASSERTION_ID_UNKNOWN") {
          server.sendJson(res, 400, {
            error: (err as Error).message,
            code,
          });
          return;
        }
        server.sendActionError(res, err);
      }
      return;
    }
    if (method === "POST" && sub === "assertions") {
      try {
        const body = (await server.readJsonBody(req)) as { text?: string };
        if (!body.text) {
          server.sendJson(res, 400, { error: "text is required" });
          return;
        }
        const assertion_id = server.orchestrator.tryAddAssertion(
          contractId,
          body.text,
        );
        server.sendJson(res, 200, {
          assertion_id,
          rework: server.orchestrator.getReworkSnapshot(contractId),
        });
      } catch (err) {
        const code = (err as Error & { code?: string }).code;
        if (code === "E_ASSERTION_ADD_FORBIDDEN") {
          server.sendJson(res, 409, {
            error: (err as Error).message,
            code,
          });
          return;
        }
        server.sendActionError(res, err);
      }
      return;
    }
    if (method === "POST" && sub === "split") {
      try {
        const body = (await server.readJsonBody(req)) as { text?: string };
        if (!body.text) {
          server.sendJson(res, 400, { error: "text is required" });
          return;
        }
        const result = server.orchestrator.splitAssertion(
          contractId,
          body.text,
        );
        if (result.kind === "out_of_scope") {
          server.sendJson(res, 409, {
            error: result.reason,
            code: result.code,
            kind: result.kind,
          });
          return;
        }
        const after = store.get(contractId) ?? contract;
        if (result.snapshot.phase === "escalated") {
          server.emitContractUpdate(after);
        }
        server.sendJson(res, 200, { result, contract: after });
      } catch (err) {
        server.sendActionError(res, err);
      }
      return;
    }
    server.sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const match = pathname.match(
    /^\/api\/contracts\/([^/]+)(?:\/(admit|approve|execute|run-worker|open-editor|diff-files|diff|merge-decision|merge|evidence|resume|abort|return-to-pending)(?:\/([^/]+))?)?$/,
  );
  if (match) {
    // W.3：非法百分号编码（如 %E0%A4%A）会让 decodeURIComponent 抛 URIError，
    // 统一返回 400，避免落到外层变成 500 或泄露堆栈。
    let contractId: string;
    let subId: string | undefined;
    try {
      contractId = decodeURIComponent(match[1] as string);
      subId =
        match[3] === undefined
          ? undefined
          : decodeURIComponent(match[3] as string);
    } catch {
      server.sendJson(res, 400, { error: "Invalid URL encoding" });
      return;
    }
    const action = match[2];

    if (method === "GET" && !action) {
      const contract = store.get(contractId);
      if (!contract) {
        server.sendJson(res, 404, { error: "Contract not found" });
        return;
      }
      server.sendJson(res, 200, { contract });
      return;
    }

    // Track C：EVIDENCE_READY 推送后，控制台据此拉取完整证据包，不必等用户点执行
    if (method === "GET" && action === "evidence") {
      const snapshot = subId
        ? loadEvidenceSnapshot(server.repoRoot, contractId, subId)
        : loadLatestEvidenceSnapshot(server.repoRoot, contractId);
      if (!snapshot) {
        server.sendJson(res, 404, { error: "Evidence not found" });
        return;
      }
      server.sendJson(res, 200, { evidence: snapshot });
      return;
    }

    // TASK-D.2：显式准入裁决（供 UI 在用户点「同意」后重跑；创建时已自动执行一次）
    if (method === "POST" && action === "admit") {
      try {
        const admission = await server.orchestrator.admit(contractId);
        server.emitContractUpdate(admission.contract);
        server.sendJson(
          res,
          admission.decision === "NEEDS_APPROVAL" ? 202 : 200,
          { contract: admission.contract, admission },
        );
      } catch (err) {
        server.sendActionError(res, err);
      }
      return;
    }

    if (method === "POST" && action === "approve") {
      try {
        const body = (await server.readJsonBody(req)) as {
          reviewer?: string;
          acknowledge_dirty?: boolean;
          confirmation_id?: string;
        };
        const current = store.get(contractId);
        if (!current) {
          server.sendJson(res, 404, { error: "Contract not found" });
          return;
        }
        let demoGate: DemoSignGateDecision;
        if (body.confirmation_id) {
          const snapshot = resolveSchemeSnapshotForConfirmation(
            server.repoRoot,
            body.confirmation_id,
          );
          if (!snapshot) {
            server.sendJson(res, 409, {
              error: "scheme_snapshot_not_found",
              code: "E_SCHEME_SNAPSHOT_NOT_FOUND",
              message: "确认快照不存在或已损坏，拒绝签署",
            });
            return;
          }
          try {
            assertSignedContractMatchesSnapshot({
              repoRoot: server.repoRoot,
              contract: current,
              snapshot,
            });
          } catch (scopeErr) {
            const code = (scopeErr as { code?: string }).code;
            if (code === "E_SCHEME_SNAPSHOT_NOT_FOUND") {
              server.sendJson(res, 409, {
                error: "scheme_snapshot_not_found",
                code: "E_SCHEME_SNAPSHOT_NOT_FOUND",
                message: (scopeErr as Error).message,
              });
              return;
            }
            if (scopeErr instanceof SchemeSnapshotMismatchError) {
              server.sendJson(res, 409, {
                error: "scheme_snapshot_mismatch",
                code: scopeErr.code,
                message: scopeErr.message,
              });
              return;
            }
            if (scopeErr instanceof ScopeInvariantBrokenError) {
              server.sendJson(res, 500, {
                error: "scope_invariant_broken",
                code: scopeErr.code,
                message: scopeErr.message,
              });
              return;
            }
            throw scopeErr;
          }
          // 与快照一致：跳过 assertContractScopeAllowed
          demoGate = evaluateSnapshotDemoGate(snapshot, (prototypeId) =>
            readDemoConfirm(server.repoRoot, prototypeId),
          );
        } else {
          assertContractScopeAllowed(
            server.repoRoot,
            current.authorization.file_system_scope.writable_paths,
          );
          // 旧路径没有快照：保守回退最新 Demo 记录；从未生成才允许。
          demoGate = evaluateLatestDemoGate(server.repoRoot);
        }
        if (!demoGate.ok) {
          server.sendJson(res, 409, {
            error: demoGate.message,
            code: demoGate.code,
            ...(demoGate.prototype_id
              ? { prototype_id: demoGate.prototype_id }
              : {}),
          });
          return;
        }

        const contract = await server.orchestrator.approve(
          contractId,
          body.reviewer ?? "local-user",
          {
            acknowledgeDirty: body.acknowledge_dirty === true,
            demoGate,
          },
        );
        server.emitContractUpdate(contract);
        server.sendJson(res, 200, { contract });
      } catch (err) {
        if (err instanceof WritableScopePolicyError) {
          server.sendJson(res, 403, {
            error: err.message,
            code: err.code,
            rejected: err.rejected,
          });
          return;
        }
        if (err instanceof DirtyWorktreeConfirmationRequiredError) {
          server.sendJson(res, 409, {
            error: "worktree_dirty_confirmation_required",
            code: "E_WORKTREE_DIRTY",
            message: err.message,
            dirty_count: err.dirtyFiles.length,
            dirty_files: err.dirtyFiles,
            plain_message: err.guidance.plain_message,
            exclusion_suggestions: err.guidance.exclusion_suggestions,
            dirty_exclusions: err.guidance.dirty_exclusions,
          });
          return;
        }
        server.sendActionError(res, err);
      }
      return;
    }

    if (method === "POST" && action === "run-worker") {
      try {
        // TASK-C.11b/c：未确认 Demo 禁止写真码（Fast Path 由 skip_demo / 无 prototype 策略另判）
        try {
          assertDemoConfirmedForWrite(
            server.repoRoot,
            server.activePrototypeId ?? undefined,
            {
              // 本轮未挂载 prototype（Fast Path / 旧路径）则跳过；挂载了就必须已确认
              skip_demo: server.activePrototypeId == null,
            },
          );
        } catch (gateErr) {
          const code = (gateErr as Error & { code?: string }).code;
          if (code === "E_DEMO_NOT_CONFIRMED") {
            server.sendJson(res, 409, {
              error: "Demo not confirmed",
              code: "E_DEMO_NOT_CONFIRMED",
              message: (gateErr as Error).message,
            });
            return;
          }
          throw gateErr;
        }
        const result = await server.orchestrator.runWorker(contractId);
        server.emitWorkerLog(contractId, result.log);
        // Worker 可能把状态推到 PENDING_RESUME（预算/循环熔断）
        const afterWorker = store.get(contractId);
        if (afterWorker) server.emitContractUpdate(afterWorker);
        server.sendJson(res, 200, { result });
      } catch (err) {
        server.sendActionError(res, err);
      }
      return;
    }

    if (method === "POST" && action === "merge") {
      try {
        const body = (await server.readJsonBody(req)) as {
          reviewer?: string;
          evidence_id?: string;
        };
        if (!body.evidence_id) {
          server.sendJson(res, 400, { error: "evidence_id is required" });
          return;
        }
        const snapshot = loadEvidenceSnapshot(
          server.repoRoot,
          contractId,
          body.evidence_id,
        );
        if (!snapshot) {
          server.sendJson(res, 404, { error: "Evidence not found" });
          return;
        }
        await server.stopEvidenceWatcher(contractId);
        const result = await squashMerge({
          repoRoot: server.repoRoot,
          contractId,
          evidence: snapshot,
          reviewer: body.reviewer ?? "local-user",
        });
        // P.1：真正产生提交才关轮（授权作废、快照不再可撤）；
        // AI 改动全部被用户版本覆盖时没有提交，保留本轮与 Worktree 供 AI 重做。
        if (!result.nothingToMerge) {
          // TASK-L.5：合入后回收预览进程组，释放 4200～4210 端口
          await server.stopRealPlaytest(contractId);
          closeRound(server.repoRoot, "MERGED");
          clearCheckpoint(server.repoRoot);
          server.targetAdvancedContracts.delete(contractId);
          server.emitContractUpdate(result.contract);
          // TASK-L.9：合入回填桩 merged；从 activeContracts 移除
          const mergedStubId = stubIdFromContract(result.contract);
          if (mergedStubId) {
            applyContractStubTerminal(
              server.repoRoot,
              mergedStubId,
              "merged",
              result.contract.contract_id,
            );
          }
          server.activeContracts = server.activeContracts.filter(
            (id) => id !== contractId,
          );
        }
        const planAfterMerge = readPlan(server.repoRoot);
        const next = planAfterMerge ? nextStub(planAfterMerge) : null;
        server.sendJson(res, 200, {
          result,
          ...(next
            ? { next_stub_id: next.stub_id, next_stub: next }
            : { next_stub_id: null }),
        });
      } catch (err) {
        // D-4：目标分支已前进 → 409 + 二选一，绝不静默 rebase 或强行合并
        if (err instanceof TargetBranchAdvancedError) {
          server.targetAdvancedContracts.add(contractId);
          const contract = store.get(contractId);
          if (contract) server.emitContractUpdate(contract);
          server.sendJson(res, 409, {
            error: "Target branch has advanced",
            code: err.code,
            options: [...err.options],
            target_head: err.targetHead,
            base_head: err.baseHead,
            message:
              "目标分支在施工期间有新的改动，请选择重演本轮改动或放弃候选成果。",
          });
          return;
        }
        server.sendActionError(res, err);
      }
      return;
    }

    if (method === "POST" && action === "merge-decision") {
      try {
        const body = (await server.readJsonBody(req)) as {
          decision?: string;
          reviewer?: string;
        };
        const decision = body.decision;
        if (
          decision !== "REPLAY_ON_CURRENT_BASELINE" &&
          decision !== "ABANDON_CANDIDATE"
        ) {
          server.sendJson(res, 400, {
            error:
              "decision must be REPLAY_ON_CURRENT_BASELINE or ABANDON_CANDIDATE",
          });
          return;
        }

        if (decision === "ABANDON_CANDIDATE") {
          const contract = await server.orchestrator.abort(contractId, {
            reviewer: body.reviewer ?? "local-user",
            reason: "TARGET_BRANCH_ADVANCED_ABANDON",
          });
          // TASK-L.5：放弃候选时回收预览
          await server.stopRealPlaytest(contractId);
          server.targetAdvancedContracts.delete(contractId);
          server.emitContractUpdate(contract);
          server.sendJson(res, 200, { decision, contract });
          return;
        }

        // REPLAY：合入最新基线 → 走既有验证管道 → 产出新证据
        const outcome =
          await server.orchestrator.replayOnCurrentBaseline(contractId);
        server.targetAdvancedContracts.delete(contractId);
        server.emitContractUpdate(outcome.contract);
        server.sendJson(res, 200, { decision, outcome });
      } catch (err) {
        server.sendActionError(res, err);
      }
      return;
    }

    if (method === "GET" && action === "diff-files") {
      // TASK-C.5 双栏 Diff：逐文件返回基线/当前两段真实内容
      let worktreePath: string;
      try {
        worktreePath = server.resolveWorktreePath(contractId);
      } catch (err) {
        server.sendJson(res, 400, {
          error: `invalid contract id: ${(err as Error).message}`,
        });
        return;
      }
      if (!fs.existsSync(worktreePath)) {
        server.sendJson(res, 404, { error: "Worktree not found" });
        return;
      }
      try {
        const baseBranch =
          store.get(contractId)?.authorization.git.base_branch ?? "main";
        const result = await readDiffFiles(worktreePath, baseBranch);
        server.sendJson(res, 200, result);
      } catch (err) {
        server.sendJson(res, 500, { error: (err as Error).message });
      }
      return;
    }

    if (method === "GET" && action === "diff") {
      let worktreePath: string;
      try {
        worktreePath = server.resolveWorktreePath(contractId);
      } catch (err) {
        server.sendJson(res, 400, {
          error: `invalid contract id: ${(err as Error).message}`,
        });
        return;
      }
      if (!fs.existsSync(worktreePath)) {
        server.sendJson(res, 404, { error: "Worktree not found" });
        return;
      }
      try {
        // 验证阶段会把 Worktree 改动 commit 到任务分支，`diff HEAD` 因此恒为空。
        // 以基线分支为参照：既包含已提交的任务改动，也包含尚未提交的现场改动。
        const baseBranch =
          store.get(contractId)?.authorization.git.base_branch ?? "main";
        const patch = execFileSync("git", ["diff", baseBranch], {
          cwd: worktreePath,
          encoding: "utf-8",
        });
        const stat = execFileSync("git", ["diff", "--stat", baseBranch], {
          cwd: worktreePath,
          encoding: "utf-8",
        });
        server.sendJson(res, 200, { patch, stat });
      } catch (err) {
        server.sendJson(res, 500, { error: (err as Error).message });
      }
      return;
    }

    if (method === "POST" && action === "open-editor") {
      try {
        const contract = store.get(contractId);
        const result = await launchEditor({
          repoRoot: server.repoRoot,
          contractId,
          template:
            contract?.authorization.execution_permissions
              .editor_command_template,
        });
        server.sendJson(res, 200, { result });
      } catch (err) {
        server.sendJson(res, 400, { error: (err as Error).message });
      }
      return;
    }

    if (method === "POST" && action === "resume") {
      try {
        const contract = await server.orchestrator.resume(contractId);
        server.emitContractUpdate(contract);
        server.sendJson(res, 200, { contract });
      } catch (err) {
        server.sendActionError(res, err);
      }
      return;
    }

    if (method === "POST" && action === "return-to-pending") {
      // TASK-AUDITED.2：AUDITED+APPROVED → 退回待批
      try {
        const body = (await server.readJsonBody(req)) as {
          reviewer?: string;
        };
        const contract = await server.orchestrator.returnToPending(
          contractId,
          typeof body.reviewer === "string" ? body.reviewer : undefined,
        );
        server.emitContractUpdate(contract);
        server.sendJson(res, 200, { contract });
      } catch (err) {
        server.sendActionError(res, err);
      }
      return;
    }

    if (method === "POST" && action === "abort") {
      // TASK-D.3 / D-1：登记停止看门狗。回收在 15s 内未完成即强杀并转 ABORTED，
      // 避免进程树/锁悬挂把整个合同永久卡在"正在停止"。
      server.stoppingContracts.add(contractId);
      server.deadlock.beginStop(contractId);
      try {
        const body = (await server.readJsonBody(req)) as {
          reviewer?: string;
          reason?: string;
        };
        const contract = await server.orchestrator.abort(contractId, {
          ...(body.reviewer === undefined ? {} : { reviewer: body.reviewer }),
          ...(body.reason === undefined ? {} : { reason: body.reason }),
        });
        // TASK-L.5：ABORTED 时回收预览进程组
        await server.stopRealPlaytest(contractId);
        // 中止的合同若正被证据监听武装，立即解除（其 Worktree 已清理）
        await server.stopEvidenceWatcher(contractId);
        server.targetAdvancedContracts.delete(contractId);
        server.emitContractUpdate(contract);
        // TASK-L.9：ABORTED → 桩 aborted；必要时触发重新分解
        let redecompose_requested = false;
        const abortedStubId = stubIdFromContract(contract);
        if (abortedStubId) {
          const sync = applyContractStubTerminal(
            server.repoRoot,
            abortedStubId,
            "aborted",
            contract.contract_id,
          );
          if (sync?.redecompose && sync.plan) {
            const req = triggerRedecomposeIfNeeded(
              server.repoRoot,
              sync.plan,
              abortedStubId,
              contract.contract_id,
            );
            redecompose_requested = Boolean(req);
          }
        }
        server.activeContracts = server.activeContracts.filter(
          (id) => id !== contractId,
        );
        server.sendJson(res, 200, {
          contract,
          redecompose_requested,
        });
      } catch (err) {
        server.sendActionError(res, err);
      } finally {
        server.deadlock.completeStop(contractId);
        server.stoppingContracts.delete(contractId);
      }
      return;
    }

    if (method === "POST" && action === "execute") {
      try {
        const outcome = await server.orchestrator.execute(contractId);
        if (outcome.evidence.verdict.status === "PASSED") {
          await server.armEvidenceWatcher(
            contractId,
            outcome.evidence.evidence_id,
          );
        }
        server.emitContractUpdate(outcome.contract);
        server.emitEvidenceReady(contractId, outcome.evidence);
        server.sendJson(res, 200, {
          contract: outcome.contract,
          evidence: outcome.evidence,
          ...(outcome.rework ? { rework: outcome.rework } : {}),
          ...(outcome.delivery_state
            ? { delivery_state: outcome.delivery_state }
            : {}),
        });
      } catch (err) {
        server.sendActionError(res, err);
      }
      return;
    }
  }

  server.sendJson(res, 404, { error: "Not Found", path: pathname });
  return;
}
