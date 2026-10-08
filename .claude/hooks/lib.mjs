// Shared helpers for the Claude Code hooks (see apps/docs/content/docs/contributing/enforcement.mdx).
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export const readInput = () => {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}')
  } catch {
    return {}
  }
}

export const repoRoot = (input) => path.resolve(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd())

const safeId = (id) => String(id || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_')
export const markerPath = (root, sessionId) => path.join(root, '.claude', 'state', `plan-approved-${safeId(sessionId)}`)
export const planApproved = (root, sessionId) => existsSync(markerPath(root, sessionId))

/** True if `p` (absolute or relative to cwd) is inside the repository. */
export function insideRepo(root, p, cwd = root) {
  if (!p) return false
  const abs = path.resolve(cwd, String(p).replace(/^~(?=\/)/, process.env.HOME ?? '~'))
  const rel = path.relative(root, abs)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export const git = (root, args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return ''
  }
}

// Which paths count as code, docs and decision records (same rules as scripts/check-docs-adr.mjs).
export const isCode = (f) => /^packages\/[^/]+\/src\//.test(f) || /^(apps\/host|examples|mock)\//.test(f)
export const isDocs = (f) => f.startsWith('apps/docs/content/')
export const isAdr = (f) => /^\.claude\/(branches|merged)\//.test(f) || f === '.claude/adr-index.toml'

export const NO_PLAN =
  'Blocked: no approved plan in this session. puck-remote rule (CLAUDE.md, D-0094): every choice is validated by a human. ' +
  'Enter plan mode, list every choice (skill plan-first), and get it approved with ExitPlanMode before changing files.'
