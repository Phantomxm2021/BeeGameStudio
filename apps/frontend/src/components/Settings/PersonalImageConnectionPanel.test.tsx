import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonalImageConnectionPanel, type PersonalImageConnectionHandle, type PersonalImageConnectionSaveState } from './PersonalImageConnectionPanel';
import { getPersonalImageConnection, savePersonalImageConnection } from '../../services/imageGenerationApi';
const { showError } = vi.hoisted(() => ({ showError: vi.fn() }));
vi.mock('../../contexts/ToastContext', () => ({ useToastContext: () => ({ showError }) }));

vi.mock('../../services/imageGenerationApi', () => ({ getPersonalImageConnection: vi.fn(), savePersonalImageConnection: vi.fn() }));
const initial = { source: 'platform' as const, provider: 'openai' as const,
  baseUrl: 'https://api.openai.com/v1/images/generations', model: 'image-model', hasApiKey: false, hasUpstreamApiKey: false };

function Harness() {
  const ref = useRef<PersonalImageConnectionHandle>(null);
  const [state, setState] = useState<PersonalImageConnectionSaveState>({ busy: false, disabled: true });
  return <><PersonalImageConnectionPanel ref={ref} language="zh" onSaveStateChange={setState} />
    <button disabled={state.disabled} onClick={() => void ref.current?.save()}>保存设置</button></>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPersonalImageConnection).mockResolvedValue(initial);
  vi.mocked(savePersonalImageConnection).mockImplementation(async input => ({ ...initial, ...input, hasApiKey: Boolean(input.apiKey) }));
});

describe('personal image connection', () => {
  it('defaults to the platform and saves without exposing administrator settings', async () => {
    render(<Harness />);
    expect(await screen.findByRole('radio', { name: /平台提供/ })).toBeChecked();
    expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument();
    expect(screen.queryByText('模型价格倍率')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(savePersonalImageConnection).toHaveBeenCalledWith({ source: 'platform' }));
  });

  it('requires a personal key and sends it only after saving BYOK', async () => {
    render(<Harness />);
    await screen.findByRole('radio', { name: /平台提供/ });
    await userEvent.click(screen.getByRole('radio', { name: /自带 API Key/ }));
    expect(screen.getByRole('button', { name: '保存设置' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('API Key'), 'personal-key');
    expect(screen.getByRole('button', { name: '保存设置' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(savePersonalImageConnection).toHaveBeenCalledWith(expect.objectContaining({
      source: 'byok', provider: 'openai', apiKey: 'personal-key', model: 'image-model',
    })));
    expect(screen.getByLabelText('API Key')).toHaveValue('');
  });

  it('reports a save failure through the global toast', async () => {
    vi.mocked(savePersonalImageConnection).mockRejectedValue(new Error('offline'));
    render(<Harness />);
    await screen.findByRole('radio', { name: /平台提供/ });
    await userEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(showError).toHaveBeenCalledWith('保存失败，请核对服务商、接口 URL、模型及 API Key。'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});


it('keeps desktop edits local, reports failure in place and allows cancellation', async () => {
  vi.mocked(savePersonalImageConnection).mockRejectedValueOnce(new Error('offline'));
  render(<PersonalImageConnectionPanel desktop language="zh" />);
  const source = screen.getByLabelText('生图连接方式');
  await waitFor(() => expect(source).toBeEnabled());
  await userEvent.selectOptions(source, 'byok');
  await userEvent.type(screen.getByLabelText('API Key'), 'desktop-fixture-key');
  expect(savePersonalImageConnection).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '保存连接' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('保存失败');
  expect(screen.getByLabelText('API Key')).toHaveValue('desktop-fixture-key');
  expect(showError).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(source).toHaveValue('platform');
  expect(screen.queryByRole('button', { name: '保存连接' })).not.toBeInTheDocument();
});
