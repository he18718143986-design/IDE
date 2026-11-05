import {
  AlertTriangle,
  FileCode2,
  ListChecks,
  Network,
  ShieldCheck,
} from "lucide-react";

/**
 * Supervisor Tab（中央阅读区的独立页面）。
 *
 * 定位：不是"把技术词换成白话的聊天窗"，而是**高级工程师视角的审阅页**：
 * 项目概览 → 当前需求与方案 → 影响范围与保护状态 → 验证计划 → 需要你决定的事。
 *
 * 硬约束（本轮）：**只渲染已有字段**。合同里没有的（健康度、成熟度、风险分、
 * 测试通过率）一律不造；没有后端行为的按钮一律不画。所有数据来自
 * `SoftwareContract` / `ProtectionStateView` / `AdmissionView` 三个真实结构。
 */
export interface SupervisorContractView {
  id: string;
  title: string;
  description: string;
  state: string;
  approval: string;
  acceptance: string[];
  writable: string[];
  forbidden: string[];
  commands: Array<{ alias: string; argv: string }>;
  /** 白话理由：来自 `supervisor_metadata.maturity_assessment.rationale`，原样透传 */
  rationale: string[];
  /** 未决问题：G-11 零丢失，不去重、不截断 */
  unresolved: string[];
  /** 草案尚未提交给 Daemon（只存在于本次会话内存中，未落盘） */
  isDraft?: boolean;
  revision?: number;
}

export interface SupervisorProtectionView {
  mode: string;
  entries: number;
  checkpoint: string | null;
}

export interface SupervisorAdmissionView {
  decision: string;
  reason?: string | null;
  cardId?: string | null;
}

export interface SupervisorTabProps {
  repoName: string;
  repoPath: string;
  baseBranch: string;
  contractCount: number;
  contract: SupervisorContractView | null;
  protection: SupervisorProtectionView;
  admission: SupervisorAdmissionView | null;
  busy?: boolean;
  /**
   * 架构总览插槽：由页面注入真实依赖拓扑（cytoscape 画布 + 圈选建需求）。
   * 之所以用插槽而不是在这里取数：节点/边、筛选、圈选状态都归页面持有，
   * 这里只负责在宽屏下给它一整段位置。
   */
  architecture?: React.ReactNode;
  /**
   * TASK-C.10f：本轮「规范与资产」（需求 / 合同 / Demo）。
   * 审阅页是 Supervisor 产物的归宿；不再塞资源管理器。
   */
  specsSection?: React.ReactNode;
  /**
   * C.10f 漏接线修复：历史「需求（合同）」列表原塞在左栏 leftExtra。
   * 迁入项目审阅，资源管理器只留纯文件树。
   */
  requirementList?: React.ReactNode;
  onApprove?: (() => void) | undefined;
  onDeny?: (() => void) | undefined;
  onOpenConsole: () => void;
}

function Section({
  title,
  icon,
  testId,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <section
      data-testid={testId}
      className="rounded-lg border border-border bg-card p-3"
    >
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        {icon}
        {title}
      </h3>
      <div className="space-y-1.5 text-xs leading-relaxed">{children}</div>
    </section>
  );
}

function Pairs({ pairs }: { pairs: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1">
      {pairs.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="opacity-60">{k}</dt>
          <dd className="break-all">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SupervisorTab({
  repoName,
  repoPath,
  baseBranch,
  contractCount,
  contract,
  protection,
  admission,
  busy = false,
  architecture,
  specsSection,
  requirementList,
  onApprove,
  onDeny,
  onOpenConsole,
}: SupervisorTabProps) {
  const needsDecision = admission?.decision === "NEEDS_APPROVAL";

  return (
    <div
      data-testid="supervisor-tab"
      className="mx-auto max-w-5xl space-y-3 p-4 text-sm"
    >
      <header className="space-y-1">
        <h2 className="text-base font-semibold">项目全景</h2>
        <p className="text-xs opacity-70">
          C.16：日常从「合同操作台」左侧选需求干活；本页是架构 / 保护 /
          准入的深页， 不再占 ActivityBar
          第二扇门。只呈现合同、保护清单与依赖拓扑里已有的字段。
        </p>
      </header>

      <Section
        title="项目概览"
        icon={<FileCode2 className="h-4 w-4" />}
        testId="supervisor-project"
      >
        <Pairs
          pairs={[
            ["仓库", repoName],
            ["路径", repoPath],
            ["当前分支", baseBranch],
            ["保护模式", `${protection.mode}（已锁 ${protection.entries} 条）`],
            [
              "本轮快照",
              protection.checkpoint ? "存在（可整轮撤销）" : "无可撤销快照",
            ],
            ["合同数", String(contractCount)],
          ]}
        />
      </Section>

      {requirementList ? (
        <Section
          title="需求列表"
          icon={<ListChecks className="h-4 w-4" />}
          testId="supervisor-requirement-list"
        >
          <p className="opacity-70">
            点一项打开合同操作台跟进。C.16
            起日常列表在操作台左侧栏；此处仅作深页回显。
          </p>
          <div className="pt-1">{requirementList}</div>
        </Section>
      ) : null}

      {specsSection ? (
        <Section
          title="本轮依据（规范与资产）"
          icon={<FileCode2 className="h-4 w-4" />}
          testId="supervisor-specs"
        >
          <p className="opacity-70">
            需求文档、执行合同与 Demo
            原型跟合同能力走；日常在操作台左侧「规范与资产」。
          </p>
          <div className="pt-1">{specsSection}</div>
        </Section>
      ) : null}

      {/*
        架构总览：原来挤在左侧窄栏（260px）里，图和筛选都变形；
        现在挪到这个中央宽屏 Tab，一整段宽度铺开来看。
      */}
      <Section
        title="项目全景解读 · 架构总览"
        icon={<Network className="h-4 w-4" />}
        testId="supervisor-architecture"
      >
        {architecture ?? (
          <p className="opacity-70">
            页面还没有注入依赖拓扑数据。连上 Daemon 后可在这里加载架构图。
          </p>
        )}
      </Section>

      <Section
        title="当前需求与方案"
        icon={<ListChecks className="h-4 w-4" />}
        testId="supervisor-requirement"
      >
        {contract ? (
          <>
            {contract.isDraft ? (
              <p
                data-testid="supervisor-draft-badge"
                className="rounded border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-800"
              >
                这是刚生成、<strong>尚未提交</strong>
                的草案：只存在于本次会话内存里，仓库里还没有这份合同。
              </p>
            ) : null}
            <Pairs
              pairs={[
                ["标题", contract.title],
                ["生命周期", contract.state],
                ["审批状态", contract.approval],
                ["合同 ID", contract.id],
              ]}
            />
            <p className="whitespace-pre-wrap pt-1">{contract.description}</p>
            {contract.rationale.length > 0 ? (
              <div className="pt-1" data-testid="supervisor-rationale">
                <p className="opacity-60">
                  为什么这样圈范围（白话理由 · {contract.rationale.length} 条）
                </p>
                <ul className="list-disc pl-5">
                  {contract.rationale.map((line, index) => (
                    <li
                      key={`${index}-${line}`}
                      data-testid="supervisor-rationale-item"
                    >
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="pt-1" data-testid="supervisor-unresolved">
              <p className="opacity-60">
                还没说清的地方（未决问题 · {contract.unresolved.length} 条）
              </p>
              {contract.unresolved.length > 0 ? (
                <ul className="list-disc pl-5">
                  {contract.unresolved.map((question, index) => (
                    <li
                      key={`${index}-${question}`}
                      data-testid="supervisor-unresolved-item"
                    >
                      {question}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="opacity-70">
                  没有未决问题——L0
                  规则没有发现需要澄清的地方（不代表一定没风险）。
                </p>
              )}
            </div>
            {contract.acceptance.length > 0 ? (
              <div className="pt-1">
                <p className="opacity-60">验收判据</p>
                <ul className="list-disc pl-5">
                  {contract.acceptance.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : (
          <p className="opacity-70">
            还没有选中合同，也还没有本次会话的草案。点右上角「新建需求」，用一句话说清要改什么，
            Supervisor
            会先出一份带白话理由与未决问题的草案给你审——它不会替你批准或开工。
          </p>
        )}
      </Section>

      <Section
        title="涉及范围与保护状态"
        icon={<ShieldCheck className="h-4 w-4" />}
        testId="supervisor-scope"
      >
        {contract ? (
          <>
            <div>
              <p className="opacity-60">可写范围（合同授权）</p>
              <ul className="list-disc pl-5">
                {contract.writable.map((p) => (
                  <li key={p}>
                    <code>{p}</code>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="opacity-60">严格禁区</p>
              {contract.forbidden.length > 0 ? (
                <ul className="list-disc pl-5">
                  {contract.forbidden.map((p) => (
                    <li key={p}>
                      <code>{p}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="opacity-70">
                  该合同未登记严格禁区（不放宽可写范围，只是没写死名单）。
                </p>
              )}
            </div>
            <p className="opacity-60">
              保护清单命中：
              {admission?.decision === "NEEDS_APPROVAL"
                ? "有（见下一节）"
                : "无交集记录"}
            </p>
          </>
        ) : (
          <p className="opacity-70">
            选中合同后，这里显示该合同的可写范围与禁区。
          </p>
        )}
      </Section>

      <Section
        title="验证计划"
        icon={<ListChecks className="h-4 w-4" />}
        testId="supervisor-verification"
      >
        {contract && contract.commands.length > 0 ? (
          <ul className="space-y-1">
            {contract.commands.map((c) => (
              <li key={c.alias} className="flex items-baseline gap-2">
                <span className="rounded bg-muted px-1 text-[10px]">
                  {c.alias}
                </span>
                <code className="break-all">{c.argv}</code>
              </li>
            ))}
          </ul>
        ) : contract ? (
          <p className="opacity-70">
            该合同未登记验证命令（不阻塞，但门禁只能凭其它证据判定）。
          </p>
        ) : (
          <p className="opacity-70">
            选中合同后，这里显示它在 Worktree 内要跑的命令。
          </p>
        )}
      </Section>

      <Section
        title="需要你决定"
        icon={<AlertTriangle className="h-4 w-4" />}
        testId="supervisor-decisions"
      >
        {needsDecision ? (
          <>
            <p>
              准入裁决：<strong>NEEDS_APPROVAL</strong>
              {admission?.reason ? ` —— ${admission.reason}` : null}
            </p>
            {admission?.cardId ? (
              <p className="opacity-60">待审批卡：{admission.cardId}</p>
            ) : null}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                data-testid="supervisor-approve"
                disabled={busy || !onApprove}
                onClick={onApprove}
                className="rounded bg-primary px-2.5 py-1 text-xs text-primary-foreground disabled:opacity-50"
              >
                同意并开工
              </button>
              <button
                type="button"
                data-testid="supervisor-deny"
                disabled={busy || !onDeny}
                onClick={onDeny}
                className="rounded border px-2.5 py-1 text-xs disabled:opacity-50"
              >
                拒绝
              </button>
            </div>
            <p className="opacity-60">
              同意只覆盖这张卡上的范围；超出范围会再弹一张补充卡。
            </p>
          </>
        ) : (
          <p className="opacity-70">当前没有待你决策的准入卡。</p>
        )}
        <button
          type="button"
          data-testid="supervisor-open-console"
          onClick={onOpenConsole}
          className="mt-1 rounded border px-2.5 py-1 text-xs hover:bg-accent"
        >
          回到合同操作台
        </button>
      </Section>
    </div>
  );
}
