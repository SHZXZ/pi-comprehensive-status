export interface UsageSnapshot {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  cost?: {
    total?: number;
  };
}

export interface SessionStats {
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  cost: number;
  toolCalls: number;
  mcpCalls: number;
}

export interface DashboardLayoutItem {
  id: string;
  width: number;
  priority: number;
}

export type TodoWorkflowMode = "idle" | "pending" | "executing";

export interface TodoWorkflowState {
  mode: TodoWorkflowMode;
  completed: number;
  total: number;
}

export interface MobileStatusInput {
  model: string;
  thinking: string;
  workflow: TodoWorkflowState;
  cacheHit: number | null;
  responseMs?: number;
  firstTokenMs?: number;
  taskMs?: number;
  taskActive?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function addUsage(stats: SessionStats, value: unknown): void {
  if (!isRecord(value)) return;
  const usage = value as UsageSnapshot;
  stats.input += finiteNumber(usage.input);
  stats.output += finiteNumber(usage.output);
  stats.cacheRead += finiteNumber(usage.cacheRead);
  stats.cacheWrite += finiteNumber(usage.cacheWrite);
  stats.reasoning += finiteNumber(usage.reasoning);
  stats.cost += isRecord(usage.cost) ? finiteNumber(usage.cost.total) : 0;
}

function isMcpToolResult(toolName: unknown, details: unknown): boolean {
  if (toolName === "mcp") return true;
  if (!isRecord(details)) return false;
  return typeof details.server === "string" && (
    typeof details.tool === "string" || typeof details.resourceUri === "string"
  );
}

/** Aggregate every recorded model call in a session, matching Pi's native footer scope. */
export function calculateSessionStats(entries: readonly unknown[]): SessionStats {
  const stats: SessionStats = {
    calls: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    cost: 0,
    toolCalls: 0,
    mcpCalls: 0,
  };

  for (const candidate of entries) {
    if (!isRecord(candidate)) continue;

    if (candidate.type === "message" && isRecord(candidate.message)) {
      const message = candidate.message;
      if (message.role === "assistant") {
        stats.calls += 1;
        addUsage(stats, message.usage);
      } else if (message.role === "toolResult") {
        stats.toolCalls += 1;
        if (isMcpToolResult(message.toolName, message.details)) stats.mcpCalls += 1;
        addUsage(stats, message.usage);
      }
      continue;
    }

    if (candidate.type === "compaction" || candidate.type === "branch_summary") {
      addUsage(stats, candidate.usage);
    }
  }

  return stats;
}

export function cacheHitRate(
  usage: Pick<SessionStats, "input" | "cacheRead" | "cacheWrite">,
): number | null {
  const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  return promptTokens > 0 ? (usage.cacheRead / promptTokens) * 100 : null;
}

/** Return dashboard item ids that fit, removing lower-priority items first. */
export function fitDashboardItems(
  items: readonly DashboardLayoutItem[],
  width: number,
  separatorWidth = 5,
): string[] {
  const visible = [...items];
  const lineWidth = (): number =>
    visible.reduce((sum, item) => sum + item.width, 0)
    + Math.max(0, visible.length - 1) * separatorWidth;

  while (visible.length > 1 && lineWidth() > width) {
    let removeAt = 0;
    for (let index = 1; index < visible.length; index += 1) {
      if (visible[index].priority < visible[removeAt].priority) removeAt = index;
    }
    visible.splice(removeAt, 1);
  }

  return visible.map((item) => item.id);
}

export function formatTodoWorkflowText(
  state: TodoWorkflowState,
  compact = false,
): string {
  if (state.mode === "executing") {
    if (state.total === 0) return compact ? "执行" : "执行中";
    return compact
      ? `执行${state.completed}/${state.total}`
      : `执行中 ${state.completed}/${state.total}`;
  }
  if (state.mode === "pending") {
    if (state.total === 0) return "待办";
    return compact
      ? `待办${state.completed}/${state.total}`
      : `待办 ${state.completed}/${state.total}`;
  }
  return "空闲";
}

export function terminalCellWidth(value: string): number {
  return Array.from(value).reduce((width, char) => {
    const codePoint = char.codePointAt(0) ?? 0;
    return width + (codePoint >= 0x2e80 ? 2 : 1);
  }, 0);
}

function truncateToCells(value: string, width: number): string {
  let cells = 0;
  let result = "";
  for (const char of value) {
    const charWidth = terminalCellWidth(char);
    if (cells + charWidth > width) break;
    result += char;
    cells += charWidth;
  }
  return result;
}

export function formatMobileStatusLines(
  input: MobileStatusInput,
  width: number,
): [string, string] {
  const safeWidth = Math.max(1, width);
  const workflow = formatTodoWorkflowText(input.workflow, true);
  const compactDuration = (ms?: number): string => {
    if (ms === undefined || !Number.isFinite(ms)) return "--";
    if (ms < 1_000) return `${Math.max(0, Math.round(ms))}ms`;
    if (ms < 60_000) {
      const seconds = ms / 1_000;
      return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
    }
    const totalSeconds = Math.floor(ms / 1_000);
    const hours = Math.floor(totalSeconds / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;
    return hours > 0
      ? `${hours}h${String(minutes).padStart(2, "0")}m`
      : `${minutes}m${String(seconds).padStart(2, "0")}s`;
  };
  // Minute-precision fallback keeps long-task timers readable on narrow rows.
  const shortDuration = (ms?: number): string => {
    if (ms === undefined || !Number.isFinite(ms)) return "--";
    if (ms < 60_000) return compactDuration(ms);
    const totalMinutes = Math.floor(ms / 60_000);
    return totalMinutes >= 60
      ? `${Math.floor(totalMinutes / 60)}h${String(totalMinutes % 60).padStart(2, "0")}m`
      : `${totalMinutes}m`;
  };
  const fixedTopWidth = terminalCellWidth(`◇  › ✦${input.thinking} › ◇${workflow}`);
  const availableModelWidth = Math.max(4, safeWidth - fixedTopWidth);
  const modelTail = (input.model || "no-model").split("/").pop() ?? "no-model";
  const model = terminalCellWidth(modelTail) <= availableModelWidth
    ? modelTail
    : `${truncateToCells(modelTail, Math.max(1, availableModelWidth - 1))}…`;
  const cache = input.cacheHit === null ? "--" : `${Math.round(input.cacheHit)}%`;
  const response = compactDuration(input.responseMs);
  const firstToken = compactDuration(input.firstTokenMs);
  const taskIcon = input.taskActive ? "◷" : "✓";
  const task = `${taskIcon}${compactDuration(input.taskMs)}`;
  const taskShort = `${taskIcon}${shortDuration(input.taskMs)}`;
  const cacheShort = input.cacheHit === null ? "--" : `${Math.round(input.cacheHit)}`;
  const spacedMetrics = `缓存${cache} │响应${response} │首字${firstToken} │任务${task}`;
  const compactMetrics = `缓存${cache}│响应${response}│首字${firstToken}│任务${task}`;
  const spacedShortMetrics = `缓存${cache} │响应${response} │首字${firstToken} │任务${taskShort}`;
  const compactShortMetrics = `缓存${cache}│响应${response}│首字${firstToken}│任务${taskShort}`;
  const tightShortMetrics = `缓存${cacheShort}│响应${response}│首字${firstToken}│任务${taskShort}`;
  const metrics = [
    spacedMetrics,
    compactMetrics,
    spacedShortMetrics,
    compactShortMetrics,
    tightShortMetrics,
  ].find((candidate) => terminalCellWidth(candidate) <= safeWidth)
    ?? tightShortMetrics;
  return [
    truncateToCells(`◇ ${model} › ✦${input.thinking} › ◇${workflow}`, safeWidth),
    truncateToCells(metrics, safeWidth),
  ];
}

export function resolveTodoWorkflowState(entries: readonly unknown[]): TodoWorkflowState {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) continue;
    const message = entry.message;
    if (message.role !== "toolResult" || message.toolName !== "todo" || !isRecord(message.details)) continue;
    if (!Array.isArray(message.details.tasks) || typeof message.details.nextId !== "number") continue;

    const tasks = message.details.tasks.filter((task) => isRecord(task) && task.status !== "deleted");
    const total = tasks.length;
    const completed = tasks.filter((task) => task.status === "completed").length;
    const mode = tasks.some((task) => task.status === "in_progress")
      ? "executing"
      : tasks.some((task) => task.status === "pending")
        ? "pending"
        : "idle";
    return { mode, completed, total };
  }

  return { mode: "idle", completed: 0, total: 0 };
}
