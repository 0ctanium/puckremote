// Stop: code changed in this branch/working tree without docs AND decision-record changes →
// send the agent back. Loop-safe: when the stop was already blocked once, let it end.
import { git, isAdr, isCode, isDocs, readInput, repoRoot } from './lib.mjs'

const input = readInput()
if (input.stop_hook_active) process.exit(0)
const root = repoRoot(input)

const files = new Set()
for (const line of git(root, ['status', '--porcelain', '-uall']).split('\n')) {
  const f = line.slice(3).split(' -> ').pop()?.trim()
  if (f) files.add(f.replace(/^"|"$/g, ''))
}
// Commits on this branch that are not on main yet.
const base = git(root, ['merge-base', 'HEAD', 'main']).trim()
const head = git(root, ['rev-parse', 'HEAD']).trim()
if (base && base !== head) for (const f of git(root, ['diff', '--name-only', `${base}..HEAD`]).split('\n')) if (f) files.add(f)

const all = [...files]
const code = all.filter(isCode)
if (!code.length) process.exit(0)
const missing = [!all.some(isDocs) && 'docs (apps/docs/content/docs/**, skill docs-update)', !all.some(isAdr) && 'a decision record (pnpm adr …, skill decision-record)'].filter(Boolean)
if (missing.length) {
  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason: `Code changed (${code.slice(0, 5).join(', ')}${code.length > 5 ? ', …' : ''}) without ${missing.join(' and ')}. Update them before finishing (CLAUDE.md rules 2 and 3), or ask the human if the change needs neither.`,
    }),
  )
}
