import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  resolveApprovedOutboundTarget,
  type ApprovedOutboundTarget,
  type OutboundTargetPolicyOptions,
} from '@bee-game-studio/security-core'
import { getWorkerBaseEnvironment } from './query-engine-process-runner'

export type BeeGameModelContent =
  | string
  | Array<
    | { type: 'text'; text: string }
    | {
      type: 'image'
      source: {
        type: 'base64'
        media_type: 'image/png' | 'image/jpeg' | 'image/webp'
        data: string
      }
    }
  >

export type BeeGameModelMessage = {
  role: 'user' | 'assistant'
  content: BeeGameModelContent
}

export type BeeGameModelGenerateInput = {
  cwd: string
  runtimeEnv: Record<string, string>
  systemPrompt: string
  messages: BeeGameModelMessage[]
  maxTokens?: number
  temperature?: number
  querySource: string
}

export type BeeGameModelRuntimeHost = {
  generate(input: BeeGameModelGenerateInput): Promise<string>
}

type SerializedApprovedTarget = {
  url: string
  addresses: string[]
  trustedDevelopmentProxy?: true
}

export type ModelRuntimeWorkerRequest = {
  type: 'model.generate'
  requestId: string
  input: Omit<BeeGameModelGenerateInput, 'runtimeEnv'> & {
    runtimeEnv: Record<string, string>
    approvedOutboundTargets: Record<string, SerializedApprovedTarget>
  }
}

export type ModelRuntimeWorkerResponse =
  | { type: 'model.result'; requestId: string; content: string }
  | { type: 'model.error'; requestId: string; message: string }

const WORKER_PATH = fileURLToPath(
  new URL('./model-runtime-worker.ts', import.meta.url),
)

const RUNTIME_PROVIDER_URL_KEYS = [
  'ANTHROPIC_BASE_URL',
  'OPENAI_BASE_URL',
  'GEMINI_BASE_URL',
  'GROK_BASE_URL',
] as const

export function createProcessIsolatedModelRuntimeHost(options: {
  outboundTargetPolicyOptions: OutboundTargetPolicyOptions
  resolveOutboundTarget?: typeof resolveApprovedOutboundTarget
}): BeeGameModelRuntimeHost {
  const resolveOutboundTarget =
    options.resolveOutboundTarget ?? resolveApprovedOutboundTarget

  return {
    async generate(input) {
      const approvedOutboundTargets: Record<string, ApprovedOutboundTarget> = {}
      for (const key of RUNTIME_PROVIDER_URL_KEYS) {
        const value = input.runtimeEnv[key]
        if (!value) continue
        const target = await resolveOutboundTarget(
          value,
          options.outboundTargetPolicyOptions,
        )
        if (!target) throw new Error('Outbound URL is not permitted')
        approvedOutboundTargets[key] = target
      }
      if (Object.keys(approvedOutboundTargets).length === 0) {
        throw new Error('The selected model config has no runtime endpoint')
      }

      return runWorker({
        ...input,
        approvedOutboundTargets: Object.fromEntries(
          Object.entries(approvedOutboundTargets).map(([key, target]) => [
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
      })
    },
  }
}

async function runWorker(
  input: ModelRuntimeWorkerRequest['input'],
): Promise<string> {
  const requestId = randomUUID()
  return new Promise<string>((resolve, reject) => {
    let settled = false
    const child = Bun.spawn([process.execPath, WORKER_PATH], {
      env: getWorkerBaseEnvironment(),
      stdin: 'ignore',
      stdout: 'inherit',
      stderr: 'inherit',
      ipc(raw) {
        const message = raw as ModelRuntimeWorkerResponse
        if (message.requestId !== requestId || settled) return
        settled = true
        clearTimeout(timeout)
        child.kill()
        if (message.type === 'model.result') resolve(message.content)
        else reject(new Error(message.message))
      },
    })
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new Error('Model runtime request timed out'))
    }, 180_000)
    timeout.unref?.()
    child.exited.then(code => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(new Error(`Model runtime process exited (${code})`))
    })
    child.send({
      type: 'model.generate',
      requestId,
      input,
    } satisfies ModelRuntimeWorkerRequest)
  })
}
