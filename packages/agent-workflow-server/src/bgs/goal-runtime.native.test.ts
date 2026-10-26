import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BeeGameSessionManager } from '../beegame/session-manager'
import { createAgentGoalExecutor, agentGoalPrompt } from '../beegame/workflow-v3/agent-goal'
import { createLocalWorkflowStore } from '../beegame/workflow-v3/store'
import { createRun } from '../beegame/workflow-v3/state'
import { BgsClient } from './client'
import { bgsProviderConfig, createBgsRunner } from './runner'
import { getSafeRuntimeProcessEnvironment } from '../beegame/runtime-process-environment'
import { initializeProjectGuide, PROJECT_GUIDE_TEMPLATE } from '../beegame/workflow-v3/project-guide'

// This exercises the shipped BGS binary against a loopback-only Responses
// endpoint. The native sandbox is intentionally opt-in; this test never calls
// a paid provider or a project outside its temporary workspace.
const nativeTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip

type Json = Record<string, any>

function responseStream(body: Json, output: Json[], responseNumber: number) {
  const response = {
    id: `native-goal-response-${responseNumber}`,
    object: 'response',
    created_at: responseNumber,
    model: body.model,
    status: 'completed',
    output,
    usage: {
      input_tokens: 40,
      output_tokens: 8,
      total_tokens: 48,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  }
  const events = [
    {
      type: 'response.created',
      response: { ...response, status: 'in_progress', output: [] },
    },
    ...output.flatMap((item, output_index) => [
      {
        type: 'response.output_item.added',
        output_index,
        item: { ...item, status: 'in_progress' },
      },
      { type: 'response.output_item.done', output_index, item },
    ]),
    { type: 'response.completed', response },
  ]
    .map(
      (event, sequence_number) =>
        `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`,
    )
    .join('')
  return new Response(events, {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

function messageOutput(text: string, responseNumber: number): Json {
  return {
    id: `native-goal-message-${responseNumber}`,
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }],
  }
}

function functionOutput(
  name: string,
  arguments_: Json,
  responseNumber: number,
): Json {
  return {
    id: `native-goal-item-${responseNumber}`,
    type: 'function_call',
    call_id: `native-goal-call-${responseNumber}`,
    name,
    arguments: JSON.stringify(arguments_),
    status: 'completed',
  }
}

nativeTest(
  'one native Goal submit auto-continues into a protected write and completes via update_goal',
  async () => {
    const root = await mkdtemp('/private/tmp/bgs-native-goal-runtime-')
    const workspace = join(root, 'game')
    const catalog = join(root, 'skills')
    const config = join(root, 'config')
    await mkdir(join(workspace, 'docs'), { recursive: true })
    await initializeProjectGuide(workspace)
    await mkdir(join(catalog, 'fixture'), { recursive: true })
    await writeFile(
      join(catalog, 'fixture', 'SKILL.md'),
      '---\nname: fixture\ndescription: Offline native Goal fixture.\n---\nFixture skill.\n',
    )

    const requests: Json[] = []
    let responseNumber = 0
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        if (new URL(request.url).pathname !== '/v1/responses')
          return new Response('not found', { status: 404 })
        const body = (await request.json()) as Json
        requests.push(body)
        responseNumber++
        const output =
          responseNumber === 1
            ? [
                messageOutput(
                  'The first native Goal turn is complete.',
                  responseNumber,
                ),
              ]
            : responseNumber === 2
              ? [
                  functionOutput(
                    'WriteProjectFile',
                    {
                      file_path: 'docs/GDD.md',
                      content: 'Written by the second native Goal turn.',
                    },
                    responseNumber,
                  ),
                ]
              : responseNumber === 3
                ? [
                    functionOutput(
                      'update_goal',
                      { status: 'complete' },
                      responseNumber,
                    ),
                  ]
                : responseNumber === 4
                  ? [
                      messageOutput(
                        'Final native Goal answer after completion.',
                        responseNumber,
                      ),
                    ]
                  : []
        if (!output.length)
          return Response.json(
            { error: { message: 'unexpected extra native Goal turn' } },
            { status: 500 },
          )
        return responseStream(body, output, responseNumber)
      },
    })

    const permissionRequests: Json[] = []
    const events: Json[] = []
    const usage: Json[] = []
    let runtime:
      | Awaited<ReturnType<ReturnType<typeof createBgsRunner>['start']>>
      | undefined
    const runner = createBgsRunner({
      resolveOutboundTarget: async value => {
        const url = new URL(value)
        if (url.origin !== server.url.origin)
          throw Error(
            'Native Goal fixture only permits its loopback Responses endpoint',
          )
        return {
          url,
          addresses: ['127.0.0.1'],
          lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4),
        }
      },
    })
    const allowWrite = async (request: any) => {
      permissionRequests.push(request)
      return { behavior: 'allow' as const, source: 'user' as const }
    }

    try {
      runtime = await runner.start({
        sessionId: 'native-goal-runtime-fixture',
        cwd: workspace,
        nativeGoal: {
          mode: 'start',
          objective: 'Finish the offline protected design record.',
          tokenBudget: 1_000,
        },
        env: {
          BEEGAME_CONFIG_DIR: config,
          BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: catalog,
          OPENAI_API_KEY: 'synthetic-local-only',
          OPENAI_BASE_URL: server.url.origin + '/v1',
          BEEGAME_MODEL: 'native-goal-fixture-model',
        },
        onNativeUsage: value => {
          usage.push(value)
        },
        requestPermission: allowWrite,
      })
      await runtime.submit({
        prompt:
          'Write the protected design record, then finish the assignment.',
        signal: AbortSignal.timeout(30_000),
        onMessage: message => {
          events.push(message)
        },
        requestPermission: allowWrite,
      })

      expect(requests).toHaveLength(4)
      for (const request of requests.slice(0, 2)) {
        const text = (request.input ?? []).flatMap((item: Json) =>
          (item.content ?? []).map((block: Json) => block.text ?? '')).join('\n')
        expect(text).toContain(PROJECT_GUIDE_TEMPLATE)
        expect(text).toContain('### How to use skills')
        expect(text).toContain('progressive disclosure')
      }
      const names = (body: Json) =>
        (body.tools ?? [])
          .flatMap((tool: Json) => [tool.name, tool.function?.name])
          .filter(Boolean)
      expect(names(requests[0]!)).toEqual(
        expect.arrayContaining(['get_goal', 'update_goal', 'WriteProjectFile']),
      )
      expect(names(requests[1]!)).toContain('WriteProjectFile')
      expect(names(requests[2]!)).toContain('update_goal')
      expect(requests[2]!.input).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'function_call_output',
            call_id: 'native-goal-call-2',
          }),
        ]),
      )
      expect(requests[3]!.input).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'function_call_output',
            call_id: 'native-goal-call-3',
          }),
        ]),
      )

      expect(
        permissionRequests.filter(request => request.toolName === 'Write'),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            input: {
              file_path: 'docs/GDD.md',
              content: 'Written by the second native Goal turn.',
            },
          }),
        ]),
      )
      expect(await readFile(join(workspace, 'docs/GDD.md'), 'utf8')).toBe(
        'Written by the second native Goal turn.',
      )

      const startedTurns = events.filter(
        event =>
          event.eventType === 'system.status' &&
          event.subtype === 'native_goal_turn_started',
      )
      expect(startedTurns.length).toBeGreaterThanOrEqual(2)
      expect(startedTurns[0]?.nativeTurnId).not.toBe(
        startedTurns[1]?.nativeTurnId,
      )
      const completedTurns = events.filter(
        event =>
          event.eventType === 'system.status' &&
          event.subtype === 'native_goal_turn_completed',
      )
      expect(completedTurns.length).toBeGreaterThanOrEqual(2)
      expect(completedTurns.at(-1)?.nativeTurnId).toBe(
        startedTurns[1]?.nativeTurnId,
      )
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventType: 'assistant.message',
            text: 'Final native Goal answer after completion.',
          }),
        ]),
      )
      expect(
        events
          .filter(
            event =>
              event.eventType === 'system.status' &&
              event.subtype === 'native_goal',
          )
          .map(event => event.nativeGoal?.status),
      ).toEqual(expect.arrayContaining(['active', 'complete']))
      expect(
        Math.max(...usage.map(value => value.total_tokens ?? 0)),
      ).toBeGreaterThanOrEqual(192)
    } finally {
      await runtime?.dispose?.()
      server.stop(true)
      await rm(root, { recursive: true, force: true })
    }
  },
  45_000,
)

nativeTest(
  'cold native Goal resume pauses persisted work, refreshes context, and preserves counters',
  async () => {
    const root = await mkdtemp('/private/tmp/bgs-native-goal-cold-resume-')
    const workspace = join(root, 'game')
    const catalog = join(root, 'skills')
    const config = join(root, 'config')
    await mkdir(join(workspace, 'docs'), { recursive: true })
    await mkdir(join(catalog, 'fixture'), { recursive: true })
    await writeFile(
      join(catalog, 'fixture', 'SKILL.md'),
      '---\nname: fixture\ndescription: Offline cold-resume fixture.\n---\nFixture skill.\n',
    )

    type TestPhase = 'initial' | 'resume' | 'fresh'
    let phase: TestPhase = 'initial'
    let initialRequestNumber = 0
    let resumeRequestNumber = 0
    let freshRequestNumber = 0
    const requests: Array<{ phase: TestPhase; body: Json; number: number }> = []
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        if (new URL(request.url).pathname !== '/v1/responses')
          return new Response('not found', { status: 404 })
        const body = (await request.json()) as Json
        const currentPhase = phase
        const number =
          currentPhase === 'initial'
            ? ++initialRequestNumber
            : currentPhase === 'resume'
              ? ++resumeRequestNumber
              : ++freshRequestNumber
        requests.push({ phase: currentPhase, body, number })
        if (currentPhase === 'initial' && number !== 1)
          return Response.json(
            {
              error: {
                message:
                  'initial Goal should be stopped after its first native turn',
              },
            },
            { status: 500 },
          )
        const responseNumber =
          currentPhase === 'initial'
            ? number
            : currentPhase === 'resume'
              ? number + 1
              : number + 4
        const output =
          currentPhase === 'initial'
            ? [messageOutput('Initial native Goal turn.', responseNumber)]
            : currentPhase === 'resume'
              ? number === 1
                ? [
                    functionOutput(
                      'WriteProjectFile',
                      {
                        file_path: 'docs/GDD.md',
                        content: 'Written after cold native Goal resume.',
                      },
                      responseNumber,
                    ),
                  ]
                : number === 2
                  ? [
                      functionOutput(
                        'update_goal',
                        { status: 'complete' },
                        responseNumber,
                      ),
                    ]
                  : number === 3
                    ? [
                        messageOutput(
                          'Final cold-resumed native Goal answer.',
                          responseNumber,
                        ),
                      ]
                    : []
              : number === 1
                ? [
                    functionOutput(
                      'update_goal',
                      { status: 'complete' },
                      responseNumber,
                    ),
                  ]
                : number === 2
                  ? [
                      messageOutput(
                        'Final fresh native Goal answer.',
                        responseNumber,
                      ),
                    ]
                  : []
        if (!output.length)
          return Response.json(
            { error: { message: 'unexpected extra cold-resume Goal turn' } },
            { status: 500 },
          )
        return responseStream(body, output, responseNumber)
      },
    })

    const env = () => ({
      BEEGAME_CONFIG_DIR: config,
      BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: catalog,
      OPENAI_API_KEY: 'synthetic-local-only',
      OPENAI_BASE_URL: server.url.origin + '/v1',
      BEEGAME_MODEL: 'native-goal-cold-resume-model',
    })
    const resolveOutboundTarget = async (value: string, _options?: unknown) => {
      const url = new URL(value)
      if (url.origin !== server.url.origin)
        throw Error(
          'Cold-resume fixture only permits its loopback Responses endpoint',
        )
      return {
        url,
        addresses: ['127.0.0.1'],
        lookup: (
          _host: string,
          _options: unknown,
          callback: (error: null, address: string, family: 4 | 6) => void,
        ) => callback(null, '127.0.0.1', 4),
      }
    }
    const objective = 'Finish the cold-resumed protected design record.'
    const tokenBudget = 1_000
    const initialSystemContext = 'INITIAL_NATIVE_TOOL_MARKER'
    const initialBriefContext = 'INITIAL_NATIVE_BRIEF_MARKER'
    const currentSystemContext = 'CURRENT_NATIVE_TOOL_MARKER'
    const currentBriefContext = 'CURRENT_NATIVE_BRIEF_MARKER'
    const freshObjective = 'Start a fresh protected design record.'
    const freshTokenBudget = 100
    const freshSystemContext = 'FRESH_NATIVE_TOOL_MARKER'
    const freshBriefContext = 'FRESH_NATIVE_BRIEF_MARKER'
    const initialEvents: Json[] = []
    const resumeEvents: Json[] = []
    const initialPermissionRequests: Json[] = []
    const resumePermissionRequests: Json[] = []
    const resumeUsage: Json[] = []
    const resumeReplayFlags: Array<boolean | undefined> = []
    let threadId = ''
    let initialRuntime:
      | Awaited<ReturnType<ReturnType<typeof createBgsRunner>['start']>>
      | undefined
    let resumeRuntime:
      | Awaited<ReturnType<ReturnType<typeof createBgsRunner>['start']>>
      | undefined
    const allow = (target: Json[]) => async (request: Json) => {
      target.push(request)
      return { behavior: 'allow' as const, source: 'user' as const }
    }

    try {
      const runner = createBgsRunner({ resolveOutboundTarget })
      initialRuntime = await runner.start({
        sessionId: 'native-goal-cold-pause-fixture',
        cwd: workspace,
        nativeGoal: { mode: 'start', objective, tokenBudget },
        systemContext: initialSystemContext,
        confirmedBriefContext: initialBriefContext,
        env: env(),
        onNativeSessionId: id => {
          threadId = id
        },
        requestPermission: allow(initialPermissionRequests),
      })
      const abort = new AbortController()
      let stoppedAfterFirstTurn = false
      await expect(
        initialRuntime.submit({
          prompt: 'Begin the protected design record.',
          confirmedBriefContext: initialBriefContext,
          signal: abort.signal,
          onMessage: message => {
            initialEvents.push(message)
            if (
              !stoppedAfterFirstTurn &&
              message.eventType === 'system.status' &&
              message.subtype === 'native_goal_turn_completed'
            ) {
              stoppedAfterFirstTurn = true
              abort.abort()
            }
          },
          requestPermission: allow(initialPermissionRequests),
        }),
      ).rejects.toThrow()
      await initialRuntime.dispose?.()
      initialRuntime = undefined
      expect(threadId).toBeTruthy()
      expect(stoppedAfterFirstTurn).toBe(true)
      expect(
        initialEvents.some(
          event => event.subtype === 'native_goal_turn_completed',
        ),
      ).toBe(true)

      const inspectEnv = {
        ...getSafeRuntimeProcessEnvironment(),
        ...env(),
        BGS_HOME: join(config, 'bgs'),
      }
      let inspectClient: BgsClient | undefined
      let pausedTokens = 0
      try {
        inspectClient = await BgsClient.connect({
          cwd: workspace,
          env: inspectEnv,
          config: {
            ...bgsProviderConfig(inspectEnv, { goals: true }),
            cli_auth_credentials_store: 'file',
          },
        })
        const paused = (
          await inspectClient.request('thread/goal/get', { threadId })
        ).goal
        expect(paused).toMatchObject({
          threadId,
          objective,
          tokenBudget,
          status: 'paused',
        })
        pausedTokens = paused.tokensUsed
        expect(pausedTokens).toBeGreaterThan(0)
        expect(initialEvents.findLast(event => event.subtype === 'native_goal')?.nativeGoal).toMatchObject({
          status: 'paused', tokensUsed: pausedTokens, tokenBudget,
        })
      } finally {
        await inspectClient?.close()
      }

      phase = 'resume'
      const resumedThreadIds: string[] = []
      resumeRuntime = await runner.start({
        sessionId: 'native-goal-cold-resume-fixture',
        cwd: workspace,
        resumeSessionId: threadId,
        nativeGoal: { mode: 'resume' },
        systemContext: currentSystemContext,
        confirmedBriefContext: currentBriefContext,
        env: env(),
        onNativeSessionId: id => {
          resumedThreadIds.push(id)
        },
        onNativeUsage: (value, _epoch, accounting) => {
          resumeUsage.push(value)
          resumeReplayFlags.push(accounting?.replayed)
        },
        requestPermission: allow(resumePermissionRequests),
      })
      try {
        await resumeRuntime.submit({
          prompt: 'Continue with the protected design record.',
          confirmedBriefContext: currentBriefContext,
          signal: AbortSignal.timeout(30_000),
          onMessage: message => {
            resumeEvents.push(message)
          },
          requestPermission: allow(resumePermissionRequests),
        })
      } finally {
        await resumeRuntime?.dispose?.()
      }
      expect(resumedThreadIds).toEqual([threadId])
      const resumedRequests = requests.filter(
        request => request.phase === 'resume',
      )
      expect(resumedRequests).toHaveLength(3)
      const firstResumedInput = JSON.stringify(resumedRequests[0]!.body.input)
      expect(firstResumedInput).toContain(
        'Continue with the protected design record.',
      )
      expect(firstResumedInput).toContain(currentSystemContext)
      expect(firstResumedInput).toContain(currentBriefContext)
      expect(
        (resumedRequests[1]!.body.tools ?? []).map((tool: Json) => tool.name),
      ).toContain('WriteProjectFile')
      expect(resumedRequests[2]!.body.input).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'function_call_output',
            call_id: 'native-goal-call-3',
          }),
        ]),
      )
      expect(resumePermissionRequests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            toolName: 'Write',
            input: {
              file_path: 'docs/GDD.md',
              content: 'Written after cold native Goal resume.',
            },
          }),
        ]),
      )
      expect(await readFile(join(workspace, 'docs/GDD.md'), 'utf8')).toBe(
        'Written after cold native Goal resume.',
      )
      expect(resumeEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventType: 'assistant.message',
            text: 'Final cold-resumed native Goal answer.',
          }),
        ]),
      )
      expect(
        resumeEvents.filter(
          event => event.subtype === 'native_goal_turn_completed',
        ).length,
      ).toBeGreaterThanOrEqual(1)
      expect(
        Math.max(...resumeUsage.map(value => value.total_tokens ?? 0)),
      ).toBeGreaterThanOrEqual(144)
      expect(resumeReplayFlags.length).toBeGreaterThan(0)
      expect(resumeReplayFlags.at(-1)).not.toBe(true)

      let finalClient: BgsClient | undefined
      try {
        finalClient = await BgsClient.connect({
          cwd: workspace,
          env: inspectEnv,
          config: {
            ...bgsProviderConfig(inspectEnv, { goals: true }),
            cli_auth_credentials_store: 'file',
          },
        })
        const completed = (
          await finalClient.request('thread/goal/get', { threadId })
        ).goal
        expect(completed).toMatchObject({
          threadId,
          objective,
          tokenBudget,
          status: 'complete',
        })
        expect(completed.tokensUsed).toBeGreaterThan(pausedTokens)
        expect(completed.tokensUsed).toBeGreaterThan(freshTokenBudget)

        phase = 'fresh'
        const freshThreadIds: string[] = []
        const freshEvents: Json[] = []
        const freshUsage: Json[] = []
        const freshReplayFlags: Array<boolean | undefined> = []
        const freshRuntime = await runner.start({
          sessionId: 'native-goal-cold-fresh-start-fixture',
          cwd: workspace,
          resumeSessionId: threadId,
          nativeGoal: {
            mode: 'start',
            objective: freshObjective,
            tokenBudget: freshTokenBudget,
          },
          systemContext: freshSystemContext,
          confirmedBriefContext: freshBriefContext,
          env: env(),
          onNativeSessionId: id => {
            freshThreadIds.push(id)
          },
          onNativeUsage: (value, _epoch, accounting) => {
            freshUsage.push(value)
            freshReplayFlags.push(accounting?.replayed)
          },
          requestPermission: allow([]),
        })
        try {
          await freshRuntime.submit({
            prompt: 'Start the fresh protected design record.',
            confirmedBriefContext: freshBriefContext,
            signal: AbortSignal.timeout(30_000),
            onMessage: message => {
              freshEvents.push(message)
            },
            requestPermission: allow([]),
          })
        } finally {
          await freshRuntime.dispose?.()
        }
        expect(freshThreadIds).toEqual([threadId])
        const freshRequests = requests.filter(
          request => request.phase === 'fresh',
        )
        expect(freshRequests).toHaveLength(2)
        const firstFreshInput = JSON.stringify(freshRequests[0]!.body.input)
        expect(firstFreshInput).toContain(
          'Start the fresh protected design record.',
        )
        expect(firstFreshInput).toContain(freshSystemContext)
        expect(firstFreshInput).toContain(freshBriefContext)
        expect(freshRequests[1]!.body.input).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'function_call_output',
              call_id: 'native-goal-call-5',
            }),
          ]),
        )
        expect(freshEvents).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              eventType: 'assistant.message',
              text: 'Final fresh native Goal answer.',
            }),
          ]),
        )
        expect(freshUsage.length).toBeGreaterThan(0)
        expect(freshReplayFlags.length).toBeGreaterThan(0)
        expect(freshReplayFlags.at(-1)).not.toBe(true)
        const freshCompleted = (
          await finalClient.request('thread/goal/get', { threadId })
        ).goal
        expect(freshCompleted).toMatchObject({
          threadId,
          objective: freshObjective,
          tokenBudget: freshTokenBudget,
          status: 'complete',
        })
        expect(freshCompleted.tokensUsed).toBeGreaterThan(0)
        expect(freshCompleted.tokensUsed).toBeLessThan(freshTokenBudget)
        expect(freshCompleted.tokensUsed).toBeLessThan(completed.tokensUsed)
      } finally {
        await finalClient?.close()
      }
    } finally {
      await initialRuntime?.dispose?.()
      await resumeRuntime?.dispose?.()
      server.stop(true)
      await rm(root, { recursive: true, force: true })
    }
  },
  60_000,
)


for (const outcome of ['complete', 'paused'] as const) nativeTest(
  `BGS assignment reaches real native ${outcome}, preserves scope and releases the writer without another dispatch`,
  async () => {
    const root = await mkdtemp('/private/tmp/bgs-assignment-handoff-')
    const workspace = join(root, 'game'), catalog = join(root, 'skills'), config = join(root, 'config')
    await mkdir(workspace); await mkdir(join(catalog, 'fixture'), { recursive: true })
    await initializeProjectGuide(workspace)
    await writeFile(join(catalog, 'fixture/SKILL.md'), '---\nname: fixture\ndescription: Offline execution fixture.\n---\nRead only when needed.\n')
    const requests: Json[] = []
    const server = Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request) {
      if(new URL(request.url).pathname!=='/v1/responses')return new Response('not found',{status:404})
      const body=await request.json() as Json;requests.push(body)
      const n=requests.length
      // Scripted Responses exercise the real execution chain without a model.
      const output=n===1
        ? [functionOutput('exec_command',{cmd:outcome==='paused' ? 'printf observed > technical-check.txt; sleep 30' : 'printf observed > technical-check.txt',yield_time_ms:1000},n)]
        : n===2 ? [functionOutput('update_goal',{status:'complete'},n)]
        : [messageOutput('Technical check observed; ready for user feedback.',n)]
      return responseStream(body,output,n)
    }})
    const runner=createBgsRunner({resolveOutboundTarget:async value=>{
      const url=new URL(value)
      if(url.origin!==server.url.origin)throw Error('Only the offline Responses fixture is allowed')
      return {url,addresses:['127.0.0.1'],lookup:(_host,_options,callback)=>callback(null,'127.0.0.1',4)}
    }})
    const sessions=new BeeGameSessionManager(runner,root,async()=>({
      BEEGAME_CONFIG_DIR:config,BEEGAME_NATIVE_BUILTIN_SKILLS_DIR:catalog,
      BEEGAME_MODEL_BILLING_SOURCE:'byok',BEEGAME_MODEL:'offline-assignment-model',
      OPENAI_API_KEY:'fixture-only',OPENAI_BASE_URL:server.url.origin+'/v1',
    }),{},true)
    const store=createLocalWorkflowStore(join(root,'store'))
    const executor=createAgentGoalExecutor({store,sessions})
    const session=sessions.start({workspacePath:workspace,projectId:'fixture',userId:'owner',userDataRoot:config})
    const brief=JSON.stringify({kind:'confirmed_build_brief',idea:'Preserve the entire requested behavior.',
      selected_option:{title:'Offline fixture'},settings:{engine:'fixture'},document_language:'en',
      game_user_visible_language:'en',agent_response_language:'en',resource_library_usage:'optional'})
    const run=createRun({projectId:'fixture',ownerId:'owner',workspacePath:workspace,chatSessionId:session.id,
      requestKey:'offline-assignment',text:brief,constraints:{},ids:['goal']})
    try {
      await store.commit(run.projectId,run.ownerId,0,run,'agent.goal-confirmed')
      await executor.start(run,{userDataRoot:config})
      if(outcome==='paused') {
        // Stop after provider usage arrives while the tool is still running:
        // the prior Goal event has not yet accounted this response.
        const pauseDeadline=Date.now()+15000
        while(!(await readFile(join(workspace,'technical-check.txt'),'utf8').catch(()=>'')) && Date.now()<pauseDeadline)
          await Bun.sleep(10)
        expect(await readFile(join(workspace,'technical-check.txt'),'utf8')).toBe('observed')
        const beforePause=sessions.transcript(session.id).findLast(event=>event.payload?.subtype==='native_goal')?.payload?.nativeGoal as Json
        expect(beforePause.tokensUsed).toBe(0)
        await executor.stop((await store.read(run.projectId,run.ownerId))!)
      }
      let settled=await store.read(run.projectId,run.ownerId)
      const deadline=Date.now()+20000
      while(!settled?.agentTurns?.[0]?.finishedAt && Date.now()<deadline) {
        await Bun.sleep(25);settled=await store.read(run.projectId,run.ownerId)
      }
      expect(settled?.agentTurns?.[0]?.finishedAt,JSON.stringify(settled)).toBeDefined()
      expect(settled!.writer).toBeUndefined()
      expect(settled!.requirements).toEqual(run.requirements)
      expect(settled!.deliveryEligible).toBe(false)
      expect(settled!.status,settled!.blockedReason).toBe('blocked')
      if(outcome==='complete')expect(settled!.blockedReason).toContain('Implementation delivery was not submitted')
      expect(settled!.agentTurns).toHaveLength(1)
      expect(settled!.agentTurns![0]!.status,settled!.blockedReason).toBe(outcome==='paused'?'interrupted':'ended')
      expect(settled!.agentTurns![0]!.quiescedAt).toBeDefined()
      const events=sessions.transcript(session.id)
      const goal=events.findLast(event=>event.payload?.subtype==='native_goal')?.payload?.nativeGoal as Json
      expect(goal).toMatchObject({status:outcome,tokenBudget:null})
      if(outcome==='paused')expect(goal.tokensUsed).toBe(48)
      const sentText=requests[0]!.input.flatMap((item:Json)=>(item.content??[]).map((part:Json)=>part.text??'')).join('\n')
      expect(sentText.includes(agentGoalPrompt(run))).toBe(true)
      expect(sentText.includes(brief)).toBe(true)
      expect(await readFile(join(workspace,'technical-check.txt'),'utf8')).toBe('observed')
      expect(events.filter(event=>event.payload?.subtype==='native_goal_turn_started')).toHaveLength(1)
      const count=requests.length
      await Bun.sleep(100)
      expect(requests).toHaveLength(count)
      expect(sessions.runtimeStatus()).toMatchObject({activeTurns:0,activeNativeTasks:0,runnerDisposals:0,cleanupFailures:0})
    } finally {
      await executor.dispose();await sessions.dispose();server.stop(true);await rm(root,{recursive:true,force:true})
    }
  }, 30000,
)

nativeTest('explicit delivery rejects visual gaps, retains Preview evidence and closes the real native task without another response',async()=>{
  const root=await mkdtemp('/private/tmp/bgs-native-delivery-')
  const workspace=join(root,'project'),catalog=join(root,'skills'),config=join(root,'config')
  await mkdir(workspace);await mkdir(join(catalog,'fixture'),{recursive:true});await initializeProjectGuide(workspace)
  await writeFile(join(catalog,'fixture/SKILL.md'),'---\nname: fixture\ndescription: Offline delivery fixture.\n---\nRead only when needed.\n')
  await writeFile(join(workspace,'input.txt'),'expected')
  await mkdir(join(workspace,'reports'))
  await writeFile(join(workspace,'verify.mjs'),`import {readFile,appendFile} from 'node:fs/promises';
    if(await readFile('input.txt','utf8')!==process.argv[2])throw Error('Unexpected actual input');
    await appendFile('reports/calls.txt','observed\\n');console.log('PASS: actual input observed');`)
  await writeFile(join(workspace,'submit.mjs'),`import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
    import {spawnSync} from 'node:child_process';
    import assert from 'node:assert/strict';
    const directory='.beegame/tmp/'+(await readdir('.beegame/tmp')).find(name=>name.startsWith('goal-tools-'));
    const preview=value=>{const child=spawnSync(process.execPath,[directory+'/preview.mjs','--request','saved-observation','--run','verify.mjs',value],{encoding:'utf8'});
      assert.ok(child.stdout,child.stderr);return {code:child.status,result:JSON.parse(child.stdout)}};
    const one=preview('expected'),two=preview('expected'),first=one.result,second=two.result;
    assert.equal(one.code,0,JSON.stringify(one.result));assert.equal(two.code,0,JSON.stringify(two.result));assert.equal(first.exitCode,0);assert.equal(second.reused,true);assert.equal(second.reportPath,first.reportPath);
    const changed=preview('different');assert.equal(changed.code,1);assert.match(changed.result.error,/PREVIEW_REQUEST_CONFLICT/);
    const capability=JSON.parse(await readFile(process.env.BEEGAME_MEASUREMENT_CAPABILITY_FILE,'utf8'));
    const post=body=>fetch(capability.apiUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const inputs=await (await post({executionInputs:true})).json();
    const report={scope:'delivery',status:'passed',summary:'The requested input was observed once; the second request reused its receipt.',
      environment:'Real Node check under the native sandbox; offline synthetic fixture',evidencePaths:[first.reportPath,first.stdoutPath,'input.txt'],artifactPaths:['input.txt'],
      verification:{target:'deployment',observation:'target-runtime',knownIssues:[],unverified:[],visualComparisons:[{
        state:'Synthetic comparison transport fixture',sourcePath:'input.txt',observationPaths:[first.stdoutPath],
        status:'different',differences:['Synthetic visual mismatch; no image-quality assertion']}]}};
    await mkdir('.beegame/delivery',{recursive:true});
    await writeFile('.beegame/delivery/acceptance.json',JSON.stringify(report));
    const stale=await post({finish:{requirementsRevision:'stale'}});assert.equal(stale.status,409);
    const different=await post({finish:{requirementsRevision:inputs.requirementsRevision}});assert.equal(different.status,409);
    assert.match(await different.text(),/Synthetic visual mismatch/);
    report.verification.visualComparisons[0]={...report.verification.visualComparisons[0],status:'unverified',observationPaths:[],differences:['Synthetic missing observation']};
    await writeFile('.beegame/delivery/acceptance.json',JSON.stringify(report));
    const unverified=await post({finish:{requirementsRevision:inputs.requirementsRevision}});assert.equal(unverified.status,409);
    assert.match(await unverified.text(),/Synthetic missing observation/);
    report.verification.visualComparisons[0]={...report.verification.visualComparisons[0],status:'matched',observationPaths:[first.stdoutPath],differences:[]};
    report.evidencePaths=[first.reportPath,'input.txt'];
    await writeFile('.beegame/delivery/acceptance.json',JSON.stringify(report));
    const omitted=spawnSync(process.execPath,[directory+'/handoff.mjs','--design','acceptance'],{encoding:'utf8'});
    assert.equal(omitted.status,1);assert.match(JSON.parse(omitted.stdout).summary,/must also appear in evidencePaths/);
    report.evidencePaths.push(first.stdoutPath);
    await writeFile('.beegame/delivery/acceptance.json',JSON.stringify(report));
    const inspected=spawnSync(process.execPath,[directory+'/handoff.mjs','--design','acceptance'],{encoding:'utf8'});
    assert.equal(inspected.status,1,inspected.stdout);const retained=JSON.parse(inspected.stdout);
    assert.match(retained.summary,/verification.designRevision is missing/); // This engine-neutral fixture has no design-bound GDD.
    assert.deepEqual(retained.verification.visualComparisons,report.verification.visualComparisons);assert.equal(retained.quality,'unverified');
    await writeFile('reports/reuse.json',JSON.stringify({first:first.reportPath,second:second.reportPath,reused:second.reused,staleRejected:true,visualDifferenceRejected:true,missingObservationRejected:true,comparisonRetained:true}));
    spawnSync(process.execPath,[directory+'/measure.mjs','--finish','--requirements',inputs.requirementsRevision],{encoding:'utf8'});
    await writeFile('reports/continued-after-finish.txt','UNEXPECTED');`)
  const requests:Json[]=[]
  let releaseUnexpected:(()=>void)|undefined
  const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    const path=new URL(request.url).pathname
    if(path==='/preview/status')return Response.json({preview:{status:'idle'}})
    if(path!=='/v1/responses')return new Response('not found',{status:404})
    const body=await request.json() as Json;requests.push(body);const n=requests.length
    if(n>1)await new Promise<void>(resolve=>{releaseUnexpected=resolve;request.signal.addEventListener('abort',()=>resolve(),{once:true})})
    return responseStream(body,[functionOutput('exec_command',{cmd:'node submit.mjs',yield_time_ms:10000},n)],n)
  }})
  const runner=createBgsRunner({resolveOutboundTarget:async value=>{
    const url=new URL(value);if(url.origin!==server.url.origin)throw Error('Offline endpoint only')
    return {url,addresses:['127.0.0.1'],lookup:(_host,_options,cb)=>cb(null,'127.0.0.1',4)}
  }})
  const sessions=new BeeGameSessionManager(runner,root,async()=>({BEEGAME_CONFIG_DIR:config,BEEGAME_NATIVE_BUILTIN_SKILLS_DIR:catalog,
    BEEGAME_MODEL_BILLING_SOURCE:'byok',BEEGAME_MODEL:'offline-delivery-fixture',OPENAI_API_KEY:'fixture-only',OPENAI_BASE_URL:server.url.origin+'/v1'}),{},true)
  const store=createLocalWorkflowStore(join(root,'store')),executor=createAgentGoalExecutor({store,sessions})
  const session=sessions.start({workspacePath:workspace,projectId:'fixture',userId:'owner',userDataRoot:config})
  const brief=JSON.stringify({kind:'confirmed_build_brief',idea:'Verify the entire requested input and hand off the observed result.',
    selected_option:{title:'Offline native delivery'},settings:{engine:'Node fixture'},document_language:'en',game_user_visible_language:'en',agent_response_language:'en',resource_library_usage:'optional'})
  const run=createRun({projectId:'fixture',ownerId:'owner',workspacePath:workspace,chatSessionId:session.id,requestKey:'delivery',text:brief,constraints:{},ids:['goal']})
  let previewClosed=0
  try {
    await store.commit(run.projectId,run.ownerId,0,run,'agent.goal-confirmed')
    await executor.start(run,{userDataRoot:config,openPreview:()=>({baseUrl:server.url.origin+'/preview',instruction:'Offline Node execution observation; no browser required.',close:async()=>{previewClosed++}})})
    let settled=await store.read(run.projectId,run.ownerId)
    const deadline=Date.now()+20000
    while(!settled?.agentTurns?.[0]?.finishedAt && requests.length<2 && Date.now()<deadline){await Bun.sleep(20);settled=await store.read(run.projectId,run.ownerId)}
    expect(settled?.status,JSON.stringify({run:settled,events:sessions.transcript(session.id).slice(-8)})).toBe('completed')
    expect(settled?.writer).toBeUndefined();expect(settled?.requirements).toEqual(run.requirements)
    expect(settled?.deliveryEligible).toBe(false);expect(settled?.agentTurns).toHaveLength(1)
    expect(settled?.agentTurns?.[0]).toMatchObject({status:'ended',quiescedAt:expect.any(String)})
    expect(await readFile(join(workspace,'reports/calls.txt'),'utf8')).toBe('observed\n')
    expect(JSON.parse(await readFile(join(workspace,'reports/reuse.json'),'utf8'))).toMatchObject({reused:true,staleRejected:true,visualDifferenceRejected:true,missingObservationRejected:true,comparisonRetained:true})
    expect(await readFile(join(workspace,'reports/continued-after-finish.txt'),'utf8').catch(()=>null)).toBeNull()
    expect(requests).toHaveLength(1)
    const sent=requests[0]!.input.flatMap((item:Json)=>(item.content??[]).map((part:Json)=>part.text??'')).join('\n')
    expect(sent).toContain(brief)
    const events=sessions.transcript(session.id)
    expect(events.findLast(event=>event.payload?.subtype==='native_goal')?.payload?.nativeGoal).toMatchObject({status:'complete',tokenBudget:null,tokensUsed:48})
    expect(events.find(event=>event.payload?.subtype==='delivery_submission')?.payload).toMatchObject({attemptId:settled!.agentTurns![0]!.attemptId,
      requirementsRevision:run.requirements.revision,quality:'unverified',deliveryEligible:false})
    expect(events.some(event=>event.type==='turn.failed')).toBe(false)
    expect(previewClosed).toBe(1)
    expect(sessions.runtimeStatus()).toMatchObject({activeTurns:0,activeNativeTasks:0,runnerDisposals:0,cleanupFailures:0})
    await Bun.sleep(100);expect(requests).toHaveLength(1)
  } finally {await executor.dispose();await sessions.dispose();releaseUnexpected?.();server.stop(true);await rm(root,{recursive:true,force:true})}
},30000)

nativeTest('four-stage host handoffs preserve a real native thread and enable Goal only for implementation',async()=>{
  const root=await mkdtemp('/private/tmp/bgs-native-production-'),workspace=join(root,'project'),config=join(root,'config'),catalog=join(root,'skills')
  await mkdir(join(workspace,'docs'),{recursive:true});await mkdir(join(catalog,'fixture'),{recursive:true})
  await writeFile(join(catalog,'fixture/SKILL.md'),'---\nname: fixture\ndescription: Offline stage transport fixture.\n---\nFixture only.\n')
  await writeFile(join(workspace,'docs/GDD.md'),'# Synthetic host fixture\n## Decisions\nThis tests transport, not design quality.\n')
  await writeFile(join(workspace,'docs/design.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>')
  await writeFile(join(workspace,'advance.mjs'),`import {readFile,readdir} from 'node:fs/promises';import {spawnSync} from 'node:child_process';
    const cap=JSON.parse(await readFile(process.env.BEEGAME_MEASUREMENT_CAPABILITY_FILE,'utf8'));
    const response=await fetch(cap.apiUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workflow:{action:'status'}})});
    const {assignment}=await response.json();let tool;
    for(const name of await readdir('.beegame/tmp'))if(name.startsWith('goal-tools-')){
      const path='.beegame/tmp/'+name+'/workflow.mjs';if((await readFile(path,'utf8')).includes(cap.apiUrl))tool=path;
    }
    if(!tool)throw Error('Current workflow capability missing');
    const child=spawnSync(process.execPath,[tool,'--advance',JSON.stringify({summary:'Synthetic native handoff',sections:['Decisions'],files:assignment.stage==='visual'?['docs/design.svg']:[]})],{encoding:'utf8'});
    if(child.status!==0)throw Error(child.stdout+child.stderr);console.log(child.stdout);`)
  const store=createLocalWorkflowStore(join(root,'store')),requests:Json[]=[],calls=new Map<string,number>()
  const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    if(new URL(request.url).pathname!=='/v1/responses')return new Response('not found',{status:404})
    const body=await request.json() as Json;requests.push(body);const n=requests.length
    const current=await store.read('fixture','owner'),turn=current!.agentTurns!.at(-1)!,count=(calls.get(turn.attemptId)??0)+1;calls.set(turn.attemptId,count)
    const implementing=turn.production!.stage==='implementation'
    expect(body.tools.some((tool:Json)=>tool.name==='update_goal')).toBe(implementing)
    if(count>2)return Response.json({error:{message:'Unexpected repeated native stage request'}},{status:400})
    return responseStream(body,count===1 ? [functionOutput(implementing?'update_goal':'exec_command',
      implementing?{status:'complete'}:{cmd:'node advance.mjs',yield_time_ms:10000},n)] : [messageOutput('Current synthetic assignment ended.',n)],n)
  }})
  const runner=createBgsRunner({resolveOutboundTarget:async value=>{
    const url=new URL(value);if(url.origin!==server.url.origin)throw Error('Offline endpoint only')
    return {url,addresses:['127.0.0.1'],lookup:(_host,_options,cb)=>cb(null,'127.0.0.1',4)}
  }})
  const sessions=new BeeGameSessionManager(runner,root,async()=>({BEEGAME_CONFIG_DIR:config,BEEGAME_NATIVE_BUILTIN_SKILLS_DIR:catalog,
    BEEGAME_MODEL_BILLING_SOURCE:'byok',BEEGAME_MODEL:'offline-production-fixture',OPENAI_API_KEY:'fixture-only',OPENAI_BASE_URL:server.url.origin+'/v1'}),{},true)
  const executor=createAgentGoalExecutor({store,sessions}),session=sessions.start({workspacePath:workspace,projectId:'fixture',userId:'owner',userDataRoot:config})
  const run=createRun({projectId:'fixture',ownerId:'owner',workspacePath:workspace,chatSessionId:session.id,requestKey:'production',
    text:JSON.stringify({kind:'confirmed_build_brief',idea:'Synthetic stage transport',settings:{engine:'fixture'},selected_option:{title:'Offline'},document_language:'en',game_user_visible_language:'en',agent_response_language:'en',resource_library_usage:'optional'}),constraints:{},ids:['goal']})
  run.productionWorkflow=1
  try {
    await store.commit(run.projectId,run.ownerId,0,run,'agent.goal-confirmed');await executor.start(run,{userDataRoot:config})
    let current=await store.read(run.projectId,run.ownerId);const deadline=Date.now()+60000
    while(Date.now()<deadline && !(current?.agentTurns?.length===11 && current.agentTurns.at(-1)?.finishedAt)){
      if(current?.agentTurns?.at(-1)?.status==='failed')break
      await Bun.sleep(25);current=await store.read(run.projectId,run.ownerId)
    }
    expect(current?.agentTurns?.length,JSON.stringify({current,events:sessions.transcript(session.id).slice(-5)})).toBe(11)
    expect(current!.agentTurns!.every(t=>t.status==='ended' && t.quiescedAt)).toBe(true)
    expect(new Set(current!.agentTurns!.map(t=>t.nativeSessionId)).size).toBe(1)
    expect(current!.status).toBe('blocked');expect(current!.blockedReason).toContain('delivery was not submitted')
    const goals=sessions.transcript(session.id).filter(e=>e.payload?.subtype==='native_goal')
    expect(goals.length).toBeGreaterThan(0)
    expect(goals.every(e=>e.turnId===current!.agentTurns!.at(-1)!.turnId)).toBe(true)
    expect(current!.agentTurns!.slice(0,10).every(t=>t.productionHandoff)).toBe(true)
    expect(requests).toHaveLength(22)
    expect(sessions.runtimeStatus()).toMatchObject({activeTurns:0,activeNativeTasks:0,cleanupFailures:0})
  }finally{await executor.dispose();await sessions.dispose();server.stop(true);await rm(root,{recursive:true,force:true})}
},90000)
