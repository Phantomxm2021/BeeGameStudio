#!/usr/bin/env bun
import { createServer } from 'node:net'
import {
  buildApiEnv,
  buildFrontendEnv,
  resolveDashboardDevOptions,
} from './dashboard-dev-lib'

const options = resolveDashboardDevOptions(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
})

const apiPort = await findAvailablePort(options.preferredApiPort)
const frontendPort = await findAvailablePort(
  options.preferredFrontendPort,
  new Set([apiPort]),
)
const bunExecutable = process.execPath
const children: Array<ReturnType<typeof Bun.spawn>> = []

console.log('Starting BeeGame dashboard...')
console.log(`Workspace: ${options.workspacePath}`)
if (apiPort !== options.preferredApiPort) {
  console.log(
    `API port ${options.preferredApiPort} is busy; using ${apiPort} instead.`,
  )
}
if (frontendPort !== options.preferredFrontendPort) {
  console.log(
    `Frontend port ${options.preferredFrontendPort} is busy; using ${frontendPort} instead.`,
  )
}

const apiProcess = Bun.spawn([bunExecutable, 'scripts/dashboard-server-dev.ts'], {
  cwd: process.cwd(),
  env: buildApiEnv({
    apiPort,
    frontendPort,
    workspacePath: options.workspacePath,
    baseEnv: process.env,
  }),
  stdout: 'inherit',
  stderr: 'inherit',
})
children.push(apiProcess)

const frontendProcess = Bun.spawn(
  [
    bunExecutable,
    'run',
    'dev',
    '--',
    '--host',
    '127.0.0.1',
    '--port',
    String(frontendPort),
  ],
  {
    cwd: options.frontendDir,
    env: buildFrontendEnv({
      apiPort,
      frontendPort,
      baseEnv: process.env,
    }),
    stdout: 'inherit',
    stderr: 'inherit',
  },
)
children.push(frontendProcess)

console.log(`Dashboard: http://127.0.0.1:${frontendPort}`)
console.log(`API:       http://127.0.0.1:${apiPort}`)

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
