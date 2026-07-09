import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsMenu } from './SettingsMenu';

const {
    createModelConfig,
    createMcpServer,
    deleteMcpServer,
    discoverActiveMcpServers,
    discoverMcpServers,
    getBeeGameWorkspaceSettings,
    getBeeGameSubagentsEnabled,
    getWebToolsConfig,
    getRuntimeSettings,
    getInvitationPublicSettings,
    listModelConfigs,
    listInvitations,
    listMcpServers,
    saveRuntimeSettings,
    saveInvitationSettings,
    saveWebToolsConfig,
    setBeeGameSubagentsEnabled,
    testMcpServer,
    createInvitation,
    deleteInvitation,
    updateInvitation,
    updateMcpServer,
    updateModelConfig,
    getCreditAuditLedger,
    getBillingCreditPacks,
    getBillingEvents,
    upsertBillingCreditPack,
    getProjectLifecycleOverview,
    listUserSkills,
    createUserSkill,
    updateUserSkill,
    deleteUserSkill,
    validateUserSkill,
    planProjectRetention,
    runProjectRetention,
} = vi.hoisted(() => ({
    createModelConfig: vi.fn(),
    createInvitation: vi.fn(),
    createMcpServer: vi.fn(),
    deleteInvitation: vi.fn(),
    deleteMcpServer: vi.fn(),
    discoverActiveMcpServers: vi.fn(),
    discoverMcpServers: vi.fn(),
    getBeeGameWorkspaceSettings: vi.fn(),
    getBeeGameSubagentsEnabled: vi.fn(),
    getInvitationPublicSettings: vi.fn(),
    getWebToolsConfig: vi.fn(),
    getRuntimeSettings: vi.fn(),
    listInvitations: vi.fn(),
    listModelConfigs: vi.fn(),
    listMcpServers: vi.fn(),
    saveInvitationSettings: vi.fn(),
    saveRuntimeSettings: vi.fn(),
    saveWebToolsConfig: vi.fn(),
    setBeeGameSubagentsEnabled: vi.fn(),
    testMcpServer: vi.fn(),
    updateInvitation: vi.fn(),
    updateMcpServer: vi.fn(),
    updateModelConfig: vi.fn(),
    getCreditAuditLedger: vi.fn(),
    getBillingCreditPacks: vi.fn(),
    getBillingEvents: vi.fn(),
    upsertBillingCreditPack: vi.fn(),
    getProjectLifecycleOverview: vi.fn(),
    listUserSkills: vi.fn(),
    createUserSkill: vi.fn(),
    updateUserSkill: vi.fn(),
    deleteUserSkill: vi.fn(),
    validateUserSkill: vi.fn(),
    planProjectRetention: vi.fn(),
    runProjectRetention: vi.fn(),
}));

const desktopBridge = {
    chooseWorkspacePath: vi.fn(),
};

vi.mock('../../../services/modelConfigApi', () => ({
    createModelConfig,
    listModelConfigs,
    updateModelConfig,
}));

vi.mock('../../../services/beeGameAdapter', () => ({
    getBeeGameWorkspaceSettings,
    getBeeGameSubagentsEnabled,
    setBeeGameSubagentsEnabled,
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
    listMcpServers,
    testMcpServer,
    updateMcpServer,
}));

vi.mock('../../../services/creditsApi', () => ({
    getCreditAuditLedger,
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
    createUserSkill,
    updateUserSkill,
    deleteUserSkill,
    validateUserSkill,
}));

const renderSettings = (props: Partial<ComponentProps<typeof SettingsMenu>> = {}) => render(
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
    />,
);

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

const openUserSkillsSettings = async () => {
    await userEvent.click(screen.getByRole('tab', { name: '技能' }));
};

describe('SettingsMenu model settings', () => {
    beforeEach(() => {
        localStorage.clear();
        Object.assign(window, { BeeGameDesktop: desktopBridge });
        desktopBridge.chooseWorkspacePath.mockReset();
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
        createUserSkill.mockReset();
        updateUserSkill.mockReset();
        deleteUserSkill.mockReset();
        validateUserSkill.mockReset();
        validateUserSkill.mockResolvedValue({
            ok: true,
            skill: {
                id: 'validated',
                slug: 'my-beegame-skill',
                name: 'my-beegame-skill',
                description: '描述 BeeGame 什么时候应该使用这个技能。',
                enabled: true,
                content: '',
                references: [],
                createdAt: '2026-07-09T00:00:00.000Z',
                updatedAt: '2026-07-09T00:00:00.000Z',
            },
        });
        createModelConfig.mockReset();
        getBeeGameSubagentsEnabled.mockReturnValue(true);
        setBeeGameSubagentsEnabled.mockReset();
        updateModelConfig.mockReset();
        updateMcpServer.mockReset();
        getCreditAuditLedger.mockReset();
        getBillingCreditPacks.mockReset();
        getBillingCreditPacks.mockResolvedValue({ packs: [] });
        getBillingEvents.mockReset();
        getBillingEvents.mockResolvedValue({ events: [] });
        upsertBillingCreditPack.mockReset();
        getCreditAuditLedger.mockResolvedValue({
            entries: [
                {
                    id: 'ledger_1',
                    userId: 'customer-a',
                    kind: 'reserve',
                    credits: 5,
                    projectId: 'project_1',
                    reservationId: 'reservation_1',
                    weightedTokens: 0,
                    metadata: { taskType: 'edit_turn', phase: 'build' },
                    createdAt: '2026-07-08T10:00:00.000Z',
                },
                {
                    id: 'ledger_2',
                    userId: 'customer-a',
                    kind: 'settle',
                    credits: 2,
                    projectId: 'project_1',
                    reservationId: 'reservation_1',
                    weightedTokens: 12_000,
                    metadata: { taskType: 'edit_turn', phase: 'build' },
                    createdAt: '2026-07-08T10:01:00.000Z',
                },
            ],
            summary: {
                entriesCount: 2,
                reservedCredits: 5,
                settledCredits: 2,
                refundedCredits: 3,
                outstandingReservedCredits: 0,
                weightedTokens: 12_000,
            },
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

    it('renders the settings panel as a centered modal overlay', async () => {
        renderSettings();

        const dialog = screen.getByRole('dialog', { name: '系统设置' });
        expect(dialog.className).toContain('items-center');
        expect(dialog.className).toContain('justify-center');
        expect(dialog.className).toContain('bg-zinc-950/55');
        expect(dialog.className).not.toContain('right-4');
        expect(dialog.className).not.toContain('top-20');
        expect(screen.getByTestId('settings-modal-sidebar')).toBeInTheDocument();
        const settingsShell = screen.getByTestId('settings-modal-shell');
        const settingsContent = screen.getByTestId('settings-modal-content');
        const settingsScrollArea = screen.getByTestId('settings-modal-scroll-area');
        expect(settingsShell).toHaveClass('h-[min(620px,calc(100vh-2rem))]');
        expect(settingsShell).toHaveClass('w-[min(820px,calc(100vw-2rem))]');
        expect(settingsContent).toBeInTheDocument();
        expect(settingsScrollArea).toHaveClass('overflow-y-auto');
        expect(settingsScrollArea).toHaveClass('min-h-0');
        expect(screen.getByRole('tab', { name: '通用' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: '技能' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: '平台' })).toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '账户' })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '成员' })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '能力' })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: 'MCP' })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '工作区' })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '网页' })).not.toBeInTheDocument();
        expect(screen.queryByText('深色模式')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Subagents')).not.toBeInTheDocument();
        expect(screen.queryByRole('switch', { name: '自动记忆' })).not.toBeInTheDocument();
        expect(screen.queryByText('Let the runtime decide when delegation is useful. BeeGame will not force it.')).not.toBeInTheDocument();
        expect(screen.queryByText('BeeGame 会把 Brave key 注入新启动的 runtime session。已有会话不会自动重启。')).not.toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: '语言选择' })).toBeInTheDocument();
        expect(screen.queryByText('/tmp/beegame-projects')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('搜索后端')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('配置名称')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '保存工作路径' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '保存网页配置' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '选择工作路径' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '保存设置' })).not.toBeInTheDocument();
    });

    it('shows platform administration inside the same settings modal for privileged users', async () => {
        renderSettings();

        await userEvent.click(screen.getByRole('tab', { name: '平台' }));

        expect(screen.getByRole('tab', { name: '部署' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: '能力' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'MCP' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: '模型' })).toBeInTheDocument();
        await expect(screen.findByText('/tmp/beegame-projects')).resolves.toBeInTheDocument();
        expect(screen.getByText('服务器模式下工作根目录是全局安全边界。普通用户不能单独修改，项目路径由平台按账号自动生成。')).toBeInTheDocument();
        expect(screen.getByLabelText('搜索后端')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '保存设置' })).toBeInTheDocument();
    });

    it('lets users manage private skills from the settings panel', async () => {
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
        updateUserSkill.mockResolvedValue({
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
                '',
                'Updated guidance.',
            ].join('\n'),
            references: [],
            createdAt: '2026-07-09T00:00:00.000Z',
            updatedAt: '2026-07-09T00:01:00.000Z',
        });

        renderSettings();
        await openUserSkillsSettings();

        await expect(screen.findByText('movement-contracts')).resolves.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: '编辑' }));
        const editor = screen.getByLabelText('Skill markdown 内容');
        expect((editor as HTMLTextAreaElement).value).toContain('# Movement');
        await userEvent.clear(editor);
        await userEvent.type(editor, [
            '---',
            'name: movement-contracts',
            'description: Keep movement controls consistent.',
            '---',
            '',
            '# Movement',
            '',
            'Updated guidance.',
        ].join('\n'));
        await userEvent.click(screen.getByRole('button', { name: '保存技能' }));

        await waitFor(() => expect(updateUserSkill).toHaveBeenCalledWith('skill_1', expect.objectContaining({
            enabled: true,
            content: expect.stringContaining('Updated guidance.'),
        })));
        expect(await screen.findByText('技能已保存。')).toBeInTheDocument();
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
        expect(screen.queryByRole('tab', { name: '部署' })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '模型' })).not.toBeInTheDocument();
    });

    it('validates private skills before saving', async () => {
        validateUserSkill.mockResolvedValue({
            ok: true,
            skill: {
                id: 'validated',
                slug: 'movement-contracts',
                name: 'movement-contracts',
                description: 'Keep movement controls consistent.',
                enabled: true,
                content: '',
                references: [],
                createdAt: '2026-07-09T00:00:00.000Z',
                updatedAt: '2026-07-09T00:00:00.000Z',
            },
        });

        renderSettings();
        await openUserSkillsSettings();

        const editor = screen.getByLabelText('Skill markdown 内容');
        await userEvent.clear(editor);
        await userEvent.type(editor, [
            '---',
            'name: movement-contracts',
            'description: Keep movement controls consistent.',
            '---',
            '',
            '# Movement',
        ].join('\n'));
        await userEvent.click(screen.getByRole('button', { name: '检查技能' }));

        await waitFor(() => expect(validateUserSkill).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('movement-contracts'),
            enabled: true,
        })));
        expect(await screen.findByText('检查通过：movement-contracts')).toBeInTheDocument();
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

    it('shows credit audit details only for audit readers', async () => {
        const { unmount } = renderSettings({ canReadAudit: true });

        await openPlatformSettingsTab('信用');

        await waitFor(() => expect(screen.getAllByText('Credit 审计')).toHaveLength(2));
        expect(screen.getByText('冻结未结算')).toBeInTheDocument();
        expect(screen.getByText('0 credits')).toBeInTheDocument();
        expect(screen.getByText('已结算')).toBeInTheDocument();
        expect(screen.getAllByText('2 credits').length).toBeGreaterThan(0);
        expect(screen.getAllByText('customer-a').length).toBeGreaterThan(0);
        expect(screen.getAllByText('project_1').length).toBeGreaterThan(0);
        expect(getCreditAuditLedger).toHaveBeenCalledWith();

        unmount();
        getCreditAuditLedger.mockClear();
        renderSettings({
            canManageWorkspace: false,
            canManageSecrets: false,
            canManageRuntimeSettings: false,
            canManageMcp: false,
            canManageSkills: false,
            canManageModelConfig: false,
            canReadAudit: false,
        });

        expect(screen.queryByRole('tab', { name: '平台' })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '信用' })).not.toBeInTheDocument();
        expect(getCreditAuditLedger).not.toHaveBeenCalled();
    });

    it('shows project lifecycle quota and cleanup details only for audit readers', async () => {
        renderSettings({ canReadAudit: true });

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
        expect(screen.getByRole('combobox', { name: '语言选择' })).toBeInTheDocument();
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
        expect(screen.getByRole('combobox', { name: '语言选择' })).toBeInTheDocument();
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

        await openPlatformSettings();
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
            autoMemoryEnabled: true,
            autoDreamEnabled: true,
            skillSearchEnabled: false,
            treeSitterBashEnabled: false,
            webBrowserToolEnabled: false,
            bashClassifierEnabled: false,
            mcpSkillsEnabled: false,
        });

        renderSettings({ onClose });
        await openPlatformSettingsTab('能力');

        await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });

    it('renders capabilities as a dedicated settings tab', async () => {
        renderSettings();

        await openPlatformSettingsTab('能力');

        expect(screen.getByRole('tab', { name: '能力' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('switch', { name: 'Subagents' })).toBeChecked();
        expect(screen.getByRole('switch', { name: '自动记忆' })).toBeChecked();
        expect(screen.getByRole('switch', { name: '自动整理' })).toBeChecked();
        expect(screen.getByRole('switch', { name: 'Skill Search' })).not.toBeChecked();
        expect(screen.getByText('记住偏好、项目决策和常用上下文。')).toBeInTheDocument();
        expect(screen.queryByText('好处: 跨会话保留偏好、项目决策和常用上下文。')).not.toBeInTheDocument();
        expect(screen.queryByText('需重启运行时')).not.toBeInTheDocument();
        expect(screen.queryByText('新会话生效')).not.toBeInTheDocument();
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

        await openPlatformSettingsTab('MCP');

        expect(screen.getByRole('tab', { name: 'MCP' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByText('通过 MCP，BeeGame 可以连接本机正在运行的编辑器、游戏引擎和工具服务。你可以在这里发现本机服务、添加 Server，并确认连接是否可用。')).toBeInTheDocument();
        expect(screen.queryByText(/Claude Code/)).not.toBeInTheDocument();
        expect(screen.getByText('已配置')).toBeInTheDocument();
        expect(screen.getByText('暂无 MCP server')).toBeInTheDocument();
        expect(screen.queryByLabelText('名称')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('自动启动')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '保存设置' })).not.toBeInTheDocument();

        await openMcpActionsMenu();
        await userEvent.click(screen.getByRole('menuitem', { name: '新增 Server' }));

        expect(screen.getByLabelText('传输')).toBeInTheDocument();
        expect(screen.queryByLabelText('命令')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('参数')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('作用域')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('自动启动')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: '保存 Server' })).toBeDisabled();

        await userEvent.type(screen.getByLabelText('名称'), 'Unity Bridge');
        await userEvent.click(screen.getByRole('button', { name: /高级/ }));
        await userEvent.type(screen.getByLabelText('命令'), 'npx');
        await userEvent.type(screen.getByLabelText('参数'), 'unity-mcp');
        expect(screen.getByLabelText('作用域')).toBeInTheDocument();
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

    it('scans running MCP servers and imports verified entries', async () => {
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
        await openPlatformSettingsTab('MCP');
        await openMcpActionsMenu();
        await userEvent.click(screen.getByRole('menuitem', { name: '发现本机服务' }));

        await waitFor(() => expect(discoverActiveMcpServers).toHaveBeenCalled());
        expect(screen.getByText('本机服务')).toBeInTheDocument();
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
    });

    it('opens the MCP edit popover from the selected server row', async () => {
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
        await openPlatformSettingsTab('MCP');

        expect(await screen.findByText('Existing MCP')).toBeInTheDocument();
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

    it('saves capability toggles from the capabilities settings footer', async () => {
        getRuntimeSettings.mockResolvedValueOnce({
            autoMemoryEnabled: true,
            autoDreamEnabled: true,
            skillSearchEnabled: false,
            treeSitterBashEnabled: false,
            webBrowserToolEnabled: false,
            bashClassifierEnabled: false,
            mcpSkillsEnabled: false,
        });
        saveWebToolsConfig.mockResolvedValue({
            webSearchAdapter: 'tavily',
        });
        saveRuntimeSettings.mockResolvedValue({
            autoMemoryEnabled: true,
            autoDreamEnabled: true,
            skillSearchEnabled: true,
            treeSitterBashEnabled: true,
            webBrowserToolEnabled: false,
            bashClassifierEnabled: false,
            mcpSkillsEnabled: false,
        });

        renderSettings();
        await openPlatformSettingsTab('能力');

        await userEvent.click(screen.getByRole('switch', { name: 'Subagents' }));
        await userEvent.click(await screen.findByRole('switch', { name: 'Skill Search' }));
        await userEvent.click(screen.getByRole('switch', { name: 'Bash AST 解析' }));
        await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

        await waitFor(() => expect(saveRuntimeSettings).toHaveBeenCalledWith({
            autoMemoryEnabled: true,
            autoDreamEnabled: true,
            skillSearchEnabled: true,
            treeSitterBashEnabled: true,
            webBrowserToolEnabled: false,
            bashClassifierEnabled: false,
            mcpSkillsEnabled: false,
        }));
        expect(setBeeGameSubagentsEnabled).toHaveBeenCalledWith(false);
    });

    it('keeps deployment workspace root read-only and saves web search settings from the footer', async () => {
        getBeeGameWorkspaceSettings.mockResolvedValueOnce({
            workspacePath: '/tmp/beegame-projects',
            isDefault: true,
        });
        getWebToolsConfig.mockResolvedValueOnce({
            webSearchAdapter: 'tavily',
        });

        renderSettings();
        await openPlatformSettings();

        expect(await screen.findByText('/tmp/beegame-projects')).toBeInTheDocument();
        expect(screen.getByText('服务器模式下工作根目录是全局安全边界。普通用户不能单独修改，项目路径由平台按账号自动生成。')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '恢复默认' })).not.toBeInTheDocument();
        await userEvent.selectOptions(screen.getByLabelText('搜索后端'), 'brave');
        await userEvent.type(screen.getByLabelText('BRAVE_SEARCH_API_KEY'), 'bsa-dashboard-secret');
        await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

        await waitFor(() => expect(saveWebToolsConfig).toHaveBeenCalledWith({
            webSearchAdapter: 'brave',
            braveApiKey: 'bsa-dashboard-secret',
        }));
        expect(saveRuntimeSettings).not.toHaveBeenCalled();
        expect(setBeeGameSubagentsEnabled).not.toHaveBeenCalled();
        expect(screen.queryByText('工作路径已保存')).not.toBeInTheDocument();
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
        expect(screen.queryByLabelText('配置名称')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('设为默认模型')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Fast 模型')).toBeInTheDocument();
        expect(screen.getByLabelText('Balanced 模型')).toBeInTheDocument();
        expect(screen.getByLabelText('Strong 模型')).toBeInTheDocument();

        await userEvent.type(screen.getByLabelText('Base URL'), 'https://api.example.com/v1');
        await userEvent.type(screen.getByLabelText('API Key'), 'sk-secret');
        await userEvent.type(screen.getByLabelText('Fast 模型'), 'gpt-4.1-mini');
        await userEvent.type(screen.getByLabelText('Balanced 模型'), 'gpt-4.1');
        await userEvent.type(screen.getByLabelText('Strong 模型'), 'gpt-4.1-pro');
        await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

        await waitFor(() => expect(createModelConfig).toHaveBeenCalledWith({
            name: 'BeeGame LLM',
            provider: 'openai-compatible',
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

        const apiKeyInput = await screen.findByLabelText('API Key');
        expect(apiKeyInput).toHaveAttribute('placeholder', '已保存：sk-...saved');
        expect(apiKeyInput).toHaveValue('');

        const modelInput = screen.getByLabelText('Balanced 模型');
        await userEvent.clear(modelInput);
        await userEvent.type(modelInput, 'qwen3.7-max');
        await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

        await waitFor(() => expect(updateModelConfig).toHaveBeenCalledWith('llm_existing', {
            name: 'Existing LLM',
            provider: 'openai-compatible',
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

    it('shows API key only for search providers that need one and saves them from the footer', async () => {
        getWebToolsConfig.mockResolvedValueOnce({
            webSearchAdapter: 'tavily',
        });
        saveWebToolsConfig.mockResolvedValue({
            webSearchAdapter: 'brave',
            braveApiKeyPreview: 'bsa-…cret',
        });

        renderSettings();

        expect(screen.queryByLabelText('BRAVE_SEARCH_API_KEY')).not.toBeInTheDocument();
        await openPlatformSettings();
        await userEvent.selectOptions(screen.getByLabelText('搜索后端'), 'brave');
        await userEvent.type(screen.getByLabelText('BRAVE_SEARCH_API_KEY'), 'bsa-dashboard-secret');
        await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

        await waitFor(() => expect(saveWebToolsConfig).toHaveBeenCalledWith({
            webSearchAdapter: 'brave',
            braveApiKey: 'bsa-dashboard-secret',
        }));
        expect(screen.queryByText('网页搜索配置已保存；新会话生效。')).not.toBeInTheDocument();

        await userEvent.selectOptions(screen.getByLabelText('搜索后端'), 'exa');
        expect(screen.getByLabelText('EXA_API_KEY')).toBeInTheDocument();
    });
});
