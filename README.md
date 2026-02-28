# Timewarp OpenCode Plugin

Timewarp is a local OpenCode plugin for snapshot travel and issue-driven optimization loops.

中文说明请看：`README.zh-CN.md`

Protocol docs:
- Chinese: `TIMEWARP_PROTOCOL.md`
- English: `TIMEWARP_PROTOCOL.en.md`

## Included toolset

- `timewarp_travel`
- `timewarp_return`
- `timewarp_issue_list(status?)` (defaults to `open`, pass `all` for all issues)
- `timewarp_issue_get(issue_id)`
- `issue_report(...)`

## Install

### Global install (all projects)

```bash
mkdir -p ~/.config/opencode/plugins
cp timewarp.js ~/.config/opencode/plugins/timewarp.js
```

### Per-project install

```bash
mkdir -p .opencode/plugins
cp timewarp.js .opencode/plugins/timewarp.js
```

Restart OpenCode after installing.

## Notes

- The plugin stores runtime data under `.timewarp/` in the workspace.
- `issue_report` writes issue artifacts under `.timewarp/issues/<issue_id>/`.
- `chat.md` is exported from `context.messages` and keeps only dialogue plus tool IO blocks.
