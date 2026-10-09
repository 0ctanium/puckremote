import type { RpcHandlers } from "@puck-remote/editor/frame";
import { currentUser } from "./actions";

/**
 * What the editor frame may call (allow-list). Theme code runs there, so only harmless methods:
 * never publish, history or anything with authority. Its type also types the editor's calls:
 * `useEditor<AdminRpc>().rpc('currentUser')`, with a type-only import on the editor side.
 * (resolveData is not here: this page's Puck calls it directly.)
 */
export const rpc = { currentUser } satisfies RpcHandlers;

export type AdminRpc = typeof rpc;
