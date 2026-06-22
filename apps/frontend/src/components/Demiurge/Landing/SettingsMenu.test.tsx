import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsMenu } from './SettingsMenu';

const {
    createModelConfig,
    getBeeGameWorkspaceSettings,
    listModelConfigs,
    resetBeeGameWorkspaceRoot,
    setBeeGameWorkspaceRoot,
} = vi.hoisted(() => ({
    createModelConfig: vi.fn(),
    getBeeGameWorkspaceSettings: vi.fn(),
    listModelConfigs: vi.fn(),
    resetBeeGameWorkspaceRoot: vi.fn(),
    setBeeGameWorkspaceRoot: vi.fn(),
}));

const desktopBridge = {
    chooseWorkspacePath: vi.fn(),
};

vi.mock('../../../services/modelConfigApi', () => ({
    createModelConfig,
    listModelConfigs,
}));

vi.mock('../../../services/beeGameAdapter', () => ({
    getBeeGameWorkspaceSettings,
    resetBeeGameWorkspaceRoot,
    setBeeGameWorkspaceRoot,
}));

const renderSettings = () => render(
    <SettingsMenu
        isOpen
        lang="zh"
        isDark={false}
        onClose={vi.fn()}
        onToggleTheme={vi.fn()}
        onSetLang={vi.fn()}
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
        setBeeGameWorkspaceRoot.mockReset();
        resetBeeGameWorkspaceRoot.mockReset();
    });

    it('keeps the landing page visible behind the settings popover', () => {
        renderSettings();

        const dialog = screen.getByRole('dialog', { name: '系统设置' });
        expect(dialog.className).toContain('bg-transparent');
        expect(dialog.className).not.toContain('dark:bg-zinc-950');
        expect(dialog.className).not.toContain('bg-white');
    });

    it('saves a custom BeeGame workspace root and can reset to the default Projects path', async () => {
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

        desktopBridge.chooseWorkspacePath.mockResolvedValue('/tmp/chosen-beegame-projects');
        await userEvent.click(screen.getByRole('button', { name: '选择工作路径' }));
        expect(input).toHaveValue('/tmp/chosen-beegame-projects');

        await userEvent.clear(input);
        await userEvent.type(input, '/tmp/custom-beegame-projects');
        await userEvent.click(screen.getByRole('button', { name: '保存工作路径' }));

        await waitFor(() => expect(setBeeGameWorkspaceRoot).toHaveBeenCalledWith('/tmp/custom-beegame-projects'));
        expect(await screen.findByText('工作路径已保存')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: '恢复默认' }));

        await waitFor(() => expect(resetBeeGameWorkspaceRoot).toHaveBeenCalled());
        expect(input).toHaveValue('/tmp/beegame-projects');
    });

    it('saves a default BeeGame OpenAI-compatible model config', async () => {
        createModelConfig.mockResolvedValue({
            id: 'llm_1',
            name: 'My LLM',
            provider: 'openai-compatible',
            apiKeyPreview: 'sk-...cret',
            models: { balanced: 'gpt-4.1' },
            isDefault: true,
        });

        renderSettings();

        await userEvent.type(screen.getByLabelText('配置名称'), 'My LLM');
        await userEvent.type(screen.getByLabelText('Base URL'), 'https://api.example.com/v1');
        await userEvent.type(screen.getByLabelText('API Key'), 'sk-secret');
        await userEvent.type(screen.getByLabelText('Balanced Model'), 'gpt-4.1');
        await userEvent.click(screen.getByRole('button', { name: '保存模型配置' }));

        await waitFor(() => expect(createModelConfig).toHaveBeenCalledWith({
            name: 'My LLM',
            provider: 'openai-compatible',
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'sk-secret',
            models: { balanced: 'gpt-4.1' },
            isDefault: true,
        }));
        expect(await screen.findByText('模型配置已保存')).toBeInTheDocument();
    });
});
