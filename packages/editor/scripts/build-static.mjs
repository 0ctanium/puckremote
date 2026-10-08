/**
 * Builds the static editor into dist/static/ (run after tsdown, which empties dist/):
 *   index.html   import map + app; the server injects the admin origins at the marker
 *   app.js/css   Puck + bridge (React bundled in)
 *   vendor/*.js  shims the import map points the theme's bare imports at
 *   meta.json    the import map's CSP hash
 *
 * Asset URLs carry a content-hash query, so the server can cache them as immutable.
 */
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'dist', 'static')
const require = createRequire(import.meta.url)

// Bare specifiers the theme bundle may import (BROWSER_EXTERNALS in @puck-remote/cli).
const SHARED = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@puck-remote/sdk']
const file = (spec) => `vendor/${spec.replace(/^@/, '').replace(/[/]/g, '-')}.js`
const ident = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const short = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16)

async function exportNames(spec) {
  const mod = spec.startsWith('react') ? require(spec) : await import(spec)
  return Object.keys(mod).filter((k) => k !== 'default' && ident.test(k)).sort()
}

await rm(out, { recursive: true, force: true })
await mkdir(path.join(out, 'vendor'), { recursive: true })

await build({
  entryPoints: [path.join(root, 'src/app-main.tsx')],
  outdir: out,
  entryNames: 'app',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  jsx: 'automatic',
  conditions: ['browser'],
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
})

const imports = {}
for (const spec of SHARED) {
  const names = await exportNames(spec)
  const src = [
    `const m = globalThis.__puckRemoteModules?.[${JSON.stringify(spec)}];`,
    `if (!m) throw new Error(${JSON.stringify(`${spec} is not provided by the editor`)});`,
    'export default m.default ?? m;',
    names.length ? `export const { ${names.join(', ')} } = m;` : '',
  ].join('\n') + '\n'
  await writeFile(path.join(out, file(spec)), src)
  imports[spec] = `/${file(spec)}?v=${short(src)}`
}

const v = async (f) => short(await readFile(path.join(out, f)))
const importMap = JSON.stringify({ imports }, null, 2)
const importMapHash = `sha256-${createHash('sha256').update(importMap).digest('base64')}`
await writeFile(
  path.join(out, 'index.html'),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Editor</title>
    <script type="importmap">${importMap}</script>
    <!--puck-remote-editor-config-->
    <link rel="stylesheet" href="/app.css?v=${await v('app.css')}" />
    <style>html, body, #editor { height: 100%; margin: 0 }</style>
  </head>
  <body>
    <div id="editor"></div>
    <script type="module" src="/app.js?v=${await v('app.js')}"></script>
  </body>
</html>
`,
)
await writeFile(path.join(out, 'meta.json'), JSON.stringify({ importMapHash }) + '\n')
console.log(`[editor] static editor built → ${path.relative(process.cwd(), out) || out}`)
