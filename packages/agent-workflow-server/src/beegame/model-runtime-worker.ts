import { providerConfig } from '../model-providers/config'
import { requestProvider } from '../model-providers/request'
import { modelRuntimeFetch } from './model-runtime-transport'
import {
  getTLSFetchOptions,
  createPinnedLookup,
  type ApprovedOutboundTarget,
} from '@bee-game-studio/security-core'
import { createPinnedRuntimeFetch } from './model-runtime-network'
import type {
  ModelRuntimeWorkerRequest,
  ModelRuntimeWorkerResponse,
  BeeGameModelRuntimeFailureStage,
  BeeGameModelUsage,
} from './model-runtime-host'
import {
  createChatGPTResponsesStream,
  getDefaultBgsModel,
} from '../bgs/auth'

// BGS intake/classification calls keep the verified outbound network path;
// they have no dependency on the coding agent or its tool loop.
process.on('message', raw => {
  void generate(raw as ModelRuntimeWorkerRequest)
})
async function generate(message: ModelRuntimeWorkerRequest) {
  if (message.type !== 'model.generate') return
  const input = message.input,
    env = input.runtimeEnv
  let stage: BeeGameModelRuntimeFailureStage = 'model_request'
  let usage: BeeGameModelUsage | undefined
  const unknownUsage: BeeGameModelUsage = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0,
    cache_creation_tokens: 0, total_tokens: 0, incomplete: true }
  const targets = Object.fromEntries(
    Object.entries(input.approvedOutboundTargets).map(([key, target]) => [
      key,
      { ...target, url: new URL(target.url),
        lookup: createPinnedLookup(new URL(target.url).hostname, target.addresses) } satisfies ApprovedOutboundTarget,
    ]),
  )
  const request = createPinnedRuntimeFetch(
    modelRuntimeFetch,
    targets,
    { tls: getTLSFetchOptions().tls },
  )
  const send = (value: ModelRuntimeWorkerResponse) => process.send?.(value)
  try {
    const subscription = env.OPENAI_AUTH_MODE === 'chatgpt'
    const config = subscription
      ? undefined
      : {
          ...providerConfig(env, input.modelType),
          sessionId: message.requestId,
        }
    const model =
      config?.model ||
      env.BEEGAME_MODEL ||
      (subscription && env.BEEGAME_CONFIG_DIR
        ? await getDefaultBgsModel(env.BEEGAME_CONFIG_DIR)
        : undefined)
    if (!model) throw Error('The selected model connection is incomplete')
    const body = {
      model,
      instructions: input.systemPrompt,
      store: false,
      input: input.messages.map(message => ({
        role: message.role,
        content:
          typeof message.content === 'string'
            ? message.content
            : message.content.map(block =>
                block.type === 'text'
                  ? { type: 'input_text', text: block.text }
                  : {
                      type: 'input_image',
                      image_url: `data:${block.source.media_type};base64,${block.source.data}`,
                    },
              ),
      })),
      ...(!subscription && input.maxTokens
        ? { max_output_tokens: input.maxTokens }
        : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.structuredOutput
        ? {
            tools: [
              {
                type: 'function',
                name: input.structuredOutput.name,
                description: input.structuredOutput.description,
                parameters: input.structuredOutput.inputSchema,
                strict: false,
              },
            ],
            tool_choice: {
              type: 'function',
              name: input.structuredOutput.name,
            },
          }
        : {}),
    }
    let result: Record<string, any>
    if (subscription) {
      if (!env.BEEGAME_CONFIG_DIR)
        throw Error('Owner-specific ChatGPT login directory is required')
      const stream = await createChatGPTResponsesStream({
        configDirectory: env.BEEGAME_CONFIG_DIR,
        request: { ...body, stream: true },
        signal: AbortSignal.timeout(120_000),
        fetchOverride: request,
      })
      usage = unknownUsage
      let completed: Record<string, any> | undefined
      for await (const event of stream) {
        if (event.response?.usage) usage = { ...responseUsage(event.response.usage),
          ...(!['response.completed', 'response.incomplete', 'response.failed'].includes(event.type) ? { incomplete: true as const } : {}) }
        if (
          [
            'error',
            'response.error',
            'response.failed',
            'response.incomplete',
          ].includes(event.type)
        )
          throw Error('ChatGPT model response failed')
        if (event.type === 'response.completed') {
          completed = event.response
          break
        }
      }
      if (!completed) throw Error('ChatGPT model response was incomplete')
      result = completed
    } else {
      const response = await requestProvider(
        config!,
        body,
        request,
        AbortSignal.timeout(120_000),
        reported => { usage = reported },
      )
      if (!response.ok) throw Error(`Model request failed (${response.status})`)
      usage ??= unknownUsage
      result = (await response.json()) as Record<string, any>
    }
    if (result.usage) usage = responseUsage(result.usage)
    stage = 'model_response'
    if (result.status !== 'completed' || !Array.isArray(result.output))
      throw Error('Model response was incomplete')
    let content: string
    if (input.structuredOutput) {
      const calls = result.output.filter(
        (item: any) =>
          item.type === 'function_call' &&
          item.name === input.structuredOutput!.name,
      )
      if (calls.length !== 1)
        throw Error(
          'Structured model response must contain exactly one required function call',
        )
      content = JSON.stringify(JSON.parse(calls[0].arguments))
    } else
      content = result.output
        .flatMap((item: any) =>
          item.type === 'message'
            ? (item.content ?? [])
                .filter((block: any) => block.type === 'output_text')
                .map((block: any) => block.text)
            : [],
        )
        .join('\n')
    send({ type: 'model.result', requestId: message.requestId, content, ...(usage ? { usage } : {}) })
  } catch (error) {
    send({
      type: 'model.error',
      requestId: message.requestId,
      ...(usage ? { usage } : {}),
      message:
        error instanceof SyntaxError
          ? 'Model provider returned invalid JSON'
          : error instanceof Error
            ? error.message
            : 'Model request failed',
      stage,
    })
  } finally {
    await request.close()
  }
}

function responseUsage(value: Record<string, any>): BeeGameModelUsage {
  const input = value.input_tokens, output = value.output_tokens,
    read = value.input_tokens_details?.cached_tokens ?? 0,
    write = value.input_tokens_details?.cache_creation_tokens ?? 0
  if ([input, output, read, write].some(count => !Number.isSafeInteger(count) || count < 0) || read + write > input)
    throw Error('Provider reported invalid token usage')
  return { input_tokens: input - read - write, output_tokens: output, cache_read_tokens: read,
    cache_creation_tokens: write, total_tokens: input + output,
    ...(value.incomplete === true ? { incomplete: true as const } : {}) }
}
