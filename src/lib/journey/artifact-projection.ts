/**
 * 产出物 → GateUnit 投影（TASK-J.18a / worker-graveyard-gate.md §2.2～§2.3）。
 * 纯函数：零 node:*、零时钟、零网络。不做匹配判定。
 */

export type GateUnitKind =
  "U-DEP" | "U-CMD" | "U-IMPORT" | "U-PATH" | "U-IDENT" | "U-NL";

export interface GateUnit {
  kind: GateUnitKind;
  /** 包名 / 模块说明符 / 路径 / 新增行 / 文字 */
  text: string;
  /** 仓库相对路径 */
  file?: string;
  /** after 文件中的行号（展示用，不参与判定） */
  line_hint?: number;
  source: "change" | "command" | "log" | "summary" | "commit_message";
}

export interface ArtifactChange {
  path: string;
  /** null = 不存在（新文件 / 删除） */
  before: string | null;
  after: string | null;
}

/** 换行统一 + 去行尾空白；不做大小写与 NFKC（代码区分大小写） */
function normalizeLine(line: string): string {
  return line
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+$/g, "");
}

function splitLines(content: string | null): string[] {
  if (content === null || content === "") return [];
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // 保留末尾空行语义：split 后若原文以 \n 结尾会多一个 ""；多重集差需要稳定
  const parts = normalized.split("\n").map(normalizeLine);
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/**
 * 行多重集差：after 中出现次数超过 before 的那部分（§2.3）。
 */
export function addedLines(
  before: string | null,
  after: string | null,
): string[] {
  const b = splitLines(before);
  const a = splitLines(after);
  const count = new Map<string, number>();
  for (const line of b) count.set(line, (count.get(line) ?? 0) + 1);
  const out: string[] = [];
  for (const line of a) {
    const n = count.get(line) ?? 0;
    if (n > 0) count.set(line, n - 1);
    else out.push(line);
  }
  return out;
}

const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

/** 解析 npm: 别名与常规版本串 → 真实包名 */
export function resolveNpmPackageName(
  name: string,
  versionSpec: string,
): string {
  const v = versionSpec.trim();
  const m = /^npm:(@?[^@]+)(?:@.+)?$/.exec(v);
  if (m?.[1]) return m[1];
  return name;
}

function depMap(pkg: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!pkg || typeof pkg !== "object") return out;
  const o = pkg as Record<string, unknown>;
  for (const field of DEP_FIELDS) {
    const block = o[field];
    if (!block || typeof block !== "object") continue;
    for (const [k, v] of Object.entries(block as Record<string, unknown>)) {
      if (typeof v === "string") out.set(k, v);
    }
  }
  return out;
}

function projectPackageJson(
  change: ArtifactChange,
  added: string[],
): GateUnit[] {
  // 依赖键级差：用 JSON 解析 before/after，不依赖行文本
  let beforeObj: unknown = {};
  let afterObj: unknown = {};
  try {
    if (change.before) beforeObj = JSON.parse(change.before);
  } catch {
    beforeObj = {};
  }
  try {
    if (change.after) afterObj = JSON.parse(change.after);
  } catch {
    afterObj = {};
  }
  const beforeDeps = depMap(beforeObj);
  const afterDeps = depMap(afterObj);
  const units: GateUnit[] = [];
  for (const [name, spec] of afterDeps) {
    if (beforeDeps.has(name) && beforeDeps.get(name) === spec) continue;
    // 新增键，或同键改成了别的包（npm 别名）
    if (!beforeDeps.has(name)) {
      const real = resolveNpmPackageName(name, spec);
      units.push({
        kind: "U-DEP",
        text: real,
        file: change.path,
        source: "change",
      });
    } else {
      const real = resolveNpmPackageName(name, spec);
      const prev = resolveNpmPackageName(name, beforeDeps.get(name)!);
      if (real !== prev) {
        units.push({
          kind: "U-DEP",
          text: real,
          file: change.path,
          source: "change",
        });
      }
    }
  }
  // 若 JSON 解析失败但有新增行，不在此强行抽依赖
  void added;
  return units;
}

function projectRequirements(
  change: ArtifactChange,
  added: string[],
): GateUnit[] {
  const units: GateUnit[] = [];
  for (const line of added) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = /^([A-Za-z0-9_.-]+)\s*(?:[=<>!~].*)?$/.exec(trimmed);
    if (m?.[1]) {
      units.push({
        kind: "U-DEP",
        text: m[1],
        file: change.path,
        source: "change",
      });
    }
  }
  return units;
}

function projectGoMod(change: ArtifactChange, added: string[]): GateUnit[] {
  const units: GateUnit[] = [];
  for (const line of added) {
    const trimmed = line.trim();
    // require x v1.2.3  或  x v1.2.3（require 块内）
    let m = /^require\s+(\S+)\s+\S+/.exec(trimmed);
    if (!m) m = /^(\S+)\s+v\d[\w.-]*$/.exec(trimmed);
    if (m?.[1] && m[1] !== "require") {
      units.push({
        kind: "U-DEP",
        text: m[1],
        file: change.path,
        source: "change",
      });
    }
  }
  return units;
}

const IMPORT_PATTERNS: RegExp[] = [
  /\bfrom\s+["']([^"']+)["']/, // JS/TS import … from "x" / export … from
  /\bimport\s+["']([^"']+)["']/, // import "x" / side-effect
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/,
  /^import\s+(\S+)/, // Python: import x
  /^from\s+(\S+)\s+import\b/, // Python: from x import
];

function moduleSpecifierName(spec: string): string {
  // 取包名：node 内置与相对路径原样；@scope/name 保留两段；其余取首段
  if (spec.startsWith(".") || spec.startsWith("/")) return spec;
  if (spec.startsWith("@")) {
    const parts = spec.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : spec;
  }
  // go / 含路径
  if (spec.includes("/") && !spec.startsWith("@")) {
    // JS 子路径 lodash/get → lodash；go.mongodb.org/mongo-driver → 全路径留给 DEP
    // 对 import 通常取 registry 包名（第一段），但 go 风格保留
    if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(spec)) return spec;
    return spec.split("/")[0]!;
  }
  return spec;
}

function isCommentLine(line: string, filePath: string): boolean {
  const t = line.trim();
  if (
    t.startsWith("//") ||
    t.startsWith("#") ||
    t.startsWith("/*") ||
    t.startsWith("*")
  )
    return true;
  if (/\.(md|txt|rst)$/i.test(filePath)) return true;
  return false;
}

function projectCodeLines(
  change: ArtifactChange,
  added: string[],
  afterLines: string[],
): GateUnit[] {
  const units: GateUnit[] = [];
  const isMd = /\.(md|txt|rst)$/i.test(change.path);
  for (const line of added) {
    const idx = afterLines.indexOf(line);
    const base = {
      text: line,
      file: change.path,
      source: "change" as const,
      ...(idx >= 0 ? { line_hint: idx + 1 } : {}),
    };
    if (isCommentLine(line, change.path) || isMd) {
      units.push({ kind: "U-NL", ...base });
      continue;
    }
    let imported = false;
    for (const re of IMPORT_PATTERNS) {
      const m = re.exec(line.trim());
      if (m?.[1]) {
        units.push({
          kind: "U-IMPORT",
          ...base,
          text: moduleSpecifierName(m[1]),
        });
        imported = true;
        break;
      }
    }
    // 非注释代码行 → U-IDENT（整行文本，供 codeTokens）
    units.push({ kind: "U-IDENT", ...base });
    void imported;
  }
  return units;
}

/**
 * projectArtifact：一个文件改动 → GateUnit[]。
 * 新文件额外产出 U-PATH；依赖清单走专用解析。
 */
export function projectArtifact(change: ArtifactChange): GateUnit[] {
  const units: GateUnit[] = [];
  const added = addedLines(change.before, change.after);
  const afterLines = splitLines(change.after);
  const base = change.path.replace(/\\/g, "/").split("/").pop() ?? change.path;

  if (change.before === null && change.after !== null) {
    units.push({
      kind: "U-PATH",
      text: change.path.replace(/\\/g, "/"),
      file: change.path,
      source: "change",
    });
  }

  if (base === "package.json") {
    units.push(...projectPackageJson(change, added));
    return units;
  }
  if (/^requirements.*\.txt$/i.test(base)) {
    units.push(...projectRequirements(change, added));
    return units;
  }
  if (base === "go.mod") {
    units.push(...projectGoMod(change, added));
    return units;
  }

  units.push(...projectCodeLines(change, added, afterLines));
  return units;
}

const INSTALL_CMDS = new Set(["install", "i", "add", "get"]);

const PKG_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);

function stripVersion(pkg: string): string {
  // mongoose@8 / @scope/name@1.0.0
  if (pkg.startsWith("@")) {
    const at = pkg.indexOf("@", 1);
    return at > 0 ? pkg.slice(0, at) : pkg;
  }
  const at = pkg.indexOf("@");
  return at > 0 ? pkg.slice(0, at) : pkg;
}

/**
 * projectCommand：安装命令 → U-CMD；非安装命令 → []。
 */
export function projectCommand(argv: readonly string[]): GateUnit[] {
  if (argv.length === 0) return [];
  const args = argv.map(String);
  const bin = args[0]!.replace(/^.*\//, "");

  // pip install <pkg>
  if (bin === "pip" || bin === "pip3") {
    const idx = args.findIndex((a) => a === "install");
    if (idx < 0) return [];
    const units: GateUnit[] = [];
    for (let i = idx + 1; i < args.length; i++) {
      const a = args[i]!;
      if (a.startsWith("-")) continue;
      units.push({
        kind: "U-CMD",
        text: a.split("==")[0]!.split(">=")[0]!.split("<=")[0]!,
        source: "command",
      });
    }
    return units;
  }

  // go get <mod>
  if (bin === "go" && args[1] === "get") {
    return args
      .slice(2)
      .filter((a) => !a.startsWith("-"))
      .map((a) => ({
        kind: "U-CMD" as const,
        text: a,
        source: "command" as const,
      }));
  }

  // npm|pnpm|yarn|bun add|install|i <pkg>
  if (!PKG_MANAGERS.has(bin)) return [];
  let i = 1;
  if (bin === "npm" && args[1] === "run") return [];
  if (!INSTALL_CMDS.has(args[1] ?? "")) {
    // yarn <pkg> 简写不加；要求显式 add/install
    return [];
  }
  i = 2;
  const units: GateUnit[] = [];
  for (; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("-")) continue;
    units.push({
      kind: "U-CMD",
      text: stripVersion(a),
      source: "command",
    });
  }
  return units;
}

/**
 * projectText：自然语言文本 → U-NL。
 */
export function projectText(
  text: string,
  source: GateUnit["source"],
): GateUnit[] {
  if (!text.trim()) return [];
  return [{ kind: "U-NL", text, source }];
}
