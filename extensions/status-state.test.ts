import assert from "node:assert/strict";
import test from "node:test";
import {
  cacheHitRate,
  calculateSessionStats,
  fitDashboardItems,
  formatMobileStatusLines,
  formatTodoWorkflowText,
  resolveTodoWorkflowState,
  terminalCellWidth,
} from "./status-state.ts";

test("session stats match Pi native whole-session usage semantics", () => {
  const stats = calculateSessionStats([
    {
      type: "message",
      message: {
        role: "assistant",
        usage: {
          input: 100,
          output: 20,
          cacheRead: 900,
          cacheWrite: 0,
          reasoning: 5,
          cost: { total: 1.5 },
        },
      },
    },
    {
      type: "message",
      message: {
        role: "assistant",
        usage: {
          input: 40,
          output: 8,
          cacheRead: 60,
          cacheWrite: 0,
          reasoning: 2,
          cost: { total: 0.5 },
        },
      },
    },
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "nested-model",
        details: { server: "search", tool: "query" },
        usage: {
          input: 7,
          output: 3,
          cacheRead: 0,
          cacheWrite: 0,
          cost: { total: 0.2 },
        },
      },
    },
    {
      type: "compaction",
      usage: {
        input: 50,
        output: 10,
        cacheRead: 100,
        cacheWrite: 0,
        cost: { total: 0.3 },
      },
    },
    {
      type: "branch_summary",
      usage: {
        input: 20,
        output: 5,
        cacheRead: 0,
        cacheWrite: 30,
        cost: { total: 0.1 },
      },
    },
  ]);

  assert.deepEqual(stats, {
    calls: 2,
    input: 217,
    output: 46,
    cacheRead: 1_060,
    cacheWrite: 30,
    reasoning: 7,
    cost: 2.6,
    toolCalls: 1,
    mcpCalls: 1,
  });
});

test("cache hit rate keeps cached input separate from native input", () => {
  assert.equal(cacheHitRate({ input: 120, cacheRead: 800, cacheWrite: 80 }), 80);
  assert.equal(cacheHitRate({ input: 0, cacheRead: 0, cacheWrite: 0 }), null);
});

test("responsive dashboard always preserves cache before optional metrics", () => {
  const items = [
    { id: "cache", width: 26, priority: 120 },
    { id: "latency", width: 34, priority: 105 },
    { id: "usage", width: 42, priority: 115 },
    { id: "task", width: 18, priority: 100 },
    { id: "cost", width: 8, priority: 12 },
  ];

  assert.deepEqual(fitDashboardItems(items, 200), ["cache", "latency", "usage", "task", "cost"]);
  assert.deepEqual(fitDashboardItems(items, 177), ["cache", "latency", "usage", "task", "cost"]);
  assert.deepEqual(fitDashboardItems(items, 145), ["cache", "latency", "usage", "task"]);
  assert.deepEqual(fitDashboardItems(items, 120), ["cache", "latency", "usage"]);
  assert.deepEqual(fitDashboardItems(items, 96), ["cache", "usage"]);
  assert.deepEqual(fitDashboardItems(items, 80), ["cache", "usage"]);
  assert.deepEqual(fitDashboardItems(items, 60), ["cache"]);
});

test("mobile status keeps the requested metrics in two compact rows", () => {
  assert.deepEqual(formatMobileStatusLines({
    model: "provider/deepseek-v4-flash",
    thinking: "max",
    workflow: { mode: "idle", completed: 0, total: 0 },
    cacheHit: 80,
    responseMs: 1200,
    firstTokenMs: 400,
    taskMs: 8600,
  }, 36), [
    "◇ deepseek-v4-flash › ✦max › ◇空闲",
    "缓存80%│响应1.2s│首字400ms│任务✓8.6s",
  ]);
});

test("mobile task timer carries into minutes and hours", () => {
  const render = (taskMs: number, active: boolean) => formatMobileStatusLines({
    model: "provider/deepseek-v4-flash",
    thinking: "max",
    workflow: { mode: "idle", completed: 0, total: 0 },
    cacheHit: 80,
    responseMs: 1200,
    firstTokenMs: 400,
    taskMs,
    taskActive: active,
  }, 36)[1];
  assert.match(render(754_000, true), /任务◷12m34s|任务◷12m/);
  assert.match(render(5_220_000, false), /任务✓1h27m/);
});

test("mobile status stays two rows and preserves all metrics at 36 cells", () => {
  const lines = formatMobileStatusLines({
    model: "provider/deepseek-v4-flash",
    thinking: "max",
    workflow: { mode: "idle", completed: 0, total: 0 },
    cacheHit: 80,
    responseMs: 1200,
    firstTokenMs: 400,
    taskMs: 8600,
  }, 36);
  assert.equal(lines.length, 2);
  assert.match(lines[1], /缓存80%/);
  assert.match(lines[1], /响应1\.2s/);
  assert.match(lines[1], /首字400ms/);
  assert.match(lines[1], /任务✓8\.6s/);
  assert.ok(lines.every((line) => terminalCellWidth(line) <= 36));
});

test("mobile status truncates long model names without changing row count", () => {
  const lines = formatMobileStatusLines({
    model: "provider/a-very-long-model-name",
    thinking: "high",
    workflow: { mode: "executing", completed: 2, total: 5 },
    cacheHit: null,
    taskActive: true,
  }, 24);
  assert.equal(lines.length, 2);
  assert.ok(lines.every((line) => terminalCellWidth(line) <= 24));
  assert.match(lines[0], /◇/);
  assert.match(lines[1], /缓存/);
});

test("todo workflow defaults to idle", () => {
  assert.deepEqual(resolveTodoWorkflowState([]), {
    mode: "idle",
    completed: 0,
    total: 0,
  });
});

test("the latest rpiv todo tool result drives workflow state", () => {
  const entries = [
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "todo",
        details: { tasks: [{ id: 1, status: "pending" }], nextId: 2 },
      },
    },
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "todo",
        details: {
          tasks: [
            { id: 1, status: "completed" },
            { id: 2, status: "in_progress" },
            { id: 3, status: "pending" },
            { id: 4, status: "deleted" },
          ],
          nextId: 5,
        },
      },
    },
  ];

  assert.deepEqual(resolveTodoWorkflowState(entries), {
    mode: "executing",
    completed: 1,
    total: 3,
  });
});

test("pending and completed-only todo states are distinguished", () => {
  const entry = (tasks: Array<Record<string, unknown>>) => [{
    type: "message",
    message: { role: "toolResult", toolName: "todo", details: { tasks, nextId: 10 } },
  }];
  assert.equal(resolveTodoWorkflowState(entry([{ id: 1, status: "pending" }])).mode, "pending");
  assert.deepEqual(resolveTodoWorkflowState(entry([{ id: 1, status: "completed" }])), {
    mode: "idle",
    completed: 1,
    total: 1,
  });
});

test("legacy plan and malformed todo entries are ignored", () => {
  assert.deepEqual(resolveTodoWorkflowState([
    { type: "custom", customType: "plan-mode", data: { enabled: true } },
    { type: "message", message: { role: "toolResult", toolName: "todo", details: null } },
  ]), { mode: "idle", completed: 0, total: 0 });
});

test("todo workflow labels stay explicit at full and compact widths", () => {
  assert.equal(formatTodoWorkflowText({ mode: "idle", completed: 0, total: 0 }), "空闲");
  assert.equal(formatTodoWorkflowText({ mode: "pending", completed: 1, total: 3 }, true), "待办1/3");
  assert.equal(formatTodoWorkflowText({ mode: "executing", completed: 2, total: 5 }), "执行中 2/5");
  assert.equal(formatTodoWorkflowText({ mode: "executing", completed: 0, total: 0 }, true), "执行");
});
