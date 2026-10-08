/**
 * Browser side of theme bundles. bundle.browser.js (editor) and bundle.islands.js (public pages)
 * do not bundle React or the SDK: they read the page's copies from globalThis, so theme
 * components and the page share one React and one SDK (one SlotContext).
 */
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'
import * as JSXRuntime from 'react/jsx-runtime'
import * as Sdk from './index.ts'

/** Where theme browser bundles find shared modules (same value as the CLI constant). */
export const BROWSER_MODULES_GLOBAL = '__puckRemoteModules'

/** Give theme bundles this page's React and SDK. Call before importing a theme bundle. */
export function registerSharedModules(): void {
  ;(globalThis as Record<string, unknown>)[BROWSER_MODULES_GLOBAL] = {
    react: React,
    'react/jsx-runtime': JSXRuntime,
    'react-dom': ReactDOM,
    'react-dom/client': ReactDOMClient,
    '@puck-remote/sdk': Sdk,
  }
}
