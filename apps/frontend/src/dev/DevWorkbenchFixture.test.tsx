import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ChatDisplayMessage } from '../viewModels/displayModels';
import { BeeGameCollaborationFeed } from '../components/Demiurge/Sidebar/BeeGameCollaborationFeed';
import { sampleMessages } from './DevWorkbenchFixture';

const CHECKLIST_TURN_ID = 'beegame-turn-beegame_191b560f8a9046b18e1efed2fafa8f07-1';
const IMPLEMENTATION_TURN_ID = 'beegame-turn-beegame_0889307bbd6142f186543e33306e9b01-1';
const FAILURE_TURN_ID = 'beegame-turn-beegame_bcc8df40769c4754895fac37064035d5-1';
const CHECKLIST_MIXED_MESSAGE_ID = '021789434990692846a816464a9af9c0791e0f68a2ce03cbd3227';
const CHECKLIST_FINAL_MESSAGE_ID = '021789435028095846a816464a9af9c0791e0f68a2ce03cdcd201';
const IMPLEMENTATION_MIXED_MESSAGE_ID = '0217894385633113d0449b03f13da7ad7c0359f0f1d760c19f272';

describe('DevWorkbenchFixture canonical transcript', () => {
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
    const activities = within(checklistTurn!).getAllByTestId('beegame-agent-activity-group');
    const activity = activities[0];
    const toolActivity = activities[1];
    expect(activity).toBeInTheDocument();
    expect(activities).toHaveLength(2);
    expect(activities[0].querySelector('[data-content="text"]')).toBeInTheDocument();
    expect(activities[1].querySelector('[data-content="tool"]')).toBeInTheDocument();
    expect(activities.every((candidate) => !candidate.textContent?.includes('Running tools'))).toBe(true);
    expect(activities.every((candidate) => !candidate.textContent?.includes('Run Tool'))).toBe(true);
    expect(toolActivity).toHaveTextContent('Edit');
    fireEvent.click(within(activity).getByRole('button'));
    expect(screen.getByTestId(`beegame-agent-message-beegame-assistant-beegame_191b560f8a9046b18e1efed2fafa8f07-${CHECKLIST_MIXED_MESSAGE_ID}-block-1`)).toBeInTheDocument();
    expect(screen.getByTestId(`beegame-agent-message-beegame-assistant-beegame_191b560f8a9046b18e1efed2fafa8f07-${CHECKLIST_FINAL_MESSAGE_ID}-block-0`)).toBeInTheDocument();
    expect(screen.getByTestId(`beegame-agent-message-beegame-assistant-beegame_0889307bbd6142f186543e33306e9b01-${IMPLEMENTATION_MIXED_MESSAGE_ID}-block-1`)).toBeInTheDocument();
    expect(within(checklistTurn!).getByText(/11 个经验证的验收场景/)).toBeInTheDocument();
    expect(activities.every((candidate) => !candidate.textContent?.includes('11 个经验证的验收场景') && !candidate.textContent?.includes('Checklist 候选文件已写入'))).toBe(true);
    expect(within(checklistTurn!).getByText(/Checklist 候选文件已写入/)).toBeInTheDocument();
    expect(within(checklistTurn!).queryByTestId('beegame-file-diff')).not.toBeInTheDocument();
    expect(screen.queryByText('LLM generated')).not.toBeInTheDocument();
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
