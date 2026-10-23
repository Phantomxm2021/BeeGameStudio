import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { BgsClient } from './client'
import { getSafeRuntimeProcessEnvironment } from '../beegame/runtime-process-environment'

const nativeTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip
nativeTest('pinned Bgs applies reasoning overrides in thread config without a model generation request', async () => {
  const root = await mkdtemp('/private/tmp/bgs-reasoning-native-')
  let client: BgsClient | undefined
  try {
    const options = { cwd: root,
      env: { ...getSafeRuntimeProcessEnvironment(), BGS_HOME: root, OPENAI_API_KEY: 'synthetic-offline-only' },
      config: { cli_auth_credentials_store: 'file', model_provider: 'offline',
        model_providers: { offline: { name: 'Offline fixture', base_url: 'http://127.0.0.1:9/v1', env_key: 'OPENAI_API_KEY', wire_api: 'responses', request_max_retries: 0, stream_max_retries: 0 } } } }
    client = await BgsClient.connect(options)
    const model = (await client.request('model/list', {})).data.find((entry: any) => entry.defaultReasoningEffort &&
      entry.supportedReasoningEfforts?.some((option: any) => option.reasoningEffort !== entry.defaultReasoningEffort))
    expect(typeof model?.defaultReasoningEffort).toBe('string')
    const effort = model.supportedReasoningEfforts.find((option: any) => option.reasoningEffort !== model.defaultReasoningEffort).reasoningEffort
    const thread = await client.request('thread/start', { cwd: root, model: model.model, config: { model_reasoning_effort: effort } })
    expect(thread.reasoningEffort).toBe(effort)
    expect(thread.model).toBe(model.model)
    await client.request('thread/inject_items', { threadId: thread.thread.id,
      items: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Synthetic offline history' }] }] })
    await client.close()
    client = await BgsClient.connect(options)
    const resumed = await client.request('thread/resume', { threadId: thread.thread.id, model: model.model,
      config: { model_reasoning_effort: model.defaultReasoningEffort } })
    expect(resumed.reasoningEffort).toBe(model.defaultReasoningEffort)
  } finally { await client?.close(); await rm(root, { recursive: true, force: true }) }
}, 15000)
