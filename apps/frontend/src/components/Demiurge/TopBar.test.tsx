import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TopBar } from './TopBar';

const renderTopBar = (props?: Partial<React.ComponentProps<typeof TopBar>>) => render(
    <TopBar
        projectName="Project One"
        lang="en"
        status="running"
        progress={25}
        tokens={150}
        isSyncing={false}
        onRename={vi.fn()}
        mode="beegame"
        phaseLabel="Implementation"
        {...props}
    />,
);

describe('TopBar localized BeeGame labels', () => {
    it('shows Running instead of BeeGame Running in BeeGame mode', () => {
        renderTopBar();

        expect(screen.getByText('Running')).toBeInTheDocument();
        expect(screen.queryByText('BeeGame Running')).not.toBeInTheDocument();
    });

    it('localizes BeeGame status and phase heading', () => {
        renderTopBar({
            lang: 'zh',
            phaseLabel: '实现构建',
        });

        expect(screen.getByText('运行中')).toBeInTheDocument();
        expect(screen.getByText('阶段')).toBeInTheDocument();
        expect(screen.getByText('实现构建 · 25%')).toBeInTheDocument();
    });
});
