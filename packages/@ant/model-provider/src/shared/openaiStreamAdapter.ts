import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions/completions.mjs'
import { randomUUID } from 'crypto'
import { normalizeOpenAIUsage } from './openaiUsage.js'

export class OpenAIProtocolError extends Error {}

/**
 * Adapt an OpenAI streaming response into Anthropic BetaRawMessageStreamEvent.
 *
 * Mapping:
 *   First chunk              → message_start
 *   delta.reasoning_content  → content_block_start(thinking) + thinking_delta + content_block_stop
 *   delta.content            → content_block_start(text) + text_delta + content_block_stop
 *   delta.tool_calls         → content_block_start(tool_use) + input_json_delta + content_block_stop
 *   finish_reason            → message_delta(stop_reason) + message_stop
 *
 * Usage field mapping (OpenAI → Anthropic):
 *   prompt_tokens - cached_tokens - cache_write_tokens → input_tokens
 *   completion_tokens                         → output_tokens
 *   prompt_tokens_details.cached_tokens       → cache_read_input_tokens
 *   prompt_tokens_details.cache_write_tokens  → cache_creation_input_tokens
 *
 *   All four fields are emitted in the post-loop message_delta (not message_start)
 *   so that trailing usage chunks (sent after finish_reason by some
 *   OpenAI-compatible endpoints) are fully captured before the final counts are reported.
 *
 * Thinking support:
 *   DeepSeek and compatible providers send `delta.reasoning_content` for chain-of-thought.
 *   This is mapped to Anthropic's `thinking` content blocks:
 *     content_block_start: { type: 'thinking', thinking: '', signature: '' }
 *     content_block_delta: { type: 'thinking_delta', thinking: '...' }
 *
 * Prompt caching:
 *   OpenAI reports cached tokens in usage.prompt_tokens_details.cached_tokens.
 *   This is mapped to Anthropic's cache_read_input_tokens.
 */
export async function* adaptOpenAIStreamToAnthropic(
  stream: AsyncIterable<ChatCompletionChunk>,
  model: string,
  options?: { includeCacheWriteTokens?: boolean },
): AsyncGenerator<BetaRawMessageStreamEvent, void> {
  const messageId = `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`

  let started = false
  let currentContentIndex = -1

  // Track tool_use blocks: tool_calls index → { contentIndex, id, name, arguments }
  const toolBlocks = new Map<
    number,
    { contentIndex: number; id: string; name: string; arguments: string }
  >()

  // Track thinking block state
  let thinkingBlockOpen = false
  let thinkingBlockSeen = false

  // Track text block state
  let textBlockOpen = false
  let textBlockIndex = -1

  // Track raw OpenAI usage across chunks. The normalized Anthropic fields are
  // disjoint: ordinary input + cache reads + cache writes = total input.
  let rawInputTokens = 0
  let outputTokens = 0
  let rawCacheReadTokens = 0
  let rawCacheWriteTokens = 0
  let usage = normalizeOpenAIUsage({ totalInputTokens: 0, outputTokens: 0 })

  // Track all open content block indices (for cleanup)
  const openBlockIndices = new Set<number>()

  // Deferred finish state
  let pendingFinishReason: string | null = null
  let pendingHasToolCalls = false
  let protocolError: OpenAIProtocolError | undefined

  for await (const chunk of stream) {
    const choice = chunk.choices?.[0]
    const delta = choice?.delta

    // Extract usage from any chunk that carries it.
    if (chunk.usage) {
      rawInputTokens = chunk.usage.prompt_tokens ?? rawInputTokens
      outputTokens = chunk.usage.completion_tokens ?? outputTokens

      const usageRecord = chunk.usage as unknown as Record<string, unknown>
      const detailsValue = usageRecord.prompt_tokens_details
      const details =
        detailsValue && typeof detailsValue === 'object'
          ? (detailsValue as Record<string, unknown>)
          : undefined
      if (typeof details?.cached_tokens === 'number') {
        rawCacheReadTokens = details.cached_tokens
      }
      if (
        options?.includeCacheWriteTokens &&
        typeof details?.cache_write_tokens === 'number'
      ) {
        rawCacheWriteTokens = details.cache_write_tokens
      } else if (!options?.includeCacheWriteTokens) {
        rawCacheWriteTokens = 0
      }

      usage = normalizeOpenAIUsage({
        totalInputTokens: rawInputTokens,
        outputTokens,
        cacheReadTokens: rawCacheReadTokens,
        cacheWriteTokens: rawCacheWriteTokens,
      })
    }

    // Emit message_start on first chunk
    if (!started) {
      started = true

      yield {
        type: 'message_start',
        message: {
          id: messageId,
          type: 'message',
          role: 'assistant',
          content: [],
          model,
          stop_reason: null,
          stop_sequence: null,
          usage: {
            ...usage,
            output_tokens: 0,
          },
        },
      } as unknown as BetaRawMessageStreamEvent
    }

    // Some compatible endpoints omit delta on the terminal choice. Process
    // finish_reason independently so an explicit completion is not discarded.
    if (pendingFinishReason !== null && (delta?.content || delta?.refusal ||
      (delta as any)?.reasoning_content || delta?.tool_calls?.length)) {
      protocolError ??= new OpenAIProtocolError('Response contained content after its terminal finish_reason')
      continue
    }

    // Handle reasoning_content → Anthropic thinking block.
    // Empty string is a valid signal: DeepSeek v4 thinking mode sometimes
    // returns reasoning_content: "" when the model answers directly. The
    // empty thinking block must round-trip back to the API in subsequent
    // requests, otherwise DeepSeek rejects with 400.
    const reasoningContent = (delta as any)?.reasoning_content
    // Preserve the first observed empty field even if text/tools arrived first.
    // Repeated empty fields must not reopen an already observed thinking block.
    if (
      reasoningContent != null &&
      (reasoningContent !== '' || !thinkingBlockSeen)
    ) {
      if (!thinkingBlockOpen) {
        currentContentIndex++
        thinkingBlockOpen = true
        thinkingBlockSeen = true
        openBlockIndices.add(currentContentIndex)

        yield {
          type: 'content_block_start',
          index: currentContentIndex,
          content_block: {
            type: 'thinking',
            thinking: '',
            signature: '',
          },
        } as BetaRawMessageStreamEvent
      }

      if (reasoningContent !== '') {
        yield {
          type: 'content_block_delta',
          index: currentContentIndex,
          delta: {
            type: 'thinking_delta',
            thinking: reasoningContent,
          },
        } as BetaRawMessageStreamEvent
      }
    }

    // Handle text content
    const text = (delta?.content ?? '') + (delta?.refusal ?? '')
    if (text !== '') {
      if (!textBlockOpen) {
        // Close thinking block if still open
        if (thinkingBlockOpen) {
          yield {
            type: 'content_block_stop',
            index: currentContentIndex,
          } as BetaRawMessageStreamEvent
          openBlockIndices.delete(currentContentIndex)
          thinkingBlockOpen = false
        }

        currentContentIndex++
        textBlockOpen = true
        textBlockIndex = currentContentIndex
        openBlockIndices.add(currentContentIndex)

        yield {
          type: 'content_block_start',
          index: currentContentIndex,
          content_block: {
            type: 'text',
            text: '',
          },
        } as BetaRawMessageStreamEvent
      }

      yield {
        type: 'content_block_delta',
        index: textBlockIndex,
        delta: {
          type: 'text_delta',
          text,
        },
      } as BetaRawMessageStreamEvent
    }

    // Handle tool calls
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const tcIndex = tc.index
        if (!Number.isInteger(tcIndex) || tcIndex < 0) {
          protocolError ??= new OpenAIProtocolError('Tool call is missing a valid index')
          continue
        }

        if (!toolBlocks.has(tcIndex)) {
          toolBlocks.set(tcIndex, { contentIndex: -1, id: '', name: '', arguments: '' })
        }
        const block = toolBlocks.get(tcIndex)!
        if (block.contentIndex >= 0 && ((tc.id && tc.id !== block.id) ||
          (tc.function?.name && tc.function.name !== block.name))) {
          protocolError ??= new OpenAIProtocolError('Tool call identity changed while streaming')
          continue
        }
        block.id = tc.id || block.id
        block.name = tc.function?.name || block.name
        const fragment = tc.function?.arguments ?? ''
        block.arguments += fragment
        let argFragment = fragment

        if (block.contentIndex < 0) {
          // Headers may arrive after argument fragments. Do not invent an ID
          // or publish an empty name that later metadata can no longer repair.
          if (!block.id || !block.name) continue
          // Close thinking block if open
          if (thinkingBlockOpen) {
            yield {
              type: 'content_block_stop',
              index: currentContentIndex,
            } as BetaRawMessageStreamEvent
            openBlockIndices.delete(currentContentIndex)
            thinkingBlockOpen = false
          }

          // Close text block if open
          if (textBlockOpen) {
            yield {
              type: 'content_block_stop',
              index: textBlockIndex,
            } as BetaRawMessageStreamEvent
            openBlockIndices.delete(textBlockIndex)
            textBlockOpen = false
          }

          // Start new tool_use block
          currentContentIndex++
          block.contentIndex = currentContentIndex
          openBlockIndices.add(currentContentIndex)

          yield {
            type: 'content_block_start',
            index: currentContentIndex,
            content_block: {
              type: 'tool_use',
              id: block.id,
              name: block.name,
              input: {},
            },
          } as BetaRawMessageStreamEvent
          argFragment = block.arguments
        }

        // Stream argument fragments
        if (argFragment) {
          yield {
            type: 'content_block_delta',
            index: block.contentIndex,
            delta: {
              type: 'input_json_delta',
              partial_json: argFragment,
            },
          } as BetaRawMessageStreamEvent
        }
      }
    }

    // Handle finish
    if (choice?.finish_reason) {
      if (pendingFinishReason !== null && pendingFinishReason !== choice.finish_reason) {
        protocolError ??= new OpenAIProtocolError('Response contained conflicting terminal finish reasons')
      }
      if (thinkingBlockOpen) {
        yield {
          type: 'content_block_stop',
          index: currentContentIndex,
        } as BetaRawMessageStreamEvent
        openBlockIndices.delete(currentContentIndex)
        thinkingBlockOpen = false
      }

      if (textBlockOpen) {
        yield {
          type: 'content_block_stop',
          index: textBlockIndex,
        } as BetaRawMessageStreamEvent
        openBlockIndices.delete(textBlockIndex)
        textBlockOpen = false
      }

      for (const [, block] of toolBlocks) {
        if (openBlockIndices.has(block.contentIndex)) {
          yield {
            type: 'content_block_stop',
            index: block.contentIndex,
          } as BetaRawMessageStreamEvent
          openBlockIndices.delete(block.contentIndex)
        }
      }

      pendingFinishReason = choice.finish_reason
      pendingHasToolCalls = toolBlocks.size > 0
    }
  }

  // EOF is not completion. Never turn truncated text/tool arguments into a
  // completed block when the provider did not send a terminal finish reason.
  if (pendingFinishReason === null) {
    throw new Error(
      'OpenAI stream ended before a terminal finish_reason was received',
    )
  }

  // Close any remaining open blocks only after confirmed completion.
  for (const idx of openBlockIndices) {
    yield {
      type: 'content_block_stop',
      index: idx,
    } as BetaRawMessageStreamEvent
  }

  // Emit message_delta + message_stop
  if (pendingFinishReason !== null) {
    const stopReason =
      pendingFinishReason === 'length'
        ? 'max_tokens'
        : pendingHasToolCalls
          ? 'tool_use'
          : mapFinishReason(pendingFinishReason)

    yield {
      type: 'message_delta',
      delta: {
        stop_reason: stopReason,
        stop_sequence: null,
      },
      usage,
    } as BetaRawMessageStreamEvent

    if ([...toolBlocks.values()].some(block => block.contentIndex < 0)) {
      protocolError ??= new OpenAIProtocolError('Tool call is missing its ID or function name')
    }
    if (protocolError) throw protocolError

    yield {
      type: 'message_stop',
    } as BetaRawMessageStreamEvent
  }
}

/**
 * Map OpenAI finish_reason to Anthropic stop_reason.
 */
function mapFinishReason(reason: string): string {
  switch (reason) {
    case 'stop':
      return 'end_turn'
    case 'tool_calls':
      return 'tool_use'
    case 'length':
      return 'max_tokens'
    default:
      return reason
  }
}
