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

describe('LandingActions user menu', () => {
    it('keeps administration out of the user account menu', async () => {
        renderActions();

        await userEvent.click(screen.getByRole('button', { name: '用户菜单' }));

        expect(screen.queryByRole('menuitem', { name: '管理员' })).not.toBeInTheDocument();
        expect(screen.queryByRole('menuitem', { name: '系统管理' })).not.toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: '个人主页' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: '系统设置' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: '历史项目' })).toBeInTheDocument();
    });

    it('shows system management only when the signed-in user has deployment permissions', async () => {
        const onToggleSystemManagement = vi.fn();
        renderActions({
            canOpenSystemManagement: true,
            onToggleSystemManagement,
        });

        await userEvent.click(screen.getByRole('button', { name: '用户菜单' }));
        await userEvent.click(screen.getByRole('menuitem', { name: '系统管理' }));

        expect(onToggleSystemManagement).toHaveBeenCalledTimes(1);
    });
});
