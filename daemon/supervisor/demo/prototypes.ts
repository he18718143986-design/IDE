/**
 * TASK-C.11b：Demo 落盘到 `.stagent/prototypes/<prototype_id>/`（Top7#1）。
 * 目录已在根 `.gitignore` 的 `.stagent/` 规则下忽略，不合入主干。
 */
import fs from "node:fs";
import path from "node:path";
import { DEMO_ENTRY, type GeneratedDemo } from "./types";
import { writeDemo, type WriteDemoResult } from "./demo-generator";

export const PROTOTYPES_ROOT = ".stagent/prototypes" as const;

/** TASK-H.9 / ADR-0011：Demo 确认态落 `.stagent/records/`，禁止写入已废止的 `.stagent/metadata/` */
export const DEMO_CONFIRM_STATE_FILE =
  ".stagent/records/demo-confirm.json" as const;

/** 历史路径：仅只读兼容；写入一律走 DEMO_CONFIRM_STATE_FILE */
export const LEGACY_DEMO_CONFIRM_STATE_FILE =
  ".stagent/metadata/demo-confirm.json" as const;

export type DemoMode =
  "INTERACTIVE_DEMO" | "NATIVE_FLOW_CARD" | "DEGRADED_FLOW_CARD";

export interface DemoConfirmRecord {
  prototype_id: string;
  confirmed: boolean;
  confirmed_at: string | null;
  relative_root: string;
  /** TASK-C.12d / EO-06：三态；缺省视为 INTERACTIVE_DEMO（兼容 C.11b 旧记录） */
  demo_mode?: DemoMode;
  /** 用户显式接受降级/流程卡（⚠️） */
  accept_degraded?: boolean;
}

export function prototypeRelativeRoot(prototypeId: string): string {
  const id = sanitizePrototypeId(prototypeId);
  return path.posix.join(PROTOTYPES_ROOT, id);
}

export function sanitizePrototypeId(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return cleaned.length > 0 ? cleaned : `proto-${Date.now()}`;
}

/** 写入 prototypes/<id>/，返回落盘结果 */
export function writePrototype(
  repoRoot: string,
  prototypeId: string,
  demo: GeneratedDemo,
): WriteDemoResult & { prototype_id: string; relative_root: string } {
  const id = sanitizePrototypeId(prototypeId);
  const relative_root = prototypeRelativeRoot(id);
  const result = writeDemo(repoRoot, demo, { rootDir: relative_root });
  // 初始确认态：未确认
  upsertDemoConfirm(repoRoot, {
    prototype_id: id,
    confirmed: false,
    confirmed_at: null,
    relative_root,
  });
  return { ...result, prototype_id: id, relative_root };
}

function parseDemoConfirmFile(abs: string): DemoConfirmRecord[] | null {
  if (!fs.existsSync(abs)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(abs, "utf8")) as {
      records?: DemoConfirmRecord[];
    };
    return Array.isArray(raw.records) ? raw.records : [];
  } catch {
    return null;
  }
}

/**
 * 读确认态：优先新路径；若仅有历史 `.stagent/metadata/` 文件则只读迁移到 records（不回写旧路径）。
 * 副作用：新路径不存在而旧路径存在时，**首次读取会迁移落盘**到 DEMO_CONFIRM_STATE_FILE（一次性写 records）。
 */
export function readDemoConfirm(
  repoRoot: string,
  prototypeId?: string,
): DemoConfirmRecord | null {
  const absNew = path.join(repoRoot, DEMO_CONFIRM_STATE_FILE);
  const absLegacy = path.join(repoRoot, LEGACY_DEMO_CONFIRM_STATE_FILE);
  let records = parseDemoConfirmFile(absNew);
  if (records === null) {
    const legacy = parseDemoConfirmFile(absLegacy);
    if (legacy !== null) {
      // 一次性只读迁移：写到 records，之后写入只走新路径
      fs.mkdirSync(path.dirname(absNew), { recursive: true });
      fs.writeFileSync(
        absNew,
        JSON.stringify(
          { records: legacy, migrated_from: LEGACY_DEMO_CONFIRM_STATE_FILE, updated_at: new Date().toISOString() },
          null,
          2,
        ),
        "utf8",
      );
      records = legacy;
    }
  }
  if (records === null) return null;
  if (prototypeId) {
    const id = sanitizePrototypeId(prototypeId);
    return records.find((r) => r.prototype_id === id) ?? null;
  }
  // 最近一条
  return records.length > 0 ? records[records.length - 1]! : null;
}

export function upsertDemoConfirm(
  repoRoot: string,
  record: DemoConfirmRecord,
): void {
  const abs = path.join(repoRoot, DEMO_CONFIRM_STATE_FILE);
  // 禁止写入 LEGACY_DEMO_CONFIRM_STATE_FILE（ADR-0011 / TASK-H.9）
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const parsedNew = parseDemoConfirmFile(abs);
  let records: DemoConfirmRecord[] = parsedNew ?? [];
  // 仅当新文件不存在时合并 legacy，避免「有意清空的 records」被旧确认态复活
  if (parsedNew === null) {
    const legacy = parseDemoConfirmFile(
      path.join(repoRoot, LEGACY_DEMO_CONFIRM_STATE_FILE),
    );
    if (legacy !== null) records = legacy;
  }
  const idx = records.findIndex((r) => r.prototype_id === record.prototype_id);
  if (idx >= 0) records[idx] = record;
  else records.push(record);
  fs.writeFileSync(
    abs,
    JSON.stringify({ records, updated_at: new Date().toISOString() }, null, 2),
    "utf8",
  );
}

export function confirmDemoPrototype(
  repoRoot: string,
  prototypeId: string,
  options: {
    now?: () => Date;
    demo_mode?: DemoMode;
    accept_degraded?: boolean;
  } = {},
): DemoConfirmRecord {
  const now = options.now ?? (() => new Date());
  const id = sanitizePrototypeId(prototypeId);
  const existing = readDemoConfirm(repoRoot, id);
  const relative_root = existing?.relative_root ?? prototypeRelativeRoot(id);
  const record: DemoConfirmRecord = {
    prototype_id: id,
    confirmed: true,
    confirmed_at: now().toISOString(),
    relative_root,
    demo_mode: options.demo_mode ?? existing?.demo_mode ?? "INTERACTIVE_DEMO",
    ...(options.accept_degraded === true || existing?.accept_degraded === true
      ? { accept_degraded: true }
      : {}),
  };
  upsertDemoConfirm(repoRoot, record);
  return record;
}

/** 签署前写真码门禁：未确认 Demo 则拒绝（Fast Path skip_demo 由调用方另判） */
export function assertDemoConfirmedForWrite(
  repoRoot: string,
  prototypeId: string | undefined,
  options: { skip_demo?: boolean } = {},
): void {
  if (options.skip_demo === true) return;
  if (!prototypeId) {
    const err = new Error(
      "未确认 Demo：缺少 prototype_id，禁止写入项目主干",
    ) as Error & { code: string };
    err.code = "E_DEMO_NOT_CONFIRMED";
    throw err;
  }
  const rec = readDemoConfirm(repoRoot, prototypeId);
  if (!rec?.confirmed) {
    const err = new Error("未确认 Demo：请先感官对齐后再写真码") as Error & {
      code: string;
    };
    err.code = "E_DEMO_NOT_CONFIRMED";
    throw err;
  }
}

export function buildMinimalPrototypeDemo(title: string): GeneratedDemo {
  const safeTitle = title.trim() || "隔离 Demo";
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(safeTitle)}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <main>
    <h1>${escapeHtml(safeTitle)}</h1>
    <p data-testid="prototype-demo-banner">这是隔离 Demo（假数据），不会改你的正式源码。</p>
    <form id="demo-form">
      <label>试用输入 <input name="sample" type="text" placeholder="点这里试试" /></label>
      <button type="submit">模拟提交</button>
    </form>
    <pre id="result" hidden></pre>
  </main>
  <script src="app.js"></script>
</body>
</html>
`;
  const css = `body{font:14px/1.5 system-ui,sans-serif;margin:24px;background:#fafafa;color:#111}
main{max-width:480px}h1{font-size:20px}input,button{font:inherit;margin-top:8px}
button{padding:8px 14px;border:0;border-radius:6px;background:#0a84ff;color:#fff;cursor:pointer}
pre{margin-top:12px;padding:12px;background:#f2f2f7;border-radius:6px;font-size:12px}`;
  const js = `(function(){var f=document.getElementById("demo-form");var r=document.getElementById("result");if(!f||!r)return;f.addEventListener("submit",function(e){e.preventDefault();var el=f.elements.namedItem("sample");r.hidden=false;r.textContent="已模拟提交（未发网络）：\n"+JSON.stringify({sample:el&&"value"in el?el.value:""},null,2);});})();`;
  const meta = JSON.stringify(
    { title: safeTitle, kind: "c11b-prototype" },
    null,
    2,
  );
  const assets = [
    { path: DEMO_ENTRY, content: html },
    { path: "styles.css", content: css },
    { path: "app.js", content: js },
    { path: "meta.json", content: meta },
  ] as const;
  const totalBytes = assets.reduce(
    (sum, a) => sum + Buffer.byteLength(a.content, "utf8"),
    0,
  );
  return { entry: DEMO_ENTRY, assets: [...assets], totalBytes };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** TASK-C.12d：基于确认记录评估 can_sign（委托 EO-06 硬谓词） */
export function evaluateCanSign(
  repoRoot: string,
  prototypeId: string,
): { ok: true; demo_mode: DemoMode } | { ok: false; reason: string } {
  const rec = readDemoConfirm(repoRoot, prototypeId);
  if (!rec) {
    return { ok: false, reason: "无 Demo 确认记录" };
  }
  const demo_mode: DemoMode = rec.demo_mode ?? "INTERACTIVE_DEMO";
  // 延迟导入避免循环；本文件是 daemon 侧，可直接内联谓词
  if (!rec.confirmed) {
    return { ok: false, reason: "Demo 尚未确认，禁止签署" };
  }
  if (demo_mode === "INTERACTIVE_DEMO") {
    return { ok: true, demo_mode };
  }
  if (rec.accept_degraded === true) {
    return { ok: true, demo_mode };
  }
  return {
    ok: false,
    reason:
      "流程卡/降级卡不得冒充可交互 Demo 偷渡签署；须显式接受降级（accept_degraded）",
  };
}
