import { useEffect, useState } from 'react';
import type { OpenCodeGoProfileId } from '@bee-game-studio/agent-workflow/opencode-go';
import { listOpenCodeGoModels } from '../../services/modelConfigApi';

export function useOpenCodeGoModels(profileId?: OpenCodeGoProfileId) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ profileId?: OpenCodeGoProfileId; revision: number; models?: string[]; error?: boolean }>({ revision: -1 });
  useEffect(() => {
    if (!profileId) return;
    let active = true;
    listOpenCodeGoModels().then(catalog => {
      if (active) setState({ profileId, revision, models: catalog[profileId], error: !catalog[profileId]?.length });
    }).catch(() => { if (active) setState({ profileId, revision, error: true }); });
    return () => { active = false; };
  }, [profileId, revision]);
  const current = state.profileId === profileId && state.revision === revision;
  return { models: current ? state.models : undefined, error: current && !!state.error,
    loading: !!profileId && (!current || (!state.models && !state.error)),
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
