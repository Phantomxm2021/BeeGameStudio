import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { CheckCircle2, Wallet } from 'lucide-react';
import { ProjectSelect } from '../beui/project-select';
import { getPersonalImageConnection, savePersonalImageConnection, type PersonalImageConnection } from '../../services/imageGenerationApi';
import { useToastContext } from '../../contexts/ToastContext';

type Provider = PersonalImageConnection['provider'];
export type PersonalImageConnectionHandle = { save: () => Promise<boolean> };
export type PersonalImageConnectionSaveState = { busy: boolean; disabled: boolean };
const providerOptions = [
  { value: 'openai', label: 'OpenAI' }, { value: 'openrouter', label: 'OpenRouter' },
  { value: 'vercel', label: 'Vercel AI Gateway' }, { value: 'cloudflare', label: 'Cloudflare AI Gateway' },
];
const defaultUrls: Record<Provider, string> = {
  openai: 'https://api.openai.com/v1/images/generations',
  openrouter: 'https://openrouter.ai/api/v1/images',
  vercel: 'https://ai-gateway.vercel.sh/v1/images/generations',
  cloudflare: 'https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/ai/run',
};
const inputClass = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30';

export const PersonalImageConnectionPanel = forwardRef<PersonalImageConnectionHandle, {
  language: string;
  onSaveStateChange?: (state: PersonalImageConnectionSaveState) => void;
}>(function PersonalImageConnectionPanel({ language, onSaveStateChange }, ref) {
  const { showError } = useToastContext();
  const zh = language.startsWith('zh');
  const copy = (cn: string, en: string) => zh ? cn : en;
  const [saved, setSaved] = useState<PersonalImageConnection>();
  const [source, setSource] = useState<PersonalImageConnection['source']>('platform');
  const [provider, setProvider] = useState<Provider>('openai');
  const [baseUrl, setBaseUrl] = useState(defaultUrls.openai);
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [upstreamApiKey, setUpstreamApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void getPersonalImageConnection().then(connection => {
      if (!active) return;
      setSaved(connection); setSource(connection.source); setProvider(connection.provider);
      setBaseUrl(connection.baseUrl); setModel(connection.model);
    }).catch(() => { if (active) setError(copy('无法加载生图连接', 'Could not load image connection')); });
    return () => { active = false; };
  }, []);
  const hasSavedKey = Boolean(saved?.hasApiKey && saved.provider === provider && saved.baseUrl === baseUrl);
  const disabled = busy || !saved || (source === 'byok' && (!baseUrl.trim() || !model.trim() || (!apiKey.trim() && !hasSavedKey)));
  useEffect(() => { onSaveStateChange?.({ busy, disabled: Boolean(disabled) }); }, [busy, disabled, onSaveStateChange]);
  const save = async () => {
    if (disabled) return false;
    setBusy(true); setError('');
    try {
      const connection = await savePersonalImageConnection(source === 'platform' ? { source } : {
        source, provider, baseUrl: baseUrl.trim(), model: model.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(upstreamApiKey.trim() ? { upstreamApiKey: upstreamApiKey.trim() } : {}),
      });
      setSaved(connection); setApiKey(''); setUpstreamApiKey('');
      return true;
    } catch {
      showError(copy('保存失败，请核对服务商、接口 URL、模型及 API Key。', 'Could not save. Check provider, endpoint, model and API key.'));
      return false;
    } finally { setBusy(false); }
  };
  useImperativeHandle(ref, () => ({ save }));
  const selectProvider = (value: string) => {
    const next = value as Provider;
    setProvider(next); setBaseUrl(saved?.provider === next ? saved.baseUrl : defaultUrls[next]);
    setModel(saved?.provider === next ? saved.model : '');
  };
  return <div className="flex min-h-0 flex-1 flex-col gap-5 py-5">
    <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={copy('生图连接方式', 'Image connection type')}>
      {([['platform', copy('平台提供', 'Platform provided'), copy('使用 Bee Game Studio 的生图服务', 'Use Bee Game Studio image generation')],
        ['byok', copy('自带 API Key', 'Bring your own API key'), copy('使用你自己的图像生成接口', 'Use your own image provider')]] as const).map(([value, title, detail]) =>
        <label key={value} className={`flex min-h-16 items-center gap-3 rounded-xl border px-4 py-3 ${source === value ? 'border-foreground bg-muted/60' : 'border-border bg-background'}`}>
          <input type="radio" name="personal-image-source" value={value} checked={source === value} onChange={() => { setSource(value); setError(''); }} className="order-last ml-auto accent-foreground" />
          <span className="grid gap-1"><span className="text-sm font-medium">{title}</span><span className="text-xs text-muted-foreground">{detail}</span></span>
        </label>)}
    </div>
    {source === 'platform' ? <div className="grid gap-3 px-1 py-2 text-sm">
      <div className="flex items-center gap-3"><CheckCircle2 className="size-4 shrink-0" /><span>{copy('无需额外配置', 'No additional setup required')}</span></div>
      <div className="flex items-center gap-3 text-muted-foreground"><Wallet className="size-4 shrink-0" /><span>{copy('生成图片时按平台规则扣除 Credits', 'Image generation uses platform Credits')}</span></div>
    </div> : <div className="divide-y divide-border">
      <div className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center"><label className="text-sm font-medium">{copy('服务商', 'Provider')}</label><ProjectSelect ariaLabel={copy('服务商', 'Provider')} value={provider} onValueChange={selectProvider} options={providerOptions} className="w-full" triggerClassName={inputClass} /></div>
      <div className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center"><label htmlFor="personal-image-url" className="text-sm font-medium">{copy('接口 URL', 'Endpoint URL')}</label><input id="personal-image-url" type="url" className={inputClass} value={baseUrl} onChange={event => setBaseUrl(event.target.value)} /></div>
      <div className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center"><label htmlFor="personal-image-key" className="text-sm font-medium">API Key</label><input id="personal-image-key" type="password" autoComplete="new-password" className={inputClass} value={apiKey} placeholder={hasSavedKey ? copy('已保存；留空保留', 'Saved; leave blank to keep') : copy('输入 API Key', 'Enter API key')} onChange={event => setApiKey(event.target.value)} /></div>
      {provider === 'cloudflare' && <div className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center"><label htmlFor="personal-image-upstream-key" className="text-sm font-medium">{copy('上游 API Key', 'Upstream API key')}</label><input id="personal-image-upstream-key" type="password" autoComplete="new-password" className={inputClass} value={upstreamApiKey} placeholder={saved?.hasUpstreamApiKey && hasSavedKey ? copy('已保存；留空保留', 'Saved; leave blank to keep') : copy('可选', 'Optional')} onChange={event => setUpstreamApiKey(event.target.value)} /></div>}
      <div className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center"><label htmlFor="personal-image-model" className="text-sm font-medium">{copy('生图模型', 'Image model')}</label><input id="personal-image-model" className={inputClass} value={model} onChange={event => setModel(event.target.value)} /></div>
      <p className="py-4 text-xs text-muted-foreground">{copy('由你的服务商计费；不会扣除平台生图 Credits。', 'Your provider bills you directly; platform image Credits are not charged.')}</p>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
});
