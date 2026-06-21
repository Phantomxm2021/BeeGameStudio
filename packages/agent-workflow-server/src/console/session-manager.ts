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
  process: ConsoleProcess
  events: ConsoleEvent[]
  nextEventId: number
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
      process: nullProcess,
      events: [],
      nextEventId: 1,
    }
    this.sessions.set(session.id, record)
    this.append(record, 'session.started', `Started Claude Code in ${cwd}`)

    try {
      record.process = this.processFactory({
        cwd,
        env: buildRuntimeEnv(runtime),
        onOutput: (source, text) => {
          this.append(record, source, text)
        },
        onExit: exitCode => {
          if (record.session.status === 'stopped') return
          record.session.status = exitCode === 0 ? 'exited' : 'failed'
          record.session.exitCode = exitCode
          record.session.updatedAt = new Date()
          this.append(
            record,
            exitCode === 0 ? 'session.exited' : 'session.failed',
            `Claude Code exited with code ${exitCode ?? 'unknown'}`,
          )
        },
      })
    } catch (err) {
      record.session.status = 'failed'
      record.session.updatedAt = new Date()
      this.append(record, 'session.failed', toErrorMessage(err))
    }

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
    await record.process.write(text)
    this.append(record, 'input', text)
    record.session.updatedAt = new Date()
    return cloneSession(record.session)
  }

  stop(sessionId: string): ConsoleSession {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Session not found')
    if (record.session.status === 'running') {
      record.process.stop()
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

const nullProcess: ConsoleProcess = {
  write() {},
  stop() {},
}

export function createDefaultConsoleProcess(
  input: ConsoleProcessStartInput,
): ConsoleProcess {
  const child = Bun.spawn({
    cmd: getPtyConsoleCommand(input.cwd),
    cwd: input.cwd,
    env: {
      ...process.env,
      ...input.env,
      CLAUDE_CODE_FORCE_INTERACTIVE: '1',
      PWD: input.cwd,
      TERM: process.env.TERM || 'xterm-256color',
      COLUMNS: '120',
      LINES: '40',
    },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })

  void readOutput(child.stdout, text => input.onOutput('stdout', text))
  void readOutput(child.stderr, text => input.onOutput('stderr', text))
  void child.exited.then(exitCode => input.onExit(exitCode))

  return {
    write(text: string) {
      child.stdin.write(text)
      child.stdin.flush()
    },
    stop() {
      child.kill()
    },
  }
}

function getPtyConsoleCommand(cwd: string): string[] {
  const command = getConsoleCommand()
  if (command.length === 0) {
    throw new Error('Claude Code console command is empty')
  }

  return [
    process.env.PYTHON || 'python3',
    join(dirname(fileURLToPath(import.meta.url)), 'pty_bridge.py'),
    JSON.stringify(command),
    cwd,
  ]
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
