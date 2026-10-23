import { forwardRef, useEffect, useEffectEvent, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { getImageGenerationSettings, saveImageGenerationSettings, type ImageGenerationSettings } from '../../services/imageGenerationApi';
import { ProjectSelect } from '../beui/project-select';
import { Switch } from '../ui/switch';
import { useToastContext } from '../../contexts/ToastContext';

type Provider = ImageGenerationSettings['provider'];
type Draft = { config: ImageGenerationSettings; apiKey: string; upstreamApiKey: string };
export type ImageSettingsState = { busy: boolean; canSave: boolean };
export type ImageSettingsHandle = { save: () => Promise<boolean> };
const draftOf = (config: ImageGenerationSettings): Draft => ({ config, apiKey: '', upstreamApiKey: '' });
const providers = [{ value: 'openai', label: 'OpenAI' }, { value: 'openrouter', label: 'OpenRouter' }, { value: 'vercel', label: 'Vercel AI Gateway' }, { value: 'cloudflare', label: 'Cloudflare AI Gateway' }, { value: 'chatgpt-subscription', label: 'ChatGPT subscription' }];
const cloudflareSizes = ['1024x1024', '1024x1536', '1536x1024'] as const;
const inputClass = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30';
function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center"><span className="text-sm font-medium text-foreground">{label}</span><div className="min-w-0 space-y-2">{children}</div></div>;
}

export const ImageGenerationSettingsPanel = forwardRef<ImageSettingsHandle, {
  language: string; onStateChange?: (state: ImageSettingsState) => void; onSaved?: () => void; onOpenModelConnections?: () => void;
}>(function ImageGenerationSettingsPanel({ language, onStateChange, onSaved, onOpenModelConnections }, ref) {
  const { showError } = useToastContext();
  const zh = language.startsWith('zh');
  const [selected, setSelected] = useState<Provider>();
  const [drafts, setDrafts] = useState<Partial<Record<Provider, Draft>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const saving = useRef(false);
  const reportLoadError = useEffectEvent(() => {
    setError(zh ? '无法加载生图配置，请检查服务状态。' : 'Unable to load image settings.');
  });
  useEffect(() => {
    let active = true;
    getImageGenerationSettings().then(config => {
      if (active) { setDrafts({ [config.provider]: draftOf(config) }); setSelected(config.provider); }
    }).catch(() => { if (active) reportLoadError(); });
    return () => { active = false; };
  }, []);
  const draft = selected ? drafts[selected] : undefined;
  const config = draft?.config;
  const subscription = selected === 'chatgpt-subscription';
  const fixedPrice = selected === 'cloudflare' || subscription;
  useEffect(() => { onStateChange?.({ busy, canSave: Boolean(config) && !busy && (!subscription || Boolean(config?.subscriptionConnected && config.responseModel?.trim())) }); }, [busy, config, subscription, onStateChange]);
  const patch = (value: Partial<Draft>) => {
    if (selected && draft) setDrafts(current => ({ ...current, [selected]: { ...draft, ...value } }));
  };
  const update = (value: Partial<ImageGenerationSettings>) => { if (config) patch({ config: { ...config, ...value,
    ...(value.model && config.billing && !('billing' in value) ? { billing: { ...config.billing, model: value.model } } : {}),
  } }); };
  const save = async () => {
    if (!draft || !config || saving.current || (subscription && !config.subscriptionConnected) || !form.current?.reportValidity()) return false;
    saving.current = true; setBusy(true); setError('');
    try {
      const { hasApiKey: _, hasUpstreamApiKey: __, fixedPricePresets: ___, subscriptionConnected: ____, ...values } = config;
      const saved = await saveImageGenerationSettings({ ...values,
        ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
        ...(draft.upstreamApiKey ? { upstreamApiKey: draft.upstreamApiKey } : {}),
      });
      setDrafts(current => ({ ...current, [saved.provider]: draftOf(saved) }));
      return true;
    } catch {
      showError(zh ? '保存失败，请检查配置、加密密钥和服务状态。' : 'Save failed; check configuration and service status.');
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
        {subscription && <Row label={zh ? '平台订阅账户' : 'Platform subscription account'}>
          <p className="text-sm">{config.subscriptionConnected ? (zh ? '当前管理员的 ChatGPT 账户已连接' : 'Your ChatGPT account is connected') : (zh ? '请先在平台模型中授权 ChatGPT 账户' : 'Connect your ChatGPT account in Platform models first')}</p>
          {onOpenModelConnections && <button type="button" className="text-sm underline" onClick={onOpenModelConnections}>{zh ? '前往平台模型' : 'Open Platform models'}</button>}
          <p className="text-xs text-muted-foreground">{zh ? '保存后，使用平台生图的用户共同消耗当前管理员的订阅额度，并按下方固定 Credits 售价付费。真实生图及上游是否允许共享尚未验证；不保证每日张数，额度不足不自动重试或切换付费 API。' : 'Saving shares your subscription quota with platform image users, billed at the fixed Credit prices below. Real generation and upstream permission for sharing remain unverified. No daily image allowance is promised, and failures never retry or fall back to a paid API.'}</p>
        </Row>}
        {!subscription && <Row label="Base URL"><input aria-label="Base URL" className={inputClass} type="url" required value={config.baseUrl} onChange={e => update({ baseUrl: e.target.value })} /><p className="text-xs text-muted-foreground">{urlHelp}</p></Row>}
        {subscription && <Row label={zh ? '主模型（Responses）' : 'Responses model'}><input aria-label={zh ? '主模型（Responses）' : 'Responses model'} className={inputClass} required value={config.responseModel ?? ''} onChange={e => update({ responseModel: e.target.value })} /></Row>}
        <Row label={zh ? '模型' : 'Model'}><input aria-label={zh ? '模型' : 'Model'} className={inputClass} required value={config.model} onChange={e => update({ model: e.target.value })} /></Row>
        {!subscription && <Row label="API Key"><input aria-label="API Key" className={inputClass} type="password" autoComplete="new-password" value={draft.apiKey} placeholder={config.hasApiKey ? (zh ? '已配置；留空保留' : 'Configured; leave blank to keep') : (zh ? '尚未配置' : 'Not configured')} onChange={e => patch({ apiKey: e.target.value })} /></Row>}
        {selected === 'cloudflare' && <Row label={zh ? '上游 API Key' : 'Upstream API Key'}><input aria-label="Upstream API Key" type="password" autoComplete="new-password" className={inputClass} value={draft.upstreamApiKey} placeholder={config.hasUpstreamApiKey ? (zh ? '已配置；留空保留' : 'Configured; leave blank to keep') : 'Cloudflare BYOK: optional'} onChange={e => patch({ upstreamApiKey: e.target.value })} /></Row>}
        <Row label={zh ? '默认质量' : 'Default quality'}><ProjectSelect ariaLabel={zh ? '默认质量' : 'Default quality'} value={config.quality} onValueChange={quality => update({ quality: quality as ImageGenerationSettings['quality'] })} options={(selected === 'cloudflare' ? ['low', 'medium'] : subscription ? ['low', 'medium', 'high', 'xhigh', 'max'] : ['auto', 'low', 'medium', 'high', 'xhigh', 'max']).map(value => ({ value, label: value }))} className="w-full" triggerClassName={inputClass} /></Row>
        <Row label={zh ? '默认尺寸' : 'Default size'}>{fixedPrice
          ? <ProjectSelect ariaLabel={zh ? '默认尺寸' : 'Default size'} value={config.size} onValueChange={size => update({ size })} options={cloudflareSizes.map(value => ({ value, label: value }))} className="w-full" triggerClassName={inputClass} />
          : <input aria-label={zh ? '默认尺寸' : 'Default size'} className={inputClass} required value={config.size} onChange={e => update({ size: e.target.value })} />}</Row>
        <Row label={zh ? '图片计费' : 'Image billing'}><Switch aria-label={zh ? '配置图片计费（未配置时不允许提交生成）' : 'Configure image billing'} checked={Boolean(config.billing)} onCheckedChange={enabled => update({ billing: enabled ? { model: config.model, version: '2026-09-27-v2', markupMultiplier: 1.5,
          textInputUsdPerMillion: subscription ? 0 : 5, cachedTextInputUsdPerMillion: subscription ? 0 : 1.25,
          imageInputUsdPerMillion: subscription ? 0 : 8, cachedImageInputUsdPerMillion: subscription ? 0 : 3,
          imageOutputUsdPerMillion: subscription ? 0 : 30,
          ...(fixedPrice ? { fixedCreditsByVariant: config.fixedPricePresets ?? {} } : {}),
          maxRequestCredits: 20,
          projectBudgetCredits: 1_000_000_000 } : null })} /></Row>
        {config.billing && <>
          {fixedPrice ? <>
            <Row label={zh ? '固定售价' : 'Fixed image prices'}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{(subscription ? ['low', 'medium', 'high', 'xhigh', 'max'] as const : ['low', 'medium'] as const).flatMap(quality => cloudflareSizes.map(size => {
                const key = `${quality}:${size}` as const;
                return <label key={key} className="space-y-1 text-xs text-muted-foreground"><span>{quality} · {size}</span><input aria-label={`${key} Credits`} className={inputClass} type="number" min="0" step="0.000001" value={config.billing?.fixedCreditsByVariant?.[key] ?? ''} onChange={e => {
                  const next = { ...config.billing!.fixedCreditsByVariant };
                  if (e.target.value === '') delete next[key];
                  else next[key] = e.target.valueAsNumber;
                  update({ billing: { ...config.billing!, fixedCreditsByVariant: next } });
                }} /></label>;
              }))}</div>
              <p className="text-xs text-muted-foreground">{subscription ? (zh ? '单位：Credits / 张，是平台售价，不是订阅美元成本。空白表示不可生成；不预填售价。生成前展示并预留，成功后按冻结售价结算。当前不支持参考图。' : 'Platform Credits per image, not subscription USD cost. Blank variants are unavailable; no prices are prefilled. Prices are shown and reserved before generation, then settled at the frozen price. Reference images are not supported.') : (zh ? '单位：Credits / 张。空白表示该组合不可生成；编辑参考图使用相同售价。生成前展示价格并预留，成功后按此价结算。' : 'Credits per image. Empty means unavailable; reference-image edits use the same price. The price is shown and reserved before generation, then settled on success.')}</p>
            </Row>
          </> : <>
          <Row label={zh ? '模型价格倍率' : 'Model price multiplier'}><input aria-label={zh ? '模型价格倍率' : 'Model price multiplier'} className={inputClass} type="number" required min="1" max="10" step="0.000001" value={config.billing.markupMultiplier} onChange={e => update({ billing: { ...config.billing!, markupMultiplier: e.target.valueAsNumber } })} /></Row>
          {([
            ['textInputUsdPerMillion', '文本输入', 'Text input'],
            ['cachedTextInputUsdPerMillion', '缓存文本输入', 'Cached text input'],
            ['imageInputUsdPerMillion', '图片输入', 'Image input'],
            ['cachedImageInputUsdPerMillion', '缓存图片输入', 'Cached image input'],
            ['imageOutputUsdPerMillion', '图片输出', 'Image output'],
          ] as const).map(([key, chinese, english]) => <Row key={key} label={zh ? chinese : english}><input aria-label={zh ? chinese : english} className={inputClass} type="number" required min="0" step="0.000001" value={config.billing![key]} onChange={e => update({ billing: { ...config.billing!, [key]: e.target.valueAsNumber } })} /></Row>)}
          <p className="py-3 text-xs text-muted-foreground">{zh ? '单价单位：上游美元 / 百万 tokens。消费 Credits = 实际分类用量成本 × 模型价格倍率 × 100。缺少可信用量不猜测扣费。' : 'Rates are upstream USD per million tokens. Charged Credits = actual categorized usage cost × model price multiplier × 100. Missing usage is never guessed.'}</p>
          </>}
          {!fixedPrice && <Row label={zh ? '单次预留上限' : 'Reservation cap'}><input aria-label={zh ? '单次预留上限' : 'Reservation cap'} className={inputClass} type="number" required min="0.000001" step="0.000001" value={config.billing.maxRequestCredits} onChange={e => update({ billing: { ...config.billing!, maxRequestCredits: e.target.valueAsNumber } })} /></Row>}
        </>}
      </>}
    </fieldset>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
  </form>;
});
