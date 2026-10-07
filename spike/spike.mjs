import ivm from 'isolated-vm';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
const shims = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : '';
const r = await build({ entryPoints: ['entry.jsx'], bundle: true, format: 'iife', write: false, platform: 'neutral', mainFields: ['browser','module','main'], conditions: ['browser'], define: { 'process.env.NODE_ENV': '"production"' }, jsx: 'automatic', minify: false });
const code = shims + '\n' + r.outputFiles[0].text;
console.log('bundle bytes', code.length);
let t = performance.now();
const iso = new ivm.Isolate({ memoryLimit: 64 });
const script = await iso.compileScript(code);
console.log('compile ms', (performance.now() - t).toFixed(1));
for (let i = 0; i < 3; i++) {
  t = performance.now();
  const ctx = await iso.createContext();
  await ctx.global.set('globalThis', ctx.global.derefInto());
  script.runSync(ctx, { timeout: 1000 });
  const t2 = performance.now();
  const html = ctx.evalSync('__renderTest("world")', { timeout: 1000 });
  console.log(`ctx+run ms ${(t2 - t).toFixed(1)} render ms ${(performance.now() - t2).toFixed(2)}`, html);
  ctx.release();
}
