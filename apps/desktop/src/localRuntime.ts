import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const RUNTIME_URL = 'http://127.0.0.1:62174'
const PUBLIC_CONFIG_KEYS = [
  'BEEGAME_SUPABASE_URL', 'BEEGAME_SUPABASE_ANON_KEY',
  'BEEGAME_BILLING_API_BASE_URL', 'BEEGAME_SKILLS_API_BASE_URL', 'BEEGAME_RESOURCE_SERVER_URL',
] as const

/** Public deployment settings only. Neither administrative nor model keys ship. */
export function publicRuntimeConfig(env: Record<string, string | undefined>): Record<string, string> {
  const aliases: Record<string, string> = {
    BEEGAME_SUPABASE_URL: 'VITE_SUPABASE_URL', BEEGAME_SUPABASE_ANON_KEY: 'VITE_SUPABASE_ANON_KEY',
    BEEGAME_RESOURCE_SERVER_URL: 'VITE_RESOURCE_API_BASE_URL',
  }
  const config: Record<string, string> = {}
  for (const key of PUBLIC_CONFIG_KEYS) {
    const value = (env[key] || env[aliases[key]])?.trim()
    if (!value) continue
    if (key.endsWith('URL')) {
      const url = new URL(value)
      if (url.protocol !== 'https:' || url.username || url.password)
        throw Error(`${key} must be a public HTTPS service URL`)
    }
    config[key] = value
  }
  if (config.BEEGAME_SUPABASE_URL || config.BEEGAME_SUPABASE_ANON_KEY) {
    for (const key of PUBLIC_CONFIG_KEYS)
      if (!config[key]) throw Error(`Cloud-connected desktop requires ${key}; do not package server credentials`)
  }
  return config
}

type KeyStorage = {
  isAsyncEncryptionAvailable(): Promise<boolean>
  encryptStringAsync(value: string): Promise<Buffer>
  decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
  getSelectedStorageBackend(): string
}

export async function localRuntimeKey(userData: string, storage: KeyStorage): Promise<string> {
  if (!await storage.isAsyncEncryptionAvailable() ||
      process.platform === 'linux' && storage.getSelectedStorageBackend() === 'basic_text')
    throw Error('OS-protected storage is required for local BGS credentials')
  const file = path.join(userData, 'runtime-key.enc')
  let encrypted: Buffer | undefined
  try { encrypted = await readFile(file) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  if (encrypted) {
    const value = await storage.decryptStringAsync(encrypted)
    if (!/^[A-Za-z0-9+/]{43}=$/.test(value.result) || Buffer.from(value.result, 'base64').length !== 32)
      throw Error('Stored BGS encryption key is invalid; existing credentials were not replaced')
    if (value.shouldReEncrypt) await writeFile(file, await storage.encryptStringAsync(value.result), { mode: 0o600 })
    return value.result
  }
  const key = randomBytes(32).toString('base64')
  await writeFile(file, await storage.encryptStringAsync(key), { flag: 'wx', mode: 0o600 })
  return key
}

export type LocalRuntime = {
  closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  stop(): Promise<void>
}

/** Own one existing Bun runtime, never the development stack or an unrelated port owner. */
export async function startLocalRuntime(resources: string, userData: string, storage: KeyStorage): Promise<LocalRuntime> {
  const root = path.join(resources, 'runtime')
  const config = publicRuntimeConfig(JSON.parse(await readFile(path.join(root, 'public-config.json'), 'utf8')))
  await mkdir(userData, { recursive: true, mode: 0o700 })
  const key = await localRuntimeKey(userData, storage)
  const inherited = ['HOME', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'PATH', 'LANG', 'LC_ALL',
    'USER', 'LOGNAME', 'SHELL', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy']
  const environment: Record<string, string> = {}
  for (const name of inherited) {
    const value = process.env[name]
    if (value !== undefined) environment[name] = value
  }
  Object.assign(environment, config, {
    NODE_ENV: 'production', AGENT_WORKFLOW_HOST: '127.0.0.1', AGENT_WORKFLOW_PORT: '62174',
    AGENT_WORKFLOW_WORKSPACE_PATH: path.join(userData, 'Projects'), AGENT_WORKFLOW_DATA_DIR: path.join(userData, 'configuration'),
    BEEGAME_WORKFLOW_V3_STORE: 'local-single-process', BEEGAME_CONFIG_ENCRYPTION_KEY: key,
    BEEGAME_WORKFLOW_V3_PREVIEW_ORIGIN: 'http://localhost:62174',
    BEEGAME_API_CORS_ORIGINS: 'http://127.0.0.1:62173',
    BEEGAME_BILLING_MODE: config.BEEGAME_BILLING_API_BASE_URL ? 'remote' : 'disabled',
    BEEGAME_BUILTIN_SKILLS_DIR: path.join(root, '.beegame/plugins/bgs-game-development'),
    BEEGAME_BGS_PATH: path.join(root, 'dist/bgs-runtime', process.platform === 'win32' ? 'bgs.exe' : 'bgs'),
    PATH: path.join(root, 'bin') + path.delimiter + (environment.PATH || ''),
  })
  const logPath = path.join(userData, 'runtime.log')
  const log = createWriteStream(logPath, { flags: 'a', mode: 0o600 })
  const child = spawn(path.join(root, 'bin', process.platform === 'win32' ? 'bun.exe' : 'bun'),
    ['packages/agent-workflow-server/src/index.ts'], { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
  const closed = new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve, reject) => {
    child.once('error', error => { log.end(); reject(error) })
    child.once('close', (code, signal) => log.end(() => resolve({ code, signal })))
    log.once('error', error => { child.kill('SIGTERM'); reject(error) })
  })
  let stopping: Promise<void> | undefined
  const stop = () => stopping ??= (async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    await closed
  })()
  child.stdout.pipe(log, { end: false })
  child.stderr.pipe(log, { end: false })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      let output = ''
      child.stdout.on('data', (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-4096)
        if (output.includes(`Agent workflow server listening on ${RUNTIME_URL}`)) resolve()
      })
      void closed.then(result => reject(Error(`Local BGS stopped before readiness (${result.code ?? result.signal}); see ${logPath}`)), reject)
      timer = setTimeout(() => reject(Error(`Local BGS startup timed out; see ${logPath}`)), 30_000)
    })
  } catch (error) { await stop(); throw error }
  finally { clearTimeout(timer) }
  return { closed, stop }
}
