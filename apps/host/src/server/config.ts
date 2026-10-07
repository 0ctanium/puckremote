import path from 'node:path'

export interface CollectionPolicy {
  /** Fields a block may select / filter / sort on. `id` is always allowed. */
  fields: string[]
  maxLimit: number
  maxDepth: number
  /** Field + value that marks a document as public. Draft mode skips this filter. */
  publicWhen: { field: string; equals: string }
  /** Cache tag invalidated when this collection changes. */
  tag: string
}

export interface SecretDef {
  value: string
  /** Origins this secret may be sent to. Anything else is rejected. */
  origins: string[]
}

export interface HostConfig {
  rootDir: string
  artifactsDir: string
  pagesDir: string
  payloadDataFile: string
  site: { name: string; locale: string }
  isolate: {
    memoryLimitMb: number
    /** Per-call CPU timeout enforced by isolated-vm. */
    callTimeoutMs: number
    /** Host-side wall-clock watchdog; on overrun the isolate is disposed. */
    watchdogMs: number
    maxInputBytes: number
    maxOutputBytes: number
  }
  budget: {
    maxQueries: number
    maxResponseBytes: number
    maxWallMs: number
  }
  payload: {
    collections: Record<string, CollectionPolicy>
    globals: string[]
  }
  http: {
    /** Origins blocks/adapters may reach. Must also match the block's declared origin. */
    allowedOrigins: string[]
    /**
     * Origins exempt from https + public-IP rules. Dev/test only (the mock API on localhost).
     * Never set in production.
     */
    insecureDevOrigins: string[]
    timeoutMs: number
    maxResponseBytes: number
    maxRedirects: number
    cacheTtlMs: number
  }
  secrets: Record<string, SecretDef>
}

const rootDir = process.env.POC_ROOT ?? path.resolve(process.cwd(), process.cwd().endsWith(path.join('apps', 'host')) ? '../..' : '.')
const MOCK_API = process.env.POC_MOCK_API_ORIGIN ?? 'http://localhost:4010'

export function defaultHostConfig(overrides: Partial<HostConfig> = {}): HostConfig {
  return {
    rootDir,
    artifactsDir: path.join(rootDir, 'artifacts'),
    pagesDir: path.join(rootDir, 'data', 'pages'),
    payloadDataFile: path.join(rootDir, 'data', 'payload.json'),
    site: { name: 'POC Site', locale: 'en' },
    isolate: {
      memoryLimitMb: 64,
      callTimeoutMs: 200,
      watchdogMs: 1000,
      maxInputBytes: 1024 * 1024,
      maxOutputBytes: 512 * 1024,
    },
    budget: { maxQueries: 20, maxResponseBytes: 2 * 1024 * 1024, maxWallMs: 3000 },
    payload: {
      collections: {
        posts: {
          fields: ['title', 'slug', 'excerpt', 'publishedAt', 'status', 'author'],
          maxLimit: 12,
          maxDepth: 1,
          publicWhen: { field: '_status', equals: 'published' },
          tag: 'posts',
        },
      },
      globals: ['site'],
    },
    http: {
      allowedOrigins: [MOCK_API],
      insecureDevOrigins: process.env.NODE_ENV === 'production' && !process.env.POC_ALLOW_DEV_ORIGINS ? [] : [MOCK_API],
      timeoutMs: 2000,
      maxResponseBytes: 512 * 1024,
      maxRedirects: 3,
      cacheTtlMs: 30_000,
    },
    secrets: {
      EVENTS_API_KEY: { value: process.env.EVENTS_API_KEY ?? 'dev-events-key-7f3a9c', origins: [MOCK_API] },
    },
    ...overrides,
  }
}
