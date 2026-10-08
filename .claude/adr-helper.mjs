#!/usr/bin/env node
/**
 * ADR / decision-log CLI for puck-remote. Usage: `pnpm adr <command> …` (see ADR-SYSTEM-GUIDE.md).
 *
 * The index (.claude/adr-index.toml) is the source of truth for decision IDs and metadata; each
 * ADR file carries a human-readable decisions table kept in sync by this tool.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { parse, stringify } from 'smol-toml'

const ROOT = path.dirname(fileURLToPath(import.meta.url)) // .claude/
const INDEX = path.join(ROOT, 'adr-index.toml')
const TYPES = ['feat', 'chore', 'docs', 'fix']
const PROVENANCE = ['user', 'user-approved-plan', 'agent-unreviewed']
const STATUSES = ['accepted', 'needs-review', 'superseded', 'rejected']
const START = '<!-- decisions:start'
const END = '<!-- decisions:end -->'

const today = () => new Date().toISOString().slice(0, 10)
const die = (msg) => {
  console.error(`✖ ${msg}`)
  process.exit(1)
}
const load = () => parse(readFileSync(INDEX, 'utf8'))
const save = (idx) => {
  const header = '# puck-remote decision index — managed by `pnpm adr` (see .claude/ADR-SYSTEM-GUIDE.md). Do not edit by hand.\n\n'
  writeFileSync(INDEX, header + stringify(idx) + '\n')
}
const did = (n) => `D-${String(n).padStart(4, '0')}`
const adrPath = (idx, name) => {
  const a = idx.adrs?.[name]
  if (!a) die(`unknown ADR "${name}" (see \`pnpm adr list --adrs\`)`)
  return path.join(ROOT, a.file)
}
const esc = (s) => String(s).replaceAll('|', '\\|')

/** Rewrite the decisions table inside an ADR file from the index. */
function syncTable(idx, name) {
  const file = adrPath(idx, name)
  const src = readFileSync(file, 'utf8')
  const s = src.indexOf(START)
  const e = src.indexOf(END)
  if (s < 0 || e < 0) die(`${path.relative(ROOT, file)} has no decisions markers`)
  const startLineEnd = src.indexOf('\n', s) + 1
  const rows = (idx.adrs[name].decisions ?? []).map((id) => {
    const d = idx.decisions[id]
    const status = d.superseded_by ? `superseded by ${d.superseded_by}` : d.status
    return `| ${id} | ${esc(d.title)} | ${d.provenance} | ${status} |`
  })
  const table = ['| ID | Decision | Provenance | Status |', '|---|---|---|---|', ...rows].join('\n') + '\n'
  writeFileSync(file, src.slice(0, startLineEnd) + table + src.slice(e))
}

const commands = {
  new(args, opts) {
    const name = args[0]
    if (!name || !/^(feat|chore|docs|fix)\/[a-z0-9][a-z0-9-]*$/.test(name)) die('usage: new <feat|chore|docs|fix>/<slug> --title "…" [--tags a,b] [--template feature|chore|research]')
    if (!opts.title) die('--title is required')
    const idx = load()
    if (idx.adrs?.[name]) die(`ADR ${name} already exists`)
    const [type, slug] = name.split('/')
    const rel = `branches/${type}/${slug}.md`
    const tpl = readFileSync(path.join(ROOT, 'templates', `${opts.template ?? 'branch-adr'}.md`), 'utf8')
    const tags = (opts.tags ?? '').split(',').filter(Boolean)
    const body = tpl
      .replaceAll('{{TITLE}}', opts.title.replaceAll('"', '\\"'))
      .replaceAll('{{DESCRIPTION}}', (opts.description ?? opts.title).replaceAll('"', '\\"'))
      .replaceAll('{{BRANCH}}', name)
      .replaceAll('{{TYPE}}', type)
      .replaceAll('{{DATE}}', today())
      .replaceAll('{{AUTHOR}}', opts.author ?? 'Claude')
      .replaceAll('{{TAGS}}', tags.join(' '))
    mkdirSync(path.join(ROOT, 'branches', type), { recursive: true })
    writeFileSync(path.join(ROOT, rel), body)
    idx.adrs ??= {}
    idx.adrs[name] = { file: rel, type, status: 'active', created: today(), title: opts.title, description: opts.description ?? opts.title, tags, decisions: [] }
    save(idx)
    console.log(`✔ created ${rel}`)
  },

  decision(args, opts) {
    const name = args[0]
    if (!name || !opts.title || !opts.provenance) die('usage: decision <adr> --title "…" --provenance user|user-approved-plan|agent-unreviewed [--tags a,b] [--supersedes D-0001]')
    if (!PROVENANCE.includes(opts.provenance)) die(`--provenance must be one of ${PROVENANCE.join(', ')}`)
    const idx = load()
    adrPath(idx, name)
    idx.meta.next_decision ??= 1
    const id = did(idx.meta.next_decision++)
    const d = {
      title: opts.title,
      adr: name,
      date: opts.date ?? today(),
      provenance: opts.provenance,
      status: opts.provenance === 'agent-unreviewed' ? 'needs-review' : 'accepted',
      tags: (opts.tags ?? '').split(',').filter(Boolean),
    }
    if (opts.supersedes) {
      for (const old of opts.supersedes.split(',')) {
        const o = idx.decisions[old]
        if (!o) die(`unknown decision ${old}`)
        o.status = 'superseded'
        o.superseded_by = id
      }
      d.supersedes = opts.supersedes.split(',')
    }
    idx.decisions ??= {}
    idx.decisions[id] = d
    idx.adrs[name].decisions = [...(idx.adrs[name].decisions ?? []), id]
    save(idx)
    syncTable(idx, name)
    for (const old of d.supersedes ?? []) syncTable(idx, idx.decisions[old].adr)
    console.log(`✔ ${id} recorded in ${name}${d.status === 'needs-review' ? ' (needs human review)' : ''}`)
  },

  review(args, opts) {
    const id = args[0]
    const idx = load()
    const d = idx.decisions?.[id]
    if (!d) die(`unknown decision ${id}`)
    if (!['accepted', 'rejected'].includes(opts.status)) die('--status accepted|rejected')
    d.status = opts.status
    d.reviewed = today()
    if (opts.note) d.review_note = opts.note
    save(idx)
    syncTable(idx, d.adr)
    console.log(`✔ ${id} → ${opts.status}`)
  },

  search(args) {
    const term = args.join(' ').toLowerCase()
    if (!term) die('usage: search <term>')
    const idx = load()
    for (const [id, d] of Object.entries(idx.decisions ?? {})) {
      if ([d.title, ...(d.tags ?? [])].join(' ').toLowerCase().includes(term)) console.log(`${id}  [${d.status}] ${d.title}  (${d.adr})`)
    }
    for (const [name, a] of Object.entries(idx.adrs ?? {})) {
      const body = readFileSync(path.join(ROOT, a.file), 'utf8').toLowerCase()
      const hits = body.split('\n').filter((l) => l.includes(term)).length
      if (hits || [a.title, a.description, ...(a.tags ?? [])].join(' ').toLowerCase().includes(term)) console.log(`ADR ${name}: ${a.title}  — ${hits} matching line(s) in ${a.file}`)
    }
  },

  list(_args, opts) {
    const idx = load()
    if (opts.adrs) {
      for (const [name, a] of Object.entries(idx.adrs ?? {})) console.log(`${name}  [${a.status}] ${a.title}  (${a.decisions?.length ?? 0} decisions) → ${a.file}`)
      return
    }
    for (const [id, d] of Object.entries(idx.decisions ?? {})) {
      if (opts['needs-review'] && d.status !== 'needs-review') continue
      if (opts.active && idx.adrs[d.adr]?.status !== 'active') continue
      if (opts.tag && !(d.tags ?? []).includes(opts.tag)) continue
      if (opts.adr && d.adr !== opts.adr) continue
      console.log(`${id}  [${d.status}] [${d.provenance}] ${d.title}  (${d.adr})`)
    }
  },

  show(args) {
    const key = args[0]
    const idx = load()
    const v = idx.decisions?.[key] ?? idx.adrs?.[key]
    if (!v) die(`nothing named ${key}`)
    console.log(stringify({ [key]: v }))
  },

  archive(args) {
    const name = args[0]
    const idx = load()
    const a = idx.adrs?.[name]
    if (!a) die(`unknown ADR ${name}`)
    if (a.status !== 'active') die(`${name} is ${a.status}`)
    const month = today().slice(0, 7)
    const rel = `merged/${month}/${name.replace('/', '-')}.md`
    mkdirSync(path.join(ROOT, 'merged', month), { recursive: true })
    renameSync(path.join(ROOT, a.file), path.join(ROOT, rel))
    const file = path.join(ROOT, rel)
    writeFileSync(file, readFileSync(file, 'utf8').replace('- **Status**: Active', '- **Status**: Merged'))
    Object.assign(a, { file: rel, status: 'merged', merged: today() })
    save(idx)
    console.log(`✔ archived to ${rel}`)
  },

  check() {
    const idx = load()
    const errors = []
    const seenFiles = new Set()
    if (!Number.isInteger(idx.meta?.next_decision)) errors.push('meta.next_decision missing')
    for (const [name, a] of Object.entries(idx.adrs ?? {})) {
      const file = path.join(ROOT, a.file)
      seenFiles.add(path.resolve(file))
      if (!existsSync(file)) {
        errors.push(`${name}: file ${a.file} missing`)
        continue
      }
      const src = readFileSync(file, 'utf8')
      if (!src.startsWith('---\n') || !/\ntitle:/.test(src.slice(0, 400))) errors.push(`${name}: missing frontmatter title`)
      if (!src.includes(START) || !src.includes(END)) errors.push(`${name}: missing decisions markers`)
      for (const id of a.decisions ?? []) {
        if (!idx.decisions?.[id]) errors.push(`${name}: lists unknown decision ${id}`)
        else if (!src.includes(`| ${id} |`)) errors.push(`${name}: decisions table lacks ${id} (run any \`pnpm adr\` write, or fix the file)`)
      }
    }
    for (const dir of ['branches', 'merged']) {
      const walk = (d) =>
        existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.md') ? [path.join(d, e.name)] : [])) : []
      for (const f of walk(path.join(ROOT, dir))) if (!seenFiles.has(path.resolve(f))) errors.push(`${path.relative(ROOT, f)} is not in the index`)
    }
    let max = 0
    for (const [id, d] of Object.entries(idx.decisions ?? {})) {
      if (!/^D-\d{4}$/.test(id)) errors.push(`${id}: bad id`)
      max = Math.max(max, Number(id.slice(2)))
      if (!PROVENANCE.includes(d.provenance)) errors.push(`${id}: bad provenance ${d.provenance}`)
      if (!STATUSES.includes(d.status)) errors.push(`${id}: bad status ${d.status}`)
      if (!idx.adrs?.[d.adr]?.decisions?.includes(id)) errors.push(`${id}: not listed by its ADR ${d.adr}`)
      if (d.status === 'superseded' && !idx.decisions?.[d.superseded_by]) errors.push(`${id}: superseded without a valid superseded_by`)
      for (const s of d.supersedes ?? []) if (idx.decisions?.[s]?.superseded_by !== id) errors.push(`${id}: supersedes ${s} but ${s} does not point back`)
    }
    if (idx.meta?.next_decision <= max) errors.push(`meta.next_decision (${idx.meta.next_decision}) must be > ${max}`)
    if (errors.length) {
      for (const e of errors) console.error(`✖ ${e}`)
      process.exit(1)
    }
    const nr = Object.values(idx.decisions ?? {}).filter((d) => d.status === 'needs-review').length
    console.log(`✔ ${Object.keys(idx.adrs ?? {}).length} ADRs, ${Object.keys(idx.decisions ?? {}).length} decisions consistent${nr ? ` (${nr} need human review: pnpm adr list --needs-review)` : ''}`)
  },
}

const [cmd, ...rest] = process.argv.slice(2)
if (!cmd || !commands[cmd]) {
  console.log(`usage: pnpm adr <${Object.keys(commands).join('|')}> …  (see .claude/ADR-SYSTEM-GUIDE.md)`)
  process.exit(cmd ? 1 : 0)
}
const { values, positionals } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    title: { type: 'string' },
    description: { type: 'string' },
    tags: { type: 'string' },
    template: { type: 'string' },
    author: { type: 'string' },
    provenance: { type: 'string' },
    supersedes: { type: 'string' },
    status: { type: 'string' },
    note: { type: 'string' },
    date: { type: 'string' },
    tag: { type: 'string' },
    adr: { type: 'string' },
    'needs-review': { type: 'boolean' },
    active: { type: 'boolean' },
    adrs: { type: 'boolean' },
  },
})
commands[cmd](positionals, values)
