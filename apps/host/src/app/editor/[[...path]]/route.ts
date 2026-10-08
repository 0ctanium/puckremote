import { remote } from '@/puck-remote.ts'

// The static editor. Only reachable on origins.editor: the proxy rewrites that origin here.
export const { GET, HEAD } = remote.editor
