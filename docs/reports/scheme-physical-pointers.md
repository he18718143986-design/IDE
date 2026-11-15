# scheme.md 迁出的物理指针快照

> **迁出**：2026-11-14（TASK-J.26）。正文从 [`../scheme.md`](../scheme.md) 迁入，原位只留指针、不保留重复正文。
> **定位**：时点快照与复用样板，**不是**现行施工依据，也不代表今日 tip。现行基线以任务卡枢纽「当前工程物理起点」为准。
> **其余迁出正文**（已落盘裁决与非 L0 方案正文）见 [`../ledger/scheme-settled-decisions.md`](../ledger/scheme-settled-decisions.md)。

---

## 12. 本次文档治理的改动范围与验收（`ScopePlan` 示范）

> 用 §15 的白话五块，示范 Supervisor 在「确认开工」前要给用户看的东西。对象是本次文档治理本身。

- **会改动的地方**：`docs/` 下的索引、本文、`ledger/` 目录；`specs/` 与 `rfc/` 只加取代说明与修正失效链接，不改条款；一处代码注释的失效链接。
- **这次不会碰**：任何产品代码行为；任务卡状态；ADR 条款；`specs/` 正文条款。
- **需要你点头**：§6 的四项推荐、§7 的七张冲突卡、§8 的四个待澄清问题。审阅本 PR 即是一次「确认开工」语义；合入不等于这些项已拍板。
- **怎么算做完**：`docs/` 内所有相对链接可解析（脚本校验）；§0 每句原话都是用户消息的逐字子串（脚本校验）；`npm run lint` 与 `npm run typecheck` 不因本次改动变红。
- **预计规模**：新增 2 份文档，移动 3 份文件，约 20 份文档加注或修链接。

**第三轮（2026-10-30，交付全链路）的改动范围与验收**：

- **会改动的地方**：新增审计报告 1 份、规格 6 份（总装图、项目分解、技术方案与知识库、验证策略、发布与运维、卡就绪标准）、ADR-0015～0017、任务卡模板 1 份；任务卡文件新增 §3.4d（L.1～L.17）、矩阵行、DAG 边，并给 J.3 / J.5 / J.6 / J.7 / J.10 加「ADR-0014 修订」块；supervisor 与 intent-compiler 加修订指针；本文追加 q17～q21 与相关条目。
- **这次不会碰**：任何产品代码；任何既有任务卡的状态；ADR-0001～0014 正文。
- **需要你点头**：ADR-0015～0017（合入即生效）；dec-8（SA-1 敏感项授权方式）；OQ-REL-1（保险库后端；**L.14 已按推荐值 A/B 落地**，改判只换后端）。
- **怎么算做完**：链接检查 0 断链；原话逐字核对；DAG 无环；新文档引用的现有代码路径全部存在；`npm run lint` / `npm run typecheck` 不变红。
- **预计规模**：新增 11 份文件，修改约 8 份文件。

---

## 13. 复用本样板

给任何项目写方案时，按本文的节序填：原话 → 目标 → 不做 → 模块 → 流程 → 实体 → 决定 → 分歧 → 待澄清 → 验收 → 墓地 → 落差 → 改动范围。三条纪律：

1. **只有用户说过的才写 `user_said`**，并附逐字原话；Agent 的推断一律 `ai_inferred`，等用户确认。
2. **分歧不替用户选**：`chosen_id` 留空，把选项与证据摆出来。
3. **否决的进墓地**：写清谁否决、为什么，防止下一轮悄悄复活。

传统模板的对应关系见 [`templates/00-filling-guide.md`](../templates/00-filling-guide.md) 与 [`specs/supervisor.md`](../specs/supervisor.md) §14.11 小节 3（`goals` ↔ REQ，`acceptance` ↔ AC，`decisions` ↔ ADR，证据 ↔ EVID）。

> **P-131 现行物理指针（2026-11-03）**：main@`b98e463d8932ecd111b35b1dea9de624df237ccb`（PR #101，W.9b squash；其下 #100 为 P-130 文档回写）。W.9a/W.9b COMPLETED；Sprint 首要为 W.9c（READY，待 Tina 单卡授权）。dispatchable 语义已扩至宿主可用且工厂齐备的 `SANDBOX_ENFORCED`；此为共享门禁口径扩展，不等于 Cursor 容器镜像 / 运行协议已实证。挂账见 completed §3.4o。

> **P-132 立卡物理指针（2026-11-03 · 保留作溯源）**：main@`e3262c924fcdf038817ec05cdf36f28ea20861c1`（PR #102，P-131 docs 回写；其下 #101 `b98e463` 为 W.9b 代码）。Sprint 首要**仍为** W.9c（READY，待 Tina 单卡授权）。**并行挂账立卡** `TASK-L.17c` `[NEW_TASK]`（中栏方案审阅页嵌入试玩认可提交 · S/M · **不抢**首要、开工须另授）；acc-6 / gap-11 端到端 UI 仍 ⏳，**未宣称闭环**。

> **P-133 现行物理指针（2026-11-03）**：main@`06661befb9915c94b349a25b6f124ebb0f756c90`（PR #104，L.17c 代码 squash；其下 #103 为 P-132 立卡 docs）。`TASK-L.17c` → `[COMPLETED]`；中栏 UI 已挂（CompareView + 原话「认可完成」+ 读侧 status）。**三项挂账仍挂**：snapshots 拉数；会话原话候选未灌 index；真机 `check playtest` 执行债。Sprint 首要**仍为** W.9c（READY，待 Tina 单卡授权）。acc-6 / gap-11：**UI 接线已合入，验收债仍 ⏳**；**不宣称**端到端闭环。


> **P-134 现行物理指针（2026-11-03）**：文档回写基线 main@`10bc1d3b9b0ca23d65e26f9be710b994e443ceac`（#108 tip 同步；W.9c 代码由 #107/`d3397a644603d8b49a96d765456031cba4254981` 合入其前一 tip）。W.9a/b/c 均 COMPLETED；W.9 母卡实质闭合，active `[SPLIT]` 仅保留拆分史。W.9b 四项挂账仍未销项，详见 completed §3.4q；不宣称端到端闭环。Sprint 首要为「在队清零」，下一张卡待 Tina 指定。

> **P-135 现行物理指针（2026-11-03）**：文档回写基线 `main@2559f5c30f413d4b5b13757e8dae2675631d892b`（#113 squash）。清扫成果已按无卡基建修正登记；挂账为手工植入路径审计语义及 Windows CRLF / `path.sep` / 临时目录 `EBUSY` 重试；completed §3.4q 重复锚点清理。Sprint 首要仍为「在队清零」；本 PR 合入后物理指针再更新为合入 SHA。

> **P-136 现行物理指针（2026-11-03）**：main@`de50d38de3089dc17d601627a35b4096609fb706`（#114 为 P-135 docs 回写 squash；其下 #113 `2559f5c3` 为无卡基建清扫代码 squash）。P-135 清扫成果（typecheck 54→0、Unit tests 7 项红销项、假漂移与续租修复）与两项挂账现行有效；completed §3.4q 唯一锚点已落定。Sprint 首要仍为「在队清零」，下一张卡待 Tina 指定。
> **P-137 现行物理指针（2026-11-03）**：main@`08e1a60258f9d7225cf718ab99045711a0150bf8`（#115 为 P-136 docs 回写 squash；其下 #114 `de50d38` 为 P-135 docs 回写 squash，#113 `2559f5c3` 为无卡基建清扫代码 squash）。GitHub Branch Ruleset `main`（ID 26435584）已激活启用 required checks，门禁由惯例升格为物理强制。P-135 清扫成果与两项挂账现行有效；Sprint 首要仍为「在队清零」，下一张卡待 Tina 指定。

> **P-138 现行物理指针（2026-11-03）**：main@`96225dfdafbba04b813da63c8e524cd22bbcc087`（[#118](https://github.com/he18718143986-design/IDE/pull/118) 为 OP-33~38 挂账清扫代码 squash；其下 #117 `41029dc` 为 CA-06 CI 工作流，#116 `e695649` 为 P-137 门禁强制化文档注记）。完成 OP-33（部分销项 / 平台侧限制改定性）、OP-34（改定性平台侧持续观察）、OP-35①、OP-35②、OP-36、OP-37、OP-38 逐条对账销项，新增两条边界挂账；Sprint 首要仍为「在队清零」，下一张卡待 Tina 指定。

> **P-139 现行物理指针（2026-11-03）**：main@`c5de2f6dac622af99b0b7e3a1c566a62b26ccefa`（[#119](https://github.com/he18718143986-design/IDE/pull/119) 为 P-138 OP-33～38 台账回写 squash；其下 #118 `96225df` 为清扫代码 squash）。P-138 对账结果与两条新增边界挂账继续有效；Sprint 首要仍为「在队清零」，下一张卡待 Tina 指定。

> **P-141 现行物理指针（2026-11-03）**：main@`49c7848ba8db72073e1ec5e2b3acacc7667c6a9e`（[#121](https://github.com/he18718143986-design/IDE/pull/121)，P-140 v0.2 范围 RFC squash）。D-1～D-6 已拍板：B.1/B.2/C.4 激活待 DoR 重写；S.3/D.1e 维持 DEFERRED。Sprint 首要为 TASK-B.1 DoR 重写先行；激活不等于开工，须 Tina 单卡授权。

> **P-143 现行物理指针（2026-11-04）**：main@`9c177e92992566522929efecd9c1435244a17491`（[#124](https://github.com/he18718143986-design/IDE/pull/124) B.1 代码 squash；其下 #123 `ad19bcd3` 为 P-142 DoR 重写 squash，#122 `2cbd91c` 为 P-141 拍板）。`TASK-B.1` 已 `[COMPLETED]` 并迁入 completed §3.4r；实测性能达标，交付契约兼容超集，登记三项后续挂账（CI GC 暴露、isUnderScanRoot 前缀收敛、IGNORED_DIRS 过滤）及一条已核销注记（addModule 覆盖式语义）。物理指针链推进两格至 `9c177e9`。Sprint 首要转为 `TASK-B.2`（待 DoR 重写，须经存量对账与 Tina 单卡授权后施工）。不新增 OP 号。

> **P-144 现行物理指针（2026-11-04）**：main@`5b0a8cd08f1bca54930d6bf43db0ea78f0d55e23`（[#125](https://github.com/he18718143986-design/IDE/pull/125) P-143 TASK-B.1 回写 squash；其下 #124 `9c177e9` 为 B.1 代码 squash）。`TASK-B.2` 已按 R-1～R-12 与存量对账矩阵完成卡正文重写，状态保持 `[READY · 待 DoR 重写]`，施工授权待 Tina 单卡拍板。物理指针链推进至 `5b0a8cd0`。不新增 OP 号。

> **P-145 现行物理指针（2026-11-04）**：main@`b1aa44f320a33f0c61197f63550e8c0f173a3a82`（[#128](https://github.com/he18718143986-design/IDE/pull/128) TASK-B.2 代码 squash；其下 #125 `5b0a8cd0` 为 P-143 回写，#124 `9c177e9` 为 B.1 代码 squash）。`TASK-B.2` 已 `[COMPLETED]` 并迁入 completed §3.4s；B.1 挂账② 已销项。Sprint 首要转为 `TASK-C.4`（待 DoR 重写；硬依赖 B.1、软依赖 B.2 均已满足；激活 ≠ 开工，须 Tina 单卡授权）。不新增 OP 号。
> **P-147 现行物理指针（2026-11-04）**：main@`78ae73b2924e4854b4c4c5b7e6dce157ccdd1896`（[#129](https://github.com/he18718143986-design/IDE/pull/129) P-145 TASK-B.2 回写 squash；其下 #128 `b1aa44f` 为 B.2 代码 squash）。`TASK-C.4` 已按 R-1～R-12 与存量对账矩阵完成卡正文重写，状态保持 `[READY · 待 DoR 重写]`，施工授权待 Tina 单卡拍板。物理指针链推进至 `78ae73b`。不新增 OP 号。
> **P-148 现行物理指针（2026-11-05）**：main@`993e3e9c62bf86d11ce1f9b684a5ac276a2ee5eb`（[#138](https://github.com/he18718143986-design/IDE/pull/138) TASK-C.4 代码 squash；其下 #137 `a8481bc` 为 C.4 DoR 重写，#136 `78ae73b` 为 P-146 门禁③回写）。
> **P-149 立卡物理指针（2026-11-07 · 保留作溯源）**：立卡基线 main@`b03c97f`（[#143](https://github.com/he18718143986-design/IDE/pull/143)；其下 P-148 代码 tip #138/`993e3e9`）。新增 `TASK-L.17d` / `L.17e` / `L.17f` `[NEW_TASK]` 销 L.17c 三项挂账；Sprint 首要 → **L.17d**（序 d→e→f）。acc-6 / gap-11：**挂账已立卡、未销项、未开工**；**不宣称**端到端闭环；D.1e / S.3 维持 DEFERRED；不碰 W.9。
> **P-150 现行物理指针（2026-11-07 · 保留作溯源）**：main@`e2b8dd35cbcde6a750881fe435e115c11fe16cac`（[#145](https://github.com/he18718143986-design/IDE/pull/145) L.17d 代码 squash；其下 #144/`a147168` 为 P-149 立卡）。`TASK-L.17d` → `[COMPLETED]`（见 completed §3.4u）；**挂账①销项**；Sprint 首要 → **L.17e**（序 e→f）。acc-6 / gap-11：snapshots 拉数已合入，挂账②/③仍立卡未销；**不宣称**端到端闭环；D.1e / S.3 维持 DEFERRED；不碰 W.9。
> **P-151 现行物理指针（2026-11-07 · 保留作溯源）**：main@`aeedecd11e147c39a6685f2f5e628a5fc6170155`（[#147](https://github.com/he18718143986-design/IDE/pull/147) L.17e 代码 squash；其下 #146/`e46ee5a` 为 P-150 回写）。`TASK-L.17e` → `[COMPLETED]`（见 completed §3.4v）；**挂账②销项**；Sprint 首要 → **L.17f**。acc-6 / gap-11：会话原话候选已合入，挂账③仍立卡未销；**不宣称**端到端闭环；D.1e / S.3 维持 DEFERRED；不碰 W.9。
> **P-152 现行物理指针（2026-11-07 · 保留作溯源）**：main@`86da4950c609ca07029d86e06c094f2bc044ce62`（[#149](https://github.com/he18718143986-design/IDE/pull/149) L.17f 代码 squash；其下 #148/`e486345` 为 P-151 回写）。`TASK-L.17f` → `[COMPLETED]`（见 completed §3.4w）；**挂账③销项**（L.17c 三项挂账均已销）；Sprint 首要当时 → **在队清零**（下一挂账面为 W.9c §3.4q 四项未销挂账）。acc-6 / gap-11：门禁执行旁路已合入；**不宣称**端到端闭环；D.1e / S.3 维持 DEFERRED。
> **P-153 现行物理指针（2026-11-07 · 保留作溯源）**：main@`1ac8dfa9dad2eeaa6dfe03bb9f4ea0c480a9dc53`（[#150](https://github.com/he18718143986-design/IDE/pull/150) P-152 docs 回写；其下 #149/`86da495` 为 L.17f 代码）。Tina 授权立卡 `TASK-W.9d`/`W.9e`/`W.9f`/`W.9g`（均 `[NEW_TASK]`）兑现 W.9c §3.4q 四项挂账；Sprint 首要当时 → **W.9d**（序 d→e→f→g）。**立卡≠销项、未开工**；**不宣称**端到端闭环；D.1e / S.3 维持 DEFERRED；不碰 macOS CI / CA-06。
> **P-154 现行物理指针（2026-11-07 · 保留作溯源）**：main@`f5577de26bf6a34d8377039eb26d71ef6bf506a8`（[#152](https://github.com/he18718143986-design/IDE/pull/152) W.9d 代码 squash；其下 #151/`2115d5d` 为 P-153 立卡）。`TASK-W.9d` → `[COMPLETED]`（见 completed §3.4x）；**挂账①销项**；Sprint 首要当时 → **W.9e**（序 e→f→g）。挂账②/③/④当时仍立卡未销；**不宣称**端到端闭环；D.1e / S.3 维持 DEFERRED；不碰 macOS CI / CA-06。
> **P-155 现行物理指针（2026-11-07 · 保留作溯源）**：main@`5d3d55bb13383cb30265f80df4dd489120bbf9d9`（[#154](https://github.com/he18718143986-design/IDE/pull/154) W.9e 代码 squash；其下 #153/`f4b4b17` 为 P-154 docs、#152/`f5577de` 为 W.9d 代码）。`TASK-W.9e` → `[COMPLETED]`（见 completed §3.4y）；**挂账②销项**（①②已销）；Sprint 首要当时 → **W.9f**（序 f→g）。挂账③/④当时仍立卡未销；**不宣称**端到端闭环；D.1e / S.3 维持 DEFERRED；不碰 macOS CI / CA-06。
> **P-156 现行物理指针（2026-11-07 · 保留作溯源）**：main@`b92accc1194c1b4b2417f63ad2baccbcce85355b`（[#156](https://github.com/he18718143986-design/IDE/pull/156) W.9f 代码 squash；其下 #155/`b7bba0f` 为 P-155 docs、#154/`5d3d55b` 为 W.9e 代码）。`TASK-W.9f` → `[COMPLETED]`（见 completed §3.4z）；**挂账③销项**（①②③已销）；Sprint 首要当时 → **W.9g**。挂账④当时仍立卡未销；**不宣称**端到端闭环 / 绝对不可读；D.1e / S.3 维持 DEFERRED；不碰 macOS CI / CA-06。
> **P-157 现行物理指针（2026-11-07 · 保留作溯源）**：main@`691b8b874d0af5f8c6f0e7999f7b01871962d284`（[#158](https://github.com/he18718143986-design/IDE/pull/158) W.9g 代码 squash；其下 #157/`f11da32` 为 P-156 docs、#156/`b92accc` 为 W.9f 代码）。`TASK-W.9g` → `[COMPLETED]`（见 completed §3.4aa）；**挂账④销项**（①～④均已销）；④口径=钉协议+fail-closed（`empirically_verified=false`），**≠ Cursor 已受控 / 可派工**；真跑容器仍待 KEY+Docker。Sprint 首要当时 → **在队清零**（下一挂账面为 macOS CI → CA-06）。**不宣称**端到端闭环 / Cursor 已受控；D.1e / S.3 维持 DEFERRED。
> **P-158 现行物理指针（2026-11-07 · 保留作溯源）**：main@`aac69f5e620da6bd62d42a2808c302b1d85cf987`（[#159](https://github.com/he18718143986-design/IDE/pull/159) P-157 docs 回写；其下 #158/`691b8b8` 为 W.9g 代码）。Tina 授权立卡 `TASK-CI.1` 当时 `[NEW_TASK]`；Sprint 首要当时 → **TASK-CI.1**。**立卡≠销项、未开工**；不销 OP-34；D.1e / S.3 维持 DEFERRED。
> **P-159 现行物理指针（2026-11-07 · 保留作溯源）**：main@`bf971d5b23802aa25ce5ca17fb0f0fe9e577f7b3`（[#161](https://github.com/he18718143986-design/IDE/pull/161) TASK-CI.1 代码 squash；其下 #160/`3766d28` 为 P-158 立卡 docs、#159/`aac69f5` 为 P-157 docs）。`TASK-CI.1` → `[COMPLETED]`（见 completed §3.4ab）；macOS CI hang 已用 CI.1 **抗抖动门禁**销（门禁 4 ≤150ms；run 42369070606）；正确性断言未放宽；零改 `daemon/arch/*`。**诚实口径**：抗抖动门禁，**不**宣称永久全绿；**不**销 OP-34；不碰 CA-06。Sprint 首要当时 → **在队清零**（下一挂账面 → **CA-06 文档债**）。**不宣称**端到端闭环；D.1e / S.3 维持 DEFERRED。
> **P-160 现行物理指针（2026-11-07 · 保留作溯源）**：main@`c8ebbc3c2b3ca4784a120f25b3421643c5b79a2a`（[#162](https://github.com/he18718143986-design/IDE/pull/162) P-159 docs 回写；其下 #161/`bf971d5` 为 TASK-CI.1 代码）。**CA-06 文档债对齐**：卡账/矩阵已与代码 `CURSOR_AGENT_VERIFIED_ON` 对齐；§3.4m 挂账 1 销项；挂账清扫序收完。**档位不变** `UNCONTROLLED_EXTERNAL`；`verified_on` ≠ 已受控 / 可派工；**不**宣称 Cursor 已受控。Sprint 首要当时 → **在队清零**（下一张待 Tina 拍板）。**不宣称**端到端闭环；不销 OP-34；D.1e / S.3 维持 DEFERRED。
> **P-161 现行物理指针（2026-11-07 · 保留作溯源）**：main@`29fc0addca9ba8d76345d3adef01106708403c7a`（[#163](https://github.com/he18718143986-design/IDE/pull/163) P-160 docs squash；其下 #162/`c8ebbc3` 为 P-159 docs）。Tina 授权立卡 `TASK-AUDITED.1`（`[NEW_TASK]` · AUDITED 退回待批受控边）；Sprint 首要 → **TASK-AUDITED.1**。**立卡≠销项、未开工**；实现另开 code PR；**不宣称**端到端闭环；不销 OP-34；D.1e / S.3 维持 DEFERRED；不发明产品方向。
> **P-162 现行物理指针（2026-11-07 · 保留作溯源）**：main@`b390254960104e53dae183db8b63ea0826690cb8`（[#165](https://github.com/he18718143986-design/IDE/pull/165) TASK-AUDITED.1 代码 squash；其下 #164/`9067d40` 为 P-161 立卡 docs、#163/`29fc0ad` 为 P-160 docs）。`TASK-AUDITED.1` → `[COMPLETED]`（见 completed §3.4ac）；库层受控边 `AUDITED→PENDING_APPROVAL` + Guard；规范 §11.3 / §9.1.1.1 对齐；生产路径暂无接线。Sprint 首要当时 → **在队清零**（下一张按 Tina 顺序 → **桌面形态 RFC（为 D.1e）**）。**不宣称**端到端闭环；不销 OP-34；D.1e / S.3 维持 DEFERRED。
> **P-163 现行物理指针（2026-11-07 · 保留作溯源）**：main@`8e5bad914576f11958d0ff3977bf6760b480819c`（[#167](https://github.com/he18718143986-design/IDE/pull/167) P-163 squash；立稿基线 #166/`c097522`）。新增桌面形态讨论稿 [`rfc/desktop-shell-form.md`](../rfc/desktop-shell-form.md)；开放问题 DS-1～DS-6 当时待拍。**`TASK-D.1e` 维持 DEFERRED**；立 RFC ≠ 激活 ≠ 开工。
> **P-164 现行物理指针（2026-11-07 · 保留作溯源）**：main@`4741d9844df8c946e713049a9de73dfa14d26a72`（[#168](https://github.com/he18718143986-design/IDE/pull/168) P-164 squash；基线 #167/`8e5bad9`）。Tina「按建议拍」：桌面形态 RFC **决议已落** [`rfc/desktop-shell-form.md`](../rfc/desktop-shell-form.md)（DS-1=A 本机助手；DS-2=助手+浏览器；DS-3=进 DoR 仍 ≠ 开工；DS-4=macOS；DS-5=open+最近列表保留；DS-6=先不排 DoR 窗口）。**`TASK-D.1e` 维持 DEFERRED**；立决议 ≠ 激活 ≠ 开工。
> **P-165 现行物理指针（2026-11-07 · 保留作溯源）**：main@`4741d9844df8c946e713049a9de73dfa14d26a72`（[#168](https://github.com/he18718143986-design/IDE/pull/168) P-164 squash；代码 tip 仍 #165/`b390254`）。Tina「你直接按顺序执行」：兑现 DS-3——**DoR 已入队**（RFC §10 + ledger「桌面形态 DoR 入队」+ Sprint tip）。**`TASK-D.1e` 维持 DEFERRED**（**未**改出 DEFERRED）；**入队 ≠ 激活 ≠ 立实现卡 ≠ 写代码**；DS-6 不排重写窗口；下一动仍待 Tina（是否立实现卡另拍）。不销 OP-34；不激活 S.3。
> **P-166 现行物理指针（2026-11-07 · 保留作溯源）**：main@`78febad9c2c324749f6c8ad0722d82b6c3ac6f2e`（[#169](https://github.com/he18718143986-design/IDE/pull/169) P-165 squash；代码 tip 仍 #165/`b390254`）。Tina「继续自动执行」：**立卡 `TASK-DS.1`**（macOS 本机助手 · 选文件夹 · RFC 切片）。**`TASK-D.1e` 维持 DEFERRED**（由 DS.1 承接；不激活）。Sprint 首要 → `TASK-DS.1`；立卡 ≠ 开工；零产品代码；不排 DoR 重写窗口；不销 OP-34；不激活 S.3。
> **P-167 现行物理指针（2026-11-08 · 保留作溯源）**：main@`1701cab0b9bb73f5858f229c0851a6047455b5ad`（[#171](https://github.com/he18718143986-design/IDE/pull/171) TASK-DS.1 代码 squash；立卡基线 #170/`3dde462` P-166）。`TASK-DS.1` → `[COMPLETED]`（见 completed §3.4ad）。**完成 ≠ D.1e**；`TASK-D.1e` 仍 DEFERRED。Sprint 首要当时 → **在队清零**。不宣称端到端闭环；不销 OP-34；不激活 S.3。
> **P-168 现行物理指针（2026-11-08 · 保留作溯源）**：main@`7f6ce540ce9e08b4945bdc5a6e0911231da094b4`（[#172](https://github.com/he18718143986-design/IDE/pull/172) P-167 docs squash；代码 tip 仍 #171/`1701cab`）。Tina「听你的建议」：**立卡 `TASK-DS.2`**（macOS 本机助手 · 新建空项目 · RFC 切片）。**`TASK-D.1e` 维持 DEFERRED**（由 DS.2 承接；不激活）。Sprint 首要 → `TASK-DS.2`；立卡 ≠ 开工；零产品代码；不排 DoR 重写窗口；不销 OP-34；不激活 S.3。
> **P-169 现行物理指针（2026-11-08 · 保留作溯源）**：main@`eacd1012438638ea58c3cfd292026aa6b1abd03c`（[#174](https://github.com/he18718143986-design/IDE/pull/174) TASK-DS.2 代码 squash；立卡基线 #173/`2a7c404` P-168）。`TASK-DS.2` → `[COMPLETED]`（见 completed §3.4ae）。**完成 ≠ D.1e**；`TASK-D.1e` 仍 DEFERRED。Sprint 首要 → **在队清零**。不宣称端到端闭环；不销 OP-34；不激活 S.3。
> **P-170 现行物理指针（2026-11-08 · 保留作溯源）**：main docs tip@`297c6ac`（[#175](https://github.com/he18718143986-design/IDE/pull/175) P-169 docs squash；代码 tip 仍 #174/`eacd1012438638ea58c3cfd292026aa6b1abd03c`）。Tina 授权立卡 `TASK-AUDITED.2`（`[NEW_TASK]` · AUDITED 退回待批生产接线）；Sprint 首要 → **TASK-AUDITED.2**。**立卡≠销项、未开工**；实现另开 code PR；**不宣称**端到端闭环；不销 OP-34；D.1e / S.3 维持 DEFERRED；不发明产品方向；不做 DS-6 DoR。
> **P-171 物理指针（2026-11-08 · 保留作溯源）**：main@`71684d482500e623bc469a96a8ed907642297192`（[#178](https://github.com/he18718143986-design/IDE/pull/178) TASK-AUDITED.2 代码 squash；立卡基线 #177/`7d9fc2b` P-170）。`TASK-AUDITED.2` → `[COMPLETED]`（见 completed §3.4af）。交付 orchestrator/API/ContractCard 退回待批。**诚实**：#178 合入时 `index.tsx` 父级未接；Tina 已授权 follow-up code PR（进行中）——非永久挂账、不另立产品卡。Sprint 首要 → **在队清零**。**不宣称**端到端闭环 / e2e；不销 OP-34；D.1e / S.3 维持 DEFERRED；不做 DS-6 DoR。
> **P-172 现行物理指针（2026-11-08）**：main@`49fe5920b802263e498ad11bc6ffe136c7e8125e`（[#180](https://github.com/he18718143986-design/IDE/pull/180) P-171 回写）。DS-6 开窗；`TASK-D.1e` DoR 重写已落（见 active §3.1）；**仍 `[DEFERRED → v0.2+]`**；DoR 重写 ≠ 激活 ≠ 可开工。Sprint 首要 → **在队清零**。不宣称端到端闭环；不销 OP-34；不激活 S.3。

