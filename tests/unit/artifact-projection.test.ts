/**
 * TM-GU：判定单元抽取（TASK-J.18a）。
 */
import { describe, expect, it } from "vitest";
import {
  addedLines,
  projectArtifact,
  projectCommand,
  projectText,
  type GateUnit,
} from "../../src/lib/journey/artifact-projection";

function kinds(units: GateUnit[]): string[] {
  return units.map((u) => `${u.kind}:${u.text}`);
}

describe("TM-GU artifact projection", () => {
  it("TM-GU-01 package.json 新增 mongoose → U-DEP mongoose", () => {
    const before = JSON.stringify({
      name: "app",
      dependencies: { lodash: "^4" },
    });
    const after = JSON.stringify({
      name: "app",
      dependencies: { lodash: "^4", mongoose: "^8" },
    });
    const units = projectArtifact({
      path: "package.json",
      before,
      after,
    });
    expect(kinds(units)).toContain("U-DEP:mongoose");
  });

  it("TM-GU-02 npm 别名 npm:mongodb@^6 → U-DEP mongodb", () => {
    const before = JSON.stringify({ name: "app", dependencies: {} });
    const after = JSON.stringify({
      name: "app",
      dependencies: { db: "npm:mongodb@^6" },
    });
    const units = projectArtifact({
      path: "package.json",
      before,
      after,
    });
    expect(kinds(units)).toContain("U-DEP:mongodb");
  });

  it("TM-GU-03 已有 mongodb，只改 scripts → 无 U-DEP", () => {
    const before = JSON.stringify({
      dependencies: { mongodb: "^6" },
      scripts: { start: "node a.js" },
    });
    const after = JSON.stringify({
      dependencies: { mongodb: "^6" },
      scripts: { start: "node a.js", build: "tsc" },
    });
    const units = projectArtifact({
      path: "package.json",
      before,
      after,
    });
    expect(units.filter((u) => u.kind === "U-DEP")).toEqual([]);
  });

  it("TM-GU-04 新增 import mongodb → U-IMPORT + U-IDENT", () => {
    const units = projectArtifact({
      path: "src/db.ts",
      before: "export {};\n",
      after: 'export {};\nimport { MongoClient } from "mongodb";\n',
    });
    expect(kinds(units)).toContain("U-IMPORT:mongodb");
    expect(units.some((u) => u.kind === "U-IDENT")).toBe(true);
  });

  it("TM-GU-05 已有 import 行移动位置 → 无新增单元", () => {
    const line = 'import { MongoClient } from "mongodb";';
    const before = `const a = 1;\n${line}\n`;
    const after = `${line}\nconst a = 1;\n`;
    const units = projectArtifact({
      path: "src/db.ts",
      before,
      after,
    });
    // 行多重集差：两行都在 before 与 after 各一次 → 无新增
    expect(
      units.filter((u) => u.kind === "U-IMPORT" || u.kind === "U-IDENT"),
    ).toEqual([]);
  });

  it("TM-GU-06 requirements.txt 新增 pymongo → U-DEP pymongo", () => {
    const units = projectArtifact({
      path: "requirements.txt",
      before: "flask==2.0\n",
      after: "flask==2.0\npymongo==4.6\n",
    });
    expect(kinds(units)).toContain("U-DEP:pymongo");
  });

  it("TM-GU-07 go.mod 新增 require mongo-driver → U-DEP", () => {
    const units = projectArtifact({
      path: "go.mod",
      before: "module example\n\ngo 1.21\n",
      after:
        "module example\n\ngo 1.21\n\nrequire go.mongodb.org/mongo-driver v1.13.0\n",
    });
    expect(kinds(units)).toContain("U-DEP:go.mongodb.org/mongo-driver");
  });

  it("TM-GU-08 npm install -D mongoose@8 → U-CMD mongoose", () => {
    const units = projectCommand(["npm", "install", "-D", "mongoose@8"]);
    expect(kinds(units)).toEqual(["U-CMD:mongoose"]);
  });

  it("TM-GU-09 npm run build → 无单元", () => {
    expect(projectCommand(["npm", "run", "build"])).toEqual([]);
  });

  it("TM-GU-10 新文件 excel-writer.ts → U-PATH（tokens 含 excel）", () => {
    const units = projectArtifact({
      path: "src/export/excel-writer.ts",
      before: null,
      after: "export const x = 1;\n",
    });
    const pathUnit = units.find((u) => u.kind === "U-PATH");
    expect(pathUnit?.text).toBe("src/export/excel-writer.ts");
    expect(pathUnit?.text.toLowerCase()).toContain("excel");
  });

  it("TM-GU-11 新增注释行 → U-NL，不产生 U-IDENT", () => {
    const units = projectArtifact({
      path: "src/a.ts",
      before: "const x = 1;\n",
      after: "const x = 1;\n// 没有用 MongoDB\n",
    });
    expect(units.some((u) => u.kind === "U-NL")).toBe(true);
    expect(units.some((u) => u.kind === "U-IDENT")).toBe(false);
  });

  it("TM-GU-12 \\r\\n 改为 \\n 内容不变 → 无新增单元", () => {
    const body = "const x = 1;\nconst y = 2;\n";
    const units = projectArtifact({
      path: "src/a.ts",
      before: body.replace(/\n/g, "\r\n"),
      after: body,
    });
    expect(units).toEqual([]);
    expect(addedLines(body.replace(/\n/g, "\r\n"), body)).toEqual([]);
  });

  it("projectText → U-NL", () => {
    expect(projectText("改用 MongoDB", "log")).toEqual([
      { kind: "U-NL", text: "改用 MongoDB", source: "log" },
    ]);
  });
});
