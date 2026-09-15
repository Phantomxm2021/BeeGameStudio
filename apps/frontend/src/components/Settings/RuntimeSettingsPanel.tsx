import { Bot, Brain, ShieldCheck } from 'lucide-react';
import type { RuntimeSettingsConfig } from '../../services/runtimeSettingsApi';

export type RuntimeCapabilityCopy = {
  title: string;
  items: Record<
    keyof RuntimeSettingsConfig,
    {
      label: string;
      description: string;
      note: string;
      scope: 'immediate' | 'newSession' | 'restart';
    }
  >;
};

type RuntimeCapabilityItem = RuntimeCapabilityCopy['items'][keyof RuntimeSettingsConfig] & {
  key: keyof RuntimeSettingsConfig;
};

function getRuntimeCapabilityItems(copy: RuntimeCapabilityCopy): RuntimeCapabilityItem[] {
  return [
    'autoMemoryEnabled',
    'autoDreamEnabled',
    'skillSearchEnabled',
    'treeSitterBashEnabled',
    'webBrowserToolEnabled',
    'bashClassifierEnabled',
    'mcpSkillsEnabled',
    'resourceLibraryEnabled',
  ].map(key => ({ key: key as keyof RuntimeSettingsConfig, ...copy.items[key as keyof RuntimeSettingsConfig] }));
}

export function RuntimeSettingsPanel({
  copy,
  settings,
  status,
  onToggle,
}: {
  copy: RuntimeCapabilityCopy;
  settings: RuntimeSettingsConfig;
  status: string;
  onToggle: (key: keyof RuntimeSettingsConfig) => void;
}) {
  return (
    <div className="divide-y divide-border">
      {getRuntimeCapabilityItems(copy).map(item => {
        const Icon = item.scope === 'restart' ? ShieldCheck : item.key === 'autoDreamEnabled' ? Brain : Bot;
        const checked = settings[item.key];
        return (
          <div key={item.key} className="grid min-h-16 gap-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="type-footnote text-foreground">{item.label}</span>
              </div>
              <div className="type-footnote mt-1 space-y-0.5 text-muted-foreground">
                <div>{item.description}</div>
                <div>{item.note}</div>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-label={item.label}
              aria-checked={checked}
              onClick={() => onToggle(item.key)}
              className={`relative h-7 w-12 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${checked ? 'border-success/60 bg-success' : 'border-border bg-muted/40'}`}
            >
              <span
                className={`absolute left-1 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-background shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`}
              />
            </button>
          </div>
        );
      })}
      {status ? <div className="type-footnote py-2 text-warning">{status}</div> : null}
    </div>
  );
}
