import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ChatDisplayMessage } from '../viewModels/displayModels';
import { BeeGameCollaborationFeed } from './BeeGameCollaborationFeed';
import { toChatDisplayMessages } from '../../../viewModels/displayModels';
import { normalizeChatHistory } from '../../../utils/chatHistory';
import { sampleMessages } from '../../../test/fixtures/canonicalTranscript';

const CHECKLIST_TURN_ID = 'beegame-turn-beegame_191b560f8a9046b18e1efed2fafa8f07-1';

it('shows native context compaction as a live marker and then a completed separator', () => {
  const marker: ChatDisplayMessage = { id: 'compaction', sender: 'system', content: 'compacting',
    taskKind: 'context_compaction', type: 'system_status', streamStatus: 'streaming', timestamp: Date.now() };
  const { rerender } = render(<BeeGameCollaborationFeed messages={[marker]} isLoading lang="zh" />);
  expect(screen.getByTestId('beegame-compaction-marker')).toHaveTextContent('正在压缩上下文');
  expect(screen.getByTestId('beegame-compaction-marker')).toHaveAttribute('role', 'status');
  rerender(<BeeGameCollaborationFeed messages={[{ ...marker, content: 'compacted', streamStatus: 'complete' }]} lang="zh" />);
  expect(screen.getByTestId('beegame-compaction-marker')).toHaveTextContent('上下文已自动压缩');
  expect(screen.getByTestId('beegame-compaction-marker')).not.toHaveAttribute('role');
});

it('keeps distinct references after history conversion and renders them with the existing BeUI sources disclosure', () => {
  const messages = toChatDisplayMessages(normalizeChatHistory([{
    id: 'sourced', sender: 'beegame', content: 'Answer with references.', timestamp: Date.now(),
    sources: [{ title: 'Guide A', url: 'https://example.com/a' }],
    citations: [{ title: 'Guide B', url: 'https://example.com/b' }],
  }]));
  render(<BeeGameCollaborationFeed messages={messages} />);
  fireEvent.click(screen.getByRole('button', { name: /2 sources/i }));
  expect(screen.getByRole('link', { name: /Guide A/ })).toHaveAttribute('href', 'https://example.com/a');
  expect(screen.getByRole('link', { name: /Guide B/ })).toHaveAttribute('href', 'https://example.com/b');
});

it('shows attachment-only user messages without treating documents as images', () => {
  render(<BeeGameCollaborationFeed messages={[{ id: 'upload', sender: 'user', content: '', timestamp: Date.now(),
    attachments: [
      { type: 'image', mediaType: 'image/png', data: 'aGVsbG8=', filename: 'scene.png' },
      { type: 'file', mediaType: 'application/pdf', data: 'aGVsbG8=', filename: 'brief.pdf' },
    ],
  }]} />);
  expect(screen.getByRole('img', { name: 'scene.png' })).toBeInTheDocument();
  expect(screen.getByText('brief.pdf')).toBeInTheDocument();
  expect(screen.getAllByRole('img')).toHaveLength(1);
});

it('shows the latest assistant-response time below the Streaming Response content', () => {
  const { container } = render(<BeeGameCollaborationFeed messages={[
    { id: 'response-time', sender: 'beegame', content: 'A response with a time.', timestamp: Date.UTC(2026, 8, 23, 1, 42) },
  ]} lang="zh" />);
  expect(container.querySelector('time')).toHaveTextContent('09:42');
});

it('shows a time only on the last text response, not on tool or thinking activity', () => {
  const { container } = render(<BeeGameCollaborationFeed messages={[
    { id: 'earlier', sender: 'beegame', content: 'I will inspect this.', turnId: 'turn-1', timestamp: Date.UTC(2026, 8, 23, 11, 22) },
    { id: 'tool', sender: 'system', type: 'tool', content: 'Read completed', toolName: 'Read', toolStatus: 'completed',
      turnId: 'turn-2', timestamp: Date.UTC(2026, 8, 23, 11, 22, 30) },
    { id: 'thought', sender: 'beegame', type: 'thought', content: 'Checking', turnId: 'turn-3',
      timestamp: Date.UTC(2026, 8, 23, 11, 22, 45), streamStatus: 'complete' },
    { id: 'final', sender: 'beegame', content: 'Done.', turnId: 'turn-4', timestamp: Date.UTC(2026, 8, 23, 11, 23) },
  ]} lang="zh" />);
  expect(Array.from(container.querySelectorAll('time')).map(node => node.textContent)).toEqual(['19:23']);
});

it('timestamps the completed Streaming Response footer even while the agent is still working', () => {
  const { container } = render(<BeeGameCollaborationFeed messages={[
    { id: 'interim', sender: 'beegame', content: 'I will inspect this.', timestamp: Date.UTC(2026, 8, 23, 11, 22) },
  ]} isLoading lang="zh" />);
  const time = container.querySelector('time');
  const copy = screen.getByRole('button', { name: 'Copy response' });
  expect(time).toHaveTextContent('19:22');
  expect(Boolean(copy.compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
});

it('places copy and edit actions below, not inside, the user-message bubble', () => {
  render(<BeeGameCollaborationFeed
    messages={[{ id: 'editable', sender: 'user', content: 'A test message', rewindAvailable: true, timestamp: Date.UTC(2026, 8, 23, 1, 42) }]}
    onEditMessage={() => undefined}
    lang="zh"
  />);
  const message = screen.getByTestId('beegame-user-message-editable');
  const bubble = message.querySelector('[data-slot="message-bubble"]');
  const actions = within(message).getByTestId('beegame-user-message-actions-editable');
  const time = within(actions).getByText('09:42');
  const copyButton = within(message).getByRole('button', { name: '复制消息' });
  const editButton = within(message).getByRole('button', { name: '编辑消息' });

  expect(bubble).not.toBeNull();
  expect(actions).toHaveClass('opacity-0', 'group-hover/message:opacity-100', 'group-focus-within/message:opacity-100');
  expect(copyButton.closest('[data-slot="message-bubble"]')).toBeNull();
  expect(editButton.closest('[data-slot="message-bubble"]')).toBeNull();
  expect(Boolean(time.compareDocumentPosition(copyButton) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  expect(Boolean(copyButton.compareDocumentPosition(editButton) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  expect(Boolean(bubble!.compareDocumentPosition(editButton) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
});

it('offers Edit only for the latest user message, even after an Agent response', () => {
  render(<BeeGameCollaborationFeed messages={[
    { id: 'older', sender: 'user', content: 'First request', rewindAvailable: true, timestamp: 1 },
    { id: 'answer', sender: 'beegame', content: 'First answer', timestamp: 2 },
    { id: 'latest', sender: 'user', content: 'Second request', rewindAvailable: true, timestamp: 3 },
    { id: 'response', sender: 'beegame', content: 'Second answer', timestamp: 4 },
  ]} onEditMessage={() => undefined} />);
  expect(within(screen.getByTestId('beegame-user-message-older'))
    .queryByRole('button', { name: 'Edit message' })).not.toBeInTheDocument();
  expect(within(screen.getByTestId('beegame-user-message-latest'))
    .getByRole('button', { name: 'Edit message' })).toBeInTheDocument();
});

it('does not offer a false Edit action for a historical message without a rollback checkpoint', () => {
  render(<BeeGameCollaborationFeed messages={[
    { id: 'legacy', sender: 'user', content: 'Old request', timestamp: 1 },
  ]} onEditMessage={() => undefined} />);
  expect(within(screen.getByTestId('beegame-user-message-legacy'))
    .queryByRole('button', { name: 'Edit message' })).not.toBeInTheDocument();
});

it('immediately replaces the selected user bubble with the BeUI editor and submits its draft', () => {
  const onEditDraftChange = vi.fn();
  const onSubmitEdit = vi.fn();
  const onCancelEdit = vi.fn();
  render(<BeeGameCollaborationFeed
    messages={[{ id: 'inline-edit', sender: 'user', content: 'Original message', rewindAvailable: true, timestamp: Date.now() }]}
    editingMessageId="inline-edit"
    editDraft="Updated message"
    onEditDraftChange={onEditDraftChange}
    onSubmitEdit={onSubmitEdit}
    onCancelEdit={onCancelEdit}
  />);

  const message = screen.getByTestId('beegame-user-message-inline-edit');
  const input = within(message).getByRole('textbox', { name: 'Edit message' });
  const editor = within(message).getByTestId('beegame-user-message-edit-input-inline-edit');
  expect(message.querySelector('[data-slot="message-bubble"]')).toBeNull();
  expect(editor).toContainElement(input);
  expect(editor.firstElementChild).toHaveClass('min-h-[200px]', 'flex-col', 'rounded-[24px]');
  expect(editor.firstElementChild).not.toHaveAttribute('style');
  expect(input).toHaveValue('Updated message');
  expect(within(message).queryByRole('button', { name: 'Copy message' })).not.toBeInTheDocument();
  expect(within(message).queryByRole('button', { name: 'Edit message' })).not.toBeInTheDocument();

  fireEvent.change(input, { target: { value: 'Revised draft' } });
  fireEvent.click(within(message).getByRole('button', { name: 'Send edit' }));
  expect(onEditDraftChange).toHaveBeenCalledWith('Revised draft');
  expect(onSubmitEdit).toHaveBeenCalledOnce();
  fireEvent.click(within(message).getByRole('button', { name: 'Cancel' }));
  expect(onCancelEdit).toHaveBeenCalledOnce();
});
const IMPLEMENTATION_TURN_ID = 'beegame-turn-beegame_0889307bbd6142f186543e33306e9b01-1';
it('shows tool screenshots outside the collapsed tool activity', () => {
  render(<BeeGameCollaborationFeed messages={[{ id: 'screenshot', sender: 'beegame', content: 'Read', timestamp: Date.now(),
    type: 'tool', toolName: 'Read', toolUseId: 'read-image', toolStatus: 'completed',
    attachments: [{ type: 'image', mediaType: 'image/png', data: 'aGVsbG8=', filename: 'screenshot.png' }],
  }]} />);
  expect(screen.getByRole('img', { name: 'screenshot.png' })).toBeVisible();
});
const FAILURE_TURN_ID = 'beegame-turn-beegame_bcc8df40769c4754895fac37064035d5-1';
const CHECKLIST_MIXED_MESSAGE_ID = '021789434990692846a816464a9af9c0791e0f68a2ce03cbd3227';
const CHECKLIST_FINAL_MESSAGE_ID = '021789435028095846a816464a9af9c0791e0f68a2ce03cdcd201';
const IMPLEMENTATION_MIXED_MESSAGE_ID = '0217894385633113d0449b03f13da7ad7c0359f0f1d760c19f272';

describe('BeeGameCollaborationFeed canonical transcript', () => {
  it('filters paths from assistant and subagent output without changing user-authored text', () => {
    const { container } = render(<BeeGameCollaborationFeed messages={[
      { id: 'user-path', sender: 'user', content: 'Please inspect src/Game.tsx', timestamp: 1 },
      { id: 'assistant-path', sender: 'beegame', content: 'Updated src/Game.tsx at /Users/alice/Game/src/Game.tsx', timestamp: 2 },
      { id: 'subagent-path', sender: 'beegame', type: 'tool', content: 'Agent', timestamp: 3,
        toolName: 'Agent', toolStatus: 'completed', isSubagentTool: true,
        subagentPrompt: 'Read docs/GDD.md', subagentOutput: 'Checked /Users/alice/Game/docs/GDD.md',
        subagentTrace: 'Updated src/Game.tsx' },
    ]} />);

    expect(screen.getByTestId('beegame-user-message-user-path')).toHaveTextContent('src/Game.tsx');
    expect(screen.getByTestId('beegame-agent-message-assistant-path')).toHaveTextContent('Game.tsx');
    fireEvent.click(within(screen.getByTestId('beegame-subagent-disclosure-subagent-path')).getByRole('button'));
    const subagentDetail = screen.getByTestId('beegame-agent-run-detail');
    expect(subagentDetail).toHaveTextContent('GDD.md');
    expect(subagentDetail).not.toHaveTextContent('/Users/alice/Game');
    expect(subagentDetail).not.toHaveTextContent('src/Game.tsx');
    expect(container).not.toHaveTextContent('/Users/alice/Game');
  });

  it('keeps only Copy in the assistant response footer', () => {
    render(<BeeGameCollaborationFeed
      messages={[{ id: 'assistant-response', sender: 'beegame', content: 'Answer', timestamp: Date.now() }]}
    />);

    expect(screen.getByRole('button', { name: 'Copy response' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry response' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Helpful' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Not helpful' })).not.toBeInTheDocument();
  });

  it.each([
    ['running', undefined, 'running', '工作中', 'Working', 'border-primary/30'],
    ['completed', undefined, 'completed', '已完成', 'Completed', 'border-emerald-500/30'],
    ['failed', undefined, 'failed', '失败', 'Failed', 'border-destructive/30'],
    ['failed', 'stopped', 'stopped', '已停止', 'Stopped', 'border-border'],
    ['running', 'incomplete', 'incomplete', '未完成', 'Incomplete', 'border-amber-500/30'],
  ] as const)('shows distinct subagent badges for %s / %s in the pill and drawer',
    (toolStatus, completionReason, state, zh, en, color) => {
      const message: ChatDisplayMessage = { id: 'badge-task', sender: 'beegame', type: 'tool',
        content: 'Agent', timestamp: 100, toolName: 'Agent', isSubagentTool: true,
        toolStatus, completionReason, subagentPrompt: 'Inspect assets' };
      const { rerender } = render(<BeeGameCollaborationFeed messages={[message]} lang="zh" />);
      const pill = screen.getByTestId('beegame-subagent-disclosure-badge-task');
      const badge = within(pill).getByRole('button', { name: `子任务 · ${zh}` });
      expect(badge).toHaveAttribute('data-subagent-state', state);
      expect(badge).toHaveClass(color);
      expect(badge.querySelectorAll('[data-subagent-state]')).toHaveLength(0);
      expect(within(badge).getByRole('status', { name: zh })).not.toHaveClass('border', 'rounded-full');
      // The badge must not introduce a second interactive control inside the pill.
      expect(within(pill).getAllByRole('button')).toHaveLength(1);
      fireEvent.click(within(pill).getByRole('button'));
      expect(within(screen.getByTestId('beegame-agent-run-detail')).getByRole('status', { name: zh }))
        .toHaveAttribute('data-subagent-state', state);
      rerender(<BeeGameCollaborationFeed messages={[message]} lang="en" />);
      expect(within(pill).getByRole('button', { name: `Subagent · ${en}` })).toHaveAttribute('data-subagent-state', state);
    });

  it('labels cancelled tools as stopped rather than failed', () => {
    render(<BeeGameCollaborationFeed messages={[
      { id: 'cancelled', sender: 'beegame', type: 'tool', content: 'Bash', timestamp: 100,
        toolName: 'Bash', toolStatus: 'failed', completionReason: 'stopped' },
    ]} lang="en" />);
    expect(screen.getByText('1 tool calls · 1 stopped')).toBeInTheDocument();
    expect(screen.queryByText(/1 failed/)).not.toBeInTheDocument();
  });

  it('renders a native background shell task as a task, not a subagent', () => {
    render(<BeeGameCollaborationFeed messages={[
      { id: 'shell-task', sender: 'beegame', type: 'tool', content: 'Task', timestamp: 100,
        toolName: 'Task', toolStatus: 'running', isSubagentTool: true, subagentPrompt: 'Check build' },
    ]} lang="en" />);
    const pill = screen.getByTestId('beegame-subagent-disclosure-shell-task');
    fireEvent.click(within(pill).getByRole('button', { name: 'Task · Working' }));
    expect(within(screen.getByTestId('beegame-agent-run-detail')).getByRole('heading', { name: 'Task', level: 2 }))
      .toBeInTheDocument();
  });

  it('preserves an unavailable native tool call without classifying its diagnostic text', () => {
    render(<BeeGameCollaborationFeed messages={[
      { id: 'invalid-tool', sender: 'system', type: 'tool', timestamp: 100,
        content: 'TodoWrite传统" string="true failed', toolName: 'TodoWrite传统" string="true', toolStatus: 'failed',
        toolOutput: '<tool_use_error>Error: No such tool available: TodoWrite传统" string="true</tool_use_error>' },
    ]} lang="zh" />);
    fireEvent.click(screen.getByRole('button', { name: /1 次失败/ }));
    fireEvent.click(screen.getByRole('button', { name: 'TodoWrite传统" string="true' }));
    expect(screen.getByText(/No such tool available: TodoWrite传统/)).toBeInTheDocument();
  });

  it('does not turn unknown or subsecond thinking duration into 0 seconds', () => {
    render(<BeeGameCollaborationFeed messages={[
      { id: 'unknown', sender: 'beegame', type: 'thought', content: 'unknown timing', timestamp: 100, streamStatus: 'complete' },
      { id: 'short', sender: 'beegame', type: 'thought', content: 'short thinking', timestamp: 200, streamStatus: 'complete', thinkingDurationMs: 365 },
    ]} lang="en" />);
    expect(screen.getByText('Thought')).toBeInTheDocument();
    expect(screen.getByText('Thought · less than 1s')).toBeInTheDocument();
    expect(screen.queryByText(/Thought.*0s/)).not.toBeInTheDocument();
  });

  it('opens full failed tool input/output in the shared drawer', () => {
    const { container } = render(<BeeGameCollaborationFeed messages={[
      { id: 'tool-detail', sender: 'beegame', type: 'tool', content: 'Read failed', timestamp: 100,
        toolName: 'Read', toolDetail: 'manifest.json', toolStatus: 'failed', toolInput: { path: 'manifest.json' }, toolOutput: 'Detailed failure, not a completed step' },
    ]} lang="en" />);
    fireEvent.click(container.querySelector('[data-content] > button')!);
    fireEvent.click(screen.getByRole('button', { name: 'manifest.json' }));
    expect(screen.getByText('Input')).toBeInTheDocument();
    expect(screen.getByText('Output')).toBeInTheDocument();
    expect(screen.getByText('Detailed failure, not a completed step')).toBeInTheDocument();
  });
  it('updates the open subagent drawer as progress and terminal result arrive', () => {
    const message: ChatDisplayMessage = { id: 'subagent-live', sender: 'beegame', content: 'Subagent: Audit assets',
      type: 'tool', timestamp: Date.now(), toolName: 'Agent', toolStatus: 'running', isSubagentTool: true,
      subagentPrompt: 'Audit assets', subagentTrace: 'Read manifest.json', subagentOutput: 'Agent input streaming' };
    const { rerender } = render(<BeeGameCollaborationFeed messages={[message]} />);
    expect(within(screen.getByTestId('beegame-subagent-disclosure-subagent-live')).getByRole('button', { name: /Working/ }))
      .toHaveAttribute('data-subagent-state', 'running');
    fireEvent.click(within(screen.getByTestId('beegame-subagent-disclosure-subagent-live')).getByRole('button'));
    expect(screen.getByTestId('beegame-agent-run-detail')).toHaveTextContent('Read manifest.json');
    expect(screen.getByTestId('beegame-agent-run-detail')).not.toHaveTextContent('Agent input streaming');
    rerender(<BeeGameCollaborationFeed messages={[{ ...message, toolStatus: 'completed',
      subagentTrace: 'Checked hashes and palette', subagentOutput: 'Audit passed' }]} />);
    expect(screen.getByTestId('beegame-agent-run-detail')).toHaveTextContent('Completed');
    expect(screen.getByTestId('beegame-agent-run-detail')).toHaveTextContent('Checked hashes and palette');
    expect(screen.getByTestId('beegame-agent-run-detail')).toHaveTextContent('Audit passed');
    expect(within(screen.getByTestId('beegame-subagent-disclosure-subagent-live')).getByRole('button', { name: /Completed/ }))
      .toHaveAttribute('data-subagent-state', 'completed');
    expect(within(screen.getByTestId('beegame-agent-run-detail')).getByRole('status', { name: 'Completed' }))
      .toHaveAttribute('data-subagent-state', 'completed');
  });
  it('starts with the real idea and keeps three independent turns in source order', () => {
    expect(sampleMessages[0]).toMatchObject({
      sender: 'user',
      timestamp: Date.parse('2026-09-14T21:08:39.131Z'),
    });
    expect(sampleMessages[0].content).toContain('不是完整游戏');
    const turnIds = sampleMessages
      .map((message) => message.turnId)
      .filter((turnId, index, values) => turnId && values.indexOf(turnId) === index);
    expect(turnIds).toEqual([CHECKLIST_TURN_ID, IMPLEMENTATION_TURN_ID, FAILURE_TURN_ID]);
    expect(sampleMessages.findIndex((message) => message.turnId === CHECKLIST_TURN_ID))
      .toBeLessThan(sampleMessages.findIndex((message) => message.turnId === IMPLEMENTATION_TURN_ID));
    expect(sampleMessages.findIndex((message) => message.turnId === IMPLEMENTATION_TURN_ID))
      .toBeLessThan(sampleMessages.findIndex((message) => message.turnId === FAILURE_TURN_ID));
    expect(sampleMessages.find((message) => message.content.includes('只修复本次验收发现的 AC-02'))).toBeDefined();
  });

  it('preserves raw thinking and text blocks through one turn', () => {
    const checklist = sampleMessages.filter((message) => message.turnId === CHECKLIST_TURN_ID);
    expect(checklist.length).toBeGreaterThanOrEqual(3);
    expect(checklist[0].contentBlocks?.map((block) => block.type)).toEqual(['thinking', 'text', 'tool_use']);
    expect(checklist[0].contentBlocks?.[0]).toMatchObject({
      type: 'thinking',
      text: expect.stringContaining('11 verified acceptance scenarios'),
    });
    expect(checklist[0].contentBlocks?.find((block) => block.type === 'text')).toMatchObject({
      type: 'text',
      text: expect.stringContaining('11 个经验证的验收场景'),
    });
    expect(checklist.at(-1)?.content).toContain('Checklist 候选文件已写入');
  });

  it('renders the canonical activity and markdown result in response order', () => {
    render(<BeeGameCollaborationFeed messages={sampleMessages} />);
    const checklistTurn = screen.getAllByTestId(/^beegame-agent-turn-/)
      .find((turn) => turn.textContent?.includes('11 个经验证的验收场景'));
    expect(checklistTurn).toBeDefined();
    const activities = checklistTurn!.querySelectorAll('[data-content]');
    const activity = activities[0] as HTMLElement;
    const toolActivity = activities[1] as HTMLElement;
    expect(activity).toBeInTheDocument();
    expect(activities).toHaveLength(2);
    expect(activities[0]).toHaveAttribute('data-content', 'text');
    expect(activities[1]).toHaveAttribute('data-content', 'tool');
    expect([...activities].every((candidate) => !candidate.textContent?.includes('Running tools'))).toBe(true);
    expect([...activities].every((candidate) => !candidate.textContent?.includes('Run Tool'))).toBe(true);
    expect(toolActivity).toHaveTextContent('Edit');
    fireEvent.click(within(activity).getByRole('button'));
    expect(screen.getByTestId(`beegame-agent-message-beegame-assistant-beegame_191b560f8a9046b18e1efed2fafa8f07-${CHECKLIST_MIXED_MESSAGE_ID}-block-1`)).toBeInTheDocument();
    expect(screen.getByTestId(`beegame-agent-message-beegame-assistant-beegame_191b560f8a9046b18e1efed2fafa8f07-${CHECKLIST_FINAL_MESSAGE_ID}-block-0`)).toBeInTheDocument();
    expect(screen.getByTestId(`beegame-agent-message-beegame-assistant-beegame_0889307bbd6142f186543e33306e9b01-${IMPLEMENTATION_MIXED_MESSAGE_ID}-block-1`)).toBeInTheDocument();
    expect(within(checklistTurn!).getByText(/11 个经验证的验收场景/)).toBeInTheDocument();
    expect([...activities].every((candidate) => !candidate.textContent?.includes('11 个经验证的验收场景') && !candidate.textContent?.includes('Checklist 候选文件已写入'))).toBe(true);
    expect(within(checklistTurn!).getByText(/Checklist 候选文件已写入/)).toBeInTheDocument();
    expect(within(checklistTurn!).queryByTestId('beegame-file-diff')).not.toBeInTheDocument();
    expect(screen.queryByText('LLM generated')).not.toBeInTheDocument();
  });

  it('keeps Think and every tool call out of a mixed activity', () => {
    const messages = [
      {
        id: 'think-before-tool',
        sender: 'beegame',
        content: 'Thinking',
        thought: 'Checking the content package.',
        type: 'thought',
        turnId: 'turn-separate-activity',
        timestamp: 1_000,
        thinkingDurationMs: 2_000,
      },
      {
        id: 'tool-between-thinks',
        sender: 'system',
        content: 'Bash completed',
        type: 'tool',
        turnId: 'turn-separate-activity',
        timestamp: 2_000,
        toolName: 'Bash',
        toolUseId: 'tool-between-thinks',
        toolStatus: 'completed',
        toolDetail: 'ls -R content',
      },
      {
        id: 'think-after-tool',
        sender: 'beegame',
        content: 'Thinking',
        thought: 'Content directory is absent.',
        type: 'thought',
        turnId: 'turn-separate-activity',
        timestamp: 3_000,
        thinkingDurationMs: 1_000,
      },
    ] satisfies ChatDisplayMessage[];

    const { container } = render(<BeeGameCollaborationFeed messages={messages} />);

    expect(container.querySelector('[data-content="mixed"]')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-content="text"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-content="tool"]')).toHaveLength(1);
    expect(screen.getByText('Ran 1 tool')).toBeInTheDocument();
  });

  it('uses full calendar dates for date separators', () => {
    const sameDayMessages = [
      { id: 'same-a', sender: 'user', content: 'a', timestamp: Date.parse('2026-09-14T15:00:00.000Z') },
      { id: 'same-b', sender: 'agent', content: 'b', timestamp: Date.parse('2026-09-14T15:30:00.000Z') },
    ] satisfies ChatDisplayMessage[];
    const crossDayMessages = [
      ...sameDayMessages,
      { id: 'next', sender: 'user', content: 'next', timestamp: Date.parse('2026-09-14T16:01:00.000Z') },
    ] satisfies ChatDisplayMessage[];
    const { rerender } = render(<BeeGameCollaborationFeed messages={sameDayMessages} />);
    expect(screen.getAllByTestId('beegame-date-separator')).toHaveLength(1);
    rerender(<BeeGameCollaborationFeed messages={crossDayMessages} />);
    expect(screen.getAllByTestId('beegame-date-separator')).toHaveLength(2);
    expect(screen.getAllByTestId('beegame-date-separator').map((node) => node.getAttribute('data-date-key')))
      .toEqual(['2026-09-14', '2026-09-15']);
  });
});
