import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * 单文件 TS/JS/JSON 依赖解析（规范 TASK-B.1）。
 * - 使用 TypeScript Compiler API 的 createSourceFile，不构建完整 Program（保证增量性能）
 * - 识别 import / export-from / dynamic import / require
 * - 区分 `import type` 与值导入
 * - 支持 tsconfig paths / baseUrl 别名解析
 * - 支持静态/动态引入 .json 文件（.json 作为叶子节点）
 * - 异常防御：单文件解析异常降级为空出边与空导出，不炸全图
 */
export interface ParsedImport {
  specifier: string;
  resolved: string | null;
  typeOnly: boolean;
  dynamic: boolean;
}

export interface ParsedModule {
  filePath: string;
  imports: ParsedImport[];
  exports: string[];
}

export interface PathAliasConfig {
  baseUrl: string;
  paths: Record<string, string[]>;
}

const EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
];

/** 读取 tsconfig 的 paths/baseUrl（容错 JSONC 注释与尾逗号） */
export function loadPathAliases(
  repoRoot: string,
  tsconfigPath = path.join(repoRoot, "tsconfig.json"),
): PathAliasConfig {
  const config: PathAliasConfig = { baseUrl: repoRoot, paths: {} };
  try {
    if (!fs.existsSync(tsconfigPath)) return config;

    const read = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    if (read.error || !read.config) return config;
    const options = (read.config.compilerOptions ?? {}) as {
      baseUrl?: string;
      paths?: Record<string, string[]>;
    };
    config.baseUrl = options.baseUrl
      ? path.resolve(path.dirname(tsconfigPath), options.baseUrl)
      : path.dirname(tsconfigPath);
    config.paths = options.paths ?? {};
  } catch {
    // 读取或解析 tsconfig 异常时优雅降级为默认空别名
  }
  return config;
}

/** 将 specifier 解析为仓库内绝对路径；无法解析返回 null */
export function resolveSpecifier(
  fromFile: string,
  specifier: string,
  aliases: PathAliasConfig,
): string | null {
  const tryFile = (base: string): string | null => {
    try {
      if (fs.existsSync(base)) {
        try {
          if (fs.statSync(base).isFile()) return path.resolve(base);
        } catch {
          // ignore stat errors
        }
      }
      for (const ext of EXTENSIONS) {
        const candidate = base + ext;
        if (fs.existsSync(candidate)) return path.resolve(candidate);
      }
      for (const ext of EXTENSIONS) {
        const idx = path.join(base, `index${ext}`);
        if (fs.existsSync(idx)) return path.resolve(idx);
      }
    } catch {
      // 容错任意异常
    }
    return null;
  };

  if (!specifier || typeof specifier !== "string") return null;

  if (specifier.startsWith(".")) {
    return tryFile(path.resolve(path.dirname(fromFile), specifier));
  }

  if (specifier.startsWith("/")) return null;

  // tsconfig paths 别名（支持单段通配符与精确匹配）
  if (aliases.paths) {
    for (const [pattern, targets] of Object.entries(aliases.paths)) {
      if (!targets || targets.length === 0) continue;
      const star = pattern.indexOf("*");
      if (star === -1) {
        if (pattern === specifier && targets[0]) {
          const resolved = tryFile(path.resolve(aliases.baseUrl, targets[0]));
          if (resolved) return resolved;
        }
        continue;
      }
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      if (specifier.startsWith(prefix) && specifier.endsWith(suffix)) {
        const middle = specifier.slice(
          prefix.length,
          specifier.length - suffix.length,
        );
        for (const target of targets) {
          const candidate = target.replace("*", middle);
          const resolved = tryFile(path.resolve(aliases.baseUrl, candidate));
          if (resolved) return resolved;
        }
      }
    }
  }

  // baseUrl 绝对导入
  if (aliases.baseUrl) {
    const viaBase = tryFile(path.resolve(aliases.baseUrl, specifier));
    if (viaBase) return viaBase;
  }

  return null;
}

function collectExportNames(source: ts.SourceFile): string[] {
  const names: string[] = [];
  try {
    for (const statement of source.statements) {
      const modifiers = ts.canHaveModifiers(statement)
        ? ts.getModifiers(statement)
        : undefined;
      const exported = modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      if (!exported) continue;

      if (ts.isFunctionDeclaration(statement) && statement.name) {
        names.push(statement.name.text);
      } else if (ts.isClassDeclaration(statement) && statement.name) {
        names.push(statement.name.text);
      } else if (ts.isInterfaceDeclaration(statement)) {
        names.push(statement.name.text);
      } else if (ts.isTypeAliasDeclaration(statement)) {
        names.push(statement.name.text);
      } else if (ts.isVariableStatement(statement)) {
        for (const decl of statement.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) names.push(decl.name.text);
        }
      } else if (ts.isExportDeclaration(statement) && statement.exportClause) {
        if (ts.isNamedExports(statement.exportClause)) {
          names.push(
            ...statement.exportClause.elements.map((e) => e.name.text),
          );
        }
      }
    }
  } catch {
    // 遍历 AST 导出节点容错
  }
  return names;
}

/** 解析源码字符串（纯函数，便于性能测试） */
export function parseSource(
  filePath: string,
  content: string,
  aliases: PathAliasConfig,
): ParsedModule {
  const resolvedPath = path.resolve(filePath);

  // .json 文件入图作为纯叶子节点：无出边、无额外导出或根据 top-level keys 声明
  if (resolvedPath.endsWith(".json")) {
    let exports: string[] = [];
    try {
      const parsedJson = JSON.parse(content);
      if (
        parsedJson &&
        typeof parsedJson === "object" &&
        !Array.isArray(parsedJson)
      ) {
        exports = Object.keys(parsedJson);
      }
    } catch {
      // 非法 JSON 降级为空导出
    }
    return {
      filePath: resolvedPath,
      imports: [],
      exports,
    };
  }

  try {
    const isTsx =
      resolvedPath.endsWith(".tsx") || resolvedPath.endsWith(".jsx");
    const isJs =
      resolvedPath.endsWith(".js") ||
      resolvedPath.endsWith(".mjs") ||
      resolvedPath.endsWith(".cjs");

    const scriptKind = isTsx
      ? ts.ScriptKind.TSX
      : isJs
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;

    const source = ts.createSourceFile(
      resolvedPath,
      content,
      ts.ScriptTarget.Latest,
      false,
      scriptKind,
    );

    const imports: ParsedImport[] = [];

    const push = (specifier: string, typeOnly: boolean, dynamic: boolean) => {
      imports.push({
        specifier,
        resolved: resolveSpecifier(resolvedPath, specifier, aliases),
        typeOnly,
        dynamic,
      });
    };

    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement)) {
        if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
        push(
          statement.moduleSpecifier.text,
          statement.importClause?.isTypeOnly ?? false,
          false,
        );
      } else if (ts.isExportDeclaration(statement)) {
        if (
          statement.moduleSpecifier &&
          ts.isStringLiteral(statement.moduleSpecifier)
        ) {
          push(statement.moduleSpecifier.text, statement.isTypeOnly, false);
        }
      } else if (ts.isImportEqualsDeclaration(statement)) {
        if (ts.isExternalModuleReference(statement.moduleReference)) {
          const expr = statement.moduleReference.expression;
          if (ts.isStringLiteral(expr)) push(expr.text, false, false);
        }
      }
    }

    // 动态 import() / require()
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const isDynamicImport =
          node.expression.kind === ts.SyntaxKind.ImportKeyword;
        const isRequire =
          ts.isIdentifier(node.expression) &&
          node.expression.text === "require";
        if ((isDynamicImport || isRequire) && node.arguments.length > 0) {
          const first = node.arguments[0];
          if (first && ts.isStringLiteral(first)) {
            push(first.text, false, true);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);

    return {
      filePath: resolvedPath,
      imports,
      exports: collectExportNames(source),
    };
  } catch {
    // 单文件 AST 异常防御：降级为空出边并记录
    return {
      filePath: resolvedPath,
      imports: [],
      exports: [],
    };
  }
}

export function parseFile(
  filePath: string,
  aliases: PathAliasConfig,
): ParsedModule {
  const resolvedPath = path.resolve(filePath);
  try {
    const content = fs.readFileSync(resolvedPath, "utf-8");
    return parseSource(resolvedPath, content, aliases);
  } catch {
    return {
      filePath: resolvedPath,
      imports: [],
      exports: [],
    };
  }
}
