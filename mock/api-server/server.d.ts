export const API_KEY: string
export function startMockApi(opts?: { port?: number; host?: string }): Promise<{
  origin: string
  hits: { path: string; search: string; headers: Record<string, string | string[] | undefined> }[]
  close(): Promise<void>
}>
