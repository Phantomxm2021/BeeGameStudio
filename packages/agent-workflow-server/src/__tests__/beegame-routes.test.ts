import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import {
  createModelConfig,
  resetAgentWorkflow,
} from '@bee-game-studio/agent-workflow'
import {
  createAgentWorkflowApp as createAgentWorkflowAppBase,
  type AgentWorkflowAppOptions,
} from '../app'
import { DEFAULT_LOCAL_USER_ID } from '../auth/user-context'
import { listCreditLedger, reserveCredits } from '../credit-store'
import type {
  BeeGameSessionRunner,
  BeeGameSessionRunnerStartInput,
  BeeGameSessionSubmitInput,
  DashboardSDKMessage,
} from '../beegame/session-manager'
import {
  BeeGameSessionManager,
  countBashPermissionRequestsRequiringUserResolution,
  materializeBeeGameFileAttachments,
} from '../beegame/session-manager'
import type {
  BeeGameDeploymentPublisher,
  BeeGameDeploymentRunner,
} from '../beegame/deployment-manager'
import type { BeeGamePreviewRunner } from '../beegame/preview-manager'

const testDashboardRoots: string[] = []
const originalEncryptionKey = process.env.BEEGAME_CONFIG_ENCRYPTION_KEY

beforeAll(() => {
  process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 53).toString('base64')
})

afterAll(() => {
  if (originalEncryptionKey === undefined) delete process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
  else process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = originalEncryptionKey
})

type FakeRuntimeMode =
  | 'messages'
  | 'permission'
  | 'permission_twice'
  | 'permission_different_tool'
  | 'dangerous_bash_permission'
  | 'dangerous_bash_twice'
  | 'global_process_control_bash'
  | 'background_process_bash'
  | 'repeated_bash_validation_loop'
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
  | 'runtime_failure_after_usage'
  | 'runtime_failure_no_usage'
  | 'wait_after_usage'
  | 'runtime_empty_dirs'

function createAgentWorkflowApp(
  options: AgentWorkflowAppOptions = {},
) {
  const dashboardDataRoot = options.dashboardDataRoot ??
    options.defaultWorkspacePath ??
    join(tmpdir(), `beegame-dashboard-test-${cryptoRandomSuffix()}`)
  if (!options.dashboardDataRoot && !options.defaultWorkspacePath) {
    testDashboardRoots.push(dashboardDataRoot)
  }
  return createAgentWorkflowAppBase({
    ...options,
    outboundTargetPolicyOptions: options.outboundTargetPolicyOptions ?? {
      resolve4: async () => ['93.184.216.34'],
      resolve6: async () => ['2606:2800:220:1:248:1893:25c8:1946'],
    },
    dashboardDataRoot,
    currentUser: options.currentUser ??
      (options.currentUserResolver
        ? undefined
        : { id: DEFAULT_LOCAL_USER_ID, role: 'owner' }),
  })
}

function cryptoRandomSuffix(): string {
  return createHash('sha1')
    .update(`${Date.now()}-${Math.random()}`)
    .digest('hex')
    .slice(0, 12)
}

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
    private readonly env: Record<string, string | undefined> = {},
  ) {}

  async submit(input: BeeGameSessionSubmitInput): Promise<void> {
    this.submits.push(input)
    if (this.mode === 'build_write') {
      const decision = await input.requestPermission({
        toolUseID: 'tool_build_write',
        toolName: 'Write',
        message: 'Write game files?',
        input: {
          file_path: 'sample-game/src/main.ts',
          content: 'console.log("sample")',
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
            input: { file_path: 'sample-game/src/main.ts' },
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
    if (this.mode === 'global_process_control_bash') {
      const decision = await input.requestPermission({
        toolUseID: 'tool_global_process_control',
        toolName: 'Bash',
        message: 'Stop a background process?',
        input: {
          command: 'pkill -f vite',
        },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `process control ${decision.behavior}` })
      return
    }
    if (this.mode === 'background_process_bash') {
      const decision = await input.requestPermission({
        toolUseID: 'tool_background_process',
        toolName: 'Bash',
        message: 'Start a background process?',
        input: {
          command: 'node tools/local-server.js > server.log 2>&1 &',
        },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `background ${decision.behavior}` })
      return
    }
    if (this.mode === 'repeated_bash_validation_loop') {
      for (let index = 0; index < 12; index += 1) {
        const decision = await input.requestPermission({
          toolUseID: `tool_repeated_validation_${index + 1}`,
          toolName: 'Bash',
          message: 'Run another validation command?',
          input: {
            command: 'npm run build',
          },
        })
        this.permissionResults.push(decision.behavior)
      }
      input.onMessage({ type: 'result', result: 'validation loop ended' })
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
          file_path: 'sample-game/src/main.ts',
          content: 'console.log("sample")',
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
          command: 'npm create vite@latest sample-game -- --template react-ts',
        },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `bash before spec ${decision.behavior}` })
      return
    }
    if (this.mode === 'runtime_failure_after_usage') {
      for (const message of this.messages) {
        if (input.signal.aborted) return
        input.onMessage(message)
      }
      throw new Error('runtime failed after usage')
    }
    if (this.mode === 'runtime_failure_no_usage') {
      throw new Error('runtime failed before usage')
    }
    if (this.mode === 'wait_after_usage') {
      for (const message of this.messages) {
        if (input.signal.aborted) return
        input.onMessage(message)
      }
      if (input.signal.aborted) return
      await new Promise<void>(resolve => {
        input.signal.addEventListener('abort', () => resolve(), { once: true })
      })
      return
    }
    if (this.mode === 'runtime_empty_dirs') {
      const configDir = this.env.CLAUDE_CONFIG_DIR
      const appDir = this.env.BEEGAME_CONFIG_DIR
      if (configDir) {
        await mkdir(join(configDir, 'modes'), { recursive: true })
        await mkdir(join(configDir, 'plans'), { recursive: true })
        await mkdir(join(configDir, 'session-env', 'session-empty'), {
          recursive: true,
        })
        await mkdir(join(configDir, 'projects', 'project-with-files'), {
          recursive: true,
        })
        await writeFile(
          join(configDir, 'projects', 'project-with-files', 'run.jsonl'),
          '{}\n',
        )
      }
      if (appDir) {
        await mkdir(join(appDir, '.dashboard-write-test'), { recursive: true })
      }
      input.onMessage({ type: 'result', result: 'runtime dirs created' })
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
        const runtime = new FakeBeeGameRuntime(
          input.cwd,
          messages,
          defaultMode,
          input.env,
        )
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
        const runtime = new FakeBeeGameRuntime(input.cwd, undefined, mode, input.env)
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

async function fsPathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
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
    delete process.env.BEEGAME_SUPABASE_URL
    delete process.env.SUPABASE_URL
    delete process.env.BEEGAME_SUPABASE_ANON_KEY
    delete process.env.SUPABASE_ANON_KEY
    delete process.env.AGENT_WORKFLOW_WORKSPACE_PATH
  })

  afterEach(async () => {
    const roots = testDashboardRoots.splice(0)
    await Promise.all(roots.map(root =>
      rm(root, { recursive: true, force: true }),
    ))
  })

  test('allows credentialed local dashboard API requests without a wildcard CORS origin', async () => {
    const app = createAgentWorkflowApp()
    const response = await app.request('/api/current-user', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://127.0.0.1:62173',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization,hide-error-log,hide-error-toast,x-beegame-workspace-path',
      },
    })

    expect(response.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:62173')
    expect(response.headers.get('access-control-allow-credentials')).toBe('true')
    expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('hide-error-log')
    expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('hide-error-toast')
    expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('x-beegame-workspace-path')
  })

  test('rejects private model and MCP service targets without exposing the URL', async () => {
    const app = createAgentWorkflowApp()
    const privateTarget = 'http://127.0.0.1:43111/private?api_key=secret-value'

    const modelResponse = await app.request('/api/model-configs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Unsafe model',
        provider: 'openai-compatible',
        baseUrl: privateTarget,
        apiKey: 'sk-test',
        models: { balanced: 'test' },
      }),
    })
    const mcpResponse = await app.request('/api/mcp-servers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Unsafe MCP',
        transport: 'http',
        url: privateTarget,
      }),
    })

    expect(modelResponse.status).toBe(400)
    expect(await modelResponse.json()).toEqual({ error: 'Outbound URL is not permitted' })
    expect(mcpResponse.status).toBe(400)
    expect(await mcpResponse.json()).toEqual({ error: 'Outbound URL is not permitted' })
  })

  test('does not start a session from a persisted private model endpoint', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-private-model-'))
    const app = createAgentWorkflowApp()
    const model = createModelConfig(DEFAULT_LOCAL_USER_ID, {
      name: 'Persisted unsafe model', provider: 'openai-compatible',
      baseUrl: 'https://127.0.0.1/private', apiKey: 'sk-test', models: { balanced: 'test' },
    })
    try {
      const response = await app.request('/api/beegame-sessions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace, modelConfigId: model.id }),
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'Outbound URL is not permitted' })
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })

  test('does not start a session from a persisted private Anthropic endpoint', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-private-anthropic-'))
    const app = createAgentWorkflowApp()
    const model = createModelConfig(DEFAULT_LOCAL_USER_ID, {
      name: 'Persisted unsafe Anthropic model', provider: 'anthropic-compatible',
      baseUrl: 'https://127.0.0.1/private', apiKey: 'sk-test', models: { balanced: 'test' },
    })
    try {
      const response = await app.request('/api/beegame-sessions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace, modelConfigId: model.id }),
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'Outbound URL is not permitted' })
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })

  test('runs post-turn integration hooks after an Agent turn completes', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-post-turn-hook-'))
    const completed: Array<{ workspacePath: string; projectId?: string }> = []
    const fake = createFakeRunner()
    const manager = new BeeGameSessionManager(
      fake.runner,
      workspace,
      undefined,
      undefined,
      false,
      {},
      undefined,
      async metadata => { completed.push({ workspacePath: metadata.workspacePath, projectId: metadata.projectId }) },
    )
    try {
      const session = manager.start({ workspacePath: workspace, projectId: 'project-resource-auto-bind', userId: DEFAULT_LOCAL_USER_ID })
      await manager.send(session.id, 'Build the project')
      await waitFor(() => completed.length === 1)
      expect(completed).toEqual([{ workspacePath: workspace, projectId: 'project-resource-auto-bind' }])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('blocks a missing validator, repairs findings, and revalidates before acceptance', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-delivery-review-'))
    await mkdir(join(workspace, 'docs'), { recursive: true })
    await writeFile(join(workspace, 'docs', 'delivery-contract.json'), JSON.stringify({
      version: 1,
      requiredCapabilities: ['skill:beegame-game-acceptance'],
      requirements: [{
        id: 'core-path', title: 'Core player path', scope: 'mvp', evidenceRequired: ['runtime', 'skill'],
      }],
      playerPaths: [{
        id: 'main-path',
        requirementIds: ['core-path'],
        phases: {
          entry: [{}], core_action: [{}], state_change: [{}], completion: [{}], recovery: [{}],
        },
      }],
    }))
    let submitCount = 0
    const manager = new BeeGameSessionManager({
      async start() {
        return {
          async submit(input) {
            submitCount += 1
            if (submitCount === 1) {
              input.onMessage({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'docs/GDD.md' } }] } })
              input.onMessage({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'GDD' }] } })
              input.onMessage({ type: 'result', result: 'Build finished' })
              return
            }
            if (submitCount === 2) {
              input.onMessage({ type: 'assistant', message: { content: [
                { type: 'tool_use', id: 'contract-validator-1', name: 'Task', input: { subagent_type: 'beegame-contract-validator', prompt: 'validate' } },
                { type: 'tool_use', id: 'runtime-validator-1', name: 'Task', input: { subagent_type: 'beegame-runtime-validator', prompt: 'validate' } },
              ] } })
              input.onMessage({ type: 'user', message: { content: [
                { type: 'tool_result', tool_use_id: 'contract-validator-1', content: JSON.stringify({ status: 'failed', verifiedCapabilities: [] }) },
                { type: 'tool_result', tool_use_id: 'runtime-validator-1', content: JSON.stringify({ status: 'failed', verifiedCapabilities: ['skill:beegame-game-acceptance'] }) },
              ] } })
              input.onMessage({ type: 'result', result: JSON.stringify({
                status: 'failed',
                summary: 'Core path failed.',
                requiredCapabilities: ['skill:beegame-game-acceptance'],
                requirements: [{
                  id: 'core-path', title: 'Core player path', scope: 'mvp', status: 'failed',
                  evidenceRequired: ['runtime', 'skill'], evidence: [], detail: 'No executable evidence.',
                }],
                findings: [{
                  requirementId: 'core-path', requirement: 'Core player path', status: 'failed',
                  detail: 'No executable evidence.', evidence: [],
                }],
              }) })
              return
            }
            if (submitCount === 3) {
              input.onMessage({ type: 'assistant', message: { content: [{
                type: 'tool_use', id: 'repair-write', name: 'Write', input: { file_path: 'src/main.ts', content: 'fixed' },
              }] } })
              input.onMessage({ type: 'user', message: { content: [{
                type: 'tool_result', tool_use_id: 'repair-write', content: 'fixed',
              }] } })
              input.onMessage({ type: 'result', result: 'Repair complete' })
              return
            }
            input.onMessage({ type: 'assistant', message: { content: [
              { type: 'tool_use', id: 'contract-validator-2', name: 'Task', input: { subagent_type: 'beegame-contract-validator', prompt: 'validate' } },
              { type: 'tool_use', id: 'runtime-validator-2', name: 'Task', input: { subagent_type: 'beegame-runtime-validator', prompt: 'validate' } },
              { type: 'tool_use', id: 'asset-validator-2', name: 'Task', input: { subagent_type: 'beegame-asset-validator', prompt: 'validate' } },
            ] } })
            input.onMessage({ type: 'user', message: { content: [
              { type: 'tool_result', tool_use_id: 'contract-validator-2', content: JSON.stringify({ status: 'passed', verifiedCapabilities: [] }) },
              { type: 'tool_result', tool_use_id: 'runtime-validator-2', content: JSON.stringify({ status: 'passed', verifiedCapabilities: ['skill:beegame-game-acceptance'] }) },
              { type: 'tool_result', tool_use_id: 'asset-validator-2', content: JSON.stringify({ status: 'passed', verifiedCapabilities: [] }) },
            ] } })
            input.onMessage({ type: 'result', result: JSON.stringify({
              status: 'passed',
              summary: 'Core path passed.',
              requiredCapabilities: ['skill:beegame-game-acceptance'],
              requirements: [{
                id: 'core-path', title: 'Core player path', scope: 'mvp', status: 'runtime_verified',
                evidenceRequired: ['runtime', 'skill'],
                evidence: [
                  { kind: 'runtime', eventId: 'runtime-validator-2', detail: 'Player path assertions passed.' },
                  { kind: 'skill', eventId: 'runtime-validator-2', detail: 'Acceptance capability used.' },
                ],
              }],
              findings: [{
                requirementId: 'core-path', requirement: 'Core player path', status: 'passed',
                detail: 'Executable assertions passed.',
                evidence: [{ kind: 'runtime', eventId: 'runtime-validator-2', detail: 'Player path assertions passed.' }],
              }],
            }) })
          },
          stop() {},
        }
      },
    }, workspace)
    try {
      const session = manager.start({ workspacePath: workspace, userId: DEFAULT_LOCAL_USER_ID })
      await manager.sendWithDisplay(session.id, 'Build project', { displayKind: 'confirmed_brief' })
      await waitFor(() => manager.events(session.id).filter(event => event.type === 'delivery.validation.completed').length === 2)
      const reviews = manager.events(session.id).filter(event => event.type === 'delivery.validation.completed')
      expect(reviews[0]?.payload).toEqual(expect.objectContaining({
        status: 'blocked',
        validators: expect.arrayContaining([
          expect.objectContaining({ agentType: 'beegame-contract-validator' }),
          expect.objectContaining({ agentType: 'beegame-runtime-validator' }),
        ]),
      }))
      expect((reviews[0]?.payload?.validators as unknown[] | undefined)).toHaveLength(2)
      expect(reviews[1]?.payload).toEqual(expect.objectContaining({ status: 'passed' }))
      expect(manager.events(session.id).some(event => event.type === 'delivery.repair.started')).toBe(true)
      expect(submitCount).toBe(4)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('terminates a stalled delivery coordinator with a blocked validation event', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-delivery-timeout-'))
    const previousTimeout = process.env.BEEGAME_DELIVERY_VALIDATION_TIMEOUT_MS
    process.env.BEEGAME_DELIVERY_VALIDATION_TIMEOUT_MS = '10'
    let submits = 0
    const manager = new BeeGameSessionManager({
      async start() {
        return {
          async submit(input) {
            submits += 1
            if (submits === 1) {
              input.onMessage({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'build-read', name: 'Read', input: { file_path: 'docs/delivery-contract.json' } }] } })
              input.onMessage({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'build-read', content: 'read' }] } })
              input.onMessage({ type: 'result', result: 'Build complete' })
              return
            }
            await new Promise<void>(() => {})
          },
          stop() {},
        }
      },
    }, workspace)
    try {
      const session = manager.start({ workspacePath: workspace, userId: DEFAULT_LOCAL_USER_ID })
      await manager.sendWithDisplay(session.id, 'Build project', { displayKind: 'confirmed_brief' })
      await waitFor(() => manager.events(session.id).some(event => (
        event.type === 'system.status' && event.payload?.type === 'delivery.validation.timeout'
      )))
      const completed = manager.events(session.id).find(event => event.type === 'delivery.validation.completed')
      expect(completed).toBeDefined()
      expect(completed?.payload?.status).not.toBe('passed')
      manager.stop(session.id)
    } finally {
      if (previousTimeout === undefined) delete process.env.BEEGAME_DELIVERY_VALIDATION_TIMEOUT_MS
      else process.env.BEEGAME_DELIVERY_VALIDATION_TIMEOUT_MS = previousTimeout
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('resumes a persisted queued delivery repair exactly once after restart', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-delivery-resume-'))
    const sessionId = 'beegame_delivery_resume'
    const transcriptDir = join(workspace, 'transcripts')
    const prefix = basename(workspace)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
    const transcriptPath = join(
      transcriptDir,
      `${prefix}__${createHash('sha256').update(sessionId).digest('hex').slice(0, 8)}.jsonl`,
    )
    const contract = {
      version: 1,
      status: 'failed',
      summary: 'Runtime path is unresolved.',
      requirements: [{
        id: 'core-path', title: 'Core path', scope: 'mvp', status: 'failed',
        evidenceRequired: ['runtime'], evidence: [],
      }],
      requiredCapabilities: [],
      verifiedCapabilities: [],
    }
    const persisted = [
      { id: 1, sessionId, type: 'delivery.contract.updated', text: contract.summary, payload: { type: 'delivery.contract.updated', contract, attempt: 0 }, createdAt: new Date().toISOString() },
      { id: 2, sessionId, type: 'delivery.repair.queued', text: 'Delivery repair queued', payload: { type: 'delivery.repair.queued', status: 'queued', attempt: 1, contract }, createdAt: new Date().toISOString() },
    ]
    await mkdir(transcriptDir, { recursive: true })
    await writeFile(transcriptPath, `${persisted.map(event => JSON.stringify(event)).join('\n')}\n`)

    let submits = 0
    const manager = new BeeGameSessionManager({
      async start() {
        return {
          async submit(input) {
            submits += 1
            await new Promise<void>(resolveAbort => {
              if (input.signal.aborted) return resolveAbort()
              input.signal.addEventListener('abort', () => resolveAbort(), { once: true })
            })
          },
          stop() {},
        }
      },
    }, workspace)
    try {
      const session = manager.start({ workspacePath: workspace, transcriptSessionId: sessionId, userId: DEFAULT_LOCAL_USER_ID })
      expect(await manager.resumePendingDeliveryPipeline(session.id)).toBe(true)
      expect(await manager.resumePendingDeliveryPipeline(session.id)).toBe(false)
      expect(manager.events(session.id).filter(event => event.type === 'delivery.repair.started')).toHaveLength(1)
      expect(submits).toBe(1)
      manager.stop(session.id)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('counts only Bash permissions that actually require user resolution', () => {
    const base = { sessionId: 'session', turnId: 'turn', text: 'permission', createdAt: new Date() }
    const events = [
      { ...base, id: 1, type: 'permission.resolved' as const, payload: { type: 'permission.resolved', toolName: 'Bash', toolUseID: 'auto-allowed', decision: 'allow', autoApproved: true } },
      { ...base, id: 2, type: 'permission.resolved' as const, payload: { type: 'permission.resolved', toolName: 'Bash', toolUseID: 'auto-denied', decision: 'deny', autoDenied: true } },
      { ...base, id: 3, type: 'permission.requested' as const, payload: { type: 'permission.requested', toolName: 'Bash', toolUseID: 'needs-user' } },
      { ...base, id: 4, type: 'permission.resolved' as const, payload: { type: 'permission.resolved', toolName: 'Bash', toolUseID: 'needs-user', decision: 'allow' } },
    ]
    expect(countBashPermissionRequestsRequiringUserResolution(events, 'turn')).toBe(1)
  })

  test('resumes interrupted validation and an in-flight repair without advancing the repair attempt', async () => {
    for (const scenario of [
      { transition: 'delivery.validation.started', expectedTurnKind: 'delivery.validation.started', attempt: 0 },
      { transition: 'delivery.repair.started', expectedTurnKind: 'delivery.repair.started', attempt: 1 },
    ] as const) {
      const workspace = await mkdtemp(join(tmpdir(), 'beegame-delivery-transition-'))
      const sessionId = `beegame_transition_${scenario.attempt}`
      const transcriptDir = join(workspace, 'transcripts')
      const prefix = basename(workspace).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
      const transcriptPath = join(transcriptDir, `${prefix}__${createHash('sha256').update(sessionId).digest('hex').slice(0, 8)}.jsonl`)
      const contract = {
        version: 1, status: 'failed', summary: 'Delivery remains unresolved.',
        requirements: [{ id: 'core-path', title: 'Core path', scope: 'mvp', status: 'failed', evidenceRequired: ['runtime'], evidence: [] }],
        requiredCapabilities: [], verifiedCapabilities: [],
      }
      const events = [
        { id: 1, sessionId, type: 'delivery.contract.updated', text: contract.summary, payload: { type: 'delivery.contract.updated', contract, attempt: scenario.attempt }, createdAt: new Date().toISOString() },
        { id: 2, sessionId, type: scenario.transition, text: 'Interrupted transition', payload: { type: scenario.transition, status: 'running', attempt: scenario.attempt, contract }, createdAt: new Date().toISOString() },
      ]
      await mkdir(transcriptDir, { recursive: true })
      await writeFile(transcriptPath, `${events.map(event => JSON.stringify(event)).join('\n')}\n`)
      let submits = 0
      const manager = new BeeGameSessionManager({
        async start() {
          return {
            async submit(input) {
              submits += 1
              await new Promise<void>(resolveAbort => input.signal.addEventListener('abort', () => resolveAbort(), { once: true }))
            },
            stop() {},
          }
        },
      }, workspace)
      try {
        const session = manager.start({ workspacePath: workspace, transcriptSessionId: sessionId, userId: DEFAULT_LOCAL_USER_ID })
        expect(await manager.resumePendingDeliveryPipeline(session.id)).toBe(true)
        expect(await manager.resumePendingDeliveryPipeline(session.id)).toBe(false)
        const resumed = manager.events(session.id).filter(event => event.type === scenario.expectedTurnKind)
        expect(resumed).toHaveLength(2)
        if (scenario.transition === 'delivery.repair.started') {
          expect(resumed.at(-1)?.payload).toEqual(expect.objectContaining({ attempt: 1, resumed: true }))
        }
        expect(submits).toBe(1)
        manager.stop(session.id)
      } finally {
        await rm(workspace, { recursive: true, force: true })
      }
    }
  })

  test('validates remote runtime provider endpoints before starting the session runner', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-remote-runtime-endpoints-'))
    const resolvedUrls: string[] = []
    let starts = 0
    const manager = new BeeGameSessionManager(
      {
        async start() {
          starts += 1
          return new FakeBeeGameRuntime(workspace)
        },
      },
      workspace,
      () => ({
        ANTHROPIC_BASE_URL: 'https://anthropic.runtime.test',
        OPENAI_BASE_URL: 'https://openai.runtime.test',
        GEMINI_BASE_URL: 'https://gemini.runtime.test',
        GROK_BASE_URL: 'https://grok.runtime.test',
      }),
      undefined,
      true,
      {
        resolve4: async () => ['93.184.216.34'],
        resolve6: async () => ['2606:2800:220:1:248:1893:25c8:1946'],
      },
      async (value) => {
        resolvedUrls.push(value)
        return value === 'https://grok.runtime.test'
          ? null
          : {
            url: new URL(value),
            addresses: ['93.184.216.34'],
            lookup: (_hostname, _options, callback) => callback(null, '93.184.216.34', 4),
          }
      },
    )

    try {
      const session = manager.start({ workspacePath: workspace, userId: DEFAULT_LOCAL_USER_ID })
      await manager.send(session.id, 'Start the task')

      await waitFor(() => manager.events(session.id).some(event => event.type === 'turn.failed'))

      expect(resolvedUrls).toEqual([
        'https://anthropic.runtime.test',
        'https://openai.runtime.test',
        'https://gemini.runtime.test',
        'https://grok.runtime.test',
      ])
      expect(starts).toBe(0)
      expect(manager.events(session.id)).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'turn.failed', text: 'Outbound URL is not permitted' }),
      ]))
      expect(JSON.stringify(manager.events(session.id))).not.toContain('grok.runtime.test')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('passes each resolved provider target to the runner without resolving it again', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-pinned-runtime-targets-'))
    const resolvedUrls: string[] = []
    const starts: BeeGameSessionRunnerStartInput[] = []
    const manager = new BeeGameSessionManager(
      {
        async start(input) {
          starts.push(input)
          return new FakeBeeGameRuntime(workspace)
        },
      },
      workspace,
      () => ({
        ANTHROPIC_BASE_URL: 'https://anthropic.runtime.test',
        OPENAI_BASE_URL: 'https://openai.runtime.test',
        GEMINI_BASE_URL: 'https://gemini.runtime.test',
        GROK_BASE_URL: 'https://grok.runtime.test',
      }),
      undefined,
      true,
      {},
      async value => {
        resolvedUrls.push(value)
        return {
          url: new URL(value),
          addresses: ['93.184.216.34'],
          lookup: (_hostname, _options, callback) => callback(null, '93.184.216.34', 4),
        }
      },
    )

    try {
      const session = manager.start({ workspacePath: workspace, userId: DEFAULT_LOCAL_USER_ID })
      await manager.send(session.id, 'Start the task')
      await waitFor(() => starts.length === 1)

      expect(resolvedUrls).toEqual([
        'https://anthropic.runtime.test',
        'https://openai.runtime.test',
        'https://gemini.runtime.test',
        'https://grok.runtime.test',
      ])
      expect(starts[0]?.approvedOutboundTargets).toEqual(expect.objectContaining({
        ANTHROPIC_BASE_URL: expect.objectContaining({ url: new URL('https://anthropic.runtime.test') }),
        OPENAI_BASE_URL: expect.objectContaining({ url: new URL('https://openai.runtime.test') }),
        GEMINI_BASE_URL: expect.objectContaining({ url: new URL('https://gemini.runtime.test') }),
        GROK_BASE_URL: expect.objectContaining({ url: new URL('https://grok.runtime.test') }),
      }))
      expect(resolvedUrls).toHaveLength(4)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('creates a dashboard session without starting a BeeGame turn', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner(undefined, 'build_write_complete')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
    })
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

  test('applies BeeGame session route permissions by role', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner()
    try {
      const viewerApp = createAgentWorkflowApp({
        sessionRunner: fake.runner,
        defaultWorkspacePath: projectsRoot,
        currentUser: {
          id: 'viewer-user',
          role: 'viewer',
        },
      })
      const developerApp = createAgentWorkflowApp({
        sessionRunner: fake.runner,
        defaultWorkspacePath: projectsRoot,
        currentUser: {
          id: 'developer-user',
          role: 'developer',
        },
      })

      const viewerCreateRes = await viewerApp.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      expect(viewerCreateRes.status).toBe(403)
      expect(await viewerCreateRes.json()).toEqual({ error: 'Forbidden' })

      const developerCreateRes = await developerApp.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      expect(developerCreateRes.status).toBe(200)
      const session = await developerCreateRes.json()

      const viewerInputRes = await viewerApp.request(
        `/api/beegame-sessions/${session.id}/input`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Continue task' }),
        },
      )
      expect(viewerInputRes.status).toBe(403)
      expect(await viewerInputRes.json()).toEqual({ error: 'Forbidden' })

      const developerInputRes = await developerApp.request(
        `/api/beegame-sessions/${session.id}/input`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Continue task' }),
        },
      )
      expect(developerInputRes.status).toBe(200)

      const viewerPreviewRes = await viewerApp.request(
        `/api/beegame-sessions/${session.id}/preview`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ workspacePath: workspace }),
        },
      )
      expect(viewerPreviewRes.status).toBe(403)

      const developerDeleteRes = await developerApp.request(
        `/api/beegame-sessions/${session.id}`,
        { method: 'DELETE' },
      )
      expect(developerDeleteRes.status).toBe(200)
      expect((await developerApp.request(`/api/beegame-sessions/${session.id}`)).status).toBe(404)
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('passes chat thinking mode from session input into the runtime turn', async () => {
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

      const inputRes = await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: 'Build the next feature.',
          thinkingMode: 'disabled',
        }),
      })

      expect(inputRes.status).toBe(200)
      await waitFor(() => fake.runtimes[0]?.submits.length === 1)
      expect(fake.runtimes[0]?.submits[0]?.thinkingMode).toBe('disabled')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('defaults chat thinking mode to disabled when session input omits it', async () => {
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

      const inputRes = await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Build the next feature.' }),
      })

      expect(inputRes.status).toBe(200)
      await waitFor(() => fake.runtimes[0]?.submits.length === 1)
      expect(fake.runtimes[0]?.submits[0]?.thinkingMode).toBe('disabled')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('reuses the BeeGame runtime across chat turns while the server is alive', async () => {
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

      const firstInputRes = await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'First change.' }),
      })
      expect(firstInputRes.status).toBe(200)
      await waitFor(() => fake.runtimes[0]?.submits.length === 1)

      const secondInputRes = await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Second change.' }),
      })
      expect(secondInputRes.status).toBe(200)
      await waitFor(() => fake.runtimes[0]?.submits.length === 2)

      expect(fake.starts).toHaveLength(1)
      expect(fake.runtimes).toHaveLength(1)
      expect(fake.runtimes[0]?.stops).toEqual([])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('scopes dashboard stores by current user', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const ownerAApp = createAgentWorkflowApp({
      defaultWorkspacePath: projectsRoot,
      currentUser: { id: 'owner-a', role: 'owner' },
    })
    const ownerBApp = createAgentWorkflowApp({
      defaultWorkspacePath: projectsRoot,
      currentUser: { id: 'owner-b', role: 'owner' },
    })

    try {
      const projectARes = await ownerAApp.request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'project_a',
          name: 'Project A',
          created_at: 1,
        }),
      })
      expect(projectARes.status).toBe(200)

      await ownerAApp.request('/api/web-tools', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          webSearchAdapter: 'brave',
          braveApiKey: 'bsa-owner-a-secret',
        }),
      })
      await ownerAApp.request('/api/runtime-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skillSearchEnabled: true }),
      })
      await ownerAApp.request('/api/mcp-servers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Owner A MCP',
          enabled: true,
          transport: 'stdio',
          scope: 'beegame',
          command: 'owner-a-mcp',
        }),
      })

      const ownerAProjects = await (await ownerAApp.request('/api/projects')).json()
      const ownerBProjects = await (await ownerBApp.request('/api/projects')).json()
      expect(ownerAProjects).toEqual([
        expect.objectContaining({ id: 'project_a', name: 'Project A' }),
      ])
      expect(ownerBProjects).toEqual([])

      const ownerAWebTools = await (await ownerAApp.request('/api/web-tools')).json()
      const ownerBWebTools = await (await ownerBApp.request('/api/web-tools')).json()
      expect(ownerAWebTools).toEqual(expect.objectContaining({
        webSearchAdapter: 'brave',
        braveApiKeyPreview: 'bsa-…cret',
      }))
      expect(ownerBWebTools).toEqual({})

      const ownerARuntimeSettings = await (await ownerAApp.request('/api/runtime-settings')).json()
      const ownerBRuntimeSettings = await (await ownerBApp.request('/api/runtime-settings')).json()
      expect(ownerARuntimeSettings).toEqual({ skillSearchEnabled: true })
      expect(ownerBRuntimeSettings).toEqual({ skillSearchEnabled: true })

      const ownerAMcpServers = await (await ownerAApp.request('/api/mcp-servers')).json()
      const ownerBMcpServers = await (await ownerBApp.request('/api/mcp-servers')).json()
      expect(ownerAMcpServers).toEqual([
        expect.objectContaining({ name: 'Owner A MCP', command: 'owner-a-mcp' }),
      ])
      expect(ownerBMcpServers).toEqual([])
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('blocks cross-owner BeeGame session access even when the session id and workspace are known', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const workspace = join(projectsRoot, 'owner-a-game')
    const fake = createFakeRunner()
    try {
      await mkdir(join(workspace, 'assets'), { recursive: true })
      await writeFile(
        join(workspace, 'assets', 'asset-manifest.json'),
        JSON.stringify({ version: 1, slots: [] }),
        'utf8',
      )

      const app = createAgentWorkflowApp({
        sessionRunner: fake.runner,
        defaultWorkspacePath: projectsRoot,
        currentUserResolver: request => {
          const token = request.headers.get('authorization')
          if (token === 'Bearer owner-a-token') return { id: 'owner-a', role: 'owner' }
          if (token === 'Bearer owner-b-token') return { id: 'owner-b', role: 'owner' }
          return undefined
        },
      })
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer owner-a-token',
        },
        body: JSON.stringify({
          workspacePath: workspace,
          projectId: 'owner-a-project',
        }),
      })
      expect(sessionRes.status).toBe(200)
      const session = await sessionRes.json()

      const ownerBHeaders = { authorization: 'Bearer owner-b-token' }
      const ownerBJsonHeaders = {
        ...ownerBHeaders,
        'content-type': 'application/json',
      }

      expect((await app.request(
        `/api/beegame-sessions/${session.id}/events`,
        { headers: ownerBHeaders },
      )).status).toBe(404)
      expect((await app.request(
        `/api/beegame-sessions/${session.id}/transcript?workspacePath=${encodeURIComponent(workspace)}`,
        { headers: ownerBHeaders },
      )).status).toBe(404)
      expect((await app.request(
        `/api/beegame-sessions/${session.id}/assets?workspacePath=${encodeURIComponent(workspace)}`,
        { headers: ownerBHeaders },
      )).status).toBe(404)
      expect((await app.request(
        `/api/beegame-sessions/${session.id}/preview`,
        {
          method: 'POST',
          headers: ownerBJsonHeaders,
          body: JSON.stringify({ workspacePath: workspace }),
        },
      )).status).toBe(404)
      expect((await app.request(
        `/api/beegame-sessions/${session.id}/input`,
        {
          method: 'POST',
          headers: ownerBJsonHeaders,
          body: JSON.stringify({ text: 'Continue' }),
        },
      )).status).toBe(404)
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('ignores client workspace path hints for active SaaS sessions', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-saas-workspace-'))
    const requestedWorkspace = join(projectsRoot, 'requested-project')
    const wrongWorkspace = join(projectsRoot, 'wrong-project')
    const starts: Array<{ cwd: string }> = []
    const previewRunner: BeeGamePreviewRunner = (_command, options) => {
      starts.push({ cwd: options.cwd })
      return { kill: () => {} }
    }
    const app = createAgentWorkflowApp({
      defaultWorkspacePath: projectsRoot,
      sessionRunner: createFakeRunner().runner,
      previewRunner,
      previewPortAllocator: async () => 63100,
      previewReadinessProbe: async () => true,
      currentUser: {
        id: '00000000-0000-0000-0000-000000000011',
        role: 'owner',
      },
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspacePath: requestedWorkspace,
          projectId: 'project_workspace_hint',
        }),
      })
      const session = await sessionRes.json()
      await writeFile(
        join(session.cwd, 'package.json'),
        JSON.stringify({
          scripts: { dev: 'vite --host 127.0.0.1' },
          devDependencies: { vite: '^5.0.0' },
        }),
      )

      const previewRes = await app.request(
        `/api/beegame-sessions/${session.id}/preview?workspacePath=${encodeURIComponent(wrongWorkspace)}`,
        { method: 'POST' },
      )

      expect(previewRes.status).toBe(200)
      expect(starts[0]?.cwd).toBe(session.cwd)
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('starts existing SaaS projects from their persisted project root path', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-saas-workspace-'))
    const projectWorkspace = join(projectsRoot, 'migrated-project')
    const fake = createFakeRunner()
    const app = createAgentWorkflowApp({
      defaultWorkspacePath: projectsRoot,
      sessionRunner: fake.runner,
      currentUser: {
        id: '00000000-0000-0000-0000-000000000012',
        role: 'owner',
      },
    })
    try {
      await mkdir(projectWorkspace, { recursive: true })
      const projectRes = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'project_existing_root',
          name: 'Existing Root',
          root_path: projectWorkspace,
          created_at: 1710000000000,
        }),
      })
      expect(projectRes.status).toBe(200)

      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project_existing_root',
          workspacePath: join(projectsRoot, 'users', 'ignored-empty-project'),
        }),
      })
      expect(sessionRes.status).toBe(200)
      const session = await sessionRes.json()

      expect(await realpath(session.cwd)).toBe(await realpath(projectWorkspace))
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('rejects legacy workspace path hints outside the current SaaS user root', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-saas-workspace-'))
    const otherUserWorkspace = join(
      projectsRoot,
      'users',
      '00000000-0000-0000-0000-000000000022',
      'other-project',
    )
    const app = createAgentWorkflowApp({
      defaultWorkspacePath: projectsRoot,
      sessionRunner: createFakeRunner().runner,
      currentUser: {
        id: '00000000-0000-0000-0000-000000000011',
        role: 'owner',
      },
    })
    try {
      const previewRes = await app.request('/api/beegame-sessions/missing/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: otherUserWorkspace }),
      })
      const preview = await previewRes.json()

      expect(previewRes.status).toBe(400)
      expect(preview.error).toContain('current user workspace')
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('injects bearer authenticated user runtime settings into BeeGame turns', async () => {
    const originalTokens = process.env.BEEGAME_AUTH_TOKENS
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const workspace = join(projectsRoot, 'auth-runtime-game')
    const fake = createFakeRunner(undefined, 'build_write_complete')
    try {
      process.env.BEEGAME_AUTH_TOKENS = JSON.stringify({
        'owner-a-token': { id: 'owner-a', role: 'owner' },
      })
      const app = createAgentWorkflowAppBase({
        sessionRunner: fake.runner,
        defaultWorkspacePath: projectsRoot,
        dashboardDataRoot: projectsRoot,
        outboundTargetPolicyOptions: {
          resolve4: async () => ['93.184.216.34'],
          resolve6: async () => ['2606:2800:220:1:248:1893:25c8:1946'],
        },
      })
      const model = createModelConfig('owner-a', {
        name: 'Primary LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
      })

      await app.request('/api/web-tools', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer owner-a-token',
        },
        body: JSON.stringify({
          webSearchAdapter: 'brave',
          braveApiKey: 'bsa-owner-a-secret',
        }),
      })

      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer owner-a-token',
        },
        body: JSON.stringify({
          workspacePath: workspace,
          modelConfigId: model.id,
        }),
      })
      expect(sessionRes.status).toBe(200)
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer owner-a-token',
        },
        body: JSON.stringify({ text: 'Build with web tools.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(
          `/api/beegame-sessions/${session.id}/events`,
          { headers: { authorization: 'Bearer owner-a-token' } },
        )
        const events = await eventsRes.json()
        return events.some((event: { type: string }) => event.type === 'turn.completed')
      })

      expect(fake.starts[0]?.env).toEqual(expect.objectContaining({
        WEB_SEARCH_ADAPTER: 'brave',
        BRAVE_SEARCH_API_KEY: 'bsa-owner-a-secret',
      }))
    } finally {
      if (originalTokens === undefined) {
        delete process.env.BEEGAME_AUTH_TOKENS
      } else {
        process.env.BEEGAME_AUTH_TOKENS = originalTokens
      }
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('rejects relative workspace paths before creating a runner', async () => {
    const fake = createFakeRunner()
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
    })

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
      currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
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
    const workspace = join(projectsRoot, 'sample-web-game')
    const fake = createFakeRunner()
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
      currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
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

  test('derives managed project workspace paths for authenticated users', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const outsideRoot = await mkdtemp(join(tmpdir(), 'beegame-outside-'))
    const fake = createFakeRunner()
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
      currentUser: { id: 'user@example.com', role: 'developer' },
    })

    try {
      const res = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspacePath: outsideRoot,
          projectName: 'Sample Classic Game',
        }),
      })

      expect(res.status).toBe(200)
      const session = await res.json()
      const resolvedProjectsRoot = await realpath(projectsRoot)
      const expectedWorkspace = join(
        resolvedProjectsRoot,
        'users',
        'user-example.com',
        'sample-classic-game',
      )
      expect(session.cwd).toBe(expectedWorkspace)
      expect((await stat(expectedWorkspace)).isDirectory()).toBe(true)
      expect(fake.starts).toHaveLength(0)
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
      await rm(outsideRoot, { recursive: true, force: true })
    }
  })

  test('rejects starting a BeeGame session directly in the default Projects root', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const fake = createFakeRunner()
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
      currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
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
      currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
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
            BEEGAME_CONFIG_DIR: expect.stringContaining('.runtime/app'),
            CLAUDE_CONFIG_DIR: expect.stringContaining('.runtime/app'),
            BEEGAME_PROJECT_CONFIG_DIR_NAME: '.beegame',
            [`${legacyRuntimeEnvPrefix}OPENAI`]: '1',
            OPENAI_BASE_URL: 'https://llm.example.invalid/v1',
            OPENAI_API_KEY: 'sk-dashboard-secret',
            OPENAI_DEFAULT_SONNET_MODEL: 'balanced-model',
          }),
        }),
      ])
      expect(fake.starts[0]?.env.CLAUDE_CONFIG_DIR).toBe(fake.starts[0]?.env.BEEGAME_CONFIG_DIR)
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
      const logsDir = join(workspace, 'logs')
      const logIndex = JSON.parse(
        await readFile(join(logsDir, 'index.json'), 'utf8'),
      ) as {
        version: number
        project: string
        sessions: Record<string, {
          transcript: string
          agentRawLog: string
          runtimeLog: string
          previewLog: string
          deployLog: string
        }>
      }
      expect(logIndex).toEqual(expect.objectContaining({
        version: 1,
        project: 'game-one',
      }))
      expect(logIndex.sessions[session.id]).toEqual(expect.objectContaining({
        transcript: `transcripts/${transcriptFiles[0]}`,
        agentRawLog: 'logs/agent.raw.jsonl',
        runtimeLog: 'logs/runtime.log',
        previewLog: 'logs/preview.log',
        deployLog: 'logs/deploy.log',
      }))
      const runtimeLog = await readFile(join(logsDir, 'runtime.log'), 'utf8')
      expect(runtimeLog).toContain('session.started')
      expect(runtimeLog).toContain('turn.started')
      expect(runtimeLog).toContain('turn.completed')
      const rawAgentLog = await readFile(join(logsDir, 'agent.raw.jsonl'), 'utf8')
      const rawAgentEvents = rawAgentLog
        .trim()
        .split('\n')
        .map(line => JSON.parse(line) as { sessionId: string; message: { type?: string } })
      expect(rawAgentEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sessionId: session.id,
            message: expect.objectContaining({ type: 'assistant' }),
          }),
          expect.objectContaining({
            sessionId: session.id,
            message: expect.objectContaining({ type: 'result' }),
          }),
        ]),
      )
      const restartedApp = createAgentWorkflowApp({
        sessionRunner: createFakeRunner().runner,
        defaultWorkspacePath: projectsRoot,
        currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
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

  test('sends screenshot attachments to the BeeGame session runner as multimodal prompt blocks', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const workspace = join(projectsRoot, 'game-with-screenshot')
    const fake = createFakeRunner()
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
      currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
    })

    try {
      const sessionRes = await app.request('/api/console/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      const inputRes = await app.request(
        `/api/console/sessions/${session.id}/input`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            text: '',
            attachments: [{
              type: 'image',
              mediaType: 'image/png',
              data: 'iVBORw0KGgo=',
              filename: 'screenshot.png',
            }],
          }),
        },
      )

      await waitFor(async () => fake.runtimes[0]?.submits.length === 1)

      expect(inputRes.status).toBe(200)
      expect(fake.runtimes[0].submits[0].prompt).toEqual([
        {
          type: 'text',
          text: 'Analyze the attached image.',
        },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: 'iVBORw0KGgo=',
          },
        },
      ])
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('materializes supported document attachments inside the workspace attachment directory', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-document-'))

    try {
      const result = await materializeBeeGameFileAttachments(workspace, [{
        type: 'file',
        mediaType: 'application/jsonl',
        data: Buffer.from('{"ok":true}\n').toString('base64'),
        filename: '../events.jsonl',
      }])

      expect(result).toHaveLength(1)
      expect(result[0]?.relativePath).toMatch(/^\.beegame-attachments\/[a-f0-9-]+-events\.jsonl$/)
      expect(await readFile(join(workspace, result[0]!.relativePath), 'utf8')).toBe('{"ok":true}\n')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('rejects GIF and unsupported document attachments at the server boundary', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-document-policy-'))

    try {
      await expect(materializeBeeGameFileAttachments(workspace, [{
        type: 'file',
        mediaType: 'image/gif',
        data: Buffer.from('gif').toString('base64'),
        filename: 'animation.gif',
      }])).rejects.toThrow('Unsupported document attachment')
      await expect(materializeBeeGameFileAttachments(workspace, [{
        type: 'file',
        mediaType: 'application/zip',
        data: Buffer.from('zip').toString('base64'),
        filename: 'bundle.zip',
      }])).rejects.toThrow('Unsupported document attachment')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('passes document attachment paths to the BeeGame session runner', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const workspace = join(projectsRoot, 'game-with-document')
    const fake = createFakeRunner()
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
      currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
    })

    try {
      const sessionRes = await app.request('/api/console/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      const inputRes = await app.request(`/api/console/sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: 'Review this document.',
          attachments: [{
            type: 'file',
            mediaType: 'application/jsonl',
            data: Buffer.from('{"ok":true}\n').toString('base64'),
            filename: 'events.jsonl',
          }],
        }),
      })

      await waitFor(async () => fake.runtimes[0]?.submits.length === 1)

      expect(inputRes.status).toBe(200)
      const prompt = fake.runtimes[0].submits[0].prompt
      expect(typeof prompt).toBe('string')
      expect(prompt as string).toContain('events.jsonl')
      expect(prompt as string).toContain('.beegame-attachments/')
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('reserves turn credits and settles them from runtime token usage', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-credit-turn-'))
    const workspace = join(projectsRoot, 'credit-game')
    await mkdir(workspace, { recursive: true })
    const fake = createFakeRunner([
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Built with usage.' }] },
      },
      {
        type: 'result',
        result: 'Done',
        usage: {
          input_tokens: 20_000,
          output_tokens: 3_001,
          total_tokens: 23_001,
        },
      },
    ])
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
      currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: {
          authorization: 'Bearer user-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      const inputRes = await app.request(
        `/api/beegame-sessions/${session.id}/input`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Build the game.', taskType: 'edit_turn' }),
        },
      )
      expect(inputRes.status).toBe(200)

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some((event: { payload?: { type?: string } }) =>
          event.payload?.type === 'credit.settled',
        )
      })

      const creditsRes = await app.request('/api/credits')
      expect(await creditsRes.json()).toEqual(expect.objectContaining({
        balanceCredits: 297,
        consumedCredits: 3,
        reservedCredits: 0,
      }))
      const ledgerRes = await app.request('/api/credits/ledger')
      expect((await ledgerRes.json()).map((entry: {
        kind: string
        credits: number
        weightedTokens?: number
        projectId?: string
      }) => ({
        kind: entry.kind,
        credits: entry.credits,
        weightedTokens: entry.weightedTokens,
        projectId: entry.projectId,
      }))).toEqual([
        {
          kind: 'reserve',
          credits: 50,
          weightedTokens: undefined,
          projectId: session.id,
        },
        {
          kind: 'settle',
          credits: 3,
          weightedTokens: 23_001,
          projectId: session.id,
        },
        {
          kind: 'refund',
          credits: 47,
          weightedTokens: undefined,
          projectId: session.id,
        },
      ])
      expect(listCreditLedger(DEFAULT_LOCAL_USER_ID, { dataDir: projectsRoot })
        .map(entry => ({
          kind: entry.kind,
          credits: entry.credits,
          weightedTokens: entry.weightedTokens,
          projectId: entry.projectId,
        }))).toEqual([
        {
          kind: 'reserve',
          credits: 50,
          weightedTokens: undefined,
          projectId: session.id,
        },
        {
          kind: 'settle',
          credits: 3,
          weightedTokens: 23_001,
          projectId: session.id,
        },
        {
          kind: 'refund',
          credits: 47,
          weightedTokens: undefined,
          projectId: session.id,
        },
      ])
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('attributes turn credit ledger entries to the owning project id', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-credit-project-summary-'))
    const workspace = join(projectsRoot, 'credit-project-game')
    const projectId = 'proj_credit_summary'
    await mkdir(workspace, { recursive: true })
    const fake = createFakeRunner([
      {
        type: 'result',
        result: 'Done',
        usage: {
          input_tokens: 20_000,
          output_tokens: 3_001,
          total_tokens: 23_001,
        },
      },
    ])
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
      currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: {
          authorization: 'Bearer user-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ workspacePath: workspace, projectId }),
      })
      const session = await sessionRes.json()

      const inputRes = await app.request(
        `/api/beegame-sessions/${session.id}/input`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Build the game.', taskType: 'edit_turn' }),
        },
      )
      expect(inputRes.status).toBe(200)

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some((event: { payload?: { type?: string } }) =>
          event.payload?.type === 'credit.settled',
        )
      })

      const summaryRes = await app.request(`/api/credits/summary?projectId=${projectId}`)
      expect(await summaryRes.json()).toEqual(expect.objectContaining({
        reservedCredits: 50,
        settledCredits: 3,
        refundedCredits: 47,
        outstandingReservedCredits: 0,
        weightedTokens: 23_001,
      }))
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('settles turn credits from assistant message token usage', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-credit-assistant-usage-'))
    const workspace = join(projectsRoot, 'credit-assistant-game')
    await mkdir(workspace, { recursive: true })
    const fake = createFakeRunner([
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Built with assistant usage.' }],
          usage: {
            input_tokens: 20_000,
            output_tokens: 3_001,
          },
        },
      },
    ])
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
      currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: {
          authorization: 'Bearer user-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      const inputRes = await app.request(
        `/api/beegame-sessions/${session.id}/input`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Build the game.', taskType: 'edit_turn' }),
        },
      )
      expect(inputRes.status).toBe(200)

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some((event: { payload?: { type?: string } }) =>
          event.payload?.type === 'credit.settled',
        )
      })

      const creditsRes = await app.request('/api/credits')
      expect(await creditsRes.json()).toEqual(expect.objectContaining({
        balanceCredits: 297,
        consumedCredits: 3,
        reservedCredits: 0,
      }))
      expect(listCreditLedger(DEFAULT_LOCAL_USER_ID, { dataDir: projectsRoot })
        .map(entry => ({
          kind: entry.kind,
          credits: entry.credits,
          weightedTokens: entry.weightedTokens,
          projectId: entry.projectId,
        }))).toEqual([
        {
          kind: 'reserve',
          credits: 50,
          weightedTokens: undefined,
          projectId: session.id,
        },
        {
          kind: 'settle',
          credits: 3,
          weightedTokens: 23_001,
          projectId: session.id,
        },
        {
          kind: 'refund',
          credits: 47,
          weightedTokens: undefined,
          projectId: session.id,
        },
      ])
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('settles actual usage and refunds the remainder when a turn fails after token usage', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-credit-failed-turn-'))
    const workspace = join(projectsRoot, 'credit-failed-game')
    await mkdir(workspace, { recursive: true })
    const fake = createFakeRunner([
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Working before failure.' }] },
      },
      {
        type: 'result',
        result: 'Partial result',
        usage: {
          input_tokens: 10_000,
          output_tokens: 2_500,
          total_tokens: 12_500,
        },
      },
    ], 'runtime_failure_after_usage')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
      currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: {
          authorization: 'Bearer user-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      const inputRes = await app.request(
        `/api/beegame-sessions/${session.id}/input`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Continue the project.', taskType: 'edit_turn' }),
        },
      )
      expect(inputRes.status).toBe(200)

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some((event: { type?: string }) => event.type === 'turn.failed')
      })

      expect(listCreditLedger(DEFAULT_LOCAL_USER_ID, { dataDir: projectsRoot })
        .map(entry => ({
          kind: entry.kind,
          credits: entry.credits,
          weightedTokens: entry.weightedTokens,
          projectId: entry.projectId,
        }))).toEqual([
        {
          kind: 'reserve',
          credits: 50,
          weightedTokens: undefined,
          projectId: session.id,
        },
        {
          kind: 'settle',
          credits: 2,
          weightedTokens: 12_500,
          projectId: session.id,
        },
        {
          kind: 'refund',
          credits: 48,
          weightedTokens: undefined,
          projectId: session.id,
        },
      ])
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('refunds the full reservation when a turn fails before token usage', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-credit-no-usage-failure-'))
    const workspace = join(projectsRoot, 'credit-no-usage-game')
    await mkdir(workspace, { recursive: true })
    const fake = createFakeRunner([], 'runtime_failure_no_usage')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
      currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      const inputRes = await app.request(
        `/api/beegame-sessions/${session.id}/input`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Continue the project.', taskType: 'edit_turn' }),
        },
      )
      expect(inputRes.status).toBe(200)

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some((event: { type?: string }) => event.type === 'turn.failed')
      })

      expect(listCreditLedger(DEFAULT_LOCAL_USER_ID, { dataDir: projectsRoot })
        .map(entry => ({ kind: entry.kind, credits: entry.credits, projectId: entry.projectId })))
        .toEqual([
          { kind: 'reserve', credits: 50, projectId: session.id },
          { kind: 'refund', credits: 50, projectId: session.id },
        ])
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('settles actual usage and refunds the remainder when the user stops a running turn', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-credit-stopped-turn-'))
    const workspace = join(projectsRoot, 'credit-stopped-game')
    await mkdir(workspace, { recursive: true })
    const fake = createFakeRunner([
      {
        type: 'result',
        result: 'Partial result',
        usage: {
          input_tokens: 15_000,
          output_tokens: 2_500,
          total_tokens: 17_500,
        },
      },
    ], 'wait_after_usage')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
      currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      const inputRes = await app.request(
        `/api/beegame-sessions/${session.id}/input`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Continue the project.', taskType: 'edit_turn' }),
        },
      )
      expect(inputRes.status).toBe(200)

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some((event: { payload?: { usage?: unknown } }) => Boolean(event.payload?.usage))
      })

      const stopRes = await app.request(
        `/api/beegame-sessions/${session.id}/stop`,
        { method: 'POST' },
      )
      expect(stopRes.status).toBe(200)

      await waitFor(() => listCreditLedger(DEFAULT_LOCAL_USER_ID, { dataDir: projectsRoot }).length >= 3)

      expect(listCreditLedger(DEFAULT_LOCAL_USER_ID, { dataDir: projectsRoot })
        .map(entry => ({
          kind: entry.kind,
          credits: entry.credits,
          weightedTokens: entry.weightedTokens,
          projectId: entry.projectId,
        }))).toEqual([
        {
          kind: 'reserve',
          credits: 50,
          weightedTokens: undefined,
          projectId: session.id,
        },
        {
          kind: 'settle',
          credits: 2,
          weightedTokens: 17_500,
          projectId: session.id,
        },
        {
          kind: 'refund',
          credits: 48,
          weightedTokens: undefined,
          projectId: session.id,
        },
      ])
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('refunds the reservation when the user stops during a permission wait', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-credit-permission-stop-'))
    const workspace = join(projectsRoot, 'credit-permission-game')
    await mkdir(workspace, { recursive: true })
    const fake = createFakeRunner(undefined, 'dangerous_bash_permission')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
      currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      const inputRes = await app.request(
        `/api/beegame-sessions/${session.id}/input`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Continue the project.', taskType: 'edit_turn' }),
        },
      )
      expect(inputRes.status).toBe(200)

      await waitFor(async () => {
        const eventsRes = await app.request(
          `/api/beegame-sessions/${session.id}/events`,
        )
        const events = await eventsRes.json()
        return events.some(
          (event: { type: string }) => event.type === 'permission.requested',
        )
      })

      const stopRes = await app.request(
        `/api/beegame-sessions/${session.id}/stop`,
        { method: 'POST' },
      )
      expect(stopRes.status).toBe(200)

      await waitFor(() => listCreditLedger(DEFAULT_LOCAL_USER_ID, { dataDir: projectsRoot }).length >= 2)

      expect(listCreditLedger(DEFAULT_LOCAL_USER_ID, { dataDir: projectsRoot })
        .map(entry => ({ kind: entry.kind, credits: entry.credits, projectId: entry.projectId })))
        .toEqual([
          { kind: 'reserve', credits: 50, projectId: session.id },
          { kind: 'refund', credits: 50, projectId: session.id },
        ])
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
      currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
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
        return events.some((event: { type: string }) =>
          event.type === 'turn.completed' || event.type === 'turn.empty'
        )
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
      currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
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
        return events.some((event: { type: string }) =>
          event.type === 'turn.completed' || event.type === 'turn.empty'
        )
      })

      expect(fake.starts[0]?.env).toEqual(expect.objectContaining({
        BEEGAME_CONFIG_DIR: expect.stringContaining('.runtime/app'),
        BEEGAME_PROJECT_CONFIG_DIR_NAME: '.beegame',
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
        FEATURE_TREE_SITTER_BASH: '1',
        FEATURE_WEB_BROWSER_TOOL: '1',
        FEATURE_BASH_CLASSIFIER: '1',
        FEATURE_MCP_SKILLS: '1',
      }))
      expect(fake.starts[0]?.env).not.toHaveProperty('SKILL_SEARCH_ENABLED')
      expect(fake.starts[0]?.env.CLAUDE_CONFIG_DIR).toContain('.runtime/app')
      expect(fake.starts[0]?.env.CLAUDE_CONFIG_DIR).not.toMatch(/claude/i)
      await expect(readFile(
        join(fake.starts[0]!.env.CLAUDE_CONFIG_DIR, 'settings.json'),
        'utf8',
      )).resolves.toContain('"skillSearchEnabled": true')
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('cleans empty runtime directories after a BeeGame turn', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-runtime-cleanup-'))
    const workspace = join(projectsRoot, 'runtime-cleanup-game')
    const fake = createFakeRunner(undefined, 'runtime_empty_dirs')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
      currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
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
        body: JSON.stringify({ autoMemoryEnabled: true }),
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
        body: JSON.stringify({ text: 'Create runtime placeholders.' }),
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

      const runtimeRoot = join(projectsRoot, '.runtime')
      expect(
        await fsPathExists(join(runtimeRoot, 'app', '.dashboard-write-test')),
      ).toBe(false)
      expect(await fsPathExists(join(runtimeRoot, 'app', 'modes'))).toBe(false)
      expect(await fsPathExists(join(runtimeRoot, 'app', 'plans'))).toBe(false)
      expect(await fsPathExists(join(runtimeRoot, 'app', 'session-env'))).toBe(false)
      expect(
        await readFile(
          join(runtimeRoot, 'app', 'projects', 'project-with-files', 'run.jsonl'),
          'utf8',
        ),
      ).toBe('{}\n')
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('injects Supabase-backed runtime settings into new BeeGame turns', async () => {
    const originalUrl = process.env.BEEGAME_SUPABASE_URL
    const originalAnonKey = process.env.BEEGAME_SUPABASE_ANON_KEY
    const originalFetch = globalThis.fetch
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-supabase-runtime-'))
    const workspace = join(projectsRoot, 'supabase-runtime-game')
    const fake = createFakeRunner(undefined, 'build_write_complete')
    try {
      process.env.BEEGAME_SUPABASE_URL = 'https://project.supabase.co'
      process.env.BEEGAME_SUPABASE_ANON_KEY = 'anon-key'
      globalThis.fetch = (async (input, init) => {
        const requestUrl = String(input)
        if (requestUrl.includes('/rest/v1/rpc/beegame_runtime_env')) {
          return Response.json({
            env: {
              WEB_SEARCH_ADAPTER: 'brave',
              BRAVE_SEARCH_API_KEY: 'bsa-supabase-secret',
              FEATURE_WEB_BROWSER_TOOL: '1',
              FEATURE_BASH_CLASSIFIER: '1',
              BEEGAME_RUNTIME_SETTINGS_JSON: JSON.stringify({
                autoMemoryEnabled: false,
                autoDreamEnabled: true,
                skillSearchEnabled: true,
                webBrowserToolEnabled: true,
                bashClassifierEnabled: true,
              }),
            },
          })
        }
        if (requestUrl.includes('/rest/v1/beegame_sessions')) {
          if (init?.method === 'POST') return Response.json([JSON.parse(String(init.body))])
          return Response.json([])
        }
        if (requestUrl.includes('/rest/v1/rpc/beegame_reserve_credits')) {
          return Response.json({
            reservation_id: '33333333-3333-3333-3333-333333333333',
            reserved_credits: 50,
            account: {
              user_id: '00000000-0000-0000-0000-000000000001',
              plan: 'free',
              included_credits: 300,
              consumed_credits: 0,
              reserved_credits: 50,
              updated_at: '2026-06-27T00:00:00.000Z',
            },
          })
        }
        if (requestUrl.includes('/rest/v1/rpc/beegame_settle_credit_reservation')) {
          return Response.json({
            reservation_id: '33333333-3333-3333-3333-333333333333',
            reserved_credits: 50,
            settled_credits: 1,
            refunded_credits: 49,
            account: {
              user_id: '00000000-0000-0000-0000-000000000001',
              plan: 'free',
              included_credits: 300,
              consumed_credits: 1,
              reserved_credits: 0,
              updated_at: '2026-06-27T00:00:00.000Z',
            },
          })
        }
        if (requestUrl.includes('/rest/v1/beegame_credit_accounts')) {
          return Response.json([{
            user_id: '00000000-0000-0000-0000-000000000001',
            plan: 'free',
            included_credits: 300,
            consumed_credits: 0,
            reserved_credits: 0,
            updated_at: '2026-06-27T00:00:00.000Z',
          }])
        }
        if (requestUrl.includes('/rest/v1/beegame_credit_ledger')) {
          if (init?.method === 'POST') {
            return Response.json([{
              created_at: '2026-06-27T00:00:00.000Z',
              ...JSON.parse(String(init.body)),
            }])
          }
          return Response.json([])
        }
        return new Response('Not found', { status: 404 })
      }) as typeof fetch
      const app = createAgentWorkflowApp({
        sessionRunner: fake.runner,
        defaultWorkspacePath: projectsRoot,
        currentUser: {
          id: '00000000-0000-0000-0000-000000000001',
          role: 'owner',
        },
      })

      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer user-token',
        },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer user-token',
        },
        body: JSON.stringify({ text: 'Build with Supabase runtime settings.' }),
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
        BRAVE_SEARCH_API_KEY: 'bsa-supabase-secret',
        FEATURE_WEB_BROWSER_TOOL: '1',
        FEATURE_BASH_CLASSIFIER: '1',
      }))
      expect(fake.starts[0]?.env).not.toHaveProperty('SKILL_SEARCH_ENABLED')
      expect(fake.starts[0]?.env.BEEGAME_RUNTIME_SETTINGS_JSON).toBeUndefined()
      await expect(readFile(
        join(
          projectsRoot,
          'users',
          '00000000-0000-0000-0000-000000000001',
          '.runtime',
          'app',
          'settings.json',
        ),
        'utf8',
      )).resolves.toContain('"autoDreamEnabled": true')
      await expect(readFile(
        join(
          projectsRoot,
          'users',
          '00000000-0000-0000-0000-000000000001',
          '.runtime',
          'app',
          'settings.json',
        ),
        'utf8',
      )).resolves.toContain('"skillSearchEnabled": true')
    } finally {
      globalThis.fetch = originalFetch
      if (originalUrl === undefined) {
        delete process.env.BEEGAME_SUPABASE_URL
      } else {
        process.env.BEEGAME_SUPABASE_URL = originalUrl
      }
      if (originalAnonKey === undefined) {
        delete process.env.BEEGAME_SUPABASE_ANON_KEY
      } else {
        process.env.BEEGAME_SUPABASE_ANON_KEY = originalAnonKey
      }
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

  test('rejects BeeGame session model configs owned by another user', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-model-owner-'))
    const ownerAWorkspace = join(projectsRoot, 'owner-a-game')
    const ownerBWorkspace = join(projectsRoot, 'owner-b-game')
    const fake = createFakeRunner(undefined, 'build_write_complete')
    const ownerAModel = createModelConfig('owner-a', {
      name: 'Owner A LLM',
      provider: 'openai-compatible',
      baseUrl: 'https://owner-a.example.invalid/v1',
      apiKey: 'sk-owner-a',
      models: { balanced: 'owner-a-model' },
    })
    const ownerBModel = createModelConfig('owner-b', {
      name: 'Owner B LLM',
      provider: 'openai-compatible',
      baseUrl: 'https://owner-b.example.invalid/v1',
      apiKey: 'sk-owner-b',
      models: { balanced: 'owner-b-model' },
    })
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
      currentUserResolver: request => {
        const token = request.headers.get('authorization')
        if (token === 'Bearer owner-a-token') return { id: 'owner-a', role: 'owner' }
        if (token === 'Bearer owner-b-token') return { id: 'owner-b', role: 'owner' }
        return undefined
      },
    })
    try {
      const crossOwnerStartRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: {
          authorization: 'Bearer owner-a-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          workspacePath: ownerAWorkspace,
          modelConfigId: ownerBModel.id,
        }),
      })
      expect(crossOwnerStartRes.status).toBe(400)
      expect(await crossOwnerStartRes.json()).toEqual({
        error: 'Model config not found',
      })

      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: {
          authorization: 'Bearer owner-a-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          workspacePath: ownerAWorkspace,
          modelConfigId: ownerAModel.id,
        }),
      })
      expect(sessionRes.status).toBe(200)
      const session = await sessionRes.json()

      const crossOwnerUpdateRes = await app.request(
        `/api/beegame-sessions/${session.id}/model`,
        {
          method: 'PATCH',
          headers: {
            authorization: 'Bearer owner-a-token',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ modelConfigId: ownerBModel.id }),
        },
      )
      expect(crossOwnerUpdateRes.status).toBe(404)
      expect(await crossOwnerUpdateRes.json()).toEqual({
        error: 'Model config not found',
      })

      const ownerBStartRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: {
          authorization: 'Bearer owner-b-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          workspacePath: ownerBWorkspace,
          modelConfigId: ownerBModel.id,
        }),
      })
      expect(ownerBStartRes.status).toBe(200)
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
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const sessionError = sessionRes.status === 200
        ? undefined
        : await sessionRes.clone().json()
      expect({ status: sessionRes.status, error: sessionError }).toEqual({
        status: 200,
        error: undefined,
      })
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
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'private reasoning' },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_stop',
          index: 0,
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
      expect(JSON.stringify(events)).not.toContain('private reasoning')
      expect(
        events.filter((event: { type: string }) => event.type === 'assistant.thinking'),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            text: 'Thinking',
            payload: expect.objectContaining({
              type: 'assistant.thinking',
              status: 'started',
            }),
          }),
          expect.objectContaining({
            text: 'Thinking',
            payload: expect.objectContaining({
              type: 'assistant.thinking',
              status: 'ended',
            }),
          }),
        ]),
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
      let transcript: Array<{ type: string; text: string }> = []
      await waitFor(async () => {
        const transcriptRes = await restartedApp.request(
          `/api/beegame-sessions/${session.id}/transcript?workspacePath=${encodeURIComponent(workspace)}`,
        )
        expect(transcriptRes.status).toBe(200)
        transcript = await transcriptRes.json()
        return transcript.some(event =>
          event.type === 'assistant.message' &&
          event.text === 'Subagent audit found the core loop issue.',
        )
      })
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
            text: `${legacyTitle} Code created this in ${legacyPath}. Run ${legacyLower} sample game.`,
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
        if (!Array.isArray(events)) return false
        return events.some((event: { type: string }) => event.type === 'turn.completed')
      })

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const serialized = JSON.stringify(await eventsRes.json())
      expect(serialized).not.toContain(legacyTitle)
      expect(serialized).toContain(
        `BeeGame created this in ${legacyPath}. Run BeeGame sample game.`,
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

  test('returns project runtime state from backend-owned BeeGame session state', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'dangerous_bash_permission')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const projectId = 'project_runtime_state'
      const projectRes = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: projectId,
          name: 'Runtime State',
          root_path: workspace,
          created_at: Date.now(),
        }),
      })
      expect(projectRes.status).toBe(200)
      const ensureRes = await app.request(
        `/api/projects/${projectId}/session/ensure`,
        { method: 'POST' },
      )
      expect(ensureRes.status).toBe(200)
      const ensured = await ensureRes.json()
      await app.request(`/api/beegame-sessions/${ensured.session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Build the project.' }),
      })

      await waitFor(async () => {
        const stateRes = await app.request(`/api/projects/${projectId}/runtime-state`)
        const state = await stateRes.json()
        return state.approval_required === true
      })

      const stateRes = await app.request(`/api/projects/${projectId}/runtime-state`)
      const state = await stateRes.json()
      expect(stateRes.status).toBe(200)
      expect(state).toEqual(expect.objectContaining({
        project_id: projectId,
        phase: 'waiting_approval',
        blocked: true,
        approval_required: true,
        active_agents: ['beegame'],
      }))
      expect(state.context).toEqual(expect.objectContaining({
        token_budget: expect.objectContaining({
          status: 'tracking',
        }),
      }))
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('uses the live project session workspace when runtime state includes preview data', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-runtime-state-root-'))
    const staleProjectRoot = join(projectsRoot, 'stale-root')
    const liveWorkspace = join(projectsRoot, 'live-root')
    await mkdir(staleProjectRoot, { recursive: true })
    await mkdir(liveWorkspace, { recursive: true })
    const previewRunner: BeeGamePreviewRunner = (_command, options) => {
      options.onOutput('Local: http://127.0.0.1:63210/\n')
      return {
        kill: () => {},
        exited: new Promise(() => {}),
      }
    }
    const app = createAgentWorkflowApp({
      sessionRunner: createFakeRunner().runner,
      defaultWorkspacePath: projectsRoot,
      previewRunner,
      previewPortAllocator: async () => 63210,
      previewReadinessProbe: async () => true,
    })
    try {
      const projectId = 'project_runtime_state_live_workspace'
      const projectRes = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: projectId,
          name: 'Runtime State Live Workspace',
          root_path: staleProjectRoot,
          created_at: Date.now(),
        }),
      })
      expect(projectRes.status).toBe(200)
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId,
          workspacePath: liveWorkspace,
        }),
      })
      expect(sessionRes.status).toBe(200)
      const session = await sessionRes.json()
      await writeFile(
        join(liveWorkspace, 'package.json'),
        JSON.stringify({
          scripts: { dev: 'vite --host 127.0.0.1' },
          devDependencies: { vite: '^5.0.0' },
        }),
      )
      const previewRes = await app.request(
        `/api/beegame-sessions/${session.id}/preview`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ workspacePath: liveWorkspace }),
        },
      )
      expect(previewRes.status).toBe(200)

      const stateRes = await app.request(`/api/projects/${projectId}/runtime-state`)
      const state = await stateRes.json()
      expect(stateRes.status).toBe(200)
      expect(state.build_report).toEqual(expect.objectContaining({
        status: 'passed',
        build_url: `/previews/${session.id}/`,
      }))
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('returns and resolves project-scoped permission requests without exposing session binding decisions', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'dangerous_bash_permission')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const projectId = 'project_scoped_permission'
      const projectRes = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: projectId,
          name: 'Project Scoped Permission',
          root_path: workspace,
          created_at: Date.now(),
        }),
      })
      expect(projectRes.status).toBe(200)
      const ensureRes = await app.request(
        `/api/projects/${projectId}/session/ensure`,
        { method: 'POST' },
      )
      const ensured = await ensureRes.json()
      await app.request(`/api/beegame-sessions/${ensured.session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Run validation.' }),
      })

      await waitFor(async () => {
        const stateRes = await app.request(`/api/projects/${projectId}/runtime-state`)
        const state = await stateRes.json()
        return Array.isArray(state.pending_permissions) && state.pending_permissions.length === 1
      })

      const stateRes = await app.request(`/api/projects/${projectId}/runtime-state`)
      const state = await stateRes.json()
      expect(state.pending_permissions).toEqual([
        expect.objectContaining({
          id: 'tool_1',
          session_id: ensured.session.id,
          tool_name: 'Bash',
        }),
      ])

      const resolveRes = await app.request(
        `/api/projects/${projectId}/permissions/tool_1`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ decision: 'allow' }),
        },
      )
      expect(resolveRes.status).toBe(200)
      await waitFor(() => fake.runtimes[0]?.permissionResults[0] === 'allow')
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('manages preview and deployment through project-scoped runtime routes', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const previewRunner: BeeGamePreviewRunner = (_command, options) => {
      options.onOutput('Local: http://127.0.0.1:63220/\n')
      return {
        kill: () => {},
        exited: new Promise(() => {}),
      }
    }
    const deploymentRunner: BeeGameDeploymentRunner = async (_command, options) => {
      await mkdir(join(options.cwd, 'dist'), { recursive: true })
      await writeFile(join(options.cwd, 'dist', 'index.html'), '<main>Project route</main>')
      return { exitCode: 0, stdout: 'built', stderr: '' }
    }
    const app = createAgentWorkflowApp({
      sessionRunner: createFakeRunner().runner,
      defaultWorkspacePath: projectsRoot,
      previewRunner,
      previewPortAllocator: async () => 63220,
      previewReadinessProbe: async () => true,
      deploymentRunner,
    })
    try {
      const projectId = 'project_scoped_preview_deploy'
      const projectRes = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: projectId,
          name: 'Project Scoped Preview Deploy',
          root_path: workspace,
          created_at: Date.now(),
        }),
      })
      expect(projectRes.status).toBe(200)
      await writeFile(
        join(workspace, 'package.json'),
        JSON.stringify({
          scripts: {
            dev: 'vite --host 127.0.0.1',
            build: 'vite build',
          },
          devDependencies: { vite: '^5.0.0' },
        }),
      )

      const previewRes = await app.request(
        `/api/projects/${projectId}/preview`,
        { method: 'POST' },
      )
      const preview = await previewRes.json()
      expect(previewRes.status).toBe(200)
      expect(preview).toEqual(expect.objectContaining({
        status: 'running',
        url: `/previews/${preview.sessionId}/`,
      }))

      const deployRes = await app.request(
        `/api/projects/${projectId}/deployments`,
        { method: 'POST' },
      )
      expect(deployRes.status).toBe(200)
      const deployment = await deployRes.json()
      expect(deployment).toEqual(expect.objectContaining({
        status: 'succeeded',
        projectId,
      }))

      await mkdir(join(workspace, 'assets'), { recursive: true })
      await writeFile(
        join(workspace, 'assets', 'asset-manifest.json'),
        JSON.stringify({
          version: 1,
          slots: [{
            id: 'title_logo',
            name: 'Title logo',
            type: 'image_2d',
            target: { path: 'public/assets/title-logo.png' },
          }],
        }),
      )
      const assetsRes = await app.request(`/api/projects/${projectId}/assets`)
      expect(assetsRes.status).toBe(200)
      expect(await assetsRes.json()).toEqual(expect.objectContaining({
        slots: [expect.objectContaining({ id: 'title_logo' })],
      }))

      const form = new FormData()
      form.set('file', new File(['logo-bytes'], 'title-logo.png', { type: 'image/png' }))
      const uploadRes = await app.request(
        `/api/projects/${projectId}/assets/title_logo/upload`,
        { method: 'POST', body: form },
      )
      const upload = await uploadRes.json()
      expect(uploadRes.status).toBe(200)
      expect(upload).toEqual(expect.objectContaining({
        path: 'public/assets/title-logo.png',
      }))
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('automatically binds contract-defined resources without inferring asset categories', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-auto-resource-binding-'))
    const workspace = join(projectsRoot, 'auto-bound-project')
    const app = createAgentWorkflowApp({
      sessionRunner: createFakeRunner().runner,
      defaultWorkspacePath: projectsRoot,
      resourceSelectionClient: {
        select: async requirements => requirements.map(requirement => ({
          slotId: requirement.slotId,
          packId: 'library-pack',
          packVersion: '1.0.0',
          elementId: 'library-model',
          elementPath: 'models/library-model.glb',
          sourceUrl: 'https://resource.example/signed/library-model.glb',
          score: 100,
          reasons: ['category:models', 'status:ready'],
        })),
      },
    })
    try {
      await mkdir(join(workspace, 'assets'), { recursive: true })
      await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
        version: 1,
        project_target: { integration_mode: 'mcp', asset_format_capabilities: ['glb'] },
        slots: [{
          id: 'slot-1',
          name: 'A deliberately unrelated label',
            resource_requirement: { category: 'models', dimension: '3D', accepted_formats: ['glb'], tags: ['environment'] },
        }],
      }))
      const projectId = 'project_auto_resource_binding'
      const projectRes = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: projectId, name: 'Auto Resource Binding', root_path: workspace, created_at: Date.now() }),
      })
      expect(projectRes.status).toBe(200)

      const response = await app.request(`/api/projects/${projectId}/assets/resource-bindings/auto`, { method: 'POST' })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(expect.objectContaining({
        results: [expect.objectContaining({ slotId: 'slot-1', status: 'bound', packId: 'library-pack' })],
        unmatched_slot_ids: [],
      }))
      const manifest = JSON.parse(await readFile(join(workspace, 'assets', 'asset-manifest.json'), 'utf8'))
      expect(manifest.slots[0].resource_binding).toEqual(expect.objectContaining({
        pack_id: 'library-pack', element_id: 'library-model',
      }))
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('leaves an untagged automatic resource slot unmatched instead of choosing a generic format match', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-auto-resource-safety-'))
    const workspace = join(projectsRoot, 'safe-auto-bound-project')
    let selectionCalls = 0
    const app = createAgentWorkflowApp({
      sessionRunner: createFakeRunner().runner,
      defaultWorkspacePath: projectsRoot,
      resourceSelectionClient: {
        select: async () => {
          selectionCalls += 1
          return []
        },
      },
    })
    try {
      await mkdir(join(workspace, 'assets'), { recursive: true })
      await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
        version: 1,
        slots: [{ id: 'unclassified-model', resource_requirement: { category: 'models', accepted_formats: ['glb'] } }],
      }))
      const projectId = 'project_auto_resource_safety'
      await app.request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: projectId, name: 'Safe Auto Resource Binding', root_path: workspace, created_at: Date.now() }),
      })

      const response = await app.request(`/api/projects/${projectId}/assets/resource-bindings/auto`, { method: 'POST' })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(expect.objectContaining({ results: [], unmatched_slot_ids: ['unclassified-model'] }))
      expect(selectionCalls).toBe(0)
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('reports only the current user projects bound to a Pack version', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-resource-impact-'))
    const workspace = join(projectsRoot, 'impact-project')
    const app = createAgentWorkflowApp({ sessionRunner: createFakeRunner().runner, defaultWorkspacePath: projectsRoot })
    try {
      await mkdir(join(workspace, 'assets'), { recursive: true })
      await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
        version: 1,
        slots: [{ id: 'hero', status: 'integrated', resource_binding: { pack_id: 'forest-pack', pack_version: '2.0.0', element_id: 'tree', source_url: 'https://resource.example/tree', selected_at: '2026-07-11T00:00:00.000Z', selection_reason: [] } }],
      }))
      const projectId = 'project_resource_impact'
      const created = await app.request('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: projectId, name: 'Impact Project', root_path: workspace, created_at: Date.now() }) })
      expect(created.status).toBe(200)

      const response = await app.request('/api/resource-packs/forest-pack/impact')
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ packId: 'forest-pack', projectCount: 1, references: [expect.objectContaining({ projectId, slotId: 'hero', packVersion: '2.0.0', elementId: 'tree', status: 'integrated' })] })
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('only binds a resource candidate re-derived from the project asset contract', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-explicit-resource-candidate-'))
    const workspace = join(projectsRoot, 'explicit-resource-project')
    const candidateRequirements: Array<{ slotId: string; category?: string }> = []
    const candidate = {
      slotId: 'slot-1',
      packId: 'library-pack',
      packVersion: '1.0.0',
      elementId: 'library-model',
      elementPath: 'models/library-model.glb',
      sourceUrl: 'https://resource.example/signed/library-model.glb',
      score: 100,
      reasons: ['category:models', 'status:ready'],
    }
    const app = createAgentWorkflowApp({
      sessionRunner: createFakeRunner().runner,
      defaultWorkspacePath: projectsRoot,
      resourceSelectionClient: {
        select: async () => [candidate],
        candidates: async requirement => {
          candidateRequirements.push(requirement)
          return [{ ...candidate, slotId: requirement.slotId }]
        },
      },
    })
    try {
      await mkdir(join(workspace, 'assets'), { recursive: true })
      await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
        version: 1,
        project_target: { integration_mode: 'mcp', asset_format_capabilities: ['glb'] },
        slots: [{
          id: 'slot-1',
          resource_requirement: { category: 'models', dimension: '3D', accepted_formats: ['glb'] },
        }],
      }))
      const projectId = 'project_explicit_resource_candidate'
      const projectRes = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: projectId, name: 'Explicit Resource Candidate', root_path: workspace, created_at: Date.now() }),
      })
      expect(projectRes.status).toBe(200)

      const candidatesRes = await app.request(`/api/projects/${projectId}/assets/slot-1/resource-candidates`)
      expect(candidatesRes.status).toBe(200)
      expect(await candidatesRes.json()).toEqual({ candidates: [candidate] })

      const bindRes = await app.request(`/api/projects/${projectId}/assets/slot-1/resource-binding`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          // This conflicting client requirement must be ignored in favour of the contract.
          requirement: { slotId: 'slot-1', category: 'audio', accepted_formats: ['wav'] },
          selection: { packId: candidate.packId, elementId: candidate.elementId },
        }),
      })
      expect(bindRes.status).toBe(200)
      expect(await bindRes.json()).toEqual(expect.objectContaining({
        selection: expect.objectContaining({ packId: candidate.packId, elementId: candidate.elementId }),
      }))
      expect(candidateRequirements.at(-1)).toEqual(expect.objectContaining({ slotId: 'slot-1', category: 'models' }))

      const forgedRes = await app.request(`/api/projects/${projectId}/assets/slot-1/resource-binding`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selection: { packId: candidate.packId, elementId: 'forged-element' } }),
      })
      expect(forgedRes.status).toBe(422)
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('loads project asset manifest from project root without requiring a live session', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-project-assets-root-'))
    const workspace = join(projectsRoot, 'asset-root-project')
    const app = createAgentWorkflowApp({
      sessionRunner: createFakeRunner().runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const projectId = 'project_asset_manifest_root'
      await mkdir(join(workspace, 'assets'), { recursive: true })
      await writeFile(
        join(workspace, 'assets', 'asset-manifest.json'),
        JSON.stringify({
          version: 1,
          project_target: {
            kind: 'web',
            integration_mode: 'filesystem',
          },
          slots: [{
            id: 'hero_background',
            name: 'Hero background',
            type: 'image_2d',
            purpose: 'Landing screen background',
            target: { path: 'public/assets/hero-background.png' },
          }],
        }),
      )

      const projectRes = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: projectId,
          name: 'Asset Manifest Root',
          root_path: workspace,
          created_at: Date.now(),
        }),
      })
      expect(projectRes.status).toBe(200)

      const assetsRes = await app.request(`/api/projects/${projectId}/assets`)
      const assets = await assetsRes.json()

      expect(assetsRes.status).toBe(200)
      expect(assets).toEqual(expect.objectContaining({
        project_target: expect.objectContaining({
          integration_mode: 'filesystem',
        }),
        slots: [
          expect.objectContaining({
            id: 'hero_background',
            target: expect.objectContaining({
              path: 'public/assets/hero-background.png',
            }),
          }),
        ],
      }))
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('ensures project sessions without requiring frontend restore decisions', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const app = createAgentWorkflowApp({
      sessionRunner: createFakeRunner().runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const projectId = 'project_backend_ensure'
      const projectRes = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: projectId,
          name: 'Backend Ensure',
          root_path: workspace,
          created_at: Date.now(),
        }),
      })
      expect(projectRes.status).toBe(200)

      const firstRes = await app.request(
        `/api/projects/${projectId}/session/ensure`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ language: 'zh' }),
        },
      )
      expect(firstRes.status).toBe(200)
      const first = await firstRes.json()
      const secondRes = await app.request(
        `/api/projects/${projectId}/session/ensure`,
        { method: 'POST' },
      )
      const second = await secondRes.json()

      expect(secondRes.status).toBe(200)
      expect(second.session.id).toBe(first.session.id)
      const expectedWorkspace = await realpath(workspace)
      expect(second.binding).toEqual({
        projectId,
        sessionId: first.session.id,
        workspacePath: expectedWorkspace,
      })
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('recovers an unclosed transcript-only turn as idle after backend restart', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const sessionId = 'beegame_recovered_unclosed_turn'
    const turnId = `${sessionId}-turn-1`
    const transcriptPath = getTestTranscriptPath(workspace, workspace, sessionId)
    const app = createAgentWorkflowApp()
    try {
      await mkdir(dirname(transcriptPath), { recursive: true })
      const now = new Date().toISOString()
      await writeFile(
        transcriptPath,
        [
          {
            id: 1,
            sessionId,
            type: 'session.started',
            text: 'Created BeeGame session',
            createdAt: now,
          },
          {
            id: 2,
            sessionId,
            turnId,
            type: 'turn.started',
            text: 'Turn started',
            createdAt: now,
          },
          {
            id: 3,
            sessionId,
            turnId,
            type: 'assistant.message',
            text: 'The turn produced a final response.',
            payload: {
              type: 'assistant',
              usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
            },
            createdAt: now,
          },
          {
            id: 4,
            sessionId,
            turnId,
            type: 'system.status',
            text: 'Credit refund is pending',
            payload: { type: 'credit.refund_pending' },
            createdAt: now,
          },
        ].map(event => JSON.stringify(event)).join('\n') + '\n',
        'utf8',
      )

      const snapshotRes = await app.request(
        `/api/beegame-sessions/${sessionId}/runtime-snapshot?workspacePath=${encodeURIComponent(workspace)}`,
      )
      const snapshot = await snapshotRes.json()

      expect(snapshotRes.status).toBe(200)
      expect(snapshot).toEqual(expect.objectContaining({
        phaseName: 'idle',
        phaseStatus: 'idle',
        usage: expect.objectContaining({ total_tokens: 15 }),
      }))
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('reconciles pending session credit refunds for the current user', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-pending-credit-'))
    const projectDir = join(workspace, 'project-one')
    const sessionId = 'beegame_pending_credit_refund'
    const turnId = `${sessionId}-turn-1`
    const transcriptPath = getTestTranscriptPath(workspace, projectDir, sessionId)
    const app = createAgentWorkflowApp({
      dashboardDataRoot: workspace,
      defaultWorkspacePath: workspace,
    })
    try {
      const reservation = reserveCredits(DEFAULT_LOCAL_USER_ID, {
        dataDir: workspace,
        credits: 8,
        kind: 'edit_turn',
        projectId: sessionId,
      })
      await mkdir(projectDir, { recursive: true })
      await mkdir(dirname(transcriptPath), { recursive: true })
      const now = new Date().toISOString()
      await writeFile(
        transcriptPath,
        [
          {
            id: 1,
            sessionId,
            type: 'session.started',
            text: 'Created BeeGame session',
            createdAt: now,
          },
          {
            id: 2,
            sessionId,
            turnId,
            type: 'turn.started',
            text: 'Turn started',
            createdAt: now,
          },
          {
            id: 3,
            sessionId,
            turnId,
            type: 'system.status',
            text: 'Credit refund is pending',
            payload: {
              type: 'credit.refund_pending',
              reservationId: reservation.id,
              pendingCreditOperation: {
                kind: 'refund',
                reservation,
              },
            },
            createdAt: now,
          },
        ].map(event => JSON.stringify(event)).join('\n') + '\n',
        'utf8',
      )

      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspacePath: projectDir,
          transcriptSessionId: sessionId,
        }),
      })
      expect(sessionRes.status).toBe(200)

      const reconcileRes = await app.request(
        '/api/credits/reconcile-pending-session-operations',
        { method: 'POST' },
      )

      expect(reconcileRes.status).toBe(200)
      expect(await reconcileRes.json()).toEqual({
        attempted: 1,
        succeeded: [sessionId],
        failed: [],
      })
      expect(listCreditLedger(DEFAULT_LOCAL_USER_ID, { dataDir: workspace }))
        .toContainEqual(expect.objectContaining({
          kind: 'refund',
          credits: 8,
          reservationId: reservation.id,
          metadata: expect.objectContaining({
            reason: 'turn_finished_without_billable_usage',
            retry: true,
          }),
        }))
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('returns recovered transcript-only interrupted turns as closed', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-recovered-transcript-'))
    const sessionId = 'beegame_recovered_transcript_interrupted'
    const turnId = `${sessionId}-turn-1`
    const transcriptPath = getTestTranscriptPath(workspace, workspace, sessionId)
    const app = createAgentWorkflowApp()
    try {
      await mkdir(dirname(transcriptPath), { recursive: true })
      const now = new Date().toISOString()
      await writeFile(
        transcriptPath,
        [
          {
            id: 1,
            sessionId,
            type: 'session.started',
            text: 'Created BeeGame session',
            createdAt: now,
          },
          {
            id: 2,
            sessionId,
            turnId,
            type: 'turn.started',
            text: 'Turn started',
            createdAt: now,
          },
          {
            id: 3,
            sessionId,
            turnId,
            type: 'permission.resolved',
            text: 'Bash: allow',
            payload: {
              type: 'permission.resolved',
              toolUseID: 'tool_global_process_control',
              toolName: 'Bash',
              decision: 'allow',
            },
            createdAt: now,
          },
        ].map(event => JSON.stringify(event)).join('\n') + '\n',
        'utf8',
      )

      const transcriptRes = await app.request(
        `/api/beegame-sessions/${sessionId}/transcript?workspacePath=${encodeURIComponent(workspace)}`,
      )
      const events = await transcriptRes.json()

      expect(transcriptRes.status).toBe(200)
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 4,
          sessionId,
          turnId,
          type: 'turn.failed',
          text: expect.stringContaining('interrupted'),
        }),
      ]))
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('archives an interrupted recovered turn before resuming a live session', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-resume-interrupted-'))
    const sessionId = 'beegame_interrupted_resume'
    const turnId = `${sessionId}-turn-1`
    const transcriptPath = getTestTranscriptPath(workspace, workspace, sessionId)
    const app = createAgentWorkflowApp()
    try {
      await mkdir(dirname(transcriptPath), { recursive: true })
      const now = new Date().toISOString()
      await writeFile(
        transcriptPath,
        [
          {
            id: 1,
            sessionId,
            type: 'session.started',
            text: 'Created BeeGame session',
            createdAt: now,
          },
          {
            id: 2,
            sessionId,
            turnId,
            type: 'turn.started',
            text: 'Turn started',
            createdAt: now,
          },
          {
            id: 3,
            sessionId,
            turnId,
            type: 'tool.started',
            text: 'Bash',
            payload: {
              type: 'tool.started',
              toolUseID: 'tool_global_process_control',
              toolName: 'Bash',
              input: {},
            },
            createdAt: now,
          },
          {
            id: 4,
            sessionId,
            turnId,
            type: 'permission.resolved',
            text: 'Bash: allow',
            payload: {
              type: 'permission.resolved',
              toolUseID: 'tool_global_process_control',
              toolName: 'Bash',
              decision: 'allow',
            },
            createdAt: now,
          },
        ].map(event => JSON.stringify(event)).join('\n') + '\n',
        'utf8',
      )

      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace, transcriptSessionId: sessionId }),
      })
      const session = await sessionRes.json()
      const snapshotRes = await app.request(
        `/api/beegame-sessions/${session.id}/runtime-snapshot?workspacePath=${encodeURIComponent(workspace)}`,
      )
      const snapshot = await snapshotRes.json()
      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()

      expect(sessionRes.status).toBe(200)
      expect(snapshot).toEqual(expect.objectContaining({
        phaseName: 'idle',
        phaseStatus: 'idle',
      }))
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'turn.failed',
          turnId,
          text: expect.stringContaining('interrupted'),
        }),
      ]))
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
        body: JSON.stringify({ text: 'Create sample game immediately.' }),
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
        if (!Array.isArray(events)) return false
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
        body: JSON.stringify({ text: 'Create sample game immediately.' }),
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

  test('auto-denies global process control Bash commands without opening an approval gate', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-global-process-control-'))
    const fake = createFakeRunner(undefined, 'global_process_control_bash')
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
        body: JSON.stringify({ text: 'Stop the preview server.' }),
      })

      await waitFor(() => fake.runtimes[0]?.permissionResults[0] === 'deny')

      const eventsRes = await app.request(
        `/api/beegame-sessions/${session.id}/events`,
      )
      const events = await eventsRes.json()
      expect(fake.runtimes[0].permissionResults).toEqual(['deny'])
      expect(
        events.some((event: { type: string }) => event.type === 'permission.requested'),
      ).toBe(false)
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'permission.resolved',
            payload: expect.objectContaining({
              toolUseID: 'tool_global_process_control',
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

  test('auto-denies background Bash processes without opening an approval gate', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-background-process-'))
    const fake = createFakeRunner(undefined, 'background_process_bash')
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
        body: JSON.stringify({ text: 'Start a preview server.' }),
      })

      await waitFor(() => fake.runtimes[0]?.permissionResults[0] === 'deny')

      const eventsRes = await app.request(
        `/api/beegame-sessions/${session.id}/events`,
      )
      const events = await eventsRes.json()
      expect(fake.runtimes[0].permissionResults).toEqual(['deny'])
      expect(
        events.some((event: { type: string }) => event.type === 'permission.requested'),
      ).toBe(false)
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'permission.resolved',
            payload: expect.objectContaining({
              toolUseID: 'tool_background_process',
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

  test('stops a turn that keeps requesting Bash validation permissions', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-validation-loop-'))
    const fake = createFakeRunner(undefined, 'repeated_bash_validation_loop')
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
        body: JSON.stringify({ text: 'Keep checking the build.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some((event: { type: string }) => event.type === 'turn.failed')
      })

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.runtimes[0].permissionResults.length).toBeLessThan(12)
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'turn.failed',
            text: expect.stringContaining('too many Bash permission requests'),
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

  test('discovers and reads project artifacts after runtime session state is gone', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-restored-artifacts-'))
    const sessionId = 'beegame_restored_artifacts'
    const app = createAgentWorkflowApp({
      defaultWorkspacePath: workspace,
      currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
    })
    try {
      await mkdir(join(workspace, 'docs'), { recursive: true })
      await mkdir(join(workspace, 'transcripts'), { recursive: true })
      await mkdir(join(workspace, 'assets'), { recursive: true })
      await writeFile(join(workspace, 'docs', 'GDD.md'), '# GDD\n')
      await writeFile(join(workspace, 'transcripts', 'sample__abcdef12.jsonl'), '{}\n')
      await writeFile(join(workspace, 'assets', 'asset-manifest.json'), '{"version":1}\n')

      const indexRes = await app.request(
        `/api/beegame-sessions/${sessionId}/artifact-index?workspacePath=${encodeURIComponent(workspace)}`,
      )
      const artifactRes = await app.request(
        `/api/beegame-sessions/${sessionId}/artifacts?path=${encodeURIComponent('docs/GDD.md')}&workspacePath=${encodeURIComponent(workspace)}`,
      )

      expect(indexRes.status).toBe(200)
      expect(await indexRes.json()).toEqual([
        expect.objectContaining({
          path: 'assets/asset-manifest.json',
          artifact_type: 'Asset Manifest',
        }),
        expect.objectContaining({
          path: 'docs/GDD.md',
          artifact_type: 'Document',
        }),
        expect.objectContaining({
          path: 'transcripts/sample__abcdef12.jsonl',
          artifact_type: 'Transcript',
        }),
      ])
      expect(artifactRes.status).toBe(200)
      expect(await artifactRes.json()).toEqual({
        path: 'docs/GDD.md',
        content: '# GDD\n',
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('allows restored owned project artifacts outside the per-user data root', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-owned-restored-'))
    const workspace = join(projectsRoot, 'sample-restored-project')
    const sessionId = 'beegame_owned_restored_artifacts'
    const app = createAgentWorkflowApp({
      defaultWorkspacePath: projectsRoot,
      currentUser: { id: 'user-owned-restored', role: 'owner' },
    })
    try {
      await mkdir(join(workspace, 'docs'), { recursive: true })
      await writeFile(join(workspace, 'docs', 'GDD.md'), '# GDD\n')
      const projectRes = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'project-owned-restored',
          name: 'Sample Restored Project',
          root_path: workspace,
          created_at: '2026-06-21T00:00:00.000Z',
        }),
      })
      expect(projectRes.status).toBe(200)
      const projectsRes = await app.request('/api/projects')
      const projectsBody = await projectsRes.json()
      expect(projectsBody).toEqual([
        expect.objectContaining({ root_path: workspace }),
      ])

      const indexRes = await app.request(
        `/api/beegame-sessions/${sessionId}/artifact-index?workspacePath=${encodeURIComponent(workspace)}`,
      )

      expect(indexRes.status).toBe(200)
      expect(await indexRes.json()).toEqual([
        expect.objectContaining({
          path: 'docs/GDD.md',
          artifact_type: 'Document',
        }),
      ])

      const assetsRes = await app.request(
        `/api/beegame-sessions/${sessionId}/assets?workspacePath=${encodeURIComponent(workspace)}`,
      )
      expect(assetsRes.status).toBe(200)
      expect(await assetsRes.json()).toEqual({ version: 1, slots: [] })
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
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

  test('reads categorized asset contract slots from an owned project workspace', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-categorized-assets-'))
    const workspace = join(projectsRoot, 'categorized-project')
    const app = createAgentWorkflowApp({
      defaultWorkspacePath: projectsRoot,
      currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
    })
    try {
      await mkdir(join(workspace, 'assets'), { recursive: true })
      await writeFile(
        join(workspace, 'assets', 'asset-manifest.json'),
        JSON.stringify({
          version: '1.0.0',
          project: 'categorized-project',
          platform: 'web',
          engine: 'react-three-fiber',
          integration_mode: 'filesystem',
          categories: {
            textures_2d: {
              description: 'Block face textures',
              slots: [
                {
                  id: 'grass_top',
                  path: 'public/textures/grass_top.png',
                  spec: '16x16 PNG',
                  status: 'placeholder_procedural',
                  target: 'src/engine/textures.ts',
                },
              ],
            },
            audio: {
              description: 'Sound effects',
              slots: [
                {
                  id: 'sfx_break_block',
                  path: 'public/audio/sfx/break_block.ogg',
                  spec: 'OGG Vorbis',
                  status: 'not_implemented',
                  target: 'src/game/audio.ts',
                },
              ],
            },
          },
        }),
      )
      const createProjectRes = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'project_categorized_assets',
          name: 'Categorized Project',
          root_path: workspace,
          created_at: '2026-06-21T00:00:00.000Z',
        }),
      })
      expect(createProjectRes.status).toBe(200)

      const assetsRes = await app.request('/api/projects/project_categorized_assets/assets')

      expect(assetsRes.status).toBe(200)
      expect(await assetsRes.json()).toEqual(expect.objectContaining({
        project_target: expect.objectContaining({
          kind: 'web',
          engine: 'react-three-fiber',
          integration_mode: 'filesystem',
        }),
        slots: [
          expect.objectContaining({
            id: 'grass_top',
            type: 'textures_2d',
            purpose: 'Block face textures',
            target: expect.objectContaining({ path: 'public/textures/grass_top.png' }),
            recommended_specs: expect.objectContaining({ description: '16x16 PNG' }),
            status: 'placeholder',
          }),
          expect.objectContaining({
            id: 'sfx_break_block',
            type: 'audio',
            purpose: 'Sound effects',
            target: expect.objectContaining({ path: 'public/audio/sfx/break_block.ogg' }),
            recommended_specs: expect.objectContaining({ description: 'OGG Vorbis' }),
            status: 'missing',
          }),
        ],
      }))
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('mirrors project asset manifest metadata to Supabase when configured', async () => {
    const originalUrl = process.env.BEEGAME_SUPABASE_URL
    const originalAnonKey = process.env.BEEGAME_SUPABASE_ANON_KEY
    const originalFetch = globalThis.fetch
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-assets-supabase-'))
    const workspace = join(projectsRoot, 'asset-metadata-project')
    const assetRows: Array<Record<string, unknown>> = []
    try {
      process.env.BEEGAME_SUPABASE_URL = 'https://project.supabase.co'
      process.env.BEEGAME_SUPABASE_ANON_KEY = 'anon-key'
      globalThis.fetch = (async (input, init) => {
        const requestUrl = String(input)
        if (requestUrl.includes('/rest/v1/beegame_sessions')) {
          if (init?.method === 'POST') return Response.json([JSON.parse(String(init.body))])
          return Response.json([])
        }
        if (requestUrl.includes('/rest/v1/beegame_assets')) {
          if (init?.method === 'POST') {
            const row = JSON.parse(String(init.body)) as Record<string, unknown>
            assetRows.push(row)
            return Response.json([{
              created_at: '2026-06-27T00:00:00.000Z',
              updated_at: '2026-06-27T00:00:00.000Z',
              ...row,
            }])
          }
          return Response.json(assetRows)
        }
        return new Response('Not found', { status: 404 })
      }) as typeof fetch
      const app = createAgentWorkflowApp({
        defaultWorkspacePath: projectsRoot,
        sessionRunner: createFakeRunner().runner,
        currentUser: {
          id: '00000000-0000-0000-0000-000000000001',
          role: 'owner',
        },
      })
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer user-token',
        },
        body: JSON.stringify({
          workspacePath: workspace,
          projectId: 'project_asset_metadata',
        }),
      })
      const session = await sessionRes.json()
      const sessionWorkspace = session.cwd as string
      await mkdir(join(sessionWorkspace, 'assets'), { recursive: true })
      await writeFile(
        join(sessionWorkspace, 'assets', 'asset-manifest.json'),
        JSON.stringify({
          version: 1,
          project_target: { integration_mode: 'filesystem' },
          slots: [{
            id: 'main_logo',
            name: 'Main logo',
            status: 'uploaded',
            uploaded_files: ['public/assets/logo.png'],
          }],
        }),
      )

      const assetsRes = await app.request(
        `/api/beegame-sessions/${session.id}/assets?workspacePath=${encodeURIComponent(workspace)}`,
        { headers: { authorization: 'Bearer user-token' } },
      )

      expect(assetsRes.status).toBe(200)
      expect(assetRows).toEqual([
        expect.objectContaining({
          id: 'project_asset_metadata',
          owner_id: '00000000-0000-0000-0000-000000000001',
          project_id: 'project_asset_metadata',
          manifest: expect.objectContaining({
            slots: [expect.objectContaining({ id: 'main_logo' })],
          }),
        }),
      ])
    } finally {
      globalThis.fetch = originalFetch
      if (originalUrl === undefined) {
        delete process.env.BEEGAME_SUPABASE_URL
      } else {
        process.env.BEEGAME_SUPABASE_URL = originalUrl
      }
      if (originalAnonKey === undefined) {
        delete process.env.BEEGAME_SUPABASE_ANON_KEY
      } else {
        process.env.BEEGAME_SUPABASE_ANON_KEY = originalAnonKey
      }
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('rejects legacy asset listing without verified session metadata', async () => {
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
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'Session not found' })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('rejects legacy resource asset listing without verified session metadata', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-assets-resources-'))
    const app = createAgentWorkflowApp({ sessionRunner: createFakeRunner().runner })
    try {
      await mkdir(join(workspace, 'assets'), { recursive: true })
      await writeFile(
        join(workspace, 'assets', 'asset-manifest.json'),
        JSON.stringify({
          project: 'sample-game',
          version: '1.0.0',
          integration_mode: 'filesystem',
          resources: {
            sprites: {
              player_idle: {
                path: 'public/sprites/player-idle.png',
                type: 'sprite',
                format: 'PNG',
                purpose: 'Player idle sprite',
                placeholder_status: 'programmatic',
                specs: {
                  dimensions: '64x64',
                  background: 'transparent',
                },
              },
            },
            audio: {
              bgm_loop: {
                path: 'public/audio/bgm-loop.mp3',
                type: 'audio',
                format: ['mp3', 'ogg'],
                purpose: 'Main background music',
                placeholder_status: 'none',
              },
            },
          },
        }),
      )

      const res = await app.request(
        `/api/beegame-sessions/beegame_assets_resources/assets?workspacePath=${encodeURIComponent(workspace)}`,
      )
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'Session not found' })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('rejects legacy asset upload without verified session metadata', async () => {
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
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'Session not found' })
      await expect(stat(join(workspace, 'public', 'assets', 'logo.png'))).rejects.toThrow()
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('uploads asset file bodies to Supabase Storage when configured', async () => {
    const originalUrl = process.env.BEEGAME_SUPABASE_URL
    const originalAnonKey = process.env.BEEGAME_SUPABASE_ANON_KEY
    const originalAssetBucket = process.env.BEEGAME_SUPABASE_ASSET_BUCKET
    const originalFetch = globalThis.fetch
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-assets-storage-'))
    const workspace = join(projectsRoot, 'asset-storage-project')
    const assetRows: Array<Record<string, unknown>> = []
    const storageUploads: Array<{ url: string; contentType: string | null; text: string }> = []
    try {
      process.env.BEEGAME_SUPABASE_URL = 'https://project.supabase.co'
      process.env.BEEGAME_SUPABASE_ANON_KEY = 'anon-key'
      process.env.BEEGAME_SUPABASE_ASSET_BUCKET = 'beegame-assets'
      globalThis.fetch = (async (input, init) => {
        const requestUrl = String(input)
        if (requestUrl.includes('/storage/v1/object/beegame-assets/')) {
          storageUploads.push({
            url: requestUrl,
            contentType: new Headers(init?.headers).get('content-type'),
            text: await new Response(init?.body as BodyInit).text(),
          })
          return Response.json({ Key: requestUrl.split('/storage/v1/object/')[1] })
        }
        if (requestUrl.includes('/rest/v1/beegame_sessions')) {
          if (init?.method === 'POST') return Response.json([JSON.parse(String(init.body))])
          return Response.json([])
        }
        if (requestUrl.includes('/rest/v1/beegame_assets')) {
          if (init?.method === 'POST') {
            const row = JSON.parse(String(init.body)) as Record<string, unknown>
            assetRows.push(row)
            return Response.json([{
              created_at: '2026-06-27T00:00:00.000Z',
              updated_at: '2026-06-27T00:00:00.000Z',
              ...row,
            }])
          }
          return Response.json(assetRows)
        }
        return new Response('Not found', { status: 404 })
      }) as typeof fetch
      const app = createAgentWorkflowApp({
        defaultWorkspacePath: projectsRoot,
        sessionRunner: createFakeRunner().runner,
        currentUser: {
          id: '00000000-0000-0000-0000-000000000002',
          role: 'owner',
        },
      })
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer user-token',
        },
        body: JSON.stringify({
          workspacePath: workspace,
          projectId: 'project_asset_storage',
        }),
      })
      const session = await sessionRes.json()
      const sessionWorkspace = session.cwd as string
      await mkdir(join(sessionWorkspace, 'assets'), { recursive: true })
      await writeFile(
        join(sessionWorkspace, 'assets', 'asset-manifest.json'),
        JSON.stringify({
          version: 1,
          project_target: { integration_mode: 'filesystem' },
          slots: [{
            id: 'main_logo',
            name: 'Main logo',
            target: { path: 'public/assets/logo.png' },
          }],
        }),
      )
      const form = new FormData()
      form.set('file', new File(['logo-bytes'], 'logo.png', { type: 'image/png' }))

      const res = await app.request(
        `/api/beegame-sessions/${session.id}/assets/main_logo/upload?workspacePath=${encodeURIComponent(workspace)}`,
        {
          method: 'POST',
          headers: { authorization: 'Bearer user-token' },
          body: form,
        },
      )
      const payload = await res.json()
      const manifest = JSON.parse(await readFile(join(sessionWorkspace, 'assets', 'asset-manifest.json'), 'utf8'))

      expect(res.status).toBe(200)
      expect(storageUploads).toEqual([
        expect.objectContaining({
          contentType: 'image/png',
          text: 'logo-bytes',
        }),
      ])
      expect(storageUploads[0]?.url).toContain(
        '/storage/v1/object/beegame-assets/projects/00000000-0000-0000-0000-000000000002/project_asset_storage/',
      )
      expect(payload.slot.uploaded_urls).toEqual([
        expect.stringContaining(
          'supabase://beegame-assets/projects/00000000-0000-0000-0000-000000000002/project_asset_storage/',
        ),
      ])
      expect(manifest.slots[0].uploaded_urls).toEqual(payload.slot.uploaded_urls)
      expect(assetRows.at(-1)?.manifest).toEqual(expect.objectContaining({
        slots: [expect.objectContaining({
          id: 'main_logo',
          uploaded_urls: payload.slot.uploaded_urls,
        })],
      }))
    } finally {
      globalThis.fetch = originalFetch
      if (originalUrl === undefined) {
        delete process.env.BEEGAME_SUPABASE_URL
      } else {
        process.env.BEEGAME_SUPABASE_URL = originalUrl
      }
      if (originalAnonKey === undefined) {
        delete process.env.BEEGAME_SUPABASE_ANON_KEY
      } else {
        process.env.BEEGAME_SUPABASE_ANON_KEY = originalAnonKey
      }
      if (originalAssetBucket === undefined) {
        delete process.env.BEEGAME_SUPABASE_ASSET_BUCKET
      } else {
        process.env.BEEGAME_SUPABASE_ASSET_BUCKET = originalAssetBucket
      }
      await rm(projectsRoot, { recursive: true, force: true })
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
        url: '/previews/beegame_preview/',
        script: 'dev',
      }))
      expect(status).toEqual(expect.objectContaining({
        status: 'running',
        url: '/previews/beegame_preview/',
      }))
      expect(stopped).toEqual(expect.objectContaining({ status: 'stopped' }))
      expect(starts).toHaveLength(1)
      expect(starts[0].cwd).toBe(resolve(workspace))
      expect(starts[0].command[0]).toBe(process.execPath)
      expect(starts[0].command[1]).toEndWith('vite-preview-host.ts')
      expect(starts[0].command.slice(2)).toEqual([
        '--host',
        '127.0.0.1',
        '--port',
        '63100',
        '--base',
        '/previews/beegame_preview/',
      ])
      expect(starts[0].env.PORT).toBe('63100')
      expect(starts[0].env.NODE_ENV).toBe('development')
      expect(kills).toHaveLength(1)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('returns a public preview URL and proxies preview traffic to the internal loopback server', async () => {
    const originalPreviewPublicBaseUrl = process.env.BEEGAME_PREVIEW_PUBLIC_BASE_URL
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-public-preview-'))
    const internalServer = createServer((req, res) => {
      res.setHeader('content-type', 'text/plain')
      res.end(`proxied ${req.url || '/'}`)
    })
    await new Promise<void>((resolveReady, rejectReady) => {
      internalServer.once('error', rejectReady)
      internalServer.listen(0, '127.0.0.1', () => resolveReady())
    })
    const address = internalServer.address()
    const internalPort = typeof address === 'object' && address ? address.port : 0
    const starts: Array<{ command: string[]; cwd: string; env: Record<string, string> }> = []
    const previewRunner: BeeGamePreviewRunner = (command, options) => {
      starts.push({ command, cwd: options.cwd, env: options.env })
      options.onOutput(`Local: http://127.0.0.1:${internalPort}/\n`)
      return {
        kill: () => {},
        exited: new Promise(() => {}),
      }
    }
    process.env.BEEGAME_PREVIEW_PUBLIC_BASE_URL = 'https://bgs.phantomsxr.com/previews'
    const app = createAgentWorkflowApp({
      sessionRunner: createFakeRunner().runner,
      previewRunner,
      previewPortAllocator: async () => internalPort,
      previewReadinessProbe: async url => url === `http://127.0.0.1:${internalPort}/`,
    })
    try {
      await writeFile(
        join(workspace, 'package.json'),
        JSON.stringify({
          scripts: {
            dev: 'vite --host 127.0.0.1',
            preview: 'vite preview',
          },
          devDependencies: { vite: '^6.0.0' },
        }),
      )

      const startRes = await app.request(
        `/api/beegame-sessions/beegame_public_preview/preview`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ workspacePath: workspace }),
        },
      )
      const started = await startRes.json()
      const proxiedRootRes = await app.request('/previews/beegame_public_preview/')
      const proxiedRootText = await proxiedRootRes.text()
      const proxiedRes = await app.request('/previews/beegame_public_preview/assets/main.js?cache=1')
      const proxiedText = await proxiedRes.text()

      expect(startRes.status).toBe(200)
      expect(started).toEqual(expect.objectContaining({
        status: 'running',
        url: 'https://bgs.phantomsxr.com/previews/beegame_public_preview/',
      }))
      expect(starts[0].env.PORT).toBe(String(internalPort))
      expect(starts[0].command).toContain('--base')
      expect(starts[0].command).toContain('/previews/beegame_public_preview/')
      expect(proxiedRootRes.status).toBe(200)
      expect(proxiedRootRes.headers.get('access-control-allow-origin')).toBe('*')
      expect(proxiedRootText).toBe('proxied /previews/beegame_public_preview/')
      expect(proxiedRes.status).toBe(200)
      expect(proxiedRes.headers.get('access-control-allow-origin')).toBe('*')
      expect(proxiedText).toBe('proxied /previews/beegame_public_preview/assets/main.js?cache=1')
    } finally {
      if (originalPreviewPublicBaseUrl === undefined) {
        delete process.env.BEEGAME_PREVIEW_PUBLIC_BASE_URL
      } else {
        process.env.BEEGAME_PREVIEW_PUBLIC_BASE_URL = originalPreviewPublicBaseUrl
      }
      await new Promise<void>((resolveClosed, rejectClosed) => {
        internalServer.close(error => error ? rejectClosed(error) : resolveClosed())
      })
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('routes local preview HTML through the dashboard proxy and injects console reporting', async () => {
    const originalPreviewPublicBaseUrl = process.env.BEEGAME_PREVIEW_PUBLIC_BASE_URL
    delete process.env.BEEGAME_PREVIEW_PUBLIC_BASE_URL
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-local-preview-'))
    const internalServer = createServer((req, res) => {
      res.setHeader('content-type', 'text/html')
      res.end(`<html><head><title>Preview</title></head><body>${req.url || '/'}</body></html>`)
    })
    await new Promise<void>((resolveReady, rejectReady) => {
      internalServer.once('error', rejectReady)
      internalServer.listen(0, '127.0.0.1', () => resolveReady())
    })
    const address = internalServer.address()
    const internalPort = typeof address === 'object' && address ? address.port : 0
    let internalServerClosed = false
    const starts: Array<{ command: string[]; cwd: string; env: Record<string, string> }> = []
    const previewRunner: BeeGamePreviewRunner = (command, options) => {
      starts.push({ command, cwd: options.cwd, env: options.env })
      options.onOutput(`Local: http://127.0.0.1:${internalPort}/\n`)
      return {
        kill: () => {},
        exited: new Promise(() => {}),
      }
    }
    const app = createAgentWorkflowApp({
      sessionRunner: createFakeRunner().runner,
      previewRunner,
      previewPortAllocator: async () => internalPort,
      previewReadinessProbe: async url => url === `http://127.0.0.1:${internalPort}/`,
    })
    try {
      await writeFile(
        join(workspace, 'package.json'),
        JSON.stringify({
          scripts: { dev: 'vite --host 127.0.0.1' },
          devDependencies: { vite: '^6.0.0' },
        }),
      )

      const startRes = await app.request(
        `/api/beegame-sessions/beegame_local_preview/preview`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ workspacePath: workspace }),
        },
      )
      const started = await startRes.json()
      const proxiedRootRes = await app.request('/previews/beegame_local_preview/')
      const proxiedRootText = await proxiedRootRes.text()

      expect(startRes.status).toBe(200)
      expect(started).toEqual(expect.objectContaining({
        status: 'running',
        url: '/previews/beegame_local_preview/',
      }))
      expect(starts[0].command).toContain('--base')
      expect(starts[0].command).toContain('/previews/beegame_local_preview/')
      expect(proxiedRootRes.status).toBe(200)
      expect(proxiedRootRes.headers.get('access-control-allow-origin')).toBe('*')
      expect(proxiedRootText).toContain('/previews/beegame_local_preview/')
      expect(proxiedRootText).toContain('data-beegame-preview-console-bridge')
      expect(proxiedRootText).toContain('beegame.preview.console')

      await new Promise<void>((resolveClosed, rejectClosed) => {
        internalServer.close(error => error ? rejectClosed(error) : resolveClosed())
      })
      internalServerClosed = true
      const unavailableRes = await app.request('/previews/beegame_local_preview/')
      const unavailableText = await unavailableRes.text()
      expect(unavailableRes.status).toBe(502)
      expect(unavailableRes.headers.get('access-control-allow-origin')).toBe('*')
      expect(unavailableText).toContain('Preview upstream unavailable')
    } finally {
      if (originalPreviewPublicBaseUrl === undefined) {
        delete process.env.BEEGAME_PREVIEW_PUBLIC_BASE_URL
      } else {
        process.env.BEEGAME_PREVIEW_PUBLIC_BASE_URL = originalPreviewPublicBaseUrl
      }
      if (!internalServerClosed) {
        await new Promise<void>((resolveClosed, rejectClosed) => {
          internalServer.close(error => error ? rejectClosed(error) : resolveClosed())
        })
      }
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('preserves Vite base paths when proxying preview root requests', async () => {
    const originalPreviewPublicBaseUrl = process.env.BEEGAME_PREVIEW_PUBLIC_BASE_URL
    delete process.env.BEEGAME_PREVIEW_PUBLIC_BASE_URL
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-vite-base-preview-'))
    const internalServer = createServer((req, res) => {
      if ((req.url || '/') === '/') {
        res.statusCode = 302
        res.setHeader('location', '/previews/beegame_vite_base_preview/')
        res.end()
        return
      }
      res.setHeader('content-type', 'text/html')
      res.end(`<html><head></head><body>${req.url || '/'}</body></html>`)
    })
    await new Promise<void>((resolveReady, rejectReady) => {
      internalServer.once('error', rejectReady)
      internalServer.listen(0, '127.0.0.1', () => resolveReady())
    })
    const address = internalServer.address()
    const internalPort = typeof address === 'object' && address ? address.port : 0
    const previewRunner: BeeGamePreviewRunner = (_command, options) => {
      options.onOutput(`Local: http://127.0.0.1:${internalPort}/\n`)
      return {
        kill: () => {},
        exited: new Promise(() => {}),
      }
    }
    const app = createAgentWorkflowApp({
      sessionRunner: createFakeRunner().runner,
      previewRunner,
      previewPortAllocator: async () => internalPort,
      previewReadinessProbe: async url => url === `http://127.0.0.1:${internalPort}/`,
    })
    try {
      await writeFile(
        join(workspace, 'package.json'),
        JSON.stringify({
          scripts: { dev: 'vite --host 127.0.0.1' },
          devDependencies: { vite: '^6.0.0' },
        }),
      )

      const startRes = await app.request(
        `/api/beegame-sessions/beegame_vite_base_preview/preview`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ workspacePath: workspace }),
        },
      )
      const proxiedRootRes = await app.request('/previews/beegame_vite_base_preview/')
      const proxiedRootText = await proxiedRootRes.text()

      expect(startRes.status).toBe(200)
      expect(proxiedRootRes.status).toBe(200)
      expect(proxiedRootText).toContain('/previews/beegame_vite_base_preview/')
      expect(proxiedRootText).not.toBe('')
    } finally {
      if (originalPreviewPublicBaseUrl === undefined) {
        delete process.env.BEEGAME_PREVIEW_PUBLIC_BASE_URL
      } else {
        process.env.BEEGAME_PREVIEW_PUBLIC_BASE_URL = originalPreviewPublicBaseUrl
      }
      await new Promise<void>((resolveClosed, rejectClosed) => {
        internalServer.close(error => error ? rejectClosed(error) : resolveClosed())
      })
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('serves preview iframe requests without requiring an API authorization header', async () => {
    const originalPreviewPublicBaseUrl = process.env.BEEGAME_PREVIEW_PUBLIC_BASE_URL
    delete process.env.BEEGAME_PREVIEW_PUBLIC_BASE_URL
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-iframe-preview-'))
    const internalServer = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html')
      res.end('<html><head></head><body>iframe preview</body></html>')
    })
    await new Promise<void>((resolveReady, rejectReady) => {
      internalServer.once('error', rejectReady)
      internalServer.listen(0, '127.0.0.1', () => resolveReady())
    })
    const address = internalServer.address()
    const internalPort = typeof address === 'object' && address ? address.port : 0
    const previewRunner: BeeGamePreviewRunner = (_command, options) => {
      options.onOutput(`Local: http://127.0.0.1:${internalPort}/\n`)
      return {
        kill: () => {},
        exited: new Promise(() => {}),
      }
    }
    const app = createAgentWorkflowApp({
      sessionRunner: createFakeRunner().runner,
      currentUserResolver: request => (
        request.headers.get('authorization') === 'Bearer owner-token'
          ? { id: DEFAULT_LOCAL_USER_ID, role: 'owner' }
          : undefined
      ),
      previewRunner,
      previewPortAllocator: async () => internalPort,
      previewReadinessProbe: async url => url === `http://127.0.0.1:${internalPort}/`,
    })
    try {
      await writeFile(
        join(workspace, 'package.json'),
        JSON.stringify({
          scripts: { dev: 'vite --host 127.0.0.1' },
          devDependencies: { vite: '^6.0.0' },
        }),
      )

      const startRes = await app.request(
        `/api/beegame-sessions/beegame_iframe_preview/preview`,
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer owner-token',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ workspacePath: workspace }),
        },
      )
      const iframeRes = await app.request('/previews/beegame_iframe_preview/')
      const iframeText = await iframeRes.text()

      expect(startRes.status).toBe(200)
      expect(iframeRes.status).toBe(200)
      expect(iframeText).toContain('iframe preview')
      expect(iframeText).toContain('beegame.preview.console')
    } finally {
      if (originalPreviewPublicBaseUrl === undefined) {
        delete process.env.BEEGAME_PREVIEW_PUBLIC_BASE_URL
      } else {
        process.env.BEEGAME_PREVIEW_PUBLIC_BASE_URL = originalPreviewPublicBaseUrl
      }
      await new Promise<void>((resolveClosed, rejectClosed) => {
        internalServer.close(error => error ? rejectClosed(error) : resolveClosed())
      })
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('deploys a static web build and serves the published files', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-deploy-route-'))
    const workspace = join(projectsRoot, 'deployable-game')
    const deploymentRunner: BeeGameDeploymentRunner = async (_command, options) => {
      await mkdir(join(options.cwd, 'dist'), { recursive: true })
      await writeFile(join(options.cwd, 'dist', 'index.html'), '<main>Live game</main>')
      return { exitCode: 0, stdout: 'built', stderr: '' }
    }
    const app = createAgentWorkflowApp({
      sessionRunner: createFakeRunner().runner,
      deploymentRunner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project_deployable',
          projectName: 'Deployable Game',
          workspacePath: workspace,
          message: 'Build a deployable game',
        }),
      })
      const session = await sessionRes.json()
      const sessionWorkspace = session.cwd as string
      await mkdir(sessionWorkspace, { recursive: true })
      await writeFile(
        join(sessionWorkspace, 'package.json'),
        JSON.stringify({ scripts: { build: 'vite build' } }),
      )
      const deployRes = await app.request(
        `/api/beegame-sessions/${session.id}/deployments`,
        { method: 'POST' },
      )
      const deployment = await deployRes.json()
      const liveRes = await app.request(deployment.url)

      expect(deployRes.status).toBe(200)
      expect(deployment).toEqual(expect.objectContaining({
        status: 'succeeded',
        buildCommand: 'npm run build -- --base=./',
      }))
      expect(deployment.url).toMatch(/^\/deployments\/deploy_/)
      expect(liveRes.status).toBe(200)
      expect(await liveRes.text()).toBe('<main>Live game</main>')
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('rolls back to a previous successful deployment record', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-rollback-route-'))
    const workspace = join(projectsRoot, 'rollback-game')
    let buildCount = 0
    const deploymentRunner: BeeGameDeploymentRunner = async (_command, options) => {
      buildCount += 1
      await mkdir(join(options.cwd, 'dist'), { recursive: true })
      await writeFile(
        join(options.cwd, 'dist', 'index.html'),
        `<main>Version ${buildCount}</main>`,
      )
      return { exitCode: 0, stdout: `built ${buildCount}`, stderr: '' }
    }
    const app = createAgentWorkflowApp({
      sessionRunner: createFakeRunner().runner,
      deploymentRunner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project_rollback',
          projectName: 'Rollback Game',
          workspacePath: workspace,
        }),
      })
      const session = await sessionRes.json()
      const sessionWorkspace = session.cwd as string
      await mkdir(sessionWorkspace, { recursive: true })
      await writeFile(
        join(sessionWorkspace, 'package.json'),
        JSON.stringify({ scripts: { build: 'vite build' } }),
      )
      const firstRes = await app.request(
        `/api/beegame-sessions/${session.id}/deployments`,
        { method: 'POST' },
      )
      const firstDeployment = await firstRes.json()
      const secondRes = await app.request(
        `/api/beegame-sessions/${session.id}/deployments`,
        { method: 'POST' },
      )
      const secondDeployment = await secondRes.json()

      const rollbackRes = await app.request(
        `/api/beegame-sessions/${session.id}/deployments/${firstDeployment.id}/rollback`,
        { method: 'POST' },
      )
      const rollback = await rollbackRes.json()
      const listRes = await app.request(
        `/api/beegame-sessions/${session.id}/deployments`,
      )
      const deployments = await listRes.json()

      expect(secondDeployment.status).toBe('succeeded')
      expect(rollbackRes.status).toBe(200)
      expect(rollback).toEqual(expect.objectContaining({
        status: 'succeeded',
        url: firstDeployment.url,
        message: `Restored from deployment ${firstDeployment.id}`,
      }))
      expect(deployments[0]).toEqual(expect.objectContaining({
        id: rollback.id,
        url: firstDeployment.url,
      }))
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('passes the request bearer token to remote deployment publishers', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-remote-deploy-route-'))
    const workspace = join(projectsRoot, 'users', 'user-route', 'remote-deployable-game')
    const publishInputs: Array<{
      authToken?: string
      userId?: string
      files: string[]
    }> = []
    const deploymentRunner: BeeGameDeploymentRunner = async (_command, options) => {
      await mkdir(join(options.cwd, 'dist'), { recursive: true })
      await writeFile(join(options.cwd, 'dist', 'index.html'), '<main>Remote route game</main>')
      return { exitCode: 0, stdout: 'built', stderr: '' }
    }
    const deploymentPublisher: BeeGameDeploymentPublisher = {
      publishStaticDirectory: async input => {
        publishInputs.push({
          authToken: input.authToken,
          userId: input.userId,
          files: input.files.map(file => file.path),
        })
        return {
          url: `https://games.example.com/${input.deploymentId}/`,
          artifactPath: `remote://${input.deploymentId}`,
          message: 'Remote route deployment published',
        }
      },
    }
    const app = createAgentWorkflowApp({
      sessionRunner: createFakeRunner().runner,
      deploymentRunner,
      deploymentPublisher,
      defaultWorkspacePath: projectsRoot,
      currentUser: {
        id: 'user-route',
        role: 'owner',
        permissions: [
          'workspace.read',
          'project.create',
          'project.read',
          'agent.send_message',
          'deployment.manage',
        ],
      },
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: {
          authorization: 'Bearer user-route-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          projectId: 'project_remote_deployable',
          projectName: 'Remote Deployable Game',
          workspacePath: workspace,
        }),
      })
      const session = await sessionRes.json()
      const sessionWorkspace = session.cwd as string
      await mkdir(sessionWorkspace, { recursive: true })
      await writeFile(
        join(sessionWorkspace, 'package.json'),
        JSON.stringify({ scripts: { build: 'vite build' } }),
      )
      const deployRes = await app.request(
        `/api/beegame-sessions/${session.id}/deployments`,
        { method: 'POST', headers: { authorization: 'Bearer user-route-token' } },
      )
      const deployment = await deployRes.json()

      expect(deployRes.status).toBe(200)
      expect(deployment).toEqual(expect.objectContaining({
        status: 'succeeded',
        url: expect.stringMatching(/^https:\/\/games\.example\.com\/deploy_/),
      }))
      expect(publishInputs).toEqual([{
        authToken: 'user-route-token',
        userId: 'user-route',
        files: ['index.html'],
      }])
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('mirrors deployment records to Supabase when configured', async () => {
    const originalUrl = process.env.BEEGAME_SUPABASE_URL
    const originalAnonKey = process.env.BEEGAME_SUPABASE_ANON_KEY
    const originalDeploymentBucket = process.env.BEEGAME_DEPLOYMENT_STORAGE_BUCKET
    const originalFetch = globalThis.fetch
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-deploy-supabase-'))
    const workspace = join(projectsRoot, 'users', 'deploy-user', 'deploy-metadata-project')
    const deploymentRows: Array<Record<string, unknown>> = []
    const deploymentRunner: BeeGameDeploymentRunner = async (_command, options) => {
      await mkdir(join(options.cwd, 'dist'), { recursive: true })
      await writeFile(join(options.cwd, 'dist', 'index.html'), '<main>Deploy metadata game</main>')
      return { exitCode: 0, stdout: 'built', stderr: '' }
    }
    try {
      process.env.BEEGAME_SUPABASE_URL = 'https://project.supabase.co'
      process.env.BEEGAME_SUPABASE_ANON_KEY = 'anon-key'
      delete process.env.BEEGAME_DEPLOYMENT_STORAGE_BUCKET
      globalThis.fetch = (async (input, init) => {
        const requestUrl = String(input)
        if (requestUrl.includes('/rest/v1/beegame_sessions')) {
          if (init?.method === 'POST') return Response.json([JSON.parse(String(init.body))])
          return Response.json([])
        }
        if (requestUrl.includes('/rest/v1/beegame_deployments')) {
          if (init?.method === 'POST') {
            const row = JSON.parse(String(init.body)) as Record<string, unknown>
            deploymentRows.push(row)
            return Response.json([{
              created_at: row.created_at,
              updated_at: row.updated_at,
              deployed_at: row.deployed_at ?? null,
              ...row,
            }])
          }
          return Response.json(deploymentRows)
        }
        return new Response('Not found', { status: 404 })
      }) as typeof fetch

      const app = createAgentWorkflowApp({
        defaultWorkspacePath: projectsRoot,
        sessionRunner: createFakeRunner().runner,
        deploymentRunner,
        currentUser: {
          id: 'deploy-user',
          role: 'owner',
        },
      })
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer user-token',
        },
        body: JSON.stringify({
          workspacePath: workspace,
          projectId: 'project_deploy_metadata',
        }),
      })
      const session = await sessionRes.json()
      const deploySessionWorkspace = session.cwd as string
      await mkdir(deploySessionWorkspace, { recursive: true })
      await writeFile(
        join(deploySessionWorkspace, 'package.json'),
        JSON.stringify({ scripts: { build: 'vite build' } }),
      )
      const deployRes = await app.request(
        `/api/beegame-sessions/${session.id}/deployments`,
        { method: 'POST', headers: { authorization: 'Bearer user-token' } },
      )
      const deployment = await deployRes.json()
      const listRes = await app.request(
        `/api/beegame-sessions/${session.id}/deployments`,
        { headers: { authorization: 'Bearer user-token' } },
      )
      const deployments = await listRes.json()

      expect(deployRes.status).toBe(200)
      expect(listRes.status).toBe(200)
      expect(deployment.status).toBe('succeeded')
      expect(deployments).toEqual([
        expect.objectContaining({
          id: deployment.id,
          sessionId: session.id,
          projectId: 'project_deploy_metadata',
          status: 'succeeded',
        }),
      ])
      expect(deploymentRows).toEqual([
        expect.objectContaining({
          id: deployment.id,
          owner_id: 'deploy-user',
          session_id: session.id,
          project_id: 'project_deploy_metadata',
          status: 'succeeded',
          url: deployment.url,
          artifact_hash: deployment.artifactHash,
        }),
      ])
    } finally {
      globalThis.fetch = originalFetch
      if (originalUrl === undefined) {
        delete process.env.BEEGAME_SUPABASE_URL
      } else {
        process.env.BEEGAME_SUPABASE_URL = originalUrl
      }
      if (originalAnonKey === undefined) {
        delete process.env.BEEGAME_SUPABASE_ANON_KEY
      } else {
        process.env.BEEGAME_SUPABASE_ANON_KEY = originalAnonKey
      }
      if (originalDeploymentBucket === undefined) {
        delete process.env.BEEGAME_DEPLOYMENT_STORAGE_BUCKET
      } else {
        process.env.BEEGAME_DEPLOYMENT_STORAGE_BUCKET = originalDeploymentBucket
      }
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('mirrors managed preview snapshots to Supabase when configured', async () => {
    const originalUrl = process.env.BEEGAME_SUPABASE_URL
    const originalAnonKey = process.env.BEEGAME_SUPABASE_ANON_KEY
    const originalFetch = globalThis.fetch
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-preview-supabase-'))
    const workspace = join(projectsRoot, 'preview-metadata-project')
    const previewRows: Array<Record<string, unknown>> = []
    try {
      process.env.BEEGAME_SUPABASE_URL = 'https://project.supabase.co'
      process.env.BEEGAME_SUPABASE_ANON_KEY = 'anon-key'
      globalThis.fetch = (async (input, init) => {
        const requestUrl = String(input)
        if (requestUrl.includes('/rest/v1/beegame_sessions')) {
          if (init?.method === 'POST') return Response.json([JSON.parse(String(init.body))])
          return Response.json([])
        }
        if (requestUrl.includes('/rest/v1/beegame_previews')) {
          if (init?.method === 'POST') {
            const row = JSON.parse(String(init.body)) as Record<string, unknown>
            previewRows.push(row)
            return Response.json([{
              created_at: '2026-06-27T00:00:00.000Z',
              updated_at: '2026-06-27T00:00:00.000Z',
              ...row,
            }])
          }
          return Response.json(previewRows)
        }
        return new Response('Not found', { status: 404 })
      }) as typeof fetch
      const previewRunner: BeeGamePreviewRunner = () => ({
        kill: () => {},
      })
      const app = createAgentWorkflowApp({
        defaultWorkspacePath: projectsRoot,
        sessionRunner: createFakeRunner().runner,
        previewRunner,
        previewPortAllocator: async () => 63100,
        previewReadinessProbe: async () => true,
        currentUser: {
          id: '00000000-0000-0000-0000-000000000001',
          role: 'owner',
        },
      })
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer user-token',
        },
        body: JSON.stringify({
          workspacePath: workspace,
          projectId: 'project_preview_metadata',
        }),
      })
      const session = await sessionRes.json()
      const sessionWorkspace = session.cwd as string
      await mkdir(sessionWorkspace, { recursive: true })
      await writeFile(
        join(sessionWorkspace, 'package.json'),
        JSON.stringify({
          scripts: { dev: 'vite --host 127.0.0.1' },
          devDependencies: { vite: '^5.0.0' },
        }),
      )

      const startRes = await app.request(
        `/api/beegame-sessions/${session.id}/preview`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer user-token',
          },
          body: JSON.stringify({ workspacePath: workspace }),
        },
      )
      const stopRes = await app.request(
        `/api/beegame-sessions/${session.id}/preview?workspacePath=${encodeURIComponent(workspace)}`,
        {
          method: 'DELETE',
          headers: { authorization: 'Bearer user-token' },
        },
      )

      expect(startRes.status).toBe(200)
      expect(stopRes.status).toBe(200)
      expect(previewRows).toEqual([
        expect.objectContaining({
          id: session.id,
          owner_id: '00000000-0000-0000-0000-000000000001',
          project_id: 'project_preview_metadata',
          status: 'running',
          url: `/previews/${session.id}/`,
          metadata: expect.objectContaining({
            workspacePath: sessionWorkspace,
            port: 63100,
            script: 'dev',
            entrypoint: 'package.json',
          }),
        }),
        expect.objectContaining({
          id: session.id,
          owner_id: '00000000-0000-0000-0000-000000000001',
          project_id: 'project_preview_metadata',
          status: 'stopped',
          metadata: expect.objectContaining({
            workspacePath: sessionWorkspace,
            message: 'Preview stopped',
          }),
        }),
      ])
    } finally {
      globalThis.fetch = originalFetch
      if (originalUrl === undefined) {
        delete process.env.BEEGAME_SUPABASE_URL
      } else {
        process.env.BEEGAME_SUPABASE_URL = originalUrl
      }
      if (originalAnonKey === undefined) {
        delete process.env.BEEGAME_SUPABASE_ANON_KEY
      } else {
        process.env.BEEGAME_SUPABASE_ANON_KEY = originalAnonKey
      }
      await rm(projectsRoot, { recursive: true, force: true })
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
        url: '/previews/beegame_fullstack_preview/',
        script: 'dev',
        entrypoint: 'client/package.json',
      }))
      expect(starts).toHaveLength(2)
      expect(starts[0]).toEqual(expect.objectContaining({
        cwd: resolve(workspace, 'server'),
        command: ['npm', 'run', 'dev'],
      }))
      expect(starts[0].env.PORT).toBe('63100')
      expect(starts[1].cwd).toBe(resolve(workspace, 'client'))
      expect(starts[1].command[0]).toBe(process.execPath)
      expect(starts[1].command[1]).toEndWith('vite-preview-host.ts')
      expect(starts[1].command.slice(2)).toEqual([
        '--host',
        '127.0.0.1',
        '--port',
        '63101',
        '--base',
        '/previews/beegame_fullstack_preview/',
      ])
      expect(starts[1].env.PORT).toBe('63101')
      expect(starts[1].env.NODE_ENV).toBe('development')
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
    const gameDir = join(workspace, 'sample-game')
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
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
    })
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
      const sessionError = sessionRes.status === 200
        ? undefined
        : await sessionRes.clone().json()
      expect({ status: sessionRes.status, error: sessionError }).toEqual({
        status: 200,
        error: undefined,
      })
      const session = await sessionRes.json()
      const inputRes = await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Create sample game.' }),
      })
      expect(inputRes.status).toBe(200)
      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        if (!Array.isArray(events)) return false
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
      currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
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

  test('does not fail session deletion when Supabase audit insert is denied', async () => {
    const originalUrl = process.env.BEEGAME_SUPABASE_URL
    const originalAnonKey = process.env.BEEGAME_SUPABASE_ANON_KEY
    const originalFetch = globalThis.fetch
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const workspace = join(projectsRoot, 'project-audit-denied')
    try {
      process.env.BEEGAME_SUPABASE_URL = 'https://project.supabase.co'
      process.env.BEEGAME_SUPABASE_ANON_KEY = 'anon-key'
      globalThis.fetch = (async (input, init) => {
        const requestUrl = String(input)
        if (requestUrl.includes('/beegame_audit_events')) {
          return Response.json({
            code: '42501',
            message: 'new row violates row-level security policy for table "beegame_audit_events"',
          }, { status: 403 })
        }
        if (requestUrl.includes('/beegame_sessions') && init?.method === 'POST') {
          return Response.json([JSON.parse(String(init.body))])
        }
        if (requestUrl.includes('/beegame_sessions') && init?.method === 'DELETE') {
          return new Response(null, { status: 204 })
        }
        return Response.json([])
      }) as typeof fetch
      const app = createAgentWorkflowApp({
        sessionRunner: createFakeRunner([{ type: 'result', result: 'Done' }]).runner,
        defaultWorkspacePath: projectsRoot,
        currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'developer' },
      })
      await mkdir(workspace, { recursive: true })
      await writeFile(join(workspace, 'README.md'), 'project')
      const resolvedWorkspace = await realpath(workspace)

      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: {
          authorization: 'Bearer user-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      expect(sessionRes.status).toBe(200)
      const session = await sessionRes.json()

      const deleteRes = await app.request(
        `/api/beegame-sessions/${session.id}?deleteArtifacts=1`,
        { method: 'DELETE', headers: { authorization: 'Bearer user-token' } },
      )

      expect(deleteRes.status).toBe(200)
      await expect(stat(workspace)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      if (originalUrl === undefined) {
        delete process.env.BEEGAME_SUPABASE_URL
      } else {
        process.env.BEEGAME_SUPABASE_URL = originalUrl
      }
      if (originalAnonKey === undefined) {
        delete process.env.BEEGAME_SUPABASE_ANON_KEY
      } else {
        process.env.BEEGAME_SUPABASE_ANON_KEY = originalAnonKey
      }
      globalThis.fetch = originalFetch
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('does not recover deletion from a client workspace path when session metadata is missing', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-unknown-session-'))
    const workspace = join(projectsRoot, 'unowned-project')
    try {
      await mkdir(workspace, { recursive: true })
      const app = createAgentWorkflowApp({
        sessionRunner: createFakeRunner([{ type: 'result', result: 'Done' }]).runner,
        defaultWorkspacePath: projectsRoot,
        currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
      })

      const deleteRes = await app.request(
        `/api/beegame-sessions/unknown-session?deleteArtifacts=1&workspacePath=${encodeURIComponent(workspace)}`,
        { method: 'DELETE' },
      )

      expect(deleteRes.status).toBe(404)
      expect(await deleteRes.json()).toEqual({ error: 'Session not found' })
      await expect(stat(workspace)).resolves.toEqual(expect.anything())
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('deletes project directories from transcript after backend restart loses the session', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const resolvedWorkspace = await realpath(workspace)
    const sessionId = 'beegame_transcript_only'
    const gameDir = join(resolvedWorkspace, 'sample-game')
    const transcriptPath = getTestTranscriptPath(resolvedWorkspace, resolvedWorkspace, sessionId)
    const app = createAgentWorkflowApp({
      sessionRunner: createFakeRunner().runner,
      defaultWorkspacePath: resolvedWorkspace,
      currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
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
      currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
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
      currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
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
    const app = createAgentWorkflowApp({
      defaultWorkspacePath: workspace,
      currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
    })

    try {
      await mkdir(dirname(transcriptPath), { recursive: true })
      await writeFile(
        transcriptPath,
        [
          JSON.stringify({
            id: 1,
            sessionId,
            type: 'user.message',
            text: '做一个样例游戏',
            createdAt: '2026-06-21T00:00:01.000Z',
          }),
          JSON.stringify({
            id: 2,
            sessionId,
            type: 'assistant.message',
            text: '已生成可玩的样例游戏原型。',
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
          text: '做一个样例游戏',
        }),
        expect.objectContaining({
          id: 2,
          type: 'assistant.message',
          text: '已生成可玩的样例游戏原型。',
        }),
      ])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('serves events from transcript after backend restart loses the session', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-events-read-'))
    const sessionId = 'beegame_events_read'
    const transcriptPath = getTestTranscriptPath(workspace, workspace, sessionId)
    const app = createAgentWorkflowApp({
      defaultWorkspacePath: workspace,
      currentUser: { id: DEFAULT_LOCAL_USER_ID, role: 'owner' },
    })

    try {
      await mkdir(dirname(transcriptPath), { recursive: true })
      await writeFile(
        transcriptPath,
        [
          JSON.stringify({
            id: 1,
            sessionId,
            type: 'user.message',
            text: 'Build a sample game.',
            createdAt: '2026-06-21T00:00:01.000Z',
          }),
          JSON.stringify({
            id: 2,
            sessionId,
            type: 'assistant.message',
            text: 'Sample game is ready.',
            createdAt: '2026-06-21T00:00:02.000Z',
          }),
        ].join('\n'),
        'utf8',
      )

      const res = await app.request(
        `/api/beegame-sessions/${sessionId}/events?after=1`,
        { headers: { 'x-beegame-workspace-path': workspace } },
      )

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([
        expect.objectContaining({
          id: 2,
          type: 'assistant.message',
          text: 'Sample game is ready.',
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
