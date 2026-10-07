/**
 * Outbound HTTP for http() queries and adapters. The host — never the isolate — performs I/O.
 *
 * Rules, applied to every hop:
 *  - https only (except explicitly configured dev origins such as the local mock API)
 *  - origin must equal the block's/adapter's declared origin AND be in the host allowlist
 *  - DNS is resolved by the host, private/loopback/link-local/etc. addresses are rejected,
 *    and the socket connects to the address that was validated (pinned lookup → no rebinding)
 *  - redirects are followed manually (max N), each hop re-validated, same origin only
 *  - $secret headers are substituted here, only for origins the secret is bound to
 *  - timeout and response size caps
 */
import { lookup as dnsLookup } from 'node:dns/promises'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { Agent } from 'undici'
import type { HostConfig } from '../config.ts'
import { QueryError } from './params.ts'

export interface HttpRequestSpec {
  origin: string
  path: string
  method: 'GET' | 'POST'
  params: Record<string, unknown>
  headers: Record<string, string | { $secret: string }>
}

export type Resolver = (hostname: string) => Promise<{ address: string; family: 4 | 6 }[]>

const defaultResolver: Resolver = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((r) => ({ address: r.address, family: r.family as 4 | 6 }))

const blocked = new BlockList()
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4')
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6')
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 0) return false
  if (family === 6) {
    // IPv4-mapped / -compatible addresses: judge the embedded IPv4.
    const m = /^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
    if (m) return isPublicAddress(m[1])
    return !blocked.check(address, 'ipv6')
  }
  return !blocked.check(address, 'ipv4')
}

export interface HttpSourceOptions {
  config: HostConfig['http']
  secrets: HostConfig['secrets']
  resolver?: Resolver
}

export interface HttpResponse {
  status: number
  json: unknown
  bytes: number
}

export class HttpSource {
  private readonly resolver: Resolver
  private readonly agent: Agent
  private readonly devAgent: Agent
  /** Count of outbound connections actually attempted (tests assert on this). */
  outbound = 0

  constructor(private readonly opts: HttpSourceOptions) {
    this.resolver = opts.resolver ?? defaultResolver
    // Pinned lookup: whatever undici connects to has passed isPublicAddress().
    const lookup: LookupFunction = (hostname, options, cb) => {
      this.resolver(hostname).then(
        (addrs) => {
          const ok = addrs.filter((a) => isPublicAddress(a.address))
          if (ok.length === 0 || ok.length !== addrs.length) {
            return cb(Object.assign(new Error(`blocked: ${hostname} resolves to a non-public address`), { code: 'EBLOCKED' }), '', 4)
          }
          if ((options as { all?: boolean }).all) return (cb as any)(null, ok)
          cb(null, ok[0].address, ok[0].family)
        },
        (e) => cb(e, '', 4),
      )
    }
    this.agent = new Agent({ connect: { lookup, timeout: opts.config.timeoutMs } })
    this.devAgent = new Agent({ connect: { timeout: opts.config.timeoutMs } })
  }

  close(): Promise<void> {
    return Promise.all([this.agent.close(), this.devAgent.close()]).then(() => {})
  }

  private isDevOrigin(origin: string): boolean {
    return this.opts.config.insecureDevOrigins.includes(origin)
  }

  /** Static checks on a URL, before any network activity. */
  private async validateTarget(url: URL, declaredOrigin: string): Promise<void> {
    if (url.origin !== declaredOrigin) throw new QueryError('blocked', `origin ${url.origin} does not match declared ${declaredOrigin}`)
    if (!this.opts.config.allowedOrigins.includes(url.origin)) throw new QueryError('blocked', `origin ${url.origin} is not allowlisted`)
    if (url.username || url.password) throw new QueryError('blocked', 'credentials in URL')
    if (this.isDevOrigin(url.origin)) return
    if (url.protocol !== 'https:') throw new QueryError('blocked', 'https required')
    const host = url.hostname.replace(/^\[|\]$/g, '')
    if (isIP(host)) {
      if (!isPublicAddress(host)) throw new QueryError('blocked', `non-public address ${host}`)
      return
    }
    // Early, friendlier failure; the pinned lookup re-checks at connect time.
    const addrs = await this.resolver(host).catch(() => [])
    if (addrs.length === 0) throw new QueryError('blocked', `cannot resolve ${host}`)
    if (!addrs.every((a) => isPublicAddress(a.address))) throw new QueryError('blocked', `${host} resolves to a non-public address`)
  }

  private resolveHeaders(headers: HttpRequestSpec['headers'], origin: string): Record<string, string> {
    const out: Record<string, string> = { accept: 'application/json', 'user-agent': 'puck-remote/0.1' }
    for (const [k, v] of Object.entries(headers)) {
      const name = k.toLowerCase()
      if (['host', 'cookie', 'authorization-proxy', 'connection', 'transfer-encoding', 'content-length'].includes(name)) {
        throw new QueryError('blocked', `header ${k} may not be set`)
      }
      if (typeof v === 'string') out[name] = v
      else {
        const def = Object.hasOwn(this.opts.secrets, v.$secret) ? this.opts.secrets[v.$secret] : undefined
        if (!def) throw new QueryError('secret', `unknown secret ${v.$secret}`)
        if (!def.origins.includes(origin)) throw new QueryError('secret', `secret ${v.$secret} is not bound to ${origin}`)
        out[name] = def.value
      }
    }
    return out
  }

  buildUrl(spec: Pick<HttpRequestSpec, 'origin' | 'path' | 'params' | 'method'>): URL {
    if (!spec.path.startsWith('/') || spec.path.startsWith('//') || spec.path.includes('\\')) throw new QueryError('blocked', 'path must be origin-relative')
    const url = new URL(spec.path, spec.origin)
    if (spec.method === 'GET') {
      for (const [k, v] of Object.entries(spec.params)) {
        if (v === null || v === undefined) continue
        if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, String(x)))
        else if (typeof v === 'object') url.searchParams.set(k, JSON.stringify(v))
        else url.searchParams.set(k, String(v))
      }
    }
    return url
  }

  async fetchJson(spec: HttpRequestSpec, signal?: AbortSignal): Promise<HttpResponse> {
    const declared = spec.origin
    let url = this.buildUrl(spec)
    const headers = this.resolveHeaders(spec.headers, declared)
    const body = spec.method === 'POST' ? JSON.stringify(spec.params) : undefined
    if (body) headers['content-type'] = 'application/json'
    const timeout = AbortSignal.timeout(this.opts.config.timeoutMs)
    const sig = signal ? AbortSignal.any([signal, timeout]) : timeout

    for (let hop = 0; ; hop++) {
      await this.validateTarget(url, declared)
      this.outbound++
      const res = await (this.isDevOrigin(url.origin) ? this.devAgent : this.agent)
        .request({ origin: url.origin, path: url.pathname + url.search, method: spec.method, headers, body, signal: sig })
        .catch((e: Error & { code?: string; cause?: { code?: string } }) => {
          if (e.code === 'EBLOCKED' || e.cause?.code === 'EBLOCKED') throw new QueryError('blocked', e.message)
          if (sig.aborted) throw new QueryError('timeout', 'request timed out')
          throw new QueryError('network', e.message)
        })
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        await res.body.dump()
        if (hop >= this.opts.config.maxRedirects) throw new QueryError('blocked', 'too many redirects')
        const next = new URL(String(res.headers.location), url)
        // Same-origin only; validateTarget re-checks scheme, allowlist and DNS on the next loop.
        if (next.origin !== declared) throw new QueryError('blocked', `redirect to different origin ${next.origin}`)
        url = next
        continue
      }
      const max = this.opts.config.maxResponseBytes
      const chunks: Buffer[] = []
      let bytes = 0
      for await (const chunk of res.body) {
        bytes += chunk.length
        if (bytes > max) {
          res.body.destroy()
          throw new QueryError('too-large', `response exceeds ${max} bytes`)
        }
        chunks.push(chunk)
      }
      if (res.statusCode < 200 || res.statusCode >= 300) throw new QueryError('http-status', `upstream returned ${res.statusCode}`)
      try {
        return { status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')), bytes }
      } catch {
        throw new QueryError('invalid-json', 'upstream response is not JSON')
      }
    }
  }
}
