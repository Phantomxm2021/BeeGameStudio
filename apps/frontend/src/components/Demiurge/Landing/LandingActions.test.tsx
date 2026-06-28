import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LandingActions } from './LandingActions';

const renderActions = (props: Partial<Parameters<typeof LandingActions>[0]> = {}) => render(
    <LandingActions
        lang="zh"
        isTransitioning={false}
        isSettingsOpen={false}
        isHistoryOpen={false}
        currentUserId="user-1"
        currentUserDisplayName="Bee User"
        onToggleSettings={vi.fn()}
        onToggleHistory={vi.fn()}
        onOpenProfile={vi.fn()}
        onOpenLogin={vi.fn()}
        {...props}
    />,
);

describe('LandingActions admin entry', () => {
    it('does not show admin controls for signed-in non-admin users', async () => {
        renderActions({ canOpenAdmin: false, onToggleAdmin: vi.fn() });

        await userEvent.click(screen.getByRole('button', { name: '用户菜单' }));

        expect(screen.queryByRole('menuitem', { name: '管理员' })).not.toBeInTheDocument();
    });

    it('shows admin controls only when explicitly allowed', async () => {
        renderActions({ canOpenAdmin: true, onToggleAdmin: vi.fn() });

        await userEvent.click(screen.getByRole('button', { name: '用户菜单' }));

        expect(screen.getByRole('menuitem', { name: '管理员' })).toBeInTheDocument();
    });
});
