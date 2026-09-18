import { fireEvent, render, screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react';
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
let deleteProject = vi.fn();
let createReviewCopy = vi.fn();
const { getCreditSummary } = vi.hoisted(() => ({
  getCreditSummary: vi.fn(),
}));

vi.mock('../../../store/projectStore', () => ({
  useProjectStore: () => ({
    projects: projectList,
    isLoading: projectStoreLoading,
    deleteProject,
    createReviewCopy,
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
    projectList = [
      {
        id: 'project-1',
        name: 'Snake Game',
        created_at: 1710000000000,
      },
    ];
    projectStoreLoading = false;
    deleteProject = vi.fn();
    createReviewCopy = vi.fn();
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
    expect(screen.getByRole('button', { name: 'Create Review Copy' })).toBeInTheDocument();
  });

  it('creates and selects one review copy while preventing duplicate requests', async () => {
    let resolveCopy: ((project: any) => void) | undefined;
    createReviewCopy = vi.fn(() => new Promise(resolve => {
      resolveCopy = resolve;
    }));
    const onSelectProject = vi.fn();
    const onClose = vi.fn();

    render(
      <ProjectHistoryModal
        isOpen
        lang="en"
        onClose={onClose}
        onSelectProject={onSelectProject}
      />,
    );

    fireEvent.click(screen.getByLabelText('More actions Snake Game'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Review Copy' }));
    expect(createReviewCopy).toHaveBeenCalledTimes(1);
    expect(createReviewCopy).toHaveBeenCalledWith('project-1');
    expect(screen.getByRole('status', { name: 'Creating review copy' })).toBeInTheDocument();

    resolveCopy?.({ id: 'copy-1', name: 'Snake Game Review Copy', created_at: 2 });
    await waitFor(() => {
      expect(onSelectProject).toHaveBeenCalledWith('copy-1');
      expect(onClose).toHaveBeenCalledTimes(1);
    });
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

    const placeholder = document.querySelector('[aria-hidden="true"].h-3.w-32');
    expect(placeholder).toBeInTheDocument();
    expect(placeholder).toHaveAttribute('data-slot', 'skeleton');

    resolveSummary?.({
      entriesCount: 3,
      consumedCredits: 7,
      weightedTokens: 70_000,
    });

    await waitForElementToBeRemoved(() => document.querySelector('[aria-hidden="true"].h-3.w-32'));
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
