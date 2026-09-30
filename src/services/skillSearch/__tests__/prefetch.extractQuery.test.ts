import { describe, expect, test } from 'bun:test'
import { extractQueryFromMessages } from '../prefetch.js'
import type { Message } from '../../../types/message.js'
import { createUserMessage } from '../../../utils/messages.js'

function userText(text: string): Message {
  return createUserMessage({ content: text })
}

function userTextBlocks(text: string): Message {
  return createUserMessage({ content: [{ type: 'text', text }] })
}

function userToolResult(id: string): Message {
  return createUserMessage({
    content: [{ type: 'tool_result', tool_use_id: id, content: 'output' }],
  })
}

function assistantText(text: string): Message {
  return {
    type: 'assistant',
    message: { content: [{ type: 'text', text }] },
  } as unknown as Message
}

describe('extractQueryFromMessages — inter-turn任务信号', () => {
  test('子任务首次请求使用原生用户消息里的任务文本', () => {
    const task = 'Review game design evidence before completion.'
    expect(extractQueryFromMessages(null, [userText(task)])).toBe(task)
    expect(extractQueryFromMessages(null, [userTextBlocks(task)])).toBe(task)
  })

  test('null input + messages末尾是tool_result → 使用最近的assistant可见文本', () => {
    const messages: Message[] = [
      userText('研究当前代码'),
      assistantText('调用工具'),
      userToolResult('tool_01'),
    ]
    const query = extractQueryFromMessages(null, messages)
    expect(query).toBe('调用工具')
  })

  test('null input + messages末尾是text block形式的user → 正确提取', () => {
    const messages: Message[] = [
      userTextBlocks('refactor the auth module'),
      assistantText('thinking...'),
      userToolResult('tool_02'),
    ]
    const query = extractQueryFromMessages(null, messages)
    expect(query).toBe('thinking...')
  })

  test('自动续跑同时检索用户文本和当前阶段任务', () => {
    const messages: Message[] = [
      createUserMessage({
        content: [
          {
            type: 'text',
            text: 'Continue the current project delivery milestone.',
          },
          {
            type: 'text',
            text: 'Current delivery milestone: resources. Prepare tilemap atlases and the asset manifest.',
          },
        ],
      }),
    ]
    const query = extractQueryFromMessages(null, messages)
    expect(query).toContain('Continue the current project delivery milestone')
    expect(query).toContain('resources. Prepare tilemap atlases')
  })

  test('null input + 连续多轮tool_result → 使用最新的assistant可见文本', () => {
    const messages: Message[] = [
      userText('研究当前代码'),
      assistantText('第一次调用'),
      userToolResult('tool_a'),
      assistantText('第二次调用'),
      userToolResult('tool_b'),
      assistantText('第三次调用'),
      userToolResult('tool_c'),
    ]
    const query = extractQueryFromMessages(null, messages)
    expect(query).toBe('第三次调用')
  })

  test('长回合使用最近的可见任务，不读取工具输出或私有思考', () => {
    const messages: Message[] = [
      userText('制作塔防游戏'),
      {
        type: 'assistant',
        message: { content: [
          { type: 'thinking', thinking: 'private text' },
          { type: 'text', text: '现在写 UI/UX 规格，逐屏确定布局。' },
          { type: 'tool_use', name: 'Write', input: { content: 'tool arguments' } },
        ] },
      } as unknown as Message,
      userToolResult('tool_ui'),
    ]
    expect(extractQueryFromMessages(null, messages)).toBe('现在写 UI/UX 规格，逐屏确定布局。')
  })

  test('null input + 空messages → 空串', () => {
    const query = extractQueryFromMessages(null, [])
    expect(query).toBe('')
  })

  test('null input + 全是tool_result (无真实文本) → 空串', () => {
    const messages: Message[] = [
      userToolResult('tool_a'),
      userToolResult('tool_b'),
    ]
    const query = extractQueryFromMessages(null, messages)
    expect(query).toBe('')
  })

  test('string input + null messages → 只返回input', () => {
    const query = extractQueryFromMessages('hello world', [])
    expect(query).toBe('hello world')
  })

  test('string input + 有user文本 → 两者拼接', () => {
    const messages: Message[] = [userText('previous query')]
    const query = extractQueryFromMessages('new query', messages)
    expect(query).toContain('new query')
    expect(query).toContain('previous query')
  })

  test('保留长任务末尾的核查目标，而不是仅截取开头的源资料', () => {
    const longText = 'source reference '.repeat(100) + 'Review design evidence and revisions.'
    const messages: Message[] = [userText(longText)]
    const query = extractQueryFromMessages(null, messages)
    expect(query).toBe(longText)
    expect(extractQueryFromMessages(null, [userTextBlocks(longText)])).toBe(longText)
  })

  test('多个长文本块中的任务目标均可检索，不混入工具结果', () => {
    const source = 'source '.repeat(200)
    const goal = 'Check the assumptions behind the current revision.'
    const message = createUserMessage({ content: [
      { type: 'text', text: source }, { type: 'text', text: goal },
      { type: 'tool_result', tool_use_id: 'ignored', content: 'private output' },
    ] })
    expect(extractQueryFromMessages(null, [message])).toBe(source + ' ' + goal)
  })

  test('tool_result里含text字段 (但type=tool_result) → 必须跳过，不能误用', () => {
    const messages: Message[] = [
      userText('real query'),
      createUserMessage({
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool_a',
            content: 'output',
            ...{ text: 'this is tool output masquerading as text' },
          },
        ],
      }),
    ]
    const query = extractQueryFromMessages(null, messages)
    expect(query).toBe('real query')
  })

  test('user content数组里text为空串 → 跳过空text继续找', () => {
    const messages: Message[] = [
      userText('real query'),
      createUserMessage({
        content: [{ type: 'text', text: '   ' }],
      }),
    ]
    const query = extractQueryFromMessages(null, messages)
    expect(query).toBe('real query')
  })
})
