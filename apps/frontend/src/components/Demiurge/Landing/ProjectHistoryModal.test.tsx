import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectHistoryModal } from './ProjectHistoryModal';

let canDeleteProject = true;
const { getCreditSummary } = vi.hoisted(() => ({
  getCreditSummary: vi.fn(),
}));

vi.mock('../../../store/projectStore', () => ({
  useProjectStore: () => ({
    projects: [
      {
        id: 'project-1',
        name: 'Snake Game',
        created_at: 1710000000000,
      },
    ],
    deleteProject: vi.fn(),
  }),
}));

vi.mock('../../../store/systemStore', () => ({
  useSystemStore: (selector: (state: { hasPermission: (permission: string) => boolean }) => unknown) => (
    selector({
      hasPermission: (permission: string) => (
        permission === 'project.delete' ? canDeleteProject : false
      ),
    })
  ),
}));

vi.mock('../../../services/creditsApi', () => ({
  getCreditSummary,
}));

describe('ProjectHistoryModal permissions', () => {
  beforeEach(() => {
    canDeleteProject = true;
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

  it('shows delete action when the current user can delete projects', () => {
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

  it('hides delete action when the current user cannot delete projects', () => {
    canDeleteProject = false;

    render(
      <ProjectHistoryModal
        isOpen
        lang="en"
        onClose={vi.fn()}
        onSelectProject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText('More actions Snake Game'));

    expect(screen.queryByRole('button', { name: 'Delete Project' })).not.toBeInTheDocument();
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
});
