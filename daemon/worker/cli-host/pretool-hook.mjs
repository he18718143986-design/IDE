#!/usr/bin/env node
/**
 * TASK-W.5a Claude Code PreToolUse hook（由 Claude Code 自己调用，不由 Stagent spawn）。
 * 只有 exit 2 或 JSON permissionDecision:"deny" 才会拦截；所以任何异常都按「拒绝」处理。
 * 规则（W.4 的 4 类绕过的 hook 层兜底）：
 *  1. 写类工具的目标路径必须在 STAGENT_HOOK_ROOT 内；
 *  2. Shell（Bash）默认拒绝，除非 STAGENT_HOOK_ALLOW_BASH=1；即便允许，
 *     也另有两道门禁：核心元数据路径（.stagent/.git/.claude/.cursor/.env）一律拒绝，
 *     命令中经 `..` 或绝对路径指向工作目录之外的重定向/写目标一律拒绝；
 *  3. 不得触碰 .git / .stagent / .claude / .mcp.json，也不得经 ../ 访问主工作树；
 *  4. 不在白名单内的工具（含未知 MCP 工具）一律拒绝。
 *
 * TASK-J.1（P0 安全）：`STAGENT_HOOK_ROLE=partner`（方案工作台右栏搭档）时，
 * 只放行读类工具 Read/Glob/Grep（列目录经 Glob 模式完成；LS 不由 CLI 2.1.296 提供）；其余一律拒绝（含 Edit/Write/MultiEdit/
 * NotebookEdit/Bash/TodoWrite 与任何未知工具）。CLI 侧 --tools 已是精确白名单，
 * 这里是第二重保险：hook 先于工具执行，命中即 block。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const READ_TOOLS = new Set(["Read", "Glob", "Grep", "TodoWrite", "Task"]);
const PROTECTED_SEGMENTS = [".git", ".stagent", ".claude"];

/** partner 角色只允许这三件事：读文件、按名或按模式找文件（含列目录）、按内容搜 */
const PARTNER_ALLOWED_TOOLS = new Set(["Read", "Glob", "Grep"]);

/**
 * Shell 通道的保留区（G-3 加固，2026-10-21）：
 * 允许 Bash 之后，`rm -rf .stagent` 这类命令绕过了 Write/Edit 的路径判定，
 * 因此对命令词元按「路径段」精确匹配，命中即拒绝。
 * 按段匹配（而不是子串）是为了不误伤 `.gitignore` / `.github` / `.envrc`。
 */
const RESERVED_SHELL_SEGMENTS = [".stagent", ".git", ".claude", ".cursor"];
/** `> /dev/null` 这类常规写法必须放行，否则大量正常命令被误伤 */
const SAFE_DEVICE_TARGETS = new Set([
  "/dev/null",
  "/dev/stdout",
  "/dev/stderr",
  "/dev/fd/1",
  "/dev/fd/2",
]);

/** 命令里是否出现保留区的路径段；返回命中的段名（null = 未命中） */
function reservedMetadataHit(command) {
  // 按 shell 的分隔符与 `=` 粗切（`--git-dir=.git` 也会被切成独立段）
  const tokens = String(command)
    .split(/[\s;|&()<>"'`=,]+/)
    .filter(Boolean);
  for (const token of tokens) {
    for (const seg of token.replace(/\\/g, "/").split("/")) {
      if (!seg) continue;
      if (RESERVED_SHELL_SEGMENTS.includes(seg)) return seg;
      // .env / .env.local / .env.production：密钥类文件一律不许经 Shell 读写
      if (seg === ".env" || seg.startsWith(".env.")) return seg;
    }
  }
  return null;
}

/** 取真实路径：已存在取自身，不存在取父目录，防 symlink 逃逸 */
function realish(p) {
  try {
    if (fs.existsSync(p)) return fs.realpathSync(p);
    return path.join(fs.realpathSync(path.dirname(p)), path.basename(p));
  } catch {
    return p;
  }
}

/** 单个词元是否指向工作目录之外；返回拒绝原因或 null */
function escapeReasonOf(root, raw) {
  let t = String(raw).trim();
  if (!t) return null;
  // 去掉 `--opt=value` / `--opt:value` 的选项前缀，只看取值部分
  const sep = t.search(/[=:]/);
  if (t.startsWith("-") && sep > 0) t = t.slice(sep + 1);
  if (!t || SAFE_DEVICE_TARGETS.has(t)) return null;
  const looksPath = t.includes("/") || t.startsWith(".") || t.startsWith("~");
  if (!looksPath) return null;
  // $VAR / ~ 展开后指向哪里无法静态判定 —— 保守拒绝（失败关闭）
  if (t.startsWith("$") || t.startsWith("~")) {
    return `Shell 命令路径越界（含不可静态判定的变量展开）：${raw}`;
  }
  // 通配符只校验字面前缀（`tests/**/*.test.ts` 这类正常用法必须放行）
  if (/[*?[]/.test(t)) {
    const prefix = t.split(/[*?[]/)[0].replace(/\/?[^/]*$/, "");
    return inside(root, realish(path.resolve(root, prefix || ".")))
      ? null
      : `Shell 命令路径越界（通配符前缀指向工作目录之外）：${raw}`;
  }
  const abs = t.startsWith("/") ? t : path.resolve(root, t);
  return inside(root, realish(abs))
    ? null
    : `Shell 命令路径越界（目录穿越或指向工作目录之外）：${raw}`;
}

/**
 * Shell 越界判定：重定向目标（`>` / `>>`）+ 全部词元。
 * 只做静态文本判定，宁可多拒也不放过（失败关闭）。
 */
function shellEscapeVerdict(root, command) {
  const text = String(command);
  const candidates = [];
  const redirectRe =
    /(?:^|[^>])>{1,2}\s*(?:"([^"]*)"|'([^']*)'|([^\s;|&<>]+))/g;
  let m;
  while ((m = redirectRe.exec(text)) !== null) {
    candidates.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  for (const token of text.split(/[\s;|&()"'`]+/)) {
    if (token) candidates.push(token);
  }
  for (const candidate of candidates) {
    const verdict = escapeReasonOf(root, candidate);
    if (verdict) return verdict;
  }
  return null;
}

/**
 * TASK-P.1 保护清单（.stagent/protection.json）由 daemon/API 维护，hook 只读。
 * - 命中且本轮已授权（protection-state.json 的 approvedFiles）→ 放行；
 * - 命中且未授权 → 投递拦截请求到 .stagent/protection-requests/ 并拒绝；
 * - 清单读不出来（损坏）→ 按拒绝处理（失败关闭）。
 * 这里只做与 daemon 同口径的最小 glob 匹配（精确 / dir/** 前缀 / *.后缀）。
 */
function mainRepoRootOf(root) {
  const marker = `${path.sep}.stagent${path.sep}worktrees${path.sep}`;
  const idx = root.indexOf(marker);
  return idx > 0 ? root.slice(0, idx) : root;
}

function normalizeRel(p) {
  return String(p)
    .replace(/\\/g, "/")
    .replace(/^(\.\/|\/)+/, "");
}

function matchPattern(rel, pattern) {
  const p = normalizeRel(pattern).replace(/\/+$/, "");
  if (!p) return false;
  if (rel === p) return true;
  if (p.endsWith("/**")) return rel.startsWith(p.slice(0, -2));
  if (p.startsWith("*.")) return rel.endsWith(p.slice(1));
  // 目录模式（无通配）按前缀处理，如 "src/auth"
  if (!p.includes("*")) return rel === p || rel.startsWith(`${p}/`);
  return false;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}


/** TASK-J.18d / GAP-W4：gate pack 相对主仓路径 */
const GATE_PACK_REL = path.join(".stagent", "claude-config", "graveyard-pack.json");

/**
 * 加载 gate pack 的小写 key 集合。
 * @returns {{ ok: true, keys: Set<string>, byKey: Map<string, string> } | { ok: false, warning: "W_GATE_PACK_MISSING" }}
 */
export function loadGatePackKeys(mainRoot) {
  const file = path.join(mainRoot, GATE_PACK_REL);
  if (!fs.existsSync(file)) {
    return { ok: false, warning: "W_GATE_PACK_MISSING" };
  }
  let pack;
  try {
    pack = readJson(file);
  } catch {
    return { ok: false, warning: "W_GATE_PACK_MISSING" };
  }
  if (
    !pack ||
    pack.pack_version !== 1 ||
    !Array.isArray(pack.tombstones)
  ) {
    return { ok: false, warning: "W_GATE_PACK_MISSING" };
  }
  const keys = new Set();
  /** @type {Map<string, string>} */
  const byKey = new Map();
  for (const t of pack.tombstones) {
    if (!t || !Array.isArray(t.keys)) continue;
    const id = String(t.rejected_id ?? "");
    for (const k of t.keys) {
      const low = String(k).toLowerCase();
      keys.add(low);
      if (id && !byKey.has(low)) byKey.set(low, id);
    }
  }
  return { ok: true, keys, byKey };
}

/** 从 Bash 安装命令抽包名（U-CMD 写前近似） */
export function extractInstallPackages(command) {
  const text = String(command);
  const out = [];
  const patterns = [
    /\b(?:npm|pnpm)\s+(?:i|install|add)\s+([^\n;&|]+)/i,
    /\byarn\s+add\s+([^\n;&|]+)/i,
    /\bpip(?:3)?\s+install\s+([^\n;&|]+)/i,
    /\bggo\s+get\s+([^\n;&|]+)/i,
    /\bgo\s+get\s+([^\n;&|]+)/i,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (!m) continue;
    for (const tok of m[1].split(/\s+/)) {
      if (!tok || tok.startsWith("-")) continue;
      // npm alias: mongoose@npm:foo → take left; strip version
      let name = tok.split("@")[0];
      if (tok.includes("@npm:")) {
        const right = tok.split("@npm:")[1] ?? "";
        name = right.split("@")[0] || name;
      }
      // scoped keep @scope/name when tok starts with @
      if (tok.startsWith("@")) {
        const parts = tok.split("@").filter(Boolean);
        // @scope/name@version → parts[0]=scope/name, parts[1]=version?
        // Actually "@scope/pkg@1".split("@") => ["", "scope/pkg", "1"]
        const scoped = tok.match(/^(@[^/]+\/[^@\s]+)/);
        name = scoped ? scoped[1] : name;
      }
      if (name) out.push(name.toLowerCase());
    }
  }
  return out;
}

const IMPORT_RES = [
  /\bfrom\s+["']([^"']+)["']/,
  /\bimport\s+["']([^"']+)["']/,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/,
  /^import\s+(\S+)/m,
  /^from\s+(\S+)\s+import\b/m,
];

function moduleName(spec) {
  const s = String(spec);
  if (s.startsWith(".") || s.startsWith("/")) return s.toLowerCase();
  if (s.startsWith("@")) {
    const parts = s.split("/");
    return (parts.length >= 2 ? `${parts[0]}/${parts[1]}` : s).toLowerCase();
  }
  return s.split("/")[0].toLowerCase();
}

/** 从 Write/Edit 正文抽 U-DEP / U-IMPORT 候选（集合查找） */
export function extractContentKeys(filePath, content) {
  const text = String(content ?? "");
  const base = String(filePath).replace(/\\/g, "/").split("/").pop() ?? "";
  const keys = [];
  if (base === "package.json") {
    try {
      const obj = JSON.parse(text);
      for (const field of [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
        "peerDependencies",
      ]) {
        const block = obj?.[field];
        if (!block || typeof block !== "object") continue;
        for (const [name, spec] of Object.entries(block)) {
          let real = String(name).toLowerCase();
          const s = String(spec ?? "");
          if (s.startsWith("npm:")) {
            real = s.slice(4).split("@")[0].toLowerCase() || real;
          }
          keys.push(real);
        }
      }
    } catch {
      // JSON 坏了：退回全文词扫描不在此做，避免误伤
    }
    return keys;
  }
  if (/^requirements.*\.txt$/i.test(base)) {
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const m = /^([A-Za-z0-9_.-]+)\s*(?:[=<>!~].*)?$/.exec(t);
      if (m) keys.push(m[1].toLowerCase());
    }
    return keys;
  }
  for (const line of text.split(/\r?\n/)) {
    for (const re of IMPORT_RES) {
      const m = re.exec(line);
      if (m?.[1]) keys.push(moduleName(m[1]));
    }
  }
  return keys;
}

/**
 * @returns {{ hit: false } | { hit: true, rejected_id: string, key: string }}
 */
export function evaluateGatePackHit(packKeys, candidates) {
  if (!packKeys || !packKeys.ok) return { hit: false };
  for (const c of candidates) {
    const low = String(c).toLowerCase();
    if (packKeys.keys.has(low)) {
      return {
        hit: true,
        rejected_id: packKeys.byKey.get(low) ?? "unknown",
        key: low,
      };
    }
  }
  return { hit: false };
}

/** 返回 {hit, name, selfLock}；任何读取异常都抛错，由调用方按拒绝处理 */
function matchProtection(mainRoot, rel) {
  if (rel === ".stagent/protection.json") {
    return { hit: true, name: "保护清单本身", selfLock: true };
  }
  const file = path.join(mainRoot, ".stagent", "protection.json");
  if (!fs.existsSync(file)) return { hit: false };
  const list = readJson(file);
  if (!list || list.version !== 1 || !Array.isArray(list.entries)) {
    throw new Error("保护清单结构不合法");
  }
  for (const entry of list.entries) {
    for (const pattern of entry.patterns ?? []) {
      if (matchPattern(rel, pattern)) {
        return { hit: true, name: entry.name, pattern };
      }
    }
  }
  return { hit: false };
}

function readApprovals(mainRoot, rel) {
  const file = path.join(mainRoot, ".stagent", "protection-state.json");
  try {
    if (!fs.existsSync(file)) return { approved: false, denied: false };
    const state = readJson(file);
    const approved = Array.isArray(state.approvedFiles)
      ? state.approvedFiles.includes(rel)
      : false;
    const denied = Array.isArray(state.deniedFiles)
      ? state.deniedFiles.includes(rel)
      : false;
    return { approved, denied };
  } catch {
    // 状态读不出来：没有授权记录 = 不放行（失败关闭）
    return { approved: false, denied: false };
  }
}

/** 投递拦截请求给 daemon（文件队列；失败不影响拒绝结论） */
function enqueueRequest(mainRoot, rel, name) {
  try {
    const dir = path.join(mainRoot, ".stagent", "protection-requests");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(
      dir,
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
    );
    fs.writeFileSync(
      file,
      JSON.stringify({
        at: new Date().toISOString(),
        files: [rel],
        entryNames: [name],
      }),
    );
  } catch {
    // 请求投递失败也要继续拒绝
  }
}

/** 保护清单命中判定：返回 null 表示放行，返回字符串表示拒绝原因 */
function protectionVerdict(mainRoot, rel) {
  let match;
  try {
    match = matchProtection(mainRoot, rel);
  } catch (err) {
    return `保护门卫不可用，按拒绝处理：${err && err.message}`;
  }
  if (!match.hit) return null;
  if (match.selfLock) return "保护清单本身被锁定，只能在 Stagent 界面里修改";
  const { approved, denied } = readApprovals(mainRoot, rel);
  if (approved) return null;
  if (denied) return `「${match.name}」本轮已被你拒绝，请换方案`;
  enqueueRequest(mainRoot, rel, match.name);
  return `AI 想修改被保护的「${match.name}」（${rel}），已在 Stagent 弹出确认卡`;
}

/** 允许 Bash 时：命令文本里出现受保护路径字面量就拒绝（保守兜底） */
function shellProtectionVerdict(mainRoot, command) {
  try {
    const file = path.join(mainRoot, ".stagent", "protection.json");
    if (!fs.existsSync(file)) return null;
    const list = readJson(file);
    for (const entry of list.entries ?? []) {
      for (const pattern of entry.patterns ?? []) {
        const base = normalizeRel(pattern).replace(/\/\*\*$/, "");
        if (base && command.includes(base)) {
          enqueueRequest(mainRoot, base, entry.name);
          return `命令触碰受保护路径「${entry.name}」（${base}），已在 Stagent 弹出确认卡`;
        }
      }
    }
    return null;
  } catch (err) {
    return `保护门卫不可用，按拒绝处理：${err && err.message}`;
  }
}

function deny(reason) {
  const out = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
  process.stdout.write(JSON.stringify(out));
  process.stderr.write(`Stagent 拦截：${reason}\n`);
  log({ decision: "deny", reason });
  process.exit(2);
}

let input = {};
function log(entry) {
  const file = process.env.STAGENT_HOOK_LOG;
  if (!file) return;
  try {
    fs.appendFileSync(
      file,
      JSON.stringify({
        at: new Date().toISOString(),
        tool: input.tool_name,
        ...entry,
      }) + "\n",
    );
  } catch {
    // 日志失败不影响判定
  }
}

function inside(root, p) {
  const rel = path.relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}


/** 仅作为 CLI 入口执行主流程；被 import 时不跑 stdin 判定（TM-GH-06）。 */
function isInvokedAsCli() {
  try {
    const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
    return entry === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isInvokedAsCli()) {
try {
  const raw = fs.readFileSync(0, "utf8");
  input = JSON.parse(raw || "{}");
  const root = process.env.STAGENT_HOOK_ROOT;
  if (!root) deny("未配置 STAGENT_HOOK_ROOT");
  const realRoot = fs.realpathSync(root);
  const mainRoot = mainRepoRootOf(realRoot);
  const tool = String(input.tool_name ?? "");
  const ti = input.tool_input ?? {};

  // TASK-J.1：右栏搭档只读。放在所有分支之前，写类 / Shell / Todo / 未知工具一律 block；
  // 即便 CLI 参数层被绕过（老版本、配置丢失），这里仍然拦得住。
  if (
    process.env.STAGENT_HOOK_ROLE === "partner" &&
    !PARTNER_ALLOWED_TOOLS.has(tool)
  ) {
    deny(
      `方案工作台右栏是只读搭档：只能读文件、搜代码、按模式列目录（Glob），已拦截 ${tool || "(未知工具)"} 调用`,
    );
  }

  if (tool === "Bash") {
    if (process.env.STAGENT_HOOK_ALLOW_BASH !== "1")
      deny("未授权的 Shell 命令");
    const command = String(ti.command ?? "");
    // 加固 1：核心元数据（.stagent/.git/.claude/.cursor/.env）一律不许经 Shell 触碰
    const reserved = reservedMetadataHit(command);
    if (reserved)
      deny(`禁止通过 Shell 访问或修改系统保护元数据（${reserved}）`);
    // 加固 2：目录穿越（../）与指向工作目录之外的绝对路径一律拒绝
    const escape = shellEscapeVerdict(realRoot, command);
    if (escape) deny(escape);
    // 既有：保护清单命中且未获本轮授权 → 投递确认卡并拒绝
    const bashVerdict = shellProtectionVerdict(mainRoot, command);
    if (bashVerdict) deny(bashVerdict);
    // TASK-J.18d / GAP-W4：gate pack 集合查找（U-CMD）
    {
      const pack = loadGatePackKeys(mainRoot);
      if (!pack.ok) {
        log({ decision: "allow", warning: pack.warning });
      } else {
        const pkgs = extractInstallPackages(command);
        const hit = evaluateGatePackHit(pack, pkgs);
        if (hit.hit) {
          log({
            decision: "deny",
            code: "E_PROPOSAL_PREVIOUSLY_REJECTED",
            rejected_id: hit.rejected_id,
            key: hit.key,
          });
          deny(
            `命令安装了用户否决过的依赖「${hit.key}」（E_PROPOSAL_PREVIOUSLY_REJECTED）`,
          );
        }
      }
    }
    log({ decision: "allow" });
    process.exit(0);
  }

  const target = ti.file_path ?? ti.notebook_path ?? ti.path;
  if (WRITE_TOOLS.has(tool) || (READ_TOOLS.has(tool) && target)) {
    if (WRITE_TOOLS.has(tool) && !target) deny("写入缺少目标路径");
    if (target) {
      const abs = path.resolve(realRoot, String(target));
      let real = abs;
      try {
        // 已存在的路径按真实路径判定（防 symlink 逃逸）；不存在则判其父目录
        real = fs.existsSync(abs)
          ? fs.realpathSync(abs)
          : path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs));
      } catch {
        real = abs;
      }
      if (!inside(realRoot, real)) deny(`路径在工作目录之外：${target}`);
      const rel = path.relative(realRoot, real).split(path.sep);
      // 读写都不许碰 Claude Code 专用配置目录（会话记录）和 Daemon 会话令牌
      if (
        rel[0] === ".stagent" &&
        (rel[1] === "claude-config" || rel[1] === "session-token")
      ) {
        deny(`受保护路径：${target}`);
      }
      if (WRITE_TOOLS.has(tool)) {
        if (
          rel.some((seg) => PROTECTED_SEGMENTS.includes(seg)) ||
          rel.at(-1) === ".mcp.json"
        ) {
          deny(`受保护路径：${target}`);
        }
        // P.1 保护清单：命中且未获本轮授权 → 投递卡片请求并拒绝（先拦后写）
        const verdict = protectionVerdict(mainRoot, rel.join("/"));
        if (verdict) deny(verdict);
        // TASK-J.18d / GAP-W4：gate pack 集合查找（U-DEP / U-IMPORT）
        {
          const pack = loadGatePackKeys(mainRoot);
          if (!pack.ok) {
            log({ decision: "allow", warning: pack.warning });
          } else {
            const body =
              tool === "Edit" || tool === "MultiEdit"
                ? String(ti.new_string ?? ti.content ?? "")
                : String(ti.content ?? "");
            const keys = extractContentKeys(rel.join("/"), body);
            const hit = evaluateGatePackHit(pack, keys);
            if (hit.hit) {
              log({
                decision: "deny",
                code: "E_PROPOSAL_PREVIOUSLY_REJECTED",
                rejected_id: hit.rejected_id,
                key: hit.key,
              });
              deny(
                `写入内容触及用户否决过的方案（依赖/导入「${hit.key}」，E_PROPOSAL_PREVIOUSLY_REJECTED）`,
              );
            }
          }
        }
      }
    }
    log({ decision: "allow" });
    process.exit(0);
  }

  if (READ_TOOLS.has(tool)) {
    log({ decision: "allow" });
    process.exit(0);
  }
  deny(`未在白名单内的工具：${tool}`);
} catch (err) {
  deny(`hook 内部错误，按拒绝处理：${err && err.message}`);
}
}
