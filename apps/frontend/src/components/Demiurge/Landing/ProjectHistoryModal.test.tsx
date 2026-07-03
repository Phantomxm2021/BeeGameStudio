import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectHistoryModal } from './ProjectHistoryModal';

let projectList = [
  {
    id: 'project-1',
    name: 'Snake Game',
    created_at: 1710000000000,
  },
];
const { getCreditSummary } = vi.hoisted(() => ({
  getCreditSummary: vi.fn(),
}));

vi.mock('../../../store/projectStore', () => ({
  useProjectStore: () => ({
    projects: projectList,
    deleteProject: vi.fn(),
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
    getCreditSummary.mockReset();
    getCreditSummary.mockResolvedValue({
      entriesCount: 3,
      reservedCredits: 20,
      settledCredits: 7,
      refundedCredits: 8,
      outstandingReservedCredits: 5,
      weightedTokens: 70_000,
    });
  });

  it('shows delete action for projects in the current account history', () => {
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

  it('does not hide delete action behind administrator permissions', () => {
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

  it('shows settled and reserved credits for each project', async () => {
    render(
      <ProjectHistoryModal
        isOpen
        lang="en"
        onClose={vi.fn()}
        onSelectProject={vi.fn()}
      />,
    );

    expect(await screen.findByText('7 credits')).toBeInTheDocument();
    expect(screen.getByText('5 reserved')).toBeInTheDocument();
    expect(getCreditSummary).toHaveBeenCalledWith('project-1');
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
