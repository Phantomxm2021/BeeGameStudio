import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { OPENCODE_GO_ID, OPENCODE_GO_PROFILES, type OpenCodeGoProvider } from '@bee-game-studio/agent-workflow/opencode-go';
import { ProjectSelect } from '../beui/project-select';
import { useToastContext } from '../../contexts/ToastContext';
import { saveModelConnection, type CatalogModel, type ModelTierMap } from '../../services/modelConfigApi';
import type { ModelConnectionsHandle, ModelConnectionsSaveState } from './ModelConnectionsPanel';
import { useOpenCodeGoModels, OpenCodeGoCatalogStatus } from './useOpenCodeGoModels';

export const OpenCodeGoPanel = forwardRef<ModelConnectionsHandle, {
  language: string;
  config?: CatalogModel;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  refresh: () => Promise<unknown>;
  onSaveStateChange?: (state: ModelConnectionsSaveState) => void;
}>(function OpenCodeGoPanel({ language, config, busy, setBusy, refresh, onSaveStateChange }, ref) {
  const copy = (cn: string, en: string) => language.startsWith('zh') ? cn : en;
  const { showError } = useToastContext();
  const [provider, setProvider] = useState<OpenCodeGoProvider>(config?.provider === 'openai-compatible' ? 'openai-compatible' : 'anthropic-compatible');
  const [models, setModels] = useState<ModelTierMap>(config?.connection.models ?? OPENCODE_GO_PROFILES[provider].defaults);
  const [key, setKey] = useState('');
  const profile = OPENCODE_GO_PROFILES[provider];
  const catalog = useOpenCodeGoModels(provider);
  const keyRequired = !config?.connection.hasKey || config.provider !== provider;
  const complete = !catalog.loading && !catalog.error && (!keyRequired || !!key.trim()) && ['fast', 'balanced', 'strong'].every(tier => catalog.models?.includes(models[tier as keyof ModelTierMap] ?? ''));
  const save = async () => {
    if (busy || !complete) return;
    setBusy(true);
    try {
      await saveModelConnection(OPENCODE_GO_ID, 'byok', key, true, { provider, baseUrl: profile.baseUrl, models });
      setKey('');
      await refresh();
    } catch { showError(copy('无法保存 OpenCode Go 连接，请检查配置。', 'Could not save the OpenCode Go connection. Check the configuration.')); }
    finally { setBusy(false); }
  };
  useImperativeHandle(ref, () => ({ saveByok: () => void save() }));
  useEffect(() => { onSaveStateChange?.({ visible: true, disabled: busy || !complete, busy }); }, [busy, complete, onSaveStateChange]);
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">{copy('在 OpenCode 控制台订阅 Go 后，填入 API Key。每次连接使用一种协议。', 'Subscribe to Go in the OpenCode console, then enter your API key. Each connection uses one protocol.')}</p>
    <a className="inline-block text-sm underline" href="https://opencode.ai/go/" target="_blank" rel="noopener noreferrer">{copy('订阅与用量说明', 'Subscription and usage details')}</a>
    <form className="space-y-3" autoComplete="off" onSubmit={event => { event.preventDefault(); void save(); }}>
      <OpenCodeGoCatalogStatus {...catalog} language={language} />
      <label className="grid gap-2"><span className="text-sm">{copy('协议', 'Protocol')}</span><ProjectSelect ariaLabel={copy('协议', 'Protocol')} value={provider} disabled={busy} onValueChange={value => {
        const next = value as OpenCodeGoProvider;
        setProvider(next); setModels(OPENCODE_GO_PROFILES[next].defaults);
      }} options={Object.entries(OPENCODE_GO_PROFILES).map(([value, item]) => ({ value, label: item.label }))} /></label>
      <label className="grid gap-2"><span className="text-sm">API Key</span><input aria-label="OpenCode Go API Key" type="password" autoComplete="new-password" disabled={busy} value={key} onChange={event => setKey(event.target.value)} placeholder={keyRequired ? copy('输入 OpenCode Go API Key', 'Enter your OpenCode Go API key') : copy('已保存；留空保留', 'Saved; leave blank to keep')} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" /></label>
      {(['fast', 'balanced', 'strong'] as const).map(tier => <label key={tier} className="grid gap-2"><span className="text-sm">{tier === 'fast' ? copy('快速模型', 'Fast model') : tier === 'balanced' ? copy('均衡模型', 'Balanced model') : copy('强力模型', 'Strong model')}</span><ProjectSelect ariaLabel={tier === 'fast' ? copy('快速模型', 'Fast model') : tier === 'balanced' ? copy('均衡模型', 'Balanced model') : copy('强力模型', 'Strong model')} value={models[tier] ?? ''} disabled={busy || catalog.loading || catalog.error} onValueChange={value => setModels(current => ({ ...current, [tier]: value }))} options={[...new Set([...(catalog.models ?? []), ...(models[tier] ? [models[tier]!] : [])])].map(value => ({ value, label: value, disabled: !catalog.models?.includes(value) }))} /></label>)}
    </form>
  </div>;
});
