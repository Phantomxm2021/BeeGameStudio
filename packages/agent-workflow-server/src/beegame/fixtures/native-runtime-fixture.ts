export {}

const decoder = new TextDecoder()
let buffer = ''
let userMessageCount = 0
let pendingReview: { path?: string; requestId: unknown } | undefined
let concurrentPermissionReplies = new Set<string>()
let markdownRecoveryMode: 'normal' | 'never' | 'twice' | 'empty_continuation' | 'malformed_once' | 'malformed_forever' = 'normal'

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
      const responseId = (message.response as { request_id?: string }).request_id
      if (responseId === 'finished-turn-permission') {
        process.stdout.write(`${JSON.stringify({ type: 'assistant', unexpectedLatePermissionResponse: true })}\n`)
        continue
      }
      if (responseId?.startsWith('parallel-permission-')) {
        concurrentPermissionReplies.add(responseId)
        process.stdout.write(`${JSON.stringify({ type: 'assistant', permissionResponse: message })}\n`)
        if (concurrentPermissionReplies.size === 2)
          process.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', result: 'Both decisions received' })}\n`)
        continue
      }
      if (pendingReview) {
        if (pendingReview.path) await Bun.write(pendingReview.path, 'complete\n')
        process.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', result: 'Review finished',
          request_id: pendingReview.requestId, permissionResponse: message })}\n`)
        pendingReview = undefined
        continue
      }
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
    const emit = (event: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(event)}\n`)
    const promptText = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent)
    const reviewRace = content === 'late-notification-before-ack' || promptText.includes('fixture:review-race')
    if (reviewRace) {
      emit({ type: 'user', uuid: 'previous-request', isReplay: true, parent_tool_use_id: null })
      emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'Old audio notification handled' }] } })
      emit({ type: 'result', subtype: 'success', result: 'Waiting for review', request_id: 'previous-request' })
      emit({ type: 'stream_event', event: { type: 'message_start' } })
    }
    if (content === 'error-before-ack') {
      emit({ type: 'result', subtype: 'error_during_execution', is_error: true,
        request_id: message.uuid, errors: ['provider failed before replay'] })
      continue
    }
    emit({ type: 'user', uuid: message.uuid, isReplay: true, parent_tool_use_id: null, message: message.message })
    if (content === 'concurrent-permissions' || content === 'permission-after-result') {
      concurrentPermissionReplies = new Set()
      const ids = content === 'concurrent-permissions'
        ? ['parallel-permission-1', 'parallel-permission-2'] : ['finished-turn-permission']
      for (const id of ids) emit({ type: 'control_request', request_id: id, request: {
        subtype: 'can_use_tool', tool_name: 'Bash', tool_use_id: id, input: { command: id },
      } })
      emit({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Other work is still progressing' } } })
      emit({ type: 'system', subtype: 'task_progress', task_id: 'independent-agent', description: 'Still working' })
      if (content === 'permission-after-result')
        emit({ type: 'result', subtype: 'success', result: 'Turn finished before permission decision' })
      continue
    }
    if (reviewRace) {
      emit({ type: 'result', subtype: 'success', parent_tool_use_id: 'child-audio', result: 'Child done' })
      pendingReview = { requestId: message.uuid,
        path: promptText.match(/\.beegame\/tmp\/[^\s]+\/milestone-[\w-]+\.txt/)?.[0] }
      emit({ type: 'control_request', request_id: 'review-permission', request: {
        subtype: 'can_use_tool', tool_name: 'Read', tool_use_id: 'review-read', input: { file_path: '/tmp/fixture.md' },
      } })
      continue
    }
    if (content === 'error') {
      process.stdout.write(
        `${JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: '550e8400-e29b-41d4-a716-446655440000', errors: ['provider exploded'] })}\n`,
      )
      continue
    }
    if (content === 'eof') process.exit(0)
    if (content === 'completed-task-output-without-notification') {
      const emit = (event: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(event)}\n`)
      const task = { type: 'system', task_id: 'review-agent', task_type: 'local_agent' }
      emit({ ...task, subtype: 'task_started', tool_use_id: 'first-activation' })
      emit({ ...task, subtype: 'task_notification', tool_use_id: 'first-activation', status: 'completed' })
      emit({ ...task, subtype: 'task_started', tool_use_id: 'second-activation' })
      emit({ ...task, subtype: 'task_notification', tool_use_id: 'second-activation', status: 'completed' })
      emit({ ...task, subtype: 'task_started', tool_use_id: 'third-activation' })
      emit({ ...task, subtype: 'task_notification', tool_use_id: 'second-activation', status: 'completed' })
      emit({ type: 'assistant', message: { role: 'assistant', content: [{
        type: 'tool_use', name: 'TaskOutput', id: 'task-output-third', input: { task_id: 'review-agent' },
      }] } })
      emit({ type: 'user', message: { role: 'user', content: [{
        type: 'tool_result', tool_use_id: 'task-output-third', content: '<status>completed</status>',
      }] }, tool_use_result: { retrieval_status: 'success', task: { task_id: 'review-agent', status: 'completed' } } })
      // The native runtime can omit the third task_notification after a
      // completed TaskOutput. The parent result must still finish this turn.
      emit({ type: 'result', subtype: 'success', result: 'Review finished', stop_reason: 'end_turn' })
      continue
    }
    if (content === 'stale-task-output-before-reactivation') {
      const emit = (event: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(event)}\n`)
      const task = { type: 'system', task_id: 'review-agent', task_type: 'local_agent' }
      emit({ ...task, subtype: 'task_started', tool_use_id: 'first-activation' })
      emit({ type: 'assistant', message: { role: 'assistant', content: [{
        type: 'tool_use', name: 'TaskOutput', id: 'old-task-output', input: { task_id: 'review-agent' },
      }] } })
      emit({ ...task, subtype: 'task_started', tool_use_id: 'second-activation' })
      emit({ type: 'user', message: { role: 'user', content: [{
        type: 'tool_result', tool_use_id: 'old-task-output', content: '<status>completed</status>',
      }] }, tool_use_result: { retrieval_status: 'success', task: { task_id: 'review-agent', status: 'completed' } } })
      emit({ type: 'result', subtype: 'success', result: 'Old result only' })
      setTimeout(() => {
        emit({ ...task, subtype: 'task_notification', tool_use_id: 'second-activation', status: 'completed' })
        emit({ type: 'result', subtype: 'success', result: 'Resumed review finished' })
      }, 20)
      continue
    }
    if (typeof content === 'string' && content.startsWith('agent-lifecycle:')) {
      const emit = (event: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(event)}\n`)
      const task = { type: 'system', task_id: 'reused-agent', tool_use_id: 'first-launch' }
      emit({ ...task, subtype: 'task_started', task_type: 'local_agent' })
      emit({ ...task, subtype: 'task_notification', status: 'completed' })
      const resumed = { ...task, tool_use_id: 'send-message-resume' }
      emit({ ...resumed, subtype: 'task_started', task_type: 'local_agent' })
      // A late terminal from the previous activation must not close the new one.
      emit({ ...task, subtype: 'task_notification', status: 'completed' })
      emit({ type: 'result', subtype: 'success', result: 'Waiting for review' })
      if (content === 'agent-lifecycle:pending') continue
      if (content === 'agent-lifecycle:eof') { setTimeout(() => process.exit(0), 20); continue }
      setTimeout(() => {
        emit({ ...resumed, subtype: 'task_notification', status: 'completed' })
        if (content === 'agent-lifecycle:idle-without-parent') {
          emit({ type: 'system', subtype: 'session_state_changed', state: 'idle' })
          return
        }
        emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Review consumed; implementation finished.' }] } })
        emit({ type: 'result', subtype: 'success', result: 'Implementation finished', received_user_count: userMessageCount })
      }, 20)
      continue
    }
    if (content === 'background-server') {
      process.stdout.write(`${JSON.stringify({ type: 'system', subtype: 'task_started', task_type: 'local_bash', task_id: 'dev-server' })}\n`)
      process.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', result: 'Finished with server running' })}\n`)
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
    if (content === 'post-result-task-notification') {
      process.stdout.write(
        `${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: '550e8400-e29b-41d4-a716-446655440000' })}\n`,
      )
      setTimeout(() => {
        process.stdout.write(
          `${JSON.stringify({ type: 'system', subtype: 'task_notification', value: '<task-id>task-after-result</task-id><status>completed</status>' })}\n`,
        )
      }, 10)
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
        : recovered && markdownRecoveryMode === 'normal'
          ? completeGddMarkdown.slice(completeGddMarkdown.indexOf('\n## Vision and Product Promise'))
          : '# Partial document\n## Executive Summary\nHalf sentence'
      emitMarkdownResponse(
        recoveredMarkdown,
        markdownRecoveryMode === 'malformed_once' || markdownRecoveryMode === 'malformed_forever'
          ? 'end_turn'
        : recovered && markdownRecoveryMode !== 'never' ? 'end_turn' : '',
        userMessageCount,
      )
      continue
    }
    if (content === 'permission' || content === 'question') {
      process.stdout.write(
        `${JSON.stringify({
          type: 'control_request',
          request_id: 'permission-1',
          request: {
            subtype: 'can_use_tool',
            tool_name: content === 'question' ? 'AskUserQuestion' : 'Write',
            tool_use_id: 'tool-1',
            decision_reason: 'Target requires explicit authorization',
            blocked_path: 'docs/GDD.md',
            input: content === 'question'
              ? { questions: [{ question: 'Which style?', header: 'Style', options: [{ label: 'Pixel', description: 'Pixel art' }, { label: 'Vector', description: 'Vector art' }], multiSelect: false }] }
              : { file_path: 'docs/GDD.md', content: 'test' },
            permission_suggestions: [
              {
                type: 'addRules',
                rules: [{ toolName: 'Write', ruleContent: 'docs/GDD.md' }],
                behavior: 'allow',
                destination: 'localSettings',
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
