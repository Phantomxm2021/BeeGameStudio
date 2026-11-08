import { writeFixturePlugin } from './fixtures/plugin'
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
    const catalog = join(root, 'plugin-source', 'bgs-game-skills')
    await mkdir(catalog,{recursive:true})
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
          BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: await writeFixturePlugin(catalog),
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
        expect(text).not.toContain('### How to use skills')
        expect(text).not.toContain('progressive disclosure')
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
    const catalog = join(root, 'plugin-source', 'bgs-game-skills')
    await mkdir(catalog,{recursive:true})
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

    await writeFixturePlugin(catalog)
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
    // Each fixture response uses 48 tokens. A fresh active response fits,
    // while the 96-token retained Goal would exceed this budget if not reset.
    const freshTokenBudget = 72
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
    const workspace = join(root, 'game'), catalog = join(root, 'plugin-source', 'bgs-game-skills'), config = join(root, 'config')
    await mkdir(catalog,{recursive:true})
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
        : [messageOutput('Technical check observed; ready for user feedback.',n)]
      return responseStream(body,output,n)
    }})
    const runner=createBgsRunner({resolveOutboundTarget:async value=>{
      const url=new URL(value)
      if(url.origin!==server.url.origin)throw Error('Only the offline Responses fixture is allowed')
      return {url,addresses:['127.0.0.1'],lookup:(_host,_options,callback)=>callback(null,'127.0.0.1',4)}
    }})
    const sessions=new BeeGameSessionManager(runner,root,async()=>({
      BEEGAME_CONFIG_DIR:config,BEEGAME_NATIVE_BUILTIN_SKILLS_DIR:await writeFixturePlugin(catalog),
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
        // Stop while the ordinary native tool is still running.
        const pauseDeadline=Date.now()+15000
        while(!(await readFile(join(workspace,'technical-check.txt'),'utf8').catch(()=>'')) && Date.now()<pauseDeadline)
          await Bun.sleep(10)
        expect(await readFile(join(workspace,'technical-check.txt'),'utf8')).toBe('observed')
        expect(sessions.transcript(session.id).some(event=>event.payload?.subtype==='native_goal')).toBe(false)
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
      expect(settled!.status,settled!.blockedReason).toBe(outcome==='complete'?'completed':'blocked')
      if(outcome==='complete')expect(settled!.blockedReason).toBeUndefined()
      expect(settled!.agentTurns).toHaveLength(1)
      expect(settled!.agentTurns![0]!.status,settled!.blockedReason).toBe(outcome==='paused'?'interrupted':'ended')
      expect(settled!.agentTurns![0]!.quiescedAt).toBeDefined()
      const events=sessions.transcript(session.id)
      expect(events.some(event=>event.payload?.subtype==='native_goal')).toBe(false)
      expect(settled!.agentTurns![0]!).not.toHaveProperty('nativeGoal')
      expect(settled!.agentTurns![0]!.measurements).toBeUndefined()
      expect(settled!.agentTurns![0]!.deliverySubmission).toBeUndefined()
      const sentText=requests[0]!.input.flatMap((item:Json)=>(item.content??[]).map((part:Json)=>part.text??'')).join('\n')
      expect(sentText.includes(agentGoalPrompt(run))).toBe(true)
      expect(sentText.includes(brief)).toBe(true)
      expect(await readFile(join(workspace,'technical-check.txt'),'utf8')).toBe('observed')
      expect(events.filter(event=>event.payload?.subtype==='native_goal_turn_started')).toHaveLength(0)
      const count=requests.length
      await Bun.sleep(100)
      expect(requests).toHaveLength(count)
      expect(sessions.runtimeStatus()).toMatchObject({activeTurns:0,activeNativeTasks:0,runnerDisposals:0,cleanupFailures:0})
    } finally {
      await executor.dispose();await sessions.dispose();server.stop(true);await rm(root,{recursive:true,force:true})
    }
  }, 30000,
)

nativeTest('ordinary implementation verifies actual input and ends without BGS receipts or submission',async()=>{
  const root=await mkdtemp('/private/tmp/bgs-native-delivery-')
  const workspace=join(root,'project'),catalog=join(root, 'plugin-source', 'bgs-game-skills'),config=join(root,'config')
  await mkdir(catalog,{recursive:true})
  await mkdir(workspace);await mkdir(join(catalog,'fixture'),{recursive:true});await initializeProjectGuide(workspace)
  await writeFile(join(catalog,'fixture/SKILL.md'),'---\nname: fixture\ndescription: Offline execution fixture.\n---\nRead only when needed.\n')
  await writeFile(join(workspace,'input.txt'),'expected')
  await writeFile(join(workspace,'verify.mjs'),`import {readFile,writeFile} from 'node:fs/promises';
    if(await readFile('input.txt','utf8')!==process.argv[2])throw Error('Unexpected actual input');
    await writeFile('observed.txt','observed');console.log('PASS: actual input observed');`)
  const requests:Json[]=[]
  const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    if(new URL(request.url).pathname!=='/v1/responses')return new Response('not found',{status:404})
    const body=await request.json() as Json;requests.push(body);const n=requests.length
    if(n>2)return Response.json({error:{message:'Unexpected repeated native request'}},{status:400})
    return responseStream(body,n===1
      ? [functionOutput('exec_command',{cmd:'node verify.mjs expected',yield_time_ms:10000},n)]
      : [messageOutput('The requested input check passed. Game quality is unverified.',n)],n)
  }})
  const runner=createBgsRunner({resolveOutboundTarget:async value=>{
    const url=new URL(value);if(url.origin!==server.url.origin)throw Error('Offline endpoint only')
    return {url,addresses:['127.0.0.1'],lookup:(_host,_options,cb)=>cb(null,'127.0.0.1',4)}
  }})
  const sessions=new BeeGameSessionManager(runner,root,async()=>({BEEGAME_CONFIG_DIR:config,BEEGAME_NATIVE_BUILTIN_SKILLS_DIR:await writeFixturePlugin(catalog),
    BEEGAME_MODEL_BILLING_SOURCE:'byok',BEEGAME_MODEL:'offline-delivery-fixture',OPENAI_API_KEY:'fixture-only',OPENAI_BASE_URL:server.url.origin+'/v1'}),{},true)
  const store=createLocalWorkflowStore(join(root,'store')),executor=createAgentGoalExecutor({store,sessions})
  const session=sessions.start({workspacePath:workspace,projectId:'fixture',userId:'owner',userDataRoot:config})
  const brief=JSON.stringify({kind:'confirmed_build_brief',idea:'Verify the requested input and report the observed result.',
    selected_option:{title:'Offline native execution'},settings:{engine:'Node fixture'},document_language:'en',game_user_visible_language:'en',agent_response_language:'en',resource_library_usage:'optional'})
  const run=createRun({projectId:'fixture',ownerId:'owner',workspacePath:workspace,chatSessionId:session.id,requestKey:'delivery',text:brief,constraints:{},ids:['goal']})
  try {
    await store.commit(run.projectId,run.ownerId,0,run,'agent.goal-confirmed')
    await executor.start(run,{userDataRoot:config})
    let settled=await store.read(run.projectId,run.ownerId)
    const deadline=Date.now()+20000
    while(!settled?.agentTurns?.[0]?.finishedAt && Date.now()<deadline){await Bun.sleep(20);settled=await store.read(run.projectId,run.ownerId)}
    expect(settled?.status,JSON.stringify({run:settled,events:sessions.transcript(session.id).slice(-8)})).toBe('completed')
    expect(settled?.writer).toBeUndefined();expect(settled?.requirements).toEqual(run.requirements)
    expect(settled?.deliveryEligible).toBe(false);expect(settled?.agentTurns).toHaveLength(1)
    expect(settled?.agentTurns?.[0]).toMatchObject({status:'ended',quiescedAt:expect.any(String)})
    expect(settled?.agentTurns?.[0]).not.toHaveProperty('nativeGoal')
    expect(settled?.agentTurns?.[0]?.measurements).toBeUndefined()
    expect(settled?.agentTurns?.[0]?.deliverySubmission).toBeUndefined()
    expect(await readFile(join(workspace,'observed.txt'),'utf8')).toBe('observed')
    expect(await readFile(join(workspace,'.beegame/delivery/acceptance.json'),'utf8').catch(()=>null)).toBeNull()
    expect(requests).toHaveLength(2)
    expect(requests.flatMap(body=>body.tools).some((tool:Json)=>['create_goal','update_goal','BgsMeasure','BgsFinishDelivery'].includes(tool.name))).toBe(false)
    const sent=requests[0]!.input.flatMap((item:Json)=>(item.content??[]).map((part:Json)=>part.text??'')).join('\n')
    expect(sent).toContain(brief)
    const events=sessions.transcript(session.id)
    expect(events.some(event=>event.payload?.subtype==='native_goal' || event.payload?.subtype==='delivery_submission')).toBe(false)
    expect(events.some(event=>event.type==='turn.failed')).toBe(false)
    expect(sessions.runtimeStatus()).toMatchObject({activeTurns:0,activeNativeTasks:0,runnerDisposals:0,cleanupFailures:0})
    await Bun.sleep(100);expect(requests).toHaveLength(2)
  } finally {await executor.dispose();await sessions.dispose();server.stop(true);await rm(root,{recursive:true,force:true})}
},30000)

nativeTest('complete-game reviews GDD before native implementation with optional visuals and no Goal',async()=>{
  const root=await mkdtemp('/private/tmp/bgs-native-production-'),workspace=join(root,'project'),config=join(root,'config'),catalog=join(root, 'plugin-source', 'bgs-game-skills')
  await mkdir(catalog,{recursive:true})
  await mkdir(join(workspace,'assets'),{recursive:true});await mkdir(join(catalog,'fixture'),{recursive:true})
  await writeFile(join(catalog,'fixture/SKILL.md'),'---\nname: fixture\ndescription: Offline visual selection transport fixture.\n---\nFixture only.\n')
  await writeFile(join(workspace,'assets/design.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>')
  const store=createLocalWorkflowStore(join(root,'store')),requests:Json[]=[]
  const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    if(new URL(request.url).pathname!=='/v1/responses')return new Response('not found',{status:404})
    const body=await request.json() as Json;requests.push(body);const n=requests.length
    expect(body.tools.some((tool:Json)=>['create_goal','update_goal'].includes(tool.name))).toBe(false)
    if(n>6)return Response.json({error:{message:'Unexpected repeated native request'}},{status:400})
    const output=n===1
      ? functionOutput('WriteProjectFile',{file_path:'docs/GDD.md',content:'# Synthetic\n## Decisions\nOne playable loop; visuals as needed.\n'},n)
      : n===2 ? messageOutput(JSON.stringify({status:'ready',summary:'Saved design decisions'}),n)
      : n===3 ? messageOutput(JSON.stringify({summary:'Current design is consistent',findings:[]}),n)
      : n===4 ? functionOutput('BgsWorkflow',{action:'select-visual',summary:'Retain the synthetic source in this task',sections:[],files:['assets/design.svg']},n)
      : n===5 ? functionOutput('exec_command',{cmd:'printf observed > implementation.txt',yield_time_ms:10000},n)
      : messageOutput('Synthetic implementation finished with its selected source; visual quality is unverified.',n)
    return responseStream(body,[output],n)
  }})
  const runner=createBgsRunner({resolveOutboundTarget:async value=>{
    const url=new URL(value);if(url.origin!==server.url.origin)throw Error('Offline endpoint only')
    return {url,addresses:['127.0.0.1'],lookup:(_host,_options,cb)=>cb(null,'127.0.0.1',4)}
  }})
  const sessions=new BeeGameSessionManager(runner,root,async()=>({BEEGAME_CONFIG_DIR:config,BEEGAME_NATIVE_BUILTIN_SKILLS_DIR:await writeFixturePlugin(catalog),
    BEEGAME_MODEL_BILLING_SOURCE:'byok',BEEGAME_MODEL:'offline-production-fixture',OPENAI_API_KEY:'fixture-only',OPENAI_BASE_URL:server.url.origin+'/v1'}),{},true)
  const executor=createAgentGoalExecutor({store,sessions}),session=sessions.start({workspacePath:workspace,projectId:'fixture',userId:'owner',userDataRoot:config})
  const run=createRun({projectId:'fixture',ownerId:'owner',workspacePath:workspace,chatSessionId:session.id,requestKey:'production',
    text:JSON.stringify({kind:'confirmed_build_brief',idea:'Synthetic native implementation',settings:{engine:'fixture'},selected_option:{title:'Offline'},document_language:'en',game_user_visible_language:'en',agent_response_language:'en',resource_library_usage:'optional'}),constraints:{},ids:['goal']})
  run.productionWorkflow=1;run.creation={initialDelivery:'complete-game',editableContent:false}
  try {
    await store.commit(run.projectId,run.ownerId,0,run,'agent.goal-confirmed');await executor.start(run,{userDataRoot:config})
    let current=await store.read(run.projectId,run.ownerId);const deadline=Date.now()+20000
    while(Date.now()<deadline && !(current?.agentTurns?.length===2 && current.agentTurns[1]?.finishedAt && !current.writer)){await Bun.sleep(25);current=await store.read(run.projectId,run.ownerId)}
    expect(current?.status,JSON.stringify({current,events:sessions.transcript(session.id).slice(-5)})).toBe('completed')
    expect(current?.agentTurns).toHaveLength(2)
    expect(current!.agentTurns![0]!.designReviews).toHaveLength(1)
    expect(current!.agentTurns![0]!.productionHandoff?.next?.stage).toBe('implementation')
    expect(current!.agentTurns![1]).toMatchObject({status:'ended',quiescedAt:expect.any(String),production:{stage:'implementation'}})
    expect(current!.agentTurns![1]!.visualSelection?.sources).toEqual([{path:'assets/design.svg',sha256:expect.stringMatching(/^[a-f0-9]{64}$/)}])
    expect(current!.agentTurns![1]!.productionHandoff).toBeUndefined()
    expect(current!.agentTurns![1]!).not.toHaveProperty('nativeGoal')
    expect(await readFile(join(workspace,'implementation.txt'),'utf8')).toBe('observed')
    expect(await readFile(join(workspace,'docs/GDD.md'),'utf8')).toContain('One playable loop')
    expect(current!.status).toBe('completed');expect(current!.blockedReason).toBeUndefined()
    expect(requests).toHaveLength(6)
    expect(sessions.transcript(session.id).some(event=>event.payload?.subtype==='native_goal')).toBe(false)
    expect(sessions.runtimeStatus()).toMatchObject({activeTurns:0,activeNativeTasks:0,cleanupFailures:0})
  }finally{await executor.dispose();await sessions.dispose();server.stop(true);await rm(root,{recursive:true,force:true})}
},30000)
