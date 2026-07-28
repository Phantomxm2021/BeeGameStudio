import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type {
  BeeGameSessionRunner,
  BeeGameSessionRunnerStartInput,
  BeeGameSessionRuntime,
  BeeGameSessionSubmitInput,
} from './session-manager'
import {
  QueryEngineWorkerError,
  type QueryEngineParentMessage,
  type QueryEngineWorkerMessage,
  type SerializedQueryEngineStartInput,
} from './query-engine-worker-protocol'

type RuntimeProcess = ReturnType<typeof Bun.spawn>

const WORKER_PATH = fileURLToPath(new URL('./query-engine-worker.ts', import.meta.url))
const SAFE_INHERITED_ENV = [
  'HOME',
  'LANG',
  'LC_ALL',
  'LOGNAME',
  'NODE_ENV',
  'PATH',
  'SHELL',
  'TMPDIR',
  'USER',
] as const
export function createProcessIsolatedQueryEngineRunner(): BeeGameSessionRunner {
  return {
    async start(input) {
      return ProcessIsolatedQueryEngineRuntime.start(input)
    },
  }
}

class ProcessIsolatedQueryEngineRuntime implements BeeGameSessionRuntime {
  private activeTurn: {
    id: string
    input: BeeGameSessionSubmitInput
    resolve(): void
    reject(error: Error): void
  } | null = null
  private disposed = false

  private constructor(
    private readonly child: RuntimeProcess,
    private readonly sessionInput: BeeGameSessionRunnerStartInput,
  ) {}

  static async start(
    input: BeeGameSessionRunnerStartInput,
  ): Promise<ProcessIsolatedQueryEngineRuntime> {
    let runtime: ProcessIsolatedQueryEngineRuntime | undefined
    let initialized = false
    const ready = new Promise<void>((resolve, reject) => {
      const child = Bun.spawn([process.execPath, WORKER_PATH], {
        env: getWorkerBaseEnvironment(),
        stdin: 'ignore',
        stdout: 'inherit',
        stderr: 'inherit',
        ipc(message) {
          if (!runtime) return
          const workerMessage = message as QueryEngineWorkerMessage
          if (workerMessage.type === 'runtime.ready') {
            initialized = true
            resolve()
          } else if (workerMessage.type === 'runtime.error') {
            const error = new QueryEngineWorkerError(workerMessage.error)
            if (initialized) runtime.failActiveTurn(error)
            else reject(error)
          } else {
            runtime.onMessage(workerMessage)
          }
        },
      })
      runtime = new ProcessIsolatedQueryEngineRuntime(child, input)
      child.exited.then(code => {
        if (!runtime?.disposed) {
          const error = new Error(`Claude runtime process exited (${code})`)
          runtime?.failActiveTurn(error)
          if (!initialized) reject(error)
        }
      })
      runtime.send({ type: 'runtime.init', input: serializeStartInput(input) })
    })
    try {
      await ready
      return runtime as ProcessIsolatedQueryEngineRuntime
    } catch (error) {
      runtime?.dispose()
      throw error
    }
  }

  async submit(input: BeeGameSessionSubmitInput): Promise<void> {
    if (this.disposed) throw new Error('Claude runtime process is closed')
    if (this.activeTurn) throw new Error('Claude runtime already has an active turn')
    if (input.signal.aborted) return
    const turnId = randomUUID()
    await new Promise<void>((resolve, reject) => {
      this.activeTurn = { id: turnId, input, resolve, reject }
      const abort = () => this.send({ type: 'turn.stop', turnId })
      input.signal.addEventListener('abort', abort, { once: true })
      const finalize = () => input.signal.removeEventListener('abort', abort)
      const originalResolve = resolve
      const originalReject = reject
      this.activeTurn.resolve = () => {
        finalize()
        originalResolve()
      }
      this.activeTurn.reject = error => {
        finalize()
        originalReject(error)
      }
      this.send({
        type: 'turn.submit',
        turnId,
        prompt: input.prompt,
      })
    })
  }

  stop(): void {
    if (this.disposed) return
    this.send({ type: 'turn.stop', turnId: this.activeTurn?.id })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.send({ type: 'runtime.dispose' })
    this.failActiveTurn(new Error('Claude runtime process was closed'))
    setTimeout(() => {
      if (this.child.exitCode === null) this.child.kill()
    }, 1_000).unref?.()
  }

  private onMessage(message: QueryEngineWorkerMessage): void {
    if (message.type === 'turn.message') {
      if (this.activeTurn?.id === message.turnId) {
        this.activeTurn.input.onMessage(message.message)
      }
      return
    }
    if (message.type === 'session.task-notification') {
      this.sessionInput.onNativeTaskNotification?.(message.notification)
      return
    }
    if (message.type === 'session.permission.request') {
      const requestPermission = this.sessionInput.requestPermission
        ?? this.activeTurn?.input.requestPermission
      if (!requestPermission) {
        this.send({
          type: 'permission.resolve',
          requestId: message.requestId,
          decision: {
            behavior: 'deny',
            message: 'Dashboard permission channel is unavailable',
          },
        })
        return
      }
      void requestPermission(message.request)
        .then(decision => this.send({
          type: 'permission.resolve',
          requestId: message.requestId,
          decision,
        }))
        .catch(error => this.send({
          type: 'permission.resolve',
          requestId: message.requestId,
          decision: {
            behavior: 'deny',
            message: error instanceof Error ? error.message : 'Permission request failed',
          },
        }))
      return
    }
    if (message.type === 'turn.completed' && this.activeTurn?.id === message.turnId) {
      const turn = this.activeTurn
      this.activeTurn = null
      turn.resolve()
      return
    }
    if (message.type === 'turn.failed' && this.activeTurn?.id === message.turnId) {
      this.failActiveTurn(new QueryEngineWorkerError(message.error))
    }
  }

  private failActiveTurn(error: Error): void {
    const turn = this.activeTurn
    this.activeTurn = null
    turn?.reject(error)
  }

  private send(message: QueryEngineParentMessage): void {
    if (this.child.exitCode === null) this.child.send(message)
  }
}

function serializeStartInput(
  input: BeeGameSessionRunnerStartInput,
): SerializedQueryEngineStartInput {
  return {
    sessionId: input.sessionId,
    ...(input.resumeSessionId ? { resumeSessionId: input.resumeSessionId } : {}),
    ...(input.language ? { language: input.language } : {}),
    cwd: input.cwd,
    env: input.env,
    ...(input.resourceSelectionConfig
      ? { resourceSelectionConfig: input.resourceSelectionConfig }
      : {}),
    approvedOutboundTargets: Object.fromEntries(
      Object.entries(input.approvedOutboundTargets).map(([key, target]) => [
        key,
        {
          url: target.url.toString(),
          addresses: [...target.addresses],
          ...(target.trustedDevelopmentProxy
            ? { trustedDevelopmentProxy: true as const }
            : {}),
        },
      ]),
    ),
  }
}

export function getWorkerBaseEnvironment(): Record<string, string> {
  return Object.fromEntries(
    SAFE_INHERITED_ENV.flatMap(key => {
      const value = process.env[key]
      return value === undefined ? [] : [[key, value]]
    }),
  )
}
