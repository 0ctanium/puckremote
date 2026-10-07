import ivm from 'isolated-vm';
const iso = new ivm.Isolate({ memoryLimit: 16 });
const ctx = await iso.createContext();
const t = performance.now();
try { ctx.evalSync(`(async()=>{ while(true){ await null; } })(); 'ok'`, { timeout: 200 }); console.log('returned'); }
catch (e) { console.log('threw:', e.message); }
console.log('elapsed ms', (performance.now()-t).toFixed(0), 'disposed', iso.isDisposed);
try { console.log('next call', ctx.evalSync('1+1', { timeout: 200 })); } catch (e) { console.log('next threw', e.message); }
const ctx2 = await iso.createContext(); console.log('new ctx', ctx2.evalSync('2+2'));
