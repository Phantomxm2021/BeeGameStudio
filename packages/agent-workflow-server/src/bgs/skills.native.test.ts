import { writeFixturePlugin } from './fixtures/plugin'
import { openAgentTools } from '../beegame/workflow-v3/agent-tools'
import { projectWorkRoot } from '../beegame/project-storage-paths'
import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import sharp from 'sharp'
import { mkdtemp, mkdir, readFile, readdir, rm, rename, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { getBuiltinSkillsDirectory, importUserSkill, materializeUserSkills } from '@bee-game-studio/beegame-skills-core/store'
import { BgsClient } from './client'
import { configureBgsSkills } from './skills'
import { bgsProviderConfig, createBgsRunner } from './runner'
import { productionAssignmentPrompt, implementationVerificationOutputSchema, parseImplementationVerification } from '../beegame/workflow-v3/production-workflow'
import { createRun } from '../beegame/workflow-v3/state'
import { skillEvidence } from '../beegame/workflow-v3/context'

const nativeTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip
nativeTest('two accounts discover one shared catalog and only their own imported skills without projection links', async () => {
  const root = await mkdtemp('/private/tmp/bgs-shared-native-'), catalog = getBuiltinSkillsDirectory()
  const names = (await readdir(catalog, { withFileTypes: true }))
    .filter(e => e.isDirectory() && existsSync(join(catalog, e.name, 'SKILL.md'))).map(e => e.name).sort()
  try {
    for (const owner of ['owner-a', 'owner-b']) {
      const account = join(root, owner), home = join(account, '.runtime', 'app', 'bgs'), user = join(home, 'skills')
      await mkdir(join(home, 'skills'), { recursive: true })
      const upload=importUserSkill(owner,{files:[{path:'SKILL.md',content:`---\nname: ${owner}\ndescription: Private fixture skill.\n---\nPrivate fixture\n`}]},{dataDir:account})
      const legacy=join(account,'.runtime','app','skills','user-'+owner)
      await mkdir(legacy,{recursive:true});await writeFile(join(legacy,'SKILL.md'),'Former upload')
      materializeUserSkills([upload],{dataDir:account})
      await writeFile(join(home,'config.toml'),'[[skills.config]]\npath = '+JSON.stringify(join(legacy,'SKILL.md'))+'\nenabled = false\n')
      await symlink(join(catalog, names[0]!), join(home, 'skills', 'bgs-builtin-legacy'))
      const client = await BgsClient.connect({ cwd: account, env: { PATH: process.env.PATH!, HOME: account, BGS_HOME: home }, config: { cli_auth_credentials_store: 'file' } })
      try {
        await configureBgsSkills(client, home, catalog)
        const result = await client.request('skills/list', { cwds: [account], forceReload: true })
        expect(result.data.flatMap((entry: any) => entry.errors)).toEqual([])
        const skills = result.data.flatMap((entry: any) => entry.skills)
        const shared=skills.filter((s:any)=>s.name.startsWith('bgs-game-development:'))
        expect(shared.map((s:any)=>s.name).sort()).toEqual(names.map(name=>'bgs-game-development:'+name))
        expect(shared.every((s:any)=>s.path.startsWith(home+'/plugins/cache/'))).toBe(true)
        for (const skill of shared) {
          const name=skill.name.slice('bgs-game-development:'.length)
          const source=await readFile(join(catalog,name,'SKILL.md'),'utf8')
          const boundary=source.indexOf('\n---',4)
          expect(boundary).toBeGreaterThan(4)
          expect(Bun.YAML.parse(source.slice(4,boundary)))
            .toMatchObject({name,description:skill.description})
        }
        for (const [name, references] of Object.entries({
          'game-technical-artist':['spritesheet-production.md','ai-sprite-animation.md','vfx-craft.md'],
          'game-content-pipeline-engineer':['artwork-production.md','saved-content-checks.md'],
          'game-level-designer-expert':['encounter-design-patterns.md'],
          'game-feel-designer':['comparative-feel-studies.md'],
          'game-art-director-expert':['ui-visual-hierarchy.md','color-language-system.md','shape-language-framework.md','lighting-mood-framework.md'],
        })) {
          const installed=shared.find((s:any)=>s.name==='bgs-game-development:'+name)
          expect(installed).toBeDefined()
          for (const reference of references)
            expect(await readFile(join(dirname(installed.path),'references',reference),'utf8'))
              .toBe(await readFile(join(catalog,name,'references',reference),'utf8'))
        }
        const study = await readFile(join(catalog,'references/relay-crossing.html'),'utf8')
        for (const name of ['game-ui-ux-designer','game-feel-designer','game-audio-designer']) {
          const installed = shared.find((s:any)=>s.name==='bgs-game-development:'+name)
          const body = await readFile(installed.path,'utf8')
          expect(body).toContain('(../references/relay-crossing.html)')
          expect(await readFile(join(dirname(installed.path),'../references/relay-crossing.html'),'utf8')).toBe(study)
        }
        const pipeline=shared.find((s:any)=>s.name==='bgs-game-development:game-content-pipeline-engineer')
        expect(pipeline).toBeDefined()
        await expect(readFile(join(dirname(dirname(pipeline.path)),'game-design-check/references/saved-content-checks.md'),'utf8'))
          .rejects.toMatchObject({code:'ENOENT'})
        expect(skills.some((s:any)=>s.path.startsWith(catalog+'/'))).toBe(false)
        expect(shared.some((s:any)=>['bgs-imagegen','game-implementation-planning','root-cause-debugging','gameplay-programmer'].includes(s.name))).toBe(false)
        expect(skills.some((s: any) => s.name === owner && s.path === join(user, 'user-'+owner, 'SKILL.md') && !s.enabled)).toBe(true)
        expect(skills.some((s: any) => s.name === (owner === 'owner-a' ? 'owner-b' : 'owner-a'))).toBe(false)
        expect((await readdir(join(home, 'skills'))).some(name => name.startsWith('bgs-builtin-') || name.startsWith('bgs-user-'))).toBe(false)
      } finally { await client.close() }
    }
  } finally { await rm(root, { recursive: true, force: true }) }
}, 15_000)

nativeTest('both auth modes retain original system skills and explicit account settings', async () => {
  const account = await mkdtemp('/private/tmp/bgs-provider-skills-'), home = join(account, 'bgs'), user = join(home, 'skills')
  const catalog = getBuiltinSkillsDirectory()
  const systemImagegen = join(home, 'skills', '.system', 'imagegen', 'SKILL.md')
  const userDisabled = join(user, 'disabled-fixture', 'SKILL.md')
  const configText = `[[skills.config]]\npath = ${JSON.stringify(userDisabled)}\nenabled = false\n\n[[skills.config]]\npath = ${JSON.stringify(join(catalog,'game-art-director-expert/SKILL.md'))}\nenabled = false\n`
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
        await configureBgsSkills(client, home, catalog)
        // Catalog requests exercise native discovery/configuration without a model turn.
        const result = await client.request('skills/list', { cwds: [account], forceReload: true })
        expect(result.data.flatMap((entry: any) => entry.errors)).toEqual([])
        const skills = result.data.flatMap((entry: any) => entry.skills)
        for(const name of ['imagegen','openai-docs','review-agent','skill-creator','skill-installer'])
          expect(skills.find((s: any) => s.path === join(home, 'skills', '.system', name, 'SKILL.md')))
            .toMatchObject({name,enabled:true})
        expect(skills.some((s: any) => s.name === 'bgs-imagegen')).toBe(false)
        const features = await client.request('experimentalFeature/list', { limit: 200 })
        expect(features.data.find((feature: any) => feature.name === 'image_generation')?.enabled).toBe(true)
        expect(skills.find((s: any) => s.path === join(user, 'imagegen', 'SKILL.md'))?.enabled).toBe(true)
        expect(skills.find((s: any) => s.path === userDisabled)?.enabled).toBe(false)
        const builtinSkills = skills.filter((s: any) => s.name.startsWith('bgs-game-development:'))
        expect(builtinSkills.length).toBeGreaterThan(0)
        expect(builtinSkills.find((s:any)=>s.name==='bgs-game-development:game-art-director-expert')?.enabled).toBe(false)
        expect(builtinSkills.filter((s:any)=>s.name!=='bgs-game-development:game-art-director-expert').every((s:any)=>s.enabled)).toBe(true)
        const current = await readFile(systemImagegen, 'utf8')
        systemText ??= current
        expect(current).toBe(systemText)
        expect(await readFile(join(home, 'config.toml'), 'utf8')).toContain(configText.trim())
      } finally { await client.close() }
      const installedConfig=await readFile(join(home,'config.toml'),'utf8')
      const explicitConfig=installedConfig+`\n[[skills.config]]\npath = ${JSON.stringify(systemImagegen)}\nenabled = false\n`
      await writeFile(join(home,'config.toml'),explicitConfig)
      const explicit=await BgsClient.connect({cwd:account,env,
        config:{...bgsProviderConfig(env),cli_auth_credentials_store:'file'}})
      try {
        await configureBgsSkills(explicit,home,catalog)
        const result=await explicit.request('skills/list',{cwds:[account],forceReload:true})
        const skills=result.data.flatMap((entry:any)=>entry.skills)
        expect(skills.find((s:any)=>s.path===systemImagegen)?.enabled).toBe(false)
        expect(skills.find((s:any)=>s.path===join(user,'imagegen','SKILL.md'))?.enabled).toBe(true)
        expect(await readFile(join(home,'config.toml'),'utf8')).toBe(explicitConfig)
        expect(await readFile(systemImagegen,'utf8')).toBe(systemText)
      } finally { await explicit.close() }
      await writeFile(join(home,'config.toml'),installedConfig)
    }
  } finally { await rm(account, { recursive: true, force: true }) }
}, 15_000)

for (const stage of ['design', 'implementation', 'verification'] as const) {
nativeTest(`${stage} task loads only selected Skill bodies and references`, async () => {
  const root = await mkdtemp('/private/tmp/bgs-skill-sections-'), game = join(root, 'game'), catalog = join(root, 'plugin-source', 'bgs-game-skills')
  await mkdir(catalog,{recursive:true})
  const creative = join(catalog, 'game-creative-director-expert', 'SKILL.md')
  let selected = join(catalog, 'game-systems-designer-expert', 'SKILL.md')
  const unselected = join(catalog, 'game-level-designer-expert', 'SKILL.md')
  let reference = join(catalog, 'game-systems-designer-expert', 'references', 'detail.md')
  const namespaced = join(catalog, 'namespaced-fixture', 'SKILL.md')
  let verificationSkill=join(catalog,'game-playtest-performance','SKILL.md')
  const home=join(root,'native-home')
  await mkdir(home)
  if(stage==='verification') {
    await mkdir(join(catalog,'game-playtest-performance'),{recursive:true})
    await writeFile(verificationSkill,await readFile(join(getBuiltinSkillsDirectory(),'game-playtest-performance','SKILL.md'),'utf8')+'\nVERIFICATION_METHOD_BODY\n')
  }
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
  if(stage==='implementation') {
    await mkdir(join(catalog,'namespaced-fixture'))
    await writeFile(namespaced,'---\nname: fixture:method\ndescription: Synthetic namespaced method.\n---\nNAMESPACED_METHOD_BODY\n')
  }

  await mkdir(join(catalog, 'game-systems-designer-expert', 'references'))
  await writeFile(reference, 'REFERENCE_SECTION_BODY\nLATER_REFERENCE_SECTION\n')
  const inputs: any[] = [], events: any[] = []
  // Scripted local responses test native read/request boundaries, not a model's
  // judgment of reference applicability or design quality. No real provider is reachable.
  const commands = stage === 'design' ? [`cat '${selected}'`, `sed -n '1p' '${reference}'`] : stage === 'verification' ? [`cat '${verificationSkill}'`] : []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname !== '/v1/responses') return new Response('Unexpected fixture route', { status: 404 })
    const body = await request.json() as any
    inputs.push(body)
    const index = inputs.length - 1, command = commands[index]
    const output = command ? [{
      id: 'read-item-' + index, call_id: 'read-call-' + index, type: 'function_call', name: 'exec_command', status: 'completed',
      arguments: JSON.stringify({ cmd: command }),
    }] : [{ id: 'msg_' + index, type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: stage==='verification'?JSON.stringify({summary:'Observed synthetic player outcome',observations:[{outcome:'Required synthetic player outcome',status:'passed',evidence:'Synthetic delivered input produced its expected result'}]}):'Fixture answer', annotations: [] }] }]
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
  let nativeSessionId:string|undefined
  let nativeContext: import('../beegame/session-manager').BeeGameNativeContext | undefined
  let accepted=0
  const finalOutput=stage==='verification'?{readOnly:true,schema:implementationVerificationOutputSchema(),accept:async(value:unknown)=>{
    const result=parseImplementationVerification(value);accepted++;return result.summary
  }}:undefined
  const env={ BEEGAME_CONFIG_DIR: join(root, 'private'), BGS_HOME:home, BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: await writeFixturePlugin(catalog),
    OPENAI_API_KEY: 'fixture-only', OPENAI_BASE_URL: server.url.origin + '/v1', BEEGAME_MODEL: 'fixture-unknown-model' }
  try {
    runtime = await runner.start({
      sessionId: 'skill-sections-fixture', cwd: game,onNativeSessionId:id=>{nativeSessionId=id},
      onNativeContext:context=>{nativeContext=context},finalOutput,
      systemContext: 'Current BGS fixture context.', confirmedBriefContext: 'Fixture confirmed brief.',
      env,
      requestPermission: async () => ({ behavior: 'deny' }),
    })
    // Use the paths actually advertised by native Plugin discovery, not the
    // source tree. This exercises the new cache read permission and evidence.
    const discovered=(runtime as unknown as {skills:Array<{name:string;path:string}>}).skills
    const actual=(name:string)=>{
      const skill=discovered.find(item=>item.name==='bgs-game-development:'+name)
      if(!skill)throw Error('Native fixture Skill missing: '+name)
      return skill.path
    }
    selected=actual('game-systems-designer-expert')
    reference=join(dirname(selected),'references/detail.md')
    if(stage==='verification')verificationSkill=actual('game-playtest-performance')
    if(stage==='design')commands.splice(0,commands.length,`cat '${selected}'`,`sed -n '1p' '${reference}'`)
    if(stage==='verification')commands.splice(0,commands.length,`cat '${verificationSkill}'`)
    const run = createRun({projectId:'synthetic',ownerId:'owner',workspacePath:game,chatSessionId:'chat',requestKey:'start',
      text:'Synthetic chapter design scope',constraints:{},ids:['goal']})
    const prompt = productionAssignmentPrompt(run, stage === 'design'
      ? {stage,discipline:'gameplay',completedDesigns:[],originRequestKey:run.requestKey}
      : {stage,originRequestKey:run.requestKey})
    // Design has no forced mentions; native Shell reads load the selected method and reference.
    await runtime.submit({ prompt, confirmedBriefContext: 'Fixture confirmed brief.',
      ...(stage==='verification'?{finalOutput}:{}),
      signal: AbortSignal.timeout(20_000), onMessage(message) {events.push(message)}, requestPermission: async () => ({ behavior: 'deny' }) })

    const hasSkillUsageSupplement=(body:any)=>{
      const developer=body.input.filter((item:any)=>item.role==='developer').flatMap((item:any)=>item.content)
        .map((part:any)=>part.text??'').join('\n')
      // Inspect the complete existing context frame, including split parts.
      const runtime=[...developer.matchAll(/<bgsRuntime_part_\d+>([\s\S]*?)<\/bgsRuntime_part_\d+>/g)]
        .map(match=>match[1]).join('')
      return runtime.includes('# Using skills')
    }
    expect(hasSkillUsageSupplement(inputs[0])).toBe(false)
    if(stage==='verification') {
      expect(inputs).toHaveLength(2)
      expect(JSON.stringify(inputs[0].input)).not.toContain('VERIFICATION_METHOD_BODY')
      const first=JSON.stringify(inputs[1].input)
      expect(first.match(/VERIFICATION_METHOD_BODY/g)).toHaveLength(1)
      expect(first).toContain('## Runtime verification')
      expect(first).toContain('Project files are read-only for this task.')
      expect(accepted).toBe(1)
      for(const body of ['ASSIGNED_CREATIVE_BODY','SHARED_CONSTRAINT_BODY','UNSELECTED_SKILL_BODY'])expect(first).not.toContain(body)
      await runtime.dispose?.();runtime=undefined
      runtime=await runner.start({sessionId:'skill-sections-fixture',cwd:game,env,
        resumeSessionId:nativeSessionId,nativeRecovery:true,nativeContext,finalOutput,
        systemContext:'Current BGS fixture context.',confirmedBriefContext:'Fixture confirmed brief.',requestPermission:async()=>({behavior:'deny'})})
      await runtime.submit({prompt:[],nativeRecovery:true,finalOutput,confirmedBriefContext:'Fixture confirmed brief.',
        signal:AbortSignal.timeout(20000),onMessage:message=>{events.push(message)},requestPermission:async()=>({behavior:'deny'})})
      expect(inputs).toHaveLength(3)
      expect(hasSkillUsageSupplement(inputs[2])).toBe(false)
      expect(JSON.stringify(inputs[2].input).match(/VERIFICATION_METHOD_BODY/g)).toHaveLength(1)
      expect(accepted).toBe(2)
      await runtime.dispose?.();runtime=undefined
      await writeFile(join(home,'config.toml'),'[[skills.config]]\npath = '+JSON.stringify(verificationSkill)+'\nenabled = false\n')
      runtime=await runner.start({sessionId:'disabled-method-fixture',cwd:game,env,finalOutput,requestPermission:async()=>({behavior:'deny'})})
      await runtime.submit({prompt,finalOutput,signal:AbortSignal.timeout(20000),
        onMessage:message=>{events.push(message)},requestPermission:async()=>({behavior:'deny'})})
      expect(inputs).toHaveLength(4)
      expect(accepted).toBe(3)
      expect(JSON.stringify(inputs[3].input)).not.toContain('VERIFICATION_METHOD_BODY')
      expect(JSON.stringify(inputs[3].input)).not.toContain('UNSELECTED_SKILL_BODY')
      await runtime.dispose?.();runtime=undefined
      await writeFile(join(home,'config.toml'),'[skills]\ninclude_instructions = false\n')
      runtime=await runner.start({sessionId:'disabled-catalog-fixture',cwd:game,env,finalOutput,requestPermission:async()=>({behavior:'deny'})})
      await runtime.submit({prompt,finalOutput,signal:AbortSignal.timeout(20000),onMessage(){},requestPermission:async()=>({behavior:'deny'})})
      expect(inputs).toHaveLength(5)
      expect(hasSkillUsageSupplement(inputs[4])).toBe(false)
      expect(JSON.stringify(inputs[4].input)).not.toContain('### Available skills')
      return
    }
    if (stage === 'implementation') {
      expect(inputs).toHaveLength(1)
      expect(inputs[0].tools.some((tool:any)=>tool.type==='namespace'&&tool.name==='image_gen')).toBe(false)
      const sent = JSON.stringify(inputs[0].input)
      expect(sent).toContain('imagegen/SKILL.md')
      expect(sent).not.toContain('# Game Plan Execution')
      for (const body of ['ASSIGNED_CREATIVE_BODY', 'SHARED_CONSTRAINT_BODY', 'RULES_SECTION_BODY', 'BALANCE_SECTION_BODY', 'UNRELATED_SECTION_BODY', 'UNSELECTED_SKILL_BODY'])
        expect(sent).not.toContain(body)
      expect(events.some(event => event.eventType === 'tool.completed')).toBe(false)
      // Native mention resolution loads bodies from user text, without BGS
      // attaching a Skill item or scripting a model file-read response.
      for(const check of [
        {text:'$bgs-game-development:game-systems-designer-expert Apply the synthetic method.',body:'SHARED_CONSTRAINT_BODY'},
        {text:'Apply $bgs-game-development:fixture:method to this synthetic task.',body:'NAMESPACED_METHOD_BODY'},
        {text:'$bgs-game-development:fixture:method Apply the synthetic method.',body:'NAMESPACED_METHOD_BODY'},
        {text:'$not-installed-fixture Explain the missing method.',body:undefined},
      ]) {
        await runtime.dispose?.();runtime=undefined
        runtime=await runner.start({sessionId:'skill-mentions-fixture',cwd:game,env,onNativeSessionId:id=>{nativeSessionId=id}})
        const before=inputs.length
        await runtime.submit({prompt:check.text,signal:AbortSignal.timeout(20000),onMessage(){},requestPermission:async()=>({behavior:'deny'})})
        expect(inputs).toHaveLength(before+1)
        const input=JSON.stringify(inputs[before].input)
        expect(input).toContain(check.text)
        if(check.body) expect(input.split(check.body)).toHaveLength(2)
        else for(const body of ['SHARED_CONSTRAINT_BODY','NAMESPACED_METHOD_BODY'])expect(input).not.toContain(body)
        expect(input).not.toContain('UNSELECTED_SKILL_BODY')
        if(check.text.startsWith('$bgs-game-development:fixture:method')) {
          await runtime.dispose?.();runtime=undefined
          runtime=await runner.start({sessionId:'skill-mentions-fixture',cwd:game,env,resumeSessionId:nativeSessionId,nativeRecovery:true})
          await runtime.submit({prompt:[],nativeRecovery:true,signal:AbortSignal.timeout(20000),onMessage(){},requestPermission:async()=>({behavior:'deny'})})
          expect(inputs).toHaveLength(before+2)
          expect(JSON.stringify(inputs[before+1].input).split('NAMESPACED_METHOD_BODY')).toHaveLength(2)
        }
      }
      await runtime.dispose?.();runtime=undefined
      await writeFile(join(home,'config.toml'),'[[skills.config]]\npath = '+JSON.stringify(selected)+'\nenabled = false\n')
      runtime=await runner.start({sessionId:'disabled-mention-fixture',cwd:game,env})
      const before=inputs.length
      await runtime.submit({prompt:'$bgs-game-development:game-systems-designer-expert Apply the method if available.',signal:AbortSignal.timeout(20000),onMessage(){},requestPermission:async()=>({behavior:'deny'})})
      expect(inputs).toHaveLength(before+1)
      expect(JSON.stringify(inputs[before].input)).not.toContain('SHARED_CONSTRAINT_BODY')
      return
    }
    const evidence=skillEvidence(events.map((payload,id)=>({id,type:payload.eventType,payload}))).filter(link=>link.source==='shell')
    expect(evidence).toHaveLength(2)
    expect(evidence[0]).toMatchObject({name:'bgs-game-development:game-systems-designer-expert',path:selected,source:'shell'})
    expect(evidence.every(link=>!Object.hasOwn(link,'status'))).toBe(true)
    for(const link of evidence) {
      expect(events[link.eventId]).toMatchObject({eventType:'tool.completed',toolUseID:link.toolUseID,exitCode:0})
    }
    expect(evidence[1]).toMatchObject({name:'bgs-game-development:game-systems-designer-expert',path:reference,source:'shell'})
    expect(inputs).toHaveLength(3)
    expect(inputs.every(input => input.model === 'fixture-unknown-model')).toBe(true)
    const sent = inputs.map(input => JSON.stringify(input.input))
    expect(sent[1]).not.toContain('REFERENCE_SECTION_BODY')
    expect(sent[2]).toContain('REFERENCE_SECTION_BODY')
    expect(sent[2]).not.toContain('LATER_REFERENCE_SECTION')
    expect(sent.every(request => !request.includes('ASSIGNED_CREATIVE_BODY'))).toBe(true)
    // Skill bodies load on demand without borrowing another model's instructions.
    expect(hasSkillUsageSupplement(inputs[0])).toBe(false)
    // Native Plugin metadata may shorten files using the Skill roots table.
    expect(sent[0]).toContain(dirname(selected))
    expect(sent[0]).toContain('bgs-game-development:game-systems-designer-expert')
    expect(sent[0]).toContain('bgs-game-development:game-level-designer-expert')
    expect(sent[0]).toMatch(/file: r\d+\/SKILL\.md/)
    expect(sent.every(request => !request.includes('UNSELECTED_SKILL_BODY'))).toBe(true)
    for (const body of ['SHARED_CONSTRAINT_BODY','RULES_SECTION_BODY','BALANCE_SECTION_BODY','UNRELATED_SECTION_BODY']) {
      expect(sent[0]).not.toContain(body)
      expect(sent[1]).toContain(body)
    }
    // Results are produced by actual native exec_command file reads above.
    for (let index=0;index<commands.length;index++)
      expect(inputs[index+1].input.some((item:any) => item.type==='function_call_output' && item.call_id==='read-call-'+index)).toBe(true)
    // Save an actual source-path read, move the one source package, then cold
    // resume the same native history and installed cache without reinstalling.
    const historicalSource=join(catalog,'game-systems-designer-expert/SKILL.md')
    await runtime.dispose?.();runtime=undefined
    runtime=await runner.start({sessionId:'skill-sections-fixture',cwd:game,env,resumeSessionId:nativeSessionId,nativeRecovery:true,nativeContext,onNativeContext:context=>{nativeContext=context},requestPermission:async()=>({behavior:'deny'})})
    commands[inputs.length]=`cat '${historicalSource}'`
    await runtime.submit({prompt:'Read the original source method for this fixture.',signal:AbortSignal.timeout(20000),onMessage(){},requestPermission:async()=>({behavior:'deny'})})
    expect(inputs).toHaveLength(5)
    expect(JSON.stringify(inputs[4].input)).toContain(historicalSource)
    const inode=(await stat(selected)).ino
    const nativeConfig=await readFile(join(home,'config.toml'),'utf8')
    expect(nativeConfig).toContain(catalog)
    await runtime.dispose?.();runtime=undefined
    const relocated=join(root,'plugins/bgs-game-development')
    await mkdir(dirname(relocated),{recursive:true})
    await rename(catalog,relocated)
    await symlink(relative(dirname(catalog),relocated),catalog)
    env.BEEGAME_NATIVE_BUILTIN_SKILLS_DIR=relocated
    let restoredThreadId:string|undefined
    runtime=await runner.start({sessionId:'skill-sections-fixture',cwd:game,env,resumeSessionId:nativeSessionId,nativeRecovery:true,nativeContext,onNativeSessionId:id=>{restoredThreadId=id},requestPermission:async()=>({behavior:'deny'})})
    expect(restoredThreadId).toBe(nativeSessionId)
    const restored=(runtime as unknown as {skills:Array<{name:string;path:string}>}).skills
      .find(skill=>skill.name==='bgs-game-development:game-systems-designer-expert')
    if(!restored)throw Error('Native Plugin Skill missing after source relocation')
    expect(restored.path).toBe(selected)
    commands[inputs.length]=`cat '${restored.path}'`
    expect(await readFile(join(home,'config.toml'),'utf8')).toBe(nativeConfig)
    expect((await stat(selected)).ino).toBe(inode)
    await runtime.submit({prompt:[],nativeRecovery:true,signal:AbortSignal.timeout(20000),onMessage(){},requestPermission:async()=>({behavior:'deny'})})
    expect(inputs).toHaveLength(7)
    expect(JSON.stringify(inputs[6].input)).toContain(historicalSource)
    const resumedRead=inputs[6].input.find((item:any)=>item.type==='function_call_output'&&item.call_id==='read-call-5')
    expect(resumedRead?.output).toContain('SHARED_CONSTRAINT_BODY')
    expect(resumedRead?.output).not.toContain('Operation not permitted')
  } finally { await runtime?.dispose?.(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 60_000)
}


for (const opaqueReference of [false,true]) nativeTest('custom chat connection calls the configured image MCP before and after cold resume, opaqueReference='+opaqueReference,async()=>{
  const root=await mkdtemp('/private/tmp/bgs-configured-image-native-'), game=join(root,'game'), privateRoot=join(root,'private')
  await mkdir(game)
  const png=await sharp({create:{width:40,height:40,channels:opaqueReference?3:4,background:{r:20,g:30,b:40,alpha:opaqueReference?1:1/255}}}).png().toBuffer()
  const images:any[]=[],parents:any[]=[],reviews:any[]=[]
  let round=0,step=0
  const imageServer=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    if(request.method==='GET')return Response.json({available:true,billingSource:'external'})
    images.push(await request.json());return new Response(new Uint8Array(png),{headers:{'content-type':'image/png'}})
  }})
  const models=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    if(new URL(request.url).pathname!=='/v1/responses')return new Response('No fixture route',{status:404})
    const body=await request.json() as any
    if(parents.length+reviews.length>12)return new Response('Fixture request limit',{status:429})
    let output:any[]
    if(body.text?.format?.schema?.properties?.outcome){
      reviews.push(body)
      output=[{id:'approval-'+reviews.length,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',
        text:JSON.stringify({outcome:'allow',risk_level:'low',user_authorization:'high',rationale:'Authorized localhost fixture image.'}),annotations:[]}]}]
    }else{
      parents.push(body)
      const match=(t:any)=>t.name==='generate_image'||t.name?.endsWith('__generate_image')
      const namespace=body.tools?.find((t:any)=>t.type==='namespace'&&t.tools?.some(match))
      const tool=namespace?.tools.find(match)??body.tools?.find(match)
      if(!tool)return new Response('Configured image tool was not discovered',{status:400})
      expect(body.tools.some((t:any)=>t.type==='namespace'&&t.name==='image_gen')).toBe(false)
      output=step++===0 ? [{id:'image-call-'+round,type:'function_call',call_id:'image-call-'+round,status:'completed',
        name:tool.name,...(namespace?{namespace:namespace.name}:{}),arguments:JSON.stringify({
          request:{purpose:opaqueReference?'reference':'experiment',prompt:'Local fixture image'},outputPath:'assets/image-'+round+'.png'})}]
        : [{id:'image-done-'+round,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'Fixture complete.',annotations:[]}]}]
    }
    const response={id:'fixture-'+(parents.length+reviews.length),object:'response',created_at:1,model:body.model,status:'completed',
      output,usage:{input_tokens:10,output_tokens:2,total_tokens:12}}
    return new Response([{type:'response.created',response:{...response,status:'in_progress',output:[]}},
      ...output.flatMap((item,output_index)=>[{type:'response.output_item.added',output_index,item:{...item,status:'in_progress'}},
        {type:'response.output_item.done',output_index,item}]),{type:'response.completed',response}]
      .map((event,sequence_number)=>'data: '+JSON.stringify({...event,sequence_number})+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}})
  }})
  const runner=createBgsRunner({resolveOutboundTarget:async value=>{
    const url=new URL(value);if(url.origin!==models.url.origin)throw Error('Non-local model request forbidden')
    return {url,addresses:['127.0.0.1'],lookup:(_host,_options,callback)=>callback(null,'127.0.0.1',4)}
  }})
  let tools:Awaited<ReturnType<typeof openAgentTools>>|undefined,runtime:Awaited<ReturnType<typeof runner.start>>|undefined,threadId:string|undefined
  try {
    for(round=0;round<2;round++){
      step=0
      tools=await openAgentTools({sessionId:'fixture',workspacePath:game,getAuthToken:()=>undefined,
        openImage:()=>({fetch: (request:Request) => fetch(new Request(imageServer.url.origin+'/generate', request)),instruction:'Local fixture',close:async()=>{}})})
      runtime=await runner.start({sessionId:'fixture',cwd:game,imageGenerationEntry:tools.imageGenerationEntry,
        ...(threadId?{resumeSessionId:threadId}:{}),onNativeSessionId:id=>{threadId=id},
        env:{BEEGAME_CONFIG_DIR:privateRoot,OPENAI_API_KEY:'fixture-only',OPENAI_BASE_URL:models.url.origin+'/v1',BEEGAME_MODEL:'fixture-image-model'},
        requestPermission:async()=>({behavior:'allow'})})
      const events:any[]=[]
      await runtime.submit({prompt:'$imagegen Generate the one authorized localhost fixture image.',signal:AbortSignal.timeout(20_000),
        onMessage:event=>{events.push(event)},requestPermission:async()=>({behavior:'allow'})})
      expect((await readFile(join(game,'assets/image-'+round+'.png'))).equals(png)).toBe(true)
      expect(events.some(e=>e.eventType==='tool.completed'&&String(e.toolName).includes('generate_image'))).toBe(true)
      const receipt=events.find(e=>e.eventType==='tool.completed'&&String(e.toolName).includes('generate_image'))
      expect(JSON.stringify(receipt.output)).not.toContain('base64')
      expect(JSON.stringify(receipt.output)).not.toContain('\"data\":')
      expect(images).toHaveLength(round+1)
      const input=JSON.stringify(parents.at(-1).input)
      expect(input).toContain('<name>imagegen</name>')
      expect(input).toContain(opaqueReference?'Reference viewing thumbnail':'Transparency viewing thumbnail on a checkerboard')
      expect(input).toContain('Use the attached viewing preview')
      const view=parents.at(-1).input.filter((item:any)=>item.type==='function_call_output'&&item.call_id==='image-call-'+round).flatMap((item:any)=>Array.isArray(item.output)?item.output:[]).find((part:any)=>part.type==='input_image')
      expect(view.image_url).toMatch(/^data:image\/(png|webp);base64,/)
      const decoded=await sharp(Buffer.from(view.image_url.split(',')[1],'base64')).metadata()
      expect(decoded).toMatchObject({width:40,height:40,hasAlpha:false})
      expect(input).not.toContain('viewing preview unavailable')
      expect(parents.at(-1).input.some((item:any)=>item.type==='function_call'&&item.name==='view_image')).toBe(false)
      await runtime.dispose?.();runtime=undefined;await tools.close();tools=undefined
    }
    expect(parents).toHaveLength(4)
    expect(new Set(images.map(x=>x.requestId)).size).toBe(2)
  }finally{
    await runtime?.dispose?.();await tools?.close();models.stop(true);imageServer.stop(true)
    await rm(projectWorkRoot(game),{recursive:true,force:true});await rm(root,{recursive:true,force:true})
  }
},60000)
