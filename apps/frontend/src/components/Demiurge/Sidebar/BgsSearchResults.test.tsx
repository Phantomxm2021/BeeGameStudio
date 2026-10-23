import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { BeeGameCollaborationFeed } from './BeeGameCollaborationFeed';

vi.mock('img-fx', () => ({ ImageGeneration: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
it('shows the search query and clickable source in the existing tool drawer', () => {
  const { container } = render(<BeeGameCollaborationFeed lang="en" messages={[{
    id: 'native-search', sender: 'beegame', type: 'tool', content: '', timestamp: 1,
    toolName: 'webSearch', toolStatus: 'completed', toolInput: { query: 'Phaser official release' },
    toolOutput: '- [Phaser releases](<https://github.com/phaserjs/phaser/releases>)\n  Official releases',
  }]} />);
  container.querySelectorAll('[data-variant="default"] > button[aria-expanded="false"]')
    .forEach(button => fireEvent.click(button));
  fireEvent.click(screen.getByRole('button', { name: /webSearch/ }));
  expect(screen.getByText(/Phaser official release/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Phaser releases' })).toHaveAttribute('href', 'https://github.com/phaserjs/phaser/releases');
});
