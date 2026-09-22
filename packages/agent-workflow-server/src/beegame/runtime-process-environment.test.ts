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
  test('forwards an explicitly configured native fine-grained streaming capability', () => {
    process.env.CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING = '1'

    expect(getSafeRuntimeProcessEnvironment()).toMatchObject({
      CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING: '1',
    })
  })
})
