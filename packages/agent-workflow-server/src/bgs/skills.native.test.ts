import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getBuiltinSkillsDirectory } from '@bee-game-studio/beegame-skills-core/store'
import { BgsClient } from './client'
import { configureBgsSkills } from './skills'
import { bgsProviderConfig, createBgsRunner } from './runner'

const nativeTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip
nativeTest('two accounts discover one shared catalog and only their own imported skills without projection links', async () => {
  const root = await mkdtemp('/private/tmp/bgs-shared-native-'), catalog = getBuiltinSkillsDirectory()
  const names = (await readdir(catalog, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort()
  try {
    for (const owner of ['owner-a', 'owner-b']) {
      const account = join(root, owner), home = join(account, 'bgs'), user = join(account, 'skills')
      await mkdir(join(home, 'skills'), { recursive: true })
      await mkdir(join(user, owner), { recursive: true })
      await writeFile(join(user, owner, 'SKILL.md'), `---\nname: ${owner}\ndescription: Private fixture skill.\n---\nPrivate fixture\n`)
      await symlink(join(catalog, names[0]!), join(home, 'skills', 'bgs-builtin-legacy'))
      const client = await BgsClient.connect({ cwd: account, env: { PATH: process.env.PATH!, HOME: account, BGS_HOME: home }, config: { cli_auth_credentials_store: 'file' } })
      try {
        await configureBgsSkills(client, home, catalog, user)
        const result = await client.request('skills/list', { cwds: [account], forceReload: true })
        expect(result.data.flatMap((entry: any) => entry.errors)).toEqual([])
        const skills = result.data.flatMap((entry: any) => entry.skills)
        expect(skills.filter((s: any) => s.path.startsWith(catalog + '/')).map((s: any) => s.name).sort()).toEqual(names)
        expect(skills.some((s: any) => s.name === owner && s.path === join(user, owner, 'SKILL.md'))).toBe(true)
        expect(skills.some((s: any) => s.name === (owner === 'owner-a' ? 'owner-b' : 'owner-a'))).toBe(false)
        expect((await readdir(join(home, 'skills'))).some(name => name.startsWith('bgs-builtin-') || name.startsWith('bgs-user-'))).toBe(false)
      } finally { await client.close() }
    }
  } finally { await rm(root, { recursive: true, force: true }) }
}, 15_000)

nativeTest('both auth modes use BGS image guidance while preserving imported skills and account settings', async () => {
  const account = await mkdtemp('/private/tmp/bgs-provider-skills-'), home = join(account, 'bgs'), user = join(account, 'skills')
  const catalog = getBuiltinSkillsDirectory()
  const systemImagegen = join(home, 'skills', '.system', 'imagegen', 'SKILL.md')
  const userDisabled = join(user, 'disabled-fixture', 'SKILL.md')
  const configText = `[[skills.config]]\npath = ${JSON.stringify(userDisabled)}\nenabled = false\n`
  try {
    await mkdir(home)
    for (const name of ['imagegen', 'disabled-fixture']) {
      await mkdir(join(user, name), { recursive: true })
      await writeFile(join(user, name, 'SKILL.md'), `---\nname: ${name}\ndescription: Private fixture skill.\n---\nPrivate fixture\n`)
    }
    await writeFile(join(home, 'config.toml'), configText)
    let systemText: string | undefined
    for (const mode of ['api_key', 'chatgpt']) {
      const env = { PATH: process.env.PATH!, HOME: account, BGS_HOME: home, OPENAI_AUTH_MODE: mode }
      const client = await BgsClient.connect({ cwd: account, env,
        config: { ...bgsProviderConfig(env), cli_auth_credentials_store: 'file' } })
      try {
        await configureBgsSkills(client, home, catalog, user)
        // Catalog requests exercise native discovery/configuration without a model turn.
        const result = await client.request('skills/list', { cwds: [account], forceReload: true })
        expect(result.data.flatMap((entry: any) => entry.errors)).toEqual([])
        const skills = result.data.flatMap((entry: any) => entry.skills)
        expect(skills.find((s: any) => s.path === systemImagegen)?.enabled).toBe(false)
        expect(skills.find((s: any) => s.path === join(catalog, 'bgs-imagegen', 'SKILL.md')))
          .toMatchObject({ name: 'bgs-imagegen', enabled: true })
        const features = await client.request('experimentalFeature/list', { limit: 200 })
        expect(features.data.find((feature: any) => feature.name === 'image_generation')?.enabled).toBe(true)
        expect(skills.find((s: any) => s.path === join(user, 'imagegen', 'SKILL.md'))?.enabled).toBe(true)
        expect(skills.find((s: any) => s.path === userDisabled)?.enabled).toBe(false)
        const builtinSkills = skills.filter((s: any) => s.path.startsWith(catalog + '/'))
        expect(builtinSkills.length).toBeGreaterThan(0)
        expect(builtinSkills.every((s: any) => s.enabled)).toBe(true)
        const current = await readFile(systemImagegen, 'utf8')
        systemText ??= current
        expect(current).toBe(systemText)
        expect(await readFile(join(home, 'config.toml'), 'utf8')).toBe(configText)
      } finally { await client.close() }
    }
  } finally { await rm(account, { recursive: true, force: true }) }
}, 15_000)

nativeTest('unknown model receives skill usage guidance while skill bodies remain on demand', async () => {
  const root = await mkdtemp('/private/tmp/bgs-skill-usage-'), game = join(root, 'game'), catalog = join(root, 'skills')
  const selected = join(catalog, 'selected-fixture', 'SKILL.md')
  const unselected = join(catalog, 'unselected-fixture', 'SKILL.md')
  await mkdir(game, { recursive: true })
  await mkdir(join(catalog, 'selected-fixture'), { recursive: true })
  await mkdir(join(catalog, 'unselected-fixture'), { recursive: true })
  await writeFile(selected, '---\nname: selected-fixture\ndescription: Selected fixture skill.\n---\nSELECTED_BODY_SECRET\n')
  await writeFile(unselected, '---\nname: unselected-fixture\ndescription: Unselected fixture skill.\n---\nUNSELECTED_BODY_SECRET\n')

  const inputs: any[] = []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname !== '/v1/responses') return new Response('Unexpected fixture route', { status: 404 })
    const body = await request.json() as any
    inputs.push(body)
    const output = inputs.length === 1 ? [{
      id: 'read-item', call_id: 'read-call', type: 'function_call', name: 'exec_command', status: 'completed',
      arguments: JSON.stringify({ cmd: 'cat ' + selected }),
    }] : [{ id: 'msg_' + inputs.length, type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'Fixture answer', annotations: [] }] }]
    const response = { id: 'resp_' + inputs.length, object: 'response', created_at: 1, model: body.model, status: 'completed',
      output, usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } }
    return new Response([
      { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
      ...output.flatMap((item, output_index) => [
        { type: 'response.output_item.added', output_index, item: { ...item, status: 'in_progress' } },
        { type: 'response.output_item.done', output_index, item },
      ]),
      { type: 'response.completed', response },
    ].map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join(''),
    { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  const runner = createBgsRunner({ resolveOutboundTarget: async value => {
    const url = new URL(value)
    if (url.origin !== server.url.origin) throw Error('Non-local fixture request forbidden')
    return { url, addresses: ['127.0.0.1'], lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }
  } })
  let runtime: Awaited<ReturnType<typeof runner.start>> | undefined
  try {
    runtime = await runner.start({
      sessionId: 'skill-usage-fixture', cwd: game,
      systemContext: 'Current BGS fixture context.', confirmedBriefContext: 'Fixture confirmed brief.',
      env: { BEEGAME_CONFIG_DIR: join(root, 'private'), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: catalog,
        OPENAI_API_KEY: 'fixture-only', OPENAI_BASE_URL: server.url.origin + '/v1', BEEGAME_MODEL: 'fixture-unknown-model' },
      requestPermission: async () => ({ behavior: 'deny' }),
    })
    await runtime.submit({ prompt: 'Use the selected fixture skill only when needed.', confirmedBriefContext: 'Fixture confirmed brief.',
      signal: AbortSignal.timeout(15_000), onMessage() {}, requestPermission: async () => ({ behavior: 'deny' }) })

    expect(inputs).toHaveLength(2)
    expect(inputs[0]!.model).toBe('fixture-unknown-model')
    expect(inputs[1]!.model).toBe('fixture-unknown-model')
    const sent = JSON.stringify(inputs[0]!.input)
    expect(sent).toContain('### How to use skills')
    expect(sent).toContain('progressive disclosure')
    expect(sent).toContain('selected-fixture/SKILL.md')
    expect(sent).toContain('unselected-fixture/SKILL.md')
    expect(sent).not.toContain('SELECTED_BODY_SECRET')
    expect(sent).not.toContain('UNSELECTED_BODY_SECRET')
    const readResult = inputs[1]!.input.find((item: any) => item.type === 'function_call_output' && item.call_id === 'read-call')
    expect(readResult).toBeDefined()
    // This output comes from the real native exec_command call above, rather
    // than from the fixture server, so only the selected Skill body is read.
    expect(String(readResult.output)).toContain('SELECTED_BODY_SECRET')
    expect(JSON.stringify(inputs[1]!.input)).not.toContain('UNSELECTED_BODY_SECRET')
  } finally { await runtime?.dispose?.(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 60_000)
