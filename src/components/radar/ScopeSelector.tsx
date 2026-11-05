import { useState, useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import type { RadarNode, RadarEdge } from "./RadarGraph";
import type { SupervisorContractView } from "../supervisor/SupervisorTab";
import { AlertTriangle, CheckCircle2, Layers, Trash2 } from "lucide-react";

export interface ScopeSelectorProps {
  selected: string[];
  onApply: (paths: string[]) => void;
  onClear: () => void;
  disabled?: boolean;
  contract?: SupervisorContractView | null;
  nodes?: RadarNode[];
  edges?: RadarEdge[];
  onApplyScope?: (paths: string[], mode: "draft" | "derive_revision") => void;
  drawerOpen?: boolean;
  onDrawerOpenChange?: (open: boolean) => void;
  onRemovePath?: (path: string) => void;
}

/**
 * TASK-C.4 Scope 圈选抽屉组件：
 * - 底部快速设为可写范围栏；
 * - 侧边展开抽屉：展示圈选模块列表、直接依赖与被依赖影响拓扑；
 * - 严格落实治理断言：草稿态支持原地更新；已批准合同修改 Scope 强制派生新 Revision 并提示重新审批。
 */
export function ScopeSelector({
  selected,
  onApply,
  onClear,
  disabled = false,
  contract,
  edges = [],
  onApplyScope,
  drawerOpen,
  onDrawerOpenChange,
  onRemovePath,
}: ScopeSelectorProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = drawerOpen !== undefined ? drawerOpen : internalOpen;
  const setOpen =
    onDrawerOpenChange !== undefined ? onDrawerOpenChange : setInternalOpen;

  // 依赖影响分析：计算圈选模块的出度（直接依赖）与入度（被依赖）
  const impactAnalysis = useMemo(() => {
    const selectedSet = new Set(selected);
    const outgoing = new Set<string>();
    const incoming = new Set<string>();

    for (const edge of edges) {
      if (selectedSet.has(edge.from) && !selectedSet.has(edge.to)) {
        outgoing.add(edge.to);
      }
      if (selectedSet.has(edge.to) && !selectedSet.has(edge.from)) {
        incoming.add(edge.from);
      }
    }

    return {
      outgoingCount: outgoing.size,
      incomingCount: incoming.size,
      affectedDependencies: Array.from(outgoing),
      affectedDependents: Array.from(incoming),
    };
  }, [selected, edges]);

  // 判断合同审批与生命周期状态
  const isApproved = Boolean(
    contract &&
    (contract.approval === "APPROVED" ||
      (contract.state && contract.state !== "DRAFT")),
  );

  const applyMode: "draft" | "derive_revision" = isApproved
    ? "derive_revision"
    : "draft";

  const handleApply = () => {
    if (onApplyScope) {
      onApplyScope(selected, applyMode);
    } else {
      onApply(selected);
    }
    setOpen(false);
  };

  return (
    <>
      <div className="flex items-center gap-2 border-t border-border bg-card px-2 py-1.5 text-[11px]">
        <span className="text-muted-foreground">
          圈选 {selected.length} 个文件设为可写范围
        </span>
        <button
          type="button"
          disabled={disabled || selected.length === 0}
          onClick={handleApply}
          className="rounded bg-primary px-2 py-1 text-primary-foreground disabled:opacity-40"
        >
          设为可写范围
        </button>
        <button
          type="button"
          disabled={selected.length === 0}
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 rounded border border-border bg-secondary/50 px-2 py-1 text-secondary-foreground hover:bg-secondary disabled:opacity-40"
          aria-label="打开圈选抽屉"
        >
          <Layers className="h-3 w-3" />
          <span>圈选抽屉</span>
        </button>
        <button
          type="button"
          disabled={selected.length === 0}
          onClick={onClear}
          className="rounded border border-border px-2 py-1 disabled:opacity-40"
        >
          清空
        </button>
        {selected.length > 0 && (
          <code className="ml-auto max-w-[35%] truncate text-[10px] text-muted-foreground">
            {selected.slice(0, 3).join(", ")}
            {selected.length > 3 ? " …" : ""}
          </code>
        )}
      </div>

      <Sheet open={isOpen} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-sm font-semibold">
              <Layers className="h-4 w-4 text-primary" />
              Scope 圈选与影响范围抽屉
            </SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              分析圈选模块的依赖拓扑与合同版本影响，确认写入合同可写范围。
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto py-2">
            {/* 治理状态提示卡 */}
            {contract ? (
              isApproved ? (
                <div
                  data-testid="scope-governance-alert"
                  className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200"
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                    <div className="space-y-1">
                      <p className="font-medium text-amber-300">
                        当前合同已批准（v{contract.revision ?? 1}）
                      </p>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        修改 Scope 属于关键变更。依据治理规范，将强制派生新
                        Revision（v{(contract.revision ?? 1) + 1}
                        ）并清空已有审批，必须重新发起审批！
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  data-testid="scope-governance-info"
                  className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200"
                >
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    <div className="space-y-1">
                      <p className="font-medium text-emerald-300">
                        草稿态变更（v{contract.revision ?? 1}）
                      </p>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        当前处于需求草稿阶段，将原地更新可写范围，不产生版本碎片。
                      </p>
                    </div>
                  </div>
                </div>
              )
            ) : null}

            {/* 影响拓扑统计面板 */}
            <div className="rounded-md border border-border bg-card p-3 text-xs">
              <p className="mb-2 font-medium text-card-foreground">
                影响拓扑摘要
              </p>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded bg-muted/40 p-2">
                  <span className="text-muted-foreground">圈选模块数</span>
                  <p className="mt-1 text-sm font-semibold text-foreground">
                    {selected.length} 个
                  </p>
                </div>
                <div className="rounded bg-muted/40 p-2">
                  <span className="text-muted-foreground">直接外部依赖</span>
                  <p className="mt-1 text-sm font-semibold text-foreground">
                    {impactAnalysis.outgoingCount} 个
                  </p>
                </div>
              </div>
            </div>

            {/* 圈选文件列表 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>圈选文件明细（{selected.length}）</span>
                {selected.length > 0 && (
                  <button
                    type="button"
                    onClick={onClear}
                    className="text-[11px] text-destructive hover:underline"
                  >
                    全部清空
                  </button>
                )}
              </div>
              {selected.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  尚未圈选任何模块，请在架构雷达画布中点选或多选节点。
                </p>
              ) : (
                <ul className="max-h-52 divide-y divide-border overflow-y-auto rounded border border-border bg-muted/20 text-xs">
                  {selected.map((path) => (
                    <li
                      key={path}
                      className="flex items-center justify-between p-2 font-mono text-[11px]"
                    >
                      <span className="truncate pr-2">{path}</span>
                      {onRemovePath && (
                        <button
                          type="button"
                          onClick={() => onRemovePath(path)}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label={`移除 ${path}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <SheetFooter className="gap-2 border-t border-border pt-2 sm:justify-between">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
            >
              取消
            </button>
            <button
              type="button"
              disabled={disabled || selected.length === 0}
              onClick={handleApply}
              className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              {isApproved ? "派生新 Revision 并重新审批" : "确认应用 Scope"}
            </button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
