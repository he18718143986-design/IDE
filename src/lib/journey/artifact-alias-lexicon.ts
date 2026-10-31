/**
 * 代码通道别名表（G-MATCH-CODE / TASK-J.18a）。
 * 只收「同一方案的常见包名」；增删须递增 ALIAS_LEXICON_VERSION 并补共享夹具。
 * 纯函数数据：零 IO。
 */

/** 别名表版本；改表必须 +1 */
export const ALIAS_LEXICON_VERSION = 2;

/**
 * 键 → 别名列表（含自身常见拼写）。
 * 值中以 `/*` 结尾的项表示 scope 通配（如 `@mongodb-js/*`）。
 */
export const ALIAS_LEXICON: Readonly<Record<string, readonly string[]>> = {
  mongodb: [
    "mongodb",
    "mongoose",
    "mongo",
    "@mongodb-js/*",
    "pymongo",
    "motor",
    "go.mongodb.org/mongo-driver",
  ],
  mongo: [
    "mongodb",
    "mongoose",
    "mongo",
    "@mongodb-js/*",
    "pymongo",
    "motor",
    "go.mongodb.org/mongo-driver",
  ],
  excel: [
    "xlsx",
    "xls",
    "exceljs",
    "sheetjs",
    "xlsx-populate",
    "openpyxl",
    "xlsxwriter",
    "excel",
  ],
  xlsx: [
    "xlsx",
    "xls",
    "exceljs",
    "sheetjs",
    "xlsx-populate",
    "openpyxl",
    "xlsxwriter",
    "excel",
  ],
  redis: ["redis", "ioredis", "@redis/client", "go-redis"],
  graphql: ["graphql", "apollo-server", "@apollo/client", "graphql-yoga"],
};

export type AliasLexicon = Readonly<Record<string, readonly string[]>>;
