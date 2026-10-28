import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getBuiltinSkillsDirectory } from '@bee-game-studio/beegame-skills-core/store'
import { BgsClient } from './client'
import { configureBgsSkills } from './skills'
import { bgsProviderConfig, createBgsRunner } from './runner'
import { productionAssignmentPrompt } from '../beegame/workflow-v3/production-workflow'
import { createRun } from '../beegame/workflow-v3/state'
import { skillEvidence } from '../beegame/workflow-v3/context'

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

for (const stage of ['design', 'implementation'] as const) {
nativeTest(`${stage} task loads assigned Skill bodies natively and reads applicable references`, async () => {
  const root = await mkdtemp('/private/tmp/bgs-skill-sections-'), game = join(root, 'game'), catalog = join(root, 'skills')
  const creative = join(catalog, 'game-creative-director-expert', 'SKILL.md')
  const selected = join(catalog, 'game-systems-designer-expert', 'SKILL.md')
  const unselected = join(catalog, 'game-level-designer-expert', 'SKILL.md')
  const reference = join(catalog, 'game-systems-designer-expert', 'references', 'detail.md')
  const executionBody = await readFile(join(getBuiltinSkillsDirectory(), 'game-plan-execution', 'SKILL.md'), 'utf8')
  await mkdir(join(catalog, 'game-plan-execution'), { recursive: true })
  await writeFile(join(catalog, 'game-plan-execution', 'SKILL.md'), executionBody)
  await mkdir(game, { recursive: true })
  await mkdir(join(catalog, 'game-creative-director-expert'), { recursive: true })
  await writeFile(creative, '---\nname: game-creative-director-expert\ndescription: Synthetic creative fixture.\n---\nASSIGNED_CREATIVE_BODY\n')
  await mkdir(join(catalog, 'game-systems-designer-expert'), { recursive: true })
  await mkdir(join(catalog, 'game-level-designer-expert'), { recursive: true })
  await writeFile(selected, [
    '---', 'name: game-systems-designer-expert', 'description: Synthetic rule design fixture.', '---', '',
    '# Systems fixture', '', '## Shared constraints', 'SHARED_CONSTRAINT_BODY', '',
    '## Rules', 'RULES_SECTION_BODY', '', '## Balance', 'BALANCE_SECTION_BODY', '',
    '## Unrelated', 'UNRELATED_SECTION_BODY', '',
  ].join('\n'))
  await writeFile(unselected, '---\nname: game-level-designer-expert\ndescription: Synthetic spatial fixture.\n---\nUNSELECTED_SKILL_BODY\n')

  await mkdir(join(catalog, 'game-systems-designer-expert', 'references'))
  await writeFile(reference, 'REFERENCE_SECTION_BODY\nLATER_REFERENCE_SECTION\n')
  const inputs: any[] = [], events: any[] = []
  // Scripted local responses test native read/request boundaries, not a model's
  // judgment of reference applicability or design quality. No real provider is reachable.
  const commands = stage === 'design' ? [`cat '${selected}'`, `sed -n '1p' '${reference}'`] : []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname !== '/v1/responses') return new Response('Unexpected fixture route', { status: 404 })
    const body = await request.json() as any
    inputs.push(body)
    const index = inputs.length - 1, command = commands[index]
    const output = command ? [{
      id: 'read-item-' + index, call_id: 'read-call-' + index, type: 'function_call', name: 'exec_command', status: 'completed',
      arguments: JSON.stringify({ cmd: command }),
    }] : [{ id: 'msg_' + index, type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'Fixture answer', annotations: [] }] }]
    const response = { id: 'resp_' + index, object: 'response', created_at: 1, model: body.model, status: 'completed',
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
      sessionId: 'skill-sections-fixture', cwd: game,
      systemContext: 'Current BGS fixture context.', confirmedBriefContext: 'Fixture confirmed brief.',
      env: { BEEGAME_CONFIG_DIR: join(root, 'private'), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: catalog,
        OPENAI_API_KEY: 'fixture-only', OPENAI_BASE_URL: server.url.origin + '/v1', BEEGAME_MODEL: 'fixture-unknown-model' },
      requestPermission: async () => ({ behavior: 'deny' }),
    })
    const run = createRun({projectId:'synthetic',ownerId:'owner',workspacePath:game,chatSessionId:'chat',requestKey:'start',
      text:'Synthetic chapter design scope',constraints:{},ids:['goal']})
    const prompt = productionAssignmentPrompt(run, stage === 'design'
      ? {stage,discipline:'gameplay',completedDesigns:[],originRequestKey:run.requestKey}
      : {stage,originRequestKey:run.requestKey})
    // Native mention selection loads assigned bodies; scripted reads exercise reference evidence.
    await runtime.submit({ prompt, confirmedBriefContext: 'Fixture confirmed brief.',
      signal: AbortSignal.timeout(20_000), onMessage(message) {events.push(message)}, requestPermission: async () => ({ behavior: 'deny' }) })

    if (stage === 'implementation') {
      expect(inputs).toHaveLength(1)
      const sent = JSON.stringify(inputs[0].input)
      expect(sent).toContain(JSON.stringify(executionBody.slice(executionBody.indexOf('# Game Plan Execution')).trim()).slice(1, -1))
      for (const body of ['ASSIGNED_CREATIVE_BODY', 'SHARED_CONSTRAINT_BODY', 'UNSELECTED_SKILL_BODY'])
        expect(sent).not.toContain(body)
      expect(events.some(event => event.eventType === 'tool.completed')).toBe(false)
      return
    }
    const evidence=skillEvidence(events.map((payload,id)=>({id,type:payload.eventType,payload}))).filter(link=>link.source==='shell')
    expect(evidence).toHaveLength(2)
    expect(evidence[0]).toMatchObject({name:'game-systems-designer-expert',path:selected,source:'shell'})
    expect(evidence.every(link=>!Object.hasOwn(link,'status'))).toBe(true)
    for(const link of evidence) {
      expect(events[link.eventId]).toMatchObject({eventType:'tool.completed',toolUseID:link.toolUseID,exitCode:0})
    }
    expect(evidence[1]).toMatchObject({name:'game-systems-designer-expert',path:reference,source:'shell'})
    expect(inputs).toHaveLength(3)
    expect(inputs.every(input => input.model === 'fixture-unknown-model')).toBe(true)
    const sent = inputs.map(input => JSON.stringify(input.input))
    expect(sent[1]).not.toContain('REFERENCE_SECTION_BODY')
    expect(sent[2]).toContain('REFERENCE_SECTION_BODY')
    expect(sent[2]).not.toContain('LATER_REFERENCE_SECTION')
    expect(sent[0]).toContain('ASSIGNED_CREATIVE_BODY')
    expect(sent[0]).toContain('### How to use skills')
    expect(sent[0]).toContain('progressive disclosure')
    expect(sent[0]).toContain('game-systems-designer-expert/SKILL.md')
    expect(sent[0]).toContain('game-level-designer-expert/SKILL.md')
    expect(sent.every(request => !request.includes('UNSELECTED_SKILL_BODY'))).toBe(true)
    for (const body of ['SHARED_CONSTRAINT_BODY','RULES_SECTION_BODY','BALANCE_SECTION_BODY','UNRELATED_SECTION_BODY']) {
      expect(sent[0]).toContain(body)
      expect(sent[1]).toContain(body)
    }
    // Results are produced by actual native exec_command file reads above.
    for (let index=0;index<commands.length;index++)
      expect(inputs[index+1].input.some((item:any) => item.type==='function_call_output' && item.call_id==='read-call-'+index)).toBe(true)
  } finally { await runtime?.dispose?.(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 60_000)
}
