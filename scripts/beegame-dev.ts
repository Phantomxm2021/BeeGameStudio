#!/usr/bin/env bun
import {
  buildBeeGameDevPlan,
  waitForBeeGameDevServices,
  stopBeeGameDevServices,
  DEFAULT_BEEGAME_BILLING_PORT,
  DEFAULT_BEEGAME_FRONTEND_PORT,
  DEFAULT_BEEGAME_RUNTIME_PORT,
  DEFAULT_BEEGAME_RESOURCE_PORT,
  DEFAULT_BEEGAME_SKILLS_PORT,
  type BeeGameDevPorts,
  type BeeGameDevProcessName,
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
const children: Array<{ name: BeeGameDevProcessName; child: ReturnType<typeof Bun.spawn> }> = []

await assertFixedServicePortsAvailable()
console.log('Checking BGS runtime...')
const runtimePreflight = Bun.spawnSync(plan.runtimePreflight.command, {
  cwd: plan.runtimePreflight.cwd,
  env: { ...process.env, ...plan.runtimePreflight.env },
  stdout: 'inherit',
  stderr: 'inherit',
})
if (runtimePreflight.exitCode !== 0)
  throw new Error('BGS runtime preflight failed')
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
  children.push({ name: processPlan.name, child })
}

console.log(`Frontend: http://127.0.0.1:${plan.ports.frontend}`)
console.log(`Runtime:  http://127.0.0.1:${plan.ports.runtime}`)
console.log(`Billing:  http://127.0.0.1:${plan.ports.billing}`)
console.log(`Skills:   http://127.0.0.1:${plan.ports.skills}`)
console.log(`Resources: http://127.0.0.1:${plan.ports.resources}`)

let shuttingDown = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return
    shuttingDown = true
    void stopBeeGameDevServices(children).then(
      () => process.exit(signal === 'SIGINT' ? 130 : 143),
      error => { console.error(error.message); process.exit(1) },
    )
  })
}

await waitForBeeGameDevServices(children, event => {
  console.error(JSON.stringify({ type: 'service.exited', timestamp: new Date().toISOString(), ...event }))
  if (event.exitCode !== 0) process.exitCode = 1
})
