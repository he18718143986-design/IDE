# Windows CI 适配债对账报告（TASK-CI.1）

> **性质**：纯调研报告，不改代码，供 Tina 拍板修复范围  
> **基线**：main@`6bbc04e`（2026-11-08）  
> **前次对账**：OP-33 部分销项（P-138 · #118/`96225df`）  
> **数据来源**：consistency-audit.md OP-33 历史记录 + 已知挂账 + CI 配置分析  
> **数据基线**：OP-33 快照 (run 40821117113)，非当前 main 实测——**分类结论需以新日志复核为准**

---

## 一、执行摘要

### 1.1 总体状况

- **CI 状态**：Windows job 配置为 `continue-on-error: true`，**不阻断合并**
- **前次基线**：45 项失败/20 文件（run 40821117113）
- **稳定层**：26 项每次必红（spawn/信号、符号链接、合并、迁移、worktree）
- **抖动层**：WS/auth/Origin/端口类（偶发）
- **已修项**：CRLF 归一化、`path.sep` 跨平台、`safeRmSync` 退避重试（P-138 已销项）

### 1.2 分类汇总

| 分类 | 数量（估） | 修复方向 | 建议 |
|------|-----------|---------|------|
| **A. 真 bug** | 2-5 项 | 修复代码逻辑 | **应修** |
| **B. 环境限制（平台侧）** | 10-15 项 | 无解或成本过高 | **应豁免** |
| **C. 测试写法问题** | 10-15 项 | 修改测试代码 | **可修** |
| **D. 性能门禁抖动** | 5-10 项 | 调整阈值或条件豁免 | **部分可修** |

---

## 二、失败用例清单（基于 OP-33 与已知挂账）

### 2.1 已知稳定层失败（26 项，每次必红）

根据 OP-33 记录，以下类别在 Windows 上稳定失败：

#### A. spawn/信号相关（估 5-8 项）

**典型用例**（推断）：
- `tests/daemon/worker/spawn-*.test.ts` - Worker 进程 spawn 测试
- `tests/daemon/runner/command-runner-signals.test.ts` - 信号处理测试

**失败原因**：
1. Windows 不支持 POSIX 信号（`SIGTERM`, `SIGKILL`）
2. `child_process.spawn()` 在 Windows 上行为差异（shell 包装、参数转义）
3. 进程终止语义不同（Windows 无 graceful SIGTERM）

**分类**：**B. 环境限制（平台侧）**

**修复方向**：
- **选项 1（豁免）**：`test.skipIf(process.platform === 'win32')` - **推荐**
- 选项 2（适配）：抽象信号层，Windows 用 `taskkill /PID`，成本高

**估算**：若豁免，0 工时；若适配，2-3 天（需重构信号处理层）

---

#### B. 符号链接相关（估 3-5 项）

**典型用例**（推断）：
- `tests/daemon/baseline/os-sandbox.test.ts` - 沙箱符号链接测试
- `tests/integration/worktree-*.test.ts` - Worktree 符号链接边界

**失败原因**：
1. Windows 创建符号链接需要**管理员权限**或开发者模式
2. CI runner 默认无管理员权限
3. `fs.symlink()` 在无权限时抛 `EPERM`

**分类**：**B. 环境限制（平台侧）**

**修复方向**：
- **选项 1（豁免）**：`test.skipIf(process.platform === 'win32')` - **推荐**
- 选项 2（CI 配置）：要求 runner 开启开发者模式，成本中等，但治标不治本（用户机器仍会遇到）

**估算**：若豁免，0 工时；若 CI 配置，1 天（需测试验证）

**已知挂账**：OP-33 已定性「平台侧不可修」

---

#### C. 合并相关（估 2-4 项）

**典型用例**（推断）：
- `tests/daemon/worktree/merger.test.ts` - Worktree 合并测试
- `tests/integration/contract-merge-*.test.ts` - 合同合并流程

**失败原因**：
1. Git 合并冲突标记可能受 autocrlf 影响
2. 临时文件锁（Windows 文件锁比 POSIX 严格）
3. 路径分隔符（已部分修复，可能有残留）

**分类**：**A. 真 bug（部分）** + **C. 测试写法问题（部分）**

**修复方向**：
- 选项 1：检查合并逻辑是否正确处理 CRLF
- 选项 2：测试前确保 `core.autocrlf=false`
- 选项 3：异步文件操作后增加 Windows 特定延迟（文件锁释放）

**估算**：1-2 天（需逐个调试）

**已知挂账**：C.4 挂账提到 `freshnessMap` 分隔符问题

---

#### D. 迁移相关（估 2-3 项）

**典型用例**（推断）：
- `tests/daemon/migration/*.test.ts` - 数据迁移测试

**失败原因**：
1. 路径分隔符（已部分修复，可能有残留）
2. 临时目录清理（Windows `EBUSY` 文件锁）

**分类**：**C. 测试写法问题**

**修复方向**：
- 已修项（P-138）：`safeRmSync` 退避重试
- 残留项：检查迁移路径拼接是否用 `path.join()`

**估算**：0.5-1 天（若已修完则 0 工时）

---

#### E. Worktree 相关（估 3-5 项）

**典型用例**（推断）：
- `tests/integration/worktree-isolation.test.ts` - Worktree 隔离测试
- `tests/daemon/worktree/manager.test.ts` - Worktree 管理器

**失败原因**：
1. 符号链接权限（同 B）
2. Git worktree 在 Windows 上的路径处理
3. 临时目录清理 `EBUSY`（已部分修复）

**分类**：**B. 环境限制（部分）** + **C. 测试写法问题（部分）**

**修复方向**：
- 符号链接部分豁免
- 路径处理用 `path.normalize()`
- 清理失败后重试（已修）

**估算**：1 天（主要是符号链接豁免）

---

### 2.2 抖动层失败（估 5-10 项，偶发）

#### F. WebSocket/IPC 相关（估 2-3 项）

**典型用例**：
- `ipc-stream.test.ts` - WS 帧顺序竞态（OP-35① 已销项）

**失败原因**：
1. 网络栈行为差异（Windows TCP/IP 栈）
2. 帧到达顺序竞态

**分类**：**C. 测试写法问题**

**修复方向**：
- **已修**（P-138）：`nextFrameOfType` / `waitForFrameType` 定向帧等待

**估算**：0 工时（已销项）

---

#### G. Auth/Origin 相关（估 1-2 项）

**失败原因**：
1. 端口绑定竞态（快速重启时端口未释放）
2. localhost 解析差异（IPv4/IPv6）

**分类**：**C. 测试写法问题**

**修复方向**：
- 端口池动态分配（已有 `test-port-map`，检查是否全量覆盖）
- `localhost` 显式用 `127.0.0.1`

**估算**：0.5 天

---

#### H. 性能门禁抖动（估 2-5 项）

**典型用例**（推断）：
- `tests/perf/arch-graph-benchmark.test.ts` - 架构图性能
- `tests/perf/watcher-*.test.ts` - Watcher 性能门禁

**失败原因**：
1. Windows 文件系统性能差异（NTFS vs ext4/APFS）
2. CI runner 性能波动

**分类**：**D. 性能门禁抖动**

**修复方向**：
- **选项 1（放宽阈值）**：Windows 特定阈值（如 `×1.5` 或 `×2`）
- 选项 2（条件豁免）：`test.skipIf(process.platform === 'win32')`

**估算**：0.5 天（调整阈值配置）

**已知挂账**：C.4 挂账提到 watcher 性能门禁抖动

---

### 2.3 已知具体挂账项

#### I. freshnessMap 分隔符（C.4 挂账）

**文件**：`daemon/watcher/merger.ts` 或类似

**失败原因**：
- `freshnessMap` 的 key 可能用硬编码 `/` 而非 `path.sep`

**分类**：**A. 真 bug**

**修复方向**：
- 统一用 `path.normalize()` 或 `path.sep`

**估算**：0.5 天

---

#### J. Merger 冲突用例红（已知项）

**失败原因**：
- 合并冲突检测逻辑可能依赖 POSIX 路径或换行符

**分类**：**A. 真 bug**

**修复方向**：
- 检查冲突标记解析是否处理 CRLF
- 检查路径比对是否归一化

**估算**：1 天

---

## 三、修复优先级与分界线

### 3.1 应修（真 bug + 影响功能）

| 项 | 类别 | 估算 | 优先级 |
|----|------|------|--------|
| freshnessMap 分隔符 | A | 0.5 天 | **P0** |
| Merger 冲突用例 | A | 1 天 | **P0** |
| 合并逻辑 CRLF 处理 | A | 1-2 天 | **P1** |
| 迁移路径拼接 | C | 0.5 天 | **P1** |

**小计**：3-4 天

---

### 3.2 可修（测试写法，不影响功能）

| 项 | 类别 | 估算 | 建议 |
|----|------|------|------|
| Auth/Origin 端口绑定 | C | 0.5 天 | 可修 |
| 性能门禁放宽阈值 | D | 0.5 天 | 可修 |
| Worktree 路径归一化 | C | 1 天 | 可修 |

**小计**：2 天

---

### 3.3 应豁免（平台侧限制，成本过高）

| 项 | 类别 | 原因 | 建议 |
|----|------|------|------|
| spawn/信号处理 | B | Windows 无 POSIX 信号 | `test.skipIf(isWindows)` |
| 符号链接权限 | B | 需管理员权限 | `test.skipIf(isWindows)` |
| Worktree 符号链接 | B | 同上 | `test.skipIf(isWindows)` |

**OP-33 已定性**：符号链接权限为「平台侧不可修」

---

## 四、拍板决策表（供 Tina 填写）

| 编号 | 项 | 当前状态 | 建议 | Tina 决定 | 备注 |
|------|----|---------| -----|-----------|------|
| 1 | freshnessMap 分隔符 | 已知挂账（C.4） | **修** | _待填_ | P0 真 bug |
| 2 | Merger 冲突用例 | 已知红 | **修** | _待填_ | P0 真 bug |
| 3 | 合并逻辑 CRLF | 推断可能有问题 | **修** | _待填_ | P1 真 bug |
| 4 | 迁移路径拼接 | 已部分修（P-138） | **核实残留** | _待填_ | P1 |
| 5 | spawn/信号处理 | 每次必红 | **豁免** | _待填_ | 平台限制 |
| 6 | 符号链接权限 | 每次必红 + OP-33 定性 | **豁免** | _待填_ | 平台限制 |
| 7 | Auth/Origin 端口 | 偶发 | 可修 / 可豁免 | _待填_ | 抖动层 |
| 8 | 性能门禁抖动 | 偶发 | 放宽阈值 / 豁免 | _待填_ | C.4 挂账 |
| 9 | Worktree 符号链接 | 每次必红 | **豁免** | _待填_ | 平台限制 |
| 10 | Worktree 路径归一化 | 推断 | 可修 / 可豁免 | _待填_ | 看 1-4 修完后剩几项 |

---

## 五、后续行动建议

### 5.1 立即行动（若拍板修）

1. **创建 TASK-CI.1a**（P0 真 bug）：
   - freshnessMap 分隔符
   - Merger 冲突用例
   - 估算：1.5 天
   - 验证：跑 Windows CI 绿色项 ≥ 20

2. **创建 TASK-CI.1b**（P1 真 bug + 残留核实）：
   - 合并逻辑 CRLF
   - 迁移路径拼接核实
   - 估算：1.5-2.5 天

3. **创建 TASK-CI.1c**（豁免清单）：
   - 统一用 `test.skipIf(process.platform === 'win32', '...')`
   - 估算：0.5 天
   - 文档：在测试文件头注释说明豁免原因

### 5.2 门禁收紧前置条件

**当前**：`continue-on-error: true`（不阻断合并）

**收紧条件**（需同时满足）：
1. CI.1a + CI.1b 修复完成
2. CI.1c 豁免落地
3. 连续 3 次 main push 的 Windows CI 绿色项 ≥ 85%
4. 剩余红色项全部为已豁免项

**收紧操作**：
- 删除 `.github/workflows/ci.yml` 三个 job 的 `continue-on-error` 行
- 更新 README「平台矩阵」段落

---

## 六、风险与限制

### 6.1 数据来源限制

- ❌ 未实际拉取最近 10 次 CI 日志（无 gh CLI）
- ✅ 基于 OP-33 历史记录（run 40821117113 基线 45 项）
- ✅ 基于已知挂账（C.4 watcher、freshnessMap、merger）
- ✅ 基于 CI 配置分析（.github/workflows/ci.yml）

**风险**：实际失败用例可能与推断有偏差

**缓解**：拍板后第一步应实际运行一次 Windows CI，获取完整失败清单

### 6.2 估算不确定性

- 所有估算基于推断，未实际调试
- 真实工时可能 ×1.5 - ×2
- 建议每个子任务预留 20% buffer

### 6.3 平台覆盖

- 本报告仅涵盖 **Windows** 适配
- macOS/Linux 已在门禁（P-137）
- 跨平台回归风险：修 Windows 时注意不破坏其他平台

---

## 七、附录

### A. 相关挂账索引

- **OP-33**：Windows 单测既有红（45 项/20 文件，稳定层 26 项）
- **OP-34**：macOS CI runner 不稳定（平台侧）
- **OP-35**：跨平台测试偶发抖动（已销项）
- **C.4 挂账**（completed §3.4t 推断）：freshnessMap 分隔符、watcher 性能门禁抖动
- **P-138**：CRLF 归一、path.sep、safeRmSync 退避重试（已销项）

### B. 参考文件

- `docs/ledger/consistency-audit.md` OP-33 条目
- `docs/ledger/README.md` DLV / DOC 挂账
- `.github/workflows/ci.yml` Windows job 配置
- `docs/specs/development-tasks-completed.md` §3.4t（B.2 完成口径，C.4 待查）

### C. 后续文档要求

若拍板修复：
1. 每个修复 PR 在 commit message 引用本报告
2. 在 `development-tasks-changelog.md` 追加 P-XXX 条目
3. 修完后更新 OP-33 状态为「部分销项 / 全部销项」
4. 在 README 更新平台矩阵状态

---

**报告完成时间**：2026-11-08  
**下一步**：等待 Tina 在§四填写决定，并拍板是否立卡
