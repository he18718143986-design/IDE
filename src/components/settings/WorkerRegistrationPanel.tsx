import { useCallback, useEffect, useState } from "react";
import { Cpu, FlaskConical, RefreshCw, UserPlus } from "lucide-react";
import {
  fetchWorkers,
  registerWorker,
  verifyWorker,
  type DaemonConnection,
  type WorkerControlMode,
  type WorkerView,
} from "@/lib/daemon-api";

/**
 * TASK-W.7：Worker 自助注册面板（设置 → 高级 → Worker 自助注册）。
 *
 * 展示纪律（对应卡正文「不宣称端到端闭环」）：
 * - **填表不会给出受控档**：注册后恒为 `UNCONTROLLED_EXTERNAL`，档位只能靠探测升；
 * - 探测结论只是「通过已知探测集」，报告结语由服务端固定，这里原样展示；
 * - `dispatchable === false` 必须显式写出来——档位记录成立不等于能派工，
 *   否则界面上会出现「已受控但一派工就失败」的错觉。
 */

const MODE_LABEL: Record<WorkerControlMode, string> = {
  GATEWAY_ENFORCED: "GATEWAY_ENFORCED 受控",
  SANDBOX_ENFORCED: "SANDBOX_ENFORCED 容器受控",
  UNCONTROLLED_EXTERNAL: "UNCONTROLLED_EXTERNAL 非受控",
};

function modeClass(mode: WorkerControlMode): string {
  if (mode === "UNCONTROLLED_EXTERNAL") {
    return "rounded bg-yellow-100 px-1.5 text-yellow-800";
  }
  return "rounded bg-green-100 px-1.5 text-green-800";
}

export interface WorkerRegistrationPanelProps {
  conn: DaemonConnection;
  connected: boolean;
}

export function WorkerRegistrationPanel({
  conn,
  connected,
}: WorkerRegistrationPanelProps) {
  const [workers, setWorkers] = useState<WorkerView[]>([]);
  const [adapterId, setAdapterId] = useState("");
  const [version, setVersion] = useState("0.1.0");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [limitation, setLimitation] = useState(
    "第三方 CLI 的文件读写与命令执行由容器围栏约束，工具调用不经 Gateway",
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!connected) {
      setWorkers([]);
      return;
    }
    try {
      setWorkers(await fetchWorkers(conn));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取 Worker 列表失败");
    }
  }, [conn, connected]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const created = await registerWorker(conn, {
        adapter_id: adapterId.trim(),
        adapter_version: version.trim(),
        launch: {
          command: command.trim(),
          args: args
            .split(/\s+/)
            .map((item) => item.trim())
            .filter((item) => item.length > 0),
        },
        declaration: {
          protocol_version: "1.0.0",
          model_metering_source: "LOCAL_ESTIMATE",
          tool_interception_supported: false,
          filesystem_permissions: "DIRECT_UNCONTROLLED",
          command_permissions: "UNRESTRICTED_SHELL",
          cancellation_supported: true,
          session_recovery_supported: false,
          network_requirements: "NONE",
          platform_support: [
            "darwin-arm64",
            "darwin-x64",
            "linux-x64",
            "win32-x64",
          ],
          known_limitations: limitation
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0),
        },
      });
      setMessage(
        `已登记 ${created.adapter_id}（${MODE_LABEL[created.control_mode]}）。档位只能靠探测升，注册不会授予受控。`,
      );
      setAdapterId("");
      setCommand("");
      setArgs("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败");
    } finally {
      setBusy(false);
    }
  };

  const runVerify = async (id: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    setSelected(id);
    try {
      const result = await verifyWorker(conn, id, "SANDBOX_ENFORCED");
      const verdict = result.promoted
        ? `探测通过，档位升为 ${MODE_LABEL[result.control_mode]}`
        : `探测未通过，档位保持 ${MODE_LABEL[result.control_mode]}`;
      setMessage(
        `${id}：${verdict}${result.refusals.length > 0 ? `（${result.refusals.length} 项未通过）` : ""}`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "探测失败");
    } finally {
      setBusy(false);
    }
  };

  const report = workers.find(
    (item) => item.adapter_id === selected,
  )?.last_report;

  if (!connected) {
    return (
      <p data-testid="worker-registration-offline" className="opacity-60">
        未连上后台，无法注册或探测 Worker。
      </p>
    );
  }

  return (
    <div className="space-y-2" data-testid="worker-registration">
      <p className="opacity-60">
        自助登记第三方 CLI。登记后为
        <b>非受控</b>
        ；只有在该档位执行环境里跑过探针并且全部通过，才会升到受控档。
        即便档位升了，只要没接派工工厂，本机仍然无法用它派工。
      </p>

      <div className="grid grid-cols-[7rem_1fr] items-center gap-2">
        <span className="opacity-60">adapter_id</span>
        <input
          aria-label="adapter_id"
          data-testid="worker-adapter-id"
          value={adapterId}
          onChange={(e) => setAdapterId(e.target.value)}
          placeholder="acme.cli.v1"
          className="w-full rounded border border-border bg-background px-2 py-1 outline-none"
        />
        <span className="opacity-60">版本</span>
        <input
          aria-label="adapter_version"
          data-testid="worker-adapter-version"
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          className="w-full rounded border border-border bg-background px-2 py-1 outline-none"
        />
        <span className="opacity-60">启动命令</span>
        <input
          aria-label="launch command"
          data-testid="worker-launch-command"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="只用可执行名或绝对路径，不要 shell 写法"
          className="w-full rounded border border-border bg-background px-2 py-1 outline-none"
        />
        <span className="opacity-60">参数</span>
        <input
          aria-label="launch args"
          data-testid="worker-launch-args"
          value={args}
          onChange={(e) => setArgs(e.target.value)}
          placeholder="空格分隔，逐项独立传递"
          className="w-full rounded border border-border bg-background px-2 py-1 outline-none"
        />
        <span className="opacity-60">已知限制</span>
        <textarea
          aria-label="known limitations"
          data-testid="worker-known-limitations"
          value={limitation}
          rows={2}
          onChange={(e) => setLimitation(e.target.value)}
          className="w-full rounded border border-border bg-background px-2 py-1 outline-none"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="worker-register"
          disabled={busy || adapterId.trim() === "" || command.trim() === ""}
          onClick={() => void submit()}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 hover:bg-accent disabled:opacity-50"
        >
          <UserPlus className="h-3 w-3" /> 登记
        </button>
        <button
          type="button"
          data-testid="worker-refresh"
          disabled={busy}
          onClick={() => void refresh()}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw className="h-3 w-3" /> 刷新
        </button>
      </div>

      {message ? (
        <p
          data-testid="worker-registration-message"
          className="text-emerald-700"
        >
          {message}
        </p>
      ) : null}
      {error ? (
        <p data-testid="worker-registration-error" className="text-destructive">
          {error}
        </p>
      ) : null}

      <ul className="space-y-1" data-testid="worker-list">
        {workers.map((worker) => (
          <li
            key={worker.adapter_id}
            className="rounded border border-border px-2 py-1"
            data-testid={`worker-row-${worker.adapter_id}`}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <Cpu className="h-3 w-3 opacity-60" />
              <code>{worker.adapter_id}</code>
              <span className="opacity-60">@{worker.adapter_version}</span>
              <span
                data-testid={`worker-mode-${worker.adapter_id}`}
                className={modeClass(worker.control_mode)}
              >
                {MODE_LABEL[worker.control_mode]}
              </span>
              {worker.builtin ? (
                <span className="rounded bg-muted px-1.5 opacity-70">内建</span>
              ) : null}
              {worker.dispatchable ? null : (
                <span className="rounded bg-muted px-1.5 text-muted-foreground">
                  不可派工
                </span>
              )}
              {worker.builtin ? null : (
                <button
                  type="button"
                  data-testid={`worker-verify-${worker.adapter_id}`}
                  disabled={busy}
                  onClick={() => void runVerify(worker.adapter_id)}
                  className="ml-auto flex items-center gap-1 rounded border border-border px-2 py-0.5 hover:bg-accent disabled:opacity-50"
                >
                  <FlaskConical className="h-3 w-3" /> 探测（容器）
                </button>
              )}
            </div>
            {worker.demoted_reason ? (
              <p
                data-testid={`worker-demoted-${worker.adapter_id}`}
                className="mt-1 text-[11px] text-amber-700"
              >
                已降级：{worker.demoted_reason}
              </p>
            ) : null}
            {worker.dispatch_blocked_reason ? (
              <p className="mt-1 text-[11px] opacity-60">
                {worker.dispatch_blocked_reason}
              </p>
            ) : null}
            {worker.last_report ? (
              <p className="mt-1 text-[11px] opacity-70">
                上次探测 {worker.last_report.verified_at} ·{" "}
                {worker.last_report.status === "passed" ? "通过" : "未通过"} ·{" "}
                {worker.last_report.findings
                  .map((item) => `${item.id}:${item.status}`)
                  .join(" ")}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      {report ? (
        <div
          data-testid="worker-probe-report"
          className="rounded border border-border bg-muted/40 p-2 text-[11px]"
        >
          <p className="font-semibold">探测报告（{report.fingerprint}）</p>
          <ul className="mt-1 space-y-0.5">
            {report.findings.map((finding) => (
              <li key={finding.id}>
                <code>{finding.id}</code> · {finding.status} · {finding.detail}
              </li>
            ))}
          </ul>
          {/* 结语原样展示：不得改写成「绝对受控」，也不得省略 */}
          <p className="mt-1 opacity-70">{report.wording}</p>
        </div>
      ) : null}
    </div>
  );
}
