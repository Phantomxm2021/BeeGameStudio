import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsMenu } from './SettingsMenu';

const {
    createModelConfig,
    getBeeGameWorkspaceSettings,
    getBeeGameSubagentsEnabled,
    getWebToolsConfig,
    listModelConfigs,
    resetBeeGameWorkspaceRoot,
    saveWebToolsConfig,
    setBeeGameSubagentsEnabled,
    setBeeGameWorkspaceRoot,
    updateModelConfig,
} = vi.hoisted(() => ({
    createModelConfig: vi.fn(),
    getBeeGameWorkspaceSettings: vi.fn(),
    getBeeGameSubagentsEnabled: vi.fn(),
    getWebToolsConfig: vi.fn(),
    listModelConfigs: vi.fn(),
    resetBeeGameWorkspaceRoot: vi.fn(),
    saveWebToolsConfig: vi.fn(),
    setBeeGameSubagentsEnabled: vi.fn(),
    setBeeGameWorkspaceRoot: vi.fn(),
    updateModelConfig: vi.fn(),
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

const renderSettings = (props: Partial<ComponentProps<typeof SettingsMenu>> = {}) => render(
    <SettingsMenu
        isOpen
        lang="zh"
        onClose={vi.fn()}
        onSetLang={vi.fn()}
        {...props}
    />,
);

describe('SettingsMenu model settings', () => {
    beforeEach(() => {
        Object.assign(window, { BeeGameDesktop: desktopBridge });
        desktopBridge.chooseWorkspacePath.mockReset();
        listModelConfigs.mockResolvedValue([]);
        getBeeGameWorkspaceSettings.mockResolvedValue({
            workspacePath: '/tmp/beegame-projects',
            isDefault: true,
        });
        getWebToolsConfig.mockResolvedValue({});
        saveWebToolsConfig.mockReset();
        createModelConfig.mockReset();
        getBeeGameSubagentsEnabled.mockReturnValue(true);
        setBeeGameSubagentsEnabled.mockReset();
        setBeeGameWorkspaceRoot.mockReset();
        resetBeeGameWorkspaceRoot.mockReset();
        updateModelConfig.mockReset();
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
        expect(screen.queryByRole('tab', { name: '工作区' })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '网页' })).not.toBeInTheDocument();
        expect(screen.queryByText('深色模式')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Enable subagents')).toBeInTheDocument();
        expect(screen.queryByText('Let the runtime decide when delegation is useful. BeeGame will not force it.')).not.toBeInTheDocument();
        expect(screen.queryByText('BeeGame 会把 Brave key 注入新启动的 runtime session。已有会话不会自动重启。')).not.toBeInTheDocument();
        expect(screen.getByLabelText('工作路径')).toBeInTheDocument();
        expect(screen.getByLabelText('Search Backend')).toBeInTheDocument();
        expect(screen.queryByLabelText('配置名称')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '保存工作路径' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '保存网页配置' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '选择工作路径' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: '保存设置' })).toBeInTheDocument();
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

        renderSettings({ onClose });

        await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
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
        expect(setBeeGameSubagentsEnabled).toHaveBeenCalledWith(true);
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
        expect(screen.getByLabelText('Fast Model')).toBeInTheDocument();
        expect(screen.getByLabelText('Balanced Model')).toBeInTheDocument();
        expect(screen.getByLabelText('Strong Model')).toBeInTheDocument();

        await userEvent.type(screen.getByLabelText('Base URL'), 'https://api.example.com/v1');
        await userEvent.type(screen.getByLabelText('API Key'), 'sk-secret');
        await userEvent.type(screen.getByLabelText('Fast Model'), 'gpt-4.1-mini');
        await userEvent.type(screen.getByLabelText('Balanced Model'), 'gpt-4.1');
        await userEvent.type(screen.getByLabelText('Strong Model'), 'gpt-4.1-pro');
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

        const modelInput = screen.getByLabelText('Balanced Model');
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
        await userEvent.selectOptions(screen.getByLabelText('Search Backend'), 'brave');
        await userEvent.type(screen.getByLabelText('BRAVE_SEARCH_API_KEY'), 'bsa-dashboard-secret');
        await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

        await waitFor(() => expect(saveWebToolsConfig).toHaveBeenCalledWith({
            webSearchAdapter: 'brave',
            braveApiKey: 'bsa-dashboard-secret',
        }));
        expect(screen.queryByText('网页搜索配置已保存；新会话生效。')).not.toBeInTheDocument();

        await userEvent.selectOptions(screen.getByLabelText('Search Backend'), 'exa');
        expect(screen.getByLabelText('EXA_API_KEY')).toBeInTheDocument();
    });
});
