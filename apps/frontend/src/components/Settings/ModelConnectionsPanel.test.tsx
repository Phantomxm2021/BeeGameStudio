import { OPENCODE_GO_ID, OPENCODE_GO_PROFILES } from '@bee-game-studio/agent-workflow/opencode-go';
import { createRef } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ModelConnectionsPanel, type ModelConnectionsHandle } from './ModelConnectionsPanel';
import * as api from '../../services/modelConfigApi';
const { showError } = vi.hoisted(() => ({ showError: vi.fn() }));
vi.mock('../../contexts/ToastContext', () => ({ useToastContext: () => ({ showError }) }));

vi.mock('../../services/modelConfigApi', () => ({
  listModelCatalog: vi.fn(), saveModelConnection: vi.fn(),
  startModelLogin: vi.fn(), readModelLogin: vi.fn(), completeModelLogin: vi.fn(), cancelModelLogin: vi.fn(), readClaudeSubscriptionUsage: vi.fn(),
}));
vi.mock('../beui/project-select', () => ({ ProjectSelect: ({ ariaLabel, value, options, onValueChange, disabled }: any) => <select aria-label={ariaLabel} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>{options.map((item: any) => <option key={item.value} value={item.value}>{item.label}</option>)}</select> }));

const connection = (method: api.ModelAuthMethod = 'platform', extra: Partial<api.ModelConnectionStatus> = {}): api.ModelConnectionStatus => ({ method, hasKey: false, isPreferred: false, claudeConnected: false, chatgptConnected: false, ...extra });
const catalog = (): api.CatalogModel[] => [
  { id: 'official', name: 'Published Claude', provider: 'anthropic-compatible', models: { balanced: 'published' }, apiKeyPreview: '', isDefault: true, authMethods: ['platform'], connection: connection() },
  { id: 'personal-byok', name: 'BYOK', provider: 'openai-compatible', models: {}, apiKeyPreview: '', isDefault: false, authMethods: ['byok'], connection: connection() },
  { id: 'personal-claude-subscription', name: 'Claude subscription', provider: 'anthropic-compatible', models: {}, apiKeyPreview: '', isDefault: false, authMethods: ['claude-subscription'], connection: connection() },
  { id: 'personal-chatgpt-subscription', name: 'ChatGPT subscription', provider: 'openai-compatible', models: {}, apiKeyPreview: '', isDefault: false, authMethods: ['chatgpt-subscription'], connection: connection() },
  { id: OPENCODE_GO_ID, name: 'OpenCode Go', provider: 'anthropic-compatible', baseUrl: OPENCODE_GO_PROFILES['anthropic-compatible'].baseUrl, models: OPENCODE_GO_PROFILES['anthropic-compatible'].defaults, apiKeyPreview: '', isDefault: false, authMethods: ['byok'], connection: connection() },
];
const waitForCatalog = async () => { await act(async () => { await vi.mocked(api.listModelCatalog).mock.results[0]?.value; }); };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listModelCatalog).mockResolvedValue(catalog());
  vi.mocked(api.saveModelConnection).mockResolvedValue(connection('byok', { hasKey: true, isPreferred: true }));
  vi.mocked(api.cancelModelLogin).mockResolvedValue({});
  vi.mocked(api.readClaudeSubscriptionUsage).mockResolvedValue({ usage: null });
});
afterEach(() => vi.restoreAllMocks());
const mockAuthorizationWindow = () => {
  const replace = vi.fn();
  const close = vi.fn();
  const open = vi.spyOn(window, 'open').mockReturnValue({ opener: null, location: { replace }, close } as unknown as Window);
  return { open, replace, close };
};

it('shows direct subscription choices and keeps official as the default', async () => {
  render(<ModelConnectionsPanel language="en" />);
  await waitForCatalog();
  expect(screen.getByLabelText('Connection type')).toHaveValue('official');
  expect(screen.getAllByRole('combobox')).toHaveLength(1);
  expect(screen.getByRole('option', { name: 'Bee Game Studio LLM' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Published Claude' })).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'BYOK' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Claude account with subscription' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'ChatGPT account with subscription' })).toBeInTheDocument();
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
  const authWindow = mockAuthorizationWindow();
  vi.mocked(api.startModelLogin).mockResolvedValue({ id: 'login', url: 'https://claude.ai/oauth/authorize?state=fixture', method: 'claude-subscription' });
  vi.mocked(api.completeModelLogin).mockResolvedValue({ status: 'complete' });
  render(<ModelConnectionsPanel language="en" />);
  await waitForCatalog();
  await userEvent.selectOptions(screen.getByLabelText('Connection type'), 'claude-subscription');
  expect(screen.queryByLabelText('Subscription account')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Continue with Claude' }));
  await waitFor(() => expect(authWindow.replace).toHaveBeenCalledWith('https://claude.ai/oauth/authorize?state=fixture'));
  expect(authWindow.open).toHaveBeenCalledWith('about:blank', '_blank');
  expect(screen.queryByRole('link', { name: 'Open provider authorization' })).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Claude code#state'), 'code#fixture');
  expect(screen.getByRole('region', { name: 'Authorization pending' })).toHaveTextContent('Complete authorization in the new tab');
  await userEvent.click(screen.getByRole('button', { name: 'Finish connecting' }));
  await waitFor(() => expect(api.saveModelConnection).toHaveBeenCalledWith('personal-claude-subscription', 'claude-subscription', undefined, true, undefined));
});

it('cancels an unfinished subscription login when the panel closes', async () => {
  const authWindow = mockAuthorizationWindow();
  vi.mocked(api.startModelLogin).mockResolvedValue({ id: 'login', url: 'https://claude.ai/oauth/authorize', method: 'claude-subscription' });
  const rendered = render(<ModelConnectionsPanel language="en" />);
  await waitForCatalog();
  await userEvent.selectOptions(screen.getByLabelText('Connection type'), 'claude-subscription');
  await userEvent.click(screen.getByRole('button', { name: 'Continue with Claude' }));
  await waitFor(() => expect(authWindow.replace).toHaveBeenCalledWith('https://claude.ai/oauth/authorize'));
  rendered.unmount();
  expect(api.cancelModelLogin).toHaveBeenCalledWith('login');
});

it('supports ChatGPT device login and activates the subscription', async () => {
  const authWindow = mockAuthorizationWindow();
  vi.mocked(api.startModelLogin).mockResolvedValue({ id: 'device-login', url: 'https://auth.openai.com/codex/device', userCode: 'DEVICE-CODE', method: 'chatgpt-subscription' });
  vi.mocked(api.readModelLogin).mockResolvedValue({ status: 'complete' });
  render(<ModelConnectionsPanel language="en" />);
  await waitForCatalog();
  await userEvent.selectOptions(screen.getByLabelText('Connection type'), 'chatgpt-subscription');
  await userEvent.click(screen.getByRole('button', { name: 'Continue with ChatGPT' }));
  await waitFor(() => expect(authWindow.replace).toHaveBeenCalledWith('https://auth.openai.com/codex/device'));
  expect(await screen.findByText('DEVICE-CODE')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Authorization pending' })).toHaveTextContent('Waiting for authorization');
  expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  await waitFor(() => expect(api.saveModelConnection).toHaveBeenCalledWith('personal-chatgpt-subscription', 'chatgpt-subscription', undefined, true), { timeout: 3500 });
});

it('does not start login when the browser blocks the authorization window', async () => {
  vi.spyOn(window, 'open').mockReturnValue(null);
  render(<ModelConnectionsPanel language="en" />);
  await waitForCatalog();
  await userEvent.selectOptions(screen.getByLabelText('Connection type'), 'chatgpt-subscription');
  await userEvent.click(screen.getByRole('button', { name: 'Continue with ChatGPT' }));
  expect(showError).toHaveBeenCalledWith('Allow pop-ups and try signing in again.');
  expect(api.startModelLogin).not.toHaveBeenCalled();
});

it('shows real Claude subscription usage when available and does not invent ChatGPT quota', async () => {
  const models = catalog();
  models[2] = { ...models[2], connection: connection('claude-subscription', { claudeConnected: true, isPreferred: true }) };
  models[3] = { ...models[3], connection: connection('chatgpt-subscription', { chatgptConnected: true }) };
  vi.mocked(api.listModelCatalog).mockResolvedValue(models);
  vi.mocked(api.readClaudeSubscriptionUsage).mockResolvedValue({ usage: { fiveHourUsedPercent: 42, sevenDayUsedPercent: 18 } });
  render(<ModelConnectionsPanel language="en" />);
  expect(await screen.findByText('5-hour usage: 42%')).toBeInTheDocument();
  expect(screen.getByText('7-day usage: 18%')).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Connection type'), 'chatgpt-subscription');
  expect(screen.queryByLabelText('Claude subscription usage')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'View ChatGPT usage' })).toHaveAttribute('href', 'https://chatgpt.com/settings/usage');
});

it('saves Go through the existing footer and restricts model choices to the selected protocol', async () => {
  const ref = createRef<ModelConnectionsHandle>();
  const saveState = vi.fn();
  render(<><ModelConnectionsPanel ref={ref} language="en" onSaveStateChange={saveState} /><button onClick={() => ref.current?.saveByok()}>Footer save</button></>);
  await waitForCatalog();
  await userEvent.selectOptions(screen.getByLabelText('Connection type'), 'opencode-go');
  expect(screen.queryByLabelText('Base URL')).not.toBeInTheDocument();
  expect(saveState).toHaveBeenLastCalledWith({ visible: true, disabled: true, busy: false });
  expect(screen.getByLabelText('Fast model')).toHaveValue('qwen3.8-flash');
  expect(screen.queryByRole('option', { name: 'kimi-k3' })).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Protocol'), 'openai-compatible');
  expect(screen.getByLabelText('Strong model')).toHaveValue('kimi-k3');
  expect(screen.queryByRole('option', { name: 'minimax-m3' })).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'gpt-6-luna' })).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('OpenCode Go API Key'), 'go-fixture-key');
  expect(saveState).toHaveBeenLastCalledWith({ visible: true, disabled: false, busy: false });
  await userEvent.click(screen.getByRole('button', { name: 'Footer save' }));
  await waitFor(() => expect(api.saveModelConnection).toHaveBeenCalledWith(OPENCODE_GO_ID, 'byok', 'go-fixture-key', true, { provider: 'openai-compatible', baseUrl: OPENCODE_GO_PROFILES['openai-compatible'].baseUrl, models: OPENCODE_GO_PROFILES['openai-compatible'].defaults }));
  expect(screen.getByLabelText('OpenCode Go API Key')).toHaveValue('');
  expect(api.startModelLogin).not.toHaveBeenCalled();
});

it('restores a preferred Go connection and requires a key again when switching protocol', async () => {
  const result = catalog();
  const go = result.find(item => item.id === OPENCODE_GO_ID)!;
  go.connection = connection('byok', { hasKey: true, isPreferred: true, baseUrl: go.baseUrl, models: { fast: 'minimax-m3', balanced: 'qwen3.7-plus', strong: 'qwen3.8-max' } });
  vi.mocked(api.listModelCatalog).mockResolvedValue(result);
  const saveState = vi.fn();
  render(<ModelConnectionsPanel language="en" onSaveStateChange={saveState} />);
  expect(await screen.findByLabelText('Protocol')).toHaveValue('anthropic-compatible');
  expect(screen.getByLabelText('Fast model')).toHaveValue('minimax-m3');
  expect(saveState).toHaveBeenLastCalledWith({ visible: true, disabled: false, busy: false });
  await userEvent.selectOptions(screen.getByLabelText('Protocol'), 'openai-compatible');
  expect(saveState).toHaveBeenLastCalledWith({ visible: true, disabled: true, busy: false });
});

it('reactivates a saved Go connection separately from ordinary BYOK and reports failed saves', async () => {
  const result = catalog();
  const go = result.find(item => item.id === OPENCODE_GO_ID)!;
  go.connection = connection('byok', { hasKey: true, models: go.models, baseUrl: go.baseUrl });
  vi.mocked(api.listModelCatalog).mockResolvedValue(result);
  const ref = createRef<ModelConnectionsHandle>();
  render(<><ModelConnectionsPanel ref={ref} language="en" /><button onClick={() => ref.current?.saveByok()}>Footer save</button></>);
  await waitForCatalog();
  await userEvent.selectOptions(screen.getByLabelText('Connection type'), 'opencode-go');
  await waitFor(() => expect(api.saveModelConnection).toHaveBeenCalledWith(OPENCODE_GO_ID, 'byok', undefined, true, { provider: go.provider, baseUrl: go.baseUrl, models: go.models }));
  vi.mocked(api.saveModelConnection).mockRejectedValueOnce(new Error('save failed'));
  await userEvent.type(screen.getByLabelText('OpenCode Go API Key'), 'replacement-key');
  await userEvent.click(screen.getByRole('button', { name: 'Footer save' }));
  await waitFor(() => expect(showError).toHaveBeenCalledWith('Could not save the OpenCode Go connection. Check the configuration.'));
  expect(screen.getByLabelText('OpenCode Go API Key')).toHaveValue('replacement-key');
});
