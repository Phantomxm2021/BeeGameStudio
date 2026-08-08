import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions/completions.mjs'
import { randomUUID } from 'crypto'
import { normalizeOpenAIUsage } from './openaiUsage.js'
import { assertProviderCompletionReason } from './providerTerminal.js'

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
 *   prompt_tokens - cached_tokens             → input_tokens (non-cached input only)
 *   completion_tokens                         → output_tokens
 *   prompt_tokens_details.cached_tokens       → cache_read_input_tokens
 *   (no OpenAI equivalent)                    → cache_creation_input_tokens (always 0)
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

  // Track tool calls by provider index until the provider has supplied a
  // usable function name. OpenAI-compatible streams are allowed to split the
  // id/name metadata from the argument fragments; opening an Anthropic block
  // on the first fragment would permanently emit an empty name and make the
  // downstream tool executor reject an otherwise recoverable call.
  const toolBlocks = new Map<
    number,
    {
      contentIndex: number
      id: string
      name: string
      arguments: string
      started: boolean
    }
  >()

  // Track thinking block state
  let thinkingBlockOpen = false

  // Track text block state
  let textBlockOpen = false
  let visibleTextStarted = false
  let emptyThinkingMarkerEmitted = false

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

    // Skip chunks that carry only usage data (no delta content)
    if (!delta) continue

    // Handle reasoning_content → Anthropic thinking block.
    // Empty string is a valid signal: DeepSeek v4 thinking mode sometimes
    // returns reasoning_content: "" when the model answers directly. The
    // empty thinking block must round-trip back to the API in subsequent
    // requests, otherwise DeepSeek rejects with 400.
    const reasoningContent = (delta as any).reasoning_content
    if (reasoningContent != null) {
      const hasReasoningDelta = reasoningContent !== ''
      const shouldOpenThinking =
        hasReasoningDelta ||
        (!visibleTextStarted && !emptyThinkingMarkerEmitted)

      // Some OpenAI-compatible providers repeat reasoning_content: "" on
      // ordinary visible-text chunks. That is not a transition back into
      // reasoning. Reopening thinking here would split one answer into many
      // text blocks and therefore many SDK assistant fragments. Preserve one
      // initial empty marker for providers that require it to round-trip, then
      // ignore later empty markers.
      if (shouldOpenThinking && !thinkingBlockOpen) {
        // Some OpenAI-compatible reasoning models alternate between visible
        // text and reasoning more than once in a single response. Anthropic
        // content blocks cannot overlap, so close the active text block before
        // reopening thinking. Without this transition, later text deltas are
        // attached to a thinking block and disappear from the final message.
        if (textBlockOpen) {
          yield {
            type: 'content_block_stop',
            index: currentContentIndex,
          } as BetaRawMessageStreamEvent
          openBlockIndices.delete(currentContentIndex)
          textBlockOpen = false
        }

        currentContentIndex++
        thinkingBlockOpen = true
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
        if (!hasReasoningDelta) emptyThinkingMarkerEmitted = true
      }

      if (hasReasoningDelta) {
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
    if (delta.content != null && delta.content !== '') {
      visibleTextStarted = true
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
        index: currentContentIndex,
        delta: {
          type: 'text_delta',
          text: delta.content,
        },
      } as BetaRawMessageStreamEvent
    }

    // Handle tool calls
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const tcIndex = tc.index

        if (!toolBlocks.has(tcIndex)) {
          toolBlocks.set(tcIndex, {
            contentIndex: -1,
            id: tc.id?.trim() || '',
            name: tc.function?.name?.trim() || '',
            arguments: '',
            started: false,
          })
        }

        const block = toolBlocks.get(tcIndex)!
        if (tc.id?.trim()) block.id = tc.id.trim()
        if (tc.function?.name?.trim()) block.name = tc.function.name.trim()

        // Stream argument fragments
        const argFragment = tc.function?.arguments
        if (argFragment) block.arguments += argFragment

        if (!block.started && block.name) {
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
              index: currentContentIndex,
            } as BetaRawMessageStreamEvent
            openBlockIndices.delete(currentContentIndex)
            textBlockOpen = false
          }

          currentContentIndex++
          block.contentIndex = currentContentIndex
          block.started = true
          const toolId =
            block.id || `toolu_${randomUUID().replace(/-/g, '').slice(0, 24)}`
          block.id = toolId
          openBlockIndices.add(currentContentIndex)

          yield {
            type: 'content_block_start',
            index: currentContentIndex,
            content_block: {
              type: 'tool_use',
              id: toolId,
              name: block.name,
              input: {},
            },
          } as BetaRawMessageStreamEvent

          if (block.arguments) {
            yield {
              type: 'content_block_delta',
              index: block.contentIndex,
              delta: {
                type: 'input_json_delta',
                partial_json: block.arguments,
              },
            } as BetaRawMessageStreamEvent
          }
        } else if (block.started && argFragment) {
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
          index: currentContentIndex,
        } as BetaRawMessageStreamEvent
        openBlockIndices.delete(currentContentIndex)
        textBlockOpen = false
      }

      for (const [toolIndex, block] of toolBlocks) {
        if (!block.started) {
          const missing = block.name ? 'id' : 'name'
          throw new Error(
            `Provider returned an incomplete tool call at index ${toolIndex}: missing ${missing}`,
          )
        }
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

  assertProviderCompletionReason(pendingFinishReason)

  // Safety: close any remaining open blocks
  for (const idx of openBlockIndices) {
    yield {
      type: 'content_block_stop',
      index: idx,
    } as BetaRawMessageStreamEvent
  }

  // Emit message_delta + message_stop
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

  yield {
    type: 'message_stop',
  } as BetaRawMessageStreamEvent
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
    case 'content_filter':
      return 'end_turn'
    default:
      return 'end_turn'
  }
}
