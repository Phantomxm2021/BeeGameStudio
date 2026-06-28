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
    listModelConfigs,
    listMcpServers,
    resetBeeGameWorkspaceRoot,
    saveRuntimeSettings,
    saveWebToolsConfig,
    setBeeGameSubagentsEnabled,
    setBeeGameWorkspaceRoot,
    testMcpServer,
    updateMcpServer,
    updateModelConfig,
    listWorkspaceMembers,
    upsertWorkspaceMember,
    deleteWorkspaceMember,
} = vi.hoisted(() => ({
    createModelConfig: vi.fn(),
    createMcpServer: vi.fn(),
    deleteMcpServer: vi.fn(),
    discoverActiveMcpServers: vi.fn(),
    discoverMcpServers: vi.fn(),
    getBeeGameWorkspaceSettings: vi.fn(),
    getBeeGameSubagentsEnabled: vi.fn(),
    getWebToolsConfig: vi.fn(),
    getRuntimeSettings: vi.fn(),
    listModelConfigs: vi.fn(),
    listMcpServers: vi.fn(),
    resetBeeGameWorkspaceRoot: vi.fn(),
    saveRuntimeSettings: vi.fn(),
    saveWebToolsConfig: vi.fn(),
    setBeeGameSubagentsEnabled: vi.fn(),
    setBeeGameWorkspaceRoot: vi.fn(),
    testMcpServer: vi.fn(),
    updateMcpServer: vi.fn(),
    updateModelConfig: vi.fn(),
    listWorkspaceMembers: vi.fn(),
    upsertWorkspaceMember: vi.fn(),
    deleteWorkspaceMember: vi.fn(),
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
    resetBeeGameWorkspaceRoot,
    setBeeGameSubagentsEnabled,
    setBeeGameWorkspaceRoot,
}));

vi.mock('../../../services/webToolsApi', () => ({
    getWebToolsConfig,
    saveWebToolsConfig,
}));

vi.mock('../../../services/runtimeSettingsApi', () => ({
    getRuntimeSettings,
    saveRuntimeSettings,
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

vi.mock('../../../services/workspaceMembersApi', () => ({
    listWorkspaceMembers,
    upsertWorkspaceMember,
    deleteWorkspaceMember,
}));

const renderSettings = (props: Partial<ComponentProps<typeof SettingsMenu>> = {}) => render(
    <SettingsMenu
        isOpen
        lang="zh"
        onClose={vi.fn()}
        onSetLang={vi.fn()}
        mode="admin"
        canManageWorkspace
        canManageSecrets
        canManageRuntimeSettings
        canManageMcp
        canManageModelConfig
        {...props}
    />,
);

const openMcpActionsMenu = async () => {
    await userEvent.click(screen.getByRole('button', { name: /操作/ }));
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
        createModelConfig.mockReset();
        getBeeGameSubagentsEnabled.mockReturnValue(true);
        setBeeGameSubagentsEnabled.mockReset();
        setBeeGameWorkspaceRoot.mockReset();
        resetBeeGameWorkspaceRoot.mockReset();
        updateModelConfig.mockReset();
        updateMcpServer.mockReset();
        listWorkspaceMembers.mockReset();
        listWorkspaceMembers.mockResolvedValue([]);
        upsertWorkspaceMember.mockReset();
        upsertWorkspaceMember.mockResolvedValue({
            workspaceId: 'workspace-1',
            userId: 'user-2',
            role: 'developer',
            createdAt: '2026-06-27T00:00:00.000Z',
        });
        deleteWorkspaceMember.mockReset();
        deleteWorkspaceMember.mockResolvedValue({ deleted: true });
    });

    it('renders the settings panel as a centered modal overlay', () => {
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
        expect(screen.queryByRole('tab', { name: '账户' })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '成员' })).not.toBeInTheDocument();
        expect(screen.getByRole('tab', { name: '能力' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'MCP' })).toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '工作区' })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '网页' })).not.toBeInTheDocument();
        expect(screen.queryByText('深色模式')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Subagents')).not.toBeInTheDocument();
        expect(screen.queryByRole('switch', { name: 'Auto Memory' })).not.toBeInTheDocument();
        expect(screen.queryByText('Let the runtime decide when delegation is useful. BeeGame will not force it.')).not.toBeInTheDocument();
        expect(screen.queryByText('BeeGame 会把 Brave key 注入新启动的 runtime session。已有会话不会自动重启。')).not.toBeInTheDocument();
        expect(screen.getByLabelText('工作路径')).toBeInTheDocument();
        expect(screen.getByLabelText('搜索后端')).toBeInTheDocument();
        expect(screen.queryByLabelText('配置名称')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '保存工作路径' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '保存网页配置' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '选择工作路径' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: '保存设置' })).toBeInTheDocument();
    });

    it('hides privileged settings sections when the user lacks management permissions', () => {
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
            canManageModelConfig: false,
        });

        expect(screen.getByRole('tab', { name: '通用' })).toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '能力' })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: 'MCP' })).not.toBeInTheDocument();
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
        expect(listWorkspaceMembers).not.toHaveBeenCalled();
    });

    it('keeps normal settings limited to personal preferences', () => {
        listModelConfigs.mockClear();
        getBeeGameWorkspaceSettings.mockClear();
        getWebToolsConfig.mockClear();
        getRuntimeSettings.mockClear();
        listMcpServers.mockClear();

        renderSettings({
            mode: 'settings',
            canManageWorkspace: true,
            canManageSecrets: true,
            canManageRuntimeSettings: true,
            canManageMcp: true,
            canManageModelConfig: true,
            canManageWorkspaceMembers: true,
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
        expect(listWorkspaceMembers).not.toHaveBeenCalled();
    });

    it('manages workspace members when the user has member permissions', async () => {
        listWorkspaceMembers.mockResolvedValue([
            {
                workspaceId: 'workspace-1',
                userId: 'user-1',
                role: 'owner',
                createdAt: '2026-06-27T00:00:00.000Z',
            },
            {
                workspaceId: 'workspace-1',
                userId: 'user-2',
                role: 'developer',
                createdAt: '2026-06-27T00:00:00.000Z',
            },
        ]);
        renderSettings({ canManageWorkspaceMembers: true });

        await userEvent.click(screen.getByRole('tab', { name: '成员' }));

        expect(await screen.findByText('user-1')).toBeInTheDocument();
        expect(screen.getByText('user-2')).toBeInTheDocument();
        expect(screen.getAllByText('developer').length).toBeGreaterThan(0);

        await userEvent.type(screen.getByLabelText('成员 User ID'), 'user-3');
        await userEvent.selectOptions(screen.getByLabelText('成员角色'), 'reviewer');
        await userEvent.click(screen.getByRole('button', { name: '保存成员' }));

        expect(upsertWorkspaceMember).toHaveBeenCalledWith('user-3', 'reviewer');
        await waitFor(() => {
            expect(listWorkspaceMembers).toHaveBeenCalledTimes(2);
        });

        await userEvent.click(screen.getByRole('button', { name: '移除 user-2' }));
        expect(deleteWorkspaceMember).toHaveBeenCalledWith('user-2');
    });

    it('keeps the settings chrome and controls visually consistent', async () => {
        const onClose = vi.fn();
        const { container } = renderSettings({ onClose });

        await userEvent.click(screen.getByRole('button', { name: '关闭设置' }));
        expect(onClose).toHaveBeenCalledTimes(1);

        const saveButton = screen.getByRole('button', { name: '保存设置' });
        expect(saveButton.querySelector('svg')).toBeNull();
        expect(container.querySelector('.bg-black')).toBeNull();
    });

    it('does not close when clicking outside the settings panel', async () => {
        const onClose = vi.fn();
        renderSettings({ onClose });

        await userEvent.click(screen.getByRole('dialog', { name: '系统设置' }));

        expect(onClose).not.toHaveBeenCalled();
    });

    it('closes after saving settings successfully', async () => {
        const onClose = vi.fn();
        setBeeGameWorkspaceRoot.mockReturnValue({
            workspacePath: '/tmp/beegame-projects',
            isDefault: true,
        });
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
        await userEvent.click(screen.getByRole('tab', { name: '能力' }));

        await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });

    it('renders capabilities as a dedicated settings tab', async () => {
        renderSettings();

        await userEvent.click(screen.getByRole('tab', { name: '能力' }));

        expect(screen.getByRole('tab', { name: '能力' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('switch', { name: 'Subagents' })).toBeChecked();
        expect(screen.getByRole('switch', { name: 'Auto Memory' })).toBeChecked();
        expect(screen.getByRole('switch', { name: 'Auto Dream' })).toBeChecked();
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

        await userEvent.click(screen.getByRole('tab', { name: 'MCP' }));

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
        await userEvent.click(screen.getByRole('tab', { name: 'MCP' }));
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
        await userEvent.click(screen.getByRole('tab', { name: 'MCP' }));

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
        setBeeGameWorkspaceRoot.mockReturnValue({
            workspacePath: '/tmp/beegame-projects',
            isDefault: true,
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
        await userEvent.click(screen.getByRole('tab', { name: '能力' }));

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

    it('saves general settings from the footer and can reset to the default Projects path', async () => {
        getBeeGameWorkspaceSettings.mockResolvedValueOnce({
            workspacePath: '/tmp/beegame-projects',
            isDefault: true,
        });
        resetBeeGameWorkspaceRoot.mockResolvedValue({
            workspacePath: '/tmp/beegame-projects',
            isDefault: true,
        });
        setBeeGameWorkspaceRoot.mockReturnValue({
            workspacePath: '/tmp/custom-beegame-projects',
            isDefault: false,
        });

        renderSettings();

        const input = await screen.findByLabelText('工作路径');
        expect(input).toHaveValue('/tmp/beegame-projects');

        await userEvent.clear(input);
        await userEvent.type(input, '/tmp/custom-beegame-projects');
        await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

        await waitFor(() => expect(setBeeGameWorkspaceRoot).toHaveBeenCalledWith('/tmp/custom-beegame-projects'));
        await waitFor(() => expect(saveWebToolsConfig).toHaveBeenCalledWith({
            webSearchAdapter: 'tavily',
        }));
        expect(saveRuntimeSettings).not.toHaveBeenCalled();
        expect(setBeeGameSubagentsEnabled).not.toHaveBeenCalled();
        expect(screen.queryByText('工作路径已保存')).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: '恢复默认' }));

        await waitFor(() => expect(resetBeeGameWorkspaceRoot).toHaveBeenCalled());
        expect(input).toHaveValue('/tmp/beegame-projects');
        expect(screen.queryByText('已恢复默认工作路径')).not.toBeInTheDocument();
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

        await userEvent.click(screen.getByRole('tab', { name: '模型' }));

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
        await userEvent.click(screen.getByRole('tab', { name: '模型' }));

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
