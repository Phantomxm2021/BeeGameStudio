// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ResourceLibraryView } from './ResourceLibraryView';
import { closeResourcePackRoute } from './resourceLibraryRoute';
import type { ResourceElement, ResourcePackSummary } from '../../services/resourceLibraryApi';
import i18n from '../../i18n';

const pack: ResourcePackSummary = {
  id: 'pack-1',
  name: 'Example Pack',
  style: 'Stylized',
  gameTypes: ['adventure'],
  dimension: '2D',
  primaryCategory: 'world-scene',
  categories: ['textures'],
  version: '1.0.0',
  status: 'published',
  elementCount: 1,
};
const element: ResourceElement = {
  id: 'element-1',
  packId: 'pack-1',
  name: 'Character Idle',
  path: 'characters/idle.png',
  category: 'models',
  kind: 'sprite-sheet',
  preview: { kind: 'image', path: 'previews/idle.png' },
  specs: { width: 256, height: 256, frames: 4 },
  dependencies: [],
  status: 'ready',
};
const materialElement: ResourceElement = { ...element, id: 'element-2', name: 'Wood', category: 'materials' };

const api = {
  createPack: async () => ({ ...pack, status: 'draft', elementCount: 0 }),
  listFolders: async () => [],
  createFolder: async () => ({ id: 'folder-1', packId: 'pack-1', name: 'Environment', path: 'Environment' }),
  updateElement: async (_packId: string, _elementId: string, changes: Partial<ResourceElement>) => ({ ...element, ...changes }),
  getElementResourceUrl: async () => 'https://signed.example/character-idle.png',
  publishPack: async () => ({ ...pack, status: 'published' }),
  listPacks: async () => [pack],
  getPack: async () => pack,
  listElements: async () => [element],
  getElement: async () => element,
  updatePack: async (_packId: string, changes: Partial<ResourcePackSummary>) => ({ ...pack, ...changes }),
  uploadPackCover: async () => pack,
  deletePack: async () => undefined,
};

describe('ResourceLibraryView', () => {
  afterEach(async () => {
    cleanup();
    closeResourcePackRoute();
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  test('renders Pack cards and opens the Pack file browser', async () => {
    const user = userEvent.setup();
    render(<ResourceLibraryView apiClient={api} />);
    expect(await screen.findByRole('heading')).toBeInTheDocument();
    expect(screen.getByText('Example Pack')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Example Pack' }));
    expect(await screen.findByText('Pack 文件')).toBeInTheDocument();
    expect(screen.getByText('World/Scene Pack')).toBeInTheDocument();
    const fileTree = screen.getByText('Pack 文件').closest('aside');
    expect(fileTree).not.toBeNull();
    expect(within(fileTree!).getByText('模型')).toBeInTheDocument();
    expect(within(fileTree!).queryByText('贴图')).not.toBeInTheDocument();
    await user.click(within(fileTree!).getByText('模型'));
    expect(screen.getByRole('button', { name: '文件 Character Idle' })).toBeInTheDocument();
  });

  test('keeps folders as expand controls and selects files for the preview workspace', async () => {
    const user = userEvent.setup();
    render(<ResourceLibraryView apiClient={api} />);
    await user.click(await screen.findByRole('button', { name: 'Example Pack' }));
    expect(screen.getByText('尚未选择文件')).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: '元素属性' })).not.toBeInTheDocument();

    const explorer = screen.getByText('Pack 文件').closest('aside');
    expect(explorer).not.toBeNull();
    await user.click(within(explorer!).getByText('模型'));
    expect(screen.getByText('尚未选择文件')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: '文件 Character Idle' }));
    expect(screen.queryByText('尚未选择文件')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '显示元素信息' })).toBeInTheDocument();
  });

  test('opens the inspector only from the Info control and restores it after close', async () => {
    const user = userEvent.setup();
    render(<ResourceLibraryView apiClient={api} />);
    await user.click(await screen.findByRole('button', { name: 'Example Pack' }));
    await user.click(screen.getByText('模型'));
    await user.click(await screen.findByRole('button', { name: '文件 Character Idle' }));
    await user.click(screen.getByRole('button', { name: '显示元素信息' }));
    await waitFor(() => expect(screen.getByRole('complementary', { name: '元素属性' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '显示元素信息' })).not.toBeInTheDocument();
    const inspector = screen.getByRole('complementary', { name: '元素属性' });
    expect(within(inspector).getByText('Stylized')).toBeInTheDocument();
    expect(within(inspector).getByText('2D', { selector: 'span' })).toBeInTheDocument();
    expect(within(inspector).getByRole('button', { name: '保存更改' })).toBeInTheDocument();
    await user.click(within(inspector).getByRole('button', { name: '关闭元素信息' }));
    expect(screen.getByRole('button', { name: '显示元素信息' })).toBeInTheDocument();
  });

  test('uses the fixed explorer workspace without preview navigation controls', async () => {
    const user = userEvent.setup();
    const { container } = render(<ResourceLibraryView apiClient={api} />);
    await user.click(await screen.findByRole('button', { name: 'Example Pack' }));
    const workspace = container.querySelector('section.flex.h-\\[calc\\(100vh-3\\.5rem\\)\\].overflow-hidden');
    expect(workspace).not.toBeNull();
    const explorer = screen.getByText('Pack 文件').closest('aside');
    expect(explorer?.className).toContain('overflow-y-auto');
    expect(screen.queryByRole('button', { name: /grid|list/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Example Pack.*模型/)).not.toBeInTheDocument();
  });

  test('derives tree categories from loaded elements when Pack metadata is empty', async () => {
    const user = userEvent.setup();
    const packWithoutCategories = { ...pack, categories: [] };
    const listElements = vi.fn(async (_packId: string, category?: string) => category === 'materials' ? [materialElement] : category === 'models' ? [element] : [element, materialElement]);
    const apiClient = { ...api, listPacks: async () => [packWithoutCategories], getPack: async () => packWithoutCategories, listElements };
    render(<ResourceLibraryView apiClient={apiClient} />);
    await user.click(await screen.findByRole('button', { name: 'Example Pack' }));
    const fileTree = screen.getByText('Pack 文件').closest('aside');
    expect(fileTree).not.toBeNull();
    await user.click(await within(fileTree!).findByText('模型'));
    expect(within(fileTree!).getByText('材质')).toBeInTheDocument();
    await user.click(within(fileTree!).getByText('材质'));
    await waitFor(() => expect(within(fileTree!).getByText('模型')).toBeInTheDocument());
    expect(listElements).toHaveBeenCalledTimes(1);
  });

  test('localizes Pack primary categories in card and detail metadata', async () => {
    await act(async () => {
      await i18n.changeLanguage('zh');
    });
    const user = userEvent.setup();
    render(<ResourceLibraryView apiClient={api} />);
    await waitFor(() => expect(screen.getByText('世界与场景包')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Example Pack' }));
    expect(screen.getByText('世界与场景包')).toBeInTheDocument();
  });

  test('stays on the Pack list after returning from an initial deep link', async () => {
    const user = userEvent.setup();
    render(<ResourceLibraryView apiClient={api} initialPackId="pack-1" />);
    await user.click(await screen.findByRole('button', { name: '返回资源包' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '返回资源包' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Example Pack' })).toBeInTheDocument();
  });

  test('removes a deleted Pack from the list and clears its route', async () => {
    const user = userEvent.setup();
    const deletePack = vi.fn(async () => undefined);
    render(<ResourceLibraryView apiClient={{ ...api, deletePack }} />);
    await user.click(await screen.findByRole('button', { name: 'Example Pack' }));
    await user.click(screen.getByRole('button', { name: '编辑 Pack' }));
    await user.type(screen.getByLabelText('输入 Pack 名称以确认'), pack.name);
    await user.click(screen.getByRole('button', { name: '确认删除 Pack' }));
    await waitFor(() => expect(deletePack).toHaveBeenCalledWith('pack-1'));
    expect(screen.queryByRole('button', { name: 'Example Pack' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '返回资源包' })).not.toBeInTheDocument();
    expect(window.location.hash).not.toContain('resource-pack=');
  });
});
