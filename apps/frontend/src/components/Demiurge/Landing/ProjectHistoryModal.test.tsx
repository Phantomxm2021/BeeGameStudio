import { act, fireEvent, render, screen, waitFor, waitForElementToBeRemoved, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectHistoryModal } from './ProjectHistoryModal';

let projectList = [
  {
    id: 'project-1',
    name: 'Snake Game',
    created_at: 1710000000000,
  },
];
let projectStoreLoading = false;
let projectStoreHasMore = false;
let projectStoreTotal: number | null = null;
let deleteProject = vi.fn();
let deleteProjects = vi.fn();
let loadMoreProjects = vi.fn();
const { getCreditSummary } = vi.hoisted(() => ({
  getCreditSummary: vi.fn(),
}));
const { getProjectPage } = vi.hoisted(() => ({ getProjectPage: vi.fn() }));
const motionPreferences = vi.hoisted(() => ({ reduced: false }));

vi.mock('motion/react', async importOriginal => {
  const actual = await importOriginal<typeof import('motion/react')>();
  return { ...actual, useReducedMotion: () => motionPreferences.reduced };
});

vi.mock('../../../services/api', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api')>('../../../services/api');
  return { ...actual, api: { ...actual.api, getProjectPage } };
});

vi.mock('../../../store/projectStore', () => ({
  useProjectStore: () => ({
    projects: projectList,
    isLoading: projectStoreLoading,
    projectsHasMore: projectStoreHasMore,
    projectsTotal: projectStoreTotal,
    isLoadingMoreProjects: false,
    deleteProject,
    deleteProjects,
    loadMoreProjects,
  }),
}));

vi.mock('../../../store/systemStore', () => ({
  useSystemStore: (selector: (state: { hasPermission: () => boolean }) => unknown) => (
    selector({ hasPermission: () => false })
  ),
}));

vi.mock('../../../services/creditsApi', () => ({
  getCreditSummary,
}));

describe('ProjectHistoryModal permissions', () => {
  beforeEach(() => {
    motionPreferences.reduced = false;
    projectList = [
      {
        id: 'project-1',
        name: 'Snake Game',
        created_at: 1710000000000,
      },
    ];
    projectStoreLoading = false;
    projectStoreHasMore = false;
    projectStoreTotal = null;
    deleteProject = vi.fn();
    deleteProjects = vi.fn().mockResolvedValue({ deletedIds: [], failedIds: [] });
    loadMoreProjects = vi.fn().mockResolvedValue(undefined);
    getProjectPage.mockReset();
    getCreditSummary.mockReset();
    getCreditSummary.mockResolvedValue({
      entriesCount: 3,
      consumedCredits: 7,
      weightedTokens: 70_000,
    });
  });

  it('shows delete action for projects in the current account history', () => {
    getCreditSummary.mockReturnValue(new Promise(() => {}));

    render(
      <ProjectHistoryModal
        isOpen
        lang="en"
        onClose={vi.fn()}
        onSelectProject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText('More actions Snake Game'));

    expect(screen.getByRole('button', { name: 'Delete Project' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create Review Copy' })).not.toBeInTheDocument();
  });

  it('renders the project action menu above the dialog backdrop', () => {
    getCreditSummary.mockReturnValue(new Promise(() => {}));

    render(
      <ProjectHistoryModal
        isOpen
        lang="en"
        onClose={vi.fn()}
        onSelectProject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText('More actions Snake Game'));

    const deleteButton = screen.getByRole('button', { name: 'Delete Project' });
    expect(deleteButton.parentElement).toHaveClass('z-[260]');
  });

  it('keeps a fixed height for both populated and empty history states', () => {
    render(
      <ProjectHistoryModal
        isOpen
        lang="en"
        onClose={vi.fn()}
        onSelectProject={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog')).toHaveClass('h-[min(680px,calc(100dvh-2rem))]');
    expect(screen.getByRole('dialog')).toHaveClass('max-w-xl');
  });

  it('uses the pill-shaped shared input for project search', () => {
    render(
      <ProjectHistoryModal
        isOpen
        lang="en"
        onClose={vi.fn()}
        onSelectProject={vi.fn()}
      />,
    );

    expect(screen.getByRole('searchbox', { name: 'Search projects' }).parentElement).toHaveClass('rounded-full');
  });

  it('centers the empty state in the available history area', () => {
    projectList = [];

    render(
      <ProjectHistoryModal
        isOpen
        lang="en"
        onClose={vi.fn()}
        onSelectProject={vi.fn()}
      />,
    );

    const emptyState = screen.getByText('No projects for this account yet').parentElement;
    expect(emptyState).toHaveClass('h-full', 'items-center', 'justify-center');
  });

  it('does not hide delete action behind administrator permissions', () => {
    getCreditSummary.mockReturnValue(new Promise(() => {}));

    render(
      <ProjectHistoryModal
        isOpen
        lang="en"
        onClose={vi.fn()}
        onSelectProject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText('More actions Snake Game'));

    expect(screen.getByRole('button', { name: 'Delete Project' })).toBeInTheDocument();
  });

  it('hides the delete action and shows a loader while deletion is pending', async () => {
    let resolveDelete: (() => void) | undefined;
    deleteProject = vi.fn(() => new Promise<void>(resolve => {
      resolveDelete = resolve;
    }));

    render(
      <ProjectHistoryModal
        isOpen
        lang="en"
        onClose={vi.fn()}
        onSelectProject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText('More actions Snake Game'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Delete' }));

    expect(deleteProject).toHaveBeenCalledWith('project-1');
    expect(screen.queryByRole('button', { name: 'Confirm Delete' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('More actions Snake Game')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Deleting project' })).toBeInTheDocument();

    resolveDelete?.();
    await waitFor(() => {
      expect(screen.queryByRole('status', { name: 'Deleting project' })).not.toBeInTheDocument();
    });
  });

  it('shows realtime consumed credits for each project', async () => {
    render(
      <ProjectHistoryModal
        isOpen
        lang="en"
        onClose={vi.fn()}
        onSelectProject={vi.fn()}
      />,
    );

    const consumedCredits = await screen.findByText('7 credits');
    const creditRow = consumedCredits.closest('.type-caption-1');
    expect(consumedCredits).toBeInTheDocument();
    expect(consumedCredits).toHaveClass('text-foreground');
    expect(creditRow).toHaveClass('text-muted-foreground');
    expect(creditRow).not.toHaveClass('text-amber-200');
    expect(getCreditSummary).toHaveBeenCalledWith('project-1');
  });

  it('reuses loaded credit summaries when the history modal is reopened', async () => {
    const view = render(
      <ProjectHistoryModal
        isOpen
        lang="en"
        onClose={vi.fn()}
        onSelectProject={vi.fn()}
      />,
    );

    expect(await screen.findByText('7 credits')).toBeInTheDocument();
    expect(getCreditSummary).toHaveBeenCalledTimes(1);

    view.rerender(
      <ProjectHistoryModal
        isOpen={false}
        lang="en"
        onClose={vi.fn()}
        onSelectProject={vi.fn()}
      />,
    );
    view.rerender(
      <ProjectHistoryModal
        isOpen
        lang="en"
        onClose={vi.fn()}
        onSelectProject={vi.fn()}
      />,
    );

    expect(screen.getByText('7 credits')).toBeInTheDocument();
    await waitFor(() => expect(getCreditSummary).toHaveBeenCalledTimes(1));
  });

  it('limits initial credit summary requests to a small batch', async () => {
    projectList = Array.from({ length: 6 }, (_, index) => ({
      id: `project-${index + 1}`,
      name: `Project ${index + 1}`,
      created_at: 1710000000000 + index,
    }));
    getCreditSummary.mockReturnValue(new Promise(() => {}));

    render(
      <ProjectHistoryModal
        isOpen
        lang="en"
        onClose={vi.fn()}
        onSelectProject={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'History Projects' })).toBeInTheDocument();
    await waitFor(() => expect(getCreditSummary).toHaveBeenCalledTimes(4));
  });

  it('closes an open project menu when clicking elsewhere', () => {
    getCreditSummary.mockReturnValue(new Promise(() => {}));

    render(
      <ProjectHistoryModal
        isOpen
        lang="en"
        onClose={vi.fn()}
        onSelectProject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText('More actions Snake Game'));
    expect(screen.getByRole('button', { name: 'Delete Project' })).toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole('button', { name: 'Delete Project' })).not.toBeInTheDocument();
  });

  it('uses the project folder name in history when a root path is available', () => {
    getCreditSummary.mockReturnValue(new Promise(() => {}));
    projectList = [
      {
        id: 'project-1',
        name: 'Original Title',
        root_path: '/tmp/beegame-workspace/folder-title',
        created_at: 1710000000000,
      },
    ] as any;

    render(
      <ProjectHistoryModal
        isOpen
        lang="en"
        onClose={vi.fn()}
        onSelectProject={vi.fn()}
      />,
    );

    expect(screen.getByText('folder-title')).toBeInTheDocument();
    expect(screen.queryByText('Original Title')).not.toBeInTheDocument();
    expect(screen.getByLabelText('More actions folder-title')).toBeInTheDocument();
  });

  it('keeps credit row space reserved while credit summaries load', async () => {
    let resolveSummary: ((value: any) => void) | undefined;
    getCreditSummary.mockReturnValue(new Promise(resolve => {
      resolveSummary = resolve;
    }));

    render(
      <ProjectHistoryModal
        isOpen
        lang="en"
        onClose={vi.fn()}
        onSelectProject={vi.fn()}
      />,
    );

    const placeholder = document.querySelector('[aria-hidden="true"].h-3.w-20');
    expect(placeholder).toBeInTheDocument();
    expect(placeholder).toHaveAttribute('data-slot', 'skeleton');

    resolveSummary?.({
      entriesCount: 3,
      consumedCredits: 7,
      weightedTokens: 70_000,
    });

    await waitForElementToBeRemoved(() => document.querySelector('[aria-hidden="true"].h-3.w-20'));
    expect(screen.getByText('7 credits')).toBeInTheDocument();
  });

  it('uses full project row skeletons while project history is loading', () => {
    projectList = [];
    projectStoreLoading = true;

    render(
      <ProjectHistoryModal
        isOpen
        lang="en"
        onClose={vi.fn()}
        onSelectProject={vi.fn()}
      />,
    );

    expect(screen.queryByText('No projects for this account yet')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(10);
  });

  it('uses the semantic premium scrollbar on the scrollable history list', () => {
    getCreditSummary.mockReturnValue(new Promise(() => {}));
    render(
      <ProjectHistoryModal
        isOpen
        lang="en"
        onClose={vi.fn()}
        onSelectProject={vi.fn()}
      />,
    );

    expect(screen.getByText('Snake Game').closest('.scrollbar-premium')).toHaveClass('scrollbar-premium');
  });

  it('loads the next project page only when the history list reaches the bottom', () => {
    projectStoreHasMore = true;
    getCreditSummary.mockReturnValue(new Promise(() => {}));
    render(<ProjectHistoryModal isOpen lang="en" onClose={vi.fn()} onSelectProject={vi.fn()} />);

    fireEvent.scroll(screen.getByTestId('project-history-list'));

    expect(loadMoreProjects).toHaveBeenCalledOnce();
  });

  it('shows the exact account total without rendering all projects', () => {
    projectStoreTotal = 100;
    projectStoreHasMore = true;
    getCreditSummary.mockReturnValue(new Promise(() => {}));
    render(<ProjectHistoryModal isOpen lang="en" onClose={vi.fn()} onSelectProject={vi.fn()} />);

    expect(screen.getByText('100 projects')).toBeInTheDocument();
    expect(screen.getByText('Snake Game')).toBeInTheDocument();
  });

  it('searches projects on the server instead of filtering the first loaded page', async () => {
    getProjectPage.mockResolvedValue({
      items: [{ id: 'older-project', name: 'Older Game', created_at: 1700000000000 }],
      hasMore: false,
    });
    getCreditSummary.mockReturnValue(new Promise(() => {}));
    render(<ProjectHistoryModal isOpen lang="en" onClose={vi.fn()} onSelectProject={vi.fn()} />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search projects' }), { target: { value: 'Older' } });

    await waitFor(() => expect(getProjectPage).toHaveBeenCalledWith(0, 'Older'));
    expect(await screen.findByText('Older Game')).toBeInTheDocument();
    expect(screen.queryByText('Snake Game')).not.toBeInTheDocument();
  });

  it('shows a retry instead of treating a failed search as no matches', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      getProjectPage.mockRejectedValueOnce(new Error('Temporary failure')).mockResolvedValueOnce({
        items: [{ id: 'older-project', name: 'Older Game', created_at: 1700000000000 }],
        hasMore: false,
      });
      getCreditSummary.mockReturnValue(new Promise(() => {}));
      render(<ProjectHistoryModal isOpen lang="en" onClose={vi.fn()} onSelectProject={vi.fn()} />);

      fireEvent.change(screen.getByRole('searchbox', { name: 'Search projects' }), { target: { value: 'Older' } });
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not load projects.');
      expect(screen.queryByText('No matching projects')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(await screen.findByText('Older Game')).toBeInTheDocument();
    } finally {
      log.mockRestore();
    }
  });

  it('places a background-free Edit beside the title and toggles circular multi-selection', async () => {
    const onSelectProject = vi.fn();
    render(<ProjectHistoryModal isOpen lang="en" onClose={vi.fn()} onSelectProject={onSelectProject} />);
    const edit = screen.getByRole('button', { name: 'Edit', exact: true });
    expect(edit).toHaveClass('bg-transparent');
    expect(edit.parentElement).toContainElement(screen.getByRole('heading', { name: 'History Projects' }));
    expect(await screen.findByText('7 credits')).toBeInTheDocument();

    fireEvent.click(edit);
    const checkbox = screen.getByRole('checkbox', { name: 'Select Snake Game' });
    expect(checkbox).toHaveClass('rounded-full');
    const outgoingDetails = screen.getByLabelText('More actions Snake Game').closest('[inert]');
    expect(outgoingDetails).toHaveAttribute('aria-hidden', 'true');
    await waitFor(() => expect(screen.queryByText('7 credits')).not.toBeInTheDocument());
    expect(screen.queryByLabelText('More actions Snake Game')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
    fireEvent.click(screen.getByText('Snake Game'));
    expect(checkbox).toBeChecked();
    expect(onSelectProject).not.toHaveBeenCalled();
    // Clicking the checkbox must not also toggle its enclosing row.
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByText('7 credits')).toBeInTheDocument();
  });

  it('selects only loaded projects and does not silently select newly loaded rows', () => {
    projectStoreTotal = 100;
    const props = { isOpen: true, lang: 'en' as const, onClose: vi.fn(), onSelectProject: vi.fn() };
    const view = render(<ProjectHistoryModal {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select loaded' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    projectList = [...projectList, { id: 'project-2', name: 'Racing Game', created_at: 1710000000000 }];
    view.rerender(<ProjectHistoryModal {...props} />);
    expect(screen.getByRole('checkbox', { name: 'Select Racing Game' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Select loaded' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Deselect all' }));
    expect(screen.getByText('0 selected')).toBeInTheDocument();
  });

  it('clears selection on search changes and selects only loaded search results', async () => {
    getProjectPage.mockResolvedValue({ items: [{ id: 'older-project', name: 'Older Game', created_at: 1700000000000 }], hasMore: false });
    render(<ProjectHistoryModal isOpen lang="en" onClose={vi.fn()} onSelectProject={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Snake Game' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Older' } });
    expect(screen.getByText('0 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
    expect(await screen.findByRole('checkbox', { name: 'Select Older Game' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Select loaded' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }));
    const confirm = screen.getByRole('dialog', { name: 'Delete this project?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete', exact: true }));
    await waitFor(() => expect(deleteProjects).toHaveBeenCalledWith(['older-project']));
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it('confirms with only a title/subtitle and capsule buttons; cancellation does not delete', async () => {
    const onClose = vi.fn();
    render(<ProjectHistoryModal isOpen lang="zh" onClose={onClose} onSelectProject={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 Snake Game' }));
    fireEvent.click(screen.getByRole('button', { name: '删除', exact: true }));
    const confirm = screen.getByRole('dialog', { name: '删除这 1 个项目？' });
    expect(within(confirm).queryByText('Snake Game')).not.toBeInTheDocument();
    expect(within(confirm).getByText('这些项目将从历史列表中删除，当前不提供撤销。')).toBeInTheDocument();
    expect(within(confirm).getByRole('button', { name: '删除', exact: true })).toHaveClass('rounded-full');
    const cancel = within(confirm).getByRole('button', { name: '取消' });
    expect(cancel).toHaveClass('rounded-full');
    fireEvent.click(cancel);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '删除这 1 个项目？' })).not.toBeInTheDocument());
    expect(deleteProjects).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: '选择 Snake Game' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '删除', exact: true }));
    fireEvent.keyDown(screen.getByRole('dialog', { name: '删除这 1 个项目？' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '删除这 1 个项目？' })).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: '选择 Snake Game' })).toBeChecked();
  });

  it('locks controls during deletion, avoids duplicate submissions, and retains failed selections', async () => {
    projectList = [...projectList, { id: 'project-2', name: 'Racing Game', created_at: 1710000000000 }];
    let finish!: (result: { deletedIds: string[]; failedIds: string[] }) => void;
    deleteProjects = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const onClose = vi.fn();
    render(<ProjectHistoryModal isOpen lang="en" onClose={onClose} onSelectProject={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select loaded' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }));
    const confirm = screen.getByRole('dialog', { name: 'Delete these 2 projects?' });
    const execute = within(confirm).getByRole('button', { name: 'Delete', exact: true });
    fireEvent.click(execute);
    fireEvent.click(execute);
    expect(deleteProjects).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled());
    expect(screen.getByRole('searchbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Deleting…');
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'History Projects' }), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    finish({ deletedIds: ['project-1'], failedIds: ['project-2'] });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('1 could not be deleted'));
    expect(screen.getByRole('checkbox', { name: 'Select Racing Game' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Snake Game' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled();
  });

  it('leaves edit mode with Escape without closing history and resets on reopening', () => {
    const props = { isOpen: true, lang: 'en' as const, onClose: vi.fn(), onSelectProject: vi.fn() };
    const view = render(<ProjectHistoryModal {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Snake Game' }));
    fireEvent.keyDown(screen.getByRole('checkbox'), { key: 'a', metaKey: true });
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('checkbox'));
    view.rerender(<ProjectHistoryModal {...props} isOpen={false} />);
    view.rerender(<ProjectHistoryModal {...props} />);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('reveals one content surface without delaying input or remounting rows on edit', () => {
    render(<ProjectHistoryModal isOpen lang="en" onClose={vi.fn()} onSelectProject={vi.fn()} />);
    const content = screen.getByTestId('project-history-content');
    const name = screen.getByText('Snake Game');
    expect(content.style.transform).toContain('translateY(6px)');
    const edit = screen.getByRole('button', { name: 'Edit' });
    expect(edit).toBeEnabled();
    expect(content).not.toHaveAttribute('inert');
    fireEvent.click(edit);
    expect(screen.getByTestId('project-history-content')).toBe(content);
    expect(screen.getByText('Snake Game')).toBe(name);
    expect(screen.getByRole('checkbox')).toBeEnabled();
  });

  it('gates outgoing controls and reverses rapid edit toggles without duplicate selections', () => {
    render(<ProjectHistoryModal isOpen lang="en" onClose={vi.fn()} onSelectProject={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(checkbox.closest('[inert]')).toHaveAttribute('aria-hidden', 'true');
    expect(checkbox).toBeDisabled();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByTestId('project-history-selection-actions').firstElementChild).toHaveAttribute('inert');
    expect(screen.queryByRole('button', { name: 'Select loaded' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByRole('checkbox')).toBeEnabled();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
  });

  it('softens asynchronous loaded content without replaying the dialog entrance', () => {
    projectList = [];
    projectStoreLoading = true;
    const props = { isOpen: true, lang: 'en' as const, onClose: vi.fn(), onSelectProject: vi.fn() };
    const view = render(<ProjectHistoryModal {...props} />);
    const content = screen.getByTestId('project-history-content');
    projectList = [{ id: 'project-1', name: 'Snake Game', created_at: 1710000000000 }];
    projectStoreLoading = false;
    view.rerender(<ProjectHistoryModal {...props} />);
    expect(screen.getByTestId('project-history-content')).toBe(content);
    const incoming = screen.getByText('Snake Game').closest('[data-testid="project-history-list-surface"]') as HTMLElement;
    expect(incoming.style.opacity).toBe('0');
    expect(incoming.style.transform).toContain('translateY(3px)');
    expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled();
  });

  it('uses opacity-only content feedback and immediate layout with reduced motion', () => {
    motionPreferences.reduced = true;
    render(<ProjectHistoryModal isOpen lang="en" onClose={vi.fn()} onSelectProject={vi.fn()} />);
    expect(screen.getByTestId('project-history-content').style.transform).not.toContain('translate');
    expect(screen.getByRole('dialog')).toHaveClass('motion-reduce:data-[starting-style]:scale-100');
    expect(screen.getByTestId('project-history-window').style.transitionProperty).toBe('opacity');
    expect(screen.getByTestId('project-history-window').style.transitionDuration).toBe('100ms');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox.parentElement?.parentElement?.style.transform).not.toContain('translate');
    expect(screen.getByTestId('project-history-selection-actions').style.height).toBe('auto');
    expect(screen.getByRole('button', { name: 'Select loaded' })).toBeEnabled();
  });

  it('retains an inert, unchanged window until close finishes and safely reverses an interrupted close', async () => {
    // JSDOM has no CSS animation engine. Hold the platform completion promise
    // to verify Dialog retention rather than introducing an application timer.
    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'getAnimations');
    let finishClose!: () => void;
    let closingObserved = false;
    const finished = new Promise<void>(resolve => { finishClose = resolve; });
    Object.defineProperty(Element.prototype, 'getAnimations', {
      configurable: true,
      value: function (this: Element) {
        if (!this.hasAttribute('data-ending-style')) return [];
        closingObserved = true;
        return [{ finished, pending: true, playState: 'running' }];
      },
    });
    try {
      getProjectPage.mockResolvedValue({ items: projectList, hasMore: false });
      const props = { isOpen: false, lang: 'en' as const, onClose: vi.fn(), onSelectProject: vi.fn() };
      const view = render(<ProjectHistoryModal {...props} />);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      view.rerender(<ProjectHistoryModal {...props} isOpen />);
      const popup = screen.getByTestId('project-history-window');
      expect(popup.style.transitionDuration).toBe('220ms');
      expect(popup.style.transitionProperty).toBe('opacity, scale, translate');
      expect(document.querySelector('.project-history-backdrop')).toHaveStyle({ transitionDuration: '220ms' });
      await waitFor(() => expect(popup).not.toHaveAttribute('data-starting-style'));
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Snake' } });
      expect(await screen.findByText('Snake Game')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      fireEvent.click(await screen.findByRole('checkbox'));
      view.rerender(<ProjectHistoryModal {...props} />);
      await waitFor(() => expect(closingObserved).toBe(true));
      expect(popup).toBeInTheDocument();
      expect(popup).toHaveAttribute('inert');
      expect(popup).toHaveAttribute('aria-hidden', 'true');
      expect(popup.style.transitionDuration).toBe('160ms');
      expect(popup.querySelector('input[type="search"]')).toHaveValue('Snake');
      expect(popup.querySelector('input[type="checkbox"]')).toBeChecked();
      expect(document.querySelector('.project-history-backdrop')).toHaveStyle({ transitionDuration: '160ms' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      fireEvent.scroll(popup.querySelector('[data-testid="project-history-list"]')!);
      expect(loadMoreProjects).not.toHaveBeenCalled();

      view.rerender(<ProjectHistoryModal {...props} isOpen />);
      expect(screen.getByTestId('project-history-window')).toBe(popup);
      expect(popup).not.toHaveAttribute('inert');
      expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled();
      expect(screen.getByRole('searchbox')).toHaveValue('');
      await act(async () => { finishClose(); });
      expect(screen.getByRole('dialog', { name: 'History Projects' })).toBeInTheDocument();
      view.rerender(<ProjectHistoryModal {...props} />);
      await waitFor(() => expect(screen.queryByTestId('project-history-window')).not.toBeInTheDocument());
      expect(document.querySelector('.project-history-backdrop')).not.toBeInTheDocument();
    } finally {
      if (original) Object.defineProperty(Element.prototype, 'getAnimations', original);
      else Reflect.deleteProperty(Element.prototype, 'getAnimations');
    }
  });

  it('explains empty history for the current account', () => {
    projectList = [];

    render(
      <ProjectHistoryModal
        isOpen
        lang="en"
        onClose={vi.fn()}
        onSelectProject={vi.fn()}
      />,
    );

    expect(screen.getByText('No projects for this account yet')).toBeInTheDocument();
    expect(screen.getByText(/older projects still exist/)).toBeInTheDocument();
  });
});
