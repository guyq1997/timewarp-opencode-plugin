# Timewarp OpenCode 插件

Timewarp 是一个本地 OpenCode 插件，用于快照穿越和基于 issue 的优化循环。

文档入口：

- 英文 README：[`README.md`](./README.md)
- 协议（中文）：[`TIMEWARP_PROTOCOL.md`](./TIMEWARP_PROTOCOL.md)
- 协议（英文）：[`TIMEWARP_PROTOCOL.en.md`](./TIMEWARP_PROTOCOL.en.md)

## 提供的工具

- `timewarp_travel`
- `timewarp_return`
- `timewarp_issue_list(status?)`（默认 `open`，传 `all` 返回全部）
- `timewarp_issue_get(issue_id)`
- `issue_report(...)`（返回 `ok`）

## 安装

### 方案 A：全局安装（推荐）

```bash
mkdir -p ~/.config/opencode/plugins
curl -fsSL "https://raw.githubusercontent.com/guyq1997/timewarp-opencode-plugin/main/timewarp.js" -o ~/.config/opencode/plugins/timewarp.js
```

### 方案 B：项目级安装（仅当前项目）

```bash
mkdir -p .opencode/plugins
curl -fsSL "https://raw.githubusercontent.com/guyq1997/timewarp-opencode-plugin/main/timewarp.js" -o .opencode/plugins/timewarp.js
```

安装后重启 OpenCode。

## Agent 使用前引导（重要）

建议每次使用时都先让 Agent 阅读协议，再调用 timewarp 工具。

可直接复制这段提示：

```text
在使用任何 timewarp 工具前，请先阅读 @TIMEWARP_PROTOCOL.md（或 @TIMEWARP_PROTOCOL.en.md），
并严格按协议执行 issue 记录与优化流程。
```

也可以把这段放进项目的 `AGENTS.md`。

## 说明

- 插件运行数据保存在工作区 `.timewarp/` 目录。
- `issue_report` 会在 `.timewarp/issues/<issue_id>/` 下写入 issue 相关文件。
- `chat.md` 从 `context.messages` 导出，仅保留对话和 tool 输入/输出块。
