import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

    afterEach(() => {
        vi.useRealTimers();
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

    it('defaults chat thinking off and sends the selected chat thinking mode', async () => {
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

        const thinkingSelect = screen.getByLabelText('思考') as HTMLSelectElement;
        expect(thinkingSelect).toHaveValue('disabled');

        await user.type(screen.getByPlaceholderText('Type...'), '先修复渲染问题');
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        expect(onSendMessage).toHaveBeenLastCalledWith(
            '先修复渲染问题',
            undefined,
            [],
            'disabled',
        );

        await user.selectOptions(thinkingSelect, 'enabled');
        await user.type(screen.getByPlaceholderText('Type...'), '深入分析性能问题');
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        expect(onSendMessage).toHaveBeenLastCalledWith(
            '深入分析性能问题',
            undefined,
            [],
            'enabled',
        );
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

    it('sends an uploaded screenshot attachment without requiring text', async () => {
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

        const image = new File(['png-bytes'], 'screen.png', { type: 'image/png' });
        await user.upload(screen.getByLabelText('Attach image'), image);

        await waitFor(() => expect(screen.getByAltText('screen.png')).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: 'Send message' }));

        expect(onSendMessage).toHaveBeenCalledWith('', undefined, [
            expect.objectContaining({
                type: 'image',
                mediaType: 'image/png',
                filename: 'screen.png',
            }),
        ], 'disabled');
        expect(onSendMessage.mock.calls[0][2][0].data).toEqual(expect.any(String));
    });

    it('accepts pasted screenshot attachments in the chat composer', async () => {
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

        const image = new File(['png-bytes'], 'pasted-screen.png', { type: 'image/png' });
        fireEvent.paste(screen.getByPlaceholderText('Type...'), {
            clipboardData: {
                files: [image],
            },
        });

        await waitFor(() => expect(screen.getByAltText('pasted-screen.png')).toBeInTheDocument());
    });

    it('accepts pasted screenshots exposed as clipboard items', async () => {
        const onSendMessage = vi.fn();
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

        const image = new File(['png-bytes'], 'clipboard-screen.png', { type: 'image/png' });
        fireEvent.paste(screen.getByPlaceholderText('Type...'), {
            clipboardData: {
                files: [],
                items: [{
                    kind: 'file',
                    type: 'image/png',
                    getAsFile: () => image,
                }],
            },
        });

        await waitFor(() => expect(screen.getByAltText('clipboard-screen.png')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        expect(onSendMessage).toHaveBeenCalledWith('', undefined, [
            expect.objectContaining({
                type: 'image',
                mediaType: 'image/png',
                filename: 'clipboard-screen.png',
            }),
        ], 'disabled');
    });

    it('deduplicates pasted screenshots exposed through both clipboard files and items', async () => {
        const onSendMessage = vi.fn();
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

        const image = new File(['png-bytes'], 'duplicated-screen.png', { type: 'image/png' });
        fireEvent.paste(screen.getByPlaceholderText('Type...'), {
            clipboardData: {
                files: [image],
                items: [{
                    kind: 'file',
                    type: 'image/png',
                    getAsFile: () => image,
                }],
            },
        });

        await waitFor(() => expect(screen.getAllByAltText('duplicated-screen.png')).toHaveLength(1));
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        expect(onSendMessage.mock.calls[0][2]).toHaveLength(1);
    });

    it('deduplicates pasted screenshots with identical image data even when clipboard file metadata differs', async () => {
        const onSendMessage = vi.fn();
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

        const clipboardFile = new File(['same-png-bytes'], 'clipboard.png', {
            type: 'image/png',
            lastModified: 1,
        });
        const itemFile = new File(['same-png-bytes'], 'image.png', {
            type: 'image/png',
            lastModified: 2,
        });
        fireEvent.paste(screen.getByPlaceholderText('Type...'), {
            clipboardData: {
                files: [clipboardFile],
                items: [{
                    kind: 'file',
                    type: 'image/png',
                    getAsFile: () => itemFile,
                }],
            },
        });

        await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(1));
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        expect(onSendMessage.mock.calls[0][2]).toHaveLength(1);
    });

    it('deduplicates the same pasted screenshot if duplicate paste events append it twice', async () => {
        const onSendMessage = vi.fn();
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

        const pasteTarget = screen.getByPlaceholderText('Type...');
        const image = new File(['same-png-bytes'], 'pasted-again.png', { type: 'image/png' });
        fireEvent.paste(pasteTarget, {
            clipboardData: {
                files: [image],
            },
        });
        fireEvent.paste(pasteTarget, {
            clipboardData: {
                files: [image],
            },
        });

        await waitFor(() => expect(screen.getAllByAltText('pasted-again.png')).toHaveLength(1));
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        expect(onSendMessage.mock.calls[0][2]).toHaveLength(1);
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

    it('shows an empty asset contract message when a restored project has no manifest', async () => {
        const user = userEvent.setup();
        vi.mocked(api.getProjectAssets).mockResolvedValue({ version: 1, slots: [] });

        render(
            <RightSidebar
                projectId="proj_empty_assets"
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

        await user.click(screen.getByRole('button', { name: '资源' }));

        expect(await screen.findByText(/还没有资源合同/)).toBeInTheDocument();
    });

    it('keeps the existing asset contract visible when a refresh request fails', async () => {
        vi.useFakeTimers();
        vi.mocked(api.getProjectAssets)
            .mockResolvedValueOnce({
                version: 1,
                slots: [{
                    id: 'bgm_game',
                    name: 'Game BGM',
                    type: 'audio',
                    purpose: 'Game background music',
                    status: 'uploaded',
                }],
            })
            .mockRejectedValueOnce(new Error('Session not found'));

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

        fireEvent.click(screen.getByRole('button', { name: '资源' }));
        await act(async () => {
            await Promise.resolve();
        });
        expect(screen.getByText('Game BGM')).toBeInTheDocument();

        await act(async () => {
            vi.advanceTimersByTime(5000);
            await Promise.resolve();
        });

        expect(screen.getByText('Game BGM')).toBeInTheDocument();
        expect(screen.queryByText(/还没有资源合同/)).not.toBeInTheDocument();
        vi.useRealTimers();
    });

    it('clears the previous project asset manifest when switching projects', async () => {
        const user = userEvent.setup();
        vi.mocked(api.getProjectAssets).mockImplementation(async (projectId: string) => {
            if (projectId === 'proj_1') {
                return {
                    version: 1,
                    slots: [{
                        id: 'bgm_game',
                        name: 'Game BGM',
                        type: 'audio',
                        purpose: 'Game background music',
                        status: 'uploaded',
                    }],
                };
            }
            return { version: 1, slots: [] };
        });
        const baseProps = {
            lang: 'zh' as const,
            messages: [],
            progress: 0,
            onSendMessage: vi.fn(),
            isLoading: false,
            waitingApproval: {
                kind: 'none' as const,
                isBlockingChat: false,
                isWaitingStatus: false,
                message: '',
                placeholder: 'Type...',
            },
            variant: 'beegame' as const,
        };

        const { rerender } = render(
            <RightSidebar
                {...baseProps}
                projectId="proj_1"
            />
        );

        await user.click(screen.getByRole('button', { name: '资源' }));
        expect(await screen.findByText('Game BGM')).toBeInTheDocument();

        rerender(
            <RightSidebar
                {...baseProps}
                projectId="proj_2"
            />
        );

        await waitFor(() => expect(screen.queryByText('Game BGM')).not.toBeInTheDocument());
        expect(api.getProjectAssets).toHaveBeenCalledWith('proj_2');
    });
});
