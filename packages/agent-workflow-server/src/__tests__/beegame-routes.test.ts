import { beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import {
  createModelConfig,
  resetAgentWorkflow,
} from '@claude-code-best/agent-workflow'
import { createAgentWorkflowApp } from '../app'
import { DEFAULT_LOCAL_USER_ID } from '../auth/user-context'
import type {
  BeeGameSessionRunner,
  BeeGameSessionRunnerStartInput,
  BeeGameSessionSubmitInput,
  DashboardSDKMessage,
} from '../beegame/session-manager'
import type { BeeGamePreviewRunner } from '../beegame/preview-manager'

type FakeRuntimeMode =
  | 'messages'
  | 'permission'
  | 'permission_twice'
  | 'permission_different_tool'
  | 'dangerous_bash_permission'
  | 'dangerous_bash_twice'
  | 'workspace_bash_pipeline'
  | 'workspace_bash_cleanup'
  | 'workspace_unknown_bash'
  | 'outside_permission'
  | 'workspace_root_permission'
  | 'outside_bash_permission'
  | 'ask_user_question_permission'
  | 'build_write'
  | 'build_write_complete'
  | 'project_write'
  | 'project_absolute_doc_write'
  | 'project_file_write'
  | 'setup_bash'
  | 'project_code_write'
  | 'project_doc_write'
  | 'synthetic_user_message'
  | 'sibling_project_doc_write'
  | 'async_agent_complete'
  | 'short_final_after_partials'
  | 'result_only'

class FakeBeeGameRuntime {
  readonly submits: BeeGameSessionSubmitInput[] = []
  readonly stops: string[] = []
  readonly permissionResults: string[] = []

  constructor(
    private readonly cwd: string,
    private readonly messages: DashboardSDKMessage[] = [
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Acknowledged.' }] },
      },
      { type: 'result', result: 'Done' },
    ],
    private readonly mode: FakeRuntimeMode = 'messages',
  ) {}

  async submit(input: BeeGameSessionSubmitInput): Promise<void> {
    this.submits.push(input)
    if (this.mode === 'build_write') {
      const decision = await input.requestPermission({
        toolUseID: 'tool_build_write',
        toolName: 'Write',
        message: 'Write game files?',
        input: {
          file_path: 'snake-game/src/main.ts',
          content: 'console.log("snake")',
        },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `build ${decision.behavior}` })
      return
    }
    if (this.mode === 'build_write_complete') {
      input.onMessage({
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'tool_build_complete_write',
            name: 'Write',
            input: { file_path: 'snake-game/src/main.ts' },
          }],
        },
      })
      input.onMessage({
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'tool_build_complete_write',
            content: 'created',
          }],
        },
      })
      input.onMessage({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Build complete.' }] },
      })
      input.onMessage({ type: 'result', result: 'build complete' })
      return
    }
    if (this.mode === 'project_code_write') {
      const decision = await input.requestPermission({
        toolUseID: 'tool_same_turn_code_write',
        toolName: 'Write',
        message: 'Write project code?',
        input: {
          file_path: 'src/main.ts',
          content: 'console.log("game")',
        },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `project code ${decision.behavior}` })
      return
    }
    if (this.mode === 'project_doc_write') {
      const decision = await input.requestPermission({
        toolUseID: 'tool_extra_markdown_doc',
        toolName: 'Write',
        message: 'Write a project markdown doc?',
        input: {
          file_path: 'docs/NOTES.md',
          content: '# Notes\n\nUse this during project work.',
        },
      })
      if (decision.behavior === 'allow') {
        const fullPath = join(this.cwd, 'docs', 'NOTES.md')
        await mkdir(dirname(fullPath), { recursive: true })
        await writeFile(fullPath, '# Notes\n\nUse this during project work.', 'utf8')
      }
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `extra markdown ${decision.behavior}` })
      return
    }
    if (this.mode === 'synthetic_user_message') {
      input.onMessage({
        type: 'user',
        isSynthetic: true,
        message: {
          role: 'user',
          content: [{
            type: 'text',
            text: 'internal runtime resume marker',
          }],
        },
      })
      input.onMessage({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Continuing.' }] },
      })
      input.onMessage({ type: 'result', result: 'continued' })
      return
    }
    if (this.mode === 'async_agent_complete') {
      const outputFile = join(this.cwd, 'subagent-output.jsonl')
      await writeFile(
        outputFile,
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{
              type: 'text',
              text: 'Subagent audit found the core loop issue.',
            }],
            stop_reason: 'end_turn',
          },
        }) + '\n',
        'utf8',
      )
      input.onMessage({
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'tool_agent_async',
            name: 'Agent',
            input: {
              description: 'Audit project logic',
              prompt: 'Review the project logic.',
            },
          }],
        },
      })
      input.onMessage({
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'tool_agent_async',
            content: [
              'Async agent launched successfully.',
              'agentId: agent_test_1 (internal ID - do not mention to user.)',
              `output_file: ${outputFile}`,
            ].join('\n'),
          }],
        },
      })
      input.onMessage({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Waiting for the background audit.' }] },
      })
      input.onMessage({ type: 'result', result: 'waiting' })
      return
    }
    if (this.mode === 'short_final_after_partials') {
      input.onMessage({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'First complete sentence. ' },
        },
      })
      input.onMessage({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Second complete sentence.' },
        },
      })
      input.onMessage({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'First' }],
          stop_reason: 'end_turn',
        },
      })
      return
    }
    if (this.mode === 'sibling_project_doc_write') {
      const wrongPath = join(dirname(this.cwd), 'other-game', 'docs', 'NOTES.md')
      const decision = await input.requestPermission({
        toolUseID: 'tool_wrong_project_design_doc',
        toolName: 'Write',
        message: 'Write doc to another project?',
        input: {
          file_path: wrongPath,
          content: '# Notes',
        },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `wrong project ${decision.behavior}` })
      return
    }
    if (this.mode === 'result_only') {
      input.onMessage({ type: 'result', result: 'turn ended' })
      return
    }
    if (
      this.mode === 'permission' ||
      this.mode === 'permission_twice' ||
      this.mode === 'permission_different_tool' ||
      this.mode === 'dangerous_bash_permission' ||
      this.mode === 'dangerous_bash_twice'
    ) {
      const decision = await input.requestPermission({
        toolUseID: 'tool_1',
        toolName: 'Bash',
        message: this.mode.startsWith('dangerous_bash')
          ? 'Allow Bash to remove dist?'
          : 'Allow Bash to run npm test?',
        input: {
          command: this.mode.startsWith('dangerous_bash')
            ? 'rm -rf dist'
            : 'npm test',
        },
      })
      this.permissionResults.push(decision.behavior)
      if (
        this.mode === 'permission_twice' ||
        this.mode === 'permission_different_tool' ||
        this.mode === 'dangerous_bash_twice'
      ) {
        const secondDecision = await input.requestPermission({
          toolUseID: 'tool_2',
          toolName: this.mode === 'permission_different_tool' ? 'Read' : 'Bash',
          message: this.mode === 'permission_different_tool'
            ? 'Allow Read?'
            : this.mode === 'dangerous_bash_twice'
              ? 'Allow Bash to chmod dist?'
              : 'Allow Bash to run npm run build?',
          input: this.mode === 'permission_different_tool'
            ? { file_path: 'src/index.ts' }
            : {
              command: this.mode === 'dangerous_bash_twice'
                ? 'chmod -R 755 dist'
                : 'npm run build',
            },
        })
        this.permissionResults.push(secondDecision.behavior)
      }
      input.onMessage({ type: 'result', result: `permission ${decision.behavior}` })
      return
    }
    if (this.mode === 'workspace_bash_pipeline') {
      for (const [index, command] of [
        'npm run typecheck 2>&1 | head -30',
        'npm run build 2>&1 | head -80',
        'cat package.json | grep -A 30 "dependencies"',
      ].entries()) {
        const decision = await input.requestPermission({
          toolUseID: `tool_pipeline_${index + 1}`,
          toolName: 'Bash',
          message: 'Run workspace validation command?',
          input: { command },
        })
        this.permissionResults.push(decision.behavior)
      }
      input.onMessage({ type: 'result', result: 'pipeline validation done' })
      return
    }
    if (this.mode === 'workspace_bash_cleanup') {
      const decision = await input.requestPermission({
        toolUseID: 'tool_cleanup',
        toolName: 'Bash',
        message: 'Clean project dependencies?',
        input: {
          command: 'rm -rf node_modules package-lock.json && npm install 2>&1',
        },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: 'cleanup done' })
      return
    }
    if (this.mode === 'workspace_unknown_bash') {
      const decision = await input.requestPermission({
        toolUseID: 'tool_unknown_workspace_command',
        toolName: 'Bash',
        message: 'Run project-local validation?',
        input: {
          command: 'node scripts/local-validate.js --quick',
        },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: 'unknown workspace command done' })
      return
    }
    if (this.mode === 'outside_permission') {
      const decision = await input.requestPermission({
        toolUseID: 'tool_outside',
        toolName: 'Write',
        message: 'Write outside workspace?',
        input: { file_path: '/tmp/outside-workspace.txt' },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `outside ${decision.behavior}` })
      return
    }
    if (this.mode === 'workspace_root_permission') {
      const decision = await input.requestPermission({
        toolUseID: 'tool_workspace_root_write',
        toolName: 'Write',
        message: 'Write inside configured workspace root?',
        input: { file_path: join(dirname(this.cwd), 'existing-project', 'README.md') },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `workspace root ${decision.behavior}` })
      return
    }
    if (this.mode === 'outside_bash_permission') {
      const decision = await input.requestPermission({
        toolUseID: 'tool_outside_bash',
        toolName: 'Bash',
        message: 'List outside workspace?',
        input: {
          command: 'ls -la ../apps/frontend && find /tmp -maxdepth 1',
        },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `outside bash ${decision.behavior}` })
      return
    }
    if (this.mode === 'ask_user_question_permission') {
      const decision = await input.requestPermission({
        toolUseID: 'tool_question',
        toolName: 'AskUserQuestion',
        message: 'Ask the user which game mode to build.',
        input: {
          question: '你想做单人还是双人模式？',
        },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `question ${decision.behavior}` })
      return
    }
    if (this.mode === 'project_write') {
      const decision = await input.requestPermission({
        toolUseID: 'tool_write_before_spec',
        toolName: 'Write',
        message: 'Write game files?',
        input: {
          file_path: 'snake-game/src/main.ts',
          content: 'console.log("snake")',
        },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `project write ${decision.behavior}` })
      return
    }
    if (this.mode === 'project_absolute_doc_write') {
      const decision = await input.requestPermission({
        toolUseID: 'tool_write_project_doc',
        toolName: 'Write',
        message: 'Write project doc?',
        input: {
          file_path: join(this.cwd, 'docs', 'NOTES.md'),
          content: '# Notes',
        },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `write project doc ${decision.behavior}` })
      return
    }
    if (this.mode === 'project_file_write') {
      const decision = await input.requestPermission({
        toolUseID: 'tool_write_after_spec_file',
        toolName: 'Write',
        message: 'Write game files?',
        input: {
          file_path: join(this.cwd, 'game', 'src', 'main.ts'),
          content: 'console.log("game")',
        },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `write after spec file ${decision.behavior}` })
      return
    }
    if (this.mode === 'setup_bash') {
      const decision = await input.requestPermission({
        toolUseID: 'tool_bash_before_spec',
        toolName: 'Bash',
        message: 'Run setup command?',
        input: {
          command: 'npm create vite@latest snake-game -- --template react-ts',
        },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `bash before spec ${decision.behavior}` })
      return
    }

    for (const message of this.messages) {
      if (input.signal.aborted) return
      input.onMessage(message)
    }
  }

  stop(): void {
    this.stops.push('stop')
  }
}

function createFakeRunner(
  messages?: DashboardSDKMessage[],
  mode?: FakeRuntimeMode,
): {
  starts: BeeGameSessionRunnerStartInput[]
  runtimes: FakeBeeGameRuntime[]
  runner: BeeGameSessionRunner
} {
  const defaultMode = mode ?? 'messages'
  const starts: BeeGameSessionRunnerStartInput[] = []
  const runtimes: FakeBeeGameRuntime[] = []
  return {
    starts,
    runtimes,
    runner: {
      async start(input) {
        starts.push(input)
        const runtime = new FakeBeeGameRuntime(input.cwd, messages, defaultMode)
        runtimes.push(runtime)
        return runtime
      },
    },
  }
}

function createSequencedFakeRunner(
  modes: FakeRuntimeMode[],
): {
  starts: BeeGameSessionRunnerStartInput[]
  runtimes: FakeBeeGameRuntime[]
  runner: BeeGameSessionRunner
} {
  const starts: BeeGameSessionRunnerStartInput[] = []
  const runtimes: FakeBeeGameRuntime[] = []
  return {
    starts,
    runtimes,
    runner: {
      async start(input) {
        starts.push(input)
        const mode = modes[runtimes.length] ?? modes[modes.length - 1] ?? 'messages'
        const runtime = new FakeBeeGameRuntime(input.cwd, undefined, mode)
        runtimes.push(runtime)
        return runtime
      },
    },
  }
}

function getTestTranscriptPath(root: string, workspace: string, sessionId: string): string {
  const projectName = basename(workspace)
  const sessionHash = createHash('sha256').update(sessionId).digest('hex').slice(0, 8)
  return join(
    workspace,
    'transcripts',
    `${projectName}__${sessionHash}.jsonl`,
  )
}

async function createConfiguredProjectWorkspace(): Promise<{
  projectsRoot: string
  workspace: string
}> {
  const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
  const workspace = join(projectsRoot, 'current-project')
  await mkdir(workspace, { recursive: true })
  return { projectsRoot, workspace }
}

describe('beegame session routes', () => {
  const legacyRuntimeEnvPrefix = ['CLAU', 'DE_CODE_USE_'].join('')

  beforeEach(() => {
    resetAgentWorkflow()
  })

  test('creates a dashboard session without starting a BeeGame turn', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner(undefined, 'build_write_complete')
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    const model = createModelConfig(DEFAULT_LOCAL_USER_ID, {
      name: 'Primary LLM',
      provider: 'openai-compatible',
      baseUrl: 'https://llm.example.invalid/v1',
      apiKey: 'sk-dashboard-secret',
      models: { balanced: 'balanced-model' },
    })

    try {
      const res = await app.request('/api/console/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspacePath: workspace,
          modelConfigId: model.id,
        }),
      })

      expect(res.status).toBe(200)
      const session = await res.json()
      expect(session.status).toBe('running')
      expect(session.turnStatus).toBe('idle')
      expect(fake.starts).toHaveLength(0)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('rejects relative workspace paths before creating a runner', async () => {
    const fake = createFakeRunner()
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })

    const res = await app.request('/api/console/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspacePath: './WO' }),
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'Workspace path must be absolute',
    })
    expect(fake.starts).toHaveLength(0)
  })

  test('rejects workspace paths outside the configured Projects directory', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const outsideRoot = await mkdtemp(join(tmpdir(), 'beegame-outside-'))
    const fake = createFakeRunner()
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const resolvedProjectsRoot = await realpath(projectsRoot)
      const res = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: outsideRoot }),
      })

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({
        error: `Workspace path must stay inside the default Projects directory: ${resolvedProjectsRoot}`,
      })
      expect(fake.starts).toHaveLength(0)
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
      await rm(outsideRoot, { recursive: true, force: true })
    }
  })

  test('creates a missing project workspace directory inside the configured Projects directory', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const workspace = join(projectsRoot, 'snake-web')
    const fake = createFakeRunner()
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })

    try {
      const res = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })

      expect(res.status).toBe(200)
      expect((await stat(workspace)).isDirectory()).toBe(true)
      expect(fake.starts).toHaveLength(0)
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('rejects starting a BeeGame session directly in the default Projects root', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const fake = createFakeRunner()
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })

    try {
      const resolvedProjectsRoot = await realpath(projectsRoot)
      const res = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: projectsRoot }),
      })

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({
        error: `Workspace path must target a project directory under the default Projects directory, not the Projects root: ${resolvedProjectsRoot}`,
      })
      expect(fake.starts).toHaveLength(0)
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('sends input through a structured BeeGame session runner', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const workspace = join(projectsRoot, 'game-one')
    const fake = createFakeRunner(undefined, 'build_write_complete')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    const model = createModelConfig(DEFAULT_LOCAL_USER_ID, {
      name: 'Primary LLM',
      provider: 'openai-compatible',
      baseUrl: 'https://llm.example.invalid/v1',
      apiKey: 'sk-dashboard-secret',
      models: { balanced: 'balanced-model' },
    })
    try {
      const sessionRes = await app.request('/api/console/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspacePath: workspace,
          modelConfigId: model.id,
        }),
      })
      const session = await sessionRes.json()

      const inputRes = await app.request(
        `/api/console/sessions/${session.id}/input`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            text: 'Build a tiny puzzle game.',
            displayText: 'Tiny puzzle game',
            displayKind: 'initial_idea',
          }),
        },
      )

      await waitFor(async () => {
        const eventsRes = await app.request(
          `/api/console/sessions/${session.id}/events`,
        )
        const events = await eventsRes.json()
        return events.some((event: { type: string }) => event.type === 'turn.completed')
      })
      const resolvedWorkspace = await realpath(workspace)

      expect(inputRes.status).toBe(200)
      expect(fake.starts).toEqual([
        expect.objectContaining({
          sessionId: session.id,
          cwd: resolvedWorkspace,
          env: expect.objectContaining({
            BEEGAME_CONFIG_DIR: expect.stringContaining('.beegame'),
            BEEGAME_PROJECT_CONFIG_DIR_NAME: '.beegame',
            [`${legacyRuntimeEnvPrefix}OPENAI`]: '1',
            OPENAI_BASE_URL: 'https://llm.example.invalid/v1',
            OPENAI_API_KEY: 'sk-dashboard-secret',
            OPENAI_DEFAULT_SONNET_MODEL: 'balanced-model',
          }),
        }),
      ])
      expect(fake.starts[0]?.env).not.toHaveProperty('CLAUDE_CONFIG_DIR')
      expect(fake.runtimes[0].submits[0].prompt).toBe(
        'Build a tiny puzzle game.',
      )

      const eventsRes = await app.request(
        `/api/console/sessions/${session.id}/events`,
      )
      expect(eventsRes.status).toBe(200)
      const events = await eventsRes.json()
      expect(events.map((event: { type: string }) => event.type)).toEqual(
        expect.arrayContaining([
          'session.started',
          'runtime.observation',
          'turn.started',
          'user.message',
          'assistant.message',
          'result',
          'turn.completed',
        ]),
      )
      expect(events.find((event: { type: string }) => event.type === 'runtime.observation')).toEqual(
        expect.objectContaining({
          type: 'runtime.observation',
          text: 'BeeGame runtime observability updated',
          payload: expect.objectContaining({
            type: 'runtime.observation',
            features: expect.arrayContaining([
              expect.objectContaining({ id: 'CONTEXT_COLLAPSE' }),
              expect.objectContaining({ id: 'HISTORY_SNIP' }),
              expect.objectContaining({ id: 'TOKEN_BUDGET' }),
              expect.objectContaining({ id: 'MONITOR_TOOL' }),
            ]),
          }),
        }),
      )
      expect(events.find((event: { type: string }) => event.type === 'assistant.message')).toEqual(
        expect.objectContaining({
          type: 'assistant.message',
          text: 'Build complete.',
        }),
      )
      const transcriptDir = join(workspace, 'transcripts')
      await expect(stat(join(projectsRoot, 'workflow-runs'))).rejects.toThrow()
      await expect(
        stat(join(projectsRoot, '.beegame-dashboard', 'workflow-runs')),
      ).rejects.toThrow()
      const transcriptFiles = await readdir(transcriptDir)
      expect(transcriptFiles).toHaveLength(1)
      expect(transcriptFiles[0]).toMatch(/^game-one__[a-f0-9]{8}\.jsonl$/)
      expect(transcriptFiles[0]).not.toBe(`${session.id}.jsonl`)
      const transcript = await readFile(
        join(transcriptDir, transcriptFiles[0]),
        'utf8',
      )
      await expect(stat(join(projectsRoot, 'transcripts'))).rejects.toThrow()
      const transcriptEvents = transcript
        .trim()
        .split('\n')
        .map(line => JSON.parse(line) as {
          type: string
          text: string
          payload?: Record<string, unknown>
        })
      expect(transcriptEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'user.message',
            text: 'Build a tiny puzzle game.',
            payload: expect.objectContaining({
              displayText: 'Tiny puzzle game',
              displayKind: 'initial_idea',
            }),
          }),
          expect.objectContaining({
            type: 'assistant.message',
            text: 'Build complete.',
          }),
        ]),
      )
      const restartedApp = createAgentWorkflowApp({
        sessionRunner: createFakeRunner().runner,
        defaultWorkspacePath: projectsRoot,
      })
      const transcriptRes = await restartedApp.request(
        `/api/beegame-sessions/${session.id}/transcript?workspacePath=${encodeURIComponent(workspace)}`,
      )
      expect(transcriptRes.status).toBe(200)
      expect(await transcriptRes.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'assistant.message',
            text: 'Build complete.',
          }),
        ]),
      )
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('injects saved Brave web search settings into new BeeGame turns', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const workspace = join(projectsRoot, 'brave-search-game')
    const fake = createFakeRunner(undefined, 'build_write_complete')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    const model = createModelConfig(DEFAULT_LOCAL_USER_ID, {
      name: 'Primary LLM',
      provider: 'openai-compatible',
      baseUrl: 'https://llm.example.invalid/v1',
      apiKey: 'sk-dashboard-secret',
      models: { balanced: 'balanced-model' },
    })
    try {
      const webToolsRes = await app.request('/api/web-tools', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          webSearchAdapter: 'brave',
          braveApiKey: 'bsa-dashboard-secret',
        }),
      })
      expect(webToolsRes.status).toBe(200)
      await expect(webToolsRes.json()).resolves.toEqual(expect.objectContaining({
        webSearchAdapter: 'brave',
        braveApiKeyPreview: 'bsa-…cret',
      }))

      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspacePath: workspace,
          modelConfigId: model.id,
        }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Check current game design references.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(
          `/api/beegame-sessions/${session.id}/events`,
        )
        const events = await eventsRes.json()
        return events.some((event: { type: string }) => event.type === 'turn.completed')
      })

      expect(fake.starts[0]?.env).toEqual(expect.objectContaining({
        WEB_SEARCH_ADAPTER: 'brave',
        BRAVE_SEARCH_API_KEY: 'bsa-dashboard-secret',
      }))
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('injects saved runtime capability settings into new BeeGame turns', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const workspace = join(projectsRoot, 'runtime-capability-game')
    const fake = createFakeRunner(undefined, 'build_write_complete')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    const model = createModelConfig(DEFAULT_LOCAL_USER_ID, {
      name: 'Primary LLM',
      provider: 'openai-compatible',
      baseUrl: 'https://llm.example.invalid/v1',
      apiKey: 'sk-dashboard-secret',
      models: { balanced: 'balanced-model' },
    })

    try {
      const settingsRes = await app.request('/api/runtime-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          autoMemoryEnabled: false,
          autoDreamEnabled: true,
          skillSearchEnabled: true,
          treeSitterBashEnabled: true,
          webBrowserToolEnabled: true,
          bashClassifierEnabled: true,
          mcpSkillsEnabled: true,
        }),
      })
      expect(settingsRes.status).toBe(200)

      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspacePath: workspace,
          modelConfigId: model.id,
        }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Build with configured capabilities.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(
          `/api/beegame-sessions/${session.id}/events`,
        )
        const events = await eventsRes.json()
        return events.some((event: { type: string }) => event.type === 'turn.completed')
      })

      expect(fake.starts[0]?.env).toEqual(expect.objectContaining({
        SKILL_SEARCH_ENABLED: '1',
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
        FEATURE_TREE_SITTER_BASH: '1',
        FEATURE_WEB_BROWSER_TOOL: '1',
        FEATURE_BASH_CLASSIFIER: '1',
        FEATURE_MCP_SKILLS: '1',
      }))
      expect(fake.starts[0]?.env.CLAUDE_CONFIG_DIR).toContain('claude-config')
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('updates an existing BeeGame session model before the next turn', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const workspace = join(projectsRoot, 'model-switch-game')
    const fake = createFakeRunner(undefined, 'build_write_complete')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    const oldModel = createModelConfig(DEFAULT_LOCAL_USER_ID, {
      name: 'Old LLM',
      provider: 'openai-compatible',
      baseUrl: 'https://old-llm.example.invalid/v1',
      apiKey: 'sk-old-secret',
      models: { balanced: 'old-balanced-model' },
    })
    const newModel = createModelConfig(DEFAULT_LOCAL_USER_ID, {
      name: 'New LLM',
      provider: 'openai-compatible',
      baseUrl: 'https://new-llm.example.invalid/v1',
      apiKey: 'sk-new-secret',
      models: { balanced: 'new-balanced-model' },
    })

    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspacePath: workspace,
          modelConfigId: oldModel.id,
        }),
      })
      const session = await sessionRes.json()

      const updateRes = await app.request(
        `/api/beegame-sessions/${session.id}/model`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ modelConfigId: newModel.id }),
        },
      )
      expect(updateRes.status).toBe(200)
      expect(await updateRes.json()).toEqual(
        expect.objectContaining({
          id: session.id,
          modelConfigId: newModel.id,
        }),
      )

      const inputRes = await app.request(
        `/api/beegame-sessions/${session.id}/input`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Continue with the new model.' }),
        },
      )
      expect(inputRes.status).toBe(200)

      await waitFor(async () => {
        const eventsRes = await app.request(
          `/api/beegame-sessions/${session.id}/events`,
        )
        const events = await eventsRes.json()
        return events.some((event: { type: string }) => event.type === 'turn.completed')
      })

      expect(fake.starts).toEqual([
        expect.objectContaining({
          sessionId: session.id,
          env: expect.objectContaining({
            OPENAI_BASE_URL: 'https://new-llm.example.invalid/v1',
            OPENAI_API_KEY: 'sk-new-secret',
            OPENAI_DEFAULT_SONNET_MODEL: 'new-balanced-model',
          }),
        }),
      ])
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('marks text-only end turns as empty so the dashboard does not treat them as progress', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const workspace = join(projectsRoot, 'empty-turn-game')
    const fake = createFakeRunner([
      {
        type: 'assistant',
        message: {
          content: [{
            type: 'text',
            text: 'I understand the task and will inspect the project next.',
          }],
          stop_reason: 'end_turn',
        },
      },
      {
        type: 'result',
        result: 'I understand the task and will inspect the project next.',
      },
    ])
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Build the game now.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some((event: { type: string }) => event.type === 'turn.empty')
      })

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(events.some((event: { type: string }) => event.type === 'turn.completed')).toBe(false)
      expect(events.find((event: { type: string }) => event.type === 'turn.empty')).toEqual(
        expect.objectContaining({
          type: 'turn.empty',
          text: 'Agent ended this turn without using tools. Send continue or retry to start implementation.',
        }),
      )
      expect([...events].reverse().find((event: { type: string }) => event.type === 'runtime.observation')).toEqual(
        expect.objectContaining({
          payload: expect.objectContaining({
            status: 'empty_turn',
            counters: expect.objectContaining({ toolUseCount: 0 }),
          }),
        }),
      )
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('supports beegame-sessions routes while keeping console routes compatible', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner()
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      expect(sessionRes.status).toBe(200)
      const session = await sessionRes.json()

      const inputRes = await app.request(
        `/api/beegame-sessions/${session.id}/input`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Say hello.' }),
        },
      )
      expect(inputRes.status).toBe(200)
      await waitFor(async () => {
        const eventsRes = await app.request(
          `/api/beegame-sessions/${session.id}/events`,
        )
        const events = await eventsRes.json()
        return events.some((event: { type: string }) => event.type === 'turn.empty')
      })

      const eventsRes = await app.request(
        `/api/beegame-sessions/${session.id}/events`,
      )
      expect(eventsRes.status).toBe(200)
      const events = await eventsRes.json()
      expect(events.map((event: { type: string }) => event.type)).toContain(
        'assistant.message',
      )

      const compatibilityRes = await app.request(
        `/api/console/sessions/${session.id}`,
      )
      expect(compatibilityRes.status).toBe(200)
      expect(await compatibilityRes.json()).toEqual(
        expect.objectContaining({ id: session.id }),
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('maps SDK tool use and result messages to dashboard tool events', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner([
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool_bash_1',
              name: 'Bash',
              input: { command: 'npm test' },
            },
          ],
        },
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool_bash_1',
              content: 'tests passed',
            },
          ],
        },
      },
    ])
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/console/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()
      await app.request(`/api/console/sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Run tests.' }),
      })

      await waitFor(() => fake.runtimes[0]?.submits.length === 1)

      const eventsRes = await app.request(
        `/api/console/sessions/${session.id}/events`,
      )
      const events = await eventsRes.json()
      expect(events.map((event: { type: string }) => event.type)).toContain(
        'tool.started',
      )
      expect(events.map((event: { type: string }) => event.type)).toContain(
        'tool.completed',
      )
      expect(
        events.find((event: { type: string }) => event.type === 'tool.started'),
      ).toEqual(
        expect.objectContaining({
          text: 'Bash',
          payload: expect.objectContaining({
            toolUseID: 'tool_bash_1',
            toolName: 'Bash',
            input: { command: 'npm test' },
          }),
        }),
      )
      expect(
        events.find(
          (event: { type: string }) => event.type === 'tool.completed',
        ),
      ).toEqual(
        expect.objectContaining({
          text: 'Bash completed',
          payload: expect.objectContaining({
            toolUseID: 'tool_bash_1',
            toolName: 'Bash',
            output: 'tests passed',
          }),
        }),
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('filters raw SDK stream protocol events from visible message events', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner([
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          content_block: { type: 'thinking', thinking: '' },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'thinking_delta', thinking: 'private reasoning' },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'input_json_delta', partial_json: '{"command"' },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'message_delta',
          delta: { stop_reason: null },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Visible answer.' },
        },
      },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'hidden final thinking' },
            { type: 'text', text: 'Final text.' },
          ],
        },
      },
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool_write_1',
              name: 'Write',
              input: { file_path: 'game.ts', content: 'export {}' },
            },
          ],
        },
      },
    ])
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()
      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Respond cleanly.' }),
      })

      await waitFor(() => fake.runtimes[0]?.submits.length === 1)

      const eventsRes = await app.request(
        `/api/beegame-sessions/${session.id}/events`,
      )
      const events = await eventsRes.json()
      expect(events.map((event: { text: string }) => event.text)).not.toContain(
        'content_block_start',
      )
      expect(events.map((event: { text: string }) => event.text)).not.toContain(
        'thinking_delta',
      )
      expect(events.map((event: { text: string }) => event.text)).not.toContain(
        'input_json_delta',
      )
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'assistant.partial',
            text: 'Visible answer.',
          }),
          expect.objectContaining({
            type: 'assistant.message',
            text: 'Final text.',
          }),
          expect.objectContaining({
            type: 'tool.started',
            text: 'Write',
          }),
        ]),
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('uses accumulated assistant stream text when the final assistant message is shorter', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner(undefined, 'short_final_after_partials')
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Respond cleanly.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(
          `/api/beegame-sessions/${session.id}/events`,
        )
        const events = await eventsRes.json()
        return events.some((event: { type: string }) =>
          event.type === 'turn.completed' || event.type === 'turn.empty'
        )
      })

      const eventsRes = await app.request(
        `/api/beegame-sessions/${session.id}/events`,
      )
      const events = await eventsRes.json()
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'assistant.message',
            text: 'First complete sentence. Second complete sentence.',
          }),
        ]),
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('does not emit duplicate tool.started events for the same tool use id', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner([
      {
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'tool_agent_1',
            name: 'Agent',
            input: {
              description: 'Review plan',
              prompt: 'Review the game plan.',
            },
          }],
        },
      },
      {
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'tool_agent_1',
            name: 'Agent',
            input: {
              description: 'Review plan',
              prompt: 'Review the game plan.',
            },
          }],
        },
      },
    ])
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()
      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Use a subagent if useful.' }),
      })

      await waitFor(() => fake.runtimes[0]?.submits.length === 1)

      const eventsRes = await app.request(
        `/api/beegame-sessions/${session.id}/events`,
      )
      const events = await eventsRes.json()
      const agentStarts = events.filter(
        (event: { type: string; payload?: { toolUseID?: string } }) =>
          event.type === 'tool.started' &&
          event.payload?.toolUseID === 'tool_agent_1',
      )
      expect(agentStarts).toHaveLength(1)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('surfaces async subagent final output after the parent turn ends', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner(undefined, 'async_agent_complete')
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    const previousPollMs = process.env.BEEGAME_SUBAGENT_MONITOR_POLL_MS
    const previousTimeoutMs = process.env.BEEGAME_SUBAGENT_MONITOR_TIMEOUT_MS
    process.env.BEEGAME_SUBAGENT_MONITOR_POLL_MS = '1'
    process.env.BEEGAME_SUBAGENT_MONITOR_TIMEOUT_MS = '1000'
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()
      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Audit the project logic.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(
          `/api/beegame-sessions/${session.id}/events`,
        )
        const events = await eventsRes.json()
        return events.some(
          (event: { type: string; text: string }) =>
            event.type === 'assistant.message' &&
            event.text.includes('Subagent audit found the core loop issue.'),
        )
      })

      const eventsRes = await app.request(
        `/api/beegame-sessions/${session.id}/events`,
      )
      const events = await eventsRes.json()
      expect(events).toContainEqual(expect.objectContaining({
        type: 'tool.progress',
        text: 'Subagent running',
      }))
      expect(events).toContainEqual(expect.objectContaining({
        type: 'tool.completed',
        text: 'Subagent completed',
      }))
      expect(events).toContainEqual(expect.objectContaining({
        type: 'assistant.message',
        text: 'Subagent audit found the core loop issue.',
      }))
    } finally {
      if (previousPollMs === undefined) {
        delete process.env.BEEGAME_SUBAGENT_MONITOR_POLL_MS
      } else {
        process.env.BEEGAME_SUBAGENT_MONITOR_POLL_MS = previousPollMs
      }
      if (previousTimeoutMs === undefined) {
        delete process.env.BEEGAME_SUBAGENT_MONITOR_TIMEOUT_MS
      } else {
        process.env.BEEGAME_SUBAGENT_MONITOR_TIMEOUT_MS = previousTimeoutMs
      }
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('surfaces async subagent output when reading transcript after backend restart', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner(undefined, 'async_agent_complete')
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()
      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Audit the project logic.' }),
      })
      await waitFor(() => fake.runtimes[0]?.submits.length === 1)

      const restartedApp = createAgentWorkflowApp({
        sessionRunner: createFakeRunner().runner,
      })
      const transcriptRes = await restartedApp.request(
        `/api/beegame-sessions/${session.id}/transcript?workspacePath=${encodeURIComponent(workspace)}`,
      )
      expect(transcriptRes.status).toBe(200)
      const transcript = await transcriptRes.json()
      expect(transcript).toContainEqual(expect.objectContaining({
        type: 'tool.completed',
        text: 'Subagent completed',
      }))
      expect(transcript).toContainEqual(expect.objectContaining({
        type: 'assistant.message',
        text: 'Subagent audit found the core loop issue.',
      }))
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('sanitizes legacy branding from dashboard events and payloads', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const legacyTitle = ['Clau', 'de'].join('')
    const legacyLower = ['clau', 'de'].join('')
    const legacyPath = join(
      workspace,
      `${legacyLower}-code-main`,
      'Projects',
      'game.ts',
    )
    const fake = createFakeRunner([
      {
        type: 'assistant',
        message: {
          content: [{
            type: 'text',
            text: `${legacyTitle} Code created this in ${legacyPath}. Run ${legacyLower} snake.`,
          }],
          [`${legacyLower}_code_version`]: '2.8.0',
        },
      },
      {
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'tool_path',
            name: 'Write',
            input: {
              file_path: legacyPath,
              command: `cd ${legacyPath} && ${legacyLower} status`,
            },
          }],
        },
      },
      { type: 'result', result: `${legacyTitle} finished` },
    ], 'messages')
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'make a game' }),
      })
      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some((event: { type: string }) => event.type === 'turn.completed')
      })

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const serialized = JSON.stringify(await eventsRes.json())
      expect(serialized).not.toContain(legacyTitle)
      expect(serialized).toContain(
        `BeeGame created this in ${legacyPath}. Run BeeGame snake.`,
      )
      expect(serialized).toContain('beegame_version')
      expect(serialized).toContain(`"file_path":"${legacyPath}"`)
      expect(serialized).toContain(`cd ${legacyPath} && ${legacyLower} status`)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('stops a running dashboard session', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner()
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/console/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()
      await app.request(`/api/console/sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Build a tiny puzzle game.' }),
      })
      await waitFor(() => fake.runtimes.length === 1)

      const stopRes = await app.request(
        `/api/console/sessions/${session.id}/stop`,
        { method: 'POST' },
      )

      expect(stopRes.status).toBe(200)
      expect(fake.runtimes[0].stops).toEqual(['stop'])
      expect(await stopRes.json()).toEqual(
        expect.objectContaining({ status: 'stopped', turnStatus: 'idle' }),
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('derives stopped runtime snapshot for an interrupted turn', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner(undefined, 'dangerous_bash_permission')
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()
      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Build a tiny puzzle game.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(
          `/api/beegame-sessions/${session.id}/events`,
        )
        const events = await eventsRes.json()
        return events.some((event: { type: string }) => event.type === 'permission.requested')
      })

      const stopRes = await app.request(
        `/api/beegame-sessions/${session.id}/stop`,
        { method: 'POST' },
      )
      expect(stopRes.status).toBe(200)

      const snapshotRes = await app.request(
        `/api/beegame-sessions/${session.id}/runtime-snapshot?workspacePath=${encodeURIComponent(workspace)}`,
      )
      const snapshot = await snapshotRes.json()

      expect(snapshotRes.status).toBe(200)
      expect(snapshot).toEqual(expect.objectContaining({
        phaseName: 'idle',
        phaseStatus: 'idle',
      }))
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('keeps a turn running until a dashboard permission is approved', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner(undefined, 'dangerous_bash_permission')
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/console/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()
      await app.request(`/api/console/sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Run tests.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(
          `/api/console/sessions/${session.id}/events`,
        )
        const events = await eventsRes.json()
        return events.some(
          (event: { type: string }) => event.type === 'permission.requested',
        )
      })

      let sessionStateRes = await app.request(
        `/api/console/sessions/${session.id}`,
      )
      expect(await sessionStateRes.json()).toEqual(
        expect.objectContaining({ turnStatus: 'running' }),
      )

      const resolveRes = await app.request(
        `/api/console/sessions/${session.id}/permissions/tool_1`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ decision: 'allow' }),
        },
      )

      expect(resolveRes.status).toBe(200)
      await waitFor(() => fake.runtimes[0]?.permissionResults[0] === 'allow')
      await waitFor(async () => {
        sessionStateRes = await app.request(
          `/api/console/sessions/${session.id}`,
        )
        const sessionState = await sessionStateRes.json()
        return sessionState.turnStatus === 'idle'
      })

      const eventsRes = await app.request(
        `/api/console/sessions/${session.id}/events`,
      )
      const events = await eventsRes.json()
      expect(events.map((event: { type: string }) => event.type)).toContain(
        'permission.resolved',
      )
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'result', text: 'permission allow' }),
      ]))
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('does not reuse remembered approval for a different Bash command', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner(undefined, 'dangerous_bash_twice')
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Run tests.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(
          `/api/beegame-sessions/${session.id}/events`,
        )
        const events = await eventsRes.json()
        return events.some(
          (event: { type: string; payload?: { toolUseID?: string } }) =>
            event.type === 'permission.requested' &&
            event.payload?.toolUseID === 'tool_1',
        )
      })

      const resolveRes = await app.request(
        `/api/beegame-sessions/${session.id}/permissions/tool_1`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ decision: 'allow', remember: true }),
        },
      )
      expect(resolveRes.status).toBe(200)

      await waitFor(async () => {
        const eventsRes = await app.request(
          `/api/beegame-sessions/${session.id}/events`,
        )
        const events = await eventsRes.json()
        return events.some(
          (event: { type: string; payload?: { toolUseID?: string } }) =>
            event.type === 'permission.requested' &&
            event.payload?.toolUseID === 'tool_2',
        )
      })
      expect(fake.runtimes[0].permissionResults).toEqual(['allow'])

      const eventsRes = await app.request(
        `/api/beegame-sessions/${session.id}/events`,
      )
      const events = await eventsRes.json()
      const permissionRequests = events.filter(
        (event: { type: string }) => event.type === 'permission.requested',
      )
      expect(permissionRequests).toHaveLength(2)
      expect(
        events.some(
          (event: { type: string; payload?: { toolUseID?: string; autoApproved?: boolean } }) =>
            event.type === 'permission.resolved' &&
            event.payload?.toolUseID === 'tool_2' &&
            event.payload?.autoApproved === true,
        ),
      ).toBe(false)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('auto-approves low-risk build and test Bash commands inside the BeeGame workspace', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'permission_twice')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Run project validation.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return fake.runtimes[0]?.permissionResults.length === 2 ||
          events.some((event: { type: string }) => event.type === 'permission.requested')
      })

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.runtimes[0].permissionResults).toEqual(['allow', 'allow'])
      expect(events.filter((event: { type: string }) => event.type === 'permission.requested')).toHaveLength(0)
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'permission.resolved',
          payload: expect.objectContaining({
            toolUseID: 'tool_1',
            toolName: 'Bash',
            autoApproved: true,
          }),
        }),
        expect.objectContaining({
          type: 'permission.resolved',
          payload: expect.objectContaining({
            toolUseID: 'tool_2',
            toolName: 'Bash',
            autoApproved: true,
          }),
        }),
      ]))
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('auto-approves workspace validation Bash pipelines without permission prompts', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'workspace_bash_pipeline')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Run project validation.' }),
      })

      await waitFor(() => fake.runtimes[0]?.permissionResults.length === 3)

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.runtimes[0].permissionResults).toEqual(['allow', 'allow', 'allow'])
      expect(events.filter((event: { type: string }) => event.type === 'permission.requested')).toHaveLength(0)
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('auto-approves workspace-local dependency cleanup Bash commands', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'workspace_bash_cleanup')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Repair dependencies.' }),
      })

      await waitFor(() => fake.runtimes[0]?.permissionResults.length === 1)

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.runtimes[0].permissionResults).toEqual(['allow'])
      expect(events.filter((event: { type: string }) => event.type === 'permission.requested')).toHaveLength(0)
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('auto-approves unknown workspace-local Bash commands without package manager keywords', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'workspace_unknown_bash')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Run the project-local checker.' }),
      })

      await waitFor(() => fake.runtimes[0]?.permissionResults.length === 1)

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.runtimes[0].permissionResults).toEqual(['allow'])
      expect(events.filter((event: { type: string }) => event.type === 'permission.requested')).toHaveLength(0)
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('auto-approves project-local implementation writes during build', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'project_write')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Implement game files.' }),
      })

      await waitFor(() => fake.runtimes[0]?.permissionResults.length === 1)

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.runtimes[0].permissionResults).toEqual(['allow'])
      expect(events.filter((event: { type: string }) => event.type === 'permission.requested')).toHaveLength(0)
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'permission.resolved',
          payload: expect.objectContaining({
              toolUseID: 'tool_write_before_spec',
            toolName: 'Write',
            autoApproved: true,
          }),
        }),
      ]))
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('auto-approves low-risk Bash and read-only tools without remember prompts', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'permission_different_tool')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Run and inspect.' }),
      })

      await waitFor(() => fake.runtimes[0]?.permissionResults.length === 2)
      expect(fake.runtimes[0].permissionResults).toEqual(['allow', 'allow'])

      const eventsRes = await app.request(
        `/api/beegame-sessions/${session.id}/events`,
      )
      const events = await eventsRes.json()
      expect(
        events.filter((event: { type: string }) => event.type === 'permission.requested'),
      ).toHaveLength(0)
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'permission.resolved',
            payload: expect.objectContaining({
              toolUseID: 'tool_2',
              toolName: 'Read',
              autoApproved: true,
            }),
          }),
        ]),
      )
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('auto-approves project-local writes without a BeeGame spec gate', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'project_write')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Create snake game immediately.' }),
      })

      await waitFor(() => fake.runtimes[0]?.permissionResults.length === 1)

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.runtimes[0].permissionResults).toEqual(['allow'])
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'permission.resolved',
            payload: expect.objectContaining({
              toolUseID: 'tool_write_before_spec',
              toolName: 'Write',
              autoApproved: true,
            }),
          }),
        ]),
      )
      expect(events.some((event: { type: string }) => event.type === 'permission.requested')).toBe(false)
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('runs a direct runtime turn with one QueryEngine-backed session', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'build_write')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Build a small game.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some((event: { type: string }) => event.type === 'turn.completed')
      })

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.runtimes[0].submits[0].prompt).toBe('Build a small game.')
      expect(fake.starts).toHaveLength(1)
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'permission.resolved',
            payload: expect.objectContaining({
              toolUseID: 'tool_build_write',
              toolName: 'Write',
              autoApproved: true,
            }),
          }),
        ]),
      )
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('allows the runtime agent to write markdown documents under project docs', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'project_doc_write')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Write project notes.' }),
      })

      await waitFor(() => fake.runtimes[0]?.permissionResults.length > 0)

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.runtimes[0].permissionResults).toContain('allow')
      await expect(readFile(join(workspace, 'docs', 'NOTES.md'), 'utf8')).resolves.toContain(
        'Notes',
      )
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('auto-denies writes to sibling projects inside the configured workspace root', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'sibling_project_doc_write')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Write project notes elsewhere.' }),
      })

      await waitFor(() => fake.runtimes[0]?.permissionResults.length === 1)

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.runtimes[0].permissionResults).toEqual(['deny'])
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'permission.resolved',
            payload: expect.objectContaining({
              toolUseID: 'tool_wrong_project_design_doc',
              toolName: 'Write',
              decision: 'deny',
              autoDenied: true,
            }),
          }),
        ]),
      )
      expect(events.some((event: { type: string }) => event.type === 'permission.requested')).toBe(false)
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('allows project-local implementation writes in the same runtime turn', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'project_code_write')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Write project code.' }),
      })

      await waitFor(() => fake.runtimes[0]?.permissionResults.length === 1)

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.runtimes[0].permissionResults).toEqual(['allow'])
      expect(fake.starts).toHaveLength(1)
      expect(fake.runtimes[0].submits[0].prompt).not.toContain('Now implement the approved playable spec')
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'permission.resolved',
            payload: expect.objectContaining({
              toolUseID: 'tool_same_turn_code_write',
              toolName: 'Write',
              autoApproved: true,
            }),
          }),
        ]),
      )
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('does not apply read-doc gating to result-only turns but marks them as empty', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'result_only')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Build without reading docs.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some(
          (event: { type: string; text: string }) =>
            event.type === 'turn.empty',
        )
      })

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(events.some((event: { type: string }) => event.type === 'turn.completed')).toBe(false)
      expect(events.some((event: { type: string }) => event.type === 'turn.empty')).toBe(true)
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('allows the runtime agent to write project docs using an absolute workspace path', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'project_absolute_doc_write')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Write project doc.' }),
      })

      await waitFor(() => fake.runtimes[0]?.permissionResults.length > 0)

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.runtimes[0].permissionResults).toEqual(['allow'])
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'permission.resolved',
            payload: expect.objectContaining({
              toolUseID: 'tool_write_project_doc',
              toolName: 'Write',
              decision: 'allow',
              autoApproved: true,
            }),
          }),
        ]),
      )
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('auto-approves project setup Bash commands inside the configured workspace root', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner(undefined, 'setup_bash')
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Create snake game immediately.' }),
      })

      await waitFor(() => fake.runtimes[0]?.permissionResults.length === 1)

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.runtimes[0].permissionResults).toEqual(['allow'])
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'permission.resolved',
            payload: expect.objectContaining({
              toolUseID: 'tool_bash_before_spec',
              toolName: 'Bash',
              decision: 'allow',
              autoApproved: true,
            }),
          }),
        ]),
      )
      expect(events.some((event: { type: string }) => event.type === 'permission.requested')).toBe(false)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('auto-denies permissions to sibling projects inside the configured workspace root', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const workspace = join(projectsRoot, 'current-project')
    const existingProject = join(projectsRoot, 'existing-project')
    const fake = createFakeRunner(undefined, 'workspace_root_permission')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      await mkdir(existingProject, { recursive: true })
      await mkdir(workspace, { recursive: true })
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Modify existing project.' }),
      })

      await waitFor(() => fake.runtimes[0]?.permissionResults.length === 1)

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.runtimes[0].permissionResults).toEqual(['deny'])
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'permission.resolved',
            payload: expect.objectContaining({
              toolUseID: 'tool_workspace_root_write',
              toolName: 'Write',
              decision: 'deny',
              autoDenied: true,
            }),
          }),
        ]),
      )
      expect(events.some((event: { type: string }) => event.type === 'permission.requested')).toBe(false)
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('auto-denies permissions that target paths outside the configured workspace root', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner(undefined, 'outside_permission')
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Write outside.' }),
      })

      await waitFor(() => fake.runtimes[0]?.permissionResults[0] === 'deny')

      const eventsRes = await app.request(
        `/api/beegame-sessions/${session.id}/events`,
      )
      const events = await eventsRes.json()
      expect(
        events.some((event: { type: string }) => event.type === 'permission.requested'),
      ).toBe(false)
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'permission.resolved',
            payload: expect.objectContaining({
              toolUseID: 'tool_outside',
              decision: 'deny',
              autoDenied: true,
            }),
          }),
        ]),
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('auto-denies Bash permissions that reference paths outside the configured workspace root', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner(undefined, 'outside_bash_permission')
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Inspect outside.' }),
      })

      await waitFor(() => fake.runtimes[0]?.permissionResults[0] === 'deny')

      const eventsRes = await app.request(
        `/api/beegame-sessions/${session.id}/events`,
      )
      const events = await eventsRes.json()
      expect(
        events.some((event: { type: string }) => event.type === 'permission.requested'),
      ).toBe(false)
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'permission.resolved',
            payload: expect.objectContaining({
              toolUseID: 'tool_outside_bash',
              toolName: 'Bash',
              decision: 'deny',
              autoDenied: true,
            }),
          }),
        ]),
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('auto-allows AskUserQuestion without creating a dashboard permission gate', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner(undefined, 'ask_user_question_permission')
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Need more details.' }),
      })

      await waitFor(() => fake.runtimes[0]?.permissionResults[0] === 'allow')

      const eventsRes = await app.request(
        `/api/beegame-sessions/${session.id}/events`,
      )
      const events = await eventsRes.json()
      expect(
        events.some((event: { type: string }) => event.type === 'permission.requested'),
      ).toBe(false)
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'permission.resolved',
            payload: expect.objectContaining({
              toolUseID: 'tool_question',
              toolName: 'AskUserQuestion',
              decision: 'allow',
              autoApproved: true,
            }),
          }),
          expect.objectContaining({
            type: 'result',
            text: 'question allow',
          }),
        ]),
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('reads artifact files from inside the session workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner()
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      await writeFile(join(workspace, 'artifact.txt'), 'artifact content')
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      const artifactRes = await app.request(
        `/api/beegame-sessions/${session.id}/artifacts?path=artifact.txt`,
      )

      expect(artifactRes.status).toBe(200)
      expect(await artifactRes.json()).toEqual({
        path: 'artifact.txt',
        content: 'artifact content',
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('reads platform-neutral asset contracts from the project workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-assets-'))
    const app = createAgentWorkflowApp({ sessionRunner: createFakeRunner().runner })
    try {
      await mkdir(join(workspace, 'assets'), { recursive: true })
      await writeFile(
        join(workspace, 'assets', 'asset-manifest.json'),
        JSON.stringify({
          version: 1,
          project_target: {
            kind: 'game_engine',
            engine: 'unity',
            integration_mode: 'mcp',
            mcp_server: 'unity-mcp',
          },
          slots: [{
            id: 'player_model',
            name: 'Player model',
            type: 'model_3d',
            purpose: 'Playable character',
            required: true,
            accepted_formats: ['glb', 'fbx'],
            target: {
              integration_notes: 'Replace the placeholder character model.',
            },
            integration_provider: {
              type: 'mcp',
              server: 'unity-mcp',
              capabilities: ['import_asset', 'replace_prefab_mesh'],
            },
          }],
        }),
      )

      const res = await app.request(
        `/api/beegame-sessions/beegame_assets/assets?workspacePath=${encodeURIComponent(workspace)}`,
      )

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual(expect.objectContaining({
        project_target: expect.objectContaining({
          integration_mode: 'mcp',
          mcp_server: 'unity-mcp',
        }),
        slots: [expect.objectContaining({
          id: 'player_model',
          type: 'model_3d',
          integration_provider: expect.objectContaining({
            type: 'mcp',
            server: 'unity-mcp',
          }),
        })],
      }))
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('normalizes nested asset manifests generated by agents into asset slots', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-assets-legacy-'))
    const app = createAgentWorkflowApp({ sessionRunner: createFakeRunner().runner })
    try {
      await mkdir(join(workspace, 'assets'), { recursive: true })
      await writeFile(
        join(workspace, 'assets', 'asset-manifest.json'),
        JSON.stringify({
          project: 'draw-guess',
          version: '1.0.0',
          assets: {
            images: [{
              id: 'img_logo',
              type: 'image',
              description: 'Game logo',
              placeholder: 'Text title',
              format: ['svg', 'png'],
              path: 'client/src/components/HomePage.tsx',
              status: 'placeholder',
            }],
            audio: {
              sfx: [{
                id: 'sfx_correct',
                type: 'audio',
                category: 'sfx',
                description: 'Correct guess',
                format: ['mp3', 'ogg'],
                path: 'client/public/audio/sfx/correct.mp3',
                status: 'missing',
              }],
            },
            data: [{
              id: 'data_words',
              type: 'data',
              description: 'Word list',
              format: 'json',
              path: 'server/words.json',
              status: 'implemented',
            }],
          },
        }),
      )

      const res = await app.request(
        `/api/beegame-sessions/beegame_assets_legacy/assets?workspacePath=${encodeURIComponent(workspace)}`,
      )
      const payload = await res.json()

      expect(res.status).toBe(200)
      expect(payload.slots).toEqual([
        expect.objectContaining({
          id: 'img_logo',
          type: 'image',
          purpose: 'Game logo',
          accepted_formats: ['svg', 'png'],
          target: expect.objectContaining({ path: 'client/src/components/HomePage.tsx' }),
          status: 'placeholder',
        }),
        expect.objectContaining({
          id: 'sfx_correct',
          type: 'audio',
          purpose: 'Correct guess',
          accepted_formats: ['mp3', 'ogg'],
          target: expect.objectContaining({ path: 'client/public/audio/sfx/correct.mp3' }),
          status: 'missing',
        }),
        expect.objectContaining({
          id: 'data_words',
          type: 'data',
          purpose: 'Word list',
          accepted_formats: ['json'],
          target: expect.objectContaining({ path: 'server/words.json' }),
          status: 'integrated',
        }),
      ])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('uploads asset files into the project workspace and updates the contract manifest', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-assets-upload-'))
    const app = createAgentWorkflowApp({ sessionRunner: createFakeRunner().runner })
    try {
      await mkdir(join(workspace, 'assets'), { recursive: true })
      await writeFile(
        join(workspace, 'assets', 'asset-manifest.json'),
        JSON.stringify({
          version: 1,
          project_target: { kind: 'web', engine: 'react', integration_mode: 'filesystem' },
          slots: [{
            id: 'main_logo',
            name: 'Main logo',
            type: 'image_2d',
            purpose: 'Title screen logo',
            target: { path: 'public/assets/logo.png' },
          }],
        }),
      )
      const form = new FormData()
      form.set('file', new File(['logo-bytes'], 'logo.png', { type: 'image/png' }))

      const res = await app.request(
        `/api/beegame-sessions/beegame_assets_upload/assets/main_logo/upload?workspacePath=${encodeURIComponent(workspace)}`,
        { method: 'POST', body: form },
      )
      const payload = await res.json()
      const written = await readFile(join(workspace, 'public', 'assets', 'logo.png'), 'utf8')
      const manifest = JSON.parse(await readFile(join(workspace, 'assets', 'asset-manifest.json'), 'utf8'))

      expect(res.status).toBe(200)
      expect(written).toBe('logo-bytes')
      expect(payload).toEqual(expect.objectContaining({
        path: 'public/assets/logo.png',
        slot: expect.objectContaining({
          id: 'main_logo',
          status: 'uploaded',
          placeholder: false,
          uploaded_files: ['public/assets/logo.png'],
        }),
      }))
      expect(payload.message).toContain('Use normal project files and commands')
      expect(payload.message).toContain('not considered integrated')
      expect(manifest.slots[0]).toEqual(expect.objectContaining({
        status: 'uploaded',
        uploaded_files: ['public/assets/logo.png'],
      }))
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('packages the session workspace as a downloadable zip without dependencies', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner()
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      await mkdir(join(workspace, 'docs'), { recursive: true })
      await mkdir(join(workspace, 'src'), { recursive: true })
      await mkdir(join(workspace, 'node_modules', 'ignored'), { recursive: true })
      await writeFile(join(workspace, 'docs', 'GDD.md'), '# GDD')
      await writeFile(join(workspace, 'src', 'main.ts'), 'export {}')
      await writeFile(join(workspace, 'node_modules', 'ignored', 'index.js'), '')
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      const packageRes = await app.request(
        `/api/beegame-sessions/${session.id}/package`,
      )
      const bytes = new Uint8Array(await packageRes.arrayBuffer())
      const listingText = new TextDecoder().decode(bytes)

      expect(packageRes.status).toBe(200)
      expect(packageRes.headers.get('content-type')).toBe('application/zip')
      expect(packageRes.headers.get('content-disposition')).toContain(
        `${basename(workspace)}.zip`,
      )
      expect(bytes[0]).toBe(0x50)
      expect(bytes[1]).toBe(0x4b)
      expect(listingText).toContain('docs/GDD.md')
      expect(listingText).toContain('src/main.ts')
      expect(listingText).not.toContain('node_modules')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('packages a workspace from query params after the in-memory session is gone', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner()
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      await mkdir(join(workspace, 'docs'), { recursive: true })
      await writeFile(join(workspace, 'docs', 'GDD.md'), '# GDD')

      const packageRes = await app.request(
        `/api/beegame-sessions/beegame_missing/package?workspacePath=${encodeURIComponent(workspace)}`,
      )
      const bytes = new Uint8Array(await packageRes.arrayBuffer())
      const listingText = new TextDecoder().decode(bytes)

      expect(packageRes.status).toBe(200)
      expect(packageRes.headers.get('content-type')).toBe('application/zip')
      expect(bytes[0]).toBe(0x50)
      expect(bytes[1]).toBe(0x4b)
      expect(listingText).toContain('docs/GDD.md')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('reports unsupported preview when a project has no web entrypoint', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const app = createAgentWorkflowApp({ sessionRunner: createFakeRunner().runner })
    try {
      const previewRes = await app.request(
        `/api/beegame-sessions/beegame_preview/preview`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ workspacePath: workspace }),
        },
      )
      const preview = await previewRes.json()

      expect(previewRes.status).toBe(200)
      expect(preview).toEqual(expect.objectContaining({
        sessionId: 'beegame_preview',
        status: 'unsupported',
        url: '',
      }))
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('starts a managed preview process for package script projects', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const starts: Array<{ command: string[]; cwd: string; env: Record<string, string> }> = []
    const kills: string[] = []
    const previewRunner: BeeGamePreviewRunner = (command, options) => {
      starts.push({ command, cwd: options.cwd, env: options.env })
      options.onOutput('Local: http://127.0.0.1:63100/\n')
      return {
        kill: () => kills.push(command.join(' ')),
        exited: new Promise(() => {}),
      }
    }
    const app = createAgentWorkflowApp({
      sessionRunner: createFakeRunner().runner,
      previewRunner,
      previewPortAllocator: async () => 63100,
      previewReadinessProbe: async () => true,
    })
    try {
      await writeFile(
        join(workspace, 'package.json'),
        JSON.stringify({
          scripts: { dev: 'vite --host 0.0.0.0' },
          devDependencies: { vite: '^6.0.0' },
        }),
      )

      const startRes = await app.request(
        `/api/beegame-sessions/beegame_preview/preview`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ workspacePath: workspace }),
        },
      )
      const started = await startRes.json()
      const statusRes = await app.request(
        `/api/beegame-sessions/beegame_preview/preview?workspacePath=${encodeURIComponent(workspace)}`,
      )
      const status = await statusRes.json()
      const stopRes = await app.request(
        `/api/beegame-sessions/beegame_preview/preview?workspacePath=${encodeURIComponent(workspace)}`,
        { method: 'DELETE' },
      )
      const stopped = await stopRes.json()

      expect(startRes.status).toBe(200)
      expect(started).toEqual(expect.objectContaining({
        status: 'running',
        url: 'http://127.0.0.1:63100/',
        script: 'dev',
      }))
      expect(status).toEqual(expect.objectContaining({
        status: 'running',
        url: 'http://127.0.0.1:63100/',
      }))
      expect(stopped).toEqual(expect.objectContaining({ status: 'stopped' }))
      expect(starts).toHaveLength(1)
      expect(starts[0].cwd).toBe(resolve(workspace))
      expect(starts[0].command).toEqual([
        'npm',
        'run',
        'dev',
        '--',
        '--host',
        '127.0.0.1',
        '--port',
        '63100',
      ])
      expect(starts[0].env.PORT).toBe('63100')
      expect(kills).toHaveLength(1)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('starts client and server processes for split multiplayer web projects', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-fullstack-'))
    const starts: Array<{ command: string[]; cwd: string; env: Record<string, string> }> = []
    const kills: string[] = []
    const probedUrls: string[] = []
    let nextPort = 63100
    const previewRunner: BeeGamePreviewRunner = (command, options) => {
      starts.push({ command, cwd: options.cwd, env: options.env })
      options.onOutput(`Local: http://127.0.0.1:${options.env.PORT}/\n`)
      return {
        kill: () => kills.push(`${options.cwd}:${command.join(' ')}`),
        exited: new Promise(() => {}),
      }
    }
    const app = createAgentWorkflowApp({
      sessionRunner: createFakeRunner().runner,
      previewRunner,
      previewPortAllocator: async () => nextPort++,
      previewReadinessProbe: async url => {
        probedUrls.push(url)
        return ['http://127.0.0.1:63100/', 'http://127.0.0.1:63101/'].includes(url)
      },
    })
    try {
      await mkdir(join(workspace, 'client'), { recursive: true })
      await mkdir(join(workspace, 'server'), { recursive: true })
      await writeFile(
        join(workspace, 'package.json'),
        JSON.stringify({
          scripts: {
            'dev:client': 'cd client && npm run dev',
            'dev:server': 'cd server && npm run dev',
            start: 'cd server && npm start',
          },
        }),
      )
      await writeFile(
        join(workspace, 'client', 'package.json'),
        JSON.stringify({
          scripts: { dev: 'vite' },
          devDependencies: { vite: '^6.0.0' },
        }),
      )
      await writeFile(
        join(workspace, 'server', 'package.json'),
        JSON.stringify({
          scripts: { dev: 'tsx watch src/index.ts', start: 'tsx src/index.ts' },
          dependencies: { express: '^4.21.0', ws: '^8.18.0' },
        }),
      )

      const startRes = await app.request(
        `/api/beegame-sessions/beegame_fullstack_preview/preview`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ workspacePath: workspace }),
        },
      )
      const started = await startRes.json()
      const stopRes = await app.request(
        `/api/beegame-sessions/beegame_fullstack_preview/preview?workspacePath=${encodeURIComponent(workspace)}`,
        { method: 'DELETE' },
      )
      const stopped = await stopRes.json()

      expect(startRes.status).toBe(200)
      expect(started).toEqual(expect.objectContaining({
        status: 'running',
        url: 'http://127.0.0.1:63101/',
        script: 'dev',
        entrypoint: 'client/package.json',
      }))
      expect(starts).toHaveLength(2)
      expect(starts[0]).toEqual(expect.objectContaining({
        cwd: resolve(workspace, 'server'),
        command: ['npm', 'run', 'dev'],
      }))
      expect(starts[0].env.PORT).toBe('63100')
      expect(starts[1]).toEqual(expect.objectContaining({
        cwd: resolve(workspace, 'client'),
        command: ['npm', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', '63101'],
      }))
      expect(starts[1].env.PORT).toBe('63101')
      expect(starts[1].env.VITE_WS_URL).toBe('ws://127.0.0.1:63100')
      expect(starts[1].env.VITE_API_URL).toBe('http://127.0.0.1:63100')
      expect(starts[1].env.VITE_SERVER_URL).toBe('http://127.0.0.1:63100')
      expect(starts[1].env.VITE_BACKEND_URL).toBe('http://127.0.0.1:63100')
      expect(probedUrls).toEqual(['http://127.0.0.1:63100/', 'http://127.0.0.1:63101/'])
      expect(stopped).toEqual(expect.objectContaining({ status: 'stopped' }))
      expect(kills).toHaveLength(2)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('does not mark split previews running when the backend is unreachable', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-fullstack-unreachable-'))
    const kills: string[] = []
    let nextPort = 63100
    const previewRunner: BeeGamePreviewRunner = (command, options) => {
      options.onOutput(`Local: http://127.0.0.1:${options.env.PORT}/\n`)
      return {
        kill: () => kills.push(`${options.cwd}:${command.join(' ')}`),
        exited: new Promise(() => {}),
      }
    }
    const app = createAgentWorkflowApp({
      sessionRunner: createFakeRunner().runner,
      previewRunner,
      previewPortAllocator: async () => nextPort++,
      previewReadinessProbe: async url => url === 'http://127.0.0.1:63101/',
    })
    try {
      await mkdir(join(workspace, 'client'), { recursive: true })
      await mkdir(join(workspace, 'server'), { recursive: true })
      await writeFile(
        join(workspace, 'package.json'),
        JSON.stringify({ scripts: { start: 'cd server && npm start' } }),
      )
      await writeFile(
        join(workspace, 'client', 'package.json'),
        JSON.stringify({
          scripts: { dev: 'vite' },
          devDependencies: { vite: '^6.0.0' },
        }),
      )
      await writeFile(
        join(workspace, 'server', 'package.json'),
        JSON.stringify({
          scripts: { start: 'node src/index.js' },
          dependencies: { express: '^4.21.0' },
        }),
      )

      const startRes = await app.request(
        `/api/beegame-sessions/beegame_fullstack_unreachable_preview/preview`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ workspacePath: workspace }),
        },
      )
      const started = await startRes.json()

      expect(startRes.status).toBe(200)
      expect(started).toEqual(expect.objectContaining({
        status: 'failed',
        url: '',
      }))
      expect(started.message).toContain('Backend server did not become reachable')
      expect(kills).toHaveLength(2)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('does not expose a preview URL until the managed preview is reachable', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const kills: string[] = []
    const previewRunner: BeeGamePreviewRunner = (command, options) => {
      options.onOutput('Local: http://127.0.0.1:63100/\n')
      return {
        kill: () => kills.push(command.join(' ')),
        exited: new Promise(() => {}),
      }
    }
    const app = createAgentWorkflowApp({
      sessionRunner: createFakeRunner().runner,
      previewRunner,
      previewPortAllocator: async () => 63100,
      previewReadinessProbe: async () => false,
    })
    try {
      await writeFile(
        join(workspace, 'package.json'),
        JSON.stringify({
          scripts: { preview: 'vite preview' },
          devDependencies: { vite: '^6.0.0' },
        }),
      )

      const startRes = await app.request(
        `/api/beegame-sessions/beegame_preview_unready/preview`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ workspacePath: workspace }),
        },
      )
      const started = await startRes.json()

      expect(startRes.status).toBe(200)
      expect(started).toEqual(expect.objectContaining({
        status: 'failed',
        url: '',
      }))
      expect(started.message).toContain('did not become reachable')
      expect(kills).toHaveLength(1)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('persists BeeGame runtime snapshot for usage phase and model across app instances', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const workspace = join(projectsRoot, 'snapshot-game')
    await mkdir(workspace, { recursive: true })
    const model = createModelConfig(DEFAULT_LOCAL_USER_ID, {
      name: 'Snapshot LLM',
      provider: 'openai-compatible',
      baseUrl: 'https://llm.example.invalid/v1',
      apiKey: 'sk-dashboard-secret',
      models: { balanced: 'snapshot-balanced' },
    })
    const fake = createFakeRunner([
      {
        type: 'result',
        result: 'Done',
        usage: {
          input_tokens: 123,
          output_tokens: 45,
          total_tokens: 168,
        },
      },
    ])
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspacePath: workspace,
          modelConfigId: model.id,
        }),
      })
      const session = await sessionRes.json()
      expect(session.modelConfigId).toBe(model.id)
      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Build game.' }),
      })
      await waitFor(async () => {
        const snapshotRes = await app.request(
          `/api/beegame-sessions/${session.id}/runtime-snapshot?workspacePath=${encodeURIComponent(workspace)}`,
        )
        const snapshot = await snapshotRes.json()
        return snapshot?.usage?.total_tokens === 168
      })
      const liveSnapshotRes = await app.request(
        `/api/beegame-sessions/${session.id}/runtime-snapshot?workspacePath=${encodeURIComponent(workspace)}`,
      )
      const liveSnapshot = await liveSnapshotRes.json()
      expect(liveSnapshot.modelConfigId).toBe(model.id)
      const persistedSnapshot = JSON.parse(
        await readFile(join(projectsRoot, 'snapshots', `${session.id}.json`), 'utf8'),
      )
      expect(persistedSnapshot.modelConfigId).toBe(model.id)

      const restartedApp = createAgentWorkflowApp({
        sessionRunner: createFakeRunner().runner,
        defaultWorkspacePath: projectsRoot,
      })
      const snapshotRes = await restartedApp.request(
        `/api/beegame-sessions/${session.id}/runtime-snapshot?workspacePath=${encodeURIComponent(workspace)}`,
      )
      const snapshot = await snapshotRes.json()

      expect(snapshotRes.status).toBe(200)
      expect(snapshot).toEqual(expect.objectContaining({
        sessionId: session.id,
        workspacePath: await realpath(workspace),
        modelConfigId: model.id,
        phaseName: 'idle',
      }))
      expect(snapshot.usage).toEqual({
        prompt_tokens: 123,
        completion_tokens: 45,
        total_tokens: 168,
      })
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('rejects artifact reads outside the session workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner()
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      const artifactRes = await app.request(
        `/api/beegame-sessions/${session.id}/artifacts?path=../outside.txt`,
      )

      expect(artifactRes.status).toBe(400)
      expect(await artifactRes.json()).toEqual({
        error: 'Artifact path must stay inside the session workspace',
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('deletes session-created project directories without deleting the workspace root', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const gameDir = join(workspace, 'snake-game')
    const keepDir = join(workspace, 'keep-me')
    const fake = createFakeRunner([
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool_write_package',
              name: 'Write',
              input: {
                file_path: join(gameDir, 'package.json'),
                content: '{}',
              },
            },
          ],
        },
      },
      { type: 'result', result: 'Done' },
    ])
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      await mkdir(gameDir, { recursive: true })
      await mkdir(keepDir, { recursive: true })
      await writeFile(join(gameDir, 'package.json'), '{}')
      await writeFile(join(keepDir, 'note.txt'), 'keep')

      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()
      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Create snake game.' }),
      })
      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some((event: { type: string }) => event.type === 'turn.completed')
      })

      const deleteRes = await app.request(
        `/api/beegame-sessions/${session.id}?deleteArtifacts=1`,
        { method: 'DELETE' },
      )

      expect(deleteRes.status).toBe(200)
      expect(await deleteRes.json()).toEqual({
        deleted: true,
        deletedArtifactPaths: [gameDir],
      })
      await expect(stat(gameDir)).rejects.toThrow()
      await expect(stat(keepDir)).resolves.toEqual(expect.anything())
      await expect(stat(workspace)).resolves.toEqual(expect.anything())
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('deletes the active session workspace directory when it is a project under Projects', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const workspace = join(projectsRoot, 'project-one')
    const fake = createFakeRunner([{ type: 'result', result: 'Done' }])
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      await mkdir(workspace, { recursive: true })
      await writeFile(join(workspace, 'README.md'), 'project')
      const resolvedWorkspace = await realpath(workspace)

      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      const deleteRes = await app.request(
        `/api/beegame-sessions/${session.id}?deleteArtifacts=1`,
        { method: 'DELETE' },
      )

      expect(deleteRes.status).toBe(200)
      const result = await deleteRes.json()
      expect(result.deleted).toBe(true)
      expect(result.deletedArtifactPaths).toEqual([resolvedWorkspace])
      await expect(stat(workspace)).rejects.toThrow()
      await expect(stat(projectsRoot)).resolves.toEqual(expect.anything())
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('deletes project directories from transcript after backend restart loses the session', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const resolvedWorkspace = await realpath(workspace)
    const sessionId = 'beegame_transcript_only'
    const gameDir = join(resolvedWorkspace, 'snake-game')
    const transcriptPath = getTestTranscriptPath(resolvedWorkspace, resolvedWorkspace, sessionId)
    const app = createAgentWorkflowApp({
      sessionRunner: createFakeRunner().runner,
      defaultWorkspacePath: resolvedWorkspace,
    })
    try {
      await mkdir(gameDir, { recursive: true })
      await mkdir(dirname(transcriptPath), { recursive: true })
      await writeFile(join(gameDir, 'package.json'), '{}')
      await writeFile(
        transcriptPath,
        `${JSON.stringify({
          id: 1,
          sessionId,
          type: 'tool.started',
          text: 'Write',
          payload: {
            type: 'tool.started',
            toolUseID: 'tool_write_package',
            toolName: 'Write',
            input: {
              file_path: join(gameDir, 'package.json'),
              content: '{}',
            },
          },
          createdAt: new Date().toISOString(),
        })}\n`,
      )

      const deleteRes = await app.request(
        `/api/beegame-sessions/${sessionId}?deleteArtifacts=1`,
        { method: 'DELETE' },
      )

      expect(deleteRes.status).toBe(200)
      expect(await deleteRes.json()).toEqual({
        deleted: true,
        deletedArtifactPaths: [gameDir],
      })
      await expect(stat(gameDir)).rejects.toThrow()
      await expect(stat(workspace)).resolves.toEqual(expect.anything())
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('deletes a project workspace after backend restart loses the session', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const workspace = join(projectsRoot, 'project-after-restart')
    const sessionId = 'beegame_restart_delete_workspace'
    const app = createAgentWorkflowApp({
      sessionRunner: createFakeRunner().runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      await mkdir(workspace, { recursive: true })
      await writeFile(join(workspace, 'README.md'), 'project')
      const resolvedWorkspace = await realpath(workspace)

      const deleteRes = await app.request(
        `/api/beegame-sessions/${sessionId}?deleteArtifacts=1&workspacePath=${encodeURIComponent(workspace)}`,
        { method: 'DELETE' },
      )

      expect(deleteRes.status).toBe(200)
      const result = await deleteRes.json()
      expect(result.deleted).toBe(true)
      expect(result.deletedArtifactPaths).toEqual([resolvedWorkspace])
      await expect(stat(workspace)).rejects.toThrow()
      await expect(stat(projectsRoot)).resolves.toEqual(expect.anything())
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('treats missing project workspace as deleted after backend restart loses the session', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const workspace = join(projectsRoot, 'already-deleted-project')
    const sessionId = 'beegame_restart_delete_missing_workspace'
    const app = createAgentWorkflowApp({
      sessionRunner: createFakeRunner().runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const deleteRes = await app.request(
        `/api/beegame-sessions/${sessionId}?deleteArtifacts=1&workspacePath=${encodeURIComponent(workspace)}`,
        { method: 'DELETE' },
      )

      expect(deleteRes.status).toBe(200)
      const result = await deleteRes.json()
      expect(result.deleted).toBe(true)
      expect(result.deletedArtifactPaths).toEqual([])
      await expect(stat(projectsRoot)).resolves.toEqual(expect.anything())
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('reads transcript from disk after backend restart loses the session', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-transcript-read-'))
    const sessionId = 'beegame_transcript_read'
    const transcriptPath = getTestTranscriptPath(workspace, workspace, sessionId)
    const app = createAgentWorkflowApp({ defaultWorkspacePath: workspace })

    try {
      await mkdir(dirname(transcriptPath), { recursive: true })
      await writeFile(
        transcriptPath,
        [
          JSON.stringify({
            id: 1,
            sessionId,
            type: 'user.message',
            text: '做一个贪吃蛇',
            createdAt: '2026-06-21T00:00:01.000Z',
          }),
          JSON.stringify({
            id: 2,
            sessionId,
            type: 'assistant.message',
            text: '已生成可玩的贪吃蛇原型。',
            createdAt: '2026-06-21T00:00:02.000Z',
          }),
        ].join('\n'),
        'utf8',
      )

      const res = await app.request(
        `/api/beegame-sessions/${sessionId}/transcript?workspacePath=${encodeURIComponent(workspace)}`,
      )

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([
        expect.objectContaining({
          id: 1,
          type: 'user.message',
          text: '做一个贪吃蛇',
        }),
        expect.objectContaining({
          id: 2,
          type: 'assistant.message',
          text: '已生成可玩的贪吃蛇原型。',
        }),
      ])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('resumes backend restart sessions into the existing transcript file', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-transcript-resume-'))
    const workspace = join(projectsRoot, 'game-one')

    try {
      await mkdir(workspace, { recursive: true })
      const app = createAgentWorkflowApp({
        sessionRunner: createFakeRunner().runner,
        defaultWorkspacePath: projectsRoot,
      })
      const startRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        body: JSON.stringify({ workspacePath: workspace }),
        headers: { 'content-type': 'application/json' },
      })
      const firstSession = await startRes.json() as { id: string }
      await app.request(`/api/beegame-sessions/${firstSession.id}/input`, {
        method: 'POST',
        body: JSON.stringify({ text: 'Start the project.' }),
        headers: { 'content-type': 'application/json' },
      })
      await waitFor(async () => {
        const eventsRes = await app.request(
          `/api/beegame-sessions/${firstSession.id}/events`,
        )
        const events = await eventsRes.json()
        return events.some((event: { type: string }) =>
          event.type === 'turn.completed' || event.type === 'turn.empty'
        )
      })
      const projectTranscriptDir = join(workspace, 'transcripts')
      const initialFiles = await readdir(projectTranscriptDir)
      expect(initialFiles).toHaveLength(1)
      const transcriptPath = join(projectTranscriptDir, initialFiles[0]!)
      const initialTranscript = await readFile(transcriptPath, 'utf8')
      const initialEvents = initialTranscript.trim().split('\n')
      expect(initialEvents.length).toBeGreaterThan(0)

      const restartedApp = createAgentWorkflowApp({
        sessionRunner: createFakeRunner().runner,
        defaultWorkspacePath: projectsRoot,
      })
      const resumeRes = await restartedApp.request('/api/beegame-sessions', {
        method: 'POST',
        body: JSON.stringify({
          workspacePath: workspace,
          transcriptSessionId: firstSession.id,
        }),
        headers: { 'content-type': 'application/json' },
      })
      expect(resumeRes.status).toBe(200)
      const resumedSession = await resumeRes.json() as { id: string }
      expect(resumedSession.id).toBe(firstSession.id)

      const resumedFiles = await readdir(projectTranscriptDir)
      expect(resumedFiles).toEqual(initialFiles)
      const resumedTranscript = await readFile(transcriptPath, 'utf8')
      const resumedEvents = resumedTranscript
        .trim()
        .split('\n')
        .map(line => JSON.parse(line) as { id: number; sessionId: string; type: string })
      expect(resumedEvents.length).toBeGreaterThan(initialEvents.length)
      expect(resumedEvents.at(-1)).toEqual(expect.objectContaining({
        id: initialEvents.length + 2,
        sessionId: resumedSession.id,
        type: 'runtime.observation',
      }))

      await restartedApp.request(`/api/beegame-sessions/${resumedSession.id}/input`, {
        method: 'POST',
        body: JSON.stringify({ text: 'Continue the same project.' }),
        headers: { 'content-type': 'application/json' },
      })
      await waitFor(async () => {
        const eventsRes = await restartedApp.request(
          `/api/beegame-sessions/${resumedSession.id}/events`,
        )
        const events = await eventsRes.json()
        return events.some((event: { type: string }) =>
          event.type === 'turn.completed' || event.type === 'turn.empty'
        )
      })
      const finalTranscript = await readFile(transcriptPath, 'utf8')
      const finalEvents = finalTranscript
        .trim()
        .split('\n')
        .map(line => JSON.parse(line) as { type: string; turnId?: string })
      expect(finalEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'turn.started',
            turnId: `beegame-turn-${resumedSession.id}-1`,
          }),
          expect.objectContaining({
            type: 'turn.started',
            turnId: `beegame-turn-${resumedSession.id}-2`,
          }),
        ]),
      )
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('does not expose synthetic runtime continuation messages as user chat', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner(undefined, 'synthetic_user_message')
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Create match game.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some((event: { type: string }) => event.type === 'turn.empty')
      })

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      const userMessages = events.filter((event: { type: string }) => event.type === 'user.message')
      expect(userMessages).toEqual([
        expect.objectContaining({
          text: 'Create match game.',
        }),
      ])
      expect(JSON.stringify(events)).not.toContain('internal runtime resume marker')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const startedAt = Date.now()
  while (!(await predicate())) {
    if (Date.now() - startedAt > 1000) {
      throw new Error('Timed out waiting for condition')
    }
    await Bun.sleep(5)
  }
}
