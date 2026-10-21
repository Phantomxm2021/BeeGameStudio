import { goModelCatalog } from '../../../../../tests/fixtures/opencode-go';
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
  listOpenCodeGoModels: vi.fn(), listModelCatalog: vi.fn(), saveModelConnection: vi.fn(),
  startModelLogin: vi.fn(), readModelLogin: vi.fn(), cancelModelLogin: vi.fn(),
}));
vi.mock('../beui/project-select', () => ({ ProjectSelect: ({ ariaLabel, value, options, onValueChange, disabled }: any) => <select aria-label={ariaLabel} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>{options.map((item: any) => <option key={item.value} value={item.value}>{item.label}</option>)}</select> }));

const connection = (method: api.ModelAuthMethod = 'platform', extra: Partial<api.ModelConnectionStatus> = {}): api.ModelConnectionStatus => ({ method, hasKey: false, isPreferred: false, chatgptConnected: false, ...extra });
const catalog = (): api.CatalogModel[] => [
  { id: 'official', name: 'Published Claude', provider: 'openai-compatible', models: { balanced: 'published' }, apiKeyPreview: '', isDefault: true, authMethods: ['platform'], connection: connection() },
  { id: 'personal-byok', name: 'BYOK', provider: 'openai-compatible', models: {}, apiKeyPreview: '', isDefault: false, authMethods: ['byok'], connection: connection() },
  { id: 'personal-chatgpt-subscription', name: 'ChatGPT subscription', provider: 'openai-compatible', models: {}, apiKeyPreview: '', isDefault: false, authMethods: ['chatgpt-subscription'], connection: connection() },
  { id: OPENCODE_GO_ID, name: 'OpenCode Go', provider: 'anthropic-compatible', baseUrl: OPENCODE_GO_PROFILES['anthropic-compatible'].baseUrl, models: OPENCODE_GO_PROFILES['anthropic-compatible'].defaults, apiKeyPreview: '', isDefault: false, authMethods: ['byok'], connection: connection() },
];
const waitForCatalog = async () => { await act(async () => { await vi.mocked(api.listModelCatalog).mock.results[0]?.value; }); };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listOpenCodeGoModels).mockResolvedValue(goModelCatalog);
  vi.mocked(api.listModelCatalog).mockResolvedValue(catalog());
  vi.mocked(api.saveModelConnection).mockResolvedValue(connection('byok', { hasKey: true, isPreferred: true }));
  vi.mocked(api.cancelModelLogin).mockResolvedValue({});
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
  expect(screen.queryByRole('option', { name: 'Claude account with subscription' })).not.toBeInTheDocument();
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
  await waitFor(() => expect(api.saveModelConnection).toHaveBeenCalledWith('personal-byok', 'byok', 'user-fixture-secret', true, { provider: 'openai-compatible', apiProtocol: 'chat-completions', baseUrl: 'https://personal.example/v1', models: { fast: 'fast-id', balanced: 'balanced-id', strong: 'strong-id' } }));
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
  await waitFor(() => expect(api.saveModelConnection).toHaveBeenCalledWith('personal-byok', 'byok', '', true, { provider: 'openai-compatible', apiProtocol: 'chat-completions', baseUrl: 'https://personal.example/v1', models: { fast: 'fast', balanced: 'balanced', strong: 'strong-new' } }));
});

it('cancels an unfinished subscription login when the panel closes', async () => {
  const authWindow = mockAuthorizationWindow();
  vi.mocked(api.startModelLogin).mockResolvedValue({ id: 'login', url: 'https://auth.openai.com/fixture', method: 'chatgpt-subscription' });
  const rendered = render(<ModelConnectionsPanel language="en" />);
  await waitForCatalog();
  await userEvent.selectOptions(screen.getByLabelText('Connection type'), 'chatgpt-subscription');
  await userEvent.click(screen.getByRole('button', { name: 'Continue with ChatGPT' }));
  await waitFor(() => expect(authWindow.replace).toHaveBeenCalledWith('https://auth.openai.com/fixture'));
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

it('administrator authorization reuses device login without activating a model or requesting another login on reopen', async () => {
  const authWindow = mockAuthorizationWindow();
  const connected = catalog();
  connected[2] = { ...connected[2], connection: connection('platform', { chatgptConnected: true }) };
  vi.mocked(api.listModelCatalog).mockResolvedValueOnce(catalog()).mockResolvedValue(connected);
  vi.mocked(api.startModelLogin).mockResolvedValue({ id: 'admin-login', url: 'https://auth.openai.com/codex/device', userCode: 'ADMIN-CODE', method: 'chatgpt-subscription' });
  vi.mocked(api.readModelLogin).mockResolvedValue({ status: 'complete' });
  const rendered = render(<ModelConnectionsPanel language="en" chatgptAuthorizationOnly />);
  await waitForCatalog();
  expect(screen.queryByLabelText('Connection type')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Continue with ChatGPT' }));
  expect(await screen.findByText('ADMIN-CODE')).toBeInTheDocument();
  expect(authWindow.replace).toHaveBeenCalledWith('https://auth.openai.com/codex/device');
  expect(await screen.findByText('ChatGPT subscription connected', {}, { timeout: 3500 })).toBeInTheDocument();
  expect(api.startModelLogin).toHaveBeenCalledExactlyOnceWith('personal-chatgpt-subscription', 'chatgpt-subscription');
  expect(api.saveModelConnection).not.toHaveBeenCalled();
  rendered.unmount();
  render(<ModelConnectionsPanel language="en" chatgptAuthorizationOnly />);
  expect(await screen.findByText('ChatGPT subscription connected')).toBeInTheDocument();
  expect(api.startModelLogin).toHaveBeenCalledTimes(1);
  expect(api.cancelModelLogin).not.toHaveBeenCalled();
  expect(api.saveModelConnection).not.toHaveBeenCalled();
});

it('waits for the existing administrator login status before allowing authorization', async () => {
  let resolve!: (models: api.CatalogModel[]) => void;
  vi.mocked(api.listModelCatalog).mockImplementation(() => new Promise(done => { resolve = done; }));
  render(<ModelConnectionsPanel language="en" chatgptAuthorizationOnly />);
  const button = screen.getByRole('button', { name: 'Continue with ChatGPT' });
  expect(button).toBeDisabled();
  await userEvent.click(button);
  const connected = catalog();
  connected[2].connection.chatgptConnected = true;
  await act(async () => resolve(connected));
  expect(await screen.findByText('ChatGPT subscription connected')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Continue with ChatGPT' })).not.toBeInTheDocument();
  expect(api.startModelLogin).not.toHaveBeenCalled();
  expect(api.saveModelConnection).not.toHaveBeenCalled();
});

it('does not authorize when reading administrator login status fails', async () => {
  vi.mocked(api.listModelCatalog).mockRejectedValue(new Error('fixture failure'));
  render(<ModelConnectionsPanel language="en" chatgptAuthorizationOnly />);
  expect(await screen.findByRole('status')).toHaveTextContent('Could not read login status');
  expect(screen.getByRole('button', { name: 'Continue with ChatGPT' })).toBeDisabled();
  expect(api.startModelLogin).not.toHaveBeenCalled();
  expect(api.saveModelConnection).not.toHaveBeenCalled();
});

it.each(['poll', 'refresh'])('does not offer a duplicate administrator login after an uncertain %s response', async failure => {
  mockAuthorizationWindow();
  vi.mocked(api.startModelLogin).mockResolvedValue({ id: 'admin-login', url: 'https://auth.openai.com/codex/device', userCode: 'ADMIN-CODE', method: 'chatgpt-subscription' });
  if (failure === 'poll') vi.mocked(api.readModelLogin).mockRejectedValue(new Error('fixture transport failure'));
  else {
    vi.mocked(api.readModelLogin).mockResolvedValue({ status: 'complete' });
    vi.mocked(api.listModelCatalog).mockResolvedValueOnce(catalog()).mockRejectedValue(new Error('fixture catalog failure'));
  }
  render(<ModelConnectionsPanel language="en" chatgptAuthorizationOnly />);
  await waitForCatalog();
  await userEvent.click(screen.getByRole('button', { name: 'Continue with ChatGPT' }));
  expect(await screen.findByRole('status', {}, { timeout: 3500 })).toHaveTextContent('Reopen this page');
  expect(screen.getByRole('button', { name: 'Continue with ChatGPT' })).toBeDisabled();
  expect(api.startModelLogin).toHaveBeenCalledTimes(1);
  expect(api.saveModelConnection).not.toHaveBeenCalled();
});

it('cancels an unfinished administrator authorization without changing model configuration', async () => {
  mockAuthorizationWindow();
  vi.mocked(api.startModelLogin).mockResolvedValue({ id: 'admin-pending', url: 'https://auth.openai.com/codex/device', userCode: 'ADMIN-CODE', method: 'chatgpt-subscription' });
  const rendered = render(<ModelConnectionsPanel language="en" chatgptAuthorizationOnly />);
  await waitForCatalog();
  await userEvent.click(screen.getByRole('button', { name: 'Continue with ChatGPT' }));
  await screen.findByText('ADMIN-CODE');
  rendered.unmount();
  expect(api.cancelModelLogin).toHaveBeenCalledExactlyOnceWith('admin-pending');
  expect(api.saveModelConnection).not.toHaveBeenCalled();
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

it('offers OpenCode Go alongside BYOK and ChatGPT without restoring Claude Code login', async () => {
  render(<ModelConnectionsPanel language="en" />);
  await waitForCatalog();
  expect(screen.getByRole('option', { name: 'OpenCode Go' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /Claude/i })).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: /ChatGPT/ })).toBeInTheDocument();
  expect(api.listOpenCodeGoModels).not.toHaveBeenCalled();
});


it.each([
  ['openai-compatible', 'responses'], ['openai-compatible', 'chat-completions'],
  ['anthropic-compatible', 'anthropic-messages'], ['gemini', 'gemini'], ['grok', 'chat-completions'],
] as const)('saves the explicit protocol for %s / %s', async (provider, apiProtocol) => {
  const ref=createRef<ModelConnectionsHandle>();
  render(<><ModelConnectionsPanel ref={ref} language="en" /><button onClick={()=>ref.current?.saveByok()}>Footer save</button></>);
  await waitForCatalog();
  await userEvent.selectOptions(screen.getByLabelText('Connection type'),'byok');
  await userEvent.selectOptions(screen.getByLabelText('Provider'),provider);
  if(provider==='openai-compatible'||provider==='grok') await userEvent.selectOptions(screen.getByLabelText('API Protocol'),apiProtocol);
  await userEvent.type(screen.getByLabelText('Base URL'),'https://fixture.example/v1');
  await userEvent.type(screen.getByLabelText('API Key'),'fixture-key');
  for(const label of ['Fast model','Balanced model','Strong model']) await userEvent.type(screen.getByLabelText(label),'fixture-model');
  await userEvent.click(screen.getByRole('button',{name:'Footer save'}));
  await waitFor(()=>expect(api.saveModelConnection).toHaveBeenCalledWith('personal-byok','byok','fixture-key',true,{provider,apiProtocol,baseUrl:'https://fixture.example/v1',models:{fast:'fixture-model',balanced:'fixture-model',strong:'fixture-model'}}));
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
  await waitFor(() => expect(saveState).toHaveBeenLastCalledWith({ visible: true, disabled: false, busy: false }));
  await userEvent.selectOptions(screen.getByLabelText('Protocol'), 'openai-compatible');
  expect(saveState).toHaveBeenLastCalledWith({ visible: true, disabled: true, busy: false });
});

it('loads new Go models dynamically and saves a newly listed choice', async () => {
  const ref = createRef<ModelConnectionsHandle>();
  render(<><ModelConnectionsPanel ref={ref} language="en" /><button onClick={() => ref.current?.saveByok()}>Footer save</button></>);
  await waitForCatalog();
  await userEvent.selectOptions(screen.getByLabelText('Connection type'), 'opencode-go');
  await screen.findAllByRole('option', { name: 'new-anthropic-model' });
  await userEvent.selectOptions(screen.getByLabelText('Fast model'), 'new-anthropic-model');
  await userEvent.type(screen.getByLabelText('OpenCode Go API Key'), 'fixture-key');
  await userEvent.click(screen.getByRole('button', { name: 'Footer save' }));
  await waitFor(() => expect(api.saveModelConnection).toHaveBeenCalledWith(OPENCODE_GO_ID, 'byok', 'fixture-key', true,
    expect.objectContaining({ models: { ...OPENCODE_GO_PROFILES['anthropic-compatible'].defaults, fast: 'new-anthropic-model' } })));
});

it('preserves saved model selections on catalog failure and refreshes only when requested', async () => {
  vi.mocked(api.listOpenCodeGoModels).mockRejectedValueOnce(new Error('Unavailable'));
  const saved = catalog();
  const go = saved.find(item => item.id === OPENCODE_GO_ID)!;
  go.connection = connection('byok', { hasKey: true, isPreferred: true, baseUrl: go.baseUrl,
    models: { ...go.models, fast: 'minimax-m3' } });
  vi.mocked(api.listModelCatalog).mockResolvedValue(saved);
  const saveState = vi.fn();
  render(<ModelConnectionsPanel language="en" onSaveStateChange={saveState} />);
  await waitForCatalog();
  expect(await screen.findByRole('status')).toHaveTextContent('Could not load models');
  expect(screen.getByLabelText('Fast model')).toHaveValue('minimax-m3');
  expect(saveState).toHaveBeenLastCalledWith({ visible: true, disabled: true, busy: false });
  expect(api.listOpenCodeGoModels).toHaveBeenCalledTimes(1);
  expect(api.saveModelConnection).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Refresh models' }));
  await screen.findAllByRole('option', { name: 'new-anthropic-model' });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(api.listOpenCodeGoModels).toHaveBeenCalledTimes(2);
});

it('ignores an older catalog response after switching protocol', async () => {
  let resolve!: (value: typeof goModelCatalog) => void;
  vi.mocked(api.listOpenCodeGoModels).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  render(<ModelConnectionsPanel language="en" />);
  await waitForCatalog();
  await userEvent.selectOptions(screen.getByLabelText('Connection type'), 'opencode-go');
  await userEvent.selectOptions(screen.getByLabelText('Protocol'), 'openai-compatible');
  await screen.findAllByRole('option', { name: 'new-chat-model' });
  await act(async () => resolve(goModelCatalog));
  expect(screen.queryByRole('option', { name: 'new-anthropic-model' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Balanced model')).toHaveValue('kimi-k2.7-code');
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
