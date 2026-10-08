// PreToolUse(Edit|Write|MultiEdit|NotebookEdit): block edits inside the repo until a plan is approved.
import { insideRepo, NO_PLAN, planApproved, readInput, repoRoot } from './lib.mjs'

const input = readInput()
const root = repoRoot(input)
const t = input.tool_input ?? {}
const target = t.file_path ?? t.notebook_path ?? t.path
if (insideRepo(root, target, input.cwd ?? root) && !planApproved(root, input.session_id)) {
  process.stderr.write(`${NO_PLAN}\n(target: ${target})\n`)
  process.exit(2)
}
