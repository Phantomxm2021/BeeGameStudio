import { execFile } from 'node:child_process'
import { createServer } from 'node:net'
import { promisify } from 'node:util'

export const BEEGAME_FIXED_SERVICE_PORTS = Object.freeze({
  frontend: 62173,
  runtime: 62174,
  billing: 62175,
  skills: 62176,
  resources: 62177,
})

export type BeeGameFixedService = keyof typeof BEEGAME_FIXED_SERVICE_PORTS

const SERVICE_ENV: Readonly<Record<BeeGameFixedService, readonly string[]>> = {
  frontend: ['VITE_PORT', 'PORT'],
  runtime: ['AGENT_WORKFLOW_PORT'],
  billing: ['BEEGAME_BILLING_PORT'],
  skills: ['BEEGAME_SKILLS_PORT'],
  resources: ['BEEGAME_RESOURCE_PORT'],
}

const SERVICE_FLAGS: Readonly<Record<BeeGameFixedService, readonly string[]>> = {
  frontend: ['--frontend-port'],
  runtime: ['--runtime-port', '--api-port'],
  billing: ['--billing-port'],
  skills: ['--skills-port'],
  resources: ['--resources-port'],
}

export function assertFixedServicePortConfiguration(input: {
  argv: readonly string[]
  env: Record<string, string | undefined>
}): void {
  for (const service of fixedServiceNames()) {
    const port = BEEGAME_FIXED_SERVICE_PORTS[service]
    for (const flag of SERVICE_FLAGS[service]) {
      if (
        input.argv.some(argument =>
          argument === flag || argument.startsWith(`${flag}=`),
        )
      )
        throw new Error(
          `fixed ${service} port is ${port}; remove the ${flag} override`,
        )
    }
    for (const name of SERVICE_ENV[service]) {
      const value = input.env[name]
      if (value !== undefined && value !== '' && value !== String(port))
        throw new Error(`${name} must use fixed ${service} port ${port}`)
    }
  }
}

export function resolveFixedServicePort(
  service: BeeGameFixedService,
  configured?: string,
): number {
  const port = BEEGAME_FIXED_SERVICE_PORTS[service]
  if (configured !== undefined && configured !== '' && configured !== String(port))
    throw new Error(
      `${SERVICE_ENV[service][0]} must use fixed ${service} port ${port}`,
    )
  return port
}

export async function assertFixedServicePortsAvailable(input: {
  probe?: (port: number) => Promise<boolean>
  owner?: (port: number) => Promise<string>
} = {}): Promise<void> {
  const probe = input.probe ?? portIsAvailable
  const owner = input.owner ?? portOwner
  for (const service of fixedServiceNames()) {
    const port = BEEGAME_FIXED_SERVICE_PORTS[service]
    if (await probe(port)) continue
    const evidence = (await owner(port)).trim() || 'owner unavailable'
    throw new Error(
      `${service} fixed port ${port} is occupied: ${evidence}`,
    )
  }
}

function fixedServiceNames(): BeeGameFixedService[] {
  return Object.keys(BEEGAME_FIXED_SERVICE_PORTS) as BeeGameFixedService[]
}

async function portIsAvailable(port: number): Promise<boolean> {
  return await new Promise(resolve => {
    const server = createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(error => resolve(!error))
    })
  })
}

const execFileAsync = promisify(execFile)

async function portOwner(port: number): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'lsof',
      ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpcn'],
      { maxBuffer: 16_384 },
    )
    return stdout.trim().split('\n').slice(0, 12).join(' ')
  } catch {
    return 'owner unavailable'
  }
}
