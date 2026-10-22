import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { BgsClient } from './client'
import { bgsProviderConfig } from './runner'
import { getSafeRuntimeProcessEnvironment } from '../beegame/runtime-process-environment'

const nativeTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip
nativeTest('BGS disables native goals on new and resumed threads without deleting retained goals', async () => {
  const root = await mkdtemp('/private/tmp/bgs-goals-native-')
  const env = { ...getSafeRuntimeProcessEnvironment(), BGS_HOME: root,
    OPENAI_API_KEY: 'synthetic-offline-only', OPENAI_BASE_URL: 'http://127.0.0.1:9/v1' }
  const config = { ...bgsProviderConfig(env), cli_auth_credentials_store: 'file' }
  let client: BgsClient | undefined
  try {
    client = await BgsClient.connect({ cwd: root, env, config })
    const { thread } = await client.request('thread/start', { cwd: root })
    // No turn/start: these requests cannot trigger model generation.
    const goal = { threadId: thread.id, objective: 'Retained offline fixture', status: 'paused' }
    await expect(client.request('thread/goal/set', goal)).rejects.toThrow('thread/goal/set rejected')
    await client.request('thread/inject_items', { threadId: thread.id,
      items: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Synthetic offline history' }] }] })
    await client.close()

    // Seed a legacy goal through the native API; paused prevents continuation.
    client = await BgsClient.connect({ cwd: root, env, config: { ...config, 'features.goals': true } })
    expect((await client.request('thread/goal/set', goal)).goal.status).toBe('paused')
    await client.close()

    const notifications: string[] = []
    client = await BgsClient.connect({ cwd: root, env, config,
      onNotification: method => { notifications.push(method) } })
    expect((await client.request('thread/resume', { threadId: thread.id })).thread.id).toBe(thread.id)
    await expect(client.request('thread/goal/get', { threadId: thread.id })).rejects.toThrow('thread/goal/get rejected')
    await expect(client.request('thread/goal/set', goal)).rejects.toThrow('thread/goal/set rejected')
    await client.close()
    expect(notifications).not.toContain('thread/goal/updated')
    expect(notifications).not.toContain('turn/started')

    client = await BgsClient.connect({ cwd: root, env, config: { ...config, 'features.goals': true } })
    expect((await client.request('thread/goal/get', { threadId: thread.id })).goal)
      .toMatchObject({ objective: goal.objective, status: 'paused' })
  } finally { await client?.close(); await rm(root, { recursive: true, force: true }) }
}, 20_000)
