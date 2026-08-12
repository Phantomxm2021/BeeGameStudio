#!/usr/bin/env bun
import {
  buildApiEnv,
  buildFrontendEnv,
  resolveDashboardDevOptions,
} from './dashboard-dev-lib'

const options = resolveDashboardDevOptions(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
})

const apiPort = options.preferredApiPort
const frontendPort = options.preferredFrontendPort
const bunExecutable = process.execPath
const children: Array<ReturnType<typeof Bun.spawn>> = []

console.log('Starting BeeGame dashboard...')
console.log(`Workspace: ${options.workspacePath}`)
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
