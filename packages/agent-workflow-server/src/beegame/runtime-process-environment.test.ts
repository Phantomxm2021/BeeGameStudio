import { afterEach, describe, expect, test } from 'bun:test'
import { getSafeRuntimeProcessEnvironment } from './runtime-process-environment'
import { nativeRuntimeEnvironment } from './native-cli-process-runner'

const originalFineGrainedStreaming =
  process.env.CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING
const originalNodeEnv = process.env.NODE_ENV

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
  if (originalFineGrainedStreaming === undefined) {
    delete process.env.CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING
  } else {
    process.env.CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING =
      originalFineGrainedStreaming
  }
})

describe('native runtime process environment', () => {
  test('host V3 database credentials do not enter native tasks or their subprocesses', () => {
    const keys = ['BEEGAME_SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const
    const prior = keys.map(key => process.env[key])
    try {
      for (const key of keys) process.env[key] = 'host-database-secret'
      for (const env of [getSafeRuntimeProcessEnvironment(), nativeRuntimeEnvironment({
        BEEGAME_SUPABASE_SERVICE_ROLE_KEY: 'explicit-secret', SUPABASE_SERVICE_ROLE_KEY: 'explicit-secret',
      })]) {
        for (const key of keys) expect(env).not.toHaveProperty(key)
        const child = Bun.spawnSync([process.execPath, '-e',
          'console.log(Boolean(process.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY))'], { env })
        expect(child.exitCode).toBe(0)
        expect(child.stdout.toString().trim()).toBe('false')
      }
    } finally {
      keys.forEach((key, i) => { if (prior[i] === undefined) delete process.env[key]; else process.env[key] = prior[i] })
    }
  })
  test('does not leak the server build mode into native tasks and their shell children', () => {
    process.env.NODE_ENV = 'development'
    expect(getSafeRuntimeProcessEnvironment()).not.toHaveProperty('NODE_ENV')
    const env = nativeRuntimeEnvironment({})
    expect(env).not.toHaveProperty('NODE_ENV')
    const child = Bun.spawnSync([process.execPath, '-e', 'console.log(process.env.NODE_ENV ?? "unset")'], { env })
    expect(child.exitCode).toBe(0)
    expect(child.stdout.toString().trim()).toBe('unset')
    const explicit = Bun.spawnSync([process.execPath, '-e', 'console.log(process.env.NODE_ENV)'], {
      env: { ...env, NODE_ENV: 'production' },
    })
    expect(explicit.stdout.toString().trim()).toBe('production')
  })
  test('host tool read grants do not leak through selected model env into native children',()=>{
    const key='BEEGAME_PROJECT_TOOL_READ_PATHS',prior=process.env[key]
    try {
      process.env[key]='host-project-map'
      expect(getSafeRuntimeProcessEnvironment()).not.toHaveProperty(key)
      expect(nativeRuntimeEnvironment({[key]:'untrusted-model-map'})).not.toHaveProperty(key)
    }finally{if(prior===undefined)delete process.env[key];else process.env[key]=prior}
  })
  test('forwards an explicitly configured native fine-grained streaming capability', () => {
    process.env.CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING = '1'

    expect(getSafeRuntimeProcessEnvironment()).toMatchObject({
      CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING: '1',
    })
  })
})
