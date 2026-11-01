/**
 * TASK-L.18：impactClosure 夹具 + interfaces 消费者解析。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { impactClosure } from "../../src/lib/knowledge/impact-closure";
import type { ModuleEntry } from "../../src/lib/knowledge/modules-schema";
import {
  loadModulesForRepo,
  parseInterfaceConsumersMarkdown,
} from "../../daemon/knowledge/modules-store";
import { safeRmSync } from "../helpers/tmp";

function mod(over: Partial<ModuleEntry> & Pick<ModuleEntry, "id">): ModuleEntry {
  return {
    name: over.name ?? over.id,
    purpose: over.purpose ?? `${over.id} purpose`,
    paths: over.paths ?? [`src/${over.id}/**`],
    depends_on: over.depends_on ?? [],
    interfaces: over.interfaces ?? [],
    introduced_by: over.introduced_by ?? "c-1",
    updated_by: over.updated_by ?? [],
    ...over,
  };
}

describe("TASK-L.18 impactClosure", () => {
  const auth = mod({
    id: "auth",
    name: "认证",
    paths: ["src/auth/**"],
    depends_on: ["db"],
  });
  const db = mod({
    id: "db",
    name: "数据库",
    paths: ["src/db/**"],
    depends_on: [],
  });
  const orders = mod({
    id: "orders",
    name: "订单",
    paths: ["src/orders/**"],
    depends_on: ["auth", "db"],
  });
  const billing = mod({
    id: "billing",
    name: "账单",
    paths: ["src/billing/**"],
    depends_on: ["orders"],
  });

  it("无模块时 empty_reason=no_modules", () => {
    const r = impactClosure({ modules: [], path: "src/x.ts" });
    expect(r.empty_reason).toBe("no_modules");
    expect(r.owners).toEqual([]);
    expect(r.affected).toEqual([]);
  });

  it("路径无归属时 empty_reason=no_owner", () => {
    const r = impactClosure({
      modules: [auth, db],
      path: "README.md",
    });
    expect(r.empty_reason).toBe("no_owner");
  });

  it("反向 depends_on 传递闭包：改 db 影响 auth、orders、billing", () => {
    const r = impactClosure({
      modules: [auth, db, orders, billing],
      path: "src/db/client.ts",
    });
    expect(r.empty_reason).toBe("ok");
    expect(r.owners.map((o) => o.id)).toEqual(["db"]);
    expect(r.affected.map((a) => a.id)).toEqual(["auth", "billing", "orders"]);
    expect(r.affected.find((a) => a.id === "auth")?.via).toContain("depends_on");
    expect(r.affected.find((a) => a.id === "billing")?.via).toContain(
      "depends_on",
    );
  });

  it("改叶子模块：无其它 depends_on 依赖者时 affected 可为空", () => {
    const r = impactClosure({
      modules: [auth, db, orders, billing],
      path: "src/billing/invoice.ts",
    });
    expect(r.owners.map((o) => o.id)).toEqual(["billing"]);
    expect(r.affected).toEqual([]);
  });

  it("interfaces 消费者并入闭包（不依赖 depends_on）", () => {
    const r = impactClosure({
      modules: [auth, db, orders, billing],
      path: "src/auth/session.ts",
      interfaceConsumers: { auth: ["billing"] },
    });
    // auth 的 depends_on 反向：orders（depends on auth）；billing 经由 interface
    expect(r.owners.map((o) => o.id)).toEqual(["auth"]);
    const ids = r.affected.map((a) => a.id);
    expect(ids).toContain("orders");
    expect(ids).toContain("billing");
    expect(r.affected.find((a) => a.id === "billing")?.via).toContain(
      "interface_consumer",
    );
  });

  it("edges 与 modules.yaml depends_on 同向", () => {
    const r = impactClosure({
      modules: [auth, db, orders],
      path: "src/auth/x.ts",
    });
    expect(r.edges).toEqual(
      expect.arrayContaining([
        { from: "auth", to: "db" },
        { from: "orders", to: "auth" },
        { from: "orders", to: "db" },
      ]),
    );
  });
});

describe("TASK-L.18 parseInterfaceConsumersMarkdown / loadModulesForRepo", () => {
  it("解析 consumers 行", () => {
    const md = `# auth\n\nconsumers: orders, billing\n消费者：db\n`;
    const got = parseInterfaceConsumersMarkdown(
      md,
      "auth",
      new Set(["auth", "orders", "billing", "db"]),
    );
    expect(got).toEqual(["billing", "db", "orders"]);
  });

  it("忽略未知 id 与自身", () => {
    const got = parseInterfaceConsumersMarkdown(
      "consumers: auth, ghost, orders",
      "auth",
      new Set(["auth", "orders"]),
    );
    expect(got).toEqual(["orders"]);
  });

  it("loadModulesForRepo 缺文件 → missing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l18-"));
    try {
      const loaded = loadModulesForRepo(root);
      expect(loaded.ok).toBe(false);
      if (!loaded.ok) expect(loaded.reason).toBe("missing");
    } finally {
      safeRmSync(root);
    }
  });

  it("loadModulesForRepo 读 yaml + interfaces", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l18-"));
    try {
      const sys = path.join(root, "docs", "system");
      fs.mkdirSync(path.join(sys, "interfaces"), { recursive: true });
      fs.writeFileSync(
        path.join(sys, "modules.yaml"),
        [
          'schema_version: "1.0.0"',
          "modules:",
          "  - id: auth",
          '    name: "认证"',
          '    purpose: "登录"',
          "    paths:",
          '      - "src/auth/**"',
          "    depends_on: [db]",
          "    interfaces: []",
          '    introduced_by: "c-1"',
          "    updated_by: []",
          "  - id: db",
          '    name: "库"',
          '    purpose: "持久化"',
          "    paths:",
          '      - "src/db/**"',
          "    depends_on: []",
          "    interfaces: []",
          '    introduced_by: "c-1"',
          "    updated_by: []",
          "  - id: orders",
          '    name: "订单"',
          '    purpose: "下单"',
          "    paths:",
          '      - "src/orders/**"',
          "    depends_on: [auth]",
          "    interfaces: []",
          '    introduced_by: "c-1"',
          "    updated_by: []",
          "",
        ].join("\n"),
      );
      fs.writeFileSync(
        path.join(sys, "interfaces", "auth.md"),
        "# auth\n\nconsumers: orders\n",
      );
      const loaded = loadModulesForRepo(root);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      expect(loaded.data.modules.map((m) => m.id).sort()).toEqual([
        "auth",
        "db",
        "orders",
      ]);
      expect(loaded.interfaceConsumers.auth).toEqual(["orders"]);
      const impact = impactClosure({
        modules: loaded.data.modules,
        path: "src/db/x.ts",
        interfaceConsumers: loaded.interfaceConsumers,
      });
      expect(impact.owners[0]?.id).toBe("db");
      expect(impact.affected.map((a) => a.id).sort()).toEqual([
        "auth",
        "orders",
      ]);
    } finally {
      safeRmSync(root);
    }
  });
});
