# Pi Comprehensive Status

强大、优雅且跨平台的 Pi Coding Agent 增强状态栏与遥测仪表盘扩展。支持 Linux、macOS 与 Windows。

---

## 特性亮点

- **双层状态显示**：
  - **主状态栏（Powerline Statusline）**：实时展示当前模型、供应商（Provider）、Thinking 思考档位、当前工作区 Git 分支与状态、系统硬件负载（CPU / 内存 / GPU / 温度）及上下文窗口利用率。
  - **二次遥测仪表盘（Telemetry Dashboard）**：统计当前会话累计 Token 消耗、KV Cache 命中率、首字延迟（TTFT）、接口总响应耗时及任务时间。
- **跨平台原生支持**：
  - Linux：直接读取 `/proc/stat`、`/proc/meminfo` 与 `hwmon` 温度传感。
  - Windows：智能采集 Windows CPU/内存计数器，支持 LibreHardwareMonitor 与 WMI 回退。
  - macOS：原生兼容。
  - 支持 NVIDIA 独立显卡显存与负载遥测（通过 `nvidia-smi` 自适应检测）。
- **零配置开箱即用**：自动适配终端宽度，优雅折叠与截断，保障极佳的可读性。

---

## 一键安装

在任何终端中，使用 Pi 内置的包管理器直接安装：

```bash
pi install git:github.com/SHZXZ/pi-comprehensive-status
```

或者在你的 `~/.pi/agent/settings.json`（或项目配置）中添加到 `packages`：

```json
{
  "packages": [
    "git:git@github.com:SHZXZ/pi-comprehensive-status.git"
  ]
}
```

启动 Pi 即可自动加载并生效！

---

## 常用命令

- `/statusbar`：切换或查看状态栏配置。
- `/statusbar refresh`：立即刷新硬件遥测指标。

---

## 开源协议

[MIT License](LICENSE)
