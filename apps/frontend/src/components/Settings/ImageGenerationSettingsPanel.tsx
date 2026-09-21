import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { getImageGenerationSettings, saveImageGenerationSettings, type ImageGenerationSettings } from '../../services/imageGenerationApi';
import { ProjectSelect } from '../beui/project-select';
import { Switch } from '../ui/switch';

type Provider = ImageGenerationSettings['provider'];
type Draft = { config: ImageGenerationSettings; apiKey: string; clearKey: boolean; upstreamApiKey: string; clearUpstream: boolean };
export type ImageSettingsState = { busy: boolean; canSave: boolean };
export type ImageSettingsHandle = { save: () => Promise<boolean> };
const draftOf = (config: ImageGenerationSettings): Draft => ({ config, apiKey: '', clearKey: false, upstreamApiKey: '', clearUpstream: false });
const providers = [{ value: 'openai', label: 'OpenAI' }, { value: 'openrouter', label: 'OpenRouter' }, { value: 'vercel', label: 'Vercel AI Gateway' }, { value: 'cloudflare', label: 'Cloudflare AI Gateway' }];
const inputClass = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30';
function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center"><span className="text-sm font-medium text-foreground">{label}</span><div className="min-w-0 space-y-2">{children}</div></div>;
}

export const ImageGenerationSettingsPanel = forwardRef<ImageSettingsHandle, {
  language: string; onStateChange?: (state: ImageSettingsState) => void; onSaved?: () => void;
}>(function ImageGenerationSettingsPanel({ language, onStateChange, onSaved }, ref) {
  const zh = language.startsWith('zh');
  const [selected, setSelected] = useState<Provider>();
  const [drafts, setDrafts] = useState<Partial<Record<Provider, Draft>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const saving = useRef(false);
  useEffect(() => {
    let active = true;
    getImageGenerationSettings().then(config => {
      if (active) { setDrafts({ [config.provider]: draftOf(config) }); setSelected(config.provider); }
    }).catch(() => { if (active) setError(zh ? '无法加载生图配置，请检查服务状态。' : 'Unable to load image settings.'); });
    return () => { active = false; };
  }, [zh]);
  const draft = selected ? drafts[selected] : undefined;
  const config = draft?.config;
  useEffect(() => { onStateChange?.({ busy, canSave: Boolean(config) && !busy }); }, [busy, config, onStateChange]);
  const patch = (value: Partial<Draft>) => {
    if (selected && draft) setDrafts(current => ({ ...current, [selected]: { ...draft, ...value } }));
  };
  const update = (value: Partial<ImageGenerationSettings>) => { if (config) patch({ config: { ...config, ...value } }); };
  const save = async () => {
    if (!draft || !config || saving.current || !form.current?.reportValidity()) return false;
    saving.current = true; setBusy(true); setError('');
    try {
      const { hasApiKey: _, hasUpstreamApiKey: __, ...values } = config;
      const saved = await saveImageGenerationSettings({ ...values,
        ...(draft.clearKey ? { apiKey: '' } : draft.apiKey ? { apiKey: draft.apiKey } : {}),
        ...(draft.clearUpstream ? { upstreamApiKey: '' } : draft.upstreamApiKey ? { upstreamApiKey: draft.upstreamApiKey } : {}),
      });
      setDrafts(current => ({ ...current, [saved.provider]: draftOf(saved) }));
      return true;
    } catch {
      setError(zh ? '保存失败，请检查配置、加密密钥和服务状态。' : 'Save failed; check configuration and service status.');
      return false;
    } finally { saving.current = false; setBusy(false); }
  };
  useImperativeHandle(ref, () => ({ save }));
  const switchProvider = async (value: string) => {
    const provider = value as Provider;
    setSelected(provider); setError('');
    if (drafts[provider]) return;
    try {
      const loaded = await getImageGenerationSettings(provider);
      setDrafts(current => ({ ...current, [provider]: draftOf(loaded) }));
    } catch { setError(zh ? '无法加载此 Provider 的配置。' : 'Unable to load this provider.'); }
  };
  const urlHelp = selected === 'cloudflare'
    ? (zh ? '填写完整的 Cloudflare /accounts/{account_id}/ai/run URL；请求会原样发送。API Key 填 Cloudflare API Token。' : 'Enter the complete Cloudflare /accounts/{account_id}/ai/run URL; it is sent as-is. API Key is the Cloudflare API token.')
    : selected === 'vercel' ? 'Enter the complete image endpoint URL; it is sent as-is.'
    : selected === 'openrouter' ? 'Enter the complete /api/v1/images URL; it is sent as-is.' : 'Enter the complete /images/generations URL; it is sent as-is.';
  return <form ref={form} autoComplete="off" onSubmit={async event => { event.preventDefault(); if (await save()) onSaved?.(); }}>
    <p className="py-3 text-xs text-muted-foreground">{zh ? '每个 Provider 独立保存配置。保存后启用当前 Provider；仅切换查看不会改变运行配置，也不会生成图片。' : 'Each provider keeps its own settings. Saving activates the selected provider. Browsing providers does not change runtime settings or generate images.'}</p>
    <fieldset disabled={busy} className="divide-y divide-border">
      <Row label="Provider"><ProjectSelect ariaLabel="Provider" value={selected ?? ''} onValueChange={value => void switchProvider(value)} options={providers} className="w-full" triggerClassName={inputClass} /></Row>
      {!config || !draft ? <p role="status" className="py-3 text-sm text-muted-foreground">{zh ? '加载中…' : 'Loading…'}</p> : <>
        <Row label="Base URL"><input aria-label="Base URL" className={inputClass} type="url" required value={config.baseUrl} onChange={e => update({ baseUrl: e.target.value })} /><p className="text-xs text-muted-foreground">{urlHelp}</p></Row>
        <Row label={zh ? '模型' : 'Model'}><input aria-label={zh ? '模型' : 'Model'} className={inputClass} required value={config.model} onChange={e => update({ model: e.target.value })} /></Row>
        <Row label="API Key"><input aria-label="API Key" className={inputClass} type="password" autoComplete="new-password" disabled={draft.clearKey} value={draft.apiKey} placeholder={config.hasApiKey ? (zh ? '已配置；留空保留' : 'Configured; leave blank to keep') : (zh ? '尚未配置' : 'Not configured')} onChange={e => patch({ apiKey: e.target.value })} /><label className="flex items-center gap-2 text-xs text-muted-foreground"><Switch aria-label={zh ? '清除已保存 Key' : 'Clear saved key'} checked={draft.clearKey} onCheckedChange={clearKey => patch({ clearKey })} />{zh ? '清除已保存 Key' : 'Clear saved key'}</label></Row>
        {selected === 'cloudflare' && <Row label={zh ? '上游 API Key' : 'Upstream API Key'}><input aria-label="Upstream API Key" type="password" autoComplete="new-password" className={inputClass} disabled={draft.clearUpstream} value={draft.upstreamApiKey} placeholder={config.hasUpstreamApiKey ? (zh ? '已配置；留空保留' : 'Configured; leave blank to keep') : 'Cloudflare BYOK: optional'} onChange={e => patch({ upstreamApiKey: e.target.value })} /><label className="flex items-center gap-2 text-xs text-muted-foreground"><Switch aria-label="Clear upstream key" checked={draft.clearUpstream} onCheckedChange={clearUpstream => patch({ clearUpstream })} />{zh ? '清除上游 Key（使用 Gateway BYOK）' : 'Clear upstream key (use Gateway BYOK)'}</label></Row>}
        <Row label={zh ? '默认质量' : 'Default quality'}><ProjectSelect ariaLabel={zh ? '默认质量' : 'Default quality'} value={config.quality} onValueChange={quality => update({ quality: quality as ImageGenerationSettings['quality'] })} options={['auto', 'low', 'medium', 'high', 'xhigh', 'max'].map(value => ({ value, label: value }))} className="w-full" triggerClassName={inputClass} /></Row>
        <Row label={zh ? '默认尺寸' : 'Default size'}><input aria-label={zh ? '默认尺寸' : 'Default size'} className={inputClass} required value={config.size} onChange={e => update({ size: e.target.value })} /></Row>
        <Row label={zh ? '图片计费' : 'Image billing'}><Switch aria-label={zh ? '配置图片计费（未配置时不允许提交生成）' : 'Configure image billing'} checked={Boolean(config.billing)} onCheckedChange={enabled => update({ billing: enabled ? { model: config.model, version: '', ...(selected === 'openrouter' ? { creditsPerUsd: 100 } : {}), textInputCreditsPerMillion: 0, imageInputCreditsPerMillion: 0, textOutputCreditsPerMillion: 0, imageOutputCreditsPerMillion: 0, maxRequestCredits: 0, projectBudgetCredits: 0 } : null })} /></Row>
        {config.billing && <>
          <Row label={zh ? '计费模型' : 'Pricing model'}><input aria-label={zh ? '计费模型' : 'Pricing model'} className={inputClass} required value={config.billing.model} onChange={e => update({ billing: { ...config.billing!, model: e.target.value } })} /></Row>
          <Row label={zh ? '费率版本' : 'Pricing version'}><input aria-label={zh ? '费率版本' : 'Pricing version'} className={inputClass} required value={config.billing.version} onChange={e => update({ billing: { ...config.billing!, version: e.target.value } })} /></Row>
          {selected === 'openrouter' && <Row label="Credits / USD"><input aria-label="Credits / USD" type="number" min="0.000001" step="0.000001" required className={inputClass} value={config.billing.creditsPerUsd ?? ''} onChange={e => update({ billing: { ...config.billing!, creditsPerUsd: e.target.valueAsNumber } })} /><p className="text-xs text-muted-foreground">{zh ? '按 usage.cost 实际美元费用结算，缺失费用不视为免费。' : 'Settle actual usage.cost in USD; missing cost is not free.'}</p></Row>}
          {([
            ['textInputCreditsPerMillion', '文本输入费率', 'Text input rate'],
            ['imageInputCreditsPerMillion', '图片输入费率', 'Image input rate'],
            ['textOutputCreditsPerMillion', '文本输出费率', 'Text output rate'],
            ['imageOutputCreditsPerMillion', '图片输出费率', 'Image output rate'],
            ['maxRequestCredits', '单次费用预留', 'Per-request reservation'],
            ['projectBudgetCredits', '项目图片总预算', 'Project image budget'],
          ] as const).filter(([key]) => selected !== 'openrouter' || !key.endsWith('PerMillion')).map(([key, chinese, english]) => <Row key={key} label={zh ? chinese : english}><input aria-label={zh ? chinese : english} className={inputClass} type="number" required min={key.endsWith('PerMillion') ? 0 : 0.000001} step="0.000001" value={config.billing![key]} onChange={e => update({ billing: { ...config.billing!, [key]: e.target.valueAsNumber } })} /></Row>)}
          <p className="py-3 text-xs text-muted-foreground">{zh ? 'Token 费率单位：Credits / 百万 tokens。预留与预算单位：Credits。预留不是供应商侧硬费用上限。' : 'Token rates: Credits per million tokens. Reservation and budget: Credits. Reservation is not an upstream spending cap.'}</p>
        </>}
      </>}
    </fieldset>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
  </form>;
});
