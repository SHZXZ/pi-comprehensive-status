# Pi Comprehensive Status

Private, portable Pi editor-and-status package designed for SSH terminals. It
uses Pi's official extension API, frames a larger full-width input editor
between two status rows, hides the separate built-in footer, and does not
modify Pi source or provider payloads.

## Install from the private repository

The target device must have Pi installed and an SSH key authorized for the
`SHZXZ` GitHub account:

```bash
ssh -T git@github.com
pi install git:git@github.com:SHZXZ/pi-comprehensive-status.git@v1.0.2
```

Restart Pi or run `/reload` after installation. The `v1.0.2` tag is pinned, so
all devices receive the same source. To move to a future tagged release, run
`pi install` again with the new tag.

To follow the default branch instead of a fixed release:

```bash
pi install git:git@github.com:SHZXZ/pi-comprehensive-status.git
pi update --extensions
```

Do not install the Git package while a manual copy still exists under
`~/.pi/agent/extensions/comprehensive-status`, because both copies would own
the editor and status widgets. Move the manual directory completely outside
`~/.pi/agent/extensions` first:

```bash
mkdir -p ~/.pi/agent/backups/statusbar
mv ~/.pi/agent/extensions/comprehensive-status \
  ~/.pi/agent/backups/statusbar/comprehensive-status.manual
pi install git:git@github.com:SHZXZ/pi-comprehensive-status.git@v1.0.2
```

The Tokyo Night theme is optional but recommended. When using
`@wishx127/pi-tokyo-night`, keep its theme resource enabled and disable its
competing extension/footer resource through `pi config`. This package contains
no provider configuration, `auth.json`, sessions, API keys, tokens, cookies, or
MCP credentials.

## Cross-device migration

1. Install the same Pi version or a compatible newer version.
2. Configure GitHub SSH access on the new device.
3. Install this package with the pinned tag shown above.
4. Configure the local terminal for truecolor and optional transparency.
5. Set `POWERLINE_NERD_FONTS=1` only when that device uses a Nerd Font.
6. Configure Pi providers and credentials separately; never copy them through this repository.

Linux CPU/RAM telemetry reads `/proc`; CPU temperature uses `hwmon`/thermal
zones, and NVIDIA telemetry uses `nvidia-smi`. Missing facilities are omitted
automatically. Other status, editor, Git, context, token, timing, task, and MCP
features continue to work independently.

## Visual layout

```text
primary Powerline status
╭────────────────────────────────────────────────────────────────────╮
│ ❯                                                                  │
│                                                                    │
│                                                                    │
╰────────────────────────────────────────────────────────────────────╯
secondary telemetry dashboard
```

The input card follows Tokyo Night's official `CustomEditor` composition
pattern, with its muted purple frame and prompt accent but without the rain
panel. It has three body rows at minimum and grows normally for multiline
input. The primary row uses `aboveEditor`; the telemetry row uses
`belowEditor`.

The first row is a responsive, truecolor Powerline strip with a flexible middle gap:

- left: Pi brand, provider/model, thinking, directory, live CPU/GPU/RAM usage and temperatures, native session name, Git
- right: context progress bar, live API state/latency, model rounds, tool calls, MCP usage
- system telemetry reads Linux `/proc`, `hwmon`, and `nvidia-smi`; unavailable GPU or temperature fields are omitted automatically
- MCP shows merged configured-server count, current-branch proxy call count, and an active-call spinner
- context bar colors: green below 35%, yellow from 35% to below 70%, red at 70%+

The row below the input editor is a transparent dashboard:

- prompt-cache hit percentage plus read/write totals (no progress bar)
- first-token latency sparkline for the last 10 calls
- explicit `响应` / `首字` / `完成` timing labels
- paired cumulative `总输入/总输出` and latest-model-call `单次输入/单次输出` groups
- total and single-call output each show their own reasoning subset
- active or last total task wall time across all model and tool calls
- cost only when the provider reports a non-zero value

Colors use distinct roles rather than one hue: violet for model/thinking, cyan
for directory, teal/amber/red for system health, green/amber for Git, steel blue
for MCP, and blue/green/red for live API state. Labels compact before modules are
removed when the terminal narrows, so important model, API, context, cache,
token, and task state remain visible.

## Commands

```text
/name                       Set Pi's native session name
/statusbar                  Explain metrics
/statusbar refresh          Refresh Git, MCP, and system telemetry
```

## Font modes

The default SSH-safe icon set favors literal meaning over decoration:

```text
π app   ⚡ thinking level   ⌂ directory   # session   ⎇ Git
▣ CPU   ▦ GPU   ▤ memory   ◫ context   ● API   ↻ model rounds
⚙ tools   ↺ cache reuse   ◷ time/latency   Σ totals   Δ latest call   ! warning   $ cost
```

The model name deliberately has no generic fallback pictogram. Light `›` / `‹`
separators replace the heavier triangle separators in standard Unicode mode.
To opt into matching Nerd Font chip, folder, branch, database, clock, and tool
icons plus true Powerline separators after configuring a Nerd Font locally:

```bash
POWERLINE_NERD_FONTS=1 pi -c
```

If private-use icons appear as a diamond with a question mark, remove that
environment variable and run `/reload`, or restart Pi without it.

## Notes

- `上下文 N%` is the active prompt/context share of the selected model window; lower leaves more capacity.
- `缓存命中 N%` is cached prompt tokens divided by all prompt tokens; higher is more efficient.
- `写未报` means the provider exposes cache-read tokens but no cache-creation/write metric (normal for OpenAI Responses).
- `待命` means no provider request is currently streaming; it is not a disabled state.
- `模型轮数N·工具调用N` counts all model response rounds and tool results on the active session branch.
- `▣` is aggregate Linux CPU utilization and package temperature; `▦` is the busiest NVIDIA GPU utilization and hottest GPU temperature; `▤` is host RAM utilization. Nerd Font mode substitutes matching chip, display, and memory glyphs.
- On very wide terminals the GPU segment also includes aggregate VRAM utilization. CPU/RAM refresh every 3 seconds and `nvidia-smi` refreshes every second system sample.
- System telemetry is teal normally, amber at CPU 80°C / GPU 75°C / RAM 90%, and red at CPU 90°C / GPU 85°C / RAM 97%.
- `MCP N服务/调用N` shows configured MCP server names merged from standard and Pi config layers plus completed `mcp` proxy calls on the active branch. Lazy servers are counted as configured, not falsely reported as connected.
- `MCP 调用中` or its spinner means at least one `mcp` proxy call is active.
- `总输入` is cumulative prompt tokens on the active branch: `input + cacheRead + cacheWrite`, including usage reported by nested tools and summaries. `总输出（推理）` is cumulative generated output with reasoning as its subset.
- `单次输入` is prompt tokens from the most recent assistant/model response using the same cache-inclusive formula. `单次输出（推理）` is that response's generated output and reasoning subset.
- `Σ` identifies the cumulative group and `Δ` identifies the latest-call group. Both always use the full Chinese labels `总输入/总输出/单次输入/单次输出`; responsive rendering never substitutes abbreviations such as `总/次/入/出`.
- The two groups are kept in one highest-priority dashboard item. They fit together at 80 columns with the `║` divider; if longer values exceed the terminal width, the complete total and single-call groups wrap onto separate lines instead of being truncated.
- Million-scale token values use an uppercase `M` suffix across total/single input, output, reasoning, and cache totals.
- `任务中/上次任务` measures the whole agent run, including every model round, tool call, retry, and queued continuation until Pi settles.
- `响应` is time to HTTP response headers, `首字` is time to the first visible token,
  and `完成` is time to the complete assistant response.
- Latency history is process-local and resets after `/reload` or restarting Pi.
- Token/cache/cost totals come from the current session branch and survive resume.
- Cache hit rate is `cacheRead / (input + cacheRead + cacheWrite)`.
- Cost is hidden when custom model cost rates are configured as zero.
- Bitmap images are not used in the status region: they are multi-cell terminal assets
  and are not reliably supported by SSH/WindTerm. Background images remain a
  local terminal setting; the status region uses icons, gauges, and sparklines instead.
- Tokyo Night remains the selected color theme, but its extension is disabled in
  `~/.pi/agent/settings.json` so this extension can own the editor and status region.
