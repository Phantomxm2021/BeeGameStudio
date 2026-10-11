import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ProductionReviewPanel } from './ProductionReviewPanel';
import { authenticatedFetch } from '../../services/apiClient';

vi.mock('../../services/apiClient', () => ({ authenticatedFetch: vi.fn() }));
const fetcher = vi.mocked(authenticatedFetch);
const candidate = { revision: 'current-revision', state: { phase: 'acceptance' }, gate: { allowed: false, issues: ['Review required'] } };
const response = (value: unknown, ok = true) => ({ ok, status: ok ? 200 : 409, json: async () => value }) as Response;
beforeEach(() => { fetcher.mockReset(); });

it('records an explicit observed result against the loaded revision, with no model request', async () => {
  fetcher.mockResolvedValue(response(candidate));
  render(<ProductionReviewPanel projectId="project" chinese />);
  const accept = await screen.findByRole('button', { name: '当前版本合格' });
  expect(accept).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Played current build; no known blocking issue.' } });
  fireEvent.click(accept);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  expect(fetcher.mock.calls[1][0]).toBe('/api/projects/project/quality-review');
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({ decision: 'accepted', note: 'Played current build; no known blocking issue.', revision: 'current-revision' });
  expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/projects/project/production', '/api/projects/project/quality-review', '/api/projects/project/production']);
});

it('surfaces a stale revision rejection instead of showing a successful review', async () => {
  fetcher.mockResolvedValueOnce(response(candidate)).mockResolvedValueOnce(response({ error: 'Current revision changed' }, false));
  render(<ProductionReviewPanel projectId="project" chinese />);
  await screen.findByRole('button', { name: '当前版本合格' });
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Observed' } });
  fireEvent.click(screen.getByRole('button', { name: '当前版本合格' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Current revision changed');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('does not reuse the previous project review while a different project loads', async () => {
  fetcher.mockResolvedValueOnce(response(candidate)).mockImplementationOnce(() => new Promise(() => {}));
  const view = render(<ProductionReviewPanel projectId="first" chinese />);
  await screen.findByRole('button', { name: '当前版本合格' });
  view.rerender(<ProductionReviewPanel projectId="second" chinese />);
  expect(screen.queryByRole('button', { name: '当前版本合格' })).not.toBeInTheDocument();
  expect(screen.queryByText(/current-revi/)).not.toBeInTheDocument();
  await waitFor(() => expect(fetcher.mock.calls[1][0]).toBe('/api/projects/second/production'));
});

it('migrates retired state only by an explicit user operation', async () => {
  fetcher.mockResolvedValue(response({ ...candidate, state: { phase: 'legacy' } }));
  render(<ProductionReviewPanel projectId="old" chinese />);
  fireEvent.click(await screen.findByRole('button', { name: '迁移旧项目（不重跑）' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  expect(fetcher.mock.calls[1][0]).toBe('/api/projects/old/production-migration');
});

it('records optional sample feedback with a distinct scope, not a release acceptance', async () => {
  fetcher.mockResolvedValue(response({ ...candidate, state: { phase: 'production' },
    runtimeReview: { scope: 'playable', status: 'passed', sampleReviewCurrent: false,
      quality: { observations: ['Actual feedback inspected'], unverified: ['No player enjoyment evidence'] } } }));
  render(<ProductionReviewPanel projectId="sample" chinese />);
  const accept = await screen.findByRole('button', { name: '样板可沿用' });
  expect(screen.queryByRole('button', { name: '当前版本合格' })).not.toBeInTheDocument();
  expect(screen.getByText('No player enjoyment evidence')).toBeInTheDocument();
  expect(screen.queryByText('Review required')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Sample feedback, not full release judgment' } });
  fireEvent.click(accept);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({ scope: 'sample', decision: 'accepted',
    note: 'Sample feedback, not full release judgment', revision: 'current-revision' });
});

it('refreshes the actual phase without starting a model and identifies historical sample feedback', async () => {
  fetcher.mockResolvedValueOnce(response({ ...candidate, state: { phase: 'playable' }, runtimeReview: { scope: 'playable', status: 'missing', sampleReviewCurrent: false } }))
    .mockResolvedValueOnce(response({ ...candidate, state: { phase: 'acceptance', sampleReview: { decision: 'accepted', note: 'Earlier sample' } },
      runtimeReview: { scope: 'delivery', status: 'missing', sampleReviewCurrent: false } }));
  render(<ProductionReviewPanel projectId="changing" chinese />);
  await screen.findByRole('button', { name: '样板可沿用' });
  fireEvent.click(screen.getByRole('button', { name: '刷新检查结果' }));
  await screen.findByRole('button', { name: '当前版本合格' });
  expect(screen.queryByRole('button', { name: '样板可沿用' })).not.toBeInTheDocument();
  expect(screen.getByText(/历史记录，不代表当前版本/)).toBeInTheDocument();
  expect(screen.getByText('未记录；不能推断体验质量通过。')).toBeInTheDocument();
  expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/projects/changing/production', '/api/projects/changing/production']);
});

it('does not offer a sample operation to an older backend without sample reporting', async () => {
  fetcher.mockResolvedValue(response({ ...candidate, state: { phase: 'production' } }));
  render(<ProductionReviewPanel projectId="older-runtime" chinese />);
  await screen.findByText(/首发制作/);
  expect(screen.queryByRole('button', { name: '样板可沿用' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '当前版本合格' })).not.toBeInTheDocument();
});
