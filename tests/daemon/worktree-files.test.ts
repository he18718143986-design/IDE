import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import { decideWrite } from "../../daemon/editor/worktree-files";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";

describe("TASK-C.3 编辑器保存的服务端强制校验", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  afterEach(async () => {
    if (daemon?.isRunning) await daemon.stop();
    safeRmSync(repo);
  });

  it("越权保存 403 + 违规记录 + 文件无改动；合法保存 200", async () => {
    repo = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "stagent-c3-")),
    );
    fs.mkdirSync(path.join(repo, ".git"));
    fs.writeFileSync(path.join(repo, ".git", "config"), "orig");
    fs.writeFileSync(path.join(repo, "a.ts"), "export const a = 1;\n");
    daemon = createDaemon({
      repoRoot: repo,
      startPort: 4210,
      endPort: 4219,
      enableCrashRecovery: false,
    });
    const { port } = await daemon.start();
    const base = `http://127.0.0.1:${port}/api/worktree/files`;
    const h = {
      authorization: `Bearer ${daemon.getSessionToken()}`,
      "content-type": "application/json",
    };
    const post = (p: string, content: string) =>
      fetch(base, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ path: p, content }),
      });

    expect((await fetch(`${base}?path=a.ts`)).status).toBe(401);
    const got = await (await fetch(`${base}?path=a.ts`, { headers: h })).json();
    expect(got).toMatchObject({
      path: "a.ts",
      writable: true,
      content: "export const a = 1;\n",
    });

    const r1 = await post(".git/config", "hacked");
    expect(r1.status).toBe(403);
    expect((await r1.json()).error).toBe("GATEWAY_VIOLATION");
    const r2 = await post("../outside.txt", "x");
    expect(r2.status).toBe(403);
    expect(fs.readFileSync(path.join(repo, ".git", "config"), "utf8")).toBe(
      "orig",
    );
    expect(fs.existsSync(path.join(path.dirname(repo), "outside.txt"))).toBe(
      false,
    );
    const log = fs
      .readFileSync(
        path.join(repo, ".stagent", "audit", "gateway-violations.jsonl"),
        "utf8",
      )
      .trim()
      .split("\n");
    expect(log).toHaveLength(2);
    expect(JSON.parse(log[0]!)).toMatchObject({
      source: "editor",
      path: ".git/config",
    });

    expect((await post("a.ts", "export const a = 2;\n")).status).toBe(200);
    expect(fs.readFileSync(path.join(repo, "a.ts"), "utf8")).toBe(
      "export const a = 2;\n",
    );
  });

  it("合同模式：只能写 writable_paths；只读与强禁区拒绝", () => {
    repo = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "stagent-c3s-")),
    );
    const contract = softwareContractSchema.parse({
      ...createContractDraft({
        title: "t",
        description: "d",
        acceptanceCriteria: ["x"],
        writablePaths: ["src/**"],
        readonlyPaths: ["src/locked.ts"],
        strictlyForbiddenPaths: ["src/secret/**"],
      }),
    });
    const ctx = { repoRoot: repo, contract, worktreePath: repo };
    expect(decideWrite(ctx, "src/a.ts").allowed).toBe(true);
    expect(decideWrite(ctx, "docs/a.md")).toMatchObject({
      allowed: false,
      reason: "不在合同可写范围内",
    });
    expect(decideWrite(ctx, "src/locked.ts")).toMatchObject({
      allowed: false,
      reason: "合同只读路径",
    });
    expect(decideWrite(ctx, "src/secret/k.ts")).toMatchObject({
      allowed: false,
      reason: "合同强禁区",
    });
  });
});
