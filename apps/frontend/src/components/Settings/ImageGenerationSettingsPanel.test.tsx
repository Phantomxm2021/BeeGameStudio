import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { ImageGenerationSettingsPanel, type ImageSettingsHandle, type ImageSettingsState } from './ImageGenerationSettingsPanel';
import { getImageGenerationSettings, saveImageGenerationSettings, type ImageGenerationSettings } from '../../services/imageGenerationApi';
vi.mock('../../services/imageGenerationApi', () => ({ getImageGenerationSettings: vi.fn(), saveImageGenerationSettings: vi.fn() }));
const config: ImageGenerationSettings = { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-2.5-flare', quality: 'medium', size: '1024x1024', hasApiKey: true };
const onSaved = vi.fn();
function Harness() {
  const ref = useRef<ImageSettingsHandle>(null);
  const [state, setState] = useState<ImageSettingsState>({ busy: false, canSave: false });
  return <><ImageGenerationSettingsPanel ref={ref} language="zh" onStateChange={setState} /><button disabled={!state.canSave || state.busy} onClick={async () => { if (await ref.current?.save()) onSaved(); }}>保存设置</button></>;
}
async function choose(name: string) {
  await userEvent.click(screen.getByRole('button', { name: 'Provider' }));
  await userEvent.click(await screen.findByRole('option', { name, exact: true }));
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getImageGenerationSettings).mockImplementation(async provider => provider && provider !== 'openai'
    ? { ...config, provider, model: provider + '-model', baseUrl: 'https://' + provider + '.example/v1', hasApiKey: false,
      ...(provider === 'cloudflare' ? { fixedPricePresets: { 'low:1024x1024': 3, 'low:1024x1536': 4,
        'low:1536x1024': 4, 'medium:1024x1024': 8, 'medium:1024x1536': 10, 'medium:1536x1024': 10 } } : {}) }
    : config);
  vi.mocked(saveImageGenerationSettings).mockImplementation(async input => ({ ...input, hasApiKey: Boolean(input.apiKey) || config.hasApiKey }));
});
describe('image settings', () => {
  it('uses the parent save action and preserves omitted credentials', async () => {
    render(<Harness />);
    await screen.findByDisplayValue(config.model);
    expect(screen.queryByRole('button', { name: '保存生图配置' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(vi.mocked(saveImageGenerationSettings).mock.calls[0][0]).not.toHaveProperty('apiKey');
  });
  it('keeps independent provider drafts and does not save on selection', async () => {
    render(<Harness />);
    await screen.findByDisplayValue(config.model);
    await userEvent.type(screen.getByLabelText('API Key'), 'openai-draft-key');
    await choose('Vercel AI Gateway');
    await screen.findByDisplayValue('vercel-model');
    expect(screen.getByLabelText('API Key')).toHaveValue('');
    expect(screen.queryByLabelText('清除已保存 Key')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://vercel.example/v1');
    await userEvent.type(screen.getByLabelText('API Key'), 'vercel-draft-key');
    await choose('Cloudflare AI Gateway');
    await screen.findByDisplayValue('cloudflare-model');
    expect(screen.getByLabelText('Upstream API Key')).toHaveValue('');
    await choose('OpenAI');
    expect(screen.getByLabelText('API Key')).toHaveValue('openai-draft-key');
    expect(saveImageGenerationSettings).not.toHaveBeenCalled();
    await choose('Vercel AI Gateway');
    expect(screen.getByLabelText('API Key')).toHaveValue('vercel-draft-key');
    await userEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(saveImageGenerationSettings).toHaveBeenCalledWith(expect.objectContaining({ provider: 'vercel', apiKey: 'vercel-draft-key' })));
    expect(screen.getByLabelText('API Key')).toHaveValue('');
  });
  it('configures independent USD-per-million image token rates', async () => {
    render(<Harness />);
    await screen.findByDisplayValue(config.model);
    await choose('OpenRouter');
    await screen.findByDisplayValue('openrouter-model');
    await userEvent.click(screen.getByRole('switch', { name: '配置图片计费（未配置时不允许提交生成）' }));
    expect(screen.getByLabelText('文本输入')).toHaveValue(5);
    expect(screen.getByLabelText('缓存文本输入')).toHaveValue(1.25);
    expect(screen.getByLabelText('图片输入')).toHaveValue(8);
    expect(screen.getByLabelText('缓存图片输入')).toHaveValue(3);
    expect(screen.getByLabelText('图片输出')).toHaveValue(30);
    expect(screen.getByLabelText('模型价格倍率')).toHaveValue(1.5);
    expect(screen.queryByLabelText('Credits / USD')).not.toBeInTheDocument();
  });
  it('shows editable Cloudflare fixed Credit prices instead of token rates', async () => {
    render(<Harness />);
    await screen.findByDisplayValue(config.model);
    await choose('Cloudflare AI Gateway');
    await screen.findByDisplayValue('cloudflare-model');
    await userEvent.click(screen.getByRole('switch', { name: '配置图片计费（未配置时不允许提交生成）' }));
    expect(screen.getByLabelText('medium:1024x1024 Credits')).toHaveValue(8);
    expect(screen.getByLabelText('low:1024x1536 Credits')).toHaveValue(4);
    expect(screen.queryByLabelText('图片输出')).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('medium:1024x1024 Credits'));
    await userEvent.type(screen.getByLabelText('medium:1024x1024 Credits'), '9');
    await userEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(saveImageGenerationSettings).toHaveBeenCalledWith(expect.objectContaining({
      billing: expect.objectContaining({ fixedCreditsByVariant: expect.objectContaining({ 'medium:1024x1024': 9 }) }),
    })));
  });
  it('keeps the form open and uses the global destructive status style on failure', async () => {
    vi.mocked(saveImageGenerationSettings).mockRejectedValue(new Error('not shown raw'));
    render(<Harness />);
    await screen.findByDisplayValue(config.model);
    await userEvent.click(screen.getByRole('button', { name: '保存设置' }));
    expect(await screen.findByRole('alert')).toHaveClass('text-destructive');
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '保存设置' })).toBeEnabled();
  });
});
