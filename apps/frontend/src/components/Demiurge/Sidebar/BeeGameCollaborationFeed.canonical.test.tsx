import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ChatDisplayMessage } from '../../../viewModels/displayModels';
import { BeeGameCollaborationFeed } from './BeeGameCollaborationFeed';
import { toChatDisplayMessages } from '../../../viewModels/displayModels';
import { normalizeChatHistory } from '../../../utils/chatHistory';
import { sampleMessages } from '../../../test/fixtures/canonicalTranscript';
import { transcriptEventsToHistory } from '../../../services/beeGameAdapter';
import { useChatStore } from '../../../store/chatStore';

vi.mock('img-fx', async () => {
  const React = await import('react');
  return { ImageGeneration: React.forwardRef(({ children }: { children: React.ReactNode }, ref) => {
    React.useImperativeHandle(ref, () => ({ triggerReveal: () => undefined }), []);
    return <div>{children}</div>;
  }) };
});

const CHECKLIST_TURN_ID = 'beegame-turn-beegame_191b560f8a9046b18e1efed2fafa8f07-1';

it('filters image configuration in live and restored assistant text without rewriting user input or source messages', () => {
  const content = '沿用 cloudflare / gpt-image-2.5-flare / low；报价 4 Credits。';
  const message: ChatDisplayMessage = { id: 'image-routing', sender: 'beegame', type: 'text', content, timestamp: 1000 };
  const { container, rerender } = render(<BeeGameCollaborationFeed messages={[message]} isLoading streamingMessageId={message.id} />);
  expect(container).not.toHaveTextContent(/cloudflare|gpt-image-2.5-flare|\/ low/);
  for (const partial of ['沿用 cloudflare', '沿用 cloudflare / gpt-image', content]) {
    rerender(<BeeGameCollaborationFeed messages={[{ ...message, content: partial }]} isLoading streamingMessageId={message.id} />);
    expect(container).not.toHaveTextContent(/cloudflare|gpt-image/);
  }
  rerender(<BeeGameCollaborationFeed messages={[message]} />);
  expect(container).toHaveTextContent('BGS Image');
  expect(container).toHaveTextContent('4 Credits');
  expect(container).not.toHaveTextContent(/cloudflare|gpt-image-2.5-flare|\/ low/);
  expect(message.content).toBe(content);
  rerender(<BeeGameCollaborationFeed messages={[{ ...message, sender: 'user' }]} />);
  expect(container).toHaveTextContent('cloudflare / gpt-image-2.5-flare / low');
});

// Detail assertions explicitly opt in by expanding the user-facing disclosure.
const renderWithActivitiesExpanded: typeof render = (...args) => {
  const result = render(...args);
  result.container.querySelectorAll('[data-variant="timeline"] > button[aria-expanded="false"]')
    .forEach(button => fireEvent.click(button));
  return result;
};

it('keeps one compact tool row through progress and completion without mounting payloads', () => {
  const start: ChatDisplayMessage = { id: 'inline-start', sender: 'beegame', content: '', type: 'tool',
    toolName: 'Shell', toolUseId: 'inline-call', toolStatus: 'running', timestamp: 1000, turnId: 'inline-turn',
    toolInput: { command: 'bun run build --raw-input-marker' } };
  const { container, rerender } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[start]} isLoading />);
  const row = screen.getByRole('group', { name: 'Run script · build' });
  expect(row).toHaveAccessibleDescription('Running');
  const progress = { ...start, id: 'inline-progress', timestamp: 2000, toolOutput: 'raw-output-marker' };
  rerender(<BeeGameCollaborationFeed messages={[start, progress]} isLoading />);
  expect(screen.getByRole('group', { name: 'Run script · build' })).toBe(row);
  rerender(<BeeGameCollaborationFeed messages={[start, { ...progress, toolStatus: 'completed', toolExitCode: 0 }]} />);
  expect(screen.getByRole('group', { name: 'Run script · build' })).toBe(row);
  expect(row).toHaveAccessibleDescription('Completed');
  expect(container.querySelectorAll('[data-tool-id]')).toHaveLength(1);
  fireEvent.click(row);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(row.querySelector('button, details')).toBeNull();
  expect(container).not.toHaveTextContent('raw-input-marker');
  expect(container).not.toHaveTextContent('raw-output-marker');
});

it('shows a confirmed edit as a status row without a diff panel', () => {
  const start: ChatDisplayMessage = { id: 'edit-start', sender: 'beegame', type: 'tool', content: '', toolName: 'Edit',
    toolUseId: 'edit-call', toolStatus: 'running', timestamp: 1000, toolInput: { file_path: 'src/Example.ts' },
    toolDiff: '@@ -11 +11 @@\n-raw-old-marker\n+raw-new-marker\n' };
  const { container, rerender } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[start]} isLoading />);
  const row = screen.getByRole('group', { name: 'Edit Example.ts' });
  rerender(<BeeGameCollaborationFeed messages={[start, { ...start, id: 'edit-end', toolStatus: 'completed', timestamp: 2000 }]} />);
  expect(screen.getByRole('group', { name: 'Edit Example.ts' })).toBe(row);
  expect(row).toHaveAccessibleDescription('Completed');
  expect(screen.queryByTestId('beegame-file-diff')).not.toBeInTheDocument();
  expect(container).not.toHaveTextContent('raw-new-marker');
  expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(1);
});

it('never marks a failed edit as an applied file diff', () => {
  renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[
    { id: 'rejected-edit', sender: 'beegame', type: 'tool', content: '', toolName: 'Edit', toolStatus: 'failed', timestamp: 1000,
      toolInput: { file_path: 'src/Example.ts' }, toolDiff: '@@ -11 +11 @@\n-old\n+new\n', toolOutput: 'Edit rejected' },
  ]} />);
  expect(screen.queryByTestId('beegame-file-diff')).not.toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Edit Example.ts' })).toHaveAccessibleDescription('Failed');
});

it('shows a compact command title and state without exposing the command or output', () => {
  const command = `/bin/zsh -lc 'curl -sL -A "Mozilla/5.0" "https://fonts.example.com/css?family=Example" | head -40'`;
  const { container } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed lang="zh" messages={[
    { id: 'command-start', sender: 'beegame', content: '', type: 'tool', toolName: 'Shell', toolUseId: 'command-one',
      toolStatus: 'running', timestamp: 1000, turnId: 'native', toolInput: { command } },
    { id: 'command-end', sender: 'beegame', content: '', type: 'tool', toolName: 'Shell', toolUseId: 'command-one',
      toolStatus: 'completed', timestamp: 2400, turnId: 'native', toolInput: { command }, toolOutput: 'raw-download-result', toolExitCode: 0, toolDurationMs: 1200 },
  ]} />);
  const row = screen.getByRole('group', { name: '请求网页 · fonts.example.com' });
  expect(row).toHaveAccessibleDescription('完成');
  expect(row).toHaveTextContent('1s');
  expect(container.querySelectorAll('[data-tool-state]')).toHaveLength(1);
  expect(container).not.toHaveTextContent(command);
  expect(container).not.toHaveTextContent('raw-download-result');
});

it('never exposes nested MCP input/output or legacy JSON details in a tool row', () => {
  const payload = JSON.stringify({ content: [{ type: 'text', text: 'raw-mcp-payload' }], structuredContent: null, _meta: null });
  const { container } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed lang="zh" messages={[
    { id: 'mcp-read', sender: 'beegame', content: '', type: 'tool', toolName: 'ReadDesignHandoff',
      toolStatus: 'completed', timestamp: 1000, toolInput: { read: [{ document: 'GDD.md', sections: ['raw-section'] }] },
      toolDetail: payload, toolOutput: payload },
  ]} />);
  const row = screen.getByRole('group', { name: 'ReadDesignHandoff' });
  expect(row).toHaveAccessibleDescription('完成');
  fireEvent.click(row);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(row.querySelector('button, details, pre')).toBeNull();
  expect(container).not.toHaveTextContent('raw-mcp-payload');
  expect(container).not.toHaveTextContent('raw-section');
  expect(container).not.toHaveTextContent('structuredContent');
});

it('keeps failure and incomplete statuses separate from the compact title and never invents old command metrics', () => {
  renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[
    { id: 'error-command', sender: 'beegame', content: '', type: 'tool', toolName: 'Shell',
      toolStatus: 'failed', timestamp: 2000, toolInput: { command: 'bun run build' }, toolExitCode: 2 },
    { id: 'unfinished-command', sender: 'beegame', content: '', type: 'tool', toolName: 'Shell',
      toolStatus: 'running', completionReason: 'incomplete', timestamp: 2100, toolInput: { command: 'node check.mjs' } },
  ]} />);
  const failed = screen.getByRole('group', { name: 'Run script · build' });
  expect(failed).toHaveAccessibleDescription('Failed');
  expect(screen.getByRole('group', { name: 'Run script · check.mjs' })).toHaveAccessibleDescription('Incomplete');
  fireEvent.click(failed);
  expect(screen.queryByText(/Exit code 2/)).not.toBeInTheDocument();
});

it('keeps details collapsed during streaming, completion and history replay while the latest response stays visible', async () => {
  const message: ChatDisplayMessage = { id: 'default-fold', sender: 'beegame', content: 'Inspecting files.',
    turnId: 'default-fold-turn', timestamp: Date.now() };
  const { container, rerender } = render(<BeeGameCollaborationFeed messages={[message]} isLoading />);
  expect(container.querySelector('[data-variant="timeline"]')).toBeNull();
  expect(screen.getByTestId('beegame-work-status')).toBeVisible();
  await waitFor(() => expect(screen.getByText('Inspecting files.')).toBeVisible());
  const messages: ChatDisplayMessage[] = [message,
    { ...message, id: 'fold-tool', type: 'tool', toolName: 'Read', toolStatus: 'completed', content: '' },
    { ...message, id: 'fold-final', content: 'Final answer.' },
  ];
  rerender(<BeeGameCollaborationFeed messages={messages} isLoading />);
  const activity = container.querySelector('[data-variant="timeline"]') as HTMLElement;
  const heading = within(activity).getByRole('button', { name: /^Execution details/ });
  expect(heading).toHaveAttribute('aria-expanded', 'false');
  expect(activity.querySelector('[role="region"]')).toHaveAttribute('aria-hidden', 'true');
  expect(screen.queryByRole('button', { name: 'Read', exact: true })).not.toBeInTheDocument();
  expect(activity).not.toContainElement(screen.getByText('Final answer.'));
  expect(screen.getByText('Final answer.')).toBeVisible();
  rerender(<BeeGameCollaborationFeed messages={messages} />);
  expect(heading).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByTestId('beegame-work-status')).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('Final answer.')).toBeVisible());
  fireEvent.click(heading);
  expect(heading).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('group', { name: 'Read', exact: true })).toBeInTheDocument();
  fireEvent.click(heading);
  rerender(<BeeGameCollaborationFeed messages={[...messages]} />);
  expect(heading).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('Inspecting files.')).not.toBeInTheDocument();
});

it('keeps mixed-block progress and intermediate artifacts accessible without exposing thoughts or commands', () => {
  const onPreviewArtifact = vi.fn();
  const { container, rerender } = render(<BeeGameCollaborationFeed isLoading lang="zh" onPreviewArtifact={onPreviewArtifact} messages={[
    { id: 'mixed-progress', sender: 'beegame', content: '', timestamp: 1000, turnId: 'public',
      contentBlocks: [
        { type: 'thinking', text: 'Internal implementation reasoning' },
        { type: 'text', text: '正在调整角色的动作反馈。' },
        { type: 'tool_use', toolUseId: 'edit-action', toolName: 'Shell', toolInput: { command: 'node update-animation.mjs' } },
      ] },
    { id: 'public-artifact', sender: 'beegame', type: 'artifact_card', renderHint: 'artifact_card',
      artifactId: 'artifact-demo', documentTitle: '动作方案', content: '动作方案内容', timestamp: 2000, turnId: 'public' },
  ]} />);
  const activity = container.querySelector('[data-variant="timeline"]')!;
  expect(screen.getByText('正在调整角色的动作反馈。')).toBeVisible();
  const artifact = screen.getByRole('button', { name: /动作方案/ });
  expect(artifact).toBeVisible();
  expect(activity).not.toContainElement(artifact);
  expect(screen.queryByRole('button', { name: '思考', exact: true })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /update-animation/ })).not.toBeInTheDocument();
  fireEvent.click(artifact);
  expect(onPreviewArtifact).toHaveBeenCalledWith('artifact-demo', '动作方案', '动作方案内容');
  rerender(<BeeGameCollaborationFeed lang="zh" messages={[{
    id: 'runtime-problem', sender: 'system', type: 'error', content: '连接中断，请重新连接。', timestamp: 3000,
  }]} />);
  expect(screen.getByRole('alert')).toHaveTextContent('连接中断，请重新连接。');
});

it('shows latest progress and requests while omitting older commentary from expanded details', async () => {
  const { container } = render(<BeeGameCollaborationFeed isLoading lang="zh" messages={[
    { id: 'earlier-progress', sender: 'beegame', content: '正在读取相关文件。', timestamp: 1000, turnId: 'progress' },
    { id: 'action-needed', sender: 'beegame', content: '请选择你喜欢的方案。', requiresUserAction: true, timestamp: 2000, turnId: 'progress' },
    { id: 'latest-progress', sender: 'beegame', content: '正在调整角色动作。', timestamp: 3000, turnId: 'progress' },
    { id: 'last-tool', sender: 'beegame', type: 'tool', content: '', toolName: 'Shell', toolStatus: 'running',
      toolInput: { command: 'node update.mjs' }, timestamp: 4000, turnId: 'progress' },
  ]} />);
  const activity = container.querySelector('[data-variant="timeline"]')!;
  expect(screen.getByText('正在调整角色动作。')).toBeVisible();
  expect(screen.getByText('请选择你喜欢的方案。')).toBeVisible();
  expect(activity).not.toContainElement(screen.getByText('正在调整角色动作。'));
  expect(activity).not.toContainElement(screen.getByText('请选择你喜欢的方案。'));
  expect(screen.queryByText('正在读取相关文件。')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /update.mjs/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^执行详情/ }));
  await waitFor(() => expect(screen.getByRole('group', { name: /update.mjs/ })).toBeVisible());
  expect(screen.queryByText('正在读取相关文件。')).not.toBeInTheDocument();
});

it.each(['failed', 'stopped', 'incomplete'] as const)('keeps the %s status on its tool row without a separate notice', reason => {
  render(<BeeGameCollaborationFeed lang="zh" messages={[{
    id: 'issue', sender: 'beegame', type: 'tool', content: '', timestamp: 1000,
    toolName: 'Shell', toolStatus: 'failed', completionReason: reason,
    toolInput: { command: 'node internal-check.mjs' }, toolOutput: 'Internal diagnostic output',
  }]} />);
  expect(screen.getByRole('button', { name: '执行详情' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByTestId('beegame-activity-issue')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '执行详情' }));
  expect(screen.getByRole('group', { name: /internal-check.mjs/ })).toHaveAccessibleDescription({
    failed: '失败', stopped: '已停止', incomplete: '未完成',
  }[reason]);
  expect(screen.queryByText('Internal diagnostic output')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /internal-check/ })).not.toBeInTheDocument();
});

it('does not declare the entire task failed or successful from an individual tool result', () => {
  const failed: ChatDisplayMessage = { id: 'attempt', sender: 'beegame', type: 'tool', content: '', timestamp: 1000,
    toolName: 'Shell', toolStatus: 'failed', turnId: 'continued', toolInput: { command: 'node check.mjs' } };
  const { rerender } = render(<BeeGameCollaborationFeed lang="zh" isLoading messages={[failed]} />);
  expect(screen.queryByTestId('beegame-activity-issue')).not.toBeInTheDocument();
  expect(screen.getByTestId('beegame-work-status')).toBeVisible();
  rerender(<BeeGameCollaborationFeed lang="zh" messages={[failed,
    { ...failed, id: 'next-operation', toolStatus: 'completed', timestamp: 2000 },
    { id: 'answer', sender: 'beegame', content: '已更新动作，实际效果还需要试玩确认。', turnId: 'continued', timestamp: 3000 },
  ]} />);
  expect(screen.queryByTestId('beegame-activity-issue')).not.toBeInTheDocument();
  expect(screen.getByText('已更新动作，实际效果还需要试玩确认。')).toBeVisible();
  expect(screen.queryByTestId('beegame-work-status')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^执行详情/ })).toHaveAttribute('aria-expanded', 'false');
});

it('keeps growing activity in a bounded scroll viewport without a translating log', async () => {
  let height = 300;
  let resize: (() => void) | undefined;
  const measuredHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => height);
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: () => void) {}
    observe(node: HTMLElement) { if (node.getAttribute('role') === 'list') resize = this.callback; }
    disconnect() {}
    unobserve() {}
  });
  try {
    const { container, unmount } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed isLoading messages={[
      { id: 'follow-text', sender: 'beegame', content: 'Inspecting files.', timestamp: 1000, turnId: 'follow' },
      { id: 'follow-tool', sender: 'beegame', content: '', type: 'tool', toolName: 'Read',
        toolStatus: 'running', timestamp: 2000, turnId: 'follow' },
    ]} />);
    const activity = container.querySelector('[data-variant="timeline"]') as HTMLElement;
    const list = within(activity).getByRole('list');
    expect(activity).toHaveAttribute('data-content', 'text');
    expect(activity.querySelector('[role="region"] > div')).toHaveStyle({ maxHeight: '360px' });
    await waitFor(() => expect(list).toHaveStyle({ transform: 'none' }));
    expect(resize).toBeDefined();
    height = 420;
    act(() => resize!());
    await waitFor(() => expect(list).toHaveStyle({ transform: 'none' }));
    unmount();
  } finally {
    measuredHeight.mockRestore();
    vi.unstubAllGlobals();
  }
});

it('keeps progress and results outside one execution disclosure and copies only the final reply', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const messages: ChatDisplayMessage[] = [
    { id: 'process-a', sender: 'beegame', content: 'Inspecting files.', timestamp: 1000, turnId: 'one' },
    { id: 'read-a', sender: 'beegame', content: '', type: 'tool', toolName: 'Read', toolStatus: 'completed', timestamp: 2000, turnId: 'one' },
    { id: 'process-b', sender: 'beegame', content: 'Applying the change.', timestamp: 3000, turnId: 'one' },
    { id: 'edit-b', sender: 'beegame', content: '', type: 'tool', toolName: 'Edit', toolStatus: 'completed', timestamp: 4000, turnId: 'one' },
    { id: 'final', sender: 'beegame', content: 'Done. Verified.', timestamp: 5000, turnId: 'one',
      contentBlocks: [{ type: 'text', text: 'Done.' }, { type: 'text', text: 'Verified.' }] },
  ];
  const { container, rerender } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={messages} isLoading />);
  const activity = container.querySelector('[data-variant="timeline"]') as HTMLElement;
  expect(container.querySelectorAll('[data-variant="timeline"]')).toHaveLength(1);
  expect(activity).not.toContainElement(screen.getByText('Done.'));
  expect(screen.queryByText('Inspecting files.')).not.toBeInTheDocument();
  expect(screen.queryByText('Applying the change.')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Copy response' })).not.toBeInTheDocument();
  const rows = within(activity).getAllByRole('listitem');
  expect(rows.map(row => row.querySelector('[data-tool-id]')?.getAttribute('aria-label') || row.textContent)).toEqual(['Read', 'Edit']);
  rerender(<BeeGameCollaborationFeed messages={messages} />);
  expect(container.querySelectorAll('[data-variant="timeline"]')).toHaveLength(1);
  expect(within(activity).getByRole('button', { name: /^Execution details/ })).toHaveAttribute('aria-expanded', 'true');
  await waitFor(() => expect(screen.getByText('Done.')).toBeVisible());
  expect(screen.getByText('Verified.')).toBeVisible();
  expect(activity).not.toContainElement(screen.getByText('Done.'));
  fireEvent.click(screen.getByRole('button', { name: 'Copy response' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('Done.\n\nVerified.'));
});

it('does not pull a previous reply into activity when the next user turn is waiting', () => {
  const { container } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed isLoading messages={[
    { id: 'previous', sender: 'beegame', content: 'Earlier answer.', timestamp: 1000, turnId: 'earlier' },
    { id: 'next-user', sender: 'user', content: 'Next request.', timestamp: 2000 },
  ]} />);
  expect(container.querySelector('[data-variant="timeline"]')).toBeNull();
  expect(screen.getByRole('button', { name: 'Copy response' })).toBeInTheDocument();
  expect(screen.getByTestId('beegame-loading-message')).toBeInTheDocument();
});

it('keeps the native working status live and exposes the completed log through disclosure', () => {
  vi.useFakeTimers();
  try {
    const startedAt = Date.now() - 330_000;
    const start: ChatDisplayMessage = { id: 'start', sender: 'beegame', type: 'tool', content: '',
      timestamp: startedAt, turnId: 'live-turn', toolUseId: 'live-tool', toolName: 'Bash', toolStatus: 'running',
      toolInput: { command: 'node verify.mjs', description: 'Checking the product URL' } };
    const { rerender } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[start]} isLoading lang="en" />);
    const heading = screen.getByRole('button', { name: /^Execution details/ });
    expect(heading).toHaveTextContent('Execution details · 5m 30s');
    expect(screen.getByRole('group', { name: 'Checking the product URL' })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(heading).toHaveTextContent('Execution details · 5m 31s');
    const end = { ...start, id: 'end', timestamp: Date.now(), toolStatus: 'completed' as const, toolOutput: 'OK' };
    rerender(<BeeGameCollaborationFeed messages={[start, end]} lang="en" />);
    const completedHeading = screen.getByRole('button', { name: 'Execution details · 5m 31s' });
    expect(completedHeading).toHaveAttribute('aria-expanded', 'true');
    act(() => vi.advanceTimersByTime(10_000));
    expect(completedHeading).toHaveTextContent('Execution details · 5m 31s');
    expect(screen.getAllByRole('group', { name: 'Checking the product URL' })).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

it('renders host evidence independently of an all-passed author answer in saved history', () => {
  const common={sessionId:'evidence-session',turnId:'evidence-turn',createdAt:new Date(1000).toISOString()};
  const hostText='BGS 宿主检查｜本轮执行已结束，不等于游戏验收通过\naudio-data-consumption: 未验证\n游戏质量仍未验证。';
  const events=[{...common,id:1,type:'assistant.message',text:'全部通过，已交付。',payload:{type:'assistant.message'}},
    {...common,id:2,type:'turn.completed',text:'Turn ended'},
    {...common,id:3,type:'system.status',text:hostText,payload:{type:'system.status',subtype:'host_evidence',quality:'unverified',deliveryEligible:false}}];
  const messages=toChatDisplayMessages(normalizeChatHistory(transcriptEventsToHistory('evidence',events)));
  renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={messages} lang="zh" />);
  expect(screen.getByText('全部通过，已交付。')).toBeVisible();
  const host=screen.getByTestId('beegame-host-evidence');
  expect(host).toBeVisible();
  expect(host).toHaveTextContent('audio-data-consumption: 未验证');
  expect(host).toHaveTextContent('游戏质量仍未验证');
});

it('shows child tools only inside the subagent detail while keeping main tools in chat', () => {
  const event = (id: number, type: string, payload: Record<string, unknown>) => ({
    id, type, payload, text: '', sessionId: 'routing-session', turnId: 'routing-turn',
    createdAt: new Date(1_000 + id).toISOString(),
  });
  const events = [event(1, 'tool.started', { toolName: 'Agent', toolUseID: 'ui-author',
    input: { description: 'Write UI', prompt: 'Design the UI' } }),
    ...Array.from({ length: 11 }, (_, index) => event(2 + index, 'tool.completed', {
      toolName: index < 9 ? 'Read' : 'Bash', toolUseID: `child-${index}`, parentToolUseID: 'ui-author',
      input: index < 9 ? { file_path: `docs/source-${index}.md` } : { command: `echo check-${index}` },
      output: `source output ${index}`,
    })),
    event(13, 'tool.completed', { toolName: 'Bash', toolUseID: 'main-tool', input: { command: 'bun test' }, output: 'main result' }),
  ];
  const messages = toChatDisplayMessages(normalizeChatHistory(transcriptEventsToHistory('routing', events)));
  renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={messages} lang="en" />);
  expect(screen.queryByText('Ran 11 tools')).not.toBeInTheDocument();
  expect(screen.getByRole('group', { name: /Run command · bun/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /child-0/ })).not.toBeInTheDocument();
  expect(screen.getAllByTestId('beegame-subagent-row')).toHaveLength(1);
  fireEvent.click(within(screen.getByTestId('beegame-subagent-row')).getByRole('button'));
  const activity = screen.getByTestId('subagent-activity-list');
  expect(activity.querySelectorAll('[data-tool-id]')).toHaveLength(11);
  expect(within(activity).queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByText('source output 0')).not.toBeInTheDocument();
  expect(screen.queryByText('source output 10')).not.toBeInTheDocument();
  expect(screen.queryByText('main result')).not.toBeInTheDocument();
});

it('keeps a mixed activity and final answer in their original positions', () => {
  const messages: ChatDisplayMessage[] = [
    { id: 'compact-thought', sender: 'beegame', type: 'thought', thought: 'Inspecting files', content: 'Thinking', timestamp: 1, turnId: 'compact-turn' },
    { id: 'compact-read', sender: 'system', type: 'tool', toolName: 'Read', toolStatus: 'completed', content: 'Read', timestamp: 2, turnId: 'compact-turn' },
    { id: 'compact-check', sender: 'system', type: 'tool', toolName: 'Bash', toolStatus: 'failed', content: 'Check failed', timestamp: 3, turnId: 'compact-turn' },
    { id: 'compact-answer', sender: 'beegame', content: '检查失败，尚未完成验收。', timestamp: 4, turnId: 'compact-turn' },
  ];
  const { container, rerender } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={messages} lang="zh" />);
  expect(screen.queryByRole('button', { name: /执行记录/ })).not.toBeInTheDocument();
  expect(screen.getByText('检查失败，尚未完成验收。')).toBeVisible();
  expect(screen.queryByTestId('beegame-activity-issue')).not.toBeInTheDocument();
  const activities = container.querySelectorAll('[data-content]');
  expect(activities).toHaveLength(1);
  expect(activities[0]).toHaveAttribute('data-content', 'text');
  const answer = screen.getByTestId('beegame-agent-message-compact-answer');
  expect(activities[0].compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  rerender(<BeeGameCollaborationFeed messages={messages.map(message => message.id === 'compact-check'
    ? { ...message, toolStatus: 'running' } : message)} lang="zh" isLoading />);
  expect(screen.queryByRole('button', { name: /执行记录/ })).not.toBeInTheDocument();
  expect(container.querySelectorAll('[data-content]')[0]).toBe(activities[0]);
  rerender(<BeeGameCollaborationFeed messages={messages} lang="zh" />);
  expect(container.querySelectorAll('[data-content]')[0]).toBe(activities[0]);
  expect(screen.queryByRole('button', { name: /执行记录/ })).not.toBeInTheDocument();
});

it('shows the actual platform handoff error instead of a generic context label', () => {
  renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[{
    id: 'delivery-error', sender: 'system', taskKind: 'delivery_error',
    content: '交付未能继续：测试清理失败', timestamp: Date.now(),
  }]} lang="zh" />);
  expect(screen.getByTestId('beegame-context-separator')).toHaveTextContent('交付未能继续：测试清理失败');
});

it.each([['zh', '等待模型响应'], ['en', 'Waiting for the model response']] as const)('labels an unobserved model response as waiting: %s', (lang, label) => {
  renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[]} isLoading lang={lang} />);
  expect(within(screen.getByTestId('beegame-loading-message')).getByRole('status')).toHaveAccessibleName(label);
  expect(screen.queryByTestId('beegame-compaction-marker')).not.toBeInTheDocument();
});

it('shows native context compaction as a live marker and then a completed separator', () => {
  const marker: ChatDisplayMessage = { id: 'compaction', sender: 'system', content: 'compacting',
    taskKind: 'context_compaction', type: 'system_status', streamStatus: 'streaming', timestamp: Date.now() };
  const { rerender } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[marker]} isLoading lang="zh" />);
  expect(screen.getByTestId('beegame-compaction-marker')).toHaveTextContent('正在压缩上下文');
  expect(screen.getByTestId('beegame-compaction-marker')).toHaveAttribute('role', 'status');
  expect(screen.queryByTestId('beegame-loading-message')).not.toBeInTheDocument();
  rerender(<BeeGameCollaborationFeed messages={[{ ...marker, content: 'compacted', streamStatus: 'complete' }]} isLoading lang="zh" />);
  expect(screen.getByTestId('beegame-compaction-marker')).toHaveTextContent('上下文已自动压缩');
  expect(screen.getByTestId('beegame-compaction-marker')).not.toHaveAttribute('role');
  expect(screen.getByTestId('beegame-loading-message')).toBeInTheDocument();
  expect(within(screen.getByTestId('beegame-loading-message')).getByRole('status')).toHaveAccessibleName('等待模型响应');
  rerender(<BeeGameCollaborationFeed messages={[marker, {
    id: 'new-request', sender: 'user', content: '继续处理', timestamp: marker.timestamp + 1,
  }]} isLoading lang="zh" />);
  expect(screen.getByTestId('beegame-loading-message')).toBeInTheDocument();
});

it('renders delivery milestone and stop markers as separators', () => {
  renderWithActivitiesExpanded(<BeeGameCollaborationFeed lang="zh" messages={[
    { id: 'phase-author', sender: 'system', content: 'author', taskKind: 'delivery_phase', timestamp: 1 },
    { id: 'session-stop', sender: 'system', content: 'stopped', taskKind: 'session_lifecycle', timestamp: 2 },
  ]} />);
  expect(screen.getByText('编写项目文档')).toBeInTheDocument();
  expect(screen.getByText('任务已停止')).toBeInTheDocument();
});

it('labels the integrated sample without declaring a quality pass', () => {
  renderWithActivitiesExpanded(<BeeGameCollaborationFeed lang="zh" messages={[
    { id: 'phase-sample', sender: 'system', content: 'playable', taskKind: 'delivery_phase', timestamp: 1 },
  ]} />);
  expect(screen.getByTestId('beegame-context-separator')).toHaveTextContent('代表性可玩样板');
  expect(screen.queryByText(/质量通过/)).not.toBeInTheDocument();
});

it('keeps distinct references after history conversion and renders them with the existing BeUI sources disclosure', () => {
  const messages = toChatDisplayMessages(normalizeChatHistory([{
    id: 'sourced', sender: 'beegame', content: 'Answer with references.', timestamp: Date.now(),
    sources: [{ title: 'Guide A', url: 'https://example.com/a' }],
    citations: [{ title: 'Guide B', url: 'https://example.com/b' }],
  }]));
  renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={messages} />);
  fireEvent.click(screen.getByRole('button', { name: /2 sources/i }));
  expect(screen.getByRole('link', { name: /Guide A/ })).toHaveAttribute('href', 'https://example.com/a');
  expect(screen.getByRole('link', { name: /Guide B/ })).toHaveAttribute('href', 'https://example.com/b');
});

it('shows attachment-only user messages without treating documents as images', () => {
  renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[{ id: 'upload', sender: 'user', content: '', timestamp: Date.now(),
    attachments: [
      { type: 'image', mediaType: 'image/png', data: 'aGVsbG8=', filename: 'scene.png' },
      { type: 'file', mediaType: 'application/pdf', data: 'aGVsbG8=', filename: 'brief.pdf' },
    ],
  }]} />);
  expect(screen.getByRole('img', { name: 'scene.png' })).toBeInTheDocument();
  expect(screen.getByText('brief.pdf')).toBeInTheDocument();
  expect(screen.getAllByRole('img')).toHaveLength(1);
});

it('keeps a Bottts avatar stable for a subtask and falls back if the image cannot load', () => {
  renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[{ id: 'avatar-task', sender: 'beegame', type: 'tool',
    content: 'Agent', timestamp: 100, toolName: 'Agent', toolStatus: 'running', isSubagentTool: true }]} lang="zh" />);
  const badge = within(screen.getByTestId('beegame-subagent-disclosure-avatar-task')).getByRole('button');
  const avatar = badge.querySelector('img')!;
  expect(avatar).toHaveAttribute('width', '17');
  expect(avatar).toHaveAttribute('height', '17');
  expect(avatar.src).toMatch(/^https:\/\/api\.dicebear\.com\/10\.x\/bottts\/svg\?seed=bgs-/);
  expect(avatar.src).not.toContain('avatar-task');
  fireEvent.error(avatar);
  expect(badge.querySelector('img')).toBeNull();
  expect(badge.querySelector('.lucide-bot')).not.toBeNull();
});

it('lays out consecutive subagents in one wrapping horizontal row', () => {
  renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[
    { id: 'first-subagent', sender: 'beegame', type: 'tool', content: 'Agent', timestamp: 100,
      toolName: 'Agent', toolStatus: 'running', isSubagentTool: true },
    { id: 'second-subagent', sender: 'beegame', type: 'tool', content: 'Agent', timestamp: 101,
      toolName: 'Agent', toolStatus: 'completed', isSubagentTool: true },
  ]} lang="zh" />);
  const rows = screen.getAllByTestId('beegame-subagent-row');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toHaveClass('flex', 'flex-wrap');
  expect(within(rows[0]).getAllByRole('button')).toHaveLength(2);
  expect(Array.from(rows[0].querySelectorAll('[data-testid^="beegame-subagent-disclosure-"]'))
    .map(item => item.getAttribute('data-testid')))
    .toEqual(['beegame-subagent-disclosure-first-subagent', 'beegame-subagent-disclosure-second-subagent']);
});

it('shows the latest assistant-response time below the Streaming Response content', () => {
  const { container } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[
    { id: 'response-time', sender: 'beegame', content: 'A response with a time.', timestamp: Date.UTC(2026, 8, 23, 1, 42) },
  ]} lang="zh" />);
  expect(container.querySelector('time')).toHaveTextContent('09:42');
});

it('paces a live response without replaying completed history', () => {
  const streaming = { id: 'smooth-response', sender: 'beegame', content: 'A complete streamed sentence.',
    timestamp: Date.now(), streamStatus: 'streaming' as const };
  const { rerender } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[streaming]} isLoading streamingMessageId={streaming.id} />);
  expect(screen.getByTestId('beegame-agent-message-smooth-response')).not.toHaveTextContent(streaming.content);
  rerender(<BeeGameCollaborationFeed messages={[{ ...streaming, streamStatus: 'complete' }]} />);
  expect(screen.getByRole('button', { name: 'Copy response' })).toBeInTheDocument();
  rerender(<BeeGameCollaborationFeed messages={[{
    id: 'historical-response', sender: 'beegame', content: 'Already complete.', timestamp: Date.now(), streamStatus: 'complete',
  }]} />);
  expect(screen.getByTestId('beegame-agent-message-historical-response')).toHaveTextContent('Already complete.');
});

it('keeps each completed turn footer when a paged transcript includes older responses', () => {
  const messages = toChatDisplayMessages(normalizeChatHistory([
    { id: 'latest-response', sender: 'beegame', content: 'Latest answer',
      turnId: 'latest-turn', sequence: 500, timestamp: Date.UTC(2026, 8, 23, 9, 59) },
    { id: 'recovered-older-response', sender: 'beegame', content: 'Older answer',
      turnId: 'older-turn', sequence: 400, timestamp: Date.UTC(2026, 8, 23, 4, 55) },
  ]));
  const { container } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={messages} />);
  expect(Array.from(container.querySelectorAll('time')).map(node => node.textContent)).toEqual(['12:55', '17:59']);
  expect(container.querySelectorAll('[data-slot="message"]').item(container.querySelectorAll('[data-slot="message"]').length - 1))
    .toHaveTextContent('Latest answer');
});

it('keeps a response anchor when an older page prepends activity in the same turn', () => {
  const latest = { id: 'visible-tool', sender: 'beegame', type: 'tool' as const,
    content: 'Read', toolName: 'Read', turnId: 'same-turn', timestamp: 200 };
  const older = { id: 'older-thought', sender: 'beegame', type: 'thought' as const,
    content: 'Checking', turnId: 'same-turn', timestamp: 100 };
  const { container, rerender } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[latest]} />);
  const before = container.querySelector('[data-slot="message"]')?.getAttribute('data-history-anchor-id');
  rerender(<BeeGameCollaborationFeed messages={[older, latest]} />);
  expect(container.querySelector('[data-slot="message"]')).toHaveAttribute('data-history-anchor-id', before);
});

it('shows a time on each completed text turn, not on tool or thinking-only activity', () => {
  const { container } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[
    { id: 'earlier', sender: 'beegame', content: 'I will inspect this.', turnId: 'turn-1', timestamp: Date.UTC(2026, 8, 23, 11, 22) },
    { id: 'tool', sender: 'system', type: 'tool', content: 'Read completed', toolName: 'Read', toolStatus: 'completed',
      turnId: 'turn-2', timestamp: Date.UTC(2026, 8, 23, 11, 22, 30) },
    { id: 'thought', sender: 'beegame', type: 'thought', content: 'Checking', turnId: 'turn-3',
      timestamp: Date.UTC(2026, 8, 23, 11, 22, 45), streamStatus: 'complete' },
    { id: 'final', sender: 'beegame', content: 'Done.', turnId: 'turn-4', timestamp: Date.UTC(2026, 8, 23, 11, 23) },
  ]} lang="zh" />);
  expect(Array.from(container.querySelectorAll('time')).map(node => node.textContent)).toEqual(['19:22', '19:23']);
});

it('keeps completed delivery-turn times when automatic continuation messages are hidden', () => {
  const at = (hour: number, minute: number) => Date.UTC(2026, 8, 25, hour - 8, minute);
  const { container } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed isLoading lang="zh" messages={[
    { id: 'request', sender: 'user', content: '做一个贪吃蛇游戏', timestamp: at(14, 36) },
    { id: 'author-answer', sender: 'beegame', content: '文档完成', turnId: 'author', timestamp: at(14, 51) },
    { id: 'review-phase', sender: 'system', content: 'review', taskKind: 'delivery_phase', timestamp: at(14, 51) },
    { id: 'review-answer', sender: 'beegame', content: '评审完成', turnId: 'review', timestamp: at(14, 54) },
    { id: 'revision-phase', sender: 'system', content: 'revision', taskKind: 'delivery_phase', timestamp: at(14, 54) },
    { id: 'revision-answer', sender: 'beegame', content: '修订完成', turnId: 'revision', timestamp: at(15, 0) },
    { id: 'resources-phase', sender: 'system', content: 'resources', taskKind: 'delivery_phase', timestamp: at(15, 0) },
    { id: 'resources-working', sender: 'beegame', content: '正在准备资源', turnId: 'resources',
      timestamp: at(15, 1), streamStatus: 'streaming' },
  ]} />);
  expect(screen.getAllByTestId(/^beegame-agent-turn-/)).toHaveLength(4);
  expect(Array.from(container.querySelectorAll('time')).map(node => node.textContent)).toEqual([
    '14:36', '14:51', '14:54', '15:00',
  ]);
  expect(screen.getAllByRole('button', { name: 'Copy response' })).toHaveLength(3);
});

it('keeps one footer when a context marker splits a response within the same turn', () => {
  const { container } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed lang="zh" messages={[
    { id: 'before', sender: 'beegame', content: '第一段', turnId: 'same-turn', timestamp: Date.UTC(2026, 8, 25, 6, 51) },
    { id: 'compaction', sender: 'system', content: 'compacted', taskKind: 'context_compaction', timestamp: Date.UTC(2026, 8, 25, 6, 52) },
    { id: 'after', sender: 'beegame', content: '第二段', turnId: 'same-turn', timestamp: Date.UTC(2026, 8, 25, 6, 53) },
  ]} />);
  expect(container.querySelectorAll('time')).toHaveLength(1);
  expect(container.querySelector('time')).toHaveTextContent('14:53');
  expect(screen.getAllByRole('button', { name: 'Copy response' })).toHaveLength(1);
});

it('keeps interim prose visible without details or a final footer while the turn is working', () => {
  const { container } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[
    { id: 'interim', sender: 'beegame', content: 'I will inspect this.', timestamp: Date.UTC(2026, 8, 23, 11, 22) },
  ]} isLoading lang="zh" />);
  expect(container.querySelector('time')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Copy response' })).not.toBeInTheDocument();
  expect(container.querySelector('[data-variant="timeline"]')).toBeNull();
  expect(screen.getByText('I will inspect this.')).toBeVisible();
  expect(screen.queryByTestId('beegame-loading-message')).not.toBeInTheDocument();
});

it('uses the turn completion time for the response footer, not the first text block time', () => {
  const { container } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed lang="zh" messages={[
    { id: 'answer', sender: 'beegame', content: '文档完成', turnId: 'author',
      timestamp: Date.UTC(2026, 8, 25, 6, 50, 55), turnCompletedAt: Date.UTC(2026, 8, 25, 6, 51, 10) },
  ]} />);
  expect(container.querySelector('time')).toHaveTextContent('14:51');
});

it('places copy and edit actions below, not inside, the user-message bubble', () => {
  renderWithActivitiesExpanded(<BeeGameCollaborationFeed
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
  renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[
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
  renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[
    { id: 'legacy', sender: 'user', content: 'Old request', timestamp: 1 },
  ]} onEditMessage={() => undefined} />);
  expect(within(screen.getByTestId('beegame-user-message-legacy'))
    .queryByRole('button', { name: 'Edit message' })).not.toBeInTheDocument();
});

it('immediately replaces the selected user bubble with the BeUI editor and submits its draft', () => {
  const onEditDraftChange = vi.fn();
  const onSubmitEdit = vi.fn();
  const onCancelEdit = vi.fn();
  renderWithActivitiesExpanded(<BeeGameCollaborationFeed
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
it('expands a tool record to show its image and opens the full image', async () => {
  const { container } = render(<BeeGameCollaborationFeed messages={[{ id: 'screenshot', sender: 'beegame', content: 'Read', timestamp: Date.now(),
    type: 'tool', toolName: 'Read', toolUseId: 'read-image', toolStatus: 'completed',
    attachments: [{ type: 'image', mediaType: 'image/png', data: 'aGVsbG8=', filename: 'screenshot.png' }],
  }]} />);
  const details = screen.getByRole('button', { name: /^Execution details/ });
  expect(details).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('img', { name: 'screenshot.png' })).not.toBeInTheDocument();
  fireEvent.click(details);
  const row = screen.getByRole('group', { name: 'Read', exact: true });
  expect(row).toHaveAccessibleDescription('Completed');
  const record = row.closest('details')!;
  expect(record).not.toHaveAttribute('open');
  expect(screen.getByAltText('screenshot.png')).not.toBeVisible();
  fireEvent.click(record.querySelector('summary')!);
  expect(record).toHaveAttribute('open');
  const image = screen.getByRole('img', { name: 'screenshot.png' });
  await waitFor(() => expect(image).toBeVisible());
  expect(record).toContainElement(image);
  expect(container.querySelector('[data-variant="timeline"]')).toContainElement(image);
  fireEvent.load(image);
  fireEvent.click(screen.getByRole('button', { name: 'Enlarge image: screenshot.png' }));
  expect(await screen.findByRole('dialog')).toContainElement(screen.getAllByRole('img', { name: 'screenshot.png' }).at(-1)!);
  fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
  fireEvent.click(record.querySelector('summary')!);
  expect(record).not.toHaveAttribute('open');
  expect(screen.getByAltText('screenshot.png')).not.toBeVisible();
});

it('shows image attachments once after live tool completion and retains them through later progress and a final reply', () => {
  const start: ChatDisplayMessage = { id: 'image-start', sender: 'beegame', type: 'tool', content: '',
    timestamp: 1000, turnId: 'images', toolName: 'imageView', toolUseId: 'image-call', toolStatus: 'running' };
  const end: ChatDisplayMessage = { ...start, id: 'image-end', timestamp: 2000, toolStatus: 'completed',
    attachments: [{ type: 'image', mediaType: 'image/png', data: 'aGVsbG8=', filename: 'design.png' }] };
  const progress: ChatDisplayMessage = { ...start, id: 'image-progress', timestamp: 3000 };
  const final: ChatDisplayMessage = { id: 'image-final', sender: 'beegame', content: 'Design ready.',
    timestamp: 4000, turnId: 'images' };
  const { rerender } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[start]} isLoading />);
  expect(screen.queryByRole('img', { name: 'design.png' })).not.toBeInTheDocument();
  rerender(<BeeGameCollaborationFeed messages={[start, end]} isLoading />);
  const record = screen.getByRole('group', { name: 'imageView' }).closest('details')!;
  expect(record).not.toHaveAttribute('open');
  fireEvent.click(record.querySelector('summary')!);
  expect(screen.getAllByRole('img', { name: 'design.png' })).toHaveLength(1);
  rerender(<BeeGameCollaborationFeed messages={[start, end, progress, final]} />);
  expect(screen.getAllByRole('img', { name: 'design.png' })).toHaveLength(1);
  expect(screen.getByRole('button', { name: /^Execution details/ })).toHaveAttribute('aria-expanded', 'true');
});

it('restores native image previews through transcript projection without exposing failed tool attachments', async () => {
  const messages = toChatDisplayMessages(normalizeChatHistory(transcriptEventsToHistory('image-project', [
    { id: 1, sessionId: 'main', turnId: 'image-turn', type: 'tool.completed', text: 'imageView',
      createdAt: '2026-01-01T00:00:01Z', payload: { toolName: 'imageView', toolUseID: 'saved-image',
        attachments: [{ type: 'image', mediaType: 'image/png', data: 'aGVsbG8=', filename: 'restored.png' }] } },
    { id: 2, sessionId: 'main', turnId: 'image-turn', type: 'tool.failed', text: 'imageView',
      createdAt: '2026-01-01T00:00:02Z', payload: { toolName: 'imageView', toolUseID: 'failed-image',
        attachments: [{ type: 'image', mediaType: 'image/png', data: 'aGVsbG8=', filename: 'failed.png' }] } },
  ])));
  const { container } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={messages} />);
  const record = container.querySelector('details')!;
  fireEvent.click(record.querySelector('summary')!);
  await waitFor(() => expect(screen.getByRole('img', { name: 'restored.png' })).toBeVisible());
  expect(screen.queryByRole('img', { name: 'failed.png' })).not.toBeInTheDocument();
  expect(container.querySelectorAll('details')).toHaveLength(1);
});

it('keeps generated and viewed images in their own tool records', async () => {
  const { container } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[
    { id: 'view-image', sender: 'beegame', type: 'tool', content: '', timestamp: 1000, turnId: 'images',
      toolName: 'imageView', toolStatus: 'completed',
      attachments: [{ type: 'image', mediaType: 'image/png', data: 'aGVsbG8=', filename: 'reference.png' }] },
    { id: 'generate-image', sender: 'beegame', type: 'tool', content: '', timestamp: 2000, turnId: 'images',
      toolName: 'Shell', toolStatus: 'completed', toolInput: { description: 'Generate image' },
      attachments: [{ type: 'image', mediaType: 'image/png', data: 'aGVsbG8=', filename: 'generated.png' }] },
  ]} />);
  const records = container.querySelectorAll('details');
  expect(records).toHaveLength(2);
  fireEvent.click(records[1].querySelector('summary')!);
  await waitFor(() => expect(within(records[1]).getByRole('img', { name: 'generated.png' })).toBeVisible());
  expect(screen.getByAltText('reference.png')).not.toBeVisible();
  fireEvent.click(records[0].querySelector('summary')!);
  expect(within(records[0]).getByRole('img', { name: 'reference.png' })).toBeVisible();
});
const FAILURE_TURN_ID = 'beegame-turn-beegame_bcc8df40769c4754895fac37064035d5-1';
const CHECKLIST_MIXED_MESSAGE_ID = '021789434990692846a816464a9af9c0791e0f68a2ce03cbd3227';
const CHECKLIST_FINAL_MESSAGE_ID = '021789435028095846a816464a9af9c0791e0f68a2ce03cdcd201';
const IMPLEMENTATION_MIXED_MESSAGE_ID = '0217894385633113d0449b03f13da7ad7c0359f0f1d760c19f272';

describe('BeeGameCollaborationFeed canonical transcript', () => {
  it('filters paths from assistant and subagent output without changing user-authored text', () => {
    const { container } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[
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
    renderWithActivitiesExpanded(<BeeGameCollaborationFeed
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
      const { rerender } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[message]} isLoading={state === 'running'} lang="zh" />);
      const pill = screen.getByTestId('beegame-subagent-disclosure-badge-task');
      const badge = within(pill).getByRole('button');
      const name = badge.querySelector('.truncate')?.textContent;
      expect(name).toBeTruthy();
      expect(name).not.toMatch(/^(子任务|Subagent|Task)$/);
      expect(badge).toHaveAccessibleName(`${name} · ${zh}`);
      expect(badge).toHaveAttribute('data-subagent-state', state);
      expect(badge).toHaveClass(color);
      expect(badge.querySelector('.lucide-chevron-right')).toBeNull();
      expect(badge.querySelectorAll('[data-subagent-state]')).toHaveLength(0);
      expect(badge).not.toHaveTextContent(zh);
      expect(badge.querySelector('img')?.getAttribute('src')).toMatch(/^https:\/\/api\.dicebear\.com\/10\.x\/bottts\/svg\?seed=bgs-/);
      if (state === 'running') expect(badge.querySelectorAll('[role="status"] .grid > span')).toHaveLength(9);
      if (state === 'completed') expect(badge.querySelector('.lucide-circle-check')).not.toBeNull();
      // The badge must not introduce a second interactive control inside the pill.
      expect(within(pill).getAllByRole('button')).toHaveLength(1);
      fireEvent.click(within(pill).getByRole('button'));
      expect(within(screen.getByTestId('beegame-agent-run-detail')).getByRole('status', { name: zh }))
        .toHaveAttribute('data-subagent-state', state);
      if (state === 'completed') expect(screen.getByTestId('beegame-agent-run-detail').querySelector('.lucide-circle-check')).not.toBeNull();
      expect(within(screen.getByTestId('beegame-agent-run-detail')).getByRole('heading', { name, level: 2 }))
        .toBeInTheDocument();
      rerender(<BeeGameCollaborationFeed messages={[message]} isLoading={state === 'running'} lang="en" />);
      expect(within(pill).getByRole('button', { name: `${name} · ${en}` })).toHaveAttribute('data-subagent-state', state);
    });

  it('labels cancelled tools as stopped rather than failed', () => {
    renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[
      { id: 'cancelled', sender: 'beegame', type: 'tool', content: 'Bash', timestamp: 100,
        toolName: 'Bash', toolStatus: 'failed', completionReason: 'stopped' },
    ]} lang="en" />);
    expect(screen.getByRole('button', { name: 'Execution details' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Bash' })).toHaveAccessibleDescription('Stopped');
    expect(screen.queryByTestId('beegame-activity-issue')).not.toBeInTheDocument();
  });

  it('keeps a native background task name consistent between the pill and detail', () => {
    renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[
      { id: 'shell-task', sender: 'beegame', type: 'tool', content: 'Task', timestamp: 100,
        toolName: 'Task', toolStatus: 'running', isSubagentTool: true, subagentPrompt: 'Check build' },
    ]} isLoading lang="en" />);
    const pill = screen.getByTestId('beegame-subagent-disclosure-shell-task');
    const badge = within(pill).getByRole('button');
    const name = badge.querySelector('.truncate')?.textContent;
    expect(badge).toHaveAccessibleName(`${name} · Working`);
    fireEvent.click(badge);
    expect(within(screen.getByTestId('beegame-agent-run-detail')).getByRole('heading', { name, level: 2 }))
      .toBeInTheDocument();
  });

  it('preserves an unavailable native tool call without classifying its diagnostic text', () => {
    renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[
      { id: 'invalid-tool', sender: 'system', type: 'tool', timestamp: 100,
        content: 'TodoWrite传统" string="true failed', toolName: 'TodoWrite传统" string="true', toolStatus: 'failed',
        toolOutput: '<tool_use_error>Error: No such tool available: TodoWrite传统" string="true</tool_use_error>' },
    ]} lang="zh" />);
    expect(screen.getByRole('group', { name: 'TodoWrite传统" string="true' })).toHaveAccessibleDescription('失败');
    expect(screen.queryByText(/No such tool available: TodoWrite传统/)).not.toBeInTheDocument();
  });

  it('does not create execution details for thinking-only messages', () => {
    renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[
      { id: 'unknown', sender: 'beegame', type: 'thought', content: 'unknown timing', timestamp: 100, streamStatus: 'complete' },
      { id: 'short', sender: 'beegame', type: 'thought', content: 'short thinking', timestamp: 200, streamStatus: 'complete', thinkingDurationMs: 365 },
    ]} lang="en" />);
    expect(screen.queryByRole('button', { name: 'Thought', exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Execution details/ })).not.toBeInTheDocument();
    expect(screen.queryByText('unknown timing')).not.toBeInTheDocument();
    expect(screen.queryByText('short thinking')).not.toBeInTheDocument();
  });

  it('retains failed tool status without a raw input/output drawer', () => {
    renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[
      { id: 'tool-detail', sender: 'beegame', type: 'tool', content: 'Read failed', timestamp: 100,
        toolName: 'Read', toolDetail: 'manifest.json', toolStatus: 'failed', toolInput: { path: 'manifest.json' }, toolOutput: 'Detailed failure, not a completed step' },
    ]} lang="en" />);
    const row = screen.getByRole('group', { name: 'Read manifest.json' });
    expect(row).toHaveAccessibleDescription('Failed');
    fireEvent.click(row);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Detailed failure, not a completed step')).not.toBeInTheDocument();
  });
  it('updates the open subagent drawer as progress and terminal result arrive', () => {
    const message: ChatDisplayMessage = { id: 'subagent-live', sender: 'beegame', content: 'Subagent: Audit assets',
      type: 'tool', timestamp: Date.now(), toolName: 'Agent', toolStatus: 'running', isSubagentTool: true,
      subagentPrompt: 'Audit assets', subagentTrace: 'Read manifest.json', subagentOutput: 'Agent input streaming' };
    const { rerender } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[message]} isLoading />);
    const badge = within(screen.getByTestId('beegame-subagent-disclosure-subagent-live')).getByRole('button', { name: /Working/ });
    expect(badge).toHaveAttribute('data-subagent-state', 'running');
    const avatar = badge.querySelector('img');
    expect(avatar).not.toBeNull();
    expect(badge.querySelectorAll('[role="status"] .grid > span')).toHaveLength(9);
    const animatedDot = badge.querySelector('[role="status"] .grid > span');
    expect(parseFloat((animatedDot as HTMLElement).style.width)).toBeCloseTo(2.88);
    fireEvent.click(within(screen.getByTestId('beegame-subagent-disclosure-subagent-live')).getByRole('button'));
    expect(screen.getByTestId('beegame-agent-run-detail')).not.toHaveTextContent('Read manifest.json');
    expect(screen.getByTestId('beegame-agent-run-detail')).not.toHaveTextContent('Agent input streaming');
    rerender(<BeeGameCollaborationFeed messages={[{ ...message, subagentTrace: 'Checking hashes' }]} />);
    expect(badge.querySelector('[role="status"] .grid > span')).toBe(animatedDot);
    expect(screen.getByTestId('beegame-agent-run-detail')).not.toHaveTextContent('Checking hashes');
    rerender(<BeeGameCollaborationFeed messages={[{ ...message, toolStatus: 'completed',
      subagentTrace: 'Checked hashes and palette', subagentOutput: 'Audit passed' }]} />);
    expect(screen.getByTestId('beegame-agent-run-detail')).toHaveTextContent('Completed');
    expect(screen.getByTestId('beegame-agent-run-detail')).not.toHaveTextContent('Checked hashes and palette');
    expect(screen.getByTestId('beegame-agent-run-detail')).toHaveTextContent('Audit passed');
    // Native activity collapses on completion; the open detail drawer remains live.
    expect(screen.getByTestId('beegame-subagent-disclosure-subagent-live').querySelector('[role="button"]'))
      .toBe(badge);
    expect(badge).toHaveAttribute('data-subagent-state', 'completed');
    expect(badge.querySelector('img')).toBe(avatar);
    expect(badge.querySelector('.lucide-circle-check')).not.toBeNull();
    expect(badge).not.toHaveTextContent('Completed');
    expect(within(screen.getByTestId('beegame-agent-run-detail')).getByRole('status', { name: 'Completed' }))
      .toHaveAttribute('data-subagent-state', 'completed');
  });
  it('shows a tool in the already-open subagent drawer while it is still running, then updates it in place', () => {
    const message: ChatDisplayMessage = { id: 'subagent-running-tools', sender: 'beegame', content: 'Inspect assets',
      type: 'tool', timestamp: 1, toolName: 'Agent', toolStatus: 'running', isSubagentTool: true, subagentPrompt: 'Inspect assets' };
    const { rerender } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[message]} isLoading />);
    fireEvent.click(within(screen.getByTestId('beegame-subagent-disclosure-subagent-running-tools')).getByRole('button'));
    const entry = { id: 'slow-bash', kind: 'tool' as const, toolName: 'Bash', command: 'bun test slow.test.ts', status: 'running' as const };
    rerender(<BeeGameCollaborationFeed isLoading messages={[{ ...message, subagentActivity: { entries: [entry], truncated: false } }]} />);
    const detail = screen.getByTestId('beegame-agent-run-detail');
    const pendingTool = detail.querySelector('[data-tool-id="slow-bash"]');
    expect(pendingTool).toBeInTheDocument();
    expect(pendingTool).toHaveTextContent('Run command · bun · slow.test.ts');
    expect(pendingTool).not.toHaveTextContent('TOOL_FINISHED');
    rerender(<BeeGameCollaborationFeed messages={[{ ...message, subagentActivity: {
      entries: [{ ...entry, status: 'completed', output: 'TOOL_FINISHED' }], truncated: false,
    } }]} isLoading />);
    expect(detail.querySelector('[data-tool-id="slow-bash"]')).toBe(pendingTool);
    expect(detail.querySelectorAll('[data-tool-id="slow-bash"]')).toHaveLength(1);
    expect(pendingTool).toHaveAccessibleDescription('Completed');
    expect(pendingTool).not.toHaveTextContent('TOOL_FINISHED');
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

  it('renders the canonical activity and markdown result in response order without an execution archive', async () => {
    renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={sampleMessages} />);
    const checklistTurn = screen.getAllByTestId(/^beegame-agent-turn-/)
      .find((turn) => turn.textContent?.includes('Checklist 候选文件已写入'));
    expect(checklistTurn).toBeDefined();
    const activities = checklistTurn!.querySelectorAll('[data-content]');
    const activity = activities[0] as HTMLElement;
    expect(activity).toBeInTheDocument();
    expect(activities).toHaveLength(1);
    expect(activity).toHaveAttribute('data-content', 'text');
    expect([...activities].every((candidate) => !candidate.textContent?.includes('Running tools'))).toBe(true);
    expect([...activities].every((candidate) => !candidate.textContent?.includes('Run Tool'))).toBe(true);
    const tool = await within(activity).findByRole('group', { name: /Write/ });
    await waitFor(() => expect(tool).toBeVisible());
    expect(within(activity).getByRole('button', { name: /^Execution details/ })).toBeInTheDocument();
    expect(within(activity).queryByRole('button', { name: 'Thought', exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(/11 verified acceptance scenarios/)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`beegame-agent-message-beegame-assistant-beegame_191b560f8a9046b18e1efed2fafa8f07-${CHECKLIST_MIXED_MESSAGE_ID}-block-1`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`beegame-agent-message-beegame-assistant-beegame_0889307bbd6142f186543e33306e9b01-${IMPLEMENTATION_MIXED_MESSAGE_ID}-block-1`)).not.toBeInTheDocument();
    expect(activity).not.toHaveTextContent('11 个经验证的验收场景');
    expect(activity).not.toHaveTextContent('Checklist 候选文件已写入');
    const final = screen.getByTestId(`beegame-agent-message-beegame-assistant-beegame_191b560f8a9046b18e1efed2fafa8f07-${CHECKLIST_FINAL_MESSAGE_ID}-block-0`);
    expect(final).toBeVisible();
    expect(activity).not.toContainElement(final);
    expect(tool.compareDocumentPosition(final) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(checklistTurn!).queryByTestId('beegame-file-diff')).not.toBeInTheDocument();
    expect(screen.queryByText('LLM generated')).not.toBeInTheDocument();
  });

  it('keeps tool records without thoughts in the execution activity', async () => {
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

    const { container } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={messages} />);

    const activity = container.querySelector('[data-variant="timeline"]')!;
    expect(container.querySelectorAll('[data-content]')).toHaveLength(1);
    expect(activity).toHaveTextContent('Execution details · 3s');
    expect(within(activity as HTMLElement).queryByText('Checking the content package.')).not.toBeInTheDocument();
    expect(within(activity as HTMLElement).queryByRole('button', { name: 'Thought', exact: true })).not.toBeInTheDocument();
    await waitFor(() => expect(within(activity as HTMLElement).getByRole('group', { name: 'Run command · ls' })).toBeVisible());
    expect(screen.queryByText('Content directory is absent.')).not.toBeInTheDocument();
    expect(within(activity as HTMLElement).getAllByRole('listitem')).toHaveLength(1);
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
    const { rerender } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={sameDayMessages} />);
    expect(screen.getAllByTestId('beegame-date-separator')).toHaveLength(1);
    rerender(<BeeGameCollaborationFeed messages={crossDayMessages} />);
    expect(screen.getAllByTestId('beegame-date-separator')).toHaveLength(2);
    expect(screen.getAllByTestId('beegame-date-separator').map((node) => node.getAttribute('data-date-key')))
      .toEqual(['2026-09-14', '2026-09-15']);
  });
});

it('stops the live timer and stale tool/thought spinners when the runtime becomes inactive', () => {
  vi.useFakeTimers();
  try {
    const at = Date.now();
    const messages: ChatDisplayMessage[] = [
      { id: 'partial', sender: 'beegame', type: 'thought', content: 'Checking', timestamp: at - 5000,
        turnId: 'stale', streamStatus: 'streaming' },
      { id: 'unfinished', sender: 'beegame', type: 'tool', content: '', timestamp: at - 4000,
        turnId: 'stale', toolName: 'Shell', toolStatus: 'running', toolInput: { command: 'bun run build' } },
    ];
    const { container, rerender } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={messages} isLoading streamingMessageId="partial" />);
    expect(screen.getByRole('button', { name: /^Execution details/ })).toHaveTextContent('5s');
    expect(screen.getByTestId('beegame-work-status')).toBeVisible();
    rerender(<BeeGameCollaborationFeed messages={messages} isLoading={false} streamingMessageId="partial" />);
    expect(screen.queryByTestId('beegame-work-status')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Run script · build' }).closest('[data-tool-state]')).toHaveAttribute('data-tool-state', 'incomplete');
    const heading = container.querySelector('[data-variant="timeline"] > button')!;
    const frozen = heading.textContent;
    act(() => vi.advanceTimersByTime(60000));
    expect(heading.textContent).toBe(frozen);
    expect(messages[0].streamStatus).toBe('streaming');
    expect(messages[1].completionReason).toBeUndefined();
  } finally { vi.useRealTimers(); }
});

it.each(['stopped', 'failed'] as const)('uses the %s event time for a tool-only turn and keeps it frozen', completionReason => {
  vi.useFakeTimers();
  try {
    const start = Date.now() - 10000;
    renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[{
      id: 'terminal-tool', sender: 'beegame', type: 'tool', content: '', timestamp: start,
      toolName: 'Shell', toolStatus: 'failed', completionReason, turnCompletedAt: start + 7000,
      toolInput: { command: 'bun run build' },
    }]} />);
    const heading = screen.getByRole('button', { name: /^Execution details · 7s/ });
    act(() => vi.advanceTimersByTime(60000));
    expect(heading).toHaveTextContent('Execution details · 7s');
    expect(screen.getByRole('group', { name: 'Run script · build' })).toHaveAccessibleDescription(completionReason === 'stopped' ? 'Stopped' : 'Failed');
  } finally { vi.useRealTimers(); }
});

it('keeps a detached child live after its parent completed while the runtime is still busy', () => {
  renderWithActivitiesExpanded(<BeeGameCollaborationFeed isLoading messages={[
    { id: 'parent-result', sender: 'beegame', content: 'Delegated', timestamp: 1000,
      turnId: 'parent', streamStatus: 'complete', turnCompletedAt: 2000 },
    { id: 'live-child', sender: 'beegame', type: 'tool', content: '', timestamp: 1500,
      turnId: 'parent', toolName: 'Agent', toolStatus: 'running', isSubagentTool: true },
  ]} />);
  expect(screen.getByTestId('beegame-work-status')).toBeVisible();
  expect(within(screen.getByTestId('beegame-subagent-disclosure-live-child')).getByRole('button')).toHaveAttribute('data-subagent-state', 'running');
});

it('omits an unknown duration for an inactive tool without a terminal receipt', () => {
  renderWithActivitiesExpanded(<BeeGameCollaborationFeed messages={[{
    id: 'missing-end', sender: 'beegame', type: 'tool', content: '', timestamp: 1000,
    toolName: 'Shell', toolStatus: 'running', toolInput: { command: 'bun run build' },
  }]} />);
  expect(screen.getByRole('group', { name: 'Run script · build' })).toHaveAccessibleDescription('Incomplete');
  expect(screen.getByRole('group', { name: 'Run script · build' })).not.toHaveTextContent(/\d+s/);
  expect(screen.getByRole('button', { name: 'Execution details', exact: true })).toBeInTheDocument();
});

it('keeps the old tool inactive across stop, history replay and a new live turn', () => {
  useChatStore.getState().clearMessages();
  try {
    const at = Date.now() - 5000;
    const old: ChatDisplayMessage = { id: 'old-stored-tool', messageId: 'old-stored-tool', taskId: 'session',
      turnId: 'old-turn', sender: 'beegame', type: 'tool', content: '', timestamp: at,
      toolName: 'Shell', toolStatus: 'running', toolInput: { command: 'bun run build' } };
    useChatStore.getState().addMessage(old);
    const { container, rerender } = renderWithActivitiesExpanded(<BeeGameCollaborationFeed isLoading messages={useChatStore.getState().messages} />);
    useChatStore.getState().settleInactiveActivity(at + 1000);
    rerender(<BeeGameCollaborationFeed messages={useChatStore.getState().messages} />);
    useChatStore.getState().loadHistory([{ ...old, completionReason: undefined }]);
    useChatStore.getState().addMessage({ id: 'new-request', sender: 'user', content: 'Continue', timestamp: at + 2000 });
    useChatStore.getState().updateMessage('session', 'New response', 'beegame', 'text', false, undefined, undefined,
      { turnId: 'new-turn' }, at + 3000, 'new-response');
    rerender(<BeeGameCollaborationFeed isLoading messages={useChatStore.getState().messages} />);
    const prior = screen.getByTestId('beegame-agent-turn-old-stored-tool');
    expect(within(prior).queryByTestId('beegame-work-status')).not.toBeInTheDocument();
    const heading = prior.querySelector('[data-variant="timeline"] > button') as HTMLButtonElement;
    if (heading.getAttribute('aria-expanded') === 'false') fireEvent.click(heading);
    expect(container.querySelector('[data-tool-id="old-stored-tool"]')).toHaveAttribute('data-tool-state', 'incomplete');
    expect(screen.getAllByTestId('beegame-work-status')).toHaveLength(1);
  } finally { useChatStore.getState().clearMessages(); }
});
