# Timewarp: Time-Travel Self-Optimization Protocol (Agent + Plugin)

This document defines a closed-loop workflow for agents: **record friction first, optimize later**.

- Do not interrupt the user’s main task for optimization work.
- When incoherence/retries/failures appear, record them as structured Issues first.
- During optimization cycles, use a snapshot-based "time travel" environment for isolated experiments.
- After validation, return to the present workspace and re-apply the proven approach.

> Core rule: workspace changes made during experiments are not brought back directly; only reproducible memory (for example, `experiment.md`) is brought back.

---

## 1. Goals and Non-Goals

### Goals

- Continuously collect friction points without blocking the user’s primary workflow.
- Reproduce and test fixes against the exact historical workspace state.
- Prevent accidental overwrite of current workspace via explicit state machine + guardrails.
- Make optimization outcomes verifiable, replayable, and reproducible.

### Non-Goals

- Not a replacement for git (can coexist with git, but does not depend on it).
- No requirement to permanently preserve all experiment workspace artifacts.

---

## 2. Core Concepts

- **Workspace**: the active project directory.
- **Session**: one chat/execution cycle; each new session creates an initial snapshot.
- **Snapshot**: a copy of workspace contents + metadata at a point in time.
- **Issue**: a structured friction record strongly linked to one snapshot.
- **Experiment Run**: one or more attempts on a snapshot with results.

---

## 3. Directory Layout (Recommended)

Store Timewarp data in a fixed workspace directory, and **always exclude** it from snapshots:

```text
<workspace>/.timewarp/
  state.json
  snapshots/
    <snapshot_id>/
      snapshot.json
      workspace/
  issues/
    <issue_id>/
      issue.json
      chat.md
      experiment.md
  present_backup/
    <backup_id>/
```

---

## 4. Snapshots

### Creation Trigger

- `on_session_start`: create one snapshot for each new session.

### Copy Strategy

- Snapshot = workspace copy (with exclude rules) + `snapshot.json`.
- Exclude list must be configurable and include practical defaults.

### Default Excludes

- Dependency/build: `node_modules/`, `.venv/`, `dist/`, `build/`, `.next/`, `target/`, `.cache/`
- Runtime artifacts: `*.log`, `*.pid`, sockets
- System files: `.DS_Store`
- Timewarp data: `.timewarp/` (must always be excluded)

### `snapshot.json` Example

```json
{
  "snapshot_id": "s_20260228_153012_ab12cd",
  "created_at": "2026-02-28T15:30:12Z",
  "session_id": "sess_...",
  "workspace_root": "/abs/path/to/workspace",
  "exclude_globs": [
    "node_modules/",
    ".venv/",
    "dist/",
    "build/",
    ".next/",
    "target/",
    ".cache/",
    ".DS_Store",
    ".timewarp/"
  ]
}
```

---

## 5. Issue Records (Friction Logging)

### Recording Principles

- Do not block primary task flow.
- Every Issue must include `snapshot_id`.
- Keep records structured, not free-form only.

### Per-Issue Files

```text
.timewarp/issues/<issue_id>/
  issue.json
  chat.md
  experiment.md
```

### `issue.json` Example

```json
{
  "issue_id": "i_20260228_153500_ef34gh",
  "created_at": "2026-02-28T15:35:00Z",
  "status": "open",
  "snapshot_id": "s_20260228_153012_ab12cd",
  "task_context": "User asked the agent to complete task X",
  "symptom": "Observed incoherence/repeated retries/failure",
  "success_criteria": "(required) verifiable acceptance criteria",
  "suspected_cause": "(optional)",
  "chat_file": "chat.md",
  "chat_summary": "(optional, short)",
  "experiment_file": "experiment.md"
}
```

### `success_criteria` Rules

- Describe measurable outcomes, not feelings.
- Prefer: trigger condition, expected behavior, observable evidence.

---

## 6. Time Machine Tools (Required)

Two tools: go to past + return to present, managed by `.timewarp/state.json`.

### `state.json`

```json
{
  "workspace_root": "/abs/path/to/workspace",
  "session_id": "sess_...",
  "session_snapshot_id": "s_...",
  "mode": "present",
  "current_snapshot_id": null,
  "backup_path": null,
  "entered_at": null,
  "guard_token": null
}
```

`mode` values:
- `present`
- `past`

### Tool 1: `travel(snapshot_id)`

- Allowed only when `mode=present`.
- Must backup current workspace to `present_backup/...` before switching.
- Must apply excludes when restoring snapshot.
- Updates state to `mode=past` and records `current_snapshot_id`, `backup_path`.

### Tool 2: `return()`

- Allowed only when `mode=past`.
- Restore from `backup_path`.
- Set mode back to `present`.

---

## 7. Experiment Memory

Use `experiment.md` inside the Issue folder to record:

- what changed,
- how to validate,
- final result.

---

## 8. Agent Optimization Protocol (7 Steps)

When entering optimization mode:

1. Pick an Issue (`timewarp_issue_list()` + `timewarp_issue_get(issue_id)`).
2. Travel to `issue.snapshot_id`.
3. Reproduce the problem from historical context.
4. Propose a minimal fix.
5. Iterate: implement -> validate -> repeat if needed.
6. Return to present (`return()`).
7. Re-apply and validate in present workspace; mark Issue `fixed` if successful.

---

## 9. Plugin Responsibility Boundary

Plugin focuses on replay infrastructure.

- `on_session_start`: create snapshot, write `.timewarp/state.json.session_snapshot_id`, and run snapshot cleanup.

### Snapshot Cleanup Rule (Minimal)

After creating a new session snapshot, delete old snapshots not referenced by any Issue.

Guardrails:
- Never delete the newly created snapshot.
- If `state.mode=past`, skip cleanup.

---

## 10. Agent Tool: `issue_report`

### Semantics

`issue_report(...)` creates a new Issue and automatically:

- links current `session_snapshot_id`,
- exports current session transcript to `chat.md`,
- creates an initial `experiment.md` template.

### Input (recommended)

- `task_context`
- `symptom`
- `success_criteria` (required)
- `suspected_cause` (optional)
- `chat_summary` (optional)

### Files written

Under `.timewarp/issues/<issue_id>/`:

- `issue.json`
- `chat.md` (dialogue + tool input/output only, redacted)
- `experiment.md`

### Tool return

- `ok`

### Required rules

- Atomic writes for `issue.json`, `chat.md`, `experiment.md`.
- Redact secrets (`token`, `key`, `password`, `Authorization`, etc.).
- If `session_snapshot_id` is missing, fail immediately.

### Related retrieval tools

- `timewarp_issue_list(status?)`: default `open`, `all` for all.
- `timewarp_issue_get(issue_id)`: detailed Issue info and file paths.

---

## 11. Guardrails and Consistency Checks

- Reject nested travel (`travel()` when already in `past`).
- Optional backup fingerprint checks before/after return.
- Optional lock/guard token to prevent concurrent state corruption.
- Never allow `.timewarp/` to be overwritten by snapshot restores.

---

## 12. MVP Checklist

- [ ] Auto-create snapshot on `on_session_start`
- [ ] Structured Issue persistence
- [ ] `travel(snapshot_id)` + `return()` + `state.json` machine
- [ ] Configurable default excludes
