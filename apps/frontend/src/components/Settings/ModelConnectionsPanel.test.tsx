import { createRef } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { ModelConnectionsPanel, type ModelConnectionsHandle } from './ModelConnectionsPanel';
import * as api from '../../services/modelConfigApi';

vi.mock('../../services/modelConfigApi', () => ({
  listModelCatalog: vi.fn(), saveModelConnection: vi.fn(),
  startModelLogin: vi.fn(), readModelLogin: vi.fn(), completeModelLogin: vi.fn(), cancelModelLogin: vi.fn(),
}));
vi.mock('../beui/project-select', () => ({ ProjectSelect: ({ ariaLabel, value, options, onValueChange, disabled }: any) => <select aria-label={ariaLabel} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>{options.map((item: any) => <option key={item.value} value={item.value}>{item.label}</option>)}</select> }));

const connection = (method: api.ModelAuthMethod = 'platform', extra: Partial<api.ModelConnectionStatus> = {}): api.ModelConnectionStatus => ({ method, hasKey: false, isPreferred: false, claudeConnected: false, chatgptConnected: false, ...extra });
const catalog = (): api.CatalogModel[] => [
  { id: 'official', name: 'Published Claude', provider: 'anthropic-compatible', models: { balanced: 'published' }, apiKeyPreview: '', isDefault: true, authMethods: ['platform'], connection: connection() },
  { id: 'personal-byok', name: 'BYOK', provider: 'openai-compatible', models: {}, apiKeyPreview: '', isDefault: false, authMethods: ['byok'], connection: connection() },
  { id: 'personal-claude-subscription', name: 'Claude subscription', provider: 'anthropic-compatible', models: {}, apiKeyPreview: '', isDefault: false, authMethods: ['claude-subscription'], connection: connection() },
  { id: 'personal-chatgpt-subscription', name: 'ChatGPT subscription', provider: 'openai-compatible', models: {}, apiKeyPreview: '', isDefault: false, authMethods: ['chatgpt-subscription'], connection: connection() },
];
const waitForCatalog = async () => { await act(async () => { await vi.mocked(api.listModelCatalog).mock.results[0]?.value; }); };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listModelCatalog).mockResolvedValue(catalog());
  vi.mocked(api.saveModelConnection).mockResolvedValue(connection('byok', { hasKey: true, isPreferred: true }));
  vi.mocked(api.cancelModelLogin).mockResolvedValue({});
});

it('shows three connection types and keeps official as the default', async () => {
  render(<ModelConnectionsPanel language="en" />);
  await waitForCatalog();
  expect(screen.getByLabelText('Connection type')).toHaveValue('official');
  expect(screen.getAllByRole('combobox')).toHaveLength(1);
  expect(screen.getByRole('option', { name: 'Bee Game Studio LLM' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Published Claude' })).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'BYOK' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Subscribe' })).toBeInTheDocument();
  expect(api.saveModelConnection).not.toHaveBeenCalled();
});

it('saves one independent BYOK config with provider, URL, key and three tiers', async () => {
  const ref = createRef<ModelConnectionsHandle>();
  render(<><ModelConnectionsPanel ref={ref} language="en" /><button onClick={() => ref.current?.saveByok()}>Footer save</button></>);
  await waitForCatalog();
  await userEvent.selectOptions(screen.getByLabelText('Connection type'), 'byok');
  await userEvent.selectOptions(screen.getByLabelText('Provider'), 'openai-compatible');
  await userEvent.type(screen.getByLabelText('Base URL'), 'https://personal.example/v1');
  await userEvent.type(screen.getByLabelText('API Key'), 'user-fixture-secret');
  await userEvent.type(screen.getByLabelText('Fast model'), 'fast-id');
  await userEvent.type(screen.getByLabelText('Balanced model'), 'balanced-id');
  await userEvent.type(screen.getByLabelText('Strong model'), 'strong-id');
  expect(screen.queryByRole('button', { name: 'Save BYOK' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Footer save' }));
  await waitFor(() => expect(api.saveModelConnection).toHaveBeenCalledWith('personal-byok', 'byok', 'user-fixture-secret', true, { provider: 'openai-compatible', baseUrl: 'https://personal.example/v1', models: { fast: 'fast-id', balanced: 'balanced-id', strong: 'strong-id' } }));
  expect(screen.getByLabelText('API Key')).toHaveValue('');
});

it('returns to the published official model without exposing a second selector', async () => {
  const result = catalog();
  result[1] = { ...result[1], isDefault: true, connection: connection('byok', { hasKey: true, isPreferred: true, baseUrl: 'https://personal.example/v1', models: { fast: 'fast', balanced: 'balanced', strong: 'strong' } }) };
  vi.mocked(api.listModelCatalog).mockResolvedValue(result);
  render(<ModelConnectionsPanel language="en" />);
  expect(await screen.findByLabelText('Base URL')).toHaveValue('https://personal.example/v1');
  await userEvent.selectOptions(screen.getByLabelText('Connection type'), 'official');
  expect(screen.getAllByRole('combobox')).toHaveLength(1);
  await waitFor(() => expect(api.saveModelConnection).toHaveBeenCalledWith('official', 'platform', undefined, true, undefined));
});

it('loads and edits saved personal tiers without re-entering an unchanged key', async () => {
  const result = catalog();
  result[1] = { ...result[1], isDefault: true, connection: connection('byok', { hasKey: true, isPreferred: true, baseUrl: 'https://personal.example/v1', models: { fast: 'fast', balanced: 'balanced', strong: 'strong' } }) };
  vi.mocked(api.listModelCatalog).mockResolvedValue(result);
  const ref = createRef<ModelConnectionsHandle>();
  render(<><ModelConnectionsPanel ref={ref} language="en" /><button onClick={() => ref.current?.saveByok()}>Footer save</button></>);
  expect(await screen.findByLabelText('Base URL')).toHaveValue('https://personal.example/v1');
  await userEvent.clear(screen.getByLabelText('Strong model'));
  await userEvent.type(screen.getByLabelText('Strong model'), 'strong-new');
  await userEvent.click(screen.getByRole('button', { name: 'Footer save' }));
  await waitFor(() => expect(api.saveModelConnection).toHaveBeenCalledWith('personal-byok', 'byok', '', true, { provider: 'openai-compatible', baseUrl: 'https://personal.example/v1', models: { fast: 'fast', balanced: 'balanced', strong: 'strong-new' } }));
});

it('supports Claude subscription authorization independently of official models', async () => {
  vi.mocked(api.startModelLogin).mockResolvedValue({ id: 'login', url: 'https://claude.ai/oauth/authorize?state=fixture', method: 'claude-subscription' });
  vi.mocked(api.completeModelLogin).mockResolvedValue({ status: 'complete' });
  render(<ModelConnectionsPanel language="en" />);
  await waitForCatalog();
  await userEvent.selectOptions(screen.getByLabelText('Connection type'), 'subscribe');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('link', { name: 'Open provider authorization' })).toHaveAttribute('href', 'https://claude.ai/oauth/authorize?state=fixture');
  await userEvent.type(screen.getByLabelText('Claude code#state'), 'code#fixture');
  await userEvent.click(screen.getByRole('button', { name: 'Complete login' }));
  await waitFor(() => expect(api.saveModelConnection).toHaveBeenCalledWith('personal-claude-subscription', 'claude-subscription', undefined, true, undefined));
});

it('cancels an unfinished subscription login when the panel closes', async () => {
  vi.mocked(api.startModelLogin).mockResolvedValue({ id: 'login', url: 'https://claude.ai/oauth/authorize', method: 'claude-subscription' });
  const rendered = render(<ModelConnectionsPanel language="en" />);
  await waitForCatalog();
  await userEvent.selectOptions(screen.getByLabelText('Connection type'), 'subscribe');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('link', { name: 'Open provider authorization' });
  rendered.unmount();
  expect(api.cancelModelLogin).toHaveBeenCalledWith('login');
});

it('supports ChatGPT device login and activates the subscription', async () => {
  vi.mocked(api.startModelLogin).mockResolvedValue({ id: 'device-login', url: 'https://auth.openai.com/codex/device', userCode: 'DEVICE-CODE', method: 'chatgpt-subscription' });
  vi.mocked(api.readModelLogin).mockResolvedValue({ status: 'complete' });
  render(<ModelConnectionsPanel language="en" />);
  await waitForCatalog();
  await userEvent.selectOptions(screen.getByLabelText('Connection type'), 'subscribe');
  await userEvent.selectOptions(screen.getByLabelText('Subscription account'), 'personal-chatgpt-subscription');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText('DEVICE-CODE')).toBeInTheDocument();
  await waitFor(() => expect(api.saveModelConnection).toHaveBeenCalledWith('personal-chatgpt-subscription', 'chatgpt-subscription', undefined, true), { timeout: 3500 });
});
