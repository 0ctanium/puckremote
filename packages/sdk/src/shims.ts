/**
 * Minimal globals react-dom/server.browser needs in a bare V8 context (verified in /spike).
 * Prepended to bundle.js by the CLI. Deliberately NOT provided: setTimeout, queueMicrotask,
 * fetch, process, require — blocks must not be able to schedule work or do I/O.
 */
export const ISOLATE_SHIMS = `/* @poc/sdk isolate shims */
(function (g) {
  // Probed by the scheduler at module init; never fires (renderToString never yields).
  g.MessageChannel = function () { this.port1 = { onmessage: null }; this.port2 = { postMessage: function () {} }; };
  // Instantiated by Fizz at module init. UTF-8 only.
  g.TextEncoder = function () {};
  g.TextEncoder.prototype.encode = function (s) {
    s = s === undefined ? '' : String(s);
    var u = unescape(encodeURIComponent(s)), a = new Uint8Array(u.length);
    for (var i = 0; i < u.length; i++) a[i] = u.charCodeAt(i);
    return a;
  };
  g.TextEncoder.prototype.encodeInto = function (s, dest) {
    var a = this.encode(s), n = Math.min(a.length, dest.length);
    dest.set(a.subarray(0, n));
    return { read: s.length, written: n };
  };
})(globalThis);
`
