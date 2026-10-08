// PreToolUse(Bash): block write-like commands until a plan is approved (D-0100).
// HEURISTIC: catches accidental writes (git history changes, rm, mv, sed -i, tee, redirects into
// the repo). It is not a sandbox; the rules in CLAUDE.md still apply to anything it misses.
import { insideRepo, NO_PLAN, planApproved, readInput, repoRoot } from './lib.mjs'

const input = readInput()
const root = repoRoot(input)
const cwd = input.cwd ?? root
const cmd = String(input.tool_input?.command ?? '')

function reason() {
  if (/\bgit\s+(?:-C\s+\S+\s+)?(commit|merge|push|rebase|reset)\b/.test(cmd)) return 'git history change'
  if (/(^|[\s;&|(])(rm|mv)\s/.test(cmd)) return 'rm/mv'
  if (/\bsed\s+(?:-[a-zA-Z]*\s+)*-[a-zA-Z]*i/.test(cmd)) return 'sed -i'
  if (/(^|[\s;&|(])tee\s/.test(cmd)) return 'tee'
  // Output redirects (>, >>, &>, 1>, 2>) to a file inside the repo; /dev/* and fd dups are fine.
  for (const m of cmd.matchAll(/(?:^|[^<>&\d])(?:\d|&)?>>?\s*(?!&)([^\s;&|()<>]+)/g)) {
    const target = m[1].replace(/^["']|["']$/g, '')
    if (target.startsWith('/dev/')) continue
    if (insideRepo(root, target, cwd)) return `redirect into ${target}`
  }
  return null
}

const why = reason()
if (why && !planApproved(root, input.session_id)) {
  process.stderr.write(`${NO_PLAN}\n(detected: ${why})\n`)
  process.exit(2)
}
