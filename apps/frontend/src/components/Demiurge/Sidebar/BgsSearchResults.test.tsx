import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { BeeGameCollaborationFeed } from './BeeGameCollaborationFeed';

vi.mock('img-fx', () => ({ ImageGeneration: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
it('shows the search query and completion state without exposing raw tool output, while the final source stays clickable', () => {
  const sourceUrl = 'https://github.com/phaserjs/phaser/releases';
  const { container } = render(<BeeGameCollaborationFeed lang="en" messages={[{
    id: 'native-search', sender: 'beegame', type: 'tool', content: '', timestamp: 1,
    toolName: 'webSearch', toolStatus: 'completed', toolInput: { query: 'Phaser official release' },
    toolOutput: `- [Phaser releases](<${sourceUrl}>)\n  raw-search-snippet`,
  }, {
    id: 'search-answer', sender: 'beegame', type: 'text', timestamp: 2,
    content: 'The official releases are available in the sources below.',
    sources: [{ id: 'phaser-releases', title: 'Phaser releases', url: sourceUrl }],
  }]} />);
  const activity = container.querySelector('[data-variant="timeline"]');
  expect(activity).not.toBeNull();
  const activityToggle = within(activity as HTMLElement).getByRole('button', { name: /^Execution details/ });
  fireEvent.click(activityToggle);
  const row = within(activity as HTMLElement).getByRole('group', { name: 'Search Phaser official release' });
  expect(row).toHaveAccessibleDescription('Completed');
  expect(container).not.toHaveTextContent('raw-search-snippet');

  fireEvent.click(screen.getByRole('button', { name: '1 source' }));
  expect(screen.getByRole('link', { name: /Phaser releases/ })).toHaveAttribute('href', sourceUrl);
});
