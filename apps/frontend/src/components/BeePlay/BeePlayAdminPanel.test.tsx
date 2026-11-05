import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BeePlayAdminPanel } from './BeePlayAdminPanel';
import {
  getBeePlayOverview,
  saveBeePlayRecommendations,
  type BeePlayOverview,
} from '../../../../game-portal/src/admin-api';
vi.mock('../../../../game-portal/src/admin-api', () => ({
  getBeePlayOverview: vi.fn(),
  saveBeePlayRecommendations: vi.fn(),
}));
const metrics = { visits: 3, plays: 2, visitors: 2, impressions: 10, clicks: 1 };
const fixture: BeePlayOverview = {
  games: ['One', 'Two'].map((title, i) => ({
    title,
    project_id: String(i + 1),
    author_name: 'Creator',
    play_count: 8,
    ...metrics,
  })),
  totalGames: 2,
  featured: [{ project_id: '1', title: 'One' }],
  totals: metrics,
  daily: [{ day: '2026-10-24', ...metrics }],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getBeePlayOverview).mockResolvedValue(fixture);
  vi.mocked(saveBeePlayRecommendations).mockResolvedValue({ projectIds: ['2', '1'] });
});
describe('BeePlay management', () => {
  it('edits order without changing the server until save, and retains edits during searches', async () => {
    const user = userEvent.setup();
    render(<BeePlayAdminPanel language="zh" />);
    await user.click(await screen.findByRole('button', { name: '添加' }));
    await user.click(screen.getByRole('button', { name: '上移 Two' }));
    expect(saveBeePlayRecommendations).not.toHaveBeenCalled();
    await user.type(screen.getByRole('textbox', { name: '搜索已发布游戏' }), 'Two');
    await user.click(screen.getByRole('button', { name: '搜索' }));
    await waitFor(() =>
      expect(getBeePlayOverview).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'Two' }))
    );
    await user.click(screen.getByRole('button', { name: '保存推荐' }));
    await waitFor(() => expect(saveBeePlayRecommendations).toHaveBeenCalledWith([{ project_id: '2', featured_caption: '' }, { project_id: '1', featured_caption: '' }]));
    expect(await screen.findByText('推荐已保存')).toBeInTheDocument();
  });
  it('keeps the unsaved list after a failed save and supports clearing all recommendations', async () => {
    vi.mocked(saveBeePlayRecommendations).mockRejectedValueOnce(Error('offline'));
    const user = userEvent.setup();
    render(<BeePlayAdminPanel language="zh" />);
    await user.click(await screen.findByRole('button', { name: '移除' }));
    await user.click(screen.getByRole('button', { name: '保存推荐' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('推荐未保存');
    expect(screen.getByRole('button', { name: '保存推荐' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: '保存推荐' }));
    await waitFor(() => expect(saveBeePlayRecommendations).toHaveBeenLastCalledWith([]));
  });
  it('keeps optional banner text empty by default and saves text with the selected game', async () => {
    const user = userEvent.setup();
    render(<BeePlayAdminPanel language="zh" />);
    const caption = await screen.findByRole('textbox', { name: 'Banner 文案：One' });
    expect(caption).toHaveValue('');
    await user.type(caption, 'First line{Enter}Second line');
    expect(saveBeePlayRecommendations).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '保存推荐' }));
    await waitFor(() => expect(saveBeePlayRecommendations).toHaveBeenCalledWith([{ project_id: '1', featured_caption: 'First line\nSecond line' }]));
  });
  it('shows real aggregate data and requests per-game detail', async () => {
    const user = userEvent.setup();
    render(<BeePlayAdminPanel language="zh" />);
    await screen.findByRole('button', { name: '添加' });
    await user.click(screen.getByRole('tab', { name: '数据统计' }));
    expect(screen.getAllByText('10.0%').length).toBeGreaterThan(0);
    const row = screen.getByText('Two').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: '明细' }));
    await waitFor(() =>
      expect(getBeePlayOverview).toHaveBeenLastCalledWith(expect.objectContaining({ project: '2' }))
    );
    await user.click(screen.getByRole('button', { name: '查看全部' }));
    await waitFor(() =>
      expect(getBeePlayOverview).toHaveBeenLastCalledWith(expect.objectContaining({ project: '' }))
    );
  });
});
