/**
 * TASK-P0.16: Records Archive & Public Delivery Idempotent Compensation
 * 专项验收测试套件（DoD P016-P1～P5）。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { safeRmSync } from "../helpers/tmp";
import {
  archiveContractRecords,
  compensateContractRecordsArchive,
  assertRecordsReadyForDelivered,
} from "../../daemon/pipeline/records-archive";
import { compensateMergeRecordsArchive } from "../../daemon/pipeline/merger";
import {
  publicDeliveryCopy,
  H2_TERMINAL_SCHEME,
  PUBLIC_DELIVERY_TERMINAL,
} from "../../src/lib/state/terminal-delivery-closure";
import {
  recordsDir,
  readAuditManifest,
} from "../../daemon/guard/audit-manifest";
import {
  buildMinimalPrototypeDemo,
  confirmDemoPrototype,
  writePrototype,
} from "../../daemon/supervisor/demo/prototypes";

describe("TASK-P0.16 Records Archive Idempotent Compensation", () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-p016-test-"));
  });

  afterEach(() => {
    safeRmSync(repo);
  });

  describe("P016-P1: 辅助拷贝失败路径枚举与隔离捕获语义", () => {
    it("归档失败时隔离捕获，不破坏主流程，状态保持 delivery_complete: false 并阻断 DELIVERED", () => {
      // 构造非法或被锁定的记录目录（模拟 EACCES / 目录无法创建）
      const contractId = "contract-p016-err";
      const targetDir = recordsDir(repo, contractId);
      fs.mkdirSync(path.dirname(targetDir), { recursive: true });
      // 将目标位置创建为不可写普通文件以阻断 mkdirSync
      fs.writeFileSync(targetDir, "blocking-file", "utf8");

      const archive = archiveContractRecords({
        repoRoot: repo,
        contract_id: contractId,
        commit_sha: "test-sha-1234",
      });

      // 验证隔离捕获：不抛出未捕获异常，记录错误信息
      expect(archive.ok).toBe(false);
      expect(archive.error).toBeDefined();

      // 验证交付文案状态投影：archive_ok: false 不标交付完成
      const delivery = publicDeliveryCopy({
        lifecycle_state: "MERGED",
        archive_ok: archive.ok,
      });
      expect(delivery.terminal).toBe(true);
      expect(delivery.delivery_complete).toBe(false);
      expect(delivery.label).toBe("已合入（归档未完成，尚未标交付完成）");

      // 验证 DELIVERED 门禁拦截
      expect(() => assertRecordsReadyForDelivered(repo, contractId)).toThrow(
        /E_RECORDS_ARCHIVE_REQUIRED|禁止标 DELIVERED/,
      );
    });
  });

  describe("P016-P2: 幂等补偿机制设计与实现", () => {
    it("补偿成功创建完整 records、manifest 与 summary，且解除 DELIVERED 门禁", () => {
      const contractId = "contract-p016-succ";
      const demo = buildMinimalPrototypeDemo("P0.16补偿测试");
      const written = writePrototype(repo, "proto-p016", demo);
      confirmDemoPrototype(repo, written.prototype_id, {
        demo_mode: "INTERACTIVE_DEMO",
      });

      const res = compensateContractRecordsArchive({
        repoRoot: repo,
        contract_id: contractId,
        prototype_id: written.prototype_id,
        commit_sha: "commit-sha-5678",
      });

      expect(res.ok).toBe(true);
      expect(res.compensated).toBe(true);
      expect(res.copied).toContain("demo-confirm.json");
      expect(res.copied).toContain("delivery-summary.json");
      expect(res.copied).toContain("audit-manifest.json");

      // 验证 audit-manifest 真实存在且有效
      const manifest = readAuditManifest(repo, contractId);
      expect(manifest).not.toBeNull();
      expect(manifest?.contract_id).toBe(contractId);
      expect(manifest?.commit_sha).toBe("commit-sha-5678");

      // 门禁断言通过
      expect(() =>
        assertRecordsReadyForDelivered(repo, contractId),
      ).not.toThrow();
    });
  });

  describe("P016-P3: 显式补偿重试入口与交付状态收敛", () => {
    it("compensateMergeRecordsArchive 驱动交付状态无缝收敛为 delivery_complete: true", () => {
      const contractId = "contract-p016-converge";
      const commitSha = "merge-commit-sha-9999";

      // 首次调用显式补偿接口
      const compRes = compensateMergeRecordsArchive({
        repoRoot: repo,
        contract_id: contractId,
        commit_sha: commitSha,
      });

      expect(compRes.ok).toBe(true);
      expect(compRes.contract_id).toBe(contractId);
      expect(compRes.recordsArchive.ok).toBe(true);
      expect(compRes.recordsArchive.compensated).toBe(true);

      // 验证交付终态收敛
      expect(compRes.deliveryTerminal.scheme).toBe(H2_TERMINAL_SCHEME);
      expect(compRes.deliveryTerminal.lifecycle_state).toBe(
        PUBLIC_DELIVERY_TERMINAL,
      );
      expect(compRes.deliveryTerminal.delivery_complete).toBe(true);
      expect(compRes.deliveryTerminal.label).toBe("已交付归档");
    });
  });

  describe("P016-P4: 负向防重、中断恢复与断点续写", () => {
    it("损坏 summary 与缺失 manifest 场景下的断点续写与修复（repaired）", () => {
      const contractId = "contract-p016-damaged";
      const dir = recordsDir(repo, contractId);
      fs.mkdirSync(dir, { recursive: true });

      // 模拟中断：写入损坏的非 JSON summary 文件，且未写 manifest
      const summaryPath = path.join(dir, "delivery-summary.json");
      fs.writeFileSync(summaryPath, "INVALID_CORRUPTED_JSON_DATA", "utf8");

      const compRes = compensateContractRecordsArchive({
        repoRoot: repo,
        contract_id: contractId,
        commit_sha: "commit-repair-1111",
      });

      expect(compRes.ok).toBe(true);
      expect(compRes.repaired).toContain("delivery-summary.json");
      expect(compRes.copied).toContain("audit-manifest.json");

      // 验证修复后的 summary 为合法 JSON
      const repairedContent = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
      expect(repairedContent.contract_id).toBe(contractId);
      expect(repairedContent.commit_sha).toBe("commit-repair-1111");
      expect(repairedContent.compensated).toBe(true);

      // 验证 manifest 补齐成功
      expect(readAuditManifest(repo, contractId)).not.toBeNull();
    });

    it("部分文件已完整时，补偿自动跳过已完整文件（skipped）", () => {
      const contractId = "contract-p016-skip";
      const demo = buildMinimalPrototypeDemo("Skip测试");
      const written = writePrototype(repo, "proto-skip", demo);
      confirmDemoPrototype(repo, written.prototype_id, {
        demo_mode: "INTERACTIVE_DEMO",
      });

      // 第一次归档完整写入
      const first = compensateContractRecordsArchive({
        repoRoot: repo,
        contract_id: contractId,
        prototype_id: written.prototype_id,
        commit_sha: "commit-skip-2222",
      });
      expect(first.ok).toBe(true);

      // 删除 audit-manifest.json 模拟部分丢失
      const manifestPath = path.join(
        recordsDir(repo, contractId),
        "audit-manifest.json",
      );
      fs.unlinkSync(manifestPath);

      // 第二次补偿：已有文件应被跳过，缺失的 manifest 应被补齐
      const second = compensateContractRecordsArchive({
        repoRoot: repo,
        contract_id: contractId,
        prototype_id: written.prototype_id,
        commit_sha: "commit-skip-2222",
      });

      expect(second.ok).toBe(true);
      expect(second.skipped).toContain("demo-confirm.json");
      expect(second.skipped).toContain("delivery-summary.json");
      expect(second.copied).toContain("audit-manifest.json");
    });

    it("多次连续触发补偿具备严格幂等性，不产生脏数据或悬挂临时文件", () => {
      const contractId = "contract-p016-idempotent";
      const commitSha = "commit-idem-3333";

      // 连续调用 3 次
      const r1 = compensateContractRecordsArchive({
        repoRoot: repo,
        contract_id: contractId,
        commit_sha: commitSha,
      });
      expect(r1.ok).toBe(true);

      const r2 = compensateContractRecordsArchive({
        repoRoot: repo,
        contract_id: contractId,
        commit_sha: commitSha,
      });
      expect(r2.ok).toBe(true);
      expect(r2.copied).toEqual([]);
      expect(r2.repaired).toEqual([]);
      expect(r2.skipped).toContain("delivery-summary.json");
      expect(r2.skipped).toContain("audit-manifest.json");

      const r3 = compensateContractRecordsArchive({
        repoRoot: repo,
        contract_id: contractId,
        commit_sha: commitSha,
      });
      expect(r3.ok).toBe(true);
      expect(r3.copied).toEqual([]);
      expect(r3.repaired).toEqual([]);
      expect(r3.skipped).toContain("delivery-summary.json");
      expect(r3.skipped).toContain("audit-manifest.json");

      // 验证目录中没有遗留任何临时文件
      const dir = recordsDir(repo, contractId);
      const allFiles = fs.readdirSync(dir);
      const tmpFiles = allFiles.filter((f) => f.startsWith(".tmp-"));
      expect(tmpFiles).toHaveLength(0);
    });
  });

  describe("P016-P5: 专项交付报告落盘与诚实口径核对", () => {
    it("核验专项交付报告存在且包含诚实口径与排除说明", () => {
      const reportPath = path.resolve(
        __dirname,
        "../../docs/ledger/p0-16-records-archive-idempotent-compensation.md",
      );
      expect(fs.existsSync(reportPath)).toBe(true);
      const content = fs.readFileSync(reportPath, "utf8");

      expect(content).toContain("TASK-P0.16");
      expect(content).toContain("P016-P1");
      expect(content).toContain("P016-P2");
      expect(content).toContain("P016-P3");
      expect(content).toContain("P016-P4");
      expect(content).toContain("P016-P5");
      expect(content).toContain("P0 风险未宣称解除");
      expect(content).toContain("硬件级 Attestation 缺失");
      expect(content).toContain("Merger 不重跑全量测试");
      expect(content).toContain("容器内无 OS 级二次沙盒");
    });
  });
});
