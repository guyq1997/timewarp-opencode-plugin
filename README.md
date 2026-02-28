# Timewarp OpenCode Plugin

Timewarp is a local OpenCode plugin for snapshot travel and issue-driven optimization loops.

- Chinese README: [README.zh-CN.md](./README.zh-CN.md)
- Protocol (Chinese): [TIMEWARP_PROTOCOL.md](./TIMEWARP_PROTOCOL.md)
- Protocol (English): [TIMEWARP_PROTOCOL.en.md](./TIMEWARP_PROTOCOL.en.md)

## Tools

- `timewarp_travel`
- `timewarp_return`
- `timewarp_issue_list(status?)` (defaults to `open`, pass `all` to include all)
- `timewarp_issue_get(issue_id)`
- `issue_report(...)` (returns `ok`)

## Install

### Option A: Global install (recommended)

```bash
mkdir -p ~/.config/opencode/plugins
curl -fsSL "https://raw.githubusercontent.com/guyq1997/timewarp-opencode-plugin/main/timewarp.js" -o ~/.config/opencode/plugins/timewarp.js
```

### Option B: Project install

```bash
mkdir -p .opencode/plugins
curl -fsSL "https://raw.githubusercontent.com/guyq1997/timewarp-opencode-plugin/main/timewarp.js" -o .opencode/plugins/timewarp.js
```

Restart OpenCode after installation.

## Agent bootstrap (important)

When using this plugin, ask your agent to read the protocol first.

Prompt snippet:

```text
Before using any timewarp tools, read @TIMEWARP_PROTOCOL.en.md (or @TIMEWARP_PROTOCOL.md).
Then follow the protocol strictly for issue reporting and optimization loops.
```

You can also put this into your project `AGENTS.md`.

## Notes

- Runtime data is stored under `.timewarp/` in your workspace.
- `issue_report` writes artifacts to `.timewarp/issues/<issue_id>/`.
- `chat.md` is exported from `context.messages` and keeps only dialogue + tool input/output blocks.
