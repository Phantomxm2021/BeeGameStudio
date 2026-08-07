import type { RuntimeModelConfig } from '@bee-game-studio/agent-workflow'
import type {
  BeeGameModelGenerateInput,
  BeeGameModelGeneration,
} from './model-runtime-host'

export type BeeGameModelBatchRequest = {
  customId: string
  input: BeeGameModelGenerateInput
}

export type BeeGameModelBatchResult = {
  customId: string
  status: 'succeeded' | 'errored' | 'cancelled' | 'expired'
  generation?: BeeGameModelGeneration
  error?: string
}

export type BeeGameModelBatchRetrieveContext = {
  cwd: string
  modelType?: RuntimeModelConfig['modelType']
  runtimeEnv: Record<string, string>
  structuredOutput?: BeeGameModelGenerateInput['structuredOutput']
  querySource: string
}

export type BeeGameModelBatchRuntime = {
  submit(requests: readonly BeeGameModelBatchRequest[]): Promise<{
    providerBatchId: string
  }>
  retrieve(
    providerBatchId: string,
    context: BeeGameModelBatchRetrieveContext,
  ): Promise<{
    status: 'processing' | 'ended'
    results?: readonly BeeGameModelBatchResult[]
  }>
}

export function assertNativeBatchProvider(modelType: string | undefined): void {
  if (modelType !== 'anthropic') {
    throw new Error(
      `Native provider batch is not supported for model provider "${modelType ?? 'unknown'}"`,
    )
  }
}
