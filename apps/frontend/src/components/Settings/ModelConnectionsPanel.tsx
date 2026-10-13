import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ProjectSelect } from '../beui/project-select';
import { ModelConfigPanel } from './ModelConfigPanel';
import { cancelModelLogin, completeModelLogin, listModelCatalog, readModelLogin, saveModelConnection, startModelLogin, type CatalogModel, type ModelAuthMethod, type ModelLogin, type ModelProviderKind, type ModelTierMap } from '../../services/modelConfigApi';

const BYOK_ID = 'personal-byok';
const CLAUDE_ID = 'personal-claude-subscription';
const CHATGPT_ID = 'personal-chatgpt-subscription';
type Mode = 'official' | 'byok' | 'subscribe';
const personalIds = [BYOK_ID, CLAUDE_ID, CHATGPT_ID];

export type ModelConnectionsHandle = { saveByok: () => void };
export type ModelConnectionsSaveState = { visible: boolean; disabled: boolean; busy: boolean };

export const ModelConnectionsPanel = forwardRef<ModelConnectionsHandle, { language: string; onSaveStateChange?: (state: ModelConnectionsSaveState) => void }>(function ModelConnectionsPanel({ language, onSaveStateChange }, ref) {
  const zh = language.startsWith('zh');
  const copy = (cn: string, en: string) => zh ? cn : en;
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [mode, setMode] = useState<Mode>('official');
  const [officialId, setOfficialId] = useState('');
  const [subscriptionId, setSubscriptionId] = useState(CLAUDE_ID);
  const [provider, setProvider] = useState<ModelProviderKind>('anthropic-compatible');
  const [baseUrl, setBaseUrl] = useState('');
  const [tiers, setTiers] = useState<ModelTierMap>({});
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [login, setLogin] = useState<ModelLogin>();
  const [code, setCode] = useState('');
  const loginRef = useRef<ModelLogin | undefined>(undefined);
  const mounted = useRef(true);
  const byok = models.find(item => item.id === BYOK_ID);
  const subscription = models.find(item => item.id === subscriptionId);
  const subscriptionMethod: ModelAuthMethod = subscriptionId === CLAUDE_ID ? 'claude-subscription' : 'chatgpt-subscription';
  const connected = subscriptionMethod === 'claude-subscription' ? subscription?.connection.claudeConnected : subscription?.connection.chatgptConnected;
  const keyRequired = !byok?.connection.hasKey || provider !== byok.provider || baseUrl.trim().replace(/\/$/, '') !== (byok.connection.baseUrl ?? '').replace(/\/$/, '');
  const byokComplete = !!baseUrl.trim() && !!tiers.fast?.trim() && !!tiers.balanced?.trim() && !!tiers.strong?.trim() && (!keyRequired || !!key.trim());

  const refresh = async () => {
    const result = await listModelCatalog();
    if (mounted.current) setModels(result);
    return result;
  };
  useEffect(() => {
    mounted.current = true;
    void refresh().then(result => {
      if (!mounted.current) return;
      const active = result.find(item => item.connection.isPreferred) ?? result.find(item => item.isDefault);
      if (active?.id === BYOK_ID) setMode('byok');
      else if (active?.id === CLAUDE_ID || active?.id === CHATGPT_ID) { setMode('subscribe'); setSubscriptionId(active.id); }
      else setMode('official');
      setOfficialId(active && !personalIds.includes(active.id) && active.authMethods?.includes('platform') ? active.id : result.find(item => !personalIds.includes(item.id) && item.authMethods?.includes('platform'))?.id ?? '');
      const personal = result.find(item => item.id === BYOK_ID);
      if (personal) { setProvider(personal.provider); setBaseUrl(personal.connection.baseUrl ?? ''); setTiers(personal.connection.models ?? {}); }
    }).catch(() => { if (mounted.current) setStatus(copy('无法读取可用模型', 'Could not load available models')); });
    return () => { mounted.current = false; if (loginRef.current) void cancelModelLogin(loginRef.current.id).catch(() => {}); };
  }, []);
  useEffect(() => {
    if (!login || login.method !== 'chatgpt-subscription') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await readModelLogin(login.id);
        if (cancelled) return;
        if (result.status === 'pending') { timer = setTimeout(poll, 2000); return; }
        setLogin(undefined); loginRef.current = undefined;
        if (result.status === 'complete') { await saveModelConnection(CHATGPT_ID, login.method, undefined, true); await refresh(); }
        setStatus(result.status === 'complete' ? '' : copy('登录失败，请重新登录。', 'Login failed. Start again.'));
      } catch { if (!cancelled) { setLogin(undefined); loginRef.current = undefined; setStatus(copy('登录已过期，请重试。', 'Login expired. Start again.')); } }
    };
    timer = setTimeout(poll, 2000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [login]);
  const run = async (action: () => Promise<void>, onError?: () => void) => {
    setBusy(true); setStatus('');
    try { await action(); } catch { onError?.(); setStatus(copy('操作失败，请检查连接或重新登录。', 'Operation failed. Check the connection or sign in again.')); }
    finally { if (mounted.current) setBusy(false); }
  };
  const activate = async (id: string, method: ModelAuthMethod, byokConfig?: { provider: ModelProviderKind; baseUrl: string; models: ModelTierMap }) => {
    await saveModelConnection(id, method, undefined, true, byokConfig);
    await refresh();
  };
  const switchMode = (next: Mode) => {
    const previous = mode;
    setMode(next); setStatus('');
    if (next === 'official' && officialId) void run(() => activate(officialId, 'platform'), () => setMode(previous));
    if (next === 'byok' && byok?.connection.hasKey && byokComplete) void run(() => activate(BYOK_ID, 'byok', { provider, baseUrl: baseUrl.trim(), models: tiers }), () => setMode(previous));
    if (next === 'subscribe' && connected) void run(() => activate(subscriptionId, subscriptionMethod), () => setMode(previous));
  };
  const button = 'rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50';
  const saveByok = () => void run(async () => { await saveModelConnection(BYOK_ID, 'byok', key, true, { provider, baseUrl: baseUrl.trim(), models: tiers }); setKey(''); await refresh(); });
  useImperativeHandle(ref, () => ({ saveByok }));
  useEffect(() => { onSaveStateChange?.({ visible: mode === 'byok', disabled: busy || !byokComplete, busy }); }, [mode, busy, byokComplete, onSaveStateChange]);

  return <div className="space-y-4 py-4">
    <ProjectSelect ariaLabel={copy('连接方式', 'Connection type')} value={mode} disabled={busy || !!login} onValueChange={value => switchMode(value as Mode)} options={[{ value: 'official', label: 'Bee Game Studio LLM' }, { value: 'byok', label: 'BYOK' }, { value: 'subscribe', label: 'Subscribe' }]} />
    {mode === 'byok' && <div className="space-y-3">
      <ModelConfigPanel labels={{ provider: copy('服务商', 'Provider'), baseUrl: copy('接口 URL', 'Base URL'), apiKey: 'API Key', models: copy('模型', 'Models'), fast: copy('快速', 'Fast'), balanced: copy('均衡', 'Balanced'), strong: copy('强力', 'Strong'), fastModel: copy('快速模型', 'Fast model'), balancedModel: copy('均衡模型', 'Balanced model'), strongModel: copy('强力模型', 'Strong model') }} provider={provider} baseUrl={baseUrl} apiKey={key} fastModel={tiers.fast ?? ''} balancedModel={tiers.balanced ?? ''} strongModel={tiers.strong ?? ''} apiKeyPreview={byok?.connection.hasKey && !keyRequired ? '••••' : ''} savedPrefix={copy('已保存：', 'Saved: ')} onProviderChange={setProvider} onBaseUrlChange={setBaseUrl} onApiKeyChange={setKey} onFastModelChange={value => setTiers(current => ({ ...current, fast: value }))} onBalancedModelChange={value => setTiers(current => ({ ...current, balanced: value }))} onStrongModelChange={value => setTiers(current => ({ ...current, strong: value }))} onSubmit={event => { event.preventDefault(); if (byokComplete && !busy) saveByok(); }} />
    </div>}
    {mode === 'subscribe' && <div className="space-y-3">
      <ProjectSelect ariaLabel={copy('订阅账号', 'Subscription account')} value={subscriptionId} disabled={busy || !!login} onValueChange={value => { const previous = subscriptionId; setSubscriptionId(value); const next = models.find(item => item.id === value); const method = value === CLAUDE_ID ? 'claude-subscription' : 'chatgpt-subscription'; if (next && (method === 'claude-subscription' ? next.connection.claudeConnected : next.connection.chatgptConnected)) void run(() => activate(value, method), () => setSubscriptionId(previous)); }} options={[{ value: CLAUDE_ID, label: 'Claude' }, { value: CHATGPT_ID, label: 'ChatGPT' }]} />
      {!connected && !login && <button className={button} disabled={busy} onClick={() => void run(async () => { const result = await startModelLogin(subscriptionId, subscriptionMethod); if (mounted.current) { setLogin(result); loginRef.current = result; } else await cancelModelLogin(result.id); })}>{copy('登录', 'Sign in')}</button>}
      {login && <>
        <a className="text-sm underline" href={login.url} target="_blank" rel="noopener noreferrer">{copy('打开服务商授权页面', 'Open provider authorization')}</a>
        {login.userCode && <p>{copy('设备码：', 'Device code: ')}<code>{login.userCode}</code></p>}
        {login.method === 'claude-subscription' && <><input aria-label="Claude code#state" autoComplete="off" className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground" value={code} onChange={event => setCode(event.target.value)} placeholder="code#state" /><button className={button} disabled={busy || !code.trim()} onClick={() => void run(async () => { await completeModelLogin(login.id, code); await activate(CLAUDE_ID, login.method); setCode(''); setLogin(undefined); loginRef.current = undefined; })}>{copy('完成登录', 'Complete login')}</button></>}
        <button className={button} disabled={busy} onClick={() => void run(async () => { await cancelModelLogin(login.id); setLogin(undefined); loginRef.current = undefined; setCode(''); })}>{copy('取消登录', 'Cancel login')}</button>
      </>}
    </div>}
    {status && <p role="status" className="text-sm">{status}</p>}
  </div>;
});
