import ivm from 'isolated-vm';
const iso = new ivm.Isolate({ memoryLimit: 16 });
const ctx = await iso.createContext();
console.log(ctx.evalSync(`JSON.stringify(['fetch','process','require','setTimeout','queueMicrotask','console','TextEncoder','MessageChannel','WebAssembly','SharedArrayBuffer','Atomics','eval','Function'].map(k=>k+':'+typeof globalThis[k]))`));
// can async code run after sync call returns?
ctx.evalSync(`globalThis.n=0; (async()=>{ while(true){ await null; n++; if(n>1e6) break; } })(); 'ok'`, { timeout: 200 });
console.log('after microtask loop, n=', ctx.evalSync('n'));
