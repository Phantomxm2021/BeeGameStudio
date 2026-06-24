#!/usr/bin/env bun
import { resolve } from 'node:path'
import { getMacroDefines } from './defines.ts'

type MacroGlobals = {
  VERSION: string
  BUILD_TIME: string
  FEEDBACK_CHANNEL: string
  ISSUES_EXPLAINER: string
  NATIVE_PACKAGE_URL: string
  PACKAGE_URL: string
  VERSION_CHANGELOG: string
}

const macroValues = Object.fromEntries(
  Object.entries(getMacroDefines()).map(([key, value]) => [
    key.replace('MACRO.', ''),
    JSON.parse(value) as string,
  ]),
) as MacroGlobals

Object.assign(globalThis, { MACRO: macroValues })
process.env.NODE_ENV = process.env.NODE_ENV || 'production'

const { createAgentWorkflowApp } = await import(
  '../packages/agent-workflow-server/src/app.ts'
)

const port = Number.parseInt(process.env.AGENT_WORKFLOW_PORT || '62174', 10)
const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  fetch: createAgentWorkflowApp({
    modelConfigStore: {},
    defaultWorkspacePath: process.env.AGENT_WORKFLOW_WORKSPACE_PATH
      ? resolve(process.env.AGENT_WORKFLOW_WORKSPACE_PATH)
      : resolve(import.meta.dir, '..', 'Projects'),
  }).fetch,
})

console.log(
  `Agent workflow server listening on http://127.0.0.1:${server.port}`,
)

await new Promise(() => {})
