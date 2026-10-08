/**
 * Editor Puck config, rebuilt in the iframe from the manifest (JSON: fields, defaults,
 * categories) and the theme's browser bundle (render functions). Blocks are real client
 * components here; slots are Puck's own, so drag and drop and inline editing work natively.
 */
import type { Config } from '@puckeditor/core';
import type { BlockMeta, Manifest } from '@puck-remote/core';
import type { BlockDefinition, RenderCtx, RootDefinition } from '@puck-remote/sdk';
/** What the theme's bundle.browser.js exports by default. */
export interface ThemeModule {
    blocks: Record<string, BlockDefinition<any, any>>;
    root: RootDefinition<any, any> | null;
}
export declare const MISSING_TYPE = "__missing";
export declare const RESERVED_DATA_PROP = "__data";
export interface EditorDeps {
    /** Render context for blocks (asset URLs, style requests). */
    ctx: RenderCtx;
    /** Data for one block (the host's resolveData RPC). */
    resolve: (block: string, props: Record<string, unknown>) => Promise<Record<string, unknown>>;
    debounceMs?: number;
}
type AnyProps = Record<string, any>;
/** Props a block's render receives: no host keys, no Puck internals, no slots. */
export declare function renderProps(props: Record<string, unknown>, meta: BlockMeta | null): Record<string, unknown>;
/** One block (or the root) in the canvas: the theme's own render, with Puck's slots. */
export declare function BrowserBlock(p: {
    name: string;
    def: BlockDefinition<any, any> | RootDefinition<any, any>;
    meta: BlockMeta;
    props: AnyProps;
    deps: EditorDeps;
    extraSlots?: Record<string, unknown>;
}): import("react").JSX.Element;
export declare function buildEditorConfig(manifest: Manifest, theme: ThemeModule, deps: EditorDeps, categoriesOverride?: Manifest['categories']): Config;
export {};
