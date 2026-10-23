import {resolveModelApiProtocol,type ModelApiProtocol} from '@bee-game-studio/agent-workflow/model-protocol';
import { useEffect } from 'react';
import { useOpenCodeGoModels, OpenCodeGoCatalogStatus } from './useOpenCodeGoModels';
import type { ModelProviderKind } from '../../services/modelConfigApi';
import { ProjectSelect } from '../beui/project-select';
import { getOpenCodeGoProvider, OPENCODE_GO_PROFILES, type OpenCodeGoProvider } from '@bee-game-studio/agent-workflow/opencode-go';

export type ModelConfigPanelLabels = {
  provider: string;
  protocol?: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

export function ModelConfigPanel({
  labels,
  provider,
  apiProtocol,
  onApiProtocolChange,
  baseUrl,
  apiKey,
  model,
  apiKeyPreview,
  savedPrefix,
  onProviderChange,
  onBaseUrlChange,
  onApiKeyChange,
  onModelChange,
  onSubmit,
  enableOpenCodeGo = false,
  onGoModelsReady,
  language,
}: {
  labels: ModelConfigPanelLabels;
  provider: ModelProviderKind;
  apiProtocol?:ModelApiProtocol;
  onApiProtocolChange?:(value:ModelApiProtocol)=>void;
  baseUrl: string;
  apiKey: string;
  model: string;
  apiKeyPreview: string;
  savedPrefix: string;
  onProviderChange: (value: ModelProviderKind) => void;
  onBaseUrlChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  enableOpenCodeGo?: boolean;
  onGoModelsReady?: (ready: boolean) => void;
  language?: string;
}) {
  const goProvider = enableOpenCodeGo ? getOpenCodeGoProvider(baseUrl) : undefined;
  const goProfile = goProvider ? OPENCODE_GO_PROFILES[goProvider] : undefined;
  const catalog = useOpenCodeGoModels(goProvider);
  const ready = !catalog.loading && !catalog.error && !!catalog.models?.includes(model);
  useEffect(() => { onGoModelsReady?.(!goProfile || ready); }, [onGoModelsReady, goProfile, ready]);
  const selectGoProtocol = (next: OpenCodeGoProvider) => {
    const profile = OPENCODE_GO_PROFILES[next];
    onProviderChange(next); onApiProtocolChange?.(resolveModelApiProtocol(next)); onBaseUrlChange(profile.baseUrl);
    onModelChange(profile.model);
  };
  const inputClass = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring/30';
  return (
    <form className="divide-y divide-border" autoComplete="off" onSubmit={onSubmit}>
      <label className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center">
        <span className="text-sm font-medium text-foreground">{labels.provider}</span>
        <ProjectSelect ariaLabel={labels.provider} value={goProfile ? 'opencode-go' : provider} onValueChange={value => {
          if (value === 'opencode-go') { selectGoProtocol('anthropic-compatible'); return; }
          onProviderChange(value as ModelProviderKind);
          onApiProtocolChange?.(resolveModelApiProtocol(value as ModelProviderKind));
          if (goProfile) onBaseUrlChange('');
        }} options={[{ value: 'openai-compatible', label: 'OpenAI Compatible' }, { value: 'anthropic-compatible', label: 'Anthropic API Compatible' }, { value: 'gemini', label: 'Gemini' }, { value: 'grok', label: 'Grok' }, ...(enableOpenCodeGo ? [{ value: 'opencode-go', label: 'OpenCode Go' }] : [])]} className="w-full" triggerClassName={inputClass} />
      </label>
      {!goProfile && (provider==='openai-compatible'||provider==='grok') && onApiProtocolChange && <label className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center">
        <span className="text-sm font-medium text-foreground">{labels.protocol ?? 'API Protocol'}</span>
        <ProjectSelect ariaLabel={labels.protocol ?? 'API Protocol'} value={apiProtocol ?? resolveModelApiProtocol(provider)} onValueChange={value=>onApiProtocolChange(value as ModelApiProtocol)} options={[{value:'responses',label:'Responses'},{value:'chat-completions',label:'Chat Completions'}]} className="w-full" triggerClassName={inputClass}/>
      </label>}
      {goProfile && <label className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center">
        <span className="text-sm font-medium text-foreground">{labels.protocol ?? 'Protocol'}</span>
        <ProjectSelect ariaLabel={labels.protocol ?? 'Protocol'} value={goProvider!} onValueChange={value => selectGoProtocol(value as OpenCodeGoProvider)} options={Object.entries(OPENCODE_GO_PROFILES).map(([value, profile]) => ({ value, label: profile.label }))} className="w-full" triggerClassName={inputClass} />
      </label>}
      <label className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center"><span className="text-sm font-medium text-foreground">{labels.baseUrl}</span><input aria-label={labels.baseUrl} value={baseUrl} readOnly={!!goProfile} onChange={event => onBaseUrlChange(event.target.value)} placeholder="https://api.example.com/v1" className={inputClass} /></label>
      <label className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center"><span className="text-sm font-medium text-foreground">{labels.apiKey}</span><input aria-label={labels.apiKey} type="password" autoComplete="new-password" value={apiKey} onChange={event => onApiKeyChange(event.target.value)} placeholder={apiKeyPreview ? `${savedPrefix}${apiKeyPreview}` : 'sk-...'} className={inputClass} /></label>
      <label className="grid gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-start">
        <span className="text-sm font-medium text-foreground sm:mt-2.5">{labels.model}</span>
        <div className="grid gap-2">
          {goProfile && <OpenCodeGoCatalogStatus {...catalog} language={language} />}
          {goProfile
            ? <ProjectSelect ariaLabel={labels.model} value={model} onValueChange={onModelChange} options={[...new Set([...(catalog.models ?? []), ...(model ? [model] : [])])].map(value => ({ value, label: value, disabled: !catalog.models?.includes(value) }))} triggerClassName={inputClass} />
            : <input aria-label={labels.model} value={model} onChange={event => onModelChange(event.target.value)} placeholder="model-id" className={inputClass} />}
        </div>
      </label>
    </form>
  );
}
