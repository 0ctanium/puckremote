/**
 * Builds the static editor app into dist/:
 *   index.html   import map + app
 *   app.js/css   Puck + bridge (React bundled in)
 *   vendor/*.js  shims the import map points the theme's bare imports at
 *
 * PUCK_REMOTE_ADMIN_ORIGINS (comma-separated): admin pages allowed to embed the editor.
 */
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { adminOrigins } from './origins.mjs'

const dir = import.meta.dirname
const out = path.join(dir, 'dist')
const require = createRequire(import.meta.url)

// Bare specifiers the theme bundle may import (BROWSER_EXTERNALS in @puck-remote/cli).
const SHARED = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@puck-remote/sdk']
const file = (spec) => `vendor/${spec.replace(/^@/, '').replace(/[/]/g, '-')}.js`
const ident = /^[A-Za-z_$][A-Za-z0-9_$]*$/

async function exportNames(spec) {
  const mod = spec.startsWith('react') ? require(spec) : await import(spec)
  return Object.keys(mod).filter((k) => k !== 'default' && ident.test(k)).sort()
}

await rm(out, { recursive: true, force: true })
await mkdir(path.join(out, 'vendor'), { recursive: true })

await build({
  entryPoints: [path.join(dir, 'src/main.tsx')],
  outdir: out,
  entryNames: 'app',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  jsx: 'automatic',
  conditions: ['browser'],
  define: { 'process.env.NODE_ENV': '"production"', __ADMIN_ORIGINS__: JSON.stringify(adminOrigins()) },
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
  ].join('\n')
  await writeFile(path.join(out, file(spec)), src + '\n')
  imports[spec] = `/${file(spec)}`
}

const importMap = JSON.stringify({ imports }, null, 2)
const hash = createHash('sha256').update(importMap).digest('base64')
await writeFile(
  path.join(out, 'index.html'),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Editor</title>
    <script type="importmap">${importMap}</script>
    <link rel="stylesheet" href="/app.css" />
    <style>html, body, #editor { height: 100%; margin: 0 }</style>
  </head>
  <body>
    <div id="editor"></div>
    <script type="module" src="/app.js"></script>
  </body>
</html>
`,
)
// The import map is an inline script: the server allows it by hash.
await writeFile(path.join(out, 'csp.json'), JSON.stringify({ importMapHash: `sha256-${hash}` }) + '\n')
console.log(`[editor] built → ${path.relative(process.cwd(), out) || out} (admin origins: ${adminOrigins().join(', ')})`)
