export {}

const decoder = new TextDecoder()
let buffer = ''
let userMessageCount = 0
let markdownRecoveryMode: 'normal' | 'never' = 'normal'

const completeGddMarkdown = [
  '# Visible Markdown',
  '## Executive Summary',
  '## Vision and Product Promise',
  '## Player Experience and Design Pillars',
  '## Core and Session Loops',
  '## Player Actions and Controls',
  '## Gameplay Rules and Systems',
  '## Game States and Flow',
  '## Progression, Rewards and Economy Boundary',
  '## Content and Narrative Framework',
  '## Challenge, Failure and Recovery',
  '## Accessibility and Localization Intent',
  '## Success Metrics and Analytics Intent',
  '## Scope, Dependencies and Open Decisions',
  '## Production Materials',
  '### Core Loop Diagram',
  '```mermaid',
  'flowchart TD',
  'A --> B',
  '## Heading inside a fenced diagram',
  '```',
  '### Game State Flow',
  '```mermaid',
  'flowchart TD',
  'B --> C',
  '```',
].join('\n')

function emitMarkdownResponse(
  markdown: string,
  stopReason: string,
  userMessageCount: number,
): void {
  process.stdout.write(
    `${JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: markdown } } })}\n`,
  )
  process.stdout.write(
    `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: markdown }], stop_reason: null } })}\n`,
  )
  process.stdout.write(
    `${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: markdown, stop_reason: stopReason, session_id: '550e8400-e29b-41d4-a716-446655440000', received_user_count: userMessageCount, usage: stopReason ? { input_tokens: 12, output_tokens: 4 } : { input_tokens: 0, output_tokens: 0 } })}\n`,
  )
}

for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk, { stream: true })
  for (;;) {
    const newline = buffer.indexOf('\n')
    if (newline < 0) break
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (!line) continue
    const message = JSON.parse(line) as Record<string, unknown>
    if (message.type === 'control_response') {
      process.stdout.write(
        `${JSON.stringify({ type: 'result', subtype: 'success', permissionResponse: message })}\n`,
      )
      continue
    }
    if (message.type !== 'user') continue
    userMessageCount += 1
    const rawContent = (message.message as { content?: unknown } | undefined)
      ?.content
    const content = Array.isArray(rawContent)
      ? (rawContent.find(
          block =>
            block &&
            typeof block === 'object' &&
            (block as { type?: string }).type === 'text',
        ) as { text?: unknown } | undefined)?.text
      : rawContent
    if (content === 'error') {
      process.stdout.write(
        `${JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: '550e8400-e29b-41d4-a716-446655440000', errors: ['provider exploded'] })}\n`,
      )
      continue
    }
    if (content === 'eof') process.exit(0)
    if (content === 'incomplete-success') {
      process.stdout.write(
        `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'planning' }], stop_reason: null } })}\n`,
      )
      process.stdout.write(
        `${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', stop_reason: '', session_id: '550e8400-e29b-41d4-a716-446655440000', usage: { input_tokens: 0, output_tokens: 0 } })}\n`,
      )
      continue
    }
    if (content === 'complete-markdown-without-stop-reason') {
      emitMarkdownResponse(completeGddMarkdown, '', userMessageCount)
      continue
    }
    if (
      content === 'truncated-markdown' ||
      content === 'truncated-markdown-forever' ||
      (userMessageCount > 1 &&
        typeof content === 'string' &&
        content.includes('Continue the same raw Markdown response'))
    ) {
      if (content === 'truncated-markdown-forever')
        markdownRecoveryMode = 'never'
      const recovered = userMessageCount > 1
      const recoveredMarkdown = recovered && markdownRecoveryMode === 'normal'
        ? completeGddMarkdown.slice(completeGddMarkdown.indexOf('\n## Vision and Product Promise'))
        : '# Partial document\n## Executive Summary\nHalf sentence'
      emitMarkdownResponse(
        recoveredMarkdown,
        recovered && markdownRecoveryMode === 'normal' ? 'end_turn' : '',
        userMessageCount,
      )
      continue
    }
    if (content === 'permission') {
      process.stdout.write(
        `${JSON.stringify({
          type: 'control_request',
          request_id: 'permission-1',
          request: {
            subtype: 'can_use_tool',
            tool_name: 'Write',
            tool_use_id: 'tool-1',
            input: { file_path: 'docs/GDD.md', content: 'test' },
          },
        })}\n`,
      )
      continue
    }
    if (content === 'structured-success-without-result') {
      const toolUseID = 'structured-output-1'
      process.stdout.write(
        `${JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: toolUseID,
                name: 'StructuredOutput',
                input: { version: 3 },
              },
            ],
            stop_reason: 'tool_use',
          },
        })}\n`,
      )
      process.stdout.write(
        `${JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: toolUseID,
                content: 'Structured output provided successfully',
              },
            ],
          },
        })}\n`,
      )
      continue
    }
    process.stdout.write(
      `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'working' }] } })}\n`,
    )
    process.stdout.write(
      `${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: '550e8400-e29b-41d4-a716-446655440000', received_session_id: message.session_id, received_content: content })}\n`,
    )
  }
}
