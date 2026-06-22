import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SettingsMenu } from './SettingsMenu';

const { createModelConfig, listModelConfigs } = vi.hoisted(() => ({
    createModelConfig: vi.fn(),
    listModelConfigs: vi.fn(),
}));

vi.mock('../../../services/modelConfigApi', () => ({
    createModelConfig,
    listModelConfigs,
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
    it('saves a default BeeGame OpenAI-compatible model config', async () => {
        listModelConfigs.mockResolvedValue([]);
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
