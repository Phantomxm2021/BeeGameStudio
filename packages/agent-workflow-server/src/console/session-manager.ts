import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  mapModelConfigToRuntime,
  type RuntimeModelConfig,
} from '@claude-code-best/agent-workflow'

export type ConsoleSessionStatus = 'running' | 'exited' | 'stopped' | 'failed'

export type ConsoleEventType =
  | 'session.started'
  | 'input'
  | 'stdout'
  | 'stderr'
  | 'session.exited'
  | 'session.stopped'
  | 'session.failed'

export type ConsoleEvent = {
  id: number
  sessionId: string
  type: ConsoleEventType
  text: string
  createdAt: Date
}

export type ConsoleSession = {
  id: string
  cwd: string
  modelConfigId?: string
  status: ConsoleSessionStatus
  exitCode?: number | null
  createdAt: Date
  updatedAt: Date
}

export type ConsoleProcessStartInput = {
  cwd: string
  env: Record<string, string>
  prompt: string
  onOutput(source: 'stdout' | 'stderr', text: string): void
  onExit(exitCode: number | null): void
}

export type ConsoleProcess = {
  write(text: string): void | Promise<void>
  stop(): void
}

export type ConsoleProcessFactory = (
  input: ConsoleProcessStartInput,
) => ConsoleProcess

type SessionRecord = {
  session: ConsoleSession
  activeProcess: ConsoleProcess | null
  events: ConsoleEvent[]
  nextEventId: number
  runtime: RuntimeModelConfig | undefined
}

export type StartConsoleSessionInput = {
  workspacePath: string
  modelConfigId?: string
}

export class ConsoleSessionManager {
  private readonly sessions = new Map<string, SessionRecord>()

  constructor(
    private readonly processFactory: ConsoleProcessFactory = createDefaultConsoleProcess,
  ) {}

  start(input: StartConsoleSessionInput): ConsoleSession {
    if (!isAbsolute(input.workspacePath)) {
      throw new Error('Workspace path must be absolute')
    }
    const cwd = resolve(input.workspacePath)
    const runtime = input.modelConfigId
      ? mapModelConfigToRuntime(input.modelConfigId)
      : undefined
    if (input.modelConfigId && !runtime) {
      throw new Error('Model config not found')
    }

    const now = new Date()
    const session: ConsoleSession = {
      id: `console_${randomUUID().replaceAll('-', '')}`,
      cwd,
      ...(input.modelConfigId ? { modelConfigId: input.modelConfigId } : {}),
      status: 'running',
      createdAt: now,
      updatedAt: now,
    }

    const record: SessionRecord = {
      session,
      activeProcess: null,
      events: [],
      nextEventId: 1,
      runtime,
    }
    this.sessions.set(session.id, record)
    this.append(
      record,
      'session.started',
      `Created Claude Code session in ${cwd}`,
    )

    return cloneSession(record.session)
  }

  list(): ConsoleSession[] {
    return [...this.sessions.values()].map(record =>
      cloneSession(record.session),
    )
  }

  get(sessionId: string): ConsoleSession | undefined {
    const record = this.sessions.get(sessionId)
    return record ? cloneSession(record.session) : undefined
  }

  events(sessionId: string, after = 0): ConsoleEvent[] {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Session not found')
    return record.events
      .filter(event => event.id > after)
      .map(event => ({ ...event }))
  }

  async send(sessionId: string, text: string): Promise<ConsoleSession> {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Session not found')
    if (record.session.status !== 'running') {
      throw new Error('Session is not running')
    }
    this.append(record, 'input', text)
    try {
      const process = this.processFactory({
        cwd: record.session.cwd,
        env: buildRuntimeEnv(record.runtime),
        prompt: text,
        onOutput: (source, output) => {
          this.append(record, source, output)
        },
        onExit: exitCode => {
          record.activeProcess = null
          record.session.exitCode = exitCode
          record.session.updatedAt = new Date()
          this.append(
            record,
            exitCode === 0 ? 'session.exited' : 'session.failed',
            `Claude Code request exited with code ${exitCode ?? 'unknown'}`,
          )
        },
      })
      record.activeProcess = process
    } catch (err) {
      this.append(record, 'session.failed', toErrorMessage(err))
    }
    record.session.updatedAt = new Date()
    return cloneSession(record.session)
  }

  stop(sessionId: string): ConsoleSession {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Session not found')
    if (record.session.status === 'running') {
      record.activeProcess?.stop()
      record.session.status = 'stopped'
      record.session.updatedAt = new Date()
      this.append(record, 'session.stopped', 'Claude Code session stopped')
    }
    return cloneSession(record.session)
  }

  private append(
    record: SessionRecord,
    type: ConsoleEventType,
    text: string,
  ): void {
    record.events.push({
      id: record.nextEventId,
      sessionId: record.session.id,
      type,
      text,
      createdAt: new Date(),
    })
    record.nextEventId += 1
    record.session.updatedAt = new Date()
  }
}

export function createDefaultConsoleProcess(
  input: ConsoleProcessStartInput,
): ConsoleProcess {
  const child = Bun.spawn({
    cmd: getConsoleCommand(),
    cwd: input.cwd,
    env: {
      ...process.env,
      ...input.env,
      PWD: input.cwd,
    },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })

  void readOutput(child.stdout, text => input.onOutput('stdout', text))
  void readOutput(child.stderr, text => input.onOutput('stderr', text))
  void child.exited.then(exitCode => input.onExit(exitCode))
  child.stdin.write(input.prompt)
  child.stdin.flush()
  child.stdin.end()

  return {
    write() {},
    stop() {
      child.kill()
    },
  }
}

function getConsoleCommand(): string[] {
  const configured = process.env.CLAUDE_CODE_DASHBOARD_COMMAND
  if (configured) {
    const parsed = JSON.parse(configured) as unknown
    if (
      Array.isArray(parsed) &&
      parsed.every(value => typeof value === 'string')
    ) {
      return parsed
    }
    throw new Error('CLAUDE_CODE_DASHBOARD_COMMAND must be a JSON string array')
  }
  return getDefaultConsoleCommandForTesting()
}

function getRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../../')
}

export function getDefaultConsoleCommandForTesting(): string[] {
  return [
    process.execPath,
    'run',
    join(getRepoRoot(), 'src/entrypoints/cli.tsx'),
    '-p',
  ]
}

function buildRuntimeEnv(
  runtime: RuntimeModelConfig | undefined,
): Record<string, string> {
  return runtime?.env ?? {}
}

async function readOutput(
  stream: ReadableStream<Uint8Array>,
  onText: (text: string) => void,
): Promise<void> {
  const decoder = new TextDecoder()
  const reader = stream.getReader()
  while (true) {
    const { value, done } = await reader.read()
    if (done) return
    if (value) onText(decoder.decode(value, { stream: true }))
  }
}

function cloneSession(session: ConsoleSession): ConsoleSession {
  return { ...session }
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Request failed'
}
