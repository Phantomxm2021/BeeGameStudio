import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RightSidebar } from './RightSidebar';
import { api } from '../../services/api';

vi.mock('../../store/systemStore', () => ({
    useSystemStore: () => ({
        tasks: [],
    }),
}));

vi.mock('../../services/api', () => ({
    api: {
        getArtifacts: vi.fn().mockResolvedValue([]),
        getArtifactReviewStatus: vi.fn().mockResolvedValue({}),
        getArtifactContent: vi.fn().mockResolvedValue(''),
        downloadProjectPackage: vi.fn().mockResolvedValue({ blob: new Blob(['zip']), filename: 'project.zip' }),
        getProjectAssets: vi.fn().mockResolvedValue({ version: 1, slots: [] }),
        uploadProjectAsset: vi.fn().mockResolvedValue({
            manifest: { version: 1, slots: [] },
            message: 'Integrate uploaded asset',
        }),
    },
}));

vi.mock('../../services/beeGameAdapter', () => ({
    isBeeGameProjectPackageArtifactId: (id: string) => id.startsWith('beegame-project-package:'),
}));

describe('RightSidebar tabs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows only collaboration and artifacts tabs', () => {
        render(
            <RightSidebar
                projectId="proj_1"
                lang="zh"
                messages={[]}
                progress={0}
                onSendMessage={vi.fn()}
                isLoading={false}
                waitingApproval={{
                    kind: 'none',
                    isBlockingChat: false,
                    isWaitingStatus: false,
                    message: '',
                    placeholder: 'Type...',
                }}
            />
        );

        expect(screen.getByRole('button', { name: '团队协作' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '交付产物' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '运行时' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '任务看板' })).not.toBeInTheDocument();
    });

    it('does not send chat input while the runtime is busy', async () => {
        const user = userEvent.setup();
        const onSendMessage = vi.fn();

        render(
            <RightSidebar
                projectId="proj_1"
                lang="zh"
                messages={[]}
                progress={0}
                onSendMessage={onSendMessage}
                isLoading={false}
                isRuntimeBusy={true}
                waitingApproval={{
                    kind: 'none',
                    isBlockingChat: false,
                    isWaitingStatus: false,
                    message: '',
                    placeholder: 'Type...',
                }}
            />
        );

        const input = screen.getByPlaceholderText(/AI 正在处理/i);
        expect(input).toBeDisabled();

        await user.click(screen.getByRole('button', { name: '团队协作' }));
        expect(onSendMessage).not.toHaveBeenCalled();
    });

    it('removes the minimize affordance in BeeGame mode', () => {
        render(
            <RightSidebar
                projectId="proj_1"
                lang="zh"
                messages={[]}
                progress={0}
                onSendMessage={vi.fn()}
                isLoading={false}
                waitingApproval={{
                    kind: 'none',
                    isBlockingChat: false,
                    isWaitingStatus: false,
                    message: '',
                    placeholder: 'Type...',
                }}
                variant="beegame"
            />
        );

        expect(screen.getByRole('button', { name: '协作流' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '最小化聊天' })).not.toBeInTheDocument();
    });

    it('uploads assets without automatically sending an integration prompt', async () => {
        const user = userEvent.setup();
        const onSendMessage = vi.fn();
        vi.mocked(api.getProjectAssets).mockResolvedValue({
            version: 1,
            project_target: { kind: 'web', engine: 'react', integration_mode: 'filesystem' },
            slots: [{
                id: 'bgm_game',
                name: 'Game BGM',
                type: 'audio',
                purpose: 'Game background music',
                status: 'uploaded',
                uploaded_files: ['client/public/audio/bgm/game.mp3'],
            }],
        });
        vi.mocked(api.uploadProjectAsset).mockResolvedValue({
            manifest: {
                version: 1,
                project_target: { kind: 'web', engine: 'react', integration_mode: 'filesystem' },
                slots: [{
                    id: 'bgm_game',
                    name: 'Game BGM',
                    type: 'audio',
                    purpose: 'Game background music',
                    status: 'uploaded',
                    uploaded_files: ['client/public/audio/bgm/game.mp3'],
                }],
            },
            message: 'Integrate uploaded asset',
        });

        render(
            <RightSidebar
                projectId="proj_1"
                lang="zh"
                messages={[]}
                progress={0}
                onSendMessage={onSendMessage}
                isLoading={false}
                waitingApproval={{
                    kind: 'none',
                    isBlockingChat: false,
                    isWaitingStatus: false,
                    message: '',
                    placeholder: 'Type...',
                }}
                variant="beegame"
            />
        );

        await user.click(screen.getByRole('button', { name: '资源' }));
        const file = new File(['audio'], 'game.mp3', { type: 'audio/mpeg' });
        await user.upload(await screen.findByLabelText('上传替换'), file);

        expect(api.uploadProjectAsset).toHaveBeenCalledWith('proj_1', 'bgm_game', file);
        expect(onSendMessage).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: '让 BeeGame 集成' }));
        expect(onSendMessage).toHaveBeenCalledWith('Integrate uploaded asset', 'asset_integration');
    });
});
