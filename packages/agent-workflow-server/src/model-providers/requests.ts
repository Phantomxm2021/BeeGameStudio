import { getOpenCodeGoProvider } from '@bee-game-studio/agent-workflow/opencode-go'
import type { ProviderConfig } from './config'
import {
  conversation,
  inlineImage,
  mapTools,
  textParts,
  toolChoice,
  type Json,
  type ConversationItem,
} from './messages'

export function nativeRequest(config: ProviderConfig, body: Json) {
  const tools = mapTools(body.tools),
    { system, messages } = conversation(body, config.protocol)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'bee-game-studio/2.8.4',
  }
  if (getOpenCodeGoProvider(config.baseUrl)) {
    if (!config.sessionId)
      throw Error('OpenCode Go requires a stable model session id')
    headers['X-Opencode-Session'] = config.sessionId
  }
  const model = body.model || config.model
  if (typeof model !== 'string' || !model)
    throw Error('The selected provider has no model')
  if (config.protocol === 'chat-completions') {
    headers.Authorization = 'Bearer ' + config.apiKey
    const converted: Json[] = system
      ? [{ role: 'system', content: system }]
      : []
    const toolImages: Json[] = []
    const flushToolImages = () => { converted.push(...toolImages); toolImages.length = 0 }
    for (const message of messages) {
      // A parallel call's tool results must stay consecutive. Tool images are
      // represented as user content only after that complete result block.
      if (message.role !== 'tool') flushToolImages()
      if (message.role === 'assistant' && message.raw) {
        converted.push(message.raw)
        continue
      }
      const content = message.content
        .filter(part => part.type !== 'call')
        .map(part =>
          part.type === 'image'
            ? { type: 'image_url', image_url: { url: part.url } }
            : { type: 'text', text: part.text },
        )
      if (message.role === 'tool') {
        converted.push({
          role: 'tool',
          tool_call_id: message.id,
          content: textParts(message.content),
        })
        const images = content.filter(part => part.type === 'image_url')
        if (images.length)
          toolImages.push({
            role: 'user',
            content: [
              { type: 'text', text: 'Images returned by tool ' + message.id },
              ...images,
            ],
          })
      } else {
        const calls = message.content.filter(part => part.type === 'call')
        converted.push({
          role: message.role,
          content: content.length ? content : null,
          ...(calls.length
            ? {
                tool_calls: calls.map(call => ({
                  id: call.id,
                  type: 'function',
                  function: { name: call.name, arguments: call.args },
                })),
              }
            : {}),
        })
      }
    }
    flushToolImages()
    const format = body.text?.format
    return {
      tools,
      url: config.baseUrl + '/chat/completions',
      headers,
      body: {
        model,
        messages: converted,
        stream: true,
        stream_options: { include_usage: true },
        ...(tools.length
          ? {
              tools: tools.map(tool => ({
                type: 'function',
                function: {
                  name: tool.alias,
                  description: tool.description,
                  parameters: tool.schema,
                },
              })),
              tool_choice: toolChoice(body, tools, config.protocol),
            }
          : {}),
        ...(body.max_output_tokens
          ? { max_tokens: body.max_output_tokens }
          : {}),
        ...(body.temperature !== undefined
          ? { temperature: body.temperature }
          : {}),
        ...(format?.type === 'json_schema'
          ? {
              response_format: {
                type: 'json_schema',
                json_schema: {
                  name: format.name,
                  schema: format.schema,
                  strict: format.strict ?? false,
                },
              },
            }
          : {}),
      },
    }
  }
  if (config.protocol === 'anthropic-messages') {
    if (config.auth === 'api-key') headers['x-api-key'] = config.apiKey
    else headers.Authorization = 'Bearer ' + config.apiKey
    headers['anthropic-version'] = '2023-06-01'
    const converted: Json[] = []
    for (const message of messages) {
      if (message.role === 'assistant' && message.raw) {
        appendMessage(converted, 'assistant', message.raw.content)
        continue
      }
      const content = message.content.map(part => {
        if (part.type === 'text') return { type: 'text', text: part.text }
        if (part.type === 'call')
          return {
            type: 'tool_use',
            id: part.id,
            name: part.name,
            input: JSON.parse(part.args),
          }
        const inline = inlineImage(part.url)
        return {
          type: 'image',
          source: inline
            ? { type: 'base64', media_type: inline.mimeType, data: inline.data }
            : { type: 'url', url: part.url },
        }
      })
      appendMessage(
        converted,
        message.role === 'tool' ? 'user' : message.role,
        message.role === 'tool'
          ? [{ type: 'tool_result', tool_use_id: message.id, content }]
          : content,
      )
    }
    const format = body.text?.format
    return {
      tools,
      url:
        config.baseUrl +
        (/\/v1$/.test(config.baseUrl) ? '/messages' : '/v1/messages'),
      headers,
      body: {
        model,
        system,
        messages: converted,
        stream: true,
        max_tokens: body.max_output_tokens ?? 8192,
        ...(tools.length
          ? {
              tools: tools.map(tool => ({
                name: tool.alias,
                description: tool.description,
                input_schema: tool.schema,
              })),
              tool_choice:
                toolChoice(body, tools, config.protocol) === 'auto'
                  ? { type: 'auto' }
                  : toolChoice(body, tools, config.protocol),
            }
          : {}),
        ...(body.temperature !== undefined
          ? { temperature: body.temperature }
          : {}),
        ...(format?.type === 'json_schema'
          ? {
              output_config: {
                format: { type: 'json_schema', schema: format.schema },
              },
            }
          : {}),
      },
    }
  }
  if (config.protocol === 'gemini') {
    headers['x-goog-api-key'] = config.apiKey
    const converted: Json[] = [],
      names = new Map<string, string>()
    for (const message of messages) {
      if (message.role === 'assistant' && message.raw) {
        for (const part of message.raw.parts ?? [])
          if (part.functionCall?.id)
            names.set(part.functionCall.id, part.functionCall.name)
        appendMessage(converted, 'model', message.raw.parts, 'parts')
        continue
      }
      const content = message.content.map(part => {
        if (part.type === 'text') return { text: part.text }
        if (part.type === 'call') {
          names.set(part.id, part.name)
          return {
            functionCall: {
              id: part.id,
              name: part.name,
              args: JSON.parse(part.args),
            },
          }
        }
        const inline = inlineImage(part.url)
        if (!inline)
          throw Error('Gemini image inputs require inline image data')
        return { inlineData: inline }
      })
      if (message.role === 'tool') {
        const name = names.get(message.id)
        if (!name)
          throw Error('Gemini tool result has no corresponding function call')
        const images = content.filter(part => part.inlineData)
        appendMessage(
          converted,
          'user',
          [
            {
              functionResponse: {
                id: message.id,
                name,
                response: { output: textParts(message.content) },
              },
            },
            ...images,
          ],
          'parts',
        )
      } else
        appendMessage(
          converted,
          message.role === 'assistant' ? 'model' : 'user',
          content,
          'parts',
        )
    }
    const format = body.text?.format
    return {
      tools,
      url:
        config.baseUrl +
        '/' +
        model
          .replace(/^models\//, '')
          .split('/')
          .map(encodeURIComponent)
          .join('/')
          .replace(/^/, 'models/') +
        ':streamGenerateContent?alt=sse',
      headers,
      body: {
        contents: converted,
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        ...(tools.length
          ? {
              tools: [
                {
                  functionDeclarations: tools.map(tool => ({
                    name: tool.alias,
                    description: tool.description,
                    parametersJsonSchema: tool.schema,
                  })),
                },
              ],
              toolConfig: {
                functionCallingConfig: toolChoice(body, tools, config.protocol),
              },
            }
          : {}),
        generationConfig: {
          ...(body.max_output_tokens
            ? { maxOutputTokens: body.max_output_tokens }
            : {}),
          ...(body.temperature !== undefined
            ? { temperature: body.temperature }
            : {}),
          ...(format?.type === 'json_schema'
            ? {
                responseMimeType: 'application/json',
                responseJsonSchema: format.schema,
              }
            : {}),
        },
      },
    }
  }
  throw Error('Responses requests do not need a protocol converter')
}
function appendMessage(
  messages: Json[],
  role: string,
  content: Json[],
  key = 'content',
) {
  if (!Array.isArray(content) || !content.length) return
  if (messages.at(-1)?.role === role) messages.at(-1)![key].push(...content)
  else messages.push({ role, [key]: content })
}
