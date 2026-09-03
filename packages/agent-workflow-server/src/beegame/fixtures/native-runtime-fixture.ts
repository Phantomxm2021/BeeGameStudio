export {}

const decoder = new TextDecoder()
let buffer = ''
let userMessageCount = 0
const receivedPrompts: string[] = []
const receivedSessionIds: string[] = []
let assetScenario: string | undefined
let markdownRecoveryMode: 'normal' | 'never' | 'twice' | 'empty_continuation' | 'empty_terminal_append' | 'malformed_once' | 'malformed_forever' = 'normal'

const completeGddMarkdown = [
  '# Visible Markdown',
  '## Executive Summary',
  '## Vision and Product Promise',
  '### Vision subheading',
  'Section detail.',
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

const malformedGddMarkdown = completeGddMarkdown.replace(
  '## Vision and Product Promise\n',
  '## Vision and Product PromiseSection detail without a heading boundary.\n',
)

const completeAssetMarkdown = [
  '# Asset Plan',
  '## Executive Summary',
  'summary',
  '## Asset and Content Inventory',
  'inventory',
  '## Ownership and Responsibility',
  'ownership',
  '## Dependencies and Integration Order',
  'dependencies',
  '## Source, Originality and Licensing',
  'licensing',
  '## Formats, Variants and Budgets',
  'formats',
  '## Production Pipeline and Naming',
  'pipeline',
  '## Milestones, Capacity and Schedule',
  'milestones',
  '## Validation and Quality Status',
  'validation',
  '## Placeholder and Replacement Strategy',
  'replacement',
  '## Delivery, Release and Risks',
  'risks',
  '## Production Materials',
  '### Asset Inventory Table',
  'material',
  '### Responsibility Matrix',
  'material',
  '### Dependency and Integration Diagram',
  'material',
  '### License Register',
  'material',
  '### Milestone and Maturity Table',
  'material',
].join('\n')

const capturedAssetMarkdown = [
  '# Asset Plan',
  '## Executive Summary',
  'summary',
  '## Asset and Content Inventory',
  'inventory',
  '### Asset Inventory Table',
  'material',
  '## Ownership and Responsibility',
  'ownership',
  '### Responsibility Matrix',
  'material',
  '## Dependencies and Integration Order',
  'dependencies',
  '### Dependency and Integration Diagram',
  'material',
  '## Source, Originality and Licensing',
  'licensing',
  '### License Register',
  'material',
  '## Formats, Variants and Budgets',
  'formats',
  '## Production Pipeline and Naming',
  'pipeline',
  '## Milestones, Capacity and Schedule',
  'milestones',
  '### Milestone and Maturity Table',
  'material',
  '## Validation and Quality Status',
  'validation',
  '## Placeholder and Replacement Strategy',
  'replacement',
  '## Delivery, Release and Risks',
  'risks',
].join('\n')

const malformedAssetMarkdown = completeAssetMarkdown.replace(
  '## Ownership and Responsibility\n',
  '## Delivery, Release and Risks\n',
)

function emitMarkdownResponse(
  markdown: string,
  stopReason: string,
  userMessageCount: number,
  options: { stream?: boolean; terminalResult?: string } = {},
): void {
  if (options.stream !== false) {
    process.stdout.write(
      `${JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: markdown } } })}\n`,
    )
    process.stdout.write(
      `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: markdown }], stop_reason: null } })}\n`,
    )
  }
  process.stdout.write(
    `${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: options.terminalResult ?? markdown, stop_reason: stopReason, session_id: '550e8400-e29b-41d4-a716-446655440000', received_user_count: userMessageCount, received_prompts: receivedPrompts, received_session_ids: receivedSessionIds, usage: stopReason ? { input_tokens: 12, output_tokens: 4 } : { input_tokens: 0, output_tokens: 0 } })}\n`,
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
    receivedSessionIds.push(typeof message.session_id === 'string' ? message.session_id : '')
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
    receivedPrompts.push(typeof content === 'string' ? content : '')
    if (content === 'error') {
      process.stdout.write(
        `${JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: '550e8400-e29b-41d4-a716-446655440000', errors: ['provider exploded'] })}\n`,
      )
      continue
    }
    if (content === 'eof') process.exit(0)
    if (typeof content === 'string' && content.startsWith('asset-')) {
      assetScenario = content
      if (userMessageCount === 1) {
        emitMarkdownResponse(capturedAssetMarkdown, 'end_turn', userMessageCount)
        continue
      }
    }
    if (assetScenario && userMessageCount > 1 && typeof content === 'string' && content.includes('complete replacement')) {
        if (assetScenario.endsWith('-empty'))
          emitMarkdownResponse('', 'end_turn', userMessageCount, { stream: false })
        else if (assetScenario.includes('identical'))
          emitMarkdownResponse(capturedAssetMarkdown, 'end_turn', userMessageCount)
        else if (assetScenario.includes('still-invalid'))
          emitMarkdownResponse(malformedAssetMarkdown, 'end_turn', userMessageCount)
        else if (assetScenario.includes('terminal-only'))
          emitMarkdownResponse(completeAssetMarkdown, 'end_turn', userMessageCount, { stream: false })
        else if (assetScenario.includes('stream-empty-terminal'))
          emitMarkdownResponse(completeAssetMarkdown, 'end_turn', userMessageCount, { terminalResult: '' })
        else
          emitMarkdownResponse(completeAssetMarkdown, 'end_turn', userMessageCount)
        continue
    }
    if (content === 'streamed-complete-empty-terminal') {
      emitMarkdownResponse(completeGddMarkdown, 'end_turn', userMessageCount, { terminalResult: '' })
      continue
    }
    if (content === 'incomplete-success') {
      process.stdout.write(
        `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'planning' }], stop_reason: null } })}\n`,
      )
      process.stdout.write(
        `${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', stop_reason: '', session_id: '550e8400-e29b-41d4-a716-446655440000', usage: { input_tokens: 0, output_tokens: 0 } })}\n`,
      )
      continue
    }
    if (
      userMessageCount > 1 &&
      typeof content === 'string' &&
      content.includes('complete raw Markdown document from the beginning')
    ) {
      emitMarkdownResponse(
        markdownRecoveryMode === 'malformed_forever'
          ? malformedGddMarkdown
          : completeGddMarkdown,
        'end_turn',
        userMessageCount,
      )
      continue
    }
    if (content === 'complete-markdown-without-stop-reason') {
      emitMarkdownResponse(completeGddMarkdown, '', userMessageCount)
      continue
    }
    if (
      content === 'truncated-markdown' ||
      content === 'truncated-markdown-twice' ||
      content === 'truncated-markdown-empty-continuation' ||
      content === 'truncated-markdown-empty-terminal-continuation' ||
      content === 'truncated-markdown-forever' ||
      content === 'malformed-markdown-end-turn' ||
      content === 'malformed-markdown-end-turn-forever' ||
      (userMessageCount > 1 &&
        typeof content === 'string' &&
        content.includes('Continue the same raw Markdown response'))
    ) {
      if (content === 'truncated-markdown-forever')
        markdownRecoveryMode = 'never'
      if (content === 'truncated-markdown-twice')
        markdownRecoveryMode = 'twice'
      if (content === 'truncated-markdown-empty-continuation')
        markdownRecoveryMode = 'empty_continuation'
      if (content === 'truncated-markdown-empty-terminal-continuation')
        markdownRecoveryMode = 'empty_terminal_append'
      if (content === 'malformed-markdown-end-turn')
        markdownRecoveryMode = 'malformed_once'
      if (content === 'malformed-markdown-end-turn-forever')
        markdownRecoveryMode = 'malformed_forever'
      const recovered = userMessageCount > 1
      const recoveredMarkdown = markdownRecoveryMode === 'malformed_once' ||
          markdownRecoveryMode === 'malformed_forever'
        ? malformedGddMarkdown
        : markdownRecoveryMode === 'twice' && userMessageCount === 2
          ? completeGddMarkdown.slice(
              completeGddMarkdown.indexOf('\n## Vision and Product Promise'),
              completeGddMarkdown.indexOf('\n## Player Experience and Design Pillars'),
            )
        : markdownRecoveryMode === 'twice' && userMessageCount > 2
            ? completeGddMarkdown.slice(
                completeGddMarkdown.indexOf('\n## Player Experience and Design Pillars'),
              )
          : markdownRecoveryMode === 'empty_continuation' && recovered
            ? ''
        : markdownRecoveryMode === 'empty_terminal_append' && recovered
          ? completeGddMarkdown.slice(completeGddMarkdown.indexOf('\n## Vision and Product Promise'))
        : recovered && markdownRecoveryMode === 'normal'
          ? completeGddMarkdown.slice(completeGddMarkdown.indexOf('\n## Vision and Product Promise'))
          : '# Partial document\n## Executive Summary\nHalf sentence'
      emitMarkdownResponse(
        recoveredMarkdown,
        markdownRecoveryMode === 'malformed_once' || markdownRecoveryMode === 'malformed_forever'
          ? 'end_turn'
        : recovered && markdownRecoveryMode !== 'never' ? 'end_turn' : '',
        userMessageCount,
        markdownRecoveryMode === 'empty_terminal_append' && recovered
          ? { terminalResult: '' }
          : undefined,
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
