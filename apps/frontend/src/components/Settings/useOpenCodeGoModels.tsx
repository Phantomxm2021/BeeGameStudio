import { useEffect, useState } from 'react';
import type { OpenCodeGoProvider } from '@bee-game-studio/agent-workflow/opencode-go';
import { listOpenCodeGoModels } from '../../services/modelConfigApi';

export function useOpenCodeGoModels(provider?: OpenCodeGoProvider) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ provider?: OpenCodeGoProvider; revision: number; models?: string[]; error?: boolean }>({ revision: -1 });
  useEffect(() => {
    if (!provider) return;
    let active = true;
    listOpenCodeGoModels().then(catalog => {
      if (active) setState({ provider, revision, models: catalog[provider], error: !catalog[provider]?.length });
    }).catch(() => { if (active) setState({ provider, revision, error: true }); });
    return () => { active = false; };
  }, [provider, revision]);
  const current = state.provider === provider && state.revision === revision;
  return { models: current ? state.models : undefined, error: current && !!state.error,
    loading: !!provider && (!current || (!state.models && !state.error)),
    refresh: () => setRevision(value => value + 1) };
}

export function OpenCodeGoCatalogStatus({ loading, error, refresh, language = 'en' }: {
  loading: boolean; error: boolean; refresh: () => void; language?: string;
}) {
  const zh = language.startsWith('zh');
  return <div className="space-y-2 text-sm text-muted-foreground">
    {(loading || error) && <p role="status">{loading ? (zh ? '正在获取模型列表…' : 'Loading models…')
      : (zh ? '无法获取模型列表，请检查网络或部署出站策略后刷新。' : 'Could not load models. Check the network or deployment outbound policy, then refresh.')}</p>}
    <button type="button" disabled={loading} onClick={refresh} className="underline disabled:opacity-50">{zh ? '刷新模型列表' : 'Refresh models'}</button>
  </div>;
}
