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
        getProjectAssets: vi.fn().mockResolvedValue({ version: 5, requirements: [] }),
        uploadProjectAsset: vi.fn().mockResolvedValue({
            manifest: { version: 5, requirements: [] },
            message: 'Integrate uploaded asset',
        }),
        requestProjectAction: vi.fn().mockResolvedValue({ task_id: 'beegame_proj_1', state: 'running' }),
    },
}));

vi.mock('../../services/beeGameAdapter', () => ({
    isBeeGameProjectPackageArtifactId: (id: string) => id.startsWith('beegame-project-package:'),
}));

const getChatInput = () => screen.getByRole('textbox') as HTMLTextAreaElement;

describe('RightSidebar tabs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows the canonical collaboration, deliverables, and assets tabs', () => {
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

        expect(screen.getByRole('button', { name: '协作流' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^交付物/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '资源' })).toBeInTheDocument();
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

        await user.click(screen.getByRole('button', { name: '协作流' }));
        expect(onSendMessage).not.toHaveBeenCalled();
    });

    it('does not expose Claude runtime thinking controls in the project chat', async () => {
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
            />
        );

        expect(screen.queryByLabelText('思考')).not.toBeInTheDocument();
        await waitFor(() => expect(getChatInput()).toHaveStyle({ height: '56px' }));

        await user.type(getChatInput(), '先修复渲染问题');
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        expect(onSendMessage).toHaveBeenLastCalledWith(
            '先修复渲染问题',
            [],
            undefined,
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
            />
        );

        const image = new File(['png-bytes'], 'screen.png', { type: 'image/png' });
        await user.upload(screen.getByLabelText('上传附件'), image);

        await waitFor(() => expect(screen.getByAltText('screen.png')).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: 'Send message' }));

        expect(onSendMessage).toHaveBeenCalledWith('', [
            expect.objectContaining({
                type: 'image',
                mediaType: 'image/png',
                filename: 'screen.png',
            }),
        ], undefined);
        expect(onSendMessage.mock.calls[0][1][0].data).toEqual(expect.any(String));
    });

    it('sends an uploaded JSONL document attachment without rendering it as an image', async () => {
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
            />
        );

        const input = document.getElementById('beegame-chat-attachment-upload') as HTMLInputElement;
        expect(input.accept).toContain('.jsonl');
        expect(input.accept).not.toContain('image/gif');

        await user.upload(input, new File(['{"ok":true}\n'], 'events.jsonl', { type: 'application/jsonl' }));

        await waitFor(() => expect(screen.getByText('events.jsonl')).toBeInTheDocument());
        expect(screen.queryByAltText('events.jsonl')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Send message' }));

        expect(onSendMessage).toHaveBeenCalledWith('', [
            expect.objectContaining({
                type: 'file',
                mediaType: 'application/jsonl',
                filename: 'events.jsonl',
            }),
        ], undefined);
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
            />
        );

        const image = new File(['png-bytes'], 'pasted-screen.png', { type: 'image/png' });
        fireEvent.paste(getChatInput(), {
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
            />
        );

        const image = new File(['png-bytes'], 'clipboard-screen.png', { type: 'image/png' });
        fireEvent.paste(getChatInput(), {
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
        expect(onSendMessage).toHaveBeenCalledWith('', [
            expect.objectContaining({
                type: 'image',
                mediaType: 'image/png',
                filename: 'clipboard-screen.png',
            }),
        ], undefined);
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
            />
        );

        const image = new File(['png-bytes'], 'duplicated-screen.png', { type: 'image/png' });
        fireEvent.paste(getChatInput(), {
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
        expect(onSendMessage.mock.calls[0][1]).toHaveLength(1);
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
        fireEvent.paste(getChatInput(), {
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
        expect(onSendMessage.mock.calls[0][1]).toHaveLength(1);
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
            />
        );

        const pasteTarget = getChatInput();
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
        expect(onSendMessage.mock.calls[0][1]).toHaveLength(1);
    });

    it('uploads assets without automatically sending an integration prompt', async () => {
        const user = userEvent.setup();
        const onSendMessage = vi.fn();
        vi.mocked(api.getProjectAssets).mockResolvedValue({
            version: 5,
            project_target: { platform: 'web', runtime: 'react', integration_mode: 'filesystem', runtime_asset_root: 'client/public/assets' },
            requirements: [{
                id: 'bgm_game',
                name: 'Game BGM',
                purpose: 'Game background music',
                status: 'planned',
                resource_requirement: { asset_kinds: ['audio-clip'], accepted_formats: ['mp3'] },
                satisfied_by: { import_ids: ['upload.bgm_game'] },
            }],
            imports: [{ id: 'upload.bgm_game', source: { type: 'user-upload' }, status: 'available', root_path: 'client/public/assets/uploads/bgm_game/game.mp3', local_files: ['client/public/assets/uploads/bgm_game/game.mp3'], selected_at: '2026-07-22T00:00:00.000Z', selection_reason: ['user-provided-for-requirement'] }],
            compositions: [],
        });
        vi.mocked(api.uploadProjectAsset).mockResolvedValue({
            manifest: {
                version: 5,
                project_target: { platform: 'web', runtime: 'react', integration_mode: 'filesystem', runtime_asset_root: 'client/public/assets' },
                requirements: [{
                    id: 'bgm_game',
                    name: 'Game BGM',
                    purpose: 'Game background music',
                    status: 'planned',
                    resource_requirement: { asset_kinds: ['audio-clip'], accepted_formats: ['mp3'] },
                    satisfied_by: { import_ids: ['upload.bgm_game'] },
                }],
                imports: [{ id: 'upload.bgm_game', source: { type: 'user-upload' }, status: 'available', root_path: 'client/public/assets/uploads/bgm_game/game.mp3', local_files: ['client/public/assets/uploads/bgm_game/game.mp3'], selected_at: '2026-07-22T00:00:00.000Z', selection_reason: ['user-provided-for-requirement'] }],
                compositions: [],
            },
            requirement: { id: 'bgm_game', name: 'Game BGM', purpose: 'Game background music', status: 'planned', satisfied_by: { import_ids: ['upload.bgm_game'] } },
            path: 'client/public/assets/uploads/bgm_game/game.mp3',
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
            />
        );

        await user.click(screen.getByRole('button', { name: '资源' }));
        const file = new File(['audio'], 'game.mp3', { type: 'audio/mpeg' });
        await user.upload(await screen.findByLabelText('上传替换'), file);

        expect(api.uploadProjectAsset).toHaveBeenCalledWith('proj_1', 'bgm_game', file);
        expect(onSendMessage).not.toHaveBeenCalled();

        expect(screen.queryByRole('button', { name: '让 Agent 探索资源' })).not.toBeInTheDocument();
        expect(api.requestProjectAction).not.toHaveBeenCalled();
        expect(onSendMessage).not.toHaveBeenCalled();
    });

    it('shows an empty asset contract message when a restored project has no manifest', async () => {
        const user = userEvent.setup();
        vi.mocked(api.getProjectAssets).mockResolvedValue({ version: 5, requirements: [] });

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
            />
        );

        await user.click(screen.getByRole('button', { name: '资源' }));

        expect(await screen.findByText(/还没有资源合同/)).toBeInTheDocument();
    });

    it('keeps the existing asset contract visible when a refresh request fails', async () => {
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.useFakeTimers();
        vi.mocked(api.getProjectAssets)
            .mockResolvedValueOnce({
                version: 5,
                project_target: {
                    runtime_asset_root: 'public/game-assets',
                },
                requirements: [{
                    id: 'bgm_game',
                    name: 'Game BGM',
                    purpose: 'Game background music',
                    status: 'planned',
                    satisfied_by: { import_ids: ['bgm_upload'] },
                }],
                imports: [{
                    id: 'bgm_upload',
                    source: { type: 'user-upload' },
                    status: 'available',
                    root_path: 'public/game-assets/uploads/bgm_game/theme.ogg',
                    local_files: ['public/game-assets/uploads/bgm_game/theme.ogg'],
                    selected_at: '2026-07-22T00:00:00.000Z',
                    selection_reason: ['User uploaded theme.ogg'],
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
        expect(errorLog).toHaveBeenCalledWith('Failed to load project assets:', expect.any(Error));
        errorLog.mockRestore();
        vi.useRealTimers();
    });

    it('clears the previous project asset manifest when switching projects', async () => {
        const user = userEvent.setup();
        vi.mocked(api.getProjectAssets).mockImplementation(async (projectId: string) => {
            if (projectId === 'proj_1') {
                return {
                    version: 5,
                    requirements: [{
                        id: 'bgm_game',
                        name: 'Game BGM',
                        purpose: 'Game background music',
                        status: 'planned',
                    }],
                };
            }
            return { version: 5, requirements: [] };
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
