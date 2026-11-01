/**
 * TASK-L.15：local_process 长驻进程登记（按 target_id）。
 */
import type { ManagedProcess } from "../worker/cli-host/process-host";

export interface LiveProcessEntry {
  release_id: string;
  target_id: string;
  checkout_dir: string;
  process: ManagedProcess;
  port: number;
}

const byTarget = new Map<string, LiveProcessEntry>();

export function getLiveProcess(targetId: string): LiveProcessEntry | undefined {
  return byTarget.get(targetId);
}

export function setLiveProcess(entry: LiveProcessEntry): void {
  byTarget.set(entry.target_id, entry);
}

export function clearLiveProcess(targetId: string): void {
  byTarget.delete(targetId);
}

/** 测试用：清空登记 */
export function resetLiveProcessRegistry(): void {
  byTarget.clear();
}
