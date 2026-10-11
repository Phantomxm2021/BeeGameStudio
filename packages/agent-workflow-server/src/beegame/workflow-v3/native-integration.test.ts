import { test, expect } from 'bun:test'
import { mkdtemp, realpath, readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BeeGameSessionManager } from '../session-manager'
import { createNativeCliProcessRunner } from '../native-cli-process-runner'
import { createLocalWorkflowStore } from './store'
import { createV3Executor } from './execution'
import { createRun, publishPlan, V3_PROTOCOL, digest } from './state'
import { staleTaskIds } from './checks'
import { uiLayoutFixture } from '../fixtures/layout-fixture'
import { assetManifestAuthoringExamples } from '../asset-manifest-authoring-contract'
import { writeBeeGameAssetManifest } from '../asset-contracts'
import { exportMeasuredBuild, selectMeasuredBuild } from './measured-build'
import { changeRequirements } from './changes'

// Real native transport and filesystem, local deterministic provider only. No paid model.
test.each(['plain', 'skill', 'binding', 'binding-skill', 'runtime', 'editable', 'editable-change', 'question', 'question-stop', 'revision'])('V3 real CLI exercises %s without legacy assignments', async mode => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-v3-real-cli-')))
  const requiredSkill = mode === 'skill' || mode === 'binding-skill', binding = mode.startsWith('binding')
  const editable = mode.startsWith('editable'), runtime = mode === 'runtime' || editable, savedPath = editable ? 'src/index.html' : runtime ? 'dist/index.html' : 'rules.json'
  const hostPath=join(root,editable?'.beegame/host':'host'), configPath=join(root,editable?'.beegame/config':'config')
  if(editable) {
    await mkdir(join(root,'src'),{recursive:true})
    await writeFile(join(root,'package.json'),JSON.stringify({scripts:{build:'bun run build.mjs'}}))
    await writeFile(join(root,'build.mjs'),"import {mkdir,cp} from 'node:fs/promises';await mkdir('dist',{recursive:true});await cp('src/index.html','dist/index.html');")
  }
  const question = mode === 'question' || mode === 'question-stop', questionStop = mode === 'question-stop'
  let cancellation: Promise<unknown> | undefined, cancelledPermission: { sessionId: string; toolUseID: string } | undefined
  const revision = mode === 'revision'
  let answeredQuestion = 0
  const uiPath = 'content/ui/menu.json', bindingPlan = 'binding-map.json', uiBody = JSON.stringify(uiLayoutFixture())
  let mappingBody = ''
  if (revision) await writeFile(join(root, 'rules.json'), '{"loop":"original"}')
  if (binding) {
    await mkdir(join(root, 'content/ui'), { recursive: true }); await writeFile(join(root, uiPath), uiBody)
    await mkdir(join(root, 'assets/runtime/example'), { recursive: true }); await writeFile(join(root, 'assets/runtime/example/resource.json'), '{}')
    const manifest = assetManifestAuthoringExamples().canonical; await writeBeeGameAssetManifest(root, manifest)
    mappingBody = JSON.stringify([{ file: uiPath, sha256: digest(uiBody), nodes: [{ id: 'play', set: {
      actions: { click: 'game.start' }, data: { image: { assetRef: manifest.resources[0]!.id } },
    } }] }])
  }
  const requests: any[] = []
  const frame = (event: any) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname
    if (path.endsWith('/count_tokens')) return Response.json({ input_tokens: 10 })
    if (!path.endsWith('/messages')) return new Response('', { status: 404 })
    const body: any = await request.json(); requests.push(body)
    const call = requiredSkill && requests.length === 1 ? { name: 'Skill', input: { skill: 'bgs-builtins:gameplay-programmer' } }
      : revision && requests.length === 1 ? { name: 'Read', input: { file_path: join(root, savedPath) } }
      : question && requests.length === 1 ? { name: 'AskUserQuestion', input: { questions: [{ question: 'Choose the synthetic fixture color?', header: 'Fixture', multiSelect: false,
        options: [{ label: 'Blue', description: 'Use the blue fixture' }, { label: 'Orange', description: 'Use the orange fixture' }] }] } }
      : mode==='editable-change' && requests.length===3 ? { name:'Read',input:{file_path:join(root,savedPath)} }
      : requests.length === (requiredSkill || question || revision ? 2 : 1) || mode==='editable-change' && requests.length===4 ? { name: 'Write', input: { file_path: join(root, binding ? bindingPlan : savedPath), content: binding ? mappingBody : runtime ? '<!doctype html><body>synthetic runtime'+(mode==='editable-change' && requests.length===4?' changed confirmed goal':'')+'</body>' : '{"loop":"synthetic"}' } } : undefined
    return new Response(frame({ type: 'message_start', message: { id: 'fixture-'+requests.length, type: 'message', role: 'assistant', model: body.model,
      content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } })+
      frame({ type: 'content_block_start', index: 0, content_block: call ? { type: 'tool_use', id: 'tool-fixture-'+requests.length, name: call.name, input: {} } : { type: 'text', text: '' } })+
      frame({ type: 'content_block_delta', index: 0, delta: call ? { type: 'input_json_delta', partial_json: JSON.stringify(call.input) } : { type: 'text_delta', text: 'Saved synthetic output.' } })+
      frame({ type: 'content_block_stop', index: 0 })+
      frame({ type: 'message_delta', delta: { stop_reason: call ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } })+
      frame({ type: 'message_stop' }), { headers: { 'content-type': 'text/event-stream' } })
  } })
  const store = createLocalWorkflowStore(hostPath)
  const sessions = new BeeGameSessionManager(createNativeCliProcessRunner(), hostPath, async () => ({
    BEEGAME_CONFIG_DIR: configPath, BEEGAME_MODEL_TYPE: 'anthropic', ANTHROPIC_AUTH_TOKEN: 'offline',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.port}`, BGS_DEFAULT_BALANCED_MODEL: 'claude-sonnet-4-6',
    BGS_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
  }), {}, true)
  const executor = createV3Executor({ store, sessions })
  const unsubscribe = sessions.subscribeProjectEvents({ userId: 'alice', projectId: 'native-fixture', workspacePath: root }, event => {
    if (event.type !== 'permission.requested') return
    const permission = sessions.pendingPermissionsForProject('alice', 'native-fixture', root).at(-1)
    if (question && permission?.toolName === 'AskUserQuestion') {
      if (questionStop) {
        cancelledPermission = { sessionId: permission.sessionId, toolUseID: permission.toolUseID }
        cancellation = store.read('native-fixture', 'alice').then(run => executor.stop(run!))
        return
      }
      expect(permission.sessionId).not.toBe('fixture-chat')
      expect(() => sessions.resolvePermission(permission.sessionId, permission.toolUseID, { behavior: 'allow', answers: {} })).toThrow()
      expect(sessions.pendingPermissionsForProject('alice', 'native-fixture', root)).toHaveLength(1)
      sessions.resolvePermission(permission.sessionId, permission.toolUseID, { behavior: 'allow', scope: 'once', answers: { 'Choose the synthetic fixture color?': 'Blue' } })
      answeredQuestion++
    } else if (permission) sessions.resolvePermission(permission.sessionId, permission.toolUseID, { behavior: ['Write', 'Skill', 'Read'].includes(permission.toolName) ? 'allow' : 'deny' })
  })
  const timer = setTimeout(() => void executor.dispose(), 25000)
  try {
    const original = createRun({ projectId: 'native-fixture', ownerId: 'alice', workspacePath: root, chatSessionId: 'fixture-chat', requestKey: 'create',
      text: 'Save the synthetic JSON fixture, not a production game.', constraints: {}, ids: ['req.fixture'] })
    const planned = publishPlan(original, { protocol: V3_PROTOCOL, baseRevision: 0, requirementsRevision: original.requirements.revision,
      tasks: [{ id: 'fixture', kind: 'game.develop', goal: 'Exercise native transport', dependsOn: [], requirementIds: ['req.fixture'], inputs: [],
        writablePaths: editable ? [savedPath,'dist/**'] : binding ? [bindingPlan, uiPath] : [savedPath], expectedOutputs: editable ? [savedPath,'dist/index.html'] : binding ? [bindingPlan, uiPath] : [savedPath],
        checks: editable ? ['build','runtime-smoke'] : binding ? ['artifact-json', 'content-schema', 'content-structure', 'content-layout', 'content-resources'] : runtime ? ['runtime-smoke'] : ['artifact-json'],
        ...(editable ? {editableProject:true} : {}),
        ...(runtime ? { runtimeArtifact: 'dist' } : {}),
        ...(revision ? { inputs: [savedPath] } : {}),
        ...(binding ? { bindingPlan, inputs: [uiPath] } : {}), ...(requiredSkill ? { skills: ['bgs-builtins:gameplay-programmer'] } : {}) }] })
    await store.commit('native-fixture', 'alice', 0, original, 'created'); await store.commit('native-fixture', 'alice', 1, planned, 'planned')
    const attempt = await executor.start(planned, 'fixture', 'execute', {})
    for (let n = 0; n < 2500; n++) {
      if (!(await store.read('native-fixture', 'alice'))?.writer) break
      await Bun.sleep(10)
    }
    const settled = (await store.read('native-fixture', 'alice'))!
    if (questionStop) {
      await cancellation
      expect(cancelledPermission).toBeDefined()
      expect(settled.paused).toBeDefined(); expect(settled.writer).toBeUndefined()
      expect(settled.status).toBe('blocked'); expect(settled.tasks.fixture!.status).toBe('failed')
      expect(settled.attempts[0]!.error).toContain('cancelled')
      expect(settled.attempts[0]!.usage).toBeDefined(); expect(answeredQuestion).toBe(0)
      expect(sessions.pendingPermissionsForProject('alice', 'native-fixture', root)).toHaveLength(0)
      expect(() => sessions.resolvePermission(cancelledPermission!.sessionId, cancelledPermission!.toolUseID,
        { behavior: 'allow', answers: { 'Choose the synthetic fixture color?': 'Blue' } })).toThrow()
      const count = requests.length
      await expect(executor.start(settled, 'fixture', 'no-new-charge', {})).rejects.toThrow('user-paused')
      expect(requests).toHaveLength(count)
      expect(settled.deliveryEligible).toBe(false)
      return
    }
    expect({ status: settled.tasks.fixture!.status, error: settled.attempts[0]!.error }).toMatchObject({ status: 'succeeded' })
    expect(settled.attempts[0]!.nativeSessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(settled.attempts[0]!.usage).toBeDefined()
    expect(settled.deliveryEligible).toBe(false); expect(settled.status).toBe('blocked')
    expect(await staleTaskIds(settled)).not.toContain('fixture')
    if (binding) {
      expect(JSON.parse(await readFile(join(root, uiPath), 'utf8')).data.nodes[1].actions.click).toBe('game.start')
      expect(settled.attempts[0]!.binding?.valid).toBe(true)
      expect(settled.attempts[0]!.checks?.find(check => check.id === 'content-binding')?.status).toBe('passed')
    } else expect(await readFile(join(root, savedPath), 'utf8')).toContain('synthetic')
    if (runtime) {
      const check = settled.attempts[0]!.checks?.find(check => check.id === 'runtime-smoke')!
      expect(check.status).toBe('passed'); expect(check.artifacts?.[0]?.path).toBe('dist')
      expect(check.observation).toContain('host-owned Chromium')
    }
    if(editable) {
      const proof=settled.attempts[0]!.checks!.find(c=>c.id==='build')!.projectBuild!
      expect(proof.files.map(f=>f.path)).toEqual(['build.mjs','package.json','src/index.html'])
      const packed=await exportMeasuredBuild(settled,'fixture',settled.attempts[0]!.attemptId,{read:()=>store.read('native-fixture','alice'),busy:()=>false},'project')
      expect(packed.artifact).toEqual(proof.artifact);expect(packed.data.length).toBeGreaterThan(0)
      expect(JSON.stringify(requests[0].messages)).toContain('editableProject builds')
      if(mode==='editable-change') {
        const changed=changeRequirements(settled,{expectedVersion:settled.version,requirementsRevision:settled.requirements.revision,requestKey:'user-change',
          requirements:{text:'Changed confirmed goal: display changed confirmed goal',constraints:{},ids:settled.requirements.ids},tasks:Object.values(settled.tasks).map(t=>t.spec)})
        await store.commit(settled.projectId,settled.ownerId,settled.version,changed,'requirements.changed')
        await expect(selectMeasuredBuild(changed,attempt.taskId,attempt.attemptId)).rejects.toThrow('current successful attempt')
        const second=await executor.start(changed,attempt.taskId,'explicit-change-execution',{})
        let current=await store.read(changed.projectId,changed.ownerId)
        for(let poll=0;current?.writer&&poll<200;poll++){await Bun.sleep(50);current=await store.read(changed.projectId,changed.ownerId)}
        const measured=await selectMeasuredBuild(current!,second.taskId,second.attemptId)
        expect(measured.attempt.attemptId).not.toBe(attempt.attemptId);expect(measured.artifact.sha256).not.toBe(packed.artifact.sha256)
        expect(measured.smoke.inputs).toContainEqual({path:'requirement:'+changed.requirements.revision,sha256:changed.requirements.sha256})
        expect(await Bun.file(join(root,'dist/index.html')).text()).toContain('changed confirmed goal')
        expect((await exportMeasuredBuild(current!,second.taskId,second.attemptId,{read:()=>store.read(changed.projectId,changed.ownerId),busy:()=>false},'project')).kind).toBe('project')
        expect(JSON.stringify(requests[2].messages)).toContain('Changed confirmed goal')
        expect(requests).toHaveLength(5)
      }
    }
    expect(requests).toHaveLength(mode==='editable-change' ? 5 : requiredSkill || question || revision ? 3 : 2)
    if (revision) {
      expect(settled.attempts[0]!.inputVersions.find(v => v.path === savedPath)?.sha256).toBe(digest('{"loop":"original"}'))
      expect(settled.attempts[0]!.outputs?.find(v => v.path === savedPath)?.sha256).toBe(digest('{"loop":"synthetic"}'))
      expect(settled.attempts[0]!.checks?.[0]?.inputs.find(v => v.path === savedPath)?.sha256).toBe(digest('{"loop":"synthetic"}'))
    }
    if (question) {
      expect(answeredQuestion).toBe(1); expect(JSON.stringify(requests[1])).toContain('Blue')
      expect(sessions.pendingPermissionsForProject('alice', 'native-fixture', root)).toHaveLength(0)
    }
    if (requiredSkill) {
      expect(settled.attempts[0]!.skillUses).toContainEqual(expect.objectContaining({ name: 'bgs-builtins:gameplay-programmer', status: 'loaded' }))
      expect(settled.attempts[0]!.checks?.find(check => check.id === 'skill-use')?.status).toBe('passed')
      expect(JSON.stringify(requests[1])).toContain('Gameplay Programmer')
    }
    const text = JSON.stringify(requests)
    expect(text).not.toContain('Author batch'); expect(text).not.toContain('milestone: author.')
    expect(text).not.toContain('beegame_project_turn'); expect(text).not.toContain('beegame_direction_authors')
  } finally {
    clearTimeout(timer); unsubscribe(); await executor.dispose(); await sessions.dispose(); server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}, 30000)
