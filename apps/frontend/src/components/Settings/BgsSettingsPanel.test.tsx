import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { BgsSettingsPanel, type BgsSettingsHandle, type BgsSettingsSaveState } from './BgsSettingsPanel';
import * as api from '../../services/bgsSettingsApi';

vi.mock('../../services/bgsSettingsApi', () => ({ getBgsSettings: vi.fn(), saveBgsSettings: vi.fn() }));
const settings = { model: 'fixture-model', connectionKey: 'owner-connection', efforts: ['low', 'high'], effort: null };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(api.getBgsSettings).mockResolvedValue(settings); });

function Harness({ language }: { language: string }) {
  const ref = useRef<BgsSettingsHandle>(null);
  const [state, setState] = useState<BgsSettingsSaveState>({ busy: false, disabled: true });
  return <><BgsSettingsPanel ref={ref} language={language} onSaveStateChange={setState} />
    <button disabled={state.disabled} onClick={() => void ref.current?.save()}>Save reasoning settings</button></>;
}

it('shows only advertised efforts and saves for the selected connection', async () => {
  vi.mocked(api.saveBgsSettings).mockResolvedValue({ ...settings, effort: 'high' });
  render(<Harness language="en" />);
  await waitFor(() => expect(screen.getByLabelText('Reasoning effort')).toBeEnabled());
  expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['BGS default', 'low', 'high']);
  fireEvent.change(screen.getByLabelText('Reasoning effort'), { target: { value: 'high' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save reasoning settings' }));
  await waitFor(() => expect(api.saveBgsSettings).toHaveBeenCalledWith('owner-connection', 'high'));
  expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
});

it('retains defaults for providers without verified reasoning metadata', async () => {
  vi.mocked(api.getBgsSettings).mockResolvedValue({ ...settings, efforts: [] });
  render(<Harness language="zh" />);
  expect(await screen.findByText('当前连接未提供可确认的推理档位，保持默认。')).toBeInTheDocument();
  expect(screen.getByLabelText('推理强度')).toBeDisabled();
  expect(api.saveBgsSettings).not.toHaveBeenCalled();
});

it('allows clearing a saved effort after its model stops advertising it', async () => {
  vi.mocked(api.getBgsSettings).mockResolvedValue({ ...settings, efforts: [], effort: 'high' });
  vi.mocked(api.saveBgsSettings).mockResolvedValue({ ...settings, efforts: [] });
  render(<Harness language="en" />);
  await waitFor(() => expect(screen.getByLabelText('Reasoning effort')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Reasoning effort'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save reasoning settings' }));
  await waitFor(() => expect(api.saveBgsSettings).toHaveBeenCalledWith('owner-connection', null));
});
