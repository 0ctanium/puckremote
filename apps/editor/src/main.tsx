/**
 * The static editor app: Puck + the puck-remote bridge, on its own origin, with no credentials.
 * The theme's browser bundle imports react and @puck-remote/sdk by bare name; the import map in
 * index.html points them at shims that re-export the modules below, so the theme and Puck share
 * one React and one SDK (one SlotContext).
 */
import '@puckeditor/core/no-external.css'
import * as Sdk from '@puck-remote/sdk'
import { startEditorBridge } from '@puck-remote/editor/bridge'
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'
import * as JSXRuntime from 'react/jsx-runtime'

declare const __ADMIN_ORIGINS__: string[]

;(globalThis as { __puckRemoteModules?: Record<string, unknown> }).__puckRemoteModules = {
  react: React,
  'react/jsx-runtime': JSXRuntime,
  'react-dom': ReactDOM,
  'react-dom/client': ReactDOMClient,
  '@puck-remote/sdk': Sdk,
}

startEditorBridge({ root: document.getElementById('editor')!, allowedParents: __ADMIN_ORIGINS__ })
