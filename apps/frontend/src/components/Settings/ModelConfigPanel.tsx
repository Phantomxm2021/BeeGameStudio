import type { ModelProviderKind } from '../../services/modelConfigApi';
import { ProjectSelect } from '../beui/project-select';

export type ModelConfigPanelLabels = {
  provider: string;
  baseUrl: string;
  apiKey: string;
  models: string;
  fast: string;
  balanced: string;
  strong: string;
  fastModel: string;
  balancedModel: string;
  strongModel: string;
};

export function ModelConfigPanel({
  labels,
  provider,
  baseUrl,
  apiKey,
  fastModel,
  balancedModel,
  strongModel,
  apiKeyPreview,
  savedPrefix,
  onProviderChange,
  onBaseUrlChange,
  onApiKeyChange,
  onFastModelChange,
  onBalancedModelChange,
  onStrongModelChange,
  onSubmit,
}: {
  labels: ModelConfigPanelLabels;
  provider: ModelProviderKind;
  baseUrl: string;
  apiKey: string;
  fastModel: string;
  balancedModel: string;
  strongModel: string;
  apiKeyPreview: string;
  savedPrefix: string;
  onProviderChange: (value: ModelProviderKind) => void;
  onBaseUrlChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onFastModelChange: (value: string) => void;
  onBalancedModelChange: (value: string) => void;
  onStrongModelChange: (value: string) => void;
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const inputClass = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring/30';
  const labelClass = 'text-sm text-muted-foreground';
  return (
    <form className="divide-y divide-border" autoComplete="off" onSubmit={onSubmit}>
      <label className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center">
        <span className="text-sm font-medium text-foreground">{labels.provider}</span>
        <ProjectSelect ariaLabel={labels.provider} value={provider} onValueChange={value => onProviderChange(value as ModelProviderKind)} options={[{ value: 'openai-compatible', label: 'OpenAI Compatible' }, { value: 'anthropic-compatible', label: 'Anthropic API Compatible' }, { value: 'gemini', label: 'Gemini' }, { value: 'grok', label: 'Grok' }]} className="w-full" triggerClassName={inputClass} />
      </label>
      <label className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center"><span className="text-sm font-medium text-foreground">{labels.baseUrl}</span><input aria-label={labels.baseUrl} value={baseUrl} onChange={event => onBaseUrlChange(event.target.value)} placeholder="https://api.example.com/v1" className={inputClass} /></label>
      <label className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center"><span className="text-sm font-medium text-foreground">{labels.apiKey}</span><input aria-label={labels.apiKey} type="password" autoComplete="new-password" value={apiKey} onChange={event => onApiKeyChange(event.target.value)} placeholder={apiKeyPreview ? `${savedPrefix}${apiKeyPreview}` : 'sk-...'} className={inputClass} /></label>
      <div className="grid gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-start">
        <span className="text-sm font-medium text-foreground sm:mt-2.5">{labels.models}</span>
        <div className="grid gap-2">
          <ModelField label={labels.fast} ariaLabel={labels.fastModel} value={fastModel} placeholder="qwen3.5-flash" onChange={onFastModelChange} inputClass={inputClass} labelClass={labelClass} />
          <ModelField label={labels.balanced} ariaLabel={labels.balancedModel} value={balancedModel} placeholder="qwen3.7-plus" onChange={onBalancedModelChange} inputClass={inputClass} labelClass={labelClass} />
          <ModelField label={labels.strong} ariaLabel={labels.strongModel} value={strongModel} placeholder="qwen3.7-max" onChange={onStrongModelChange} inputClass={inputClass} labelClass={labelClass} />
        </div>
      </div>
    </form>
  );
}

function ModelField({ label, ariaLabel, value, placeholder, onChange, inputClass, labelClass }: { label: string; ariaLabel: string; value: string; placeholder: string; onChange: (value: string) => void; inputClass: string; labelClass: string }) {
  return <label className="grid gap-2 sm:grid-cols-[6rem_1fr] sm:items-center"><span className={labelClass}>{label}</span><input aria-label={ariaLabel} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} className={inputClass} /></label>;
}
