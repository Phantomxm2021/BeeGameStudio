// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { ResourceLibraryView } from './ResourceLibraryView';
import type { ResourceElement, ResourcePackSummary } from '../../services/resourceLibraryApi';

const pack: ResourcePackSummary = {
  id: 'pack-1',
  name: 'Example Pack',
  style: 'Stylized',
  gameTypes: ['adventure'],
  dimension: '2D',
  categories: ['characters', 'ui'],
  version: '1.0.0',
  status: 'published',
  elementCount: 1,
};
const element: ResourceElement = {
  id: 'element-1',
  packId: 'pack-1',
  name: 'Character Idle',
  path: 'characters/idle.png',
  category: 'characters',
  kind: 'sprite-sheet',
  preview: { kind: 'image', path: 'previews/idle.png' },
  specs: { width: 256, height: 256, frames: 4 },
  dependencies: [],
  status: 'ready',
};

const api = {
  listPacks: async () => [pack],
  getPack: async () => pack,
  listElements: async () => [element],
  getElement: async () => element,
};

describe('ResourceLibraryView', () => {
  test('renders Pack cards and opens the Pack file browser', async () => {
    const user = userEvent.setup();
    render(<ResourceLibraryView apiClient={api} />);
    expect(await screen.findByRole('heading', { name: '资源包' })).toBeInTheDocument();
    expect(screen.getByText('Example Pack')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Example Pack' }));
    expect(await screen.findByText('Pack 文件')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '文件 Character Idle' })).toBeInTheDocument();
  });

  test('shows the element properties as an overlay in the preview area', async () => {
    const user = userEvent.setup();
    render(<ResourceLibraryView apiClient={api} />);
    await user.click(await screen.findByRole('button', { name: 'Example Pack' }));
    await user.click(await screen.findByRole('button', { name: '文件 Character Idle' }));
    await waitFor(() =>
      expect(screen.getByRole('complementary', { name: '元素属性' })).toBeInTheDocument()
    );
    const inspector = screen.getByRole('complementary', { name: '元素属性' });
    expect(within(inspector).getByText('Stylized')).toBeInTheDocument();
    expect(within(inspector).getByText('2D')).toBeInTheDocument();
  });
});
