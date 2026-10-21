import { goModelCatalog } from '../../../../../../tests/fixtures/opencode-go';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsMenu } from './SettingsMenu';
import { OPENCODE_GO_PROFILES } from '@bee-game-studio/agent-workflow/opencode-go';
import { useSystemStore } from '../../../store/systemStore';
import { getImageGenerationSettings, saveImageGenerationSettings, getPersonalImageConnection, savePersonalImageConnection } from '../../../services/imageGenerationApi';
vi.mock('../../../services/imageGenerationApi', () => ({ getImageGenerationSettings: vi.fn(), saveImageGenerationSettings: vi.fn(), getPersonalImageConnection: vi.fn(), savePersonalImageConnection: vi.fn() }));

const {
    createModelConfig,
    deleteModelConfig,
    createMcpServer,
    deleteMcpServer,
    discoverActiveMcpServers,
    discoverMcpServers,
    importDiscoveredMcpServer,
    getBeeGameWorkspaceSettings,
    getWebToolsConfig,
    getRuntimeSettings,
    getInvitationPublicSettings,
    listModelConfigs,
    listOpenCodeGoModels,
    listModelCatalog,
    listInvitations,
    listMcpServers,
    saveRuntimeSettings,
    saveInvitationSettings,
    saveWebToolsConfig,
    testMcpServer,
    createInvitation,
    deleteInvitation,
    updateInvitation,
    updateMcpServer,
    updateModelConfig,
    saveModelConnection,
    startModelLogin,
    readModelLogin,
    cancelModelLogin,
    getCreditSummary,
    getBillingCreditPacks,
    getBillingEvents,
    upsertBillingCreditPack,
    getProjectLifecycleOverview,
    listUserSkills,
    importUserSkillPackage,
    updateUserSkillEnabled,
    deleteUserSkill,
    planProjectRetention,
    runProjectRetention,
    showError,
    showSuccess,
    showWarning,
} = vi.hoisted(() => ({
    createModelConfig: vi.fn(),
    deleteModelConfig: vi.fn(),
    createInvitation: vi.fn(),
    createMcpServer: vi.fn(),
    deleteInvitation: vi.fn(),
    deleteMcpServer: vi.fn(),
    discoverActiveMcpServers: vi.fn(),
    discoverMcpServers: vi.fn(),
    importDiscoveredMcpServer: vi.fn(),
    getBeeGameWorkspaceSettings: vi.fn(),
    getInvitationPublicSettings: vi.fn(),
    getWebToolsConfig: vi.fn(),
    getRuntimeSettings: vi.fn(),
    listInvitations: vi.fn(),
    listModelConfigs: vi.fn(),
    listOpenCodeGoModels: vi.fn(),
    listModelCatalog: vi.fn(),
    listMcpServers: vi.fn(),
    saveInvitationSettings: vi.fn(),
    saveRuntimeSettings: vi.fn(),
    saveWebToolsConfig: vi.fn(),
    testMcpServer: vi.fn(),
    updateInvitation: vi.fn(),
    updateMcpServer: vi.fn(),
    updateModelConfig: vi.fn(),
    saveModelConnection: vi.fn(),
    startModelLogin: vi.fn(),
    readModelLogin: vi.fn(),
    cancelModelLogin: vi.fn(),
    getCreditSummary: vi.fn(),
    getBillingCreditPacks: vi.fn(),
    getBillingEvents: vi.fn(),
    upsertBillingCreditPack: vi.fn(),
    getProjectLifecycleOverview: vi.fn(),
    listUserSkills: vi.fn(),
    importUserSkillPackage: vi.fn(),
    updateUserSkillEnabled: vi.fn(),
    deleteUserSkill: vi.fn(),
    planProjectRetention: vi.fn(),
    runProjectRetention: vi.fn(),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    showWarning: vi.fn(),
}));

const desktopBridge = {
    chooseWorkspacePath: vi.fn(),
};

vi.mock('../../../services/modelConfigApi', () => ({
    createModelConfig,
    deleteModelConfig,
    listModelConfigs,
    listOpenCodeGoModels,
    listModelCatalog,
    updateModelConfig,
    saveModelConnection,
    startModelLogin,
    readModelLogin,
    cancelModelLogin,
}));

vi.mock('../../../services/beeGameAdapter', () => ({
    getBeeGameWorkspaceSettings,
}));

vi.mock('../../../services/webToolsApi', () => ({
    getWebToolsConfig,
    saveWebToolsConfig,
}));

vi.mock('../../../services/runtimeSettingsApi', () => ({
    getRuntimeSettings,
    saveRuntimeSettings,
}));

vi.mock('../../../services/invitationApi', () => ({
    createInvitation,
    deleteInvitation,
    getInvitationPublicSettings,
    listInvitations,
    saveInvitationSettings,
    updateInvitation,
}));

vi.mock('../../../services/mcpServersApi', () => ({
    createMcpServer,
    deleteMcpServer,
    discoverActiveMcpServers,
    discoverMcpServers,
    importDiscoveredMcpServer,
    listMcpServers,
    testMcpServer,
    updateMcpServer,
}));

vi.mock('../../../services/creditsApi', () => ({
    getCreditSummary,
    getBillingCreditPacks,
    getBillingEvents,
    upsertBillingCreditPack,
}));

vi.mock('../../../services/projectLifecycleApi', () => ({
    getProjectLifecycleOverview,
    planProjectRetention,
    runProjectRetention,
}));

vi.mock('../../../services/userSkillsApi', () => ({
    listUserSkills,
    importUserSkillPackage,
    updateUserSkillEnabled,
    deleteUserSkill,
}));

vi.mock('../../../contexts/ToastContext', () => ({
    useToastContext: () => ({
        showError,
        showSuccess,
        showWarning,
        showToast: vi.fn(),
        dismissToast: vi.fn(),
        dismissAll: vi.fn(),
        toasts: [],
    }),
}));

const settingsElement = (props: Partial<ComponentProps<typeof SettingsMenu>> = {}) => (
    <SettingsMenu
        isOpen
        lang="zh"
        onClose={vi.fn()}
        onSetLang={vi.fn()}
        canManageWorkspace
        canManageSecrets
        canManageRuntimeSettings
        canManageMcp
        canManageSkills
        canManageModelConfig
        {...props}
    />
);

const renderSettings = (props: Partial<ComponentProps<typeof SettingsMenu>> = {}) => render(settingsElement(props));

const openMcpActionsMenu = async () => {
    await userEvent.click(screen.getByRole('button', { name: /操作/ }));
};

const openPlatformSettings = async () => {
    await userEvent.click(screen.getByRole('tab', { name: '平台' }));
};

const openPlatformSettingsTab = async (name: string | RegExp) => {
    await openPlatformSettings();
    await userEvent.click(screen.getByRole('tab', { name }));
};

const openMcpSettings = async () => {
    await userEvent.click(screen.getByRole('tab', { name: 'MCP' }));
};

const openUserSkillsSettings = async () => {
    await userEvent.click(screen.getByRole('tab', { name: '技能' }));
};

describe('SettingsMenu model settings', () => {
    beforeEach(() => {
        startModelLogin.mockReset(); readModelLogin.mockReset(); cancelModelLogin.mockReset();
        cancelModelLogin.mockResolvedValue({});
        vi.mocked(getPersonalImageConnection).mockReset();
        vi.mocked(getPersonalImageConnection).mockResolvedValue({ source: 'platform', provider: 'openai', baseUrl: 'https://api.openai.com/v1/images/generations', model: 'image-model', hasApiKey: false, hasUpstreamApiKey: false });
        vi.mocked(savePersonalImageConnection).mockReset();
        localStorage.clear();
        Object.assign(window, { BeeGameDesktop: desktopBridge });
        desktopBridge.chooseWorkspacePath.mockReset();
        listOpenCodeGoModels.mockResolvedValue(goModelCatalog);
        listModelConfigs.mockResolvedValue([]);
        getBeeGameWorkspaceSettings.mockResolvedValue({
            workspacePath: '/tmp/beegame-projects',
            isDefault: true,
        });
        getWebToolsConfig.mockResolvedValue({});
        getRuntimeSettings.mockResolvedValue({});
        getInvitationPublicSettings.mockReset();
        getInvitationPublicSettings.mockResolvedValue({ required: false });
        listInvitations.mockReset();
        listInvitations.mockResolvedValue([]);
        saveInvitationSettings.mockReset();
        saveInvitationSettings.mockResolvedValue({ required: false });
        createInvitation.mockReset();
        deleteInvitation.mockReset();
        deleteInvitation.mockResolvedValue(true);
        updateInvitation.mockReset();
        listMcpServers.mockResolvedValue([]);
        saveRuntimeSettings.mockResolvedValue({});
        saveWebToolsConfig.mockReset();
        saveRuntimeSettings.mockReset();
        createMcpServer.mockReset();
        deleteMcpServer.mockReset();
        discoverActiveMcpServers.mockReset();
        discoverActiveMcpServers.mockResolvedValue([]);
        discoverMcpServers.mockReset();
        discoverMcpServers.mockResolvedValue([]);
        importDiscoveredMcpServer.mockReset();
        testMcpServer.mockReset();
        testMcpServer.mockResolvedValue({
            ok: false,
            status: 'unavailable',
            message: 'Stdio MCP requires launching a process and cannot be verified from the dashboard.',
            checkedAt: '2026-06-27T00:00:00.000Z',
        });
        listMcpServers.mockReset();
        listMcpServers.mockResolvedValue([]);
        listUserSkills.mockReset();
        listUserSkills.mockResolvedValue([]);
        importUserSkillPackage.mockReset();
        updateUserSkillEnabled.mockReset();
        deleteUserSkill.mockReset();
        deleteUserSkill.mockResolvedValue({ deleted: true });
        showError.mockReset();
        showSuccess.mockReset();
        showWarning.mockReset();
        createModelConfig.mockReset();
        deleteModelConfig.mockReset();
        updateModelConfig.mockReset();
        updateMcpServer.mockReset();
    getCreditSummary.mockReset();
        getBillingCreditPacks.mockReset();
        getBillingCreditPacks.mockResolvedValue({ packs: [] });
        getBillingEvents.mockReset();
        getBillingEvents.mockResolvedValue({ events: [] });
        upsertBillingCreditPack.mockReset();
        getCreditSummary.mockResolvedValue({
            entriesCount: 2,
            consumedCredits: 2,
            weightedTokens: 12_000,
        });
        getProjectLifecycleOverview.mockReset();
        getProjectLifecycleOverview.mockResolvedValue({
            quota: {
                limit: 2,
                used: 1,
                remaining: 1,
            },
            storage: {
                supabaseStorageConfigured: true,
            },
            projects: [
                {
                    id: 'project_lifecycle_one',
                    name: 'Lifecycle One',
                    createdAt: 1720000000000,
                    rootPath: '/srv/beegame/projects/lifecycle-one',
                    lifecycle: {
                        hasWorkspacePath: true,
                        hasRuntimeSnapshot: true,
                        phaseName: 'polish',
                        updatedAt: 1720000001000,
                    },
                },
            ],
            recentDeletions: [
                {
                    projectId: 'project_deleted_one',
                    deletedAt: '2026-07-08T10:00:00.000Z',
                    cleanupOutcome: 'workspace_deleted',
                    deletedWorkspacePath: '/srv/beegame/projects/deleted-one',
                    storageCleanupOutcome: 'storage_prefix_cleanup_requested',
                },
            ],
            recentRetentionRuns: [
                {
                    dryRun: false,
                    ranAt: '2026-07-08T10:05:00.000Z',
                    deploymentRecordsDeleted: 1,
                    deploymentRecordsRetained: 6,
                    deploymentRecordsPlannedForDeletion: 1,
                    previewRecordsSkipped: 1,
                    logRecordsSkipped: 1,
                },
            ],
        });
        planProjectRetention.mockReset();
        planProjectRetention.mockResolvedValue({
            dryRun: true,
            summary: {
                deploymentRecordsRetained: 6,
                deploymentRecordsPlannedForDeletion: 1,
                deploymentRecordsDeleted: 0,
                deploymentArtifactsSkipped: 0,
                previewRecordsSkipped: 1,
                logRecordsSkipped: 1,
            },
            deploymentRecords: {
                retained: [],
                plannedForDeletion: [{ id: 'deploy_old', sessionId: 'session_1', status: 'succeeded', createdAt: '', updatedAt: '', reason: 'older_than_rollback_retention_window' }],
                deleted: [],
                skipped: [],
            },
            previewRecords: { skipped: [{ reason: 'local_preview_snapshots_are_in_memory_only' }] },
            logs: { skipped: [{ reason: 'log_retention_requires_persisted_log_index' }] },
        });
        runProjectRetention.mockReset();
        runProjectRetention.mockResolvedValue({
            dryRun: false,
            summary: {
                deploymentRecordsRetained: 6,
                deploymentRecordsPlannedForDeletion: 1,
                deploymentRecordsDeleted: 1,
                deploymentArtifactsSkipped: 0,
                previewRecordsSkipped: 1,
                logRecordsSkipped: 1,
            },
            deploymentRecords: {
                retained: [],
                plannedForDeletion: [{ id: 'deploy_old', sessionId: 'session_1', status: 'succeeded', createdAt: '', updatedAt: '', reason: 'older_than_rollback_retention_window' }],
                deleted: [{ id: 'deploy_old', sessionId: 'session_1', status: 'succeeded', createdAt: '', updatedAt: '', reason: 'older_than_rollback_retention_window' }],
                skipped: [],
            },
            previewRecords: { skipped: [{ reason: 'local_preview_snapshots_are_in_memory_only' }] },
            logs: { skipped: [{ reason: 'log_retention_requires_persisted_log_index' }] },
        });
    });

    it('loads only the selected settings domain, even with all management permissions', async () => {
        const reads = [listModelConfigs, getBeeGameWorkspaceSettings, getWebToolsConfig, getRuntimeSettings,
            listMcpServers, listUserSkills, getInvitationPublicSettings, listInvitations,
            getProjectLifecycleOverview, getCreditSummary, getBillingCreditPacks, getBillingEvents];
        reads.forEach(read => read.mockClear());
        renderSettings({ canManageInvitations: true, canManageLifecycle: true, canManageCredits: true });
        reads.forEach(read => expect(read).not.toHaveBeenCalled());

        await openPlatformSettings();
        await screen.findByText('/tmp/beegame-projects');
        expect(getBeeGameWorkspaceSettings).toHaveBeenCalledTimes(1);
        expect(getWebToolsConfig).not.toHaveBeenCalled();
        reads.filter(read => read !== getBeeGameWorkspaceSettings)
            .forEach(read => expect(read).not.toHaveBeenCalled());

        await userEvent.click(screen.getByRole('tab', { name: '能力' }));
        expect(getRuntimeSettings).toHaveBeenCalledTimes(1);
        expect(listModelConfigs).not.toHaveBeenCalled();
        expect(listMcpServers).not.toHaveBeenCalled();
    });



    it('waits for the initial capability settings before allowing edits or save', async () => {
        let resolveSettings!: (value: { resourceLibraryEnabled: boolean }) => void;
        getRuntimeSettings.mockImplementationOnce(() => new Promise(resolve => { resolveSettings = resolve; }));
        renderSettings();
        await openPlatformSettingsTab('能力');
        expect(screen.getByRole('switch', { name: '资源库' })).toBeDisabled();
        expect(screen.getByRole('button', { name: '保存设置' })).toBeDisabled();
        await act(async () => { resolveSettings({ resourceLibraryEnabled: true }); });
        expect(screen.getByRole('switch', { name: '资源库' })).toBeEnabled();
        expect(screen.getByRole('switch', { name: '资源库' })).toBeChecked();
    });

    it('keeps an open model form and its secret draft when the language changes', async () => {
        listModelConfigs.mockClear();
        const { rerender } = renderSettings();
        await openPlatformSettingsTab('模型');
        await userEvent.click(screen.getByRole('button', { name: '添加模型配置' }));
        await userEvent.type(screen.getByLabelText('API Key'), 'unsaved-model-key');
        await userEvent.type(screen.getByLabelText('Balanced 模型'), 'draft-model');

        rerender(settingsElement({ lang: 'en' }));
        expect(screen.getByLabelText('API Key')).toHaveValue('unsaved-model-key');
        expect(screen.getByLabelText(/Balanced/)).toHaveValue('draft-model');
        expect(listModelConfigs).toHaveBeenCalledTimes(1);
    });



    it('preserves queued MCP autosave across language changes and cancels it on close', async () => {
        const server = { id: 'mcp_queued', name: 'Queued MCP', enabled: true, transport: 'http',
            scope: 'beegame', url: 'http://127.0.0.1:8081', env: [], autoStart: true };
        listMcpServers.mockResolvedValueOnce([server]);
        updateMcpServer.mockResolvedValue({ ...server, url: 'http://127.0.0.1:8082' });
        const { rerender } = renderSettings();
        await openMcpSettings();
        await screen.findByText(server.name);
        const actions = screen.getAllByRole('button', { name: '操作' });
        await userEvent.click(actions[actions.length - 1]);
        await userEvent.click(screen.getByRole('menuitem', { name: '编辑' }));
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'http://127.0.0.1:8082' } });
            rerender(settingsElement({ lang: 'en' }));
            expect(screen.getByLabelText('URL')).toHaveValue('http://127.0.0.1:8082');
            expect(updateMcpServer).not.toHaveBeenCalled();
            await act(async () => { vi.advanceTimersByTime(450); });
            expect(updateMcpServer).toHaveBeenCalledWith(server.id, expect.objectContaining({ url: 'http://127.0.0.1:8082' }));

            fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'http://127.0.0.1:8083' } });
            rerender(settingsElement({ lang: 'en', isOpen: false }));
            await act(async () => { vi.advanceTimersByTime(450); });
            expect(updateMcpServer).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('only replaces the content surface when navigating settings, not when data updates', async () => {
        const user = userEvent.setup();
        renderSettings();
        const shell = screen.getByTestId('settings-modal-shell');
        const general = screen.getByTestId('settings-modal-scroll-area');
        expect(screen.getByRole('dialog')).toHaveClass('transition-[opacity,transform,scale]');
        expect(screen.getByRole('dialog')).toHaveClass('motion-reduce:data-[starting-style]:scale-100');
        await user.click(screen.getByRole('tab', { name: '技能' }));
        const skills = screen.getByTestId('settings-modal-scroll-area');
        expect(skills).not.toBe(general);
        expect(screen.getByTestId('settings-modal-shell')).toBe(shell);
        await screen.findByText('还没有用户技能。');
        expect(screen.getByTestId('settings-modal-scroll-area')).toBe(skills);
        await user.click(screen.getByRole('tab', { name: '通用', exact: true }));
        expect(screen.getByTestId('settings-modal-scroll-area')).not.toBe(skills);
        expect(screen.getByLabelText('语言选择')).toBeInTheDocument();
    });

    it('renders the settings panel as a centered modal overlay', async () => {
        renderSettings();

        const dialog = screen.getByRole('dialog', { name: '系统设置' });
        expect(dialog.className).toContain('max-w-none');
        expect(dialog.className).toContain('overflow-hidden');
        expect(dialog.className).not.toContain('bg-zinc-950/55');
        expect(dialog.className).not.toContain('right-4');
        expect(dialog.className).not.toContain('top-20');
        expect(dialog).toHaveAttribute('aria-label', '系统设置');
        expect(screen.getByTestId('settings-modal-sidebar')).toBeInTheDocument();
        const settingsContent = screen.getByTestId('settings-modal-content');
        const settingsScrollArea = screen.getByTestId('settings-modal-scroll-area');
        expect(dialog).toHaveClass('h-[min(680px,calc(100dvh-1rem))]');
        expect(dialog).toHaveClass('w-[min(820px,calc(100vw-1rem))]');
        expect(settingsContent).toBeInTheDocument();
        expect(settingsScrollArea).toHaveClass('overflow-y-auto');
        expect(settingsScrollArea).toHaveClass('min-h-0');
        expect(screen.getByRole('tab', { name: '通用' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: '技能' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: '平台' })).toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '账户' })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '成员' })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '能力' })).not.toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'MCP' })).toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '工作区' })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '网页' })).not.toBeInTheDocument();
        expect(screen.getByText(/深色模式|浅色模式/)).toBeInTheDocument();
        expect(screen.queryByLabelText('Subagents')).not.toBeInTheDocument();
        expect(screen.queryByRole('switch', { name: '资源库' })).not.toBeInTheDocument();
        expect(screen.queryByText('Let the runtime decide when delegation is useful. BeeGame will not force it.')).not.toBeInTheDocument();
        expect(screen.queryByText('BeeGame 会把 Brave key 注入新启动的 runtime session。已有会话不会自动重启。')).not.toBeInTheDocument();
        expect(screen.getByLabelText('语言选择')).toBeInTheDocument();
        expect(screen.queryByText('/tmp/beegame-projects')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('搜索后端')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('配置名称')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '保存工作路径' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '保存网页配置' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '选择工作路径' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '保存设置' })).not.toBeInTheDocument();
    });

    it('saves BYOK from the shared bottom-right footer, not inside the scroll area', async () => {
        useSystemStore.setState({ currentUser: { id: 'fixture-user', role: 'viewer', permissions: [] } });
        listModelCatalog.mockResolvedValue([
            { id: 'official', name: 'Bee Game Studio LLM', provider: 'openai-compatible', models: { balanced: 'official' }, apiKeyPreview: '', isDefault: true, authMethods: ['platform'], connection: { method: 'platform', hasKey: false, isPreferred: false, claudeConnected: false, chatgptConnected: false } },
            { id: 'personal-byok', name: 'BYOK', provider: 'openai-compatible', models: {}, apiKeyPreview: '', isDefault: false, authMethods: ['byok'], connection: { method: 'platform', hasKey: false, isPreferred: false, claudeConnected: false, chatgptConnected: false } },
        ]);
        saveModelConnection.mockResolvedValue({ method: 'byok', hasKey: true, isPreferred: true, claudeConnected: false, chatgptConnected: false });
        try {
            renderSettings();
            await userEvent.click(screen.getByRole('tab', { name: '模型连接' }));
            await userEvent.click(screen.getByRole('button', { name: '连接方式' }));
            await userEvent.click(screen.getByRole('option', { name: 'BYOK' }));
            await userEvent.type(screen.getByLabelText('接口 URL'), 'https://example.com/v1');
            await userEvent.type(screen.getByLabelText('API Key'), 'fixture-secret');
            await userEvent.type(screen.getByLabelText('快速模型'), 'fast');
            await userEvent.type(screen.getByLabelText('均衡模型'), 'balanced');
            await userEvent.type(screen.getByLabelText('强力模型'), 'strong');
            const save = screen.getByRole('button', { name: '保存设置' });
            expect(screen.getByTestId('settings-modal-scroll-area')).not.toContainElement(save);
            expect(save.parentElement).toHaveClass('justify-end');
            expect(save).toHaveClass('rounded-full');
            await userEvent.click(save);
            await waitFor(() => expect(saveModelConnection).toHaveBeenCalledWith('personal-byok', 'byok', 'fixture-secret', true, { provider: 'openai-compatible', apiProtocol: 'chat-completions', baseUrl: 'https://example.com/v1', models: { fast: 'fast', balanced: 'balanced', strong: 'strong' } }));
        } finally {
            useSystemStore.setState({ currentUser: null });
        }
    });

    it('authorizes ChatGPT from platform models once and shows the same login in Image service without changing activation or billing', async () => {
        useSystemStore.setState({ currentUser: { id: 'fixture-owner', role: 'owner', permissions: [] } });
        let connected = false;
        listModelCatalog.mockImplementation(async () => [{ id: 'personal-chatgpt-subscription', name: 'ChatGPT subscription',
            provider: 'openai-compatible', models: {}, apiKeyPreview: '', isDefault: false, authMethods: ['chatgpt-subscription'],
            connection: { method: 'platform', hasKey: false, isPreferred: false, claudeConnected: false, chatgptConnected: connected } }]);
        startModelLogin.mockResolvedValue({ id: 'admin-device', url: 'https://auth.openai.com/codex/device', userCode: 'ADMIN-CODE', method: 'chatgpt-subscription' });
        readModelLogin.mockImplementation(async () => { connected = true; return { status: 'complete' }; });
        vi.mocked(getImageGenerationSettings).mockImplementation(async () => ({ provider: 'chatgpt-subscription', baseUrl: 'https://chatgpt.com/backend-api/codex/responses',
            model: 'fixture-image', responseModel: 'fixture-response', hasApiKey: false, subscriptionConnected: connected,
            quality: 'medium', size: '1024x1024', billing: null }));
        const open = vi.spyOn(window, 'open').mockReturnValue({ opener: null, location: { replace: vi.fn() }, close: vi.fn() } as unknown as Window);
        saveModelConnection.mockClear(); vi.mocked(saveImageGenerationSettings).mockClear();
        createModelConfig.mockClear(); updateModelConfig.mockClear();
        try {
            renderSettings();
            await openPlatformSettingsTab('模型');
            expect(screen.getByRole('region', { name: '管理员 ChatGPT 订阅' })).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: '连接方式' })).not.toBeInTheDocument();
            const login = screen.getByRole('button', { name: '使用 ChatGPT 账号登录授权' });
            await waitFor(() => expect(login).toBeEnabled());
            await userEvent.click(login);
            await screen.findByText('ADMIN-CODE');
            expect(await screen.findByText('ChatGPT 订阅已连接', {}, { timeout: 3500 })).toBeInTheDocument();
            await userEvent.click(screen.getByRole('tab', { name: '生图服务' }));
            expect(await screen.findByText('当前管理员的 ChatGPT 账户已连接')).toBeInTheDocument();
            expect(screen.getByRole('switch', { name: '配置图片计费（未配置时不允许提交生成）' })).not.toBeChecked();
            await userEvent.click(screen.getByRole('button', { name: '前往平台模型' }));
            expect(await screen.findByText('ChatGPT 订阅已连接')).toBeInTheDocument();
            expect(startModelLogin).toHaveBeenCalledExactlyOnceWith('personal-chatgpt-subscription', 'chatgpt-subscription');
            expect(open).toHaveBeenCalledTimes(1);
            expect(saveModelConnection).not.toHaveBeenCalled();
            expect(saveImageGenerationSettings).not.toHaveBeenCalled();
            expect(createModelConfig).not.toHaveBeenCalled(); expect(updateModelConfig).not.toHaveBeenCalled();
        } finally { open.mockRestore(); useSystemStore.setState({ currentUser: null }); }
    });

    it('lets an ordinary user select personal image generation without platform administration', async () => {
        useSystemStore.setState({ currentUser: { id: 'fixture-image-user', role: 'viewer', permissions: [] } });
        vi.mocked(savePersonalImageConnection).mockResolvedValue({ source: 'platform', provider: 'openai', baseUrl: 'https://api.openai.com/v1/images/generations', model: 'image-model', hasApiKey: false, hasUpstreamApiKey: false });
        try {
            renderSettings({ canManageWorkspace: false, canManageSecrets: false, canManageRuntimeSettings: false, canManageMcp: false, canManageSkills: false, canManageModelConfig: false });
            expect(screen.queryByRole('tab', { name: '平台' })).not.toBeInTheDocument();
            await userEvent.click(screen.getByRole('tab', { name: 'AI 生图' }));
            expect(await screen.findByRole('radio', { name: /平台提供/ })).toBeChecked();
            const save = screen.getByRole('button', { name: '保存设置' });
            expect(save.parentElement).toHaveClass('justify-end');
            expect(save).toHaveClass('rounded-full');
            await userEvent.click(save);
            await waitFor(() => expect(savePersonalImageConnection).toHaveBeenCalledWith({ source: 'platform' }));
        } finally { useSystemStore.setState({ currentUser: null }); }
    });

    it('exposes the persisted theme toggle in General settings', async () => {
        renderSettings();

        const themeSwitch = screen.getByRole('switch', { name: '主题切换' });
        const before = themeSwitch.getAttribute('aria-checked');
        await userEvent.click(themeSwitch);
        expect(themeSwitch).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true');
        await userEvent.click(themeSwitch);
        expect(themeSwitch).toHaveAttribute('aria-checked', before ?? 'true');
    });

    it('lets an ordinary user manage personal MCP without showing platform administration', async () => {
        useSystemStore.setState({ currentUser: { id: 'fixture-viewer', role: 'viewer', permissions: ['mcp.manage'] } });
        try {
            renderSettings({
                canManageWorkspace: false,
                canManageSecrets: false,
                canManageRuntimeSettings: false,
                canManageMcp: undefined,
                canManageModelConfig: false,
                canManageInvitations: false,
                canManageLifecycle: false,
                canManageCredits: false,
            });
            expect(screen.getByRole('tab', { name: 'MCP' })).toBeInTheDocument();
            expect(screen.queryByRole('tab', { name: '平台' })).not.toBeInTheDocument();
            await openMcpSettings();
            await waitFor(() => expect(listMcpServers).toHaveBeenCalled());
            await openMcpActionsMenu();
            expect(screen.getByRole('menuitem', { name: '新增 Server' })).toBeInTheDocument();
        expect(screen.queryByRole('menuitem', { name: '发现本机 MCP' })).not.toBeInTheDocument();
        } finally {
            useSystemStore.setState({ currentUser: null });
        }
    });

    it('shows platform administration inside the same settings modal for privileged users', async () => {
        renderSettings();

        await userEvent.click(screen.getByRole('tab', { name: '平台' }));

        expect(screen.getByRole('tab', { name: '部署' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: '能力' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: '模型' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: '生图服务' })).toBeInTheDocument();
        await expect(screen.findByText('/tmp/beegame-projects')).resolves.toBeInTheDocument();
        expect(screen.getByText('服务器模式下工作根目录是全局安全边界。普通用户不能单独修改，项目路径由平台按账号自动生成。')).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('旧搜索适配器已停用');
        expect(screen.queryByRole('button', { name: '保存设置' })).not.toBeInTheDocument();
    });

    it('saves image settings from the shared window footer and closes only after success', async () => {
        const config = { provider: 'openrouter' as const, baseUrl: 'https://openrouter.ai/api/v1/images', model: 'openai/gpt-image-2.5-flare', quality: 'medium' as const, size: '1024x1024', hasApiKey: true };
        vi.mocked(getImageGenerationSettings).mockResolvedValue(config);
        let finish!: (value: typeof config) => void;
        vi.mocked(saveImageGenerationSettings).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        const onClose = vi.fn();
        renderSettings({ onClose });
        await userEvent.click(screen.getByRole('tab', { name: '平台' }));
        await userEvent.click(screen.getByRole('tab', { name: '生图服务' }));
        await screen.findByDisplayValue(config.model);
        const save = screen.getByRole('button', { name: '保存设置' });
        expect(save.closest('form')).toBeNull();
        expect(screen.queryByRole('button', { name: '保存生图配置' })).not.toBeInTheDocument();
        await userEvent.click(save);
        expect(save).toBeDisabled();
        expect(onClose).not.toHaveBeenCalled();
        finish(config);
        await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
        expect(vi.mocked(saveImageGenerationSettings).mock.calls.at(-1)![0]).not.toHaveProperty('apiKey');
    });

    it('loads private skills only when opening their settings section', async () => {
        renderSettings();
        await screen.findByRole('tab', { name: '技能' });
        expect(listUserSkills).not.toHaveBeenCalled();
        await openUserSkillsSettings();
        await waitFor(() => expect(listUserSkills).toHaveBeenCalledTimes(1));
    });

    it('lets users delete private skills from the settings panel without exposing editing', async () => {
        listUserSkills.mockResolvedValue([
            {
                id: 'skill_1',
                slug: 'movement-contracts',
                name: 'movement-contracts',
                description: 'Keep movement controls consistent.',
                enabled: true,
                content: [
                    '---',
                    'name: movement-contracts',
                    'description: Keep movement controls consistent.',
                    '---',
                    '',
                    '# Movement',
                ].join('\n'),
                references: [],
                createdAt: '2026-07-09T00:00:00.000Z',
                updatedAt: '2026-07-09T00:00:00.000Z',
            },
        ]);

        renderSettings();
        await openUserSkillsSettings();

        await expect(screen.findByText('movement-contracts')).resolves.toBeInTheDocument();
        expect(screen.queryByLabelText('Skill markdown 内容')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: '删除技能' }));

        await waitFor(() => expect(deleteUserSkill).toHaveBeenCalledWith('skill_1'));
        expect(screen.queryByText('movement-contracts')).not.toBeInTheDocument();
        expect(showSuccess).toHaveBeenCalledWith('技能已删除。');
        expect(screen.queryByText('技能已删除。')).not.toBeInTheDocument();
    });

    it('imports zipped skills without exposing an editing draft', async () => {
        importUserSkillPackage.mockResolvedValue({
            id: 'skill_2',
            slug: 'imported-movement-contracts',
            name: 'imported-movement-contracts',
            description: 'Imported movement guidance.',
            enabled: true,
            content: [
                '---',
                'name: imported-movement-contracts',
                'description: Imported movement guidance.',
                '---',
                '',
                '# Imported Movement',
            ].join('\n'),
            references: [],
            createdAt: '2026-07-09T00:00:00.000Z',
            updatedAt: '2026-07-09T00:01:00.000Z',
        });

        renderSettings();
        await openUserSkillsSettings();

        expect(screen.queryByText('导入只属于当前用户的 BeeGame skill zip 包，并在新 runtime 任务启动前注入。')).not.toBeInTheDocument();
        expect(screen.queryByText('已启用技能会在新的 BeeGame runtime turn 启动前写入 user-* 目录。')).not.toBeInTheDocument();
        expect(screen.queryByText('导入技能')).not.toBeInTheDocument();
        expect(screen.queryByText('已保存技能')).not.toBeInTheDocument();
        expect(screen.getByTestId('user-skills-empty-state')).toHaveClass('flex-1', 'items-center', 'justify-center');
        const file = new File(['zip-bytes'], 'imported-movement-contracts.zip', { type: 'application/zip' });
        await userEvent.upload(screen.getByLabelText('导入 Skill zip 文件'), file);

        await waitFor(() => expect(importUserSkillPackage).toHaveBeenCalledWith(file));
        expect(await screen.findByText('imported-movement-contracts')).toBeInTheDocument();
        expect(screen.queryByTestId('user-skills-empty-state')).not.toBeInTheDocument();
        expect(showSuccess).toHaveBeenCalledWith('已导入：imported-movement-contracts.zip');
        expect(screen.queryByText('已导入：imported-movement-contracts.zip')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Skill markdown 内容')).not.toBeInTheDocument();
    });

    it('imports zipped skills by dropping them onto the skills list', async () => {
        importUserSkillPackage.mockResolvedValue({
            id: 'skill_drop',
            slug: 'dropped-skill',
            name: 'dropped-skill',
            description: 'Dropped skill.',
            enabled: true,
            content: [
                '---',
                'name: dropped-skill',
                'description: Dropped skill.',
                '---',
                '',
                '# Dropped',
            ].join('\n'),
            references: [],
            createdAt: '2026-07-09T00:00:00.000Z',
            updatedAt: '2026-07-09T00:01:00.000Z',
        });

        renderSettings();
        await openUserSkillsSettings();

        const file = new File(['zip-bytes'], 'dropped-skill.zip', { type: 'application/zip' });
        fireEvent.drop(screen.getByTestId('user-skills-drop-zone'), {
            dataTransfer: {
                files: [file],
            },
        });

        await waitFor(() => expect(importUserSkillPackage).toHaveBeenCalledWith(file));
        expect(await screen.findByText('dropped-skill')).toBeInTheDocument();
        expect(showSuccess).toHaveBeenCalledWith('已导入：dropped-skill.zip');
        expect(screen.queryByText('已导入：dropped-skill.zip')).not.toBeInTheDocument();
    });

    it('keeps the empty skills state clean when import validation fails', async () => {
        importUserSkillPackage.mockRejectedValue(new Error('Skill zip file is required'));

        renderSettings();
        await openUserSkillsSettings();

        const file = new File(['bad-zip'], 'broken-skill.zip', { type: 'application/zip' });
        await userEvent.upload(screen.getByLabelText('导入 Skill zip 文件'), file);

        await waitFor(() => expect(importUserSkillPackage).toHaveBeenCalledWith(file));
        expect(showError).toHaveBeenCalledWith('Skill zip file is required');
        expect(screen.queryByText('Skill zip file is required')).not.toBeInTheDocument();
        expect(screen.queryByText('请选择 .zip skill 包。')).not.toBeInTheDocument();
        expect(screen.getByText('还没有用户技能。')).toBeInTheDocument();
        expect(screen.getByText('导入 Skill zip 文件后，已保存的技能会显示在这里。')).toBeInTheDocument();
    });

    it('shows duplicate skill import errors from the server in toast', async () => {
        importUserSkillPackage.mockRejectedValue(new Error('Skill already exists'));

        renderSettings();
        await openUserSkillsSettings();

        const file = new File(['duplicate-zip'], 'duplicate-skill.zip', { type: 'application/zip' });
        await userEvent.upload(screen.getByLabelText('导入 Skill zip 文件'), file);

        await waitFor(() => expect(importUserSkillPackage).toHaveBeenCalledWith(file));
        expect(showError).toHaveBeenCalledWith('Skill already exists');
        expect(screen.queryByText('Skill already exists')).not.toBeInTheDocument();
    });

    it('shows each user skill slug once even when stored data contains duplicates', async () => {
        listUserSkills.mockResolvedValue([
            {
                id: 'skill_1',
                slug: 'threejs-fundamentals',
                name: 'threejs-fundamentals',
                description: 'Three.js scene setup.',
                enabled: true,
                content: '',
                references: [],
                createdAt: '2026-07-09T00:00:00.000Z',
                updatedAt: '2026-07-09T00:00:00.000Z',
            },
            {
                id: 'skill_2',
                slug: 'threejs-fundamentals',
                name: 'threejs-fundamentals',
                description: 'Duplicate should not render.',
                enabled: true,
                content: '',
                references: [],
                createdAt: '2026-07-09T00:01:00.000Z',
                updatedAt: '2026-07-09T00:01:00.000Z',
            },
        ]);

        renderSettings();
        await openUserSkillsSettings();

        await waitFor(() => expect(listUserSkills).toHaveBeenCalledWith());
        expect(screen.getAllByText('threejs-fundamentals')).toHaveLength(1);
    });

    it('shows private skills without exposing platform administration', async () => {
        renderSettings({
            canManageWorkspace: false,
            canManageSecrets: false,
            canManageRuntimeSettings: false,
            canManageMcp: false,
            canManageSkills: true,
            canManageModelConfig: false,
            canManageInvitations: false,
            canReadAudit: false,
        });

        expect(screen.getByRole('tab', { name: '通用' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: '技能' })).toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '平台' })).not.toBeInTheDocument();

        await openUserSkillsSettings();

        await waitFor(() => expect(listUserSkills).toHaveBeenCalledWith());
        expect(screen.getByText('用户技能')).toBeInTheDocument();
        expect(screen.getByText('还没有用户技能。')).toBeInTheDocument();
        expect(screen.getByText('导入 Skill zip 文件后，已保存的技能会显示在这里。')).toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '部署' })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '模型' })).not.toBeInTheDocument();
    });

    it('does not expose skill validation controls to users', async () => {
        renderSettings();
        await openUserSkillsSettings();

        expect(screen.queryByRole('button', { name: '检查技能' })).not.toBeInTheDocument();
    });

    it('wraps long deployment workspace paths within the settings panel', async () => {
        const longWorkspacePath = '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/bee-game-studio/Projects';
        getBeeGameWorkspaceSettings.mockResolvedValue({
            workspacePath: longWorkspacePath,
            isDefault: false,
        });

        renderSettings();

        await userEvent.click(screen.getByRole('tab', { name: '平台' }));
        const pathDisplay = await screen.findByText(longWorkspacePath);

        expect(pathDisplay).toHaveClass('max-w-full');
        expect(pathDisplay).toHaveClass('break-all');
        expect(pathDisplay).toHaveClass('whitespace-normal');
    });

    it('shows the actual invitation code separately from the invite note', async () => {
        listInvitations.mockResolvedValue([
            {
                id: 'invite_1',
                code: 'BEE-ALPHA',
                label: '内部测试名额',
                enabled: true,
                maxUses: 100,
                usedCount: 0,
                createdAt: '2026-07-06T00:00:00.000Z',
                updatedAt: '2026-07-06T00:00:00.000Z',
            },
        ]);

        renderSettings({ canManageInvitations: true });
        await openPlatformSettingsTab('邀请码');

        await expect(screen.findByText('内部测试名额')).resolves.toBeInTheDocument();
        expect(screen.getByText('邀请码 BEE-ALPHA')).toBeInTheDocument();
        expect(screen.getByText('已用 0 / 100')).toBeInTheDocument();
    });

    it('shows credit administration only for credit administrators', async () => {
        const { unmount } = renderSettings({ canManageCredits: true });

        await openPlatformSettingsTab('信用');

        expect(screen.getByRole('button', { name: '保存套餐' })).toHaveClass('rounded-full');

        await waitFor(() => expect(screen.getAllByText('Credit 审计')).toHaveLength(2));
        expect(screen.queryByText('冻结未结算')).not.toBeInTheDocument();
        expect(screen.getByText('已用')).toBeInTheDocument();
        expect(screen.getByText('12000')).toBeInTheDocument();
        expect(screen.getAllByText('2 credits').length).toBeGreaterThan(0);
        expect(getCreditSummary).toHaveBeenCalledWith();

        unmount();
        getCreditSummary.mockClear();
        renderSettings({
            canManageWorkspace: false,
            canManageSecrets: false,
            canManageRuntimeSettings: false,
            canManageMcp: false,
            canManageSkills: false,
            canManageModelConfig: false,
            canReadAudit: false,
            canManageCredits: false,
        });

        expect(screen.queryByRole('tab', { name: '平台' })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '信用' })).not.toBeInTheDocument();
        expect(getCreditSummary).not.toHaveBeenCalled();
    });

    it('shows project lifecycle controls only for lifecycle administrators', async () => {
        renderSettings({ canManageLifecycle: true });

        await openPlatformSettingsTab('项目');

        await waitFor(() => expect(getProjectLifecycleOverview).toHaveBeenCalledWith());
        expect(screen.getAllByText('项目生命周期').length).toBeGreaterThan(0);
        expect(screen.getByText('1 / 2 个项目')).toBeInTheDocument();
        expect(screen.getByText('Lifecycle One')).toBeInTheDocument();
        expect(screen.getByText('/srv/beegame/projects/lifecycle-one')).toBeInTheDocument();
        expect(screen.getByText('project_deleted_one')).toBeInTheDocument();
        expect(screen.getByText('workspace_deleted')).toBeInTheDocument();
        expect(screen.getByText('最近保留任务')).toBeInTheDocument();
        expect(screen.getByText('已删除 1 条部署记录')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: '试算清理' }));
        await waitFor(() => expect(planProjectRetention).toHaveBeenCalledWith());
        expect(screen.getByText('Dry run：1 条部署记录将被删除。')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: '执行清理' }));
        await waitFor(() => expect(runProjectRetention).toHaveBeenCalledWith());
        expect(screen.getByText('Retention 已删除 1 条部署记录。')).toBeInTheDocument();
        expect(getProjectLifecycleOverview).toHaveBeenCalledTimes(2);
    });

    it('hides privileged settings sections when the user lacks management permissions', () => {
        listModelConfigs.mockClear();
        getBeeGameWorkspaceSettings.mockClear();
        getWebToolsConfig.mockClear();
        getRuntimeSettings.mockClear();
        listMcpServers.mockClear();
        listUserSkills.mockClear();

        renderSettings({
            canManageWorkspace: false,
            canManageSecrets: false,
            canManageRuntimeSettings: false,
            canManageMcp: false,
            canManageSkills: false,
            canManageModelConfig: false,
        });

        expect(screen.getByRole('tab', { name: '通用' })).toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '平台' })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '部署' })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '能力' })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: 'MCP' })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '技能' })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '模型' })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '成员' })).not.toBeInTheDocument();
        expect(screen.getByLabelText('语言选择')).toBeInTheDocument();
        expect(screen.queryByLabelText('工作路径')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('搜索后端')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '保存设置' })).not.toBeInTheDocument();
        expect(listModelConfigs).not.toHaveBeenCalled();
        expect(getBeeGameWorkspaceSettings).not.toHaveBeenCalled();
        expect(getWebToolsConfig).not.toHaveBeenCalled();
        expect(getRuntimeSettings).not.toHaveBeenCalled();
        expect(listMcpServers).not.toHaveBeenCalled();
        expect(listUserSkills).not.toHaveBeenCalled();
    });

    it('keeps settings limited to personal preferences without management permissions', () => {
        listModelConfigs.mockClear();
        getBeeGameWorkspaceSettings.mockClear();
        getWebToolsConfig.mockClear();
        getRuntimeSettings.mockClear();
        listMcpServers.mockClear();

        renderSettings({
            canManageWorkspace: false,
            canManageSecrets: false,
            canManageRuntimeSettings: false,
            canManageMcp: false,
            canManageSkills: false,
            canManageModelConfig: false,
        });

        expect(screen.getByRole('tab', { name: '通用' })).toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '成员' })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '能力' })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: 'MCP' })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '模型' })).not.toBeInTheDocument();
        expect(screen.getByLabelText('语言选择')).toBeInTheDocument();
        expect(screen.queryByLabelText('工作路径')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('搜索后端')).not.toBeInTheDocument();
        expect(listModelConfigs).not.toHaveBeenCalled();
        expect(getBeeGameWorkspaceSettings).not.toHaveBeenCalled();
        expect(getWebToolsConfig).not.toHaveBeenCalled();
        expect(getRuntimeSettings).not.toHaveBeenCalled();
        expect(listMcpServers).not.toHaveBeenCalled();
    });

    it('keeps the settings chrome and controls visually consistent', async () => {
        const onClose = vi.fn();
        const { container } = renderSettings({ onClose });

        await openPlatformSettingsTab('能力');
        const saveButton = screen.getByRole('button', { name: '保存设置' });
        expect(saveButton.querySelector('svg')).toBeNull();
        expect(container.querySelector('.bg-black')).toBeNull();

        await userEvent.click(screen.getByRole('button', { name: '关闭设置' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not close when clicking outside the settings panel', async () => {
        const onClose = vi.fn();
        renderSettings({ onClose });

        await userEvent.click(screen.getByRole('dialog', { name: '系统设置' }));

        expect(onClose).not.toHaveBeenCalled();
    });

    it('closes after saving settings successfully', async () => {
        const onClose = vi.fn();
        saveWebToolsConfig.mockResolvedValue({
            webSearchAdapter: 'tavily',
        });
        saveRuntimeSettings.mockResolvedValue({
            resourceLibraryEnabled: true,
            autoDreamEnabled: true,
            skillSearchEnabled: false,
            treeSitterBashEnabled: false,
            webBrowserToolEnabled: false,
            bashClassifierEnabled: false,
            mcpSkillsEnabled: false,
            resourceLibraryEnabled: true,
        });

        renderSettings({ onClose });
        await openPlatformSettingsTab('能力');

        await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });

    it('renders the retained resource capability without legacy agent switches', async () => {
 renderSettings(); await openPlatformSettingsTab('能力');
 expect(screen.getByRole('switch',{name:'资源库'})).toBeChecked();
 expect(screen.getAllByRole('switch')).toHaveLength(1);
});

    it('configures MCP servers from the settings tab', async () => {
        createMcpServer.mockResolvedValue({
            id: 'mcp_1',
            name: 'Unity Bridge',
            enabled: true,
            transport: 'stdio',
            scope: 'beegame',
            command: 'npx',
            args: ['unity-mcp'],
            env: [{ key: 'UNITY_TOKEN', valuePreview: 'unit…oken' }],
            autoStart: true,
        });

        renderSettings();

        await openMcpSettings();

        expect(screen.getByRole('tab', { name: 'MCP' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.queryByText('在这里添加自己的 MCP Server，并检查连接是否可用。')).not.toBeInTheDocument();
        expect(screen.queryByText(/Bee Game Studio/)).not.toBeInTheDocument();
        expect(screen.queryByText('已配置')).not.toBeInTheDocument();
        expect(screen.getByTestId('mcp-empty-state')).toHaveTextContent('尚未添加 MCP Server');
        expect(screen.getByTestId('mcp-empty-state')).toHaveClass('flex-1');
        expect(screen.getByRole('button', { name: /操作/ })).toHaveClass('rounded-full', 'bg-transparent');
        expect(screen.queryByLabelText('名称')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('自动启动')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '保存设置' })).not.toBeInTheDocument();

        await openMcpActionsMenu();
        await userEvent.click(screen.getByRole('menuitem', { name: '新增 Server' }));

        expect(screen.getByLabelText('传输')).toBeInTheDocument();
        await userEvent.click(screen.getByLabelText('传输'));
        const transportOptions = screen.getByRole('listbox', { name: '传输' });
        expect(transportOptions.parentElement).toBe(document.body);
        expect(transportOptions).toHaveClass('z-[370]');
        expect(transportOptions.style.zIndex).toBe('');
        expect(screen.queryByRole('option', { name: /SSE/ })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('option', { name: 'stdio' }));
        expect(screen.getByLabelText('名称')).toBeInTheDocument();
        expect(screen.queryByLabelText('命令')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('参数')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('作用域')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('自动启动')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: '保存 Server' })).toBeDisabled();
        expect(screen.getByRole('button', { name: '保存 Server' })).toHaveClass('rounded-full');

        await userEvent.type(screen.getByLabelText('名称'), 'Unity Bridge');
        await userEvent.click(screen.getByRole('button', { name: /高级/ }));
        await userEvent.type(screen.getByLabelText('命令'), 'npx');
        await userEvent.type(screen.getByLabelText('参数'), 'unity-mcp');
        expect(screen.getByLabelText('作用域')).toBeInTheDocument();
        await userEvent.click(screen.getByLabelText('作用域'));
        const scopeOptions = screen.getByRole('listbox', { name: '作用域' });
        expect(scopeOptions.parentElement).toBe(document.body);
        expect(scopeOptions).toHaveClass('z-[370]');
        await userEvent.click(screen.getByRole('option', { name: 'BeeGame' }));
        expect(screen.getByLabelText('名称')).toHaveValue('Unity Bridge');
        await userEvent.type(screen.getByLabelText('环境变量'), 'UNITY_TOKEN=unity-secret-token');
        await userEvent.click(screen.getByRole('button', { name: '保存 Server' }));

        await waitFor(() => expect(createMcpServer).toHaveBeenCalledWith({
            name: 'Unity Bridge',
            enabled: true,
            transport: 'stdio',
            scope: 'beegame',
            command: 'npx',
            args: ['unity-mcp'],
            env: [{ key: 'UNITY_TOKEN', value: 'unity-secret-token' }],
            autoStart: true,
        }));
    });

    it.each([
        ['untested', false, '未测试'],
        ['unavailable', false, '不可用'],
        ['available', true, '可用'],
    ] as const)('displays the MCP test result %s without confusing untested and failure', async (status, ok, label) => {
        listMcpServers.mockResolvedValueOnce([{
            id: 'blender', name: 'Blender', enabled: true, transport: 'stdio', scope: 'beegame',
            command: '/installed/mcp-for-blender', env: [], autoStart: true,
        }]);
        testMcpServer.mockResolvedValueOnce({ ok, status, message: 'Connection test detail', checkedAt: new Date().toISOString() });
        renderSettings();
        await openMcpSettings();
        expect(await screen.findByText('Blender')).toBeInTheDocument();
        const actions = screen.getAllByRole('button', { name: /操作/ });
        await userEvent.click(actions[actions.length - 1]);
        await userEvent.click(screen.getByRole('menuitem', { name: '测试连接' }));
        await waitFor(() => expect(testMcpServer).toHaveBeenCalled());
        expect(await screen.findByText(label, { exact: true })).toBeInTheDocument();
        expect(screen.queryByText('Connection test detail')).not.toBeInTheDocument();
        if (status === 'unavailable') {
            await waitFor(() => expect(showError).toHaveBeenCalledWith('Connection test detail'));
            expect(showError).toHaveBeenCalledTimes(1);
        } else {
            expect(showError).not.toHaveBeenCalled();
        }
        if (status === 'untested') {
            await waitFor(() => expect(showWarning).toHaveBeenCalledWith('Connection test detail'));
        } else {
            expect(showWarning).not.toHaveBeenCalled();
        }
        if (status === 'untested') expect(screen.queryByText('不可用', { exact: true })).not.toBeInTheDocument();
    });

    it('reports a rejected MCP test through the global error notification without inline detail', async () => {
        listMcpServers.mockResolvedValueOnce([{
            id: 'failed', name: 'Failed MCP', enabled: true, transport: 'http', scope: 'beegame',
            url: 'https://example.test/mcp', env: [], autoStart: true,
        }]);
        testMcpServer.mockRejectedValueOnce(new Error('Connection timed out'));
        renderSettings();
        await openMcpSettings();
        expect(await screen.findByText('Failed MCP')).toBeInTheDocument();
        const actions = screen.getAllByRole('button', { name: /操作/ });
        await userEvent.click(actions[actions.length - 1]);
        await userEvent.click(screen.getByRole('menuitem', { name: '测试连接' }));
        await waitFor(() => expect(showError).toHaveBeenCalledWith('Connection timed out'));
        expect(showError).toHaveBeenCalledTimes(1);
        expect(screen.getByText('不可用', { exact: true })).toBeInTheDocument();
        expect(screen.queryByText('Connection timed out')).not.toBeInTheDocument();
        expect(showWarning).not.toHaveBeenCalled();
    });

    it('scans running MCP servers and imports verified entries', async () => {
        useSystemStore.setState({ currentUser: { id: 'fixture-owner', role: 'owner', permissions: ['workspace.manage', 'mcp.manage'] } });
        try {
        discoverActiveMcpServers.mockResolvedValue([
            {
                name: 'Runtime MCP',
                enabled: true,
                transport: 'http',
                scope: 'beegame',
                url: 'http://127.0.0.1:8081/mcp',
                autoStart: true,
                endpoint: 'http://127.0.0.1:8081/mcp',
                exists: false,
                test: {
                    ok: true,
                    status: 'available',
                    message: 'MCP initialize succeeded.',
                    checkedAt: '2026-06-27T00:00:00.000Z',
                    endpoint: 'http://127.0.0.1:8081/mcp',
                    serverInfo: { name: 'Runtime MCP' },
                },
            },
        ]);
        createMcpServer.mockResolvedValue({
            id: 'mcp_runtime',
            name: 'Runtime MCP',
            enabled: true,
            transport: 'http',
            scope: 'beegame',
            url: 'http://127.0.0.1:8081/mcp',
            autoStart: true,
        });

        renderSettings();
        await openMcpSettings();
        await openMcpActionsMenu();
        await userEvent.click(screen.getByRole('menuitem', { name: '发现本机 MCP' }));

        await waitFor(() => expect(discoverActiveMcpServers).toHaveBeenCalled());
        await waitFor(() => expect(showSuccess).toHaveBeenCalledWith('发现 1 个 MCP 服务或配置。'));
        expect(screen.queryByText('发现 1 个 MCP 服务或配置。')).not.toBeInTheDocument();
        expect(screen.getByText('本机 HTTP MCP')).toBeInTheDocument();
        expect(screen.getByText('Runtime MCP')).toBeInTheDocument();
        expect(screen.getByText('可用')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: '导入' }));

        await waitFor(() => expect(createMcpServer).toHaveBeenCalledWith({
            name: 'Runtime MCP',
            enabled: true,
            transport: 'http',
            scope: 'beegame',
            url: 'http://127.0.0.1:8081/mcp',
            autoStart: true,
        }));
        } finally {
            useSystemStore.setState({ currentUser: null });
        }
    });

    it.each([false, true])('reports an empty or failed local MCP scan through global notifications (failed=%s)', async failed => {
        useSystemStore.setState({ currentUser: { id: 'fixture-owner', role: 'owner', permissions: ['workspace.manage', 'mcp.manage'] } });
        try {
            if (failed) discoverActiveMcpServers.mockRejectedValueOnce(new Error('Scan failed'));
            else discoverActiveMcpServers.mockResolvedValueOnce([]);
            renderSettings();
            await openMcpSettings();
            await openMcpActionsMenu();
            await userEvent.click(screen.getByRole('menuitem', { name: '发现本机 MCP' }));
            const message = failed ? 'Scan failed' : '未发现本机 MCP 服务或可导入配置。';
            await waitFor(() => expect(failed ? showError : showWarning).toHaveBeenCalledWith(message));
            expect(failed ? showError : showWarning).toHaveBeenCalledTimes(1);
            expect(screen.queryByText(message)).not.toBeInTheDocument();
            expect(showSuccess).not.toHaveBeenCalled();
            expect(screen.queryByText('本机 HTTP MCP', { exact: true })).not.toBeInTheDocument();
        } finally {
            useSystemStore.setState({ currentUser: null });
        }
    });

    it.each([false, true])('discovers stdio configurations without starting them and imports by source (HTTP scan fails=%s)', async failed => {
        useSystemStore.setState({ currentUser: { id: 'fixture-owner', role: 'owner', permissions: ['workspace.manage', 'mcp.manage'] } });
        const discovered = {
            name: 'Blender', enabled: true, transport: 'stdio', scope: 'beegame',
            command: '/local/bin/blender-mcp', sourcePath: '/home/test/.bgs/config.toml', exists: false,
            env: [{ key: 'TOKEN', valuePreview: '••••' }],
        };
        discoverMcpServers.mockResolvedValueOnce([discovered]);
        if (failed) discoverActiveMcpServers.mockRejectedValueOnce(new Error('HTTP scan failed'));
        importDiscoveredMcpServer.mockResolvedValueOnce({ ...discovered, id: 'imported-blender' });
        try {
            renderSettings();
            await openMcpSettings();
            await openMcpActionsMenu();
            await userEvent.click(screen.getByRole('menuitem', { name: '发现本机 MCP' }));
            await waitFor(() => expect(screen.getByText('Blender')).toBeInTheDocument());
            expect(discoverMcpServers).toHaveBeenCalledOnce();
            expect(testMcpServer).not.toHaveBeenCalled();
            expect(createMcpServer).not.toHaveBeenCalled();
            expect(screen.queryByText('可用', { exact: true })).not.toBeInTheDocument();
            if (failed) expect(showError).toHaveBeenCalledWith('HTTP scan failed');
            else expect(showSuccess).toHaveBeenCalledWith('发现 1 个 MCP 服务或配置。');
            await userEvent.click(screen.getByRole('button', { name: '导入', exact: true }));
            await waitFor(() => expect(importDiscoveredMcpServer).toHaveBeenCalledWith(discovered));
            expect(testMcpServer).not.toHaveBeenCalled();
            expect(screen.getByRole('button', { name: '已存在', exact: true })).toBeDisabled();
        } finally {
            useSystemStore.setState({ currentUser: null });
        }
    });

    it('opens MCP settings only through the row actions menu, not the card body', async () => {
        listMcpServers.mockResolvedValueOnce([
            {
                id: 'mcp_existing',
                name: 'Existing MCP',
                enabled: true,
                transport: 'http',
                scope: 'beegame',
                url: 'http://127.0.0.1:8081',
                env: [],
                autoStart: true,
            },
        ]);
        updateMcpServer.mockResolvedValue({
            id: 'mcp_existing',
            name: 'Existing MCP',
            enabled: true,
            transport: 'http',
            scope: 'beegame',
            url: 'http://127.0.0.1:8082',
            env: [],
            autoStart: true,
        });

        renderSettings();
        await openMcpSettings();

        expect(await screen.findByText('Existing MCP')).toBeInTheDocument();
        expect(screen.queryByTestId('mcp-empty-state')).not.toBeInTheDocument();
        await userEvent.click(screen.getByText('Existing MCP'));
        expect(screen.queryByLabelText('名称')).not.toBeInTheDocument();
        await userEvent.click(screen.getByText('Existing MCP').closest('li')!);
        expect(screen.queryByLabelText('名称')).not.toBeInTheDocument();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        const rowActions = screen.getAllByRole('button', { name: /操作/ });
        await userEvent.click(rowActions[rowActions.length - 1]);
        await userEvent.click(screen.getByRole('menuitem', { name: '编辑' }));

        const urlInput = screen.getByLabelText('URL');
        expect(urlInput).toHaveValue('http://127.0.0.1:8081');
        expect(screen.queryByRole('button', { name: '保存 Server' })).not.toBeInTheDocument();
        await userEvent.clear(urlInput);
        await userEvent.type(urlInput, 'http://127.0.0.1:8082');

        await waitFor(() => expect(updateMcpServer).toHaveBeenCalledWith('mcp_existing', {
            id: 'mcp_existing',
            name: 'Existing MCP',
            enabled: true,
            transport: 'http',
            scope: 'beegame',
            url: 'http://127.0.0.1:8082',
            env: [],
            autoStart: true,
        }));
    });

    it('saves the resource capability from the settings footer', async () => {
 getRuntimeSettings.mockResolvedValueOnce({resourceLibraryEnabled:true});
 saveRuntimeSettings.mockResolvedValue({resourceLibraryEnabled:false});
 renderSettings(); await openPlatformSettingsTab('能力');
 await userEvent.click(await screen.findByRole('switch',{name:'资源库'}));
 await userEvent.click(screen.getByRole('button',{name:'保存设置'}));
 await waitFor(()=>expect(saveRuntimeSettings).toHaveBeenCalledWith({resourceLibraryEnabled:false}));
});

    it('keeps the deployment root read-only and explains the retired search adapters', async () => {
 renderSettings(); await openPlatformSettings();
 expect(await screen.findByText('/tmp/beegame-projects')).toBeInTheDocument();
 expect(screen.getByRole('status')).toHaveTextContent('旧搜索适配器已停用');
 expect(screen.queryByLabelText('BRAVE_SEARCH_API_KEY')).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'保存设置'})).not.toBeInTheDocument();
 expect(saveWebToolsConfig).not.toHaveBeenCalled();
});

    it('shows compact tiered model fields and saves a new default model config', async () => {
        createModelConfig.mockResolvedValue({
            id: 'llm_1',
            name: 'BeeGame LLM',
            provider: 'openai-compatible',
            apiKeyPreview: 'sk-...cret',
            models: {
                fast: 'gpt-4.1-mini',
                balanced: 'gpt-4.1',
                strong: 'gpt-4.1-pro',
            },
            isDefault: true,
        });

        renderSettings();

        await openPlatformSettingsTab('模型');

        expect(screen.queryByText('BeeGame LLM')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument();
        const addModel = screen.getByRole('button', { name: '添加模型配置' });
        expect(addModel).toHaveClass('rounded-full', 'bg-transparent');
        await userEvent.click(addModel);
        expect(screen.getByRole('dialog', { name: '添加模型配置' })).toContainElement(screen.getByTestId('model-config-popover'));
        expect(screen.queryByLabelText('配置名称')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('模型显示名称')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('设为默认模型')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Fast 模型')).toBeInTheDocument();
        expect(screen.getByLabelText('Balanced 模型')).toBeInTheDocument();
        expect(screen.getByLabelText('Strong 模型')).toBeInTheDocument();
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
        const publicationSwitch = screen.getByRole('switch', { name: '向普通用户发布' });
        expect(publicationSwitch).toBeChecked();
        await userEvent.click(publicationSwitch);
        expect(publicationSwitch).not.toBeChecked();
        await userEvent.click(publicationSwitch);
        expect(screen.getByRole('switch', { name: '平台默认模型' })).toBeChecked();
        expect(screen.getByRole('switch', { name: '平台凭据' })).toBeChecked();
        expect(screen.getByRole('switch', { name: 'BYOK' })).not.toBeChecked();

        await userEvent.type(screen.getByLabelText('Base URL'), 'https://api.example.com/v1');
        await userEvent.type(screen.getByLabelText('API Key'), 'sk-secret');
        await userEvent.type(screen.getByLabelText('Fast 模型'), 'gpt-4.1-mini');
        await userEvent.type(screen.getByLabelText('Balanced 模型'), 'gpt-4.1');
        await userEvent.type(screen.getByLabelText('Strong 模型'), 'gpt-4.1-pro');
        expect(screen.getByRole('button', { name: '保存设置' })).toHaveClass('rounded-full');
        await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

        await waitFor(() => expect(createModelConfig).toHaveBeenCalledWith({
            published: true,
            authMethods: ['platform'],
            name: 'BeeGame LLM',
            provider: 'openai-compatible',
            apiProtocol: 'responses',
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'sk-secret',
            models: {
                fast: 'gpt-4.1-mini',
                balanced: 'gpt-4.1',
                strong: 'gpt-4.1-pro',
            },
            isDefault: true,
        }));
        expect(screen.queryByText('模型配置已保存')).not.toBeInTheDocument();
    });



    it('loads a legacy OpenAI connection as Chat Completions and lets the user choose Responses', async () => {
 listModelConfigs.mockResolvedValue([{id:'legacy',name:'Saved Gateway',provider:'openai-compatible',baseUrl:'https://gateway.example/v1',models:{balanced:'fixture-model'},apiKeyPreview:'',isDefault:true,authMethods:['platform']}]);
 renderSettings(); await openPlatformSettingsTab('模型');
 fireEvent.keyDown(await screen.findByRole('button',{name:'Saved Gateway 操作'}),{key:'ArrowDown'});
 await userEvent.click(await screen.findByRole('menuitem',{name:'详情'}));
 expect(screen.getByLabelText('协议')).toHaveTextContent('Chat Completions');
 await userEvent.click(screen.getByLabelText('协议'));
 await userEvent.click(await screen.findByRole('option',{name:'Responses'}));
 await userEvent.click(screen.getByRole('button',{name:'保存设置'}));
 await waitFor(()=>expect(updateModelConfig).toHaveBeenCalledWith('legacy',expect.objectContaining({apiProtocol:'responses'})));
});

    it('shows the specific outbound policy reason when a model provider cannot be saved', async () => {
        const error = Object.assign(new Error('Outbound URL is not permitted'), {
            code: 'outbound_host_not_allowed',
            hostname: 'provider.example.com',
        });
        createModelConfig.mockRejectedValue(error);

        renderSettings();
        await openPlatformSettingsTab('模型');
        await userEvent.click(screen.getByRole('button', { name: '添加模型配置' }));
        await userEvent.type(screen.getByLabelText('Base URL'), 'https://provider.example.com/v1');
        await userEvent.type(screen.getByLabelText('API Key'), 'sk-secret');
        await userEvent.type(screen.getByLabelText('Balanced 模型'), 'model-balanced');
        await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

        await waitFor(() => expect(showError).toHaveBeenCalledWith('模型服务域名 provider.example.com 尚未获得当前部署授权。'));
        expect(screen.queryByText('模型服务域名 provider.example.com 尚未获得当前部署授权。')).not.toBeInTheDocument();
    });

    it('keeps a saved API key visible as a preview and updates the existing model without retyping it', async () => {
        listModelConfigs.mockResolvedValueOnce([
            {
                id: 'llm_existing',
                name: 'Existing LLM',
                provider: 'openai-compatible',
                baseUrl: 'https://api.saved.test/v1',
                apiKeyPreview: 'sk-...saved',
                models: {
                    fast: 'qwen3.5-flash',
                    balanced: 'qwen3.7-plus',
                    strong: 'qwen3.7-max',
                },
                isDefault: true,
            },
        ]);
        updateModelConfig.mockResolvedValue({
            id: 'llm_existing',
            name: 'Existing LLM',
            provider: 'openai-compatible',
            baseUrl: 'https://api.saved.test/v1',
            apiKeyPreview: 'sk-...saved',
            models: {
                fast: 'qwen3.5-flash',
                balanced: 'qwen3.7-max',
                strong: 'qwen3.7-max',
            },
            isDefault: true,
        });

        renderSettings();
        await openPlatformSettingsTab('模型');

        fireEvent.keyDown(await screen.findByRole('button', { name: 'Existing LLM 操作' }), { key: 'ArrowDown' });
        await userEvent.click(await screen.findByRole('menuitem', { name: '详情' }));
        expect(screen.getByRole('dialog', { name: '模型详情' })).toContainElement(screen.getByTestId('model-config-popover'));
        const apiKeyInput = await screen.findByLabelText('API Key');
        expect(screen.queryByLabelText('模型显示名称')).not.toBeInTheDocument();
        expect(apiKeyInput).toHaveAttribute('placeholder', '已保存：sk-...saved');
        expect(apiKeyInput).toHaveValue('');

        const modelInput = screen.getByLabelText('Balanced 模型');
        await userEvent.clear(modelInput);
        await userEvent.type(modelInput, 'qwen3.7-max');
        await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

        await waitFor(() => expect(updateModelConfig).toHaveBeenCalledWith('llm_existing', {
            published: true,
            authMethods: ['platform'],
            name: 'Existing LLM',
            provider: 'openai-compatible',
            apiProtocol: 'chat-completions',
            baseUrl: 'https://api.saved.test/v1',
            models: {
                fast: 'qwen3.5-flash',
                balanced: 'qwen3.7-max',
                strong: 'qwen3.7-max',
            },
            isDefault: true,
        }));
        expect(createModelConfig).not.toHaveBeenCalled();
    });

    it('closes the model popover with Escape while keeping settings open', async () => {
        listModelConfigs.mockResolvedValueOnce([{
            id: 'llm_existing',
            name: 'Existing LLM',
            provider: 'openai-compatible',
            models: { balanced: 'model-balanced' },
            isDefault: true,
        }]);
        renderSettings();
        await openPlatformSettingsTab('模型');
        fireEvent.keyDown(await screen.findByRole('button', { name: 'Existing LLM 操作' }), { key: 'ArrowDown' });
        await userEvent.click(await screen.findByRole('menuitem', { name: '详情' }));
        const details = screen.getByRole('dialog', { name: '模型详情' });
        fireEvent.keyDown(details, { key: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('dialog', { name: '模型详情' })).not.toBeInTheDocument());
        expect(screen.getByTestId('settings-modal-shell')).toBeInTheDocument();
    });

    it('renames only the selected platform model and deletes only after confirmation', async () => {
        const model = { id: 'model-a', name: 'Model A', provider: 'openai-compatible', models: { balanced: 'model' }, apiKeyPreview: 'sk-...key', isDefault: true };
        listModelConfigs.mockResolvedValue([model, { ...model, id: 'model-b', name: 'Model B', isDefault: false }]);
        updateModelConfig.mockResolvedValue({ ...model, name: 'Renamed' });
        deleteModelConfig.mockResolvedValue({ deleted: true });
        renderSettings();
        await openPlatformSettingsTab('模型');
        const actions = await screen.findByRole('button', { name: 'Model A 操作' });
        expect(actions).toHaveClass('bg-transparent');
        expect(screen.queryByLabelText('模型配置')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '保存设置' })).not.toBeInTheDocument();
        fireEvent.keyDown(actions, { key: 'ArrowDown' });
        const renameAction = await screen.findByRole('menuitem', { name: '编辑名称' });
        expect(document.querySelector('[data-morph-popover-portal]')).toContainElement(renameAction);
        await userEvent.click(renameAction);
        expect(screen.getByRole('dialog', { name: '编辑名称' })).toContainElement(screen.getByTestId('model-config-popover'));
        await userEvent.clear(screen.getByLabelText('模型显示名称'));
        await userEvent.type(screen.getByLabelText('模型显示名称'), 'Renamed');
        expect(screen.getByRole('button', { name: '保存设置' })).toHaveClass('rounded-full');
        await userEvent.click(screen.getByRole('button', { name: '保存设置' }));
        await waitFor(() => expect(updateModelConfig).toHaveBeenCalledWith('model-a', { name: 'Renamed' }));
        fireEvent.keyDown(await screen.findByRole('button', { name: 'Renamed 操作' }), { key: 'ArrowDown' });
        await userEvent.click(await screen.findByRole('menuitem', { name: '删除' }));
        expect(screen.getByRole('dialog', { name: '删除模型配置' })).toContainElement(screen.getByTestId('model-config-popover'));
        expect(deleteModelConfig).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole('button', { name: '取消' }));
        expect(deleteModelConfig).not.toHaveBeenCalled();
        fireEvent.keyDown(screen.getByRole('button', { name: 'Renamed 操作' }), { key: 'ArrowDown' });
        await userEvent.click(await screen.findByRole('menuitem', { name: '删除' }));
        await userEvent.click(screen.getByRole('button', { name: '删除', exact: true }));
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Renamed 操作' })).not.toBeInTheDocument());
        expect(deleteModelConfig).toHaveBeenCalledWith('model-a');
        expect(screen.getByRole('button', { name: 'Model B 操作' })).toBeInTheDocument();
    });

    it('keeps the model item and reports an error when deletion fails', async () => {
        listModelConfigs.mockResolvedValue([{ id: 'model-a', name: 'Model A', provider: 'openai-compatible', models: { balanced: 'model' }, apiKeyPreview: '', isDefault: true }]);
        deleteModelConfig.mockResolvedValue({ deleted: false });
        renderSettings();
        await openPlatformSettingsTab('模型');
        fireEvent.keyDown(await screen.findByRole('button', { name: 'Model A 操作' }), { key: 'ArrowDown' });
        await userEvent.click(await screen.findByRole('menuitem', { name: '删除' }));
        await userEvent.click(screen.getByRole('button', { name: '删除', exact: true }));
        await waitFor(() => expect(showError).toHaveBeenCalledWith(expect.stringContaining('模型未删除')));
        await userEvent.click(screen.getByRole('button', { name: '取消' }));
        expect(screen.getByRole('button', { name: 'Model A 操作' })).toBeInTheDocument();
    });


});
