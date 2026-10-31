import type {
  ChatAdapterInfo,
  ChatEvent,
  ChatEventBody,
  ChatSessionDetail,
  ChatSessionSummary,
} from "../../src/lib/chat-events";
import type { AdapterEvent, ChatAdapter, HistoryTurn } from "./types";
import { ChatSessionStore, type StoredSession } from "./session-store";
import { pickPreferredAdapterId } from "../../src/lib/pick-chat-adapter";

/**
 * TASK-C.6 会话管理器。
 * - 每个会话同一时刻只跑一轮；忙时新消息排队（queued），本轮结束后依次执行；
 * - interrupt：立即停止向 UI 转发（门闩），发 AbortSignal 让适配器回收进程，
 *   并清空排队；
 * - 持久化到 `.stagent/sessions/`，Daemon 重启后可续接（原生会话 ID 一并保存）。
 * 注意：本模块不引用 Supervisor，会话期间 Supervisor 零模型调用。
 */
export interface ChatSessionManagerOptions {
  repoRoot: string;
  adapters: ChatAdapter[];
  publish: (event: ChatEvent) => void;
  /** 工作目录解析（默认仓库根，Vibe 模式） */
  resolveCwd?: () => string;
  now?: () => Date;
}

interface LiveState {
  controller: AbortController | null;
  turnId: string | null;
  /** 门闩：被打断后本轮任何迟到输出一律丢弃 */
  gateOpen: boolean;
  queue: string[];
  running: Promise<void> | null;
}

let counter = 0;
const newId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;

export class ChatSessionManager {
  private readonly store: ChatSessionStore;
  private readonly adapters: Map<string, ChatAdapter>;
  private readonly live = new Map<string, LiveState>();
  private readonly cache = new Map<string, StoredSession>();
  private readonly persistTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly opts: ChatSessionManagerOptions) {
    this.store = new ChatSessionStore(opts.repoRoot);
    this.adapters = new Map(opts.adapters.map((a) => [a.info().id, a]));
  }

  private now(): string {
    return (this.opts.now?.() ?? new Date()).toISOString();
  }

  listAdapters(): ChatAdapterInfo[] {
    return [...this.adapters.values()].map((a) => a.info());
  }

  private load(id: string): StoredSession | null {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const stored = this.store.get(id);
    if (stored) this.cache.set(id, stored);
    return stored;
  }

  private isBusy(id: string): boolean {
    return !!this.live.get(id)?.controller;
  }

  listSessions(): ChatSessionSummary[] {
    return this.store.list().map((s) => {
      const fresh = this.cache.get(s.id) ?? s;
      const { events: _e, ...rest } = fresh;
      return { ...rest, busy: this.isBusy(s.id) };
    });
  }

  getSession(id: string): ChatSessionDetail | null {
    const s = this.load(id);
    return s ? { ...s, busy: this.isBusy(id) } : null;
  }

  /** TASK-C.8a：未指定时优先真助手，演示/练习沙箱仅兜底 */
  createSession(adapterId?: string): ChatSessionSummary {
    const resolved =
      adapterId && adapterId.length > 0
        ? adapterId
        : pickPreferredAdapterId(this.listAdapters());
    if (!resolved || !this.adapters.has(resolved)) {
      throw new Error(`unknown adapter: ${resolved || "(empty)"}`);
    }
    const adapterIdFinal = resolved;
    const at = this.now();
    const session: StoredSession = {
      id: newId("chat"),
      adapter_id: adapterIdFinal,
      title: "新会话",
      created_at: at,
      updated_at: at,
      native_session_id: null,
      events: [],
    };
    this.cache.set(session.id, session);
    this.store.save(session);
    const { events: _e, ...rest } = session;
    return { ...rest, busy: false };
  }

  private state(id: string): LiveState {
    let s = this.live.get(id);
    if (!s) {
      s = {
        controller: null,
        turnId: null,
        gateOpen: false,
        queue: [],
        running: null,
      };
      this.live.set(id, s);
    }
    return s;
  }

  private emit(session: StoredSession, turnId: string, body: ChatEventBody) {
    const event = {
      session_id: session.id,
      turn_id: turnId,
      seq: session.events.length,
      at: this.now(),
      ...body,
    } as ChatEvent;
    // 合并连续 delta 以控制持久化体积（广播仍逐个发送）
    const last = session.events.at(-1);
    if (
      body.kind === "delta" &&
      last?.kind === "delta" &&
      last.turn_id === turnId
    ) {
      last.text += body.text;
    } else {
      session.events.push({ ...event });
    }
    session.updated_at = event.at;
    this.opts.publish(event);
    if (body.kind === "delta" || body.kind === "tool_call") {
      this.schedulePersist(session);
    } else {
      this.persistNow(session);
    }
  }

  private schedulePersist(session: StoredSession) {
    if (this.persistTimers.has(session.id)) return;
    this.persistTimers.set(
      session.id,
      setTimeout(() => this.persistNow(session), 500),
    );
  }

  private persistNow(session: StoredSession) {
    const t = this.persistTimers.get(session.id);
    if (t) clearTimeout(t);
    this.persistTimers.delete(session.id);
    this.store.save(session);
  }

  /** 发送消息；忙时排队。返回 "started" | "queued" */
  send(sessionId: string, text: string): "started" | "queued" {
    const session = this.load(sessionId);
    if (!session) throw new Error(`session not found: ${sessionId}`);
    const trimmed = text.trim();
    if (!trimmed) throw new Error("empty message");
    const st = this.state(sessionId);
    if (st.controller) {
      st.queue.push(trimmed);
      this.emit(session, st.turnId ?? "queue", {
        kind: "queued",
        text: trimmed,
        position: st.queue.length,
      });
      return "queued";
    }
    st.running = this.runTurns(session, st, trimmed);
    return "started";
  }

  private historyOf(session: StoredSession): HistoryTurn[] {
    const turns: HistoryTurn[] = [];
    for (const e of session.events) {
      if (e.kind === "user") turns.push({ role: "user", text: e.text });
      else if (e.kind === "delta") {
        const last = turns.at(-1);
        if (last?.role === "assistant") last.text += e.text;
        else turns.push({ role: "assistant", text: e.text });
      }
    }
    return turns;
  }

  private async runTurns(
    session: StoredSession,
    st: LiveState,
    first: string,
  ): Promise<void> {
    let next: string | undefined = first;
    while (next !== undefined) {
      await this.runOne(session, st, next);
      next = st.queue.shift();
    }
    st.running = null;
  }

  private async runOne(session: StoredSession, st: LiveState, text: string) {
    const adapter = this.adapters.get(session.adapter_id);
    const turnId = newId("turn");
    const controller = new AbortController();
    st.controller = controller;
    st.turnId = turnId;
    st.gateOpen = true;
    const history = this.historyOf(session);
    if (session.title === "新会话") session.title = text.slice(0, 40);
    this.emit(session, turnId, { kind: "user", text });
    try {
      if (!adapter) throw new Error(`adapter missing: ${session.adapter_id}`);
      // TASK-L.1 / ADR-0014 §1：prompt 与用户输入逐字节相同，不再注入保护清单前缀
      const iter = adapter.run({
        prompt: text,
        cwd: this.opts.resolveCwd?.() ?? this.opts.repoRoot,
        nativeSessionId: session.native_session_id,
        history,
        signal: controller.signal,
      });
      for await (const ev of iter) {
        if (!st.gateOpen) continue; // 打断后迟到的输出丢弃
        this.forward(session, turnId, ev);
      }
      if (st.gateOpen) this.emit(session, turnId, { kind: "turn_end" });
    } catch (err) {
      if (st.gateOpen && !controller.signal.aborted) {
        this.emit(session, turnId, {
          kind: "error",
          message: (err as Error).message,
        });
      }
    } finally {
      st.gateOpen = false;
      st.controller = null;
      st.turnId = null;
    }
  }

  private forward(session: StoredSession, turnId: string, ev: AdapterEvent) {
    if (ev.kind === "session") {
      session.native_session_id = ev.native_session_id;
      this.persistNow(session);
      return;
    }
    this.emit(session, turnId, ev);
  }

  /** 打断：立即关闭门闩并通知 UI，随后适配器回收进程 */
  interrupt(sessionId: string): boolean {
    const session = this.load(sessionId);
    const st = this.live.get(sessionId);
    if (!session || !st?.controller || !st.turnId) return false;
    st.gateOpen = false;
    st.queue.length = 0;
    this.emit(session, st.turnId, { kind: "interrupted" });
    st.controller.abort();
    return true;
  }

  /** 等待会话当前所有轮次结束（测试与优雅停机用） */
  async idle(sessionId: string): Promise<void> {
    while (this.live.get(sessionId)?.running) {
      await this.live.get(sessionId)?.running;
    }
  }

  async shutdown(): Promise<void> {
    for (const id of this.live.keys()) this.interrupt(id);
    await Promise.all([...this.live.keys()].map((id) => this.idle(id)));
    for (const s of this.cache.values()) this.persistNow(s);
  }
}
