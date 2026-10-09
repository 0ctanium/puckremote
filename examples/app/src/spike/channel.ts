/**
 * SPIKE (chore/two-puck-spike, throwaway): the channel between the admin Puck (fields, header,
 * history; holds the data) and the frame Puck (canvas, drawer, outline; theme code).
 *
 *   frame → admin   ready, action { seq, action }           (a user action in the frame)
 *   admin → frame   init { payload }, state { data, itemSelector, ack }, intent { undo | redo }
 *
 * `ack` is the last frame action the admin applied: the frame ignores states older than its own
 * pending actions, so in-flight keystrokes are never overwritten. Origin AND source are checked on
 * both sides, as in the real protocol.
 */
import type { PuckAction } from "@puckeditor/core";

export const SPIKE = "puck-remote-spike";

export type ItemSelector = { index: number; zone?: string } | null;

export type FrameToAdmin =
  | { spike: typeof SPIKE; type: "ready" }
  | { spike: typeof SPIKE; type: "action"; seq: number; action: PuckAction }
  | { spike: typeof SPIKE; type: "intent"; intent: "undo" | "redo" };

export type AdminToFrame =
  | { spike: typeof SPIKE; type: "init"; payload: unknown }
  | { spike: typeof SPIKE; type: "state"; data: unknown; itemSelector: ItemSelector; ack: number };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
export const isSpike = (v: unknown): v is { type: string } & Record<string, unknown> =>
  isObj(v) && v.spike === SPIKE && typeof v.type === "string";

/** Data-changing actions the frame forwards. Selection travels as setUi { itemSelector } only. */
export const DATA_ACTIONS = new Set(["insert", "duplicate", "reorder", "move", "replace", "replaceRoot", "remove"]);

/** Serialized size, for the spike's notes on message cost. */
export const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
