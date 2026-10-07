(function(g){
  g.MessageChannel = function(){ this.port1 = { onmessage: null }; this.port2 = { postMessage: function(){} }; };
  // TextEncoder: react-dom/server.browser builds chunks as Uint8Array for streams; renderToString only needs it to exist + UTF-8 encode.
  g.TextEncoder = function(){};
  g.TextEncoder.prototype.encode = function(s){ s = String(s === undefined ? '' : s); var u = unescape(encodeURIComponent(s)); var a = new Uint8Array(u.length); for (var i=0;i<u.length;i++) a[i]=u.charCodeAt(i); return a; };
  g.TextEncoder.prototype.encodeInto = function(s, dest){ var a = this.encode(s); dest.set(a.subarray(0, dest.length)); return { read: s.length, written: Math.min(a.length, dest.length) }; };
})(globalThis);
