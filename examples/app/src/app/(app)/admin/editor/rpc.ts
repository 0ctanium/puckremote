import type { RpcHandlers } from "@puck-remote/editor/frame";
import { currentUser, resolveData } from "./actions";

/**
 * What the editor frame may call (allow-list). Its type also types the editor's calls:
 * `useEditor<AdminRpc>().rpc('currentUser')`, with a type-only import on the editor side.
 */
export const rpc = { resolveData, currentUser } satisfies RpcHandlers;

export type AdminRpc = typeof rpc;
