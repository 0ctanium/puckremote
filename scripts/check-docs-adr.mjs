#!/usr/bin/env node
/**
 * Repository check (git pre-commit and CI): every change records its decisions, and code changes
 * update the docs. See apps/docs/content/docs/contributing/enforcement.mdx.
 *
 *   node scripts/check-docs-adr.mjs              staged changes (pre-commit)
 *   node scripts/check-docs-adr.mjs --base <ref> changes between <ref> and HEAD (CI)
 *
 * Rules:
 *   - code (packages/<pkg>/src, examples) → needs apps/docs/content AND .claude ADR/index changes
 *   - anything else → needs a .claude ADR/index change
 *   - `pnpm adr check` must pass
 * SKIP_DOCS_CHECK=1 skips the change rules (humans only; never set it from an agent or CI config).
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })

const isCode = (f) => /^packages\/[^/]+\/src\//.test(f) || /^examples\//.test(f)
const isDocs = (f) => f.startsWith('apps/docs/content/')
const isAdr = (f) => /^\.claude\/(branches|merged)\//.test(f) || f === '.claude/adr-index.toml'

const baseIdx = process.argv.indexOf('--base')
const rawBase = baseIdx > 0 ? process.argv[baseIdx + 1] : null
// A new branch pushed for the first time has no "before" commit (all zeros): compare to the parent.
const base = rawBase && /^0+$/.test(rawBase) ? 'HEAD~1' : rawBase
const files = (base ? git(['diff', '--name-only', `${base}...HEAD`]) : git(['diff', '--cached', '--name-only'])).split('\n').filter(Boolean)

const errors = []
if (process.env.SKIP_DOCS_CHECK === '1') {
  console.warn('⚠ SKIP_DOCS_CHECK=1: docs/ADR change rules skipped (human escape hatch).')
} else if (files.length) {
  const code = files.filter(isCode)
  const hasAdr = files.some(isAdr)
  if (code.length && !files.some(isDocs)) errors.push(`code changed (${code.slice(0, 5).join(', ')}${code.length > 5 ? ', …' : ''}) but no docs under apps/docs/content/`)
  if (!hasAdr) errors.push('no decision record changed (.claude/branches/**, .claude/merged/** or .claude/adr-index.toml): record the decisions with `pnpm adr`')
}

try {
  execFileSync(process.execPath, [path.join(root, '.claude', 'adr-helper.mjs'), 'check'], { cwd: root, stdio: 'inherit' })
} catch {
  errors.push('`pnpm adr check` failed')
}

if (errors.length) {
  console.error(`\n✖ docs/ADR check failed:\n${errors.map((e) => `  - ${e}`).join('\n')}\n\nSee apps/docs/content/docs/contributing/workflow.mdx.`)
  process.exit(1)
}
console.log(`✔ docs/ADR check passed (${files.length} changed files)`)
