# 术语表

> **地位**：给非技术用户看的一句话白话定义。权威含义以链接到的规格或 ADR 为准，本表不另造定义层。
> **谁能改**：走任务卡修订；新增词条必须带权威出处链接。

---

<a id="密封"></a>

## 密封

把已经整理好的方案冻成一份之后不能悄悄改的快照。你点「确认方案，开始规划」或「确认开工」时，就是在做这件事。

权威出处：[ADR-0018 意图到可签执行物](./adr/0018-intent-to-executable-seal.md)；总装位置见 [交付全链路 S2→Seal](./specs/delivery-lifecycle.md#2-七环主干)。

<a id="合同"></a>

## 合同

一次可以单独验收的工作单元：确认开工一次、验证一次、合入一次。大项目会被拆成多份合同，每份都要你单独点头。方案是用户看见的整件事，合同是系统里单独验收的一段。

权威出处：[ADR-0015 合同是交付单元](./adr/0015-contract-as-unit-of-delivery.md)；总装位置见 [交付全链路 §1](./specs/delivery-lifecycle.md#1-四级模型)。

<a id="卡片流"></a>

## 卡片流

中间方案页里从上往下排列的一组卡片（摘要、决议、改动范围与验收、演示、主按钮），用来给你看方案、让你拍板。它不是可以随便拖拽连线的白板。

权威出处：[ADR-0014](./adr/0014-three-agent-topology-open-supervisor.md) 的画布定型；界面说明见 [supervisor.md](./specs/supervisor.md) 中栏画布部分。

<a id="墓地"></a>

## 墓地

被否决或明确不做的方案存放处。进了墓地的做法不能悄悄拿回来再用。

权威出处：[工人墓地门禁](./specs/worker-graveyard-gate.md)；文档地图里的三条铁律见 [docs/README.md](./README.md)。

<a id="挂账"></a>

## 挂账

已经记下、但还没处理完的欠账或遗留问题。销账时要写明是在哪一次改动里处理的。

权威出处：[台账说明](./ledger/README.md)。

<a id="pab"></a>
<a id="PAB"></a>

## PAB

项目架构基线的简称。是这份项目在拆成具体工作之前，先记下的架构约束（能改哪里、边界在哪、依据是什么）。整理项目地图时会用到它，但它本身不是开工许可。

权威出处：[ADR-0019 项目架构基线](./adr/0019-project-architecture-baseline.md)；实施口径见 [项目架构基线规格](./specs/project-architecture-baseline.md)。

<a id="designnote"></a>
<a id="DesignNote"></a>

## DesignNote

某一份合同怎么改的设计说明，包括要跑哪些检查。写代码的助手按它施工，你通常不用读正文。

权威出处：[技术方案与系统知识库规格](./specs/technical-design-and-knowledge.md)。

<a id="evidencebundle"></a>
<a id="EvidenceBundle"></a>

## EvidenceBundle

系统把这次检查实际跑过的命令、退出码和结论打成的一包证据。用来证明「做到了还是没做到」，不能只靠口头描述。

权威出处：[证据与验收标准](./specs/evidence-and-acceptance-criteria.md)；验证分层见 [验证策略规格](./specs/verification-strategy.md)。

<a id="任务卡"></a>

## 任务卡

交给施工助手的一份书面指令：改什么、不改什么、怎样算完成。开工前要满足就绪标准，未就绪不能开工。

权威出处：[任务卡就绪标准](./specs/task-card-standard.md)。

<a id="daemon"></a>
<a id="Daemon"></a>

## Daemon

在你这台电脑上跑的本机管家。它负责生成合同、跑真实检查命令，并根据退出码判断能不能合入。模型不能直接改这个结论。

权威出处：[确定性验证门禁 ADR-0005](./adr/0005-deterministic-verification-gate.md)；运行时契约见 [runtime-contract-and-safety.md](./specs/runtime-contract-and-safety.md)。

<a id="试玩"></a>

## 试玩

你亲自在真实预览里点一点、看一看，确认是不是你要的结果。系统可以引导，但不能替你宣布「验收通过」。

权威出处：[验证策略规格](./specs/verification-strategy.md) 的 V4 试玩；判定细则见 [试玩自查](./specs/playtest-self-check.md)。

<a id="北极星场景"></a>

## 北极星场景

目标是：你只提供原网站网址和登录信息，自己不参与任何技术决策，就能得到一个一模一样的网站。见 `scheme.md` 的 goal-2。**当前做不到**。

权威出处：[scheme.md 目标 goal-2](./scheme.md)。

<a id="信任档"></a>

## 信任档

签字确认前你选的一档「这次确认有多严」：标准档（默认）出示对照面；重确认档还要逐项勾选；轻确认档可以不把对照面当作默认步骤，但机械回链不降级。选择会写入方案快照。

权威出处：[supervisor.md 密封前原话回链](./specs/supervisor.md)（`trust_tier`）；业主步骤见 [操作规程](./runbooks/owner-confirm-and-playtest.md)。

<a id="对照面"></a>

## 对照面

签字前用来核对自己说过的事是否都在方案里有着落的界面：已覆盖与未覆盖应分开标明，未覆盖不得被悄悄跳过。

权威出处：[supervisor.md 密封前原话回链](./specs/supervisor.md)；判分见 [试玩自查 §0.1 第 2 步](./specs/playtest-self-check.md)；业主步骤见 [操作规程](./runbooks/owner-confirm-and-playtest.md)。
