#!/usr/bin/env bun
import { resolve } from 'node:path'
import { getMacroDefines } from './defines.ts'
import { loadEnvFile } from './beegame-migration-cli.ts'

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

// This executable is the local dashboard runtime.  It can be launched either
// through `beegame-dev` or directly, so load the local configuration here as
// well instead of depending on a parent launcher to do it.
loadEnvFile('.env.local')

Object.assign(globalThis, { MACRO: macroValues })
// Keep an explicitly supplied production mode intact, but never silently run
// a local development server as production.  Several security policies need
// this distinction to allow narrowly scoped development-only integrations.
process.env.NODE_ENV = process.env.NODE_ENV || 'development'
process.env.BEEGAME_ALLOW_DEV_AUTH_TOKENS =
  process.env.BEEGAME_ALLOW_DEV_AUTH_TOKENS || '1'

const { createAgentWorkflowApp } = await import(
  '../packages/agent-workflow-server/src/app.ts'
)
const { createResourceSelectionClient } = await import(
  '../packages/agent-workflow-server/src/beegame/resource-selection-client.ts'
)
const { resolveResourceSelectionRuntimeConfig } = await import(
  '../packages/agent-workflow-server/src/beegame/resource-selection-config.ts'
)

const port = Number.parseInt(process.env.AGENT_WORKFLOW_PORT || '62174', 10)
const resourceSelectionConfig = resolveResourceSelectionRuntimeConfig()
const cleanupHandlers: Array<() => void | Promise<void>> = []
const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  fetch: createAgentWorkflowApp({
    registerCleanup: cleanup => cleanupHandlers.push(cleanup),
    modelConfigStore: {},
    defaultWorkspacePath: process.env.AGENT_WORKFLOW_WORKSPACE_PATH
      ? resolve(process.env.AGENT_WORKFLOW_WORKSPACE_PATH)
      : resolve(import.meta.dir, '..', 'Projects'),
    ...(resourceSelectionConfig
      ? {
          resourceSelectionClient: createResourceSelectionClient(resourceSelectionConfig),
          resourceSelectionRuntimeConfig: resourceSelectionConfig,
        }
      : {}),
  }).fetch,
})

let shuttingDown = false
async function shutdown(signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  for (const cleanup of cleanupHandlers) await cleanup()
  server.stop(true)
  process.exit(signal === 'SIGINT' ? 130 : 143)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void shutdown(signal))
}

console.log(
  `Agent workflow server listening on http://127.0.0.1:${server.port}`,
)

await new Promise(() => {})
