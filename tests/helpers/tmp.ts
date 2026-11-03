import fs from "node:fs";
import path from "node:path";

/**
 * 受限环境的 safe-delete 垫片：同一轮内累计删除超过阈值后，会用
 * `SAFE_DELETE_*`（例如 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`）拒绝后续删除。
 *
 * 这条错误不是仓库代码产生的（`git grep SAFE_DELETE -- src daemon` 为空），
 * 而是执行环境的配额策略。测试的临时目录清理属于「跑完就扔」，
 * 环境拒绝删除不该让用例变红；但**其它**删除错误必须照常抛出，
 * 否则真实的文件系统 bug 会被 `catch {}` 吞掉。
 */
const SAFE_DELETE_MARKER = "SAFE_DELETE_";

/**
 * 清理时偶尔会撞上「目录刚被删一半、子进程还在收尾」的瞬时错误（全量跑偶发）。
 * Windows 上杀毒/索引服务持锁可能更久（EBUSY / EPERM），
 * 重试上限提升至 15 次（总退避 ~4.5-5s）；重试耗尽时把 EBUSY 等瞬时持锁降级为 warn 而非 throw。
 */
const TRANSIENT_RM_CODES = new Set(
  process.platform === "win32"
    ? ["EBUSY", "ENOTEMPTY", "EPERM"]
    : ["EBUSY", "ENOTEMPTY"],
);

const MAX_TRANSIENT_RETRIES = 15;

/**
 * 环境拒绝「写」的错误码。全盘只读 / 配额耗尽时，探针连落盘都做不到：
 * 那不是「删除被拒」，而是「无法观测删除」，两者对调用方都是同一种降级。
 */
const WRITE_DENIED_CODES = new Set([
  "EACCES",
  "EPERM",
  "EROFS",
  "EDQUOT",
  "ENOSPC",
]);

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 环境的写/删拒绝：这类错误不该让辅助函数抛错，只该让判定降级 */
function isEnvironmentDenial(error: unknown): boolean {
  if (errorMessage(error).includes(SAFE_DELETE_MARKER)) return true;
  const code = errorCode(error);
  return code !== undefined && WRITE_DENIED_CODES.has(code);
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * 删除临时目录 / 临时文件；被环境的 safe-delete 垫片拒绝时返回 `false`。
 *
 * 返回值给调用方一个判断依据：
 * - 绝大多数用例（断言日志内容、HTTP 响应等）直接忽略返回值，清理失败不影响结论；
 * - 只有断言本身就是「盘上文件已消失」的用例，才应该在 `false` 时降级为跳过，
 *   因为此时观测不到删除结果不是代码的问题（见 `diskDeleteBlocked()`）。
 */
export function safeRmSync(target: string): boolean {
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return true;
    } catch (error) {
      // 尺度刻意收窄：只有 safe-delete 垫片的拒绝算「环境不让删」。
      // EACCES/EROFS 一类在这里仍然抛出——清理路径上出现只读或权限错误，
      // 说明真出了问题（路径拼错、文件不在预期位置），不该被静默吞掉。
      if (errorMessage(error).includes(SAFE_DELETE_MARKER)) return false;
      const code = errorCode(error);
      if (code !== undefined && TRANSIENT_RM_CODES.has(code)) {
        if (attempt < MAX_TRANSIENT_RETRIES) {
          sleepSync(Math.min(40 * (attempt + 1), 400));
          continue;
        }
        // 重试耗尽：降级为 warn，不让临时目录清理失败红了测试（残留目录由 runner 销毁兜底）
        console.warn(
          `[safeRmSync] 临时目录清理重试耗尽（已尝试 ${attempt + 1} 次，错误码 ${code}）：${errorMessage(error)}。目标：${target}。降级为跳过清理，由 runner 销毁兜底。`,
        );
        return false;
      }
      throw error;
    }
  }
}

/**
 * 探测某个位置上的删除是否可观测。
 *
 * - `blocked`：探针写进去了、但删不掉 → 删除被环境拒绝，盘上断言不可观测；
 * - `allowed`：能写也能删 → 删除可观测；
 * - `unavailable`：连探针都写不进去（全盘只读 / 配额耗尽）→ 这一处给不出答案，
 *   既不能当成「能删」也不能抛错让用例变红，交由调用方换下一处或按不可观测处理。
 *
 * 删除步骤不看错误码、只看文件是否还在（与 `deadlock-call-sites` 原口径一致）：
 * 探针只回答「环境让不让删」，任何「删了但文件还在」都归为不可观测。
 */
type ProbeVerdict = "blocked" | "allowed" | "unavailable";

function probeDeleteAt(base: string): ProbeVerdict {
  let dir: string;
  try {
    fs.mkdirSync(base, { recursive: true });
    dir = fs.mkdtempSync(path.join(base, "probe-"));
    fs.writeFileSync(path.join(dir, "probe.lock"), "probe");
  } catch (error) {
    // 写不进去：环境层面的写拒绝降级为「这一处给不出答案」，
    // 其余错误（ENOTDIR、路径拼错一类）照常抛出，避免把真 bug 当成环境问题。
    if (isEnvironmentDenial(error)) return "unavailable";
    throw error;
  }

  const probe = path.join(dir, "probe.lock");
  try {
    fs.rmSync(probe, { force: true });
  } catch {
    /* 被环境拒绝：下面按 existsSync 判定 */
  }
  const blocked = fs.existsSync(probe);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 清理探针本身失败不影响判定 */
  }
  return blocked ? "blocked" : "allowed";
}

/**
 * 默认探针位置。刻意只放在工作区内：
 * 受限沙箱本来就禁止删工作区外的文件（见 `vitest.global-setup.ts` 的说明），
 * 拿 `/tmp` 一类外部路径当兜底只会探出「另一条策略拒绝删除」，
 * 把正常环境误判成受限环境。
 */
function defaultProbeRoots(): string[] {
  return [path.join(process.cwd(), ".tmp", "unit-safe-delete-probe")];
}

/**
 * 按候选顺序探测，返回「删除是否不可观测」。
 *
 * 每一步：
 * - 任一位置探到 `blocked` → 立刻 `true`（垫片是路径无关的）；
 * - 任一位置探到 `allowed` → 立刻 `false`（能删就是能删）；
 * - `unavailable` 只代表这一处没答案，继续看下一处；
 * - 全部 `unavailable` → `true`：观测不到删除结果时必须降级，而不是让用例红。
 *
 * 导出是为让用例能注入一个只读目录来验证兜底分支，默认调用方用
 * `diskDeleteBlocked()`。
 */
export function diskDeleteBlockedIn(roots: readonly string[]): boolean {
  for (const root of roots) {
    const verdict = probeDeleteAt(root);
    if (verdict === "blocked") return true;
    if (verdict === "allowed") return false;
  }
  return true;
}

/**
 * 探测当前环境是否拒绝删除：写一个探针文件后尝试删除，删不掉即判定被拒。
 *
 * 不要缓存结果——垫片是按「本轮累计删除次数」触发的，同一轮里前半段能删、
 * 后半段被拒是正常现象（这正是全量跑才偶发的原因）。
 *
 * 探针自己写不进去时（全盘只读）返回 `true` 而不是抛错：调用方拿它决定
 * 「要不要把盘上断言降级为跳过」，让环境问题变成一条带原因的 skip，
 * 而不是一条看起来像产品缺陷的红色失败。
 */
export function diskDeleteBlocked(): boolean {
  return diskDeleteBlockedIn(defaultProbeRoots());
}
