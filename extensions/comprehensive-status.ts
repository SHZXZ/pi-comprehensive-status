import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  type EditorComponent,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

type UsageWithReasoning = Usage & { reasoning?: number };

interface ModelUsageSnapshot {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
}

type EditorFactory = (
  tui: TUI,
  theme: EditorTheme,
  keybindings: KeybindingsManager,
) => EditorComponent;

interface SessionStats {
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  cost: number;
  toolCalls: number;
  mcpCalls: number;
  lastModel?: ModelUsageSnapshot;
  lastCacheHit: number | null;
}

interface ApiTelemetry {
  activeStart?: number;
  activeHeaderMs?: number;
  activeFirstMs?: number;
  lastStatus?: number;
  lastHeaderMs?: number;
  lastTtftMs?: number;
  lastTotalMs?: number;
  lastError?: string;
  headers: number[];
  ttfts: number[];
  totals: number[];
}

interface TaskTelemetry {
  activeStart?: number;
  lastTotalMs?: number;
}

interface GitState {
  available: boolean;
  branch: string | null;
  dirtyFiles: number;
}

interface CpuSample {
  idle: number;
  total: number;
}

interface SystemTelemetry {
  cpuPercent?: number;
  memoryPercent?: number;
  cpuTempC?: number;
  gpuAvailable?: boolean;
  gpuPercent?: number;
  gpuMemoryPercent?: number;
  gpuTempC?: number;
}

interface GpuTelemetry {
  available: boolean;
  percent?: number;
  memoryPercent?: number;
  tempC?: number;
}

type RGB = readonly [number, number, number];
type ThemeColor = "text" | "accent" | "success" | "warning" | "error" | "muted" | "dim";

interface PowerlineModule {
  id: string;
  text: string;
  bg: RGB;
  fg: RGB;
  priority: number;
}

interface DashboardItem {
  text: string;
  priority: number;
}

const HISTORY_LIMIT = 10;
const RESET = "\u001b[0m";
const RESET_BG = "\u001b[49m";
const NERD_FONT = ["1", "true", "yes", "on"].includes(
  (process.env.POWERLINE_NERD_FONTS ?? "").toLowerCase(),
);
const HARD_SEPARATOR = NERD_FONT ? "\uE0B0" : "›";
const LEFT_SEPARATOR = NERD_FONT ? "\uE0B2" : "‹";
const SPARK_CHARS = "▁▂▃▄▅▆▇█";
const SYSTEM_REFRESH_MS = 3_000;
const GPU_REFRESH_EVERY = 2;

type IconName =
  | "pi"
  | "model"
  | "thinking"
  | "directory"
  | "session"
  | "git"
  | "cpu"
  | "gpu"
  | "memory"
  | "context"
  | "api"
  | "rounds"
  | "tools"
  | "cache"
  | "latency"
  | "usage"
  | "task"
  | "warning"
  | "cost";

const ICONS: Record<IconName, { nerd: string; fallback: string }> = {
  pi: { nerd: "\uE22C", fallback: "π" },
  model: { nerd: "\uEC19", fallback: "" },
  thinking: { nerd: "\uF0E7", fallback: "⚡" },
  directory: { nerd: "\uF015", fallback: "⌂" },
  session: { nerd: "\uF550", fallback: "#" },
  git: { nerd: "\uF126", fallback: "⎇" },
  cpu: { nerd: "\uF2DB", fallback: "▣" },
  gpu: { nerd: "\uF108", fallback: "▦" },
  memory: { nerd: "\uF538", fallback: "▤" },
  context: { nerd: "\uF1C0", fallback: "◫" },
  api: { nerd: "\uF1EB", fallback: "●" },
  rounds: { nerd: "\uF021", fallback: "↻" },
  tools: { nerd: "\uF0AD", fallback: "⚙" },
  cache: { nerd: "\uF1C0", fallback: "↺" },
  latency: { nerd: "\uF017", fallback: "◷" },
  usage: { nerd: "\uE26B", fallback: "Σ" },
  task: { nerd: "\uF017", fallback: "◷" },
  warning: { nerd: "\uF071", fallback: "!" },
  cost: { nerd: "\uF155", fallback: "$" },
};

const PALETTE = {
  brandBg: [24, 27, 42] as RGB,
  brandFg: [125, 207, 255] as RGB,
  modelBg: [57, 66, 103] as RGB,
  modelFg: [235, 239, 255] as RGB,
  thinkBg: [126, 79, 145] as RGB,
  thinkFg: [255, 239, 196] as RGB,
  dirBg: [22, 100, 122] as RGB,
  dirFg: [225, 252, 255] as RGB,
  sessionBg: [95, 77, 132] as RGB,
  sessionFg: [246, 239, 255] as RGB,
  gitCleanBg: [42, 112, 75] as RGB,
  gitDirtyBg: [151, 105, 34] as RGB,
  gitFg: [240, 255, 243] as RGB,
  systemBg: [39, 70, 73] as RGB,
  systemWarnBg: [137, 96, 37] as RGB,
  systemErrorBg: [142, 52, 65] as RGB,
  systemFg: [229, 247, 244] as RGB,
  apiOkBg: [35, 120, 82] as RGB,
  apiBusyBg: [44, 105, 145] as RGB,
  apiWarnBg: [164, 105, 31] as RGB,
  apiErrorBg: [154, 52, 67] as RGB,
  apiFg: [255, 249, 240] as RGB,
  extensionBg: [66, 71, 91] as RGB,
  extensionFg: [224, 228, 241] as RGB,
  mcpBg: [59, 76, 96] as RGB,
  mcpBusyBg: [47, 101, 126] as RGB,
  mcpFg: [232, 244, 255] as RGB,
  contextBg: [31, 39, 55] as RGB,
  contextMuted: [158, 166, 184] as RGB,
  contextGood: [78, 201, 126] as RGB,
  contextWarn: [240, 190, 64] as RGB,
  contextError: [242, 85, 101] as RGB,
} as const;

function icon(name: IconName): string {
  const selected = ICONS[name];
  return NERD_FONT ? selected.nerd : selected.fallback;
}

function withIcon(name: IconName, text: string): string {
  const glyph = icon(name);
  return glyph ? `${glyph} ${text}` : text;
}

function fgRgb(color: RGB): string {
  return `\u001b[38;2;${color[0]};${color[1]};${color[2]}m`;
}

function bgRgb(color: RGB): string {
  return `\u001b[48;2;${color[0]};${color[1]};${color[2]}m`;
}

const EDITOR_FRAME = [61, 53, 119] as RGB;
const EDITOR_PROMPT = [187, 154, 247] as RGB;
const EDITOR_MIN_BODY_ROWS = 3;

/** Full-width editor card based on Tokyo Night's official CustomEditor pattern. */
class SpaciousEditor extends CustomEditor {
  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
    super(tui, theme, keybindings);

    const transparentBorder = () => "";
    this.borderColor = transparentBorder;
    Object.defineProperty(this, "borderColor", {
      get: () => transparentBorder,
      set: () => {},
      configurable: false,
    });
  }

  render(width: number): string[] {
    if (width < 10) return super.render(width);

    const frame = (value: string): string => `${fgRgb(EDITOR_FRAME)}${value}${RESET}`;
    const prompt = ` ${fgRgb(EDITOR_PROMPT)}❯${RESET} `;
    const continuation = " ".repeat(visibleWidth(prompt));
    const innerWidth = Math.max(1, width - 2);
    const contentWidth = Math.max(1, innerWidth - visibleWidth(prompt));
    const lines = super.render(contentWidth);
    if (lines.length < 2) return lines;

    const bottomBorderIndex = lines.findIndex(
      (line, index) => index > 0 && line.length === 0,
    );
    if (bottomBorderIndex === -1) return lines;

    const editorLines = lines.slice(1, bottomBorderIndex);
    const autocompleteLines = lines.slice(bottomBorderIndex + 1);
    const result = [frame(`╭${"─".repeat(width - 2)}╮`)];
    const bodyLines = editorLines.length > 0 ? editorLines : [""];

    bodyLines.forEach((line, index) => {
      const prefix = index === 0 ? prompt : continuation;
      const content = truncateToWidth(`${prefix}${line}`, innerWidth);
      const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(content)));
      result.push(`${frame("│")}${content}${padding}${frame("│")}`);
    });

    while (result.length - 1 < EDITOR_MIN_BODY_ROWS) {
      result.push(`${frame("│")}${" ".repeat(innerWidth)}${frame("│")}`);
    }

    result.push(frame(`╰${"─".repeat(width - 2)}╯`));
    return [...result, ...autocompleteLines];
  }
}

function addHistory(history: number[], value: number | undefined): void {
  if (value === undefined || !Number.isFinite(value)) return;
  history.push(value);
  if (history.length > HISTORY_LIMIT) history.shift();
}

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs < 1_000) return `${Math.round(value)}`;
  if (abs < 1_000_000) return `${(value / 1_000).toFixed(abs < 10_000 ? 1 : 0)}k`;
  if (abs < 1_000_000_000) return `${(value / 1_000_000).toFixed(abs < 10_000_000 ? 1 : 0)}M`;
  return `${(value / 1_000_000_000).toFixed(1)}b`;
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "--";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1_000).toFixed(2)}s`;
  return `${(ms / 1_000).toFixed(1)}s`;
}

function formatElapsed(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "--";
  if (ms < 60_000) return formatDuration(ms);
  const totalSeconds = Math.round(ms / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours}h${minutes}m${seconds}s` : `${minutes}m${seconds}s`;
}

function formatCost(cost: number): string {
  if (cost === 0) return "$0";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function shorten(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 2))}..`;
}

function hitRate(read: number, input: number, write: number): number | null {
  const prompt = read + input + write;
  return prompt > 0 ? (read / prompt) * 100 : null;
}

function promptTokens(usage: {
  input: number;
  cacheRead: number;
  cacheWrite: number;
}): number {
  return usage.input + usage.cacheRead + usage.cacheWrite;
}

async function readTextFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function readDirectory(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

function parseCpuSample(stat: string | undefined): CpuSample | undefined {
  const line = stat?.split("\n").find((candidate) => candidate.startsWith("cpu "));
  if (!line) return undefined;
  const values = line.trim().split(/\s+/).slice(1).map(Number);
  if (values.length < 5 || values.some((value) => !Number.isFinite(value))) return undefined;

  // guest and guest_nice are already included in user and nice.
  const total = values.slice(0, 8).reduce((sum, value) => sum + value, 0);
  return { idle: values[3] + values[4], total };
}

function calculateCpuPercent(
  previous: CpuSample | undefined,
  current: CpuSample | undefined,
): number | undefined {
  if (!previous || !current) return undefined;
  const totalDelta = current.total - previous.total;
  const idleDelta = current.idle - previous.idle;
  if (totalDelta <= 0) return undefined;
  return Math.max(0, Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100));
}

function parseMemoryPercent(meminfo: string | undefined): number | undefined {
  if (!meminfo) return undefined;
  const values = new Map<string, number>();
  for (const line of meminfo.split("\n")) {
    const match = line.match(/^([A-Za-z_()]+):\s+(\d+)/);
    if (match) values.set(match[1], Number(match[2]));
  }
  const total = values.get("MemTotal");
  const available = values.get("MemAvailable");
  if (!total || available === undefined) return undefined;
  return Math.max(0, Math.min(100, ((total - available) / total) * 100));
}

function normalizeTemperature(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number(raw.trim());
  if (!Number.isFinite(value)) return undefined;
  const celsius = Math.abs(value) > 1_000 ? value / 1_000 : value;
  return celsius >= -20 && celsius <= 150 ? celsius : undefined;
}

async function readCpuTemperature(): Promise<number | undefined> {
  const candidates: Array<{ rank: number; temp: number }> = [];
  for (const entry of await readDirectory("/sys/class/hwmon")) {
    const root = join("/sys/class/hwmon", entry);
    const name = (await readTextFile(join(root, "name")))?.trim().toLowerCase() ?? "";
    if (!/(coretemp|k10temp|zenpower|cpu|soc)/.test(name)) continue;

    for (const file of await readDirectory(root)) {
      if (!/^temp\d+_input$/.test(file)) continue;
      const temp = normalizeTemperature(await readTextFile(join(root, file)));
      if (temp === undefined) continue;
      const labelFile = file.replace(/_input$/, "_label");
      const label = (await readTextFile(join(root, labelFile)))?.trim().toLowerCase() ?? "";
      const rank = /(package|tctl|tdie)/.test(label)
        ? 0
        : file === "temp1_input"
          ? 1
          : /core/.test(label)
            ? 2
            : 3;
      candidates.push({ rank, temp });
    }
  }

  if (candidates.length > 0) {
    candidates.sort((left, right) => left.rank - right.rank || right.temp - left.temp);
    return candidates[0].temp;
  }

  for (const entry of await readDirectory("/sys/class/thermal")) {
    if (!entry.startsWith("thermal_zone")) continue;
    const root = join("/sys/class/thermal", entry);
    const type = (await readTextFile(join(root, "type")))?.trim().toLowerCase() ?? "";
    if (!/(x86_pkg_temp|cpu|soc|package)/.test(type)) continue;
    const temp = normalizeTemperature(await readTextFile(join(root, "temp")));
    if (temp !== undefined) return temp;
  }

  return undefined;
}

async function readGpuTelemetry(pi: ExtensionAPI): Promise<GpuTelemetry> {
  let result: Awaited<ReturnType<ExtensionAPI["exec"]>>;
  try {
    result = await pi.exec(
      "nvidia-smi",
      [
        "--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu",
        "--format=csv,noheader,nounits",
      ],
      { timeout: 2_000 },
    );
  } catch {
    return { available: false };
  }
  if (result.code !== 0) return { available: false };

  const rows = result.stdout
    .split("\n")
    .map((line) => line.split(",").map((value) => Number(value.trim())))
    .filter((values) => values.length === 4 && values.every(Number.isFinite));
  if (rows.length === 0) return { available: false };

  const memoryUsed = rows.reduce((sum, values) => sum + values[1], 0);
  const memoryTotal = rows.reduce((sum, values) => sum + values[2], 0);
  return {
    available: true,
    percent: Math.max(...rows.map((values) => values[0])),
    memoryPercent: memoryTotal > 0 ? (memoryUsed / memoryTotal) * 100 : undefined,
    tempC: Math.max(...rows.map((values) => values[3])),
  };
}

async function countConfiguredMcpServers(cwd: string): Promise<number> {
  const agentDir = resolve(
    process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
  );
  const paths = [
    join(homedir(), ".config", "mcp", "mcp.json"),
    join(agentDir, "mcp.json"),
    resolve(cwd, ".mcp.json"),
    resolve(cwd, ".pi", "mcp.json"),
  ];
  const names = new Set<string>();

  for (const path of new Set(paths)) {
    const text = await readTextFile(path);
    if (!text) continue;
    try {
      const config = JSON.parse(text) as Record<string, unknown>;
      const servers = config.mcpServers ?? config["mcp-servers"];
      if (!servers || typeof servers !== "object" || Array.isArray(servers)) continue;
      for (const name of Object.keys(servers)) names.add(name);
    } catch {
      // Invalid MCP config is surfaced by pi-mcp-adapter; keep the status bar quiet.
    }
  }

  return names.size;
}

function formatPercent(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? "--" : `${Math.round(value)}%`;
}

function formatTemperature(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? "--°" : `${Math.round(value)}°`;
}

function formatSystemTelemetry(
  metrics: SystemTelemetry,
  full: boolean,
  compact: boolean,
): string {
  const cpuPercent = formatPercent(metrics.cpuPercent);
  const cpuTemp = formatTemperature(metrics.cpuTempC);
  const memory = formatPercent(metrics.memoryPercent);
  const hasGpu = metrics.gpuAvailable !== false;
  const gpuPercent = formatPercent(metrics.gpuPercent);
  const gpuTemp = formatTemperature(metrics.gpuTempC);

  if (full) {
    const segments = [`${icon("cpu")} CPU ${cpuPercent} ${cpuTemp}`];
    if (hasGpu) {
      const vram = metrics.gpuMemoryPercent === undefined
        ? ""
        : ` / 显存 ${formatPercent(metrics.gpuMemoryPercent)}`;
      segments.push(`${icon("gpu")} GPU ${gpuPercent}${vram} ${gpuTemp}`);
    }
    segments.push(`${icon("memory")} 内存 ${memory}`);
    return segments.join(" · ");
  }

  if (compact) {
    const segments = [`${icon("cpu")}${cpuPercent.replace("%", "")}/${cpuTemp}`];
    if (hasGpu) segments.push(`${icon("gpu")}${gpuPercent.replace("%", "")}/${gpuTemp}`);
    segments.push(`${icon("memory")}${memory.replace("%", "")}`);
    return segments.join(" ");
  }

  const segments = [`${icon("cpu")}${cpuPercent}/${cpuTemp}`];
  if (hasGpu) segments.push(`${icon("gpu")}${gpuPercent}/${gpuTemp}`);
  segments.push(`${icon("memory")}${memory}`);
  return segments.join(" ");
}

function systemModuleBackground(metrics: SystemTelemetry): RGB {
  if (
    (metrics.cpuTempC ?? 0) >= 90
    || (metrics.gpuTempC ?? 0) >= 85
    || (metrics.memoryPercent ?? 0) >= 97
  ) {
    return PALETTE.systemErrorBg;
  }
  if (
    (metrics.cpuTempC ?? 0) >= 80
    || (metrics.gpuTempC ?? 0) >= 75
    || (metrics.memoryPercent ?? 0) >= 90
  ) {
    return PALETTE.systemWarnBg;
  }
  return PALETTE.systemBg;
}

function isMcpToolResult(toolName: string, details: unknown): boolean {
  if (toolName === "mcp") return true;
  if (!details || typeof details !== "object" || Array.isArray(details)) return false;
  const value = details as Record<string, unknown>;
  return typeof value.server === "string" && (
    typeof value.tool === "string" || typeof value.resourceUri === "string"
  );
}

function addUsage(stats: SessionStats, usage: UsageWithReasoning): void {
  stats.input += usage.input ?? 0;
  stats.output += usage.output ?? 0;
  stats.cacheRead += usage.cacheRead ?? 0;
  stats.cacheWrite += usage.cacheWrite ?? 0;
  stats.reasoning += usage.reasoning ?? 0;
  stats.cost += usage.cost?.total ?? 0;
}

function calculateSessionStats(ctx: ExtensionContext): SessionStats {
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
    lastModel: undefined,
    lastCacheHit: null,
  };

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      const message = entry.message as AssistantMessage;
      const usage = message.usage as UsageWithReasoning;
      stats.calls += 1;
      addUsage(stats, usage);
      stats.lastModel = {
        input: usage.input ?? 0,
        output: usage.output ?? 0,
        cacheRead: usage.cacheRead ?? 0,
        cacheWrite: usage.cacheWrite ?? 0,
        reasoning: usage.reasoning ?? 0,
      };
      stats.lastCacheHit = hitRate(usage.cacheRead, usage.input, usage.cacheWrite);
      continue;
    }

    if (entry.type === "message" && entry.message.role === "toolResult") {
      stats.toolCalls += 1;
      if (isMcpToolResult(entry.message.toolName, entry.message.details)) {
        stats.mcpCalls += 1;
      }
      if (entry.message.usage) addUsage(stats, entry.message.usage as UsageWithReasoning);
      continue;
    }

    if ((entry.type === "compaction" || entry.type === "branch_summary") && entry.usage) {
      addUsage(stats, entry.usage as UsageWithReasoning);
    }
  }

  return stats;
}

function moduleWidth(module: PowerlineModule): number {
  return visibleWidth(module.text) + 3;
}

function sectionWidth(modules: PowerlineModule[]): number {
  return modules.reduce((sum, module) => sum + moduleWidth(module), 0);
}

function renderLeftPowerline(modules: PowerlineModule[]): string {
  let line = "";
  for (let i = 0; i < modules.length; i++) {
    const module = modules[i];
    const next = modules[i + 1];
    line += `${bgRgb(module.bg)}${fgRgb(module.fg)} ${module.text} `;
    line += next
      ? `${bgRgb(next.bg)}${fgRgb(module.bg)}${HARD_SEPARATOR}`
      : `${RESET_BG}${fgRgb(module.bg)}${HARD_SEPARATOR}`;
  }
  return `${line}${RESET}`;
}

function renderRightPowerline(modules: PowerlineModule[]): string {
  if (modules.length === 0) return "";
  let line = `${RESET_BG}${fgRgb(modules[0].bg)}${LEFT_SEPARATOR}`;
  for (let i = 0; i < modules.length; i++) {
    const module = modules[i];
    const next = modules[i + 1];
    line += `${bgRgb(module.bg)}${fgRgb(module.fg)} ${module.text} `;
    if (next) {
      line += `${bgRgb(module.bg)}${fgRgb(next.bg)}${LEFT_SEPARATOR}`;
    }
  }
  return `${line}${RESET}`;
}

function renderPowerline(
  leftModules: PowerlineModule[],
  rightModules: PowerlineModule[],
  width: number,
): string {
  const left = [...leftModules];
  const right = [...rightModules];
  const gap = left.length > 0 && right.length > 0 ? 1 : 0;

  while (sectionWidth(left) + sectionWidth(right) + gap > width) {
    const candidates = [
      ...left.map((module, index) => ({ side: "left" as const, module, index })),
      ...right.map((module, index) => ({ side: "right" as const, module, index })),
    ].filter((candidate) => candidate.side === "left" ? left.length > 1 : right.length > 1);
    if (candidates.length === 0) break;
    candidates.sort((a, b) => a.module.priority - b.module.priority);
    const target = candidates[0];
    if (target.side === "left") left.splice(target.index, 1);
    else right.splice(target.index, 1);
  }

  const leftWidth = sectionWidth(left);
  const rightWidth = sectionWidth(right);
  const padding = " ".repeat(Math.max(gap, width - leftWidth - rightWidth));
  return truncateToWidth(
    renderLeftPowerline(left) + padding + renderRightPowerline(right),
    Math.max(1, width),
    "",
  );
}

function gaugeText(percent: number | null, length: number): string {
  const safePercent = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  const filled = Math.round((safePercent / 100) * length);
  return "█".repeat(filled) + "░".repeat(Math.max(0, length - filled));
}

function contextGaugeRgb(percent: number | null): RGB {
  if (percent === null) return PALETTE.contextMuted;
  if (percent < 35) return PALETTE.contextGood;
  if (percent < 70) return PALETTE.contextWarn;
  return PALETTE.contextError;
}

function sparkline(values: number[], maxLength: number): string {
  const recent = values.filter(Number.isFinite).slice(-maxLength);
  if (recent.length === 0) return "·".repeat(Math.min(6, maxLength));
  const min = Math.min(...recent);
  const max = Math.max(...recent);
  if (max === min) return "▄".repeat(recent.length);
  return recent
    .map((value) => {
      const index = Math.round(((value - min) / (max - min)) * (SPARK_CHARS.length - 1));
      return SPARK_CHARS[index];
    })
    .join("");
}

function renderDashboard(theme: Theme, items: DashboardItem[], width: number): string {
  const visible = [...items];
  const separator = theme.fg("borderMuted", "  │  ");
  const lineWidth = (): number =>
    visible.reduce((sum, item) => sum + visibleWidth(item.text), 0) +
    Math.max(0, visible.length - 1) * 5;

  while (visible.length > 1 && lineWidth() > width) {
    let removeAt = -1;
    let lowestPriority = Number.POSITIVE_INFINITY;
    for (let i = 0; i < visible.length; i++) {
      if (visible[i].priority < lowestPriority) {
        lowestPriority = visible[i].priority;
        removeAt = i;
      }
    }
    if (removeAt < 0) break;
    visible.splice(removeAt, 1);
  }

  return truncateToWidth(visible.map((item) => item.text).join(separator), Math.max(1, width), "");
}

function cacheColor(percent: number | null): ThemeColor {
  if (percent === null) return "muted";
  if (percent >= 70) return "success";
  if (percent >= 40) return "warning";
  return "error";
}

function latencyColor(ms: number | undefined): ThemeColor {
  if (ms === undefined) return "muted";
  if (ms > 8_000) return "error";
  if (ms > 4_000) return "warning";
  return "success";
}

function telemetryValue(telemetry: ApiTelemetry, now: number): {
  header?: number;
  ttft?: number;
  total?: number;
} {
  if (telemetry.activeStart === undefined) {
    return {
      header: telemetry.lastHeaderMs,
      ttft: telemetry.lastTtftMs,
      total: telemetry.lastTotalMs,
    };
  }

  return {
    header: telemetry.activeHeaderMs ?? now - telemetry.activeStart,
    ttft: telemetry.activeFirstMs,
    total: now - telemetry.activeStart,
  };
}

export default function comprehensiveStatus(pi: ExtensionAPI): void {
  const telemetry: ApiTelemetry = { headers: [], ttfts: [], totals: [] };
  const task: TaskTelemetry = {};
  let git: GitState = { available: false, branch: null, dirtyFiles: 0 };
  let renderNow: (() => void) | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let statsLeaf: string | null | undefined;
  let cachedStats: SessionStats | undefined;
  let previousEditorFactory: EditorFactory | undefined;
  let installedEditorFactory: EditorFactory | undefined;
  let systemMetrics: SystemTelemetry = {};
  let previousCpuSample: CpuSample | undefined;
  let systemRefreshRunning = false;
  let systemRefreshTimer: ReturnType<typeof setInterval> | undefined;
  let systemWarmupTimer: ReturnType<typeof setTimeout> | undefined;
  let gpuRefreshCounter = 0;
  let mcpConfiguredServers: number | undefined;
  let activeMcpCalls = 0;

  const requestRender = (): void => renderNow?.();

  const stopSystemRefresh = (): void => {
    if (systemRefreshTimer) clearInterval(systemRefreshTimer);
    if (systemWarmupTimer) clearTimeout(systemWarmupTimer);
    systemRefreshTimer = undefined;
    systemWarmupTimer = undefined;
  };

  const refreshSystemMetrics = async (forceGpu = false): Promise<void> => {
    if (systemRefreshRunning) return;
    systemRefreshRunning = true;
    const refreshGpu = forceGpu || gpuRefreshCounter % GPU_REFRESH_EVERY === 0;
    gpuRefreshCounter += 1;

    try {
      const [stat, meminfo, cpuTempC, gpu] = await Promise.all([
        readTextFile("/proc/stat"),
        readTextFile("/proc/meminfo"),
        readCpuTemperature(),
        refreshGpu ? readGpuTelemetry(pi) : Promise.resolve(undefined),
      ]);
      const cpuSample = parseCpuSample(stat);
      const cpuPercent = calculateCpuPercent(previousCpuSample, cpuSample);
      if (cpuSample) previousCpuSample = cpuSample;

      systemMetrics = {
        ...systemMetrics,
        cpuPercent: cpuPercent ?? systemMetrics.cpuPercent,
        memoryPercent: parseMemoryPercent(meminfo) ?? systemMetrics.memoryPercent,
        cpuTempC: cpuTempC ?? systemMetrics.cpuTempC,
      };
      if (gpu) {
        systemMetrics.gpuAvailable = gpu.available;
        systemMetrics.gpuPercent = gpu.percent;
        systemMetrics.gpuMemoryPercent = gpu.memoryPercent;
        systemMetrics.gpuTempC = gpu.tempC;
      }
      requestRender();
    } finally {
      systemRefreshRunning = false;
    }
  };

  const startSystemRefresh = (): void => {
    stopSystemRefresh();
    previousCpuSample = undefined;
    gpuRefreshCounter = 0;
    void refreshSystemMetrics(true);
    systemWarmupTimer = setTimeout(() => {
      systemWarmupTimer = undefined;
      void refreshSystemMetrics();
    }, 750);
    systemRefreshTimer = setInterval(() => {
      void refreshSystemMetrics();
    }, SYSTEM_REFRESH_MS);
  };

  const refreshMcpServers = async (ctx: ExtensionContext): Promise<void> => {
    mcpConfiguredServers = await countConfiguredMcpServers(ctx.cwd);
    requestRender();
  };

  const getStats = (ctx: ExtensionContext): SessionStats => {
    const leaf = ctx.sessionManager.getLeafId();
    if (!cachedStats || leaf !== statsLeaf) {
      cachedStats = calculateSessionStats(ctx);
      statsLeaf = leaf;
    }
    return cachedStats;
  };

  const refreshGit = async (ctx: ExtensionContext): Promise<void> => {
    const result = await pi.exec("git", ["status", "--porcelain=v1", "--branch"], {
      timeout: 2_000,
    });
    if (result.code === 0) {
      const lines = result.stdout.split("\n").filter((line) => line.trim());
      const header = lines[0]?.startsWith("## ") ? lines[0].slice(3) : "";
      const branch = header.startsWith("HEAD ")
        ? "detached"
        : header.split("...")[0]?.split(" ")[0] || null;
      git = {
        available: true,
        branch,
        dirtyFiles: Math.max(0, lines.length - (header ? 1 : 0)),
      };
    } else {
      git = { available: false, branch: null, dirtyFiles: 0 };
    }
    requestRender();
  };

  const scheduleGitRefresh = (ctx: ExtensionContext): void => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      void refreshGit(ctx);
    }, 250);
  };

  pi.on("before_provider_request", () => {
    telemetry.activeStart = performance.now();
    telemetry.activeHeaderMs = undefined;
    telemetry.activeFirstMs = undefined;
    requestRender();
  });

  pi.on("after_provider_response", (event) => {
    telemetry.lastStatus = event.status;
    if (telemetry.activeStart !== undefined) {
      telemetry.activeHeaderMs = performance.now() - telemetry.activeStart;
      telemetry.lastHeaderMs = telemetry.activeHeaderMs;
      addHistory(telemetry.headers, telemetry.activeHeaderMs);
    }
    requestRender();
  });

  pi.on("message_update", (event) => {
    if (event.message.role !== "assistant") return;
    if (telemetry.activeStart === undefined || telemetry.activeFirstMs !== undefined) return;
    telemetry.activeFirstMs = performance.now() - telemetry.activeStart;
    telemetry.lastTtftMs = telemetry.activeFirstMs;
    requestRender();
  });

  pi.on("message_end", (event) => {
    if (event.message.role === "toolResult") {
      cachedStats = undefined;
      requestRender();
      return;
    }
    if (event.message.role !== "assistant") return;
    if (telemetry.activeStart !== undefined) {
      telemetry.lastTotalMs = performance.now() - telemetry.activeStart;
      addHistory(telemetry.ttfts, telemetry.activeFirstMs);
      addHistory(telemetry.totals, telemetry.lastTotalMs);
    }
    telemetry.lastError = event.message.stopReason === "error"
      ? event.message.errorMessage ?? "stream error"
      : undefined;
    telemetry.activeStart = undefined;
    telemetry.activeHeaderMs = undefined;
    telemetry.activeFirstMs = undefined;
    cachedStats = undefined;
    requestRender();
  });

  pi.on("tool_execution_start", (event) => {
    if (event.toolName !== "mcp") return;
    activeMcpCalls += 1;
    requestRender();
  });

  pi.on("tool_execution_end", (event, ctx) => {
    if (["edit", "write", "bash"].includes(event.toolName)) scheduleGitRefresh(ctx);
    if (event.toolName === "mcp") {
      activeMcpCalls = Math.max(0, activeMcpCalls - 1);
      cachedStats = undefined;
      requestRender();
    }
  });

  pi.on("agent_start", () => {
    if (task.activeStart === undefined) task.activeStart = performance.now();
    requestRender();
  });

  pi.on("agent_settled", () => {
    if (task.activeStart !== undefined) {
      task.lastTotalMs = performance.now() - task.activeStart;
      task.activeStart = undefined;
    }
    requestRender();
  });

  pi.on("model_select", () => requestRender());
  pi.on("thinking_level_select", () => requestRender());
  pi.on("session_info_changed", () => requestRender());

  pi.on("session_start", async (_event, ctx) => {
    cachedStats = undefined;
    statsLeaf = undefined;
    activeMcpCalls = 0;
    mcpConfiguredServers = undefined;
    systemMetrics = {};
    void refreshGit(ctx);
    void refreshMcpServers(ctx);
    if (ctx.mode === "tui") startSystemRefresh();

    // Replace Pi's default editor with a larger Tokyo Night-style input card.
    if (ctx.mode === "tui" && ctx.hasUI) {
      previousEditorFactory = ctx.ui.getEditorComponent();
      installedEditorFactory = (tui, theme, keybindings) =>
        new SpaciousEditor(tui, theme, keybindings);
      ctx.ui.setEditorComponent(installedEditorFactory);
    }

    // Suppress Pi's separate footer; the two status rows now frame the editor.
    ctx.ui.setFooter(() => ({
      render: () => [],
      invalidate() {},
    }));
    ctx.ui.setWidget("visual-status", undefined);

    const buildStatusLines = (theme: Theme, width: number): [string, string[]] => {
          const safeWidth = Math.max(1, width - (NERD_FONT ? 2 : 0));
          const stats = getStats(ctx);
          const now = performance.now();
          const latency = telemetryValue(telemetry, now);
          const context = ctx.getContextUsage();
          const contextPercent = context?.percent ?? null;
          const cacheHit = hitRate(stats.cacheRead, stats.input, stats.cacheWrite);
          const branch = git.branch;
          const sessionName = pi.getSessionName();
          const full = safeWidth >= 200;
          const detailed = safeWidth >= 170;
          const wide = safeWidth >= 145;
          const medium = safeWidth >= 96;
          const qualifiedModel = ctx.model
            ? `${ctx.model.provider}/${ctx.model.id}`
            : "no-model";
          const model = full ? qualifiedModel : ctx.model?.id ?? qualifiedModel;
          const thinking = ctx.thinkingLevel ?? "off";
          const active = telemetry.activeStart !== undefined;
          const failed = telemetry.lastError !== undefined || (telemetry.lastStatus ?? 0) >= 400;
          const warningStatus = [408, 409, 429].includes(telemetry.lastStatus ?? 0);
          const spinner = ["◐", "◓", "◑", "◒"][Math.floor(now / 250) % 4];
          const apiText = active
            ? `${spinner} 请求中 ${formatDuration(latency.total)}`
            : telemetry.lastError
              ? withIcon("warning", shorten(telemetry.lastError, 20))
              : telemetry.lastStatus === undefined
                ? withIcon("api", "待命")
                : withIcon("api", `${telemetry.lastStatus} · 首字${formatDuration(latency.ttft)}`);

          const leftModules: PowerlineModule[] = [
            {
              id: "brand",
              text: icon("pi"),
              bg: PALETTE.brandBg,
              fg: PALETTE.brandFg,
              priority: 25,
            },
            {
              id: "model",
              text: withIcon("model", shorten(model, full ? 38 : 26)),
              bg: PALETTE.modelBg,
              fg: PALETTE.modelFg,
              priority: 100,
            },
            {
              id: "thinking",
              text: safeWidth < 120
                ? `${icon("thinking")}${thinking}`
                : withIcon("thinking", thinking),
              bg: PALETTE.thinkBg,
              fg: PALETTE.thinkFg,
              priority: 95,
            },
            {
              id: "directory",
              text: withIcon("directory", shorten(basename(ctx.cwd) || ctx.cwd, 20)),
              bg: PALETTE.dirBg,
              fg: PALETTE.dirFg,
              priority: 91,
            },
            {
              id: "system",
              text: formatSystemTelemetry(systemMetrics, full, safeWidth < 130),
              bg: systemModuleBackground(systemMetrics),
              fg: PALETTE.systemFg,
              priority: 92,
            },
          ];

          if (sessionName) {
            leftModules.push({
              id: "session",
              text: withIcon("session", shorten(sessionName, full ? 28 : 18)),
              bg: PALETTE.sessionBg,
              fg: PALETTE.sessionFg,
              priority: 18,
            });
          }

          if (branch) {
            leftModules.push({
              id: "git",
              text: withIcon(
                "git",
                `${shorten(branch, 18)}${git.dirtyFiles > 0 ? ` •${git.dirtyFiles}` : ""}`,
              ),
              bg: git.dirtyFiles > 0 ? PALETTE.gitDirtyBg : PALETTE.gitCleanBg,
              fg: PALETTE.gitFg,
              priority: 58,
            });
          }

          const rightModules: PowerlineModule[] = [
            {
              id: "context",
              text:
                `${withIcon("context", "上下文")} ` +
                `${gaugeText(contextPercent, full ? 8 : wide ? 6 : safeWidth >= 120 ? 4 : 2)} ` +
                `${contextPercent === null ? "--" : `${Math.round(contextPercent)}%`}`,
              bg: PALETTE.contextBg,
              fg: contextGaugeRgb(contextPercent),
              priority: 100,
            },
            {
              id: "api",
              text: apiText,
              bg: active
                ? PALETTE.apiBusyBg
                : failed
                  ? PALETTE.apiErrorBg
                  : warningStatus
                    ? PALETTE.apiWarnBg
                    : PALETTE.apiOkBg,
              fg: PALETTE.apiFg,
              priority: 98,
            },
          ];

          rightModules.push({
            id: "activity",
            text: detailed
              ? `${withIcon("rounds", `模型轮数 ${stats.calls}`)} · ` +
                withIcon("tools", `工具调用 ${stats.toolCalls}`)
              : safeWidth >= 120
                ? `${withIcon("rounds", `模型${stats.calls}次`)} · ` +
                  withIcon("tools", `工具${stats.toolCalls}次`)
                : `${icon("rounds")}模型${stats.calls} · ${icon("tools")}工具${stats.toolCalls}`,
            bg: PALETTE.extensionBg,
            fg: PALETTE.extensionFg,
            priority: 93,
          });

          const mcpServers = mcpConfiguredServers === undefined
            ? "--"
            : `${mcpConfiguredServers}`;
          const mcpText = detailed
            ? `MCP ${mcpServers}服务 · 调用 ${stats.mcpCalls}` +
              (activeMcpCalls > 0 ? ` · ${spinner} 调用中` : "")
            : safeWidth >= 120
              ? `MCP ${mcpServers}服/${stats.mcpCalls}次` +
                (activeMcpCalls > 0 ? ` ${spinner}` : "")
              : `MCP${mcpServers}/${stats.mcpCalls}` +
                (activeMcpCalls > 0 ? spinner : "");
          rightModules.push({
            id: "mcp",
            text: mcpText,
            bg: activeMcpCalls > 0 ? PALETTE.mcpBusyBg : PALETTE.mcpBg,
            fg: PALETTE.mcpFg,
            priority: 91,
          });

          const cacheTextColor = cacheColor(cacheHit);
          const currentTtft = latency.ttft;
          const latencyHistory = telemetry.activeFirstMs === undefined
            ? telemetry.ttfts
            : [...telemetry.ttfts, telemetry.activeFirstMs];
          const latencyDetail = medium
            ? `响应${formatDuration(latency.header)} · ` +
              `首字${formatDuration(currentTtft)} · ` +
              `完成${formatDuration(latency.total)}`
            : `响应${formatDuration(latency.header)} ` +
              `首字${formatDuration(currentTtft)} ` +
              `完成${formatDuration(latency.total)}`;
          const taskElapsed = task.activeStart === undefined
            ? task.lastTotalMs
            : now - task.activeStart;
          const totalInput = promptTokens(stats);
          const lastInput = stats.lastModel ? promptTokens(stats.lastModel) : undefined;
          const lastOutput = stats.lastModel?.output;
          const lastReasoning = stats.lastModel?.reasoning;
          const totalInputText = formatNumber(totalInput);
          const totalOutputText = formatNumber(stats.output);
          const totalReasoningText = formatNumber(stats.reasoning);
          const lastInputText = lastInput === undefined ? "--" : formatNumber(lastInput);
          const lastOutputText = lastOutput === undefined ? "--" : formatNumber(lastOutput);
          const lastReasoningText = lastReasoning === undefined ? "--" : formatNumber(lastReasoning);
          const totalUsageGroup =
            theme.fg(
              "accent",
              `${icon("usage")} 总输入${totalInputText} · 总输出${totalOutputText}`,
            ) +
            theme.fg("warning", `（推理${totalReasoningText}）`);
          const singleUsageGroup =
            theme.fg(
              "success",
              `Δ 单次输入${lastInputText} · 单次输出${lastOutputText}`,
            ) +
            (stats.lastModel
              ? theme.fg("warning", `（推理${lastReasoningText}）`)
              : "");
          const usageSeparator = theme.fg(
            "borderMuted",
            safeWidth < 80 ? "║" : " ║ ",
          );
          const usageComparison = totalUsageGroup + usageSeparator + singleUsageGroup;
          const dashboard: DashboardItem[] = [
            {
              priority: 94,
              text:
                theme.fg(cacheTextColor, `${withIcon("cache", "缓存命中")} `) +
                theme.fg(cacheTextColor, cacheHit === null
                  ? "--"
                  : `${Math.round(cacheHit)}%`) +
                (wide
                  ? theme.fg(
                      "dim",
                      ` · 读${formatNumber(stats.cacheRead)} 写${stats.cacheWrite > 0 ? formatNumber(stats.cacheWrite) : stats.cacheRead > 0 ? "未报" : "0"}`,
                    )
                  : ""),
            },
            {
              priority: 97,
              text:
                theme.fg(
                  latencyColor(currentTtft),
                  `${icon("latency")} ${sparkline(latencyHistory, wide ? 10 : medium ? 6 : 3)} `,
                ) +
                theme.fg(latencyColor(currentTtft), latencyDetail),
            },
            {
              priority: 110,
              text: usageComparison,
            },
          ];

          if (taskElapsed !== undefined) {
            dashboard.splice(2, 0, {
              priority: 105,
              text: theme.fg(
                task.activeStart === undefined ? "success" : "warning",
                withIcon(
                  "task",
                  `${task.activeStart === undefined ? "上次任务" : "任务中"} ${formatElapsed(taskElapsed)}`,
                ),
              ),
            });
          }

          if (stats.cost > 0) {
            dashboard.push({
              priority: 12,
              text: theme.fg(
                "success",
                NERD_FONT
                  ? withIcon("cost", formatCost(stats.cost).slice(1))
                  : formatCost(stats.cost),
              ),
            });
          }

          const primaryLine = renderPowerline(leftModules, rightModules, safeWidth);
          if (visibleWidth(usageComparison) > safeWidth) {
            const supportingDashboard = dashboard.filter(
              (item) => item.text !== usageComparison,
            );
            const supportingLine = renderDashboard(theme, supportingDashboard, safeWidth);
            const usageLines = [totalUsageGroup, singleUsageGroup].map((line) =>
              truncateToWidth(line, safeWidth, "")
            );
            return [
              primaryLine,
              supportingLine ? [supportingLine, ...usageLines] : usageLines,
            ];
          }

          return [
            primaryLine,
            [renderDashboard(theme, dashboard, safeWidth)],
          ];
    };

    const statusComponent = (lineIndex: 0 | 1, animated: boolean) =>
      (tui: TUI, theme: Theme) => {
        if (animated) renderNow = () => tui.requestRender();
        const ticker = animated
          ? setInterval(() => {
              if (telemetry.activeStart !== undefined || task.activeStart !== undefined) {
                tui.requestRender();
              }
            }, 500)
          : undefined;

        return {
          dispose(): void {
            if (ticker) clearInterval(ticker);
            if (animated) renderNow = undefined;
          },
          invalidate(): void {
            cachedStats = undefined;
          },
          render(width: number): string[] {
            const lines = buildStatusLines(theme, width);
            return lineIndex === 0 ? [lines[0]] : lines[1];
          },
        };
      };

    ctx.ui.setWidget("status-primary", statusComponent(0, true), {
      placement: "aboveEditor",
    });
    ctx.ui.setWidget("status-secondary", statusComponent(1, false), {
      placement: "belowEditor",
    });
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = undefined;
    stopSystemRefresh();
    activeMcpCalls = 0;
    renderNow = undefined;
    ctx.ui.setWidget("visual-status", undefined);
    ctx.ui.setWidget("status-primary", undefined);
    ctx.ui.setWidget("status-secondary", undefined);
    ctx.ui.setFooter(undefined);

    if (
      installedEditorFactory &&
      ctx.ui.getEditorComponent() === installedEditorFactory
    ) {
      ctx.ui.setEditorComponent(previousEditorFactory);
    }
    installedEditorFactory = undefined;
    previousEditorFactory = undefined;
  });

  pi.registerCommand("statusbar", {
    description: "Show custom status-bar metric definitions or refresh Git state",
    handler: async (args, ctx) => {
      if (args.trim().toLowerCase() === "refresh") {
        await Promise.all([
          refreshGit(ctx),
          refreshMcpServers(ctx),
          refreshSystemMetrics(true),
        ]);
        ctx.ui.notify("Status bar refreshed", "info");
        return;
      }
      ctx.ui.notify(
        [
          "响应 = request to HTTP response headers",
          "首字 = request to first visible model token",
          "完成 = request to complete assistant response",
          "The sparkline shows first-token latency across the last 10 model calls",
          "任务中/上次任务 = total agent wall time including model and tool calls",
          "模型轮数/工具调用 = cumulative model response rounds and tool results on this branch",
          "CPU/GPU/内存 = live Linux utilization; temperatures come from hwmon and nvidia-smi",
          "MCP N服务/调用N = configured MCP servers and cumulative MCP tool results on this branch",
          "MCP 调用中 = one or more MCP proxy calls are currently running",
          "缓存命中 = cacheRead / (input + cacheRead + cacheWrite); higher is better",
          "写未报 = the provider reports cache reads but no cache-creation/write metric",
          "总输入/总输出 = cumulative cache-inclusive prompt tokens and generated tokens on this branch",
          "单次输入/单次输出 = cache-inclusive prompt tokens and generated tokens from the latest model response",
          "推理 = the reasoning subset shown separately for total and latest-call output",
          "Cache and token totals are cumulative for the current session branch",
          "SESSION is Pi's native session name set with /name",
        ].join("\n"),
        "info",
      );
    },
  });
}
