/**
 * Entry of the static editor (built into dist/static by scripts/build-static.mjs): Puck + the
 * bridge, on its own origin, with no credentials. The theme's browser bundle imports react and
 * @puck-remote/sdk by name; the import map in index.html points them at shims that re-export the
 * modules below, so the theme and Puck share one React and one SDK (one SlotContext).
 */
import '@puckeditor/core/no-external.css'
import * as Sdk from '@puck-remote/sdk'
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'
import * as JSXRuntime from 'react/jsx-runtime'
import { startEditorBridge } from './bridge.tsx'
import { CONFIG_ELEMENT_ID } from './protocol.ts'

;(globalThis as { __puckRemoteModules?: Record<string, unknown> }).__puckRemoteModules = {
  react: React,
  'react/jsx-runtime': JSXRuntime,
  'react-dom': ReactDOM,
  'react-dom/client': ReactDOMClient,
  '@puck-remote/sdk': Sdk,
}

const root = document.getElementById('editor')!
// Injected by the server (createEditorHandler): which admin origins may embed this editor.
let adminOrigins: string[] = []
try {
  const parsed = JSON.parse(document.getElementById(CONFIG_ELEMENT_ID)?.textContent ?? '{}') as { adminOrigins?: unknown }
  if (Array.isArray(parsed.adminOrigins)) adminOrigins = parsed.adminOrigins.filter((o): o is string => typeof o === 'string')
} catch {}
if (adminOrigins.length) startEditorBridge({ root, allowedParents: adminOrigins })
else root.textContent = 'Editor not configured: no admin origins.'
