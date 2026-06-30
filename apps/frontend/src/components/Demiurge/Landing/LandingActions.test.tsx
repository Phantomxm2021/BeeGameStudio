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
        currentUserEmail="bee@example.com"
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
        expect(screen.queryByRole('menuitem', { name: '管理控制台' })).not.toBeInTheDocument();
        expect(screen.getByText('Bee User')).toBeInTheDocument();
        expect(screen.getByText('bee@example.com')).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: '个人主页' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: '系统设置' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: '历史项目' })).toBeInTheDocument();
    });

    it('keeps platform administration inside settings instead of exposing a separate menu item', async () => {
        const onToggleSettings = vi.fn();
        renderActions({
            onToggleSettings,
        });

        await userEvent.click(screen.getByRole('button', { name: '用户菜单' }));
        expect(screen.queryByRole('menuitem', { name: '管理控制台' })).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('menuitem', { name: '系统设置' }));

        expect(onToggleSettings).toHaveBeenCalledTimes(1);
    });
});
