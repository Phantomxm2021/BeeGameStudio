import {resolveModelApiProtocol,type ModelApiProtocol} from '@bee-game-studio/agent-workflow/model-protocol';
import {OpenCodeGoPanel} from './OpenCodeGoPanel';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ProjectSelect } from '../beui/project-select';
import { OPENCODE_GO_ID } from '@bee-game-studio/agent-workflow/opencode-go';
import { ModelConfigPanel } from './ModelConfigPanel';
import { useToastContext } from '../../contexts/ToastContext';
import { cancelModelLogin, listModelCatalog, readModelLogin, saveModelConnection, startModelLogin, type CatalogModel, type ModelAuthMethod, type ModelLogin, type ModelProviderKind } from '../../services/modelConfigApi';

const BYOK_ID = 'personal-byok';
const CHATGPT_ID = 'personal-chatgpt-subscription';
type Mode = 'official' | 'byok' | 'chatgpt-subscription' | 'opencode-go';
const personalIds = [BYOK_ID, CHATGPT_ID, OPENCODE_GO_ID];

export type ModelConnectionsHandle = { saveByok: () => void };
export type ModelConnectionsSaveState = { visible: boolean; disabled: boolean; busy: boolean };

export const ModelConnectionsPanel = forwardRef<ModelConnectionsHandle, { language: string; onSaveStateChange?: (state: ModelConnectionsSaveState) => void; chatgptAuthorizationOnly?: boolean }>(function ModelConnectionsPanel({ language, onSaveStateChange, chatgptAuthorizationOnly = false }, ref) {
  const { showError } = useToastContext();
  const zh = language.startsWith('zh');
  const copy = (cn: string, en: string) => zh ? cn : en;
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [mode, setMode] = useState<Mode>(chatgptAuthorizationOnly ? 'chatgpt-subscription' : 'official');
  const [officialId, setOfficialId] = useState('');
  const [provider, setProvider] = useState<ModelProviderKind>('openai-compatible');
  const [apiProtocol,setApiProtocol]=useState<ModelApiProtocol>('responses');
  const goRef=useRef<ModelConnectionsHandle>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [login, setLogin] = useState<ModelLogin>();
  const [codeCopied, setCodeCopied] = useState(false);
  const loginRef = useRef<ModelLogin | undefined>(undefined);
  const mounted = useRef(true);
  const byok = models.find(item => item.id === BYOK_ID);
  const subscriptionId = CHATGPT_ID;
  const subscriptionMethod: ModelAuthMethod = 'chatgpt-subscription';
  const subscription = models.find(item => item.id === subscriptionId);
  const connected = mode === 'chatgpt-subscription' && subscription?.connection.chatgptConnected;
  const keyRequired = !byok?.connection.hasKey || provider !== byok.provider || baseUrl.trim().replace(/\/$/, '') !== (byok.connection.baseUrl ?? '').replace(/\/$/, '');
  const byokComplete = !!baseUrl.trim() && !!model.trim() && (!keyRequired || !!key.trim());

  const refresh = async () => {
    const result = await listModelCatalog();
    if (mounted.current) setModels(result);
    return result;
  };
  useEffect(() => {
    mounted.current = true;
    void refresh().then(result => {
      if (!mounted.current) return;
      if (chatgptAuthorizationOnly) { setMode('chatgpt-subscription'); return; }
      const active = result.find(item => item.connection.isPreferred) ?? result.find(item => item.isDefault);
      if (active?.id === OPENCODE_GO_ID) setMode('opencode-go');
      else if (active?.id === BYOK_ID) setMode('byok');
      else if (active?.id === CHATGPT_ID) setMode('chatgpt-subscription');
      else setMode('official');
      setOfficialId(active && !personalIds.includes(active.id) && active.authMethods?.includes('platform') ? active.id : result.find(item => !personalIds.includes(item.id) && item.authMethods?.includes('platform'))?.id ?? '');
      const personal = result.find(item => item.id === BYOK_ID);
      if (personal) { setProvider(personal.provider);setApiProtocol(personal.connection.apiProtocol ?? personal.apiProtocol ?? resolveModelApiProtocol(personal.provider)); setBaseUrl(personal.connection.baseUrl ?? ''); setModel(personal.connection.model ?? ''); }
    }).catch(() => { if (mounted.current) setStatus(chatgptAuthorizationOnly ? copy('无法读取登录状态，请重新打开此页面。', 'Could not read login status. Reopen this page.') : copy('无法读取可用模型', 'Could not load available models')); });
    return () => { mounted.current = false; if (loginRef.current) void cancelModelLogin(loginRef.current.id).catch(() => {}); };
  }, [chatgptAuthorizationOnly]);
  useEffect(() => {
    if (!login || login.method !== 'chatgpt-subscription') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await readModelLogin(login.id);
        if (cancelled) return;
        if (result.status === 'pending') { timer = setTimeout(poll, 2000); return; }
        if (result.status === 'complete') {
          // Administrator authorization must not change model selection or image billing.
          if (!chatgptAuthorizationOnly) await saveModelConnection(CHATGPT_ID, login.method, undefined, true);
          try { await refresh(); }
          catch (error) {
            if (!chatgptAuthorizationOnly) throw error;
            if (mounted.current) {
              setModels([]);
              setStatus(copy('授权已完成，但无法读取登录状态，请重新打开此页面。', 'Authorization completed, but login status could not be read. Reopen this page.'));
            }
          }
        }
        if (cancelled) return;
        setLogin(undefined); loginRef.current = undefined;
        if (result.status !== 'complete') showError(copy('登录失败，请重新登录。', 'Login failed. Start again.'));
      } catch { if (!cancelled) {
        setLogin(undefined); loginRef.current = undefined;
        if (chatgptAuthorizationOnly) {
          setModels([]);
          setStatus(copy('无法确认登录结果，请重新打开此页面检查。', 'Could not confirm the login result. Reopen this page to check.'));
        } else showError(copy('登录已过期，请重试。', 'Login expired. Start again.'));
      } }
    };
    timer = setTimeout(poll, 2000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [login, showError, chatgptAuthorizationOnly]);
  const run = async (action: () => Promise<void>, onError?: () => void) => {
    setBusy(true); setStatus('');
    try { await action(); } catch { onError?.(); showError(copy('操作失败，请检查连接或重新登录。', 'Operation failed. Check the connection or sign in again.')); }
    finally { if (mounted.current) setBusy(false); }
  };
  const activate = async (id: string, method: ModelAuthMethod, byokConfig?: { provider: ModelProviderKind;apiProtocol?:ModelApiProtocol; baseUrl: string; model?: string }) => {
    await saveModelConnection(id, method, undefined, true, byokConfig);
    await refresh();
  };
  const switchMode = (next: Mode) => {
    const previous = mode;
    setMode(next); setStatus('');
    if (next === 'official' && officialId) void run(() => activate(officialId, 'platform'), () => setMode(previous));
    if (next === 'byok' && byok?.connection.hasKey && byokComplete) void run(() => activate(BYOK_ID, 'byok', { provider,apiProtocol, baseUrl: baseUrl.trim(), model: model.trim() }), () => setMode(previous));
    if (next === 'opencode-go') {
      const go = models.find(item => item.id === OPENCODE_GO_ID);
      if (go?.connection.hasKey && go.baseUrl) void run(() => activate(OPENCODE_GO_ID, 'byok', {provider:go.provider,baseUrl:go.baseUrl!,model:go.connection.model ?? go.model}),()=>setMode(previous));
    }
    if (next === 'chatgpt-subscription') {
      const id = CHATGPT_ID;
      const account = models.find(item => item.id === id);
      const isConnected = account?.connection.chatgptConnected;
      if (isConnected) void run(() => activate(id, next), () => setMode(previous));
    }
  };
  const beginLogin = () => {
    // Open synchronously from the click so the browser does not block the authorization tab.
    const authWindow = window.open('about:blank', '_blank');
    if (!authWindow) { showError(copy('请允许弹出窗口后重试登录。', 'Allow pop-ups and try signing in again.')); return; }
    authWindow.opener = null;
    void run(async () => {
      try {
        const result = await startModelLogin(subscriptionId, subscriptionMethod);
        if (!mounted.current) { authWindow.close(); await cancelModelLogin(result.id); return; }
        authWindow.location.replace(result.url);
        setCodeCopied(false);
        setLogin(result); loginRef.current = result;
      } catch (error) { authWindow.close(); throw error; }
    });
  };
  const copyDeviceCode = async () => {
    if (!login?.userCode) return;
    try { await navigator.clipboard.writeText(login.userCode); setCodeCopied(true); }
    catch { showError(copy('复制失败，请手动复制设备码。', 'Copy failed. Select the device code manually.')); }
  };
  const saveByok = () => void run(async () => { await saveModelConnection(BYOK_ID, 'byok', key, true, { provider,apiProtocol, baseUrl: baseUrl.trim(), model: model.trim() }); setKey(''); await refresh(); });
  useImperativeHandle(ref, () => ({ saveByok:()=>mode==='opencode-go'?goRef.current?.saveByok():saveByok() }));
  useEffect(() => { if(mode==='opencode-go')return;onSaveStateChange?.({ visible: mode === 'byok', disabled: busy || !byokComplete, busy }); }, [mode, busy, byokComplete, onSaveStateChange]);

  return <div className="flex min-h-0 flex-1 flex-col gap-4 py-4">
    {!chatgptAuthorizationOnly && <ProjectSelect ariaLabel={copy('连接方式', 'Connection type')} value={mode} disabled={busy || !!login} triggerClassName="h-10" onValueChange={value => switchMode(value as Mode)} options={[{ value: 'official', label: 'Bee Game Studio LLM' }, { value: 'byok', label: 'BYOK' },{value:'opencode-go',label:'OpenCode Go'}, { value: 'chatgpt-subscription', label: 'ChatGPT account with subscription' }]} />}
    {mode==='opencode-go' && <OpenCodeGoPanel ref={goRef} language={language} config={models.find(item=>item.id===OPENCODE_GO_ID)} busy={busy} setBusy={setBusy} refresh={refresh} onSaveStateChange={onSaveStateChange}/>}
    {mode === 'byok' && <div className="space-y-3">
      <ModelConfigPanel labels={{ provider: copy('服务商', 'Provider'), baseUrl: copy('接口 URL', 'Base URL'), apiKey: 'API Key', model: copy('模型', 'Model') }} provider={provider} apiProtocol={apiProtocol} onApiProtocolChange={setApiProtocol} baseUrl={baseUrl} apiKey={key} model={model} apiKeyPreview={byok?.connection.hasKey && !keyRequired ? '••••' : ''} savedPrefix={copy('已保存：', 'Saved: ')} onProviderChange={setProvider} onBaseUrlChange={setBaseUrl} onApiKeyChange={setKey} onModelChange={setModel} onSubmit={event => { event.preventDefault(); if (byokComplete && !busy) saveByok(); }} />
    </div>}
    {(mode === 'chatgpt-subscription') && <div className="flex min-h-48 flex-1 items-center justify-center">
      {!connected && !login && <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <button className="rounded-full bg-foreground px-6 py-3 text-sm font-medium text-background disabled:opacity-50" disabled={busy || (chatgptAuthorizationOnly && !subscription)} onClick={beginLogin}>{copy('使用 ChatGPT 账号登录授权', 'Continue with ChatGPT')}</button>
      </div>}
      {login && <section className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-muted/20" aria-label={copy('等待授权', 'Authorization pending')}>
        <div className="space-y-4 p-5">
          <div><p className="text-xs text-muted-foreground">{'ChatGPT'}</p><h3 className="mt-1 text-lg font-medium">{copy('在新打开的页面完成授权', 'Complete authorization in the new tab')}</h3></div>
          <p className="text-sm text-muted-foreground">{copy('在授权页面输入下方设备码。完成后会自动连接。', 'Enter the device code below in the authorization tab. This page will connect automatically.')}</p>
          {login.userCode && <div><p className="mb-2 text-xs text-muted-foreground">{copy('一次性设备码', 'One-time device code')}</p><div className="flex items-center justify-between gap-3 rounded-xl bg-muted px-4 py-3"><code className="min-w-0 break-all text-xl font-medium tracking-wide">{login.userCode}</code><button className="shrink-0 text-sm text-muted-foreground hover:text-foreground" onClick={() => void copyDeviceCode()}>{codeCopied ? copy('已复制', 'Copied') : copy('复制', 'Copy')}</button></div></div>}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-muted-foreground"><span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-current" />{copy('等待授权', 'Waiting for authorization')}</span><button className="text-sm hover:text-foreground disabled:opacity-50" disabled={busy} onClick={() => void run(async () => { await cancelModelLogin(login.id); setLogin(undefined); loginRef.current = undefined; })}>{copy('取消登录', 'Cancel login')}</button></div>
      </section>}
      {connected && <section className="w-full max-w-md rounded-2xl border border-border bg-muted/20 p-5" aria-label={copy('订阅已连接', 'Subscription connected')}>
        <div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" aria-hidden="true">✓</span><div><h3 className="font-medium">{copy('ChatGPT 订阅已连接', 'ChatGPT subscription connected')}</h3><p className="mt-1 text-sm text-muted-foreground">{copy('授权已完成', 'Authorization complete')}</p></div></div>
        {mode === 'chatgpt-subscription' && <a className="mt-4 inline-block text-sm underline" href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">{copy('查看 ChatGPT 用量', 'View ChatGPT usage')}</a>}
      </section>}
    </div>}
    {status && (chatgptAuthorizationOnly || (mode !== 'chatgpt-subscription')) && <p role="status" className="text-sm">{status}</p>}
  </div>;
});
