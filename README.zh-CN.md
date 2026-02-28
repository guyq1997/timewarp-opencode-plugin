# Timewarp OpenCode 插件

Timewarp 是一个本地 OpenCode 插件，用于快照穿越和基于 issue 的优化循环。

协议文档：
- 中文：`TIMEWARP_PROTOCOL.md`
- 英文：`TIMEWARP_PROTOCOL.en.md`

## 提供的工具

- `timewarp_travel`
- `timewarp_return`
- `timewarp_issue_list(status?)`（默认 `open`，传 `all` 返回全部）
- `timewarp_issue_get(issue_id)`
- `issue_report(...)`

## 安装

### 全局安装（所有项目可用）

```bash
mkdir -p ~/.config/opencode/plugins
cp timewarp.js ~/.config/opencode/plugins/timewarp.js
```

### 项目级安装（仅当前项目）

```bash
mkdir -p .opencode/plugins
cp timewarp.js .opencode/plugins/timewarp.js
```

安装后重启 OpenCode。

## 说明

- 插件运行数据保存在工作区 `.timewarp/` 目录。
- `issue_report` 会在 `.timewarp/issues/<issue_id>/` 下写入 issue 相关文件。
- `chat.md` 从 `context.messages` 导出，仅保留对话和 tool 输入/输出。
