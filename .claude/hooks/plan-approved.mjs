// PostToolUse(ExitPlanMode): the human approved a plan in this session; allow edits from now on.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { markerPath, readInput, repoRoot } from './lib.mjs'

const input = readInput()
const marker = markerPath(repoRoot(input), input.session_id)
mkdirSync(path.dirname(marker), { recursive: true })
writeFileSync(marker, new Date().toISOString() + '\n')
