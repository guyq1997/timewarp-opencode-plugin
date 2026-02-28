import path from "node:path"
import fs from "node:fs/promises"

let tool
try {
  ;({ tool } = await import("@opencode-ai/plugin"))
} catch {
  // Fallback for environments that can't load @opencode-ai/plugin (e.g. local Node without Bun).
  tool = (def) => def
  tool.schema = {
    string() {
      return {
        optional() {
          return { type: "string", optional: true }
        },
      }
    },
  }
}

const DEFAULT_EXCLUDE_GLOBS = [
  "node_modules/",
  ".venv/",
  "dist/",
  "build/",
  ".next/",
  "target/",
  ".cache/",
  ".DS_Store",
  ".timewarp/",
  "*.log",
  "*.pid",
]

function utcNowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
}

function randSuffix(n = 6) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
  let out = ""
  for (let i = 0; i < n; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}

function makeId(prefix) {
  const d = new Date()
  const pad = (x) => String(x).padStart(2, "0")
  const ts = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  return `${prefix}_${ts}_${randSuffix()}`
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true })
}

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, "utf8"))
}

async function writeJsonAtomic(p, obj) {
  const tmp = `${p}.tmp`
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8")
  await fs.rename(tmp, p)
}

function normalizeRel(rel) {
  return String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "")
}

function matchesDirName(rel, name) {
  const parts = normalizeRel(rel).split("/")
  return parts.includes(name)
}

function shouldExclude(rel, excludeGlobs) {
  const r = normalizeRel(rel)
  if (!r) return false

  if (r === ".timewarp" || r.startsWith(".timewarp/") || matchesDirName(r, ".timewarp")) return true

  const base = r.split("/").pop()
  for (const pat0 of excludeGlobs || []) {
    const pat = String(pat0 || "").trim()
    if (!pat) continue
    if (pat.endsWith("/")) {
      const name = pat.slice(0, -1)
      if (matchesDirName(r, name)) return true
      continue
    }
    // Tiny glob support: * only
    const re = new RegExp("^" + pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$")
    if (re.test(base) || re.test(r)) return true
  }
  return false
}

async function copySymlink(src, dst) {
  const link = await fs.readlink(src)
  try {
    await fs.unlink(dst)
  } catch {}
  await ensureDir(path.dirname(dst))
  await fs.symlink(link, dst)
}

async function copyFile(src, dst) {
  await ensureDir(path.dirname(dst))
  await fs.copyFile(src, dst)
  const st = await fs.stat(src)
  await fs.chmod(dst, st.mode)
}

async function copyTree(srcRoot, dstRoot, excludeGlobs) {
  const walk = async (dir) => {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const ent of entries) {
      const src = path.join(dir, ent.name)
      const rel = normalizeRel(path.relative(srcRoot, src))
      if (shouldExclude(rel, excludeGlobs)) continue
      const dst = path.join(dstRoot, rel)
      if (ent.isSymbolicLink()) {
        await copySymlink(src, dst)
      } else if (ent.isDirectory()) {
        await ensureDir(dst)
        await walk(src)
      } else if (ent.isFile()) {
        await copyFile(src, dst)
      }
    }
  }

  await walk(srcRoot)
}

async function clearWorkspace(root) {
  const entries = await fs.readdir(root, { withFileTypes: true })
  for (const ent of entries) {
    if (ent.name === ".timewarp") continue
    await fs.rm(path.join(root, ent.name), { recursive: true, force: true })
  }
}

async function moveWorkspaceContents(root, dest) {
  await ensureDir(dest)
  const entries = await fs.readdir(root, { withFileTypes: true })
  for (const ent of entries) {
    if (ent.name === ".timewarp") continue
    await fs.rename(path.join(root, ent.name), path.join(dest, ent.name))
  }
}

async function restoreFromDir(srcDir, root) {
  const entries = await fs.readdir(srcDir, { withFileTypes: true })
  for (const ent of entries) {
    const src = path.join(srcDir, ent.name)
    const dst = path.join(root, ent.name)
    if (ent.isSymbolicLink()) {
      await copySymlink(src, dst)
    } else if (ent.isDirectory()) {
      await fs.cp(src, dst, { recursive: true, dereference: false })
    } else if (ent.isFile()) {
      await copyFile(src, dst)
    }
  }
}

function pathsFor(root) {
  const twRoot = path.join(root, ".timewarp")
  return {
    root,
    twRoot,
    state: path.join(twRoot, "state.json"),
    snapshots: path.join(twRoot, "snapshots"),
    issues: path.join(twRoot, "issues"),
    presentBackup: path.join(twRoot, "present_backup"),
  }
}

async function loadState(p) {
  try {
    const st = await readJson(p.state)
    return {
      workspace_root: st.workspace_root || path.resolve(p.root),
      session_id: st.session_id || null,
      session_snapshot_id: st.session_snapshot_id || null,
      mode: st.mode || "present",
      current_snapshot_id: st.current_snapshot_id || null,
      backup_path: st.backup_path || null,
      entered_at: st.entered_at || null,
      guard_token: st.guard_token || null,
    }
  } catch {
    return {
      workspace_root: path.resolve(p.root),
      session_id: null,
      session_snapshot_id: null,
      mode: "present",
      current_snapshot_id: null,
      backup_path: null,
      entered_at: null,
      guard_token: null,
    }
  }
}

async function saveState(p, state) {
  await ensureDir(p.twRoot)
  await writeJsonAtomic(p.state, state)
}

async function cleanupUnreferencedSnapshots(p, keepSnapshotId) {
  const st = await loadState(p)
  if (st.mode === "past") return

  const referenced = new Set()
  let issueDirs = []
  try {
    issueDirs = await fs.readdir(p.issues, { withFileTypes: true })
  } catch {}
  for (const ent of issueDirs) {
    if (!ent.isDirectory()) continue
    const issueJson = path.join(p.issues, ent.name, "issue.json")
    try {
      const obj = await readJson(issueJson)
      if (obj && typeof obj.snapshot_id === "string" && obj.snapshot_id) referenced.add(obj.snapshot_id)
    } catch {}
  }

  let snapDirs = []
  try {
    snapDirs = await fs.readdir(p.snapshots, { withFileTypes: true })
  } catch {}
  for (const ent of snapDirs) {
    if (!ent.isDirectory()) continue
    const sid = ent.name
    if (sid === keepSnapshotId) continue
    if (referenced.has(sid)) continue
    await fs.rm(path.join(p.snapshots, sid), { recursive: true, force: true })
  }
}

async function onSessionStart({ root, sessionId = null, initialTaskHint = null, excludeGlobs = null } = {}) {
  if (!root) root = process.cwd()
  root = path.resolve(root)
  const p = pathsFor(root)

  await ensureDir(p.twRoot)
  await ensureDir(p.snapshots)
  await ensureDir(p.issues)
  await ensureDir(p.presentBackup)

  const exclude = excludeGlobs || DEFAULT_EXCLUDE_GLOBS
  const snapshotId = makeId("s")
  const snapDir = path.join(p.snapshots, snapshotId)
  const snapWs = path.join(snapDir, "workspace")
  await ensureDir(snapWs)

  const meta = {
    snapshot_id: snapshotId,
    created_at: utcNowIso(),
    session_id: sessionId,
    workspace_root: root,
    exclude_globs: exclude,
    env_fingerprint: { platform: process.platform },
    initial_task_hint: initialTaskHint,
  }
  await writeJsonAtomic(path.join(snapDir, "snapshot.json"), meta)
  await copyTree(root, snapWs, exclude)

  const st = await loadState(p)
  st.workspace_root = root
  st.session_id = sessionId
  st.session_snapshot_id = snapshotId
  if (st.mode !== "present" && st.mode !== "past") st.mode = "present"
  await saveState(p, st)

  await cleanupUnreferencedSnapshots(p, snapshotId)
  return snapshotId
}

async function travel({ root, snapshotId } = {}) {
  if (!root) root = process.cwd()
  root = path.resolve(root)
  const p = pathsFor(root)
  const st = await loadState(p)
  if (st.mode !== "present") throw new Error("cannot travel: state.mode is not present")
  if (!snapshotId) throw new Error("snapshotId required")

  const snapWs = path.join(p.snapshots, snapshotId, "workspace")
  try {
    await fs.access(snapWs)
  } catch {
    throw new Error(`snapshot not found: ${snapshotId}`)
  }

  const backupId = makeId("b")
  const backupDir = path.join(p.presentBackup, backupId)
  const backupWs = path.join(backupDir, "workspace")
  await ensureDir(backupWs)

  await moveWorkspaceContents(root, backupWs)
  await restoreFromDir(snapWs, root)

  st.mode = "past"
  st.current_snapshot_id = snapshotId
  st.backup_path = path.resolve(backupDir)
  st.entered_at = utcNowIso()
  await saveState(p, st)
}

async function returnToPresent({ root } = {}) {
  if (!root) root = process.cwd()
  root = path.resolve(root)
  const p = pathsFor(root)
  const st = await loadState(p)
  if (st.mode !== "past") throw new Error("cannot return: state.mode is not past")
  if (!st.backup_path) throw new Error("cannot return: missing backup_path")
  const backupWs = path.join(st.backup_path, "workspace")
  try {
    await fs.access(backupWs)
  } catch {
    throw new Error("cannot return: backup workspace missing")
  }

  await clearWorkspace(root)
  const entries = await fs.readdir(backupWs, { withFileTypes: true })
  for (const ent of entries) {
    await fs.rename(path.join(backupWs, ent.name), path.join(root, ent.name))
  }

  st.mode = "present"
  st.current_snapshot_id = null
  st.backup_path = null
  st.entered_at = null
  await saveState(p, st)
}

const REDACT_PATTERNS = [
  /\bsk-[A-Za-z0-9]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAuthorization\b\s*:\s*Bearer\s+[^\s\n]+/gi,
  /\b(x-api-key|api_key|apikey|token|access_token|refresh_token|password)\b\s*[:=]\s*[^\s\n]+/gi,
]

function redact(text) {
  let out = String(text || "")
  for (const re of REDACT_PATTERNS) out = out.replace(re, "***REDACTED***")
  return out
}

async function issueReport({
  root,
  taskContext,
  symptom,
  successCriteria,
  suspectedCause = null,
  chatSummary = null,
  sessionId = null,
  chatText,
} = {}) {
  if (!root) root = process.cwd()
  root = path.resolve(root)
  const p = pathsFor(root)

  const st = await loadState(p)
  const snapshotId = st.session_snapshot_id
  if (!snapshotId) throw new Error("cannot report issue: missing state.session_snapshot_id (run session-start first)")
  if (!taskContext) throw new Error("taskContext required")
  if (!symptom) throw new Error("symptom required")
  if (!successCriteria) throw new Error("successCriteria required")
  if (chatText == null) throw new Error("chatText required")

  const issueId = makeId("i")
  const issueDir = path.join(p.issues, issueId)
  await ensureDir(issueDir)

  const issueObj = {
    issue_id: issueId,
    created_at: utcNowIso(),
    status: "open",
    snapshot_id: snapshotId,
    task_context: taskContext,
    symptom,
    success_criteria: successCriteria,
    suspected_cause: suspectedCause,
    chat_file: "chat.md",
    chat_summary: chatSummary,
    experiment_file: "experiment.md",
  }

  const chatMd = redact(chatText).trim() + "\n"

  const experimentMd =
    `# Experiment\n\n` +
    `## Issue\n- id: ${issueId}\n- snapshot_id: ${snapshotId}\n\n` +
    `## Success Criteria\n${String(successCriteria).trim()}\n\n` +
    `## Repro\n<optional: minimal repro steps>\n\n` +
    `## Changes\n<what changed during experiments>\n\n` +
    `## Validation\n<how to validate success/failure>\n\n` +
    `## Result\n<success/failure + evidence>\n`

  const issuePath = path.join(issueDir, "issue.json")
  const chatPath = path.join(issueDir, "chat.md")
  const expPath = path.join(issueDir, "experiment.md")
  const tmpIssue = issuePath + ".tmp"
  const tmpChat = chatPath + ".tmp"
  const tmpExp = expPath + ".tmp"

  try {
    await fs.writeFile(tmpIssue, JSON.stringify(issueObj, null, 2) + "\n", "utf8")
    await fs.writeFile(tmpChat, chatMd, "utf8")
    await fs.writeFile(tmpExp, experimentMd, "utf8")
    await fs.rename(tmpIssue, issuePath)
    await fs.rename(tmpChat, chatPath)
    await fs.rename(tmpExp, expPath)
  } catch (e) {
    for (const fp of [tmpIssue, tmpChat, tmpExp]) {
      try {
        await fs.rm(fp, { force: true })
      } catch {}
    }
    try {
      const ents = await fs.readdir(issueDir)
      if (ents.length === 0) await fs.rmdir(issueDir)
    } catch {}
    throw e
  }

  return issueId
}

function isSafeIssueId(issueId) {
  const id = String(issueId || "").trim()
  if (!id) return false
  if (id.includes("/") || id.includes("\\") || id.includes("..")) return false
  return true
}

function issueToolError(code, message, extra = {}) {
  return {
    ok: false,
    error: {
      code,
      message,
      ...extra,
    },
  }
}

async function listIssues({ root } = {}) {
  if (!root) root = process.cwd()
  root = path.resolve(root)
  const p = pathsFor(root)

  let dirs = []
  try {
    dirs = await fs.readdir(p.issues, { withFileTypes: true })
  } catch (e) {
    if (e && e.code === "ENOENT") return []
    throw e
  }

  const issues = []
  for (const ent of dirs) {
    if (!ent.isDirectory()) continue
    const issueDir = path.join(p.issues, ent.name)
    const issueFile = path.join(issueDir, "issue.json")
    try {
      const obj = await readJson(issueFile)
      issues.push({
        issue_id: obj.issue_id || ent.name,
        status: obj.status || "unknown",
        created_at: obj.created_at || null,
      })
    } catch {
      issues.push({
        issue_id: ent.name,
        status: "invalid",
        created_at: null,
      })
    }
  }

  issues.sort((a, b) => {
    const at = Date.parse(a.created_at || "")
    const bt = Date.parse(b.created_at || "")
    const av = Number.isNaN(at) ? -Infinity : at
    const bv = Number.isNaN(bt) ? -Infinity : bt
    if (av !== bv) return bv - av
    return String(b.issue_id).localeCompare(String(a.issue_id))
  })

  return issues
}

function normalizeIssueListStatus(raw) {
  const s = String(raw || "").trim().toLowerCase()
  if (!s) return "open"
  if (s === "*" || s === "all") return "all"
  return s
}

async function getIssueDetail({ root, issueId } = {}) {
  if (!root) root = process.cwd()
  root = path.resolve(root)

  const id = String(issueId || "").trim()
  if (!isSafeIssueId(id)) {
    return issueToolError("INVALID_ISSUE_ID", "issue_id must be a non-empty issue directory name", {
      issue_id: id || null,
    })
  }

  const p = pathsFor(root)
  const issueDir = path.join(p.issues, id)
  const issueFile = path.join(issueDir, "issue.json")

  let obj
  try {
    obj = await readJson(issueFile)
  } catch (e) {
    if (e && e.code === "ENOENT") {
      return issueToolError("ISSUE_NOT_FOUND", `issue not found: ${id}`, { issue_id: id })
    }
    return issueToolError("ISSUE_READ_FAILED", "failed to read issue.json", {
      issue_id: id,
      detail: e && e.message ? e.message : String(e),
    })
  }

  if (!obj || typeof obj !== "object") {
    return issueToolError("ISSUE_INVALID", "issue.json is not a JSON object", { issue_id: id })
  }

  const chatName = typeof obj.chat_file === "string" && obj.chat_file ? obj.chat_file : "chat.md"
  const expName = typeof obj.experiment_file === "string" && obj.experiment_file ? obj.experiment_file : "experiment.md"

  return {
    ok: true,
    issue: {
      issue_id: obj.issue_id || id,
      status: obj.status || "unknown",
      created_at: obj.created_at || null,
      snapshot_id: obj.snapshot_id || null,
      task_context: obj.task_context || null,
      symptom: obj.symptom || null,
      success_criteria: obj.success_criteria || null,
      suspected_cause: obj.suspected_cause || null,
      chat_summary: obj.chat_summary || null,
      paths: {
        issue_dir: issueDir,
        issue_file: issueFile,
        chat_file: path.join(issueDir, chatName),
        experiment_file: path.join(issueDir, expName),
      },
    },
  }
}

function pickSessionId(event) {
  const props = event && event.properties ? event.properties : {}
  return (
    props.sessionID ||
    props.session_id ||
    props.id ||
    props.session_id ||
    (props.info && (props.info.sessionID || props.info.session_id || props.info.id)) ||
    (props.session && (props.session.sessionID || props.session.session_id || props.session.id)) ||
    (props.session && props.session.id) ||
    (props.info && props.info.id) ||
    null
  )
}

function pickSessionIdFromContext(context) {
  const c = context && typeof context === "object" ? context : {}
  return (
    c.sessionID ||
    c.session_id ||
    c.sessionId ||
    c.id ||
    (c.session && (c.session.sessionID || c.session.session_id || c.session.id)) ||
    (c.info && (c.info.sessionID || c.info.session_id || c.info.id)) ||
    null
  )
}

function truncateText(s, max = 240) {
  const v = String(s || "")
  if (v.length <= max) return v
  return v.slice(0, max) + "..."
}

function extractMessagesFromContext(context) {
  const c = context && typeof context === "object" ? context : {}
  const m = c.messages
  if (Array.isArray(m)) return m
  if (m && typeof m === "object") {
    if (Array.isArray(m.items)) return m.items
    if (Array.isArray(m.messages)) return m.messages
    if (Array.isArray(m.list)) return m.list
  }
  return null
}

function buildIssueReportFallbackTranscript({ reasonText }) {
  const lines = []
  lines.push("[system]")
  lines.push("Chat export unavailable.")
  if (reasonText) lines.push(String(reasonText).trim())
  lines.push("")
  return lines.join("\n").trim() + "\n"
}

function formatToolData(value, max = 12000) {
  if (value == null) return null
  if (typeof value === "string") {
    const t = value.trim()
    if (!t) return null
    return truncateText(t, max)
  }
  try {
    return truncateText(JSON.stringify(value, null, 2), max)
  } catch {
    return truncateText(String(value), max)
  }
}

function appendToolBlock(lines, part) {
  const toolName = part && typeof part.tool === "string" && part.tool.trim() ? part.tool.trim() : "unknown"
  const state = part && typeof part.state === "object" ? part.state : {}
  const inputText = formatToolData(typeof state.raw === "string" ? state.raw : state.input)
  const outputText = formatToolData(state.output)
  const errorText = formatToolData(state.error)

  lines.push(`[tool:${toolName}]`)
  if (inputText) {
    lines.push("input:")
    lines.push("```")
    lines.push(inputText)
    lines.push("```")
  }
  if (outputText) {
    lines.push("output:")
    lines.push("```")
    lines.push(outputText)
    lines.push("```")
  }
  if (errorText) {
    lines.push("error:")
    lines.push("```")
    lines.push(errorText)
    lines.push("```")
  }
  lines.push("")
}

function renderTranscript(items) {
  // items: [{ info: Message, parts: Part[] }, ...]
  // Defensive: callers sometimes pass unexpected shapes.
  if (!Array.isArray(items)) {
    const hint =
      items == null
        ? "<null>"
        : typeof items === "object"
          ? JSON.stringify(items, null, 2)
          : String(items)
    return (
      "[system]\n" +
      "Unexpected messages payload (expected array).\n" +
      "```json\n" +
      hint.slice(0, 20_000) +
      "\n```\n"
    )
  }
  const lines = []
  for (const item of items || []) {
    const info = item && item.info ? item.info : {}
    const parts = Array.isArray(item.parts) ? item.parts : []
    const role = info.role || info.type || info.kind || "message"
    let roleOpened = false
    const closeRole = () => {
      if (!roleOpened) return
      lines.push("")
      roleOpened = false
    }

    for (const part of parts) {
      if (!part || typeof part !== "object") continue
      if (part.type === "text" && typeof part.text === "string") {
        const text = part.text.trim()
        if (!text) continue
        if (!roleOpened) {
          lines.push(`[${role}]`)
          roleOpened = true
        }
        lines.push(text)
      } else if (part.type === "tool") {
        closeRole()
        appendToolBlock(lines, part)
      }
    }

    closeRole()
  }

  if (lines.length === 0) return "[system]\nNo dialogue or tool IO found.\n"
  return lines.join("\n").trim() + "\n"
}

export const TimewarpPlugin = async ({ client, directory }) => {
  const root = directory

  return {
    // Create snapshot automatically when a session is created.
    event: async ({ event }) => {
      if (!event || event.type !== "session.created") return
      const sessionId = pickSessionId(event)
      try {
        await onSessionStart({ root, sessionId })
      } catch (e) {
        // Best-effort logging; don't block opencode.
        try {
          await client.app.log({
            body: {
              service: "timewarp",
              level: "warn",
              message: "Failed to create snapshot on session.created",
              extra: { error: e && e.message ? e.message : String(e) },
            },
          })
        } catch {}
      }
    },

    tool: {
      timewarp_travel: tool({
        description: "Switch workspace to a snapshot (backs up present workspace)",
        args: {
          snapshot_id: tool.schema.string(),
        },
        async execute(args, context) {
          const cwd = context.directory || root
          await travel({ root: cwd, snapshotId: args.snapshot_id })
          return "ok"
        },
      }),

      timewarp_return: tool({
        description: "Return workspace to present (restore backup)",
        args: {},
        async execute(_args, context) {
          const cwd = context.directory || root
          await returnToPresent({ root: cwd })
          return "ok"
        },
      }),

      timewarp_issue_list: tool({
        description: "List Timewarp issues with summary fields",
        args: {
          status: tool.schema.string().optional(),
        },
        async execute(args, context) {
          const cwd = context.directory || root
          try {
            const status = normalizeIssueListStatus(args && args.status)
            const allIssues = await listIssues({ root: cwd })
            const issues =
              status === "all"
                ? allIssues
                : allIssues.filter((item) => String(item.status || "unknown").toLowerCase() === status)
            return JSON.stringify(
              {
                ok: true,
                filter: { status },
                count: issues.length,
                issues,
              },
              null,
              2,
            )
          } catch (e) {
            return JSON.stringify(
              issueToolError("ISSUE_LIST_FAILED", "failed to list issues", {
                detail: e && e.message ? e.message : String(e),
              }),
              null,
              2,
            )
          }
        },
      }),

      timewarp_issue_get: tool({
        description: "Get detailed metadata for one Timewarp issue",
        args: {
          issue_id: tool.schema.string(),
        },
        async execute(args, context) {
          const cwd = context.directory || root
          try {
            const result = await getIssueDetail({ root: cwd, issueId: args.issue_id })
            return JSON.stringify(result, null, 2)
          } catch (e) {
            return JSON.stringify(
              issueToolError("ISSUE_GET_FAILED", "failed to get issue detail", {
                issue_id: args.issue_id || null,
                detail: e && e.message ? e.message : String(e),
              }),
              null,
              2,
            )
          }
        },
      }),

      issue_report: tool({
        description: "Create an Issue, associate current session snapshot, auto-export session chat, and create experiment.md",
        args: {
          task_context: tool.schema.string(),
          symptom: tool.schema.string(),
          success_criteria: tool.schema.string(),
          suspected_cause: tool.schema.string().optional(),
          chat_summary: tool.schema.string().optional(),
        },
        async execute(args, context) {
          const cwd = context.directory || root
          const p = pathsFor(cwd)
          const st = await loadState(p)

          const sessionId = pickSessionIdFromContext(context) || process.env.OPENCODE_SESSION_ID || st.session_id || null
          if (sessionId && st.session_id !== sessionId) {
            st.session_id = sessionId
            await saveState(p, st)
          }

          // Export chat strictly from runtime context.messages.
          let transcript = ""
          const runtimeMessages = extractMessagesFromContext(context)
          if (Array.isArray(runtimeMessages) && runtimeMessages.length > 0) {
            transcript = renderTranscript(runtimeMessages)
          } else {
            const reason = "Missing context.messages; chat export unavailable."
            transcript = buildIssueReportFallbackTranscript({ reasonText: reason })
          }

          await issueReport({
            root: cwd,
            taskContext: args.task_context,
            symptom: args.symptom,
            successCriteria: args.success_criteria,
            suspectedCause: args.suspected_cause || null,
            chatSummary: args.chat_summary || null,
            sessionId,
            chatText: transcript,
          })
          return "ok"
        },
      }),
    },
  }
}
