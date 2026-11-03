import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  diskDeleteBlocked,
  diskDeleteBlockedIn,
  safeRmSync,
} from "../helpers/tmp";

/**
 * `tests/helpers/tmp.ts` 自身的验收。
 *
 * 这个 helper 决定「盘上断言要不要降级为跳过」，所以它的边界必须钉死：
 * - 只有**环境**层面的写/删拒绝可以变成 `false` / `true`（降级）；
 * - 其余错误必须照常抛出，否则真 bug 会被当成环境问题悄悄跳过；
 * - 探针写不进去时（全盘只读）不许抛错，只能降级。
 *
 * 「全盘只读」用 `chmod 0o500` 造：目录可读可进入、但不可写，
 * 于是 `mkdtemp` / `unlink` 都会得到 EACCES——与只读沙箱的表现同源。
 */

const roots: string[] = [];

function newRoot(): string {
  const base = path.join(process.cwd(), ".tmp", "unit-tmp-helper");
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, "case-"));
  roots.push(dir);
  return dir;
}

/**
 * 只读目录只能靠 POSIX 权限位造（`chmod 0o500`）。Windows 上 chmod 只翻转
 * 只读属性、不阻止 mkdir/unlink，产不出 EACCES，也就无从验证「写不进去要降级」；
 * Linux/POSIX 下若以 root（uid 0）运行，DAC 权限检查亦会被内核旁路。
 * 所以依赖它的用例在 win32 及 root 环境下跳过——不是掩盖失败，而是该机制在环境层不存在。
 */
const POSIX_NON_ROOT =
  process.platform !== "win32" &&
  (typeof process.getuid !== "function" || process.getuid() !== 0);

/** 造一个只读目录（含一个已存在的文件），返回 [目录, 文件] */
function newReadOnlyDir(): [string, string] {
  const dir = newRoot();
  const file = path.join(dir, "keep.txt");
  fs.writeFileSync(file, "keep");
  fs.chmodSync(dir, 0o500);
  return [dir, file];
}

afterEach(() => {
  for (const dir of roots.splice(0)) {
    // 只读目录要先恢复写权限，否则清理本身会失败（这里刻意用裸 rmSync 之外的方式）
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      /* 目录可能已被删掉 */
    }
    safeRmSync(dir);
  }
});

describe("safeRmSync：只吞环境拒绝", () => {
  it("正常目录删得掉，返回 true", () => {
    const dir = newRoot();
    fs.writeFileSync(path.join(dir, "a.txt"), "a");
    expect(safeRmSync(dir)).toBe(true);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("目标不存在也返回 true（force 语义，不该抛）", () => {
    const missing = path.join(newRoot(), "never-existed");
    expect(safeRmSync(missing)).toBe(true);
  });

  it.skipIf(!POSIX_NON_ROOT)("非 safe-delete 的删除失败不得被当成成功", () => {
    const [, file] = newReadOnlyDir();
    let claimed = false;
    try {
      claimed = safeRmSync(file);
    } catch {
      // 照常抛出也是可接受口径：总之不许声称删成功了
    }
    expect(claimed).toBe(false);
    // 事实层面：文件确实还在，所以 true 就是错报
    expect(fs.existsSync(file)).toBe(true);
  });
});

describe("diskDeleteBlocked：探测写不进去时降级而不是抛错", () => {
  it("可写目录探到 allowed → 未受阻断", () => {
    expect(diskDeleteBlockedIn([newRoot()])).toBe(false);
  });

  it.skipIf(!POSIX_NON_ROOT)(
    "只读目录探针写不进去 → 按不可观测处理，且不抛错",
    () => {
      const [readOnly] = newReadOnlyDir();
      expect(() => diskDeleteBlockedIn([readOnly])).not.toThrow();
      expect(diskDeleteBlockedIn([readOnly])).toBe(true);
    },
  );

  it.skipIf(!POSIX_NON_ROOT)(
    "前一处不可用不会短路，后面可用的位置仍能给出结论",
    () => {
      const [readOnly] = newReadOnlyDir();
      expect(diskDeleteBlockedIn([readOnly, newRoot()])).toBe(false);
    },
  );

  it("候选全空 → 视为不可观测（调用方据此降级）", () => {
    expect(diskDeleteBlockedIn([])).toBe(true);
  });

  it("真实调用点返回布尔且不抛错", () => {
    expect(typeof diskDeleteBlocked()).toBe("boolean");
  });
});
