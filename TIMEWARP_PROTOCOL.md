# Timewarp: 时光穿梭式自优化协议（Agent + Plugin）

English version: [TIMEWARP_PROTOCOL.en.md](./TIMEWARP_PROTOCOL.en.md)

这份文档定义一个面向 Agent 的“先记录摩擦点、后统一优化”的闭环流程：

- 正常执行用户任务时，不强行打断做优化
- 一旦发现不连贯/反复/失败等摩擦点，先结构化记录为 Issue
- 进入优化周期时，Agent 使用“时光机”切回当时的 Snapshot，在隔离环境中多轮实验
- 实验验证有效后，再回到“现在”，把方案按记忆（例如 `experiment.md`）复现到现实工作区

> 关键原则：实验过程中的工作区改动不直接带回现在；只带回“记忆”（例如 `experiment.md` 的可复现步骤）。

---

## 1. 目标与非目标

### 目标

- 让 Agent 能在不干扰用户主线的情况下持续收集摩擦点
- 让 Agent 能回到问题发生时的工作区状态进行可重复的对照实验
- 用明确的状态机与护栏避免误覆盖当前工作区
- 让优化结果可验证、可回放、可复现

### 非目标

- 不试图替代 git（可与 git 并存，但不依赖 git）
- 不要求把实验期产生的工作区内容永久保存（只保留必要元数据/记录）

---

## 2. 核心概念

- **Workspace（工作区）**：Agent 正在操作的主目录（例如本项目根目录）。
- **Session**：一次对话/执行周期。每个新 session 触发创建一次初始 Snapshot。
- **Snapshot（快照）**：某一时间点的工作区内容拷贝 + 元信息，用于回到过去进行实验。
- **Issue（问题单）**：一次摩擦点的结构化记录，强关联一个 Snapshot。
- **Experiment Run（实验轮次）**：在某个 Snapshot 上的一次或多次尝试与结果记录，可多轮迭代。

---

## 3. 目录与存储位置（推荐）

极简方案将 Timewarp 元数据放在工作区内的固定目录，并且**永远排除**它不进入 Snapshot、不被切换覆盖：

```
<workspace>/.timewarp/
  state.json
  snapshots/
    <snapshot_id>/
      snapshot.json
      workspace/            # 工作区拷贝（排除清单生效）
  issues/
    <issue_id>/
      issue.json
      chat.md              # issue_report 时由系统自动导出
      experiment.md        # issue_report 时自动生成实验记录模板
  present_backup/
    <backup_id>/            # travel() 前的现实工作区备份
```

---

## 4. 快照（Snapshot）

### 创建时机

- `on_session_start`：每当出现新的 session，Plugin 自动创建一个 Snapshot。

### 拷贝策略

- Snapshot = 工作区内容拷贝（排除列表生效） + `snapshot.json`
- 排除列表必须可配置，并具有合理默认值（见下方）。

### 默认排除（建议）

这些目录通常体积大且可重建，不应进入快照：

- 依赖与构建：`node_modules/`, `.venv/`, `dist/`, `build/`, `.next/`, `target/`, `.cache/`
- 运行时：`*.log`, `*.pid`, socket 文件
- 系统：`.DS_Store`
- Timewarp 自身目录：`.timewarp/`（必须强制排除）

### Snapshot 元信息格式（snapshot.json）

```json
{
  "snapshot_id": "s_20260228_153012_ab12cd",
  "created_at": "2026-02-28T15:30:12Z",
  "session_id": "sess_...",
  "workspace_root": "/abs/path/to/workspace",
  "exclude_globs": ["node_modules/", ".venv/", "dist/", "build/", ".next/", "target/", ".cache/", ".DS_Store", ".timewarp/"],
  "env_fingerprint": {
    "platform": "darwin",
    "node": "v20.11.0",
    "python": "3.11.7",
    "go": "1.22.1"
  },
  "initial_task_hint": "(可选) session 开始时的用户目标摘要"
}
```

---

## 5. Issue（摩擦点记录）

### 记录原则

- 不打断主线：任务能做完就先做完；同时把摩擦点写入 Issue
- 强关联 Snapshot：每个 Issue 必须包含 `snapshot_id`
- 强结构化：避免只写散文，必须能支持后续批处理与排序

### Issue 目录结构（每个 Issue 一个文件夹）

```
.timewarp/issues/<issue_id>/
  issue.json
  chat.md        # 默认由系统自动导出该 session 对话
  experiment.md  # 默认生成：实验记录（成功条件 + 修复步骤 + 验证方式 + 结论）
```

### Issue 格式（issue.json）

```json
{
  "issue_id": "i_20260228_153500_ef34gh",
  "created_at": "2026-02-28T15:35:00Z",
  "status": "open",
  "snapshot_id": "s_20260228_153012_ab12cd",
  "task_context": "用户让 Agent 完成 X 任务",
  "symptom": "出现不连贯/多轮反复/失败的具体表现",
  "success_criteria": "(必填) 修复后应满足的成功条件/验收标准（尽量可验证）",
  "suspected_cause": "(可选) 可能原因",
  "chat_file": "chat.md",
  "chat_summary": "(可选/短) 1-3 句概括当时对话与摩擦点（不要长）",
  "experiment_file": "experiment.md"
}
```

### success_criteria 写法（必须清楚）

- 写“可验证的结果”，不要写泛泛的感觉（例如“更顺畅”）
- 优先包含：
  - 触发路径（在什么任务/什么输入下）
  - 期望行为（Agent 应该怎么做/不应该怎么做）
  - 可观察证据（例如特定命令成功、某类错误不再出现、重试次数<=1）

示例：

```text
在用户要求执行 X 任务时，Agent 不应再次漏掉 Y 前置步骤；一次尝试内完成，且不会出现 Z 错误；若需要额外信息，应一次性提出并说明原因。
```

### chat.md 的体积控制（不要巨大）

`chat.md` 保存“该 Issue 对应 session 当时的对话内容”，并且默认由系统自动导出。

当前阶段先不强制控制体积；后续如遇到存储/性能问题，再引入窗口化与截断策略。

仍然必须脱敏：不要写入密钥/令牌/个人敏感信息；必要时用 `***REDACTED***`

建议 `chat.md` 采用固定头部，便于机器读取：

```md
session_id: sess_...
captured_at: 2026-02-28T15:35:02Z
selection: window(before=6, after=2)
redaction: applied

---

[user] ...

[assistant] ...

[tool:bash] (optional) ...
```

> 说明：用“对话摘录 + 摘要”替代 `repro_steps` 的好处是更贴近真实触发场景；缺点是可执行的复现步骤可能不够明确，因此建议把可执行验证写入 `experiment.md`（如有）。

---

## 6. 时光机工具（必须）

时光机由两个工具组成：去过去、回现在。它们通过 `.timewarp/state.json` 管理状态机，禁止嵌套穿越。

### 状态文件（state.json）

`state.json` 位于 `.timewarp/` 中，并且 `.timewarp/` 必须永远在排除列表中，确保不会被快照覆盖。

```json
{
  "workspace_root": "/abs/path/to/workspace",
  "session_id": "sess_...",
  "session_snapshot_id": "s_...",
  "mode": "present",
  "current_snapshot_id": null,
  "backup_path": null,
  "entered_at": null,
  "guard_token": "(可选) 防并发/重入"
}
```

说明：

- `session_snapshot_id` 由 `on_session_start` 写入，表示“当前 session 创建的快照”，用于 Issue 自动关联。

`mode` 取值：

- `present`：当前处于现实工作区
- `past`：当前已切到某个 snapshot 的工作区视图

### 工具 1：travel(snapshot_id)

语义：切换工作区到指定 Snapshot，并对当前“现在”工作区做完整备份。

硬性规则：

- 只有当 `mode=present` 才允许执行
- 执行前必须备份当前工作区到 `present_backup/...`
- 恢复 Snapshot 时必须应用排除列表（避免覆盖 Timewarp 自身数据）

输出：

- 更新 `state.json`：`mode=past`，写入 `current_snapshot_id` 与 `backup_path`

### 工具 2：return()

语义：丢弃当前“过去视图”的工作区改动，将工作区恢复到 travel 前的“现在”。

硬性规则：

- 只有当 `mode=past` 才允许执行
- 恢复必须来自 `backup_path`，恢复后将 `mode` 置回 `present`
- 实验期间对工作区的改动不需要保存到 snapshot（只保留实验记录）

---

## 7. 实验记录（把“记忆”结构化）

极简方案不单独维护 experiments 目录。

- Agent 在实验期间需要保留的“记忆”，写到该 Issue 目录下的 `experiment.md`（可选）。
- `experiment.md` 用于回到现在后复现修复步骤与验证方式，同时不引入额外记录系统。

---

## 8. Agent 优化 Protocol（标准 7 步）

当 Agent 进入“优化周期”（而不是用户主线任务）时，必须按以下步骤执行：

1) **挑选 Issue**：优先通过 `timewarp_issue_list()` 枚举，再用 `timewarp_issue_get(issue_id)` 读取详情；从 `status=open` 中按影响/频率/可复现度排序选一个
2) **进入过去**：调用 `travel(issue.snapshot_id)`
3) **重现问题**：严格按 `chat_summary`（以及可选 `chat.md`）的当时对话上下文复现摩擦点
4) **提出最小方案**：优先选择“改一个点就能验证”的方案（例如新增/改造工具、调整策略、补文档、改流程）
5) **迭代实验**：实现 -> 验证；失败则回到第 4 步进入下一轮（把关键结论写入 `experiment.md`（如有）或保留在 Agent 记忆中）
6) **回到现在**：调用 `return()`（丢弃过去视图的工作区改动）
7) **复现并收敛**：在现在工作区按 `experiment.md`（如有）复现改动，并按其中的验证方式验证；成功则将 Issue 标记为 `fixed`

---

## 9. Hooks（Plugin 责任边界）

Plugin 负责“可回放基础设施”，极简方案只保留一个 hook：

- `on_session_start`：创建 Snapshot；写入 `.timewarp/state.json.session_snapshot_id`；同时执行快照清理（见下方）

### on_session_start 的快照清理规则（极简）

每次创建新 session 的 Snapshot 后，删除**没有任何 Issue 关联**的历史 Snapshot（避免快照无限增长）。

判定方式：

- 读取 `.timewarp/issues/*/issue.json` 中全部 `snapshot_id`
- 对 `.timewarp/snapshots/<snapshot_id>/` 做集合差
- 不在引用集合中的 snapshot 视为“未关联”，可删除

硬性护栏：

- 永远不要删除本次新创建的 snapshot
- 如果 `state.json.mode=past`（处于穿越中），不要做清理（避免删除当前 past 依赖的 snapshot）

---

## 10. Agent 工具：Issue Report（创建 Issue + 关联快照 + 保存对话）

极简方案不再依赖额外 hooks 记录摩擦点；改为给 Agent 一个明确工具用于上报。

### 工具语义

`issue_report(...)`：创建一个新的 Issue，并自动完成：

- 关联当前 session 的 Snapshot（读取 `.timewarp/state.json.session_snapshot_id`）
- 由系统自动导出当前 session 的对话 history 到该 Issue 的 `chat.md`
- 生成一个初始的 `experiment.md` 模板，供后续写入实验步骤/验证/结论

### 输入（建议）

- `task_context`：当时用户让 Agent 做什么
- `symptom`：摩擦点/不连贯/失败表现
- `success_criteria`：修复后应满足的成功条件（必填、可验证）
- `suspected_cause`：（可选）可能原因
- `chat_summary`：（可选）1-3 句摘要

### 输出（落盘）

在 `.timewarp/issues/<issue_id>/` 写入：

- `issue.json`：包含 `snapshot_id`、`chat_file: "chat.md"`、`experiment_file: "experiment.md"`
- `chat.md`：由系统自动导出的当前 session 转录（仅保留对话与 tool 输入/输出，必须脱敏）
- `experiment.md`：初始模板（包含成功条件、实验步骤占位、验证方式占位、结论占位）

### 输出（工具返回）

- `issue_report` 返回简单成功标记：`ok`

### 必要规则

- **原子性**：`issue.json`、`chat.md`、`experiment.md` 要么都写成功，要么都不写（避免半成品）
- **脱敏**：对 token/key/password/Authorization 等敏感信息做 `***REDACTED***` 替换
- **快照关联失败即失败**：如果没有 `session_snapshot_id`，工具应直接报错并提示需要先执行 `on_session_start`

### 补充工具（Issue 检索）

为减少手工目录遍历，建议提供两个检索工具：

- `timewarp_issue_list(status?)`：默认仅返回 `status=open`；传 `status="all"` 返回全部 issue（列表项至少包含 `issue_id`、`status`、`created_at`）
- `timewarp_issue_get(issue_id)`：返回 issue 详情（至少包含 `success_criteria`、`snapshot_id`、`issue/chat/experiment` 文件路径）

错误处理建议：

- 无效 `issue_id` 返回结构化错误（例如 `code=INVALID_ISSUE_ID`）
- issue 不存在返回结构化错误（例如 `code=ISSUE_NOT_FOUND`）

建议 `experiment.md` 初始模板：

```md
# Experiment

## Issue
- id: <issue_id>
- snapshot_id: <snapshot_id>

## Success Criteria
<从 issue.json.success_criteria 复制/引用，保持一致>

## Repro
<可选：最小复现步骤>

## Changes
<实验中做了哪些改动>

## Validation
<如何验证成功/失败（命令/步骤/判据）>

## Result
<成功/失败 + 证据>
```

---

## 11. 护栏与一致性检查（强烈建议）

- 禁止嵌套穿越：`mode=past` 时调用 `travel()` 必须拒绝
- 备份恢复校验：
  - travel 前写入“工作区指纹”（文件数、总大小、抽样 hash）到备份元信息
  - return 后做快速一致性检查，发现异常应立即停止进一步操作并告警
- 并发防护：`guard_token` 或文件锁，避免并发写导致 state 损坏
- 永久排除：Timewarp 元数据目录必须永远不被快照覆盖

---

## 12. 最小实现清单（MVP）

- [ ] `on_session_start` 自动创建 snapshot
- [ ] `issues` 结构化落盘（手动/自动均可）
- [ ] `travel(snapshot_id)` + `return()` + `state.json` 状态机
- [ ] 默认排除清单与可配置机制
