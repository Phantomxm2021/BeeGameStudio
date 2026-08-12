#!/usr/bin/env bun
import {
  buildBeeGameDevPlan,
  DEFAULT_BEEGAME_BILLING_PORT,
  DEFAULT_BEEGAME_FRONTEND_PORT,
  DEFAULT_BEEGAME_RUNTIME_PORT,
  DEFAULT_BEEGAME_RESOURCE_PORT,
  DEFAULT_BEEGAME_SKILLS_PORT,
  type BeeGameDevPorts,
} from './beegame-dev-lib'
import { assertFixedServicePortsAvailable } from '../packages/agent-workflow-server/src/beegame/fixed-service-ports'
import { loadEnvFile } from './beegame-migration-cli'

// Local service credentials live outside version control. Explicit shell
// environment variables remain authoritative over this local fallback.
loadEnvFile('.env.local')

const argv = process.argv.slice(2)
const ports: BeeGameDevPorts = {
  runtime: DEFAULT_BEEGAME_RUNTIME_PORT,
  frontend: DEFAULT_BEEGAME_FRONTEND_PORT,
  billing: DEFAULT_BEEGAME_BILLING_PORT,
  skills: DEFAULT_BEEGAME_SKILLS_PORT,
  resources: DEFAULT_BEEGAME_RESOURCE_PORT,
}
const plan = buildBeeGameDevPlan(argv, {
  cwd: process.cwd(),
  env: process.env,
  ports,
  bunExecutable: process.execPath,
})
const children: Array<ReturnType<typeof Bun.spawn>> = []

await assertFixedServicePortsAvailable()
console.log('Building Bee Game Studio native runtime...')
const nativeRuntimeBuild = Bun.spawnSync(plan.nativeRuntimeBuild.command, {
  cwd: plan.nativeRuntimeBuild.cwd,
  env: process.env,
  stdout: 'inherit',
  stderr: 'inherit',
})
if (nativeRuntimeBuild.exitCode !== 0)
  throw new Error('Bee Game Studio native runtime build failed')
console.log('Starting BeeGame local dev stack...')
console.log(`Workspace: ${plan.workspacePath}`)
for (const processPlan of plan.processes) {
  console.log(`Starting ${processPlan.name}...`)
  const child = Bun.spawn(processPlan.command, {
    cwd: processPlan.cwd,
    env: processPlan.env,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  children.push(child)
}

console.log(`Frontend: http://127.0.0.1:${plan.ports.frontend}`)
console.log(`Runtime:  http://127.0.0.1:${plan.ports.runtime}`)
console.log(`Billing:  http://127.0.0.1:${plan.ports.billing}`)
console.log(`Skills:   http://127.0.0.1:${plan.ports.skills}`)
console.log(`Resources: http://127.0.0.1:${plan.ports.resources}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    shutdown()
    process.exit(signal === 'SIGINT' ? 130 : 143)
  })
}

await Promise.race(children.map(child => child.exited))
shutdown()

function shutdown(): void {
  for (const child of children) {
    try {
      child.kill()
    } catch {
      // Child may already be closed.
    }
  }
}
