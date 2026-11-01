/**
 * TASK-L.18：`impactClosure` —— 「改这里会影响什么」的确定性闭包。
 * 权威来源：modules.yaml 的 depends_on 反向可达 + interfaces/ 消费者列表。
 * 图由代码算，不由模型画。
 */

import {
  coversPath,
  type ModuleEntry,
} from "./modules-schema";

export type ImpactVia = "depends_on" | "interface_consumer";

export interface ImpactedModule {
  id: string;
  name: string;
  purpose: string;
  via: ImpactVia[];
}

export interface ImpactOwner {
  id: string;
  name: string;
  purpose: string;
}

export interface ImpactClosureResult {
  path: string;
  owners: ImpactOwner[];
  /** 不含 owners 自身；按 id 稳定排序 */
  affected: ImpactedModule[];
  /** 依赖边：from 依赖 to（与 modules.yaml depends_on 同向） */
  edges: Array<{ from: string; to: string }>;
  empty_reason: "ok" | "no_owner" | "no_modules";
}

export interface ImpactClosureArgs {
  modules: readonly ModuleEntry[];
  path: string;
  /**
   * 模块 id → 消费其 interfaces/ 的其它模块 id。
   * 由 daemon 读 `docs/system/interfaces/<id>.md` 解析；纯函数侧只消费结果。
   */
  interfaceConsumers?: Readonly<Record<string, readonly string[]>>;
}

/**
 * 对给定路径求影响闭包。
 * - owners：paths 覆盖该文件的模块
 * - affected：反向 depends_on 传递闭包 ∪ owners 的 interface 消费者（去掉 owners）
 */
export function impactClosure(args: ImpactClosureArgs): ImpactClosureResult {
  const { modules, path } = args;
  const interfaceConsumers = args.interfaceConsumers ?? {};
  const edges: Array<{ from: string; to: string }> = [];
  for (const m of modules) {
    for (const dep of m.depends_on) {
      edges.push({ from: m.id, to: dep });
    }
  }

  if (modules.length === 0) {
    return {
      path,
      owners: [],
      affected: [],
      edges,
      empty_reason: "no_modules",
    };
  }

  const byId = new Map(modules.map((m) => [m.id, m]));
  const owners = modules.filter((m) => coversPath([m], path));
  if (owners.length === 0) {
    return {
      path,
      owners: [],
      affected: [],
      edges,
      empty_reason: "no_owner",
    };
  }

  // reverse depends_on：B ← A 当 A.depends_on 含 B
  const reverse = new Map<string, string[]>();
  for (const m of modules) {
    for (const dep of m.depends_on) {
      if (!byId.has(dep)) continue;
      const list = reverse.get(dep) ?? [];
      list.push(m.id);
      reverse.set(dep, list);
    }
  }

  const ownerIds = new Set(owners.map((o) => o.id));
  const viaMap = new Map<string, Set<ImpactVia>>();

  const mark = (id: string, via: ImpactVia): void => {
    if (ownerIds.has(id) || !byId.has(id)) return;
    const set = viaMap.get(id) ?? new Set<ImpactVia>();
    set.add(via);
    viaMap.set(id, set);
  };

  // 反向 depends_on BFS
  const queue = [...ownerIds];
  const seenRev = new Set<string>(ownerIds);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const dep of reverse.get(cur) ?? []) {
      mark(dep, "depends_on");
      if (!seenRev.has(dep)) {
        seenRev.add(dep);
        queue.push(dep);
      }
    }
  }

  // interfaces/ 消费者（含 owners 直接消费者；不沿消费者再扩 depends_on，规格只要求闭包+消费者列表）
  for (const oid of ownerIds) {
    for (const cid of interfaceConsumers[oid] ?? []) {
      mark(cid, "interface_consumer");
    }
  }

  const affected: ImpactedModule[] = [...viaMap.entries()]
    .map(([id, vias]) => {
      const m = byId.get(id)!;
      const via = [...vias].sort() as ImpactVia[];
      return {
        id: m.id,
        name: m.name,
        purpose: m.purpose,
        via,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    path,
    owners: owners.map((o) => ({
      id: o.id,
      name: o.name,
      purpose: o.purpose,
    })),
    affected,
    edges,
    empty_reason: "ok",
  };
}
