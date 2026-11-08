import { expect, test } from 'bun:test'
import { mkdtemp, rm, mkdir, writeFile, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BgsClient } from './client'
import { getSafeRuntimeProcessEnvironment } from '../beegame/runtime-process-environment'

const nativeTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip
nativeTest.each(['legacy-only', 'bgs-only', 'both', 'explicit-config'] as const)(
  'BGS SQLite directory isolation: %s', async mode => {
    const root = await mkdtemp('/private/tmp/bgs-sqlite-isolation-')
    const home = join(root, 'home'), legacy = join(root, 'codex-sqlite'), bgs = join(root, 'bgs-sqlite'), explicit = join(root, 'explicit')
    let client: BgsClient | undefined
    try {
      for (const dir of [home, legacy, bgs, explicit]) await mkdir(dir)
      await writeFile(join(legacy, 'sentinel.txt'), 'Codex directory must remain untouched')
      client = await BgsClient.connect({ cwd: root,
        env: { ...getSafeRuntimeProcessEnvironment(), HOME: home, BGS_HOME: home, OPENAI_API_KEY: 'synthetic-offline-only',
          ...(mode !== 'bgs-only' ? { CODEX_SQLITE_HOME: legacy } : {}),
          ...(mode !== 'legacy-only' ? { BGS_SQLITE_HOME: bgs } : {}) },
        config: { cli_auth_credentials_store: 'file', model_provider: 'offline',
          ...(mode === 'explicit-config' ? { sqlite_home: explicit } : {}),
          model_providers: { offline: { name: 'Offline fixture', base_url: 'http://127.0.0.1:9/v1', env_key: 'OPENAI_API_KEY', wire_api: 'responses', request_max_retries: 0, stream_max_retries: 0 } } } })
      await client.requestNative('config/read', {})
      await client.close()
      const selected = mode === 'explicit-config' ? explicit : mode === 'legacy-only' ? home : bgs
      expect(await readdir(selected)).toContain('state_5.sqlite')
      expect(await readdir(legacy)).toEqual(['sentinel.txt'])
      expect(await readFile(join(legacy, 'sentinel.txt'), 'utf8')).toBe('Codex directory must remain untouched')
      for (const dir of [home, bgs, explicit].filter(dir => dir !== selected)) {
        expect(await readdir(dir)).not.toContain('state_5.sqlite')
      }
    } finally { await client?.close(); await rm(root, { recursive: true, force: true }) }
  }, 15_000)

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

nativeTest('BGS project configuration uses .bgs and leaves Codex configuration separate', async () => {
  const root = await mkdtemp('/private/tmp/bgs-config-isolation-')
  const home = join(root, 'home'), project = join(root, 'project')
  let client: BgsClient | undefined
  try {
    await mkdir(home)
    for (const name of ['.bgs', '.codex']) await mkdir(join(project, name), { recursive: true })
    await writeFile(join(home, 'config.toml'), '[projects.' + JSON.stringify(project) + ']\ntrust_level = "trusted"\n')
    await writeFile(join(project, '.bgs', 'config.toml'), 'model_reasoning_effort = "low"\n')
    const codexConfig = 'model_reasoning_effort = "high"\n'
    await writeFile(join(project, '.codex', 'config.toml'), codexConfig)
    client = await BgsClient.connect({ cwd: project,
      env: { ...getSafeRuntimeProcessEnvironment(), HOME: home, BGS_HOME: home },
      config: { cli_auth_credentials_store: 'file' } })
    const result = await client.requestNative('config/read', { cwd: project, includeLayers: true })
    expect(result.config.model_reasoning_effort).toBe('low')
    const layers = JSON.stringify(result.layers)
    expect(layers).toContain(join(project, '.bgs'))
    expect(layers).not.toContain(join(project, '.codex'))
    expect(await Bun.file(join(project, '.codex', 'config.toml')).text()).toBe(codexConfig)
  } finally { await client?.close(); await rm(root, { recursive: true, force: true }) }
}, 15_000)
