import { Bot, Brain, ShieldCheck } from 'lucide-react';
import type { RuntimeSettingsConfig } from '../../services/runtimeSettingsApi';
import { Switch } from '../ui/switch';

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
    'verificationAgentEnabled',
    'agentTeamsEnabled',
    'promptSuggestionEnabled',
    'awaySummaryEnabled',
    'coordinatorModeEnabled',
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
        const checked = Boolean(settings[item.key]);
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
            <Switch
              aria-label={item.label}
              checked={checked}
              onCheckedChange={() => onToggle(item.key)}
            />
          </div>
        );
      })}
      {status ? <div className="type-footnote py-2 text-warning">{status}</div> : null}
    </div>
  );
}
