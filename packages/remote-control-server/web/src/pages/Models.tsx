import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, KeyRound, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import {
  apiCreateModelConfig,
  apiDeleteModelConfig,
  apiFetchModelConfigs,
  apiTestModelConfig,
  apiUpdateModelConfig,
  type ModelConfig,
  type ModelProviderKind,
} from '../api/client';
import { cn } from '../lib/utils';

const PROVIDERS: Array<{ value: ModelProviderKind; label: string }> = [
  { value: 'openai-compatible', label: 'OpenAI Compatible' },
  { value: 'anthropic-compatible', label: 'Anthropic Compatible' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'grok', label: 'Grok' },
];

type FormState = {
  name: string;
  provider: ModelProviderKind;
  baseUrl: string;
  apiKey: string;
  fast: string;
  balanced: string;
  strong: string;
  isDefault: boolean;
};

const EMPTY_FORM: FormState = {
  name: '',
  provider: 'openai-compatible',
  baseUrl: '',
  apiKey: '',
  fast: '',
  balanced: '',
  strong: '',
  isDefault: true,
};

export function Models() {
  const [configs, setConfigs] = useState<ModelConfig[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const defaultConfig = useMemo(() => configs.find(config => config.isDefault), [configs]);

  const loadConfigs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await apiFetchModelConfigs();
      setConfigs(next);
      if (next.length > 0) {
        setForm(current => ({ ...current, isDefault: false }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load model configs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfigs();
  }, [loadConfigs]);

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(current => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setTestResult(null);
    try {
      await apiCreateModelConfig({
        name: form.name.trim(),
        provider: form.provider,
        ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {}),
        apiKey: form.apiKey,
        models: {
          ...(form.fast.trim() ? { fast: form.fast.trim() } : {}),
          ...(form.balanced.trim() ? { balanced: form.balanced.trim() } : {}),
          ...(form.strong.trim() ? { strong: form.strong.trim() } : {}),
        },
        isDefault: form.isDefault,
      });
      setForm({ ...EMPTY_FORM, isDefault: configs.length === 0 });
      await loadConfigs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save model config');
    } finally {
      setSaving(false);
    }
  };

  const makeDefault = async (config: ModelConfig) => {
    setError(null);
    try {
      await apiUpdateModelConfig(config.id, { isDefault: true });
      await loadConfigs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update default model');
    }
  };

  const testConfig = async (config: ModelConfig) => {
    setError(null);
    setTestResult(null);
    try {
      const result = await apiTestModelConfig(config.id);
      if (result.ok) {
        setTestResult(`${config.name}: ${result.model}`);
      } else {
        setError(result.error.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to test model config');
    }
  };

  const deleteConfig = async (config: ModelConfig) => {
    setError(null);
    try {
      await apiDeleteModelConfig(config.id);
      await loadConfigs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete model config');
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-text-primary">Models</h1>
          <p className="mt-1 text-sm text-text-muted">Provider credentials and model tiers for dashboard runs.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadConfigs()}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error">
          {error}
        </div>
      )}
      {testResult && (
        <div className="mb-4 rounded-md border border-status-active/30 bg-status-active/10 px-3 py-2 text-sm text-status-active">
          {testResult}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-text-secondary">
            <KeyRound className="h-4 w-4 text-brand" />
            Saved Providers
          </div>
          <div className="space-y-3">
            {loading ? (
              <div className="rounded-md border border-border bg-surface-1 px-4 py-6 text-sm text-text-muted">
                Loading model configs...
              </div>
            ) : configs.length === 0 ? (
              <div className="rounded-md border border-border bg-surface-1 px-4 py-6 text-sm text-text-muted">
                No model configs saved.
              </div>
            ) : (
              configs.map(config => (
                <div key={config.id} className="rounded-md border border-border bg-surface-1 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-display text-base font-semibold text-text-primary">{config.name}</h2>
                        {config.isDefault && (
                          <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
                            Default
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-sm text-text-muted">
                        {providerLabel(config.provider)} · {config.apiKeyPreview}
                      </div>
                      {config.baseUrl && (
                        <div className="mt-1 truncate font-mono text-xs text-text-muted">{config.baseUrl}</div>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-text-secondary">
                        <Tier label="Fast" value={config.models.fast} />
                        <Tier label="Balanced" value={config.models.balanced} />
                        <Tier label="Strong" value={config.models.strong} />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {!config.isDefault && (
                        <button
                          type="button"
                          onClick={() => void makeDefault(config)}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
                        >
                          <Check className="h-3.5 w-3.5" />
                          Default
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void testConfig(config)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Test
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteConfig(config)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-status-error transition-colors hover:bg-status-error/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <form onSubmit={handleSubmit} className="rounded-md border border-border bg-surface-1 p-4">
          <div className="mb-4 flex items-center gap-2 font-display text-base font-semibold text-text-primary">
            <Plus className="h-4 w-4 text-brand" />
            Add Provider
          </div>
          <Field label="Name">
            <input
              value={form.name}
              onChange={event => updateField('name', event.target.value)}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand"
              required
            />
          </Field>
          <Field label="Provider">
            <select
              value={form.provider}
              onChange={event => updateField('provider', event.target.value as ModelProviderKind)}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand"
            >
              {PROVIDERS.map(provider => (
                <option key={provider.value} value={provider.value}>
                  {provider.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Base URL">
            <input
              value={form.baseUrl}
              onChange={event => updateField('baseUrl', event.target.value)}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-sm outline-none focus:border-brand"
              placeholder="https://api.example.com/v1"
            />
          </Field>
          <Field label="API Key">
            <input
              value={form.apiKey}
              onChange={event => updateField('apiKey', event.target.value)}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-sm outline-none focus:border-brand"
              required
              type="password"
            />
          </Field>
          <Field label="Fast Model">
            <input
              value={form.fast}
              onChange={event => updateField('fast', event.target.value)}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-sm outline-none focus:border-brand"
            />
          </Field>
          <Field label="Balanced Model">
            <input
              value={form.balanced}
              onChange={event => updateField('balanced', event.target.value)}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-sm outline-none focus:border-brand"
            />
          </Field>
          <Field label="Strong Model">
            <input
              value={form.strong}
              onChange={event => updateField('strong', event.target.value)}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-sm outline-none focus:border-brand"
            />
          </Field>
          <label className="mb-4 flex items-center gap-2 text-sm text-text-secondary">
            <input
              checked={form.isDefault}
              onChange={event => updateField('isDefault', event.target.checked)}
              type="checkbox"
              className="h-4 w-4 accent-brand"
            />
            Use as default provider
          </label>
          <button
            type="submit"
            disabled={saving}
            className={cn(
              'inline-flex w-full items-center justify-center gap-2 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-light',
              saving && 'cursor-not-allowed opacity-70',
            )}
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving...' : 'Save Provider'}
          </button>
          {defaultConfig && <p className="mt-3 text-xs text-text-muted">Current default: {defaultConfig.name}</p>}
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-medium text-text-muted">{label}</span>
      {children}
    </label>
  );
}

function Tier({ label, value }: { label: string; value?: string }) {
  return (
    <span className="rounded-md bg-surface-2 px-2 py-1">
      {label}: <span className="font-mono">{value || '-'}</span>
    </span>
  );
}

function providerLabel(provider: ModelProviderKind): string {
  return PROVIDERS.find(item => item.value === provider)?.label ?? provider;
}
