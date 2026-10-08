/** Admin origins allowed to embed the editor. Dev default: the example host's admin hostname. */
export const adminOrigins = () =>
  (process.env.PUCK_REMOTE_ADMIN_ORIGINS ?? 'http://admin.localhost:3100')
    .split(',')
    .map((o) => new URL(o.trim()).origin)
