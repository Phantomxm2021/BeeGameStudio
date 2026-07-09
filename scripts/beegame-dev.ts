#!/usr/bin/env bun
import { createServer } from 'node:net'
import {
  buildBeeGameDevPlan,
  DEFAULT_BEEGAME_BILLING_PORT,
  DEFAULT_BEEGAME_FRONTEND_PORT,
  DEFAULT_BEEGAME_RUNTIME_PORT,
  DEFAULT_BEEGAME_SKILLS_PORT,
  type BeeGameDevPorts,
} from './beegame-dev-lib'

const argv = process.argv.slice(2)
const preferredPlan = buildBeeGameDevPlan(argv, {
  cwd: process.cwd(),
  env: process.env,
  ports: {
    runtime: DEFAULT_BEEGAME_RUNTIME_PORT,
    frontend: DEFAULT_BEEGAME_FRONTEND_PORT,
    billing: DEFAULT_BEEGAME_BILLING_PORT,
    skills: DEFAULT_BEEGAME_SKILLS_PORT,
  },
  bunExecutable: process.execPath,
})
const reservedPorts = new Set<number>()
const ports: BeeGameDevPorts = {
  runtime: await reservePort(preferredPlan.ports.runtime),
  frontend: await reservePort(preferredPlan.ports.frontend),
  billing: await reservePort(preferredPlan.ports.billing),
  skills: await reservePort(preferredPlan.ports.skills),
}
const plan = buildBeeGameDevPlan(argv, {
  cwd: process.cwd(),
  env: process.env,
  ports,
  bunExecutable: process.execPath,
})
const children: Array<ReturnType<typeof Bun.spawn>> = []

console.log('Starting BeeGame local dev stack...')
console.log(`Workspace: ${plan.workspacePath}`)
for (const [name, port] of Object.entries(plan.ports)) {
  const preferredPort = preferredPlan.ports[name as keyof BeeGameDevPorts]
  if (port !== preferredPort) {
    console.log(`${name} port ${preferredPort} is busy; using ${port} instead.`)
  }
}

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

async function reservePort(preferredPort: number): Promise<number> {
  const port = await findAvailablePort(preferredPort, reservedPorts)
  reservedPorts.add(port)
  return port
}

async function findAvailablePort(
  preferredPort: number,
  unavailablePorts = new Set<number>(),
): Promise<number> {
  for (let port = preferredPort; port < preferredPort + 50; port += 1) {
    if (unavailablePorts.has(port)) continue
    const result = await canListen(port)
    if (result === 'unknown') return port
    if (result) return port
  }
  throw new Error(
    `No available port found in range ${preferredPort}-${preferredPort + 49}`,
  )
}

async function canListen(port: number): Promise<boolean | 'unknown'> {
  return new Promise(resolve => {
    const server = createServer()
    server.once('error', error => {
      const code = (error as NodeJS.ErrnoException).code
      resolve(code === 'EPERM' ? 'unknown' : false)
    })
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}
