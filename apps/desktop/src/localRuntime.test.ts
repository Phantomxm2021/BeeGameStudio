import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { localRuntimeKey, publicRuntimeConfig, startLocalRuntime } from './localRuntime'

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn }))
const storage = () => ({
  isAsyncEncryptionAvailable: vi.fn(async () => true),
  encryptStringAsync: vi.fn(async (value: string) => Buffer.from('protected:' + value)),
  decryptStringAsync: vi.fn(async (value: Buffer) => ({ result: value.toString().slice(10), shouldReEncrypt: false })),
  getSelectedStorageBackend: vi.fn(() => 'keychain'),
})
let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'bgs-desktop-runtime-'))
  spawn.mockReset()
  await mkdir(path.join(root, 'runtime'))
  await writeFile(path.join(root, 'runtime/public-config.json'), '{}')
})
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) })

function childProcess() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill: vi.fn((signal: NodeJS.Signals) => {
      child.signalCode = signal
      child.stdout.end(); child.stderr.end()
      setImmediate(() => child.emit('close', null, signal))
      return true
    }),
  })
  return child
}

describe('public desktop deployment configuration', () => {
  it('copies public settings only and requires complete cloud endpoints', () => {
    expect(publicRuntimeConfig({ BEEGAME_SUPABASE_SERVICE_ROLE_KEY: 'secret', OPENAI_API_KEY: 'secret' })).toEqual({})
    const env = { VITE_SUPABASE_URL: 'https://bgs.phantominfra.com', VITE_SUPABASE_ANON_KEY: 'public',
      BEEGAME_BILLING_API_BASE_URL: 'https://billing.example.test', BEEGAME_SKILLS_API_BASE_URL: 'https://skills.example.test',
      VITE_RESOURCE_API_BASE_URL: 'https://assets.example.test' }
    expect(publicRuntimeConfig(env)).toEqual({ BEEGAME_SUPABASE_URL: env.VITE_SUPABASE_URL,
      BEEGAME_SUPABASE_ANON_KEY: 'public', BEEGAME_BILLING_API_BASE_URL: env.BEEGAME_BILLING_API_BASE_URL,
      BEEGAME_SKILLS_API_BASE_URL: env.BEEGAME_SKILLS_API_BASE_URL, BEEGAME_RESOURCE_SERVER_URL: env.VITE_RESOURCE_API_BASE_URL })
    expect(() => publicRuntimeConfig({ VITE_SUPABASE_URL: env.VITE_SUPABASE_URL })).toThrow('requires')
    expect(() => publicRuntimeConfig({ BEEGAME_BILLING_API_BASE_URL: 'http://127.0.0.1:62175' })).toThrow('HTTPS')
    expect(() => publicRuntimeConfig({ BEEGAME_SKILLS_API_BASE_URL: 'https://secret@example.test' })).toThrow('HTTPS')
  })
})

it('persists one OS-protected encryption key and refuses unavailable or damaged storage', async () => {
  const keyStorage = storage()
  const key = await localRuntimeKey(root, keyStorage)
  expect(Buffer.from(key, 'base64')).toHaveLength(32)
  expect(await localRuntimeKey(root, keyStorage)).toBe(key)
  expect(keyStorage.encryptStringAsync).toHaveBeenCalledTimes(1)
  expect((await readFile(path.join(root, 'runtime-key.enc'), 'utf8'))).toBe('protected:' + key)
  keyStorage.decryptStringAsync.mockResolvedValueOnce({ result: 'invalid', shouldReEncrypt: false })
  await expect(localRuntimeKey(root, keyStorage)).rejects.toThrow('were not replaced')
  expect(keyStorage.encryptStringAsync).toHaveBeenCalledTimes(1)
  keyStorage.isAsyncEncryptionAvailable.mockResolvedValueOnce(false)
  await expect(localRuntimeKey(root, keyStorage)).rejects.toThrow('OS-protected')
})

it('starts the shipped Bun/backend with isolated data, CLI and Plugin; stops only its own child', async () => {
  const child = childProcess()
  spawn.mockImplementation(() => {
    setImmediate(() => child.stdout.write('Agent workflow server listening on http://127.0.0.1:62174\n'))
    return child
  })
  vi.stubEnv('BEEGAME_SUPABASE_SERVICE_ROLE_KEY', 'must-not-inherit')
  vi.stubEnv('OPENAI_API_KEY', 'must-not-inherit')
  vi.stubEnv('BGS_HOME', '/must-not-inherit')
  const data = path.join(root, 'user-data')
  const runtime = await startLocalRuntime(root, data, storage())
  const [executable, args, options] = spawn.mock.calls[0]
  expect(executable).toBe(path.join(root, 'runtime/bin', process.platform === 'win32' ? 'bun.exe' : 'bun'))
  expect(args).toEqual(['packages/agent-workflow-server/src/index.ts'])
  expect(options.cwd).toBe(path.join(root, 'runtime'))
  expect(options.env).toMatchObject({ BEEGAME_WORKFLOW_V3_STORE: 'local-single-process',
    NODE_ENV: 'production', AGENT_WORKFLOW_WORKSPACE_PATH: path.join(data, 'Projects'),
    AGENT_WORKFLOW_DATA_DIR: path.join(data, 'configuration'),
    BEEGAME_BUILTIN_SKILLS_DIR: path.join(root, 'runtime/.beegame/plugins/bgs-game-development') })
  for (const key of ['BEEGAME_SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY', 'BGS_HOME']) expect(options.env[key]).toBeUndefined()
  await Promise.all([runtime.stop(), runtime.stop()])
  expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')
  expect((await runtime.closed).signal).toBe('SIGTERM')
})

it('does not adopt an existing port owner when its own backend exits before readiness', async () => {
  const child = childProcess()
  spawn.mockImplementation(() => {
    setImmediate(() => {
      child.stderr.write('EADDRINUSE\n'); child.exitCode = 1
      child.stdout.end(); child.stderr.end(); child.emit('close', 1, null)
    })
    return child
  })
  await expect(startLocalRuntime(root, path.join(root, 'user'), storage())).rejects.toThrow('stopped before readiness')
  expect(child.kill).not.toHaveBeenCalled()
  expect(await readFile(path.join(root, 'user/runtime.log'), 'utf8')).toContain('EADDRINUSE')
})

it('reports executable start failures without retry or another service launch', async () => {
  const child = childProcess()
  spawn.mockImplementation(() => {
    setImmediate(() => { child.emit('error', new Error('spawn ENOENT')); child.emit('close', -2, null) })
    return child
  })
  await expect(startLocalRuntime(root, path.join(root, 'user'), storage())).rejects.toThrow('spawn ENOENT')
  expect(spawn).toHaveBeenCalledTimes(1)
})
