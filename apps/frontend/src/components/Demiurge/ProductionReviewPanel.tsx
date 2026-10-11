import { useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '../../services/apiClient';
import { Button } from '../beui/project-button';

type Production = {
  revision: string;
  state?: { phase: string; lastValidationFailure?: string; qualityReview?: { decision: string; note: string };
    sampleReview?: { decision: string; note: string } };
  gate?: { allowed: boolean; issues: string[] };
  runtimeReview?: { scope?: string; status: string; summary?: string; sampleReviewCurrent: boolean;
    quality?: { observations: string[]; unverified: string[] } };
};
const phaseLabels: Record<string, [string, string]> = {
  brief: ['制作说明', 'Production brief'], playable: ['代表性可玩样板', 'Integrated playable sample'],
  production: ['首发制作', 'First release production'], acceptance: ['首发验收', 'Release acceptance'],
  complete: ['已交付', 'Delivered'], legacy: ['旧路线项目', 'Retired project'],
};
/** A user operation, not an Agent-generated review receipt. No model request. */
export function ProductionReviewPanel({ projectId, chinese }: { projectId: string; chinese: boolean }) {
  return <ProductionReviewContent key={projectId} projectId={projectId} chinese={chinese} />;
}
function ProductionReviewContent({ projectId, chinese }: { projectId: string; chinese: boolean }) {
  const active = useRef(true);
  const [data, setData] = useState<Production>();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // An older still-running backend has no sample feedback operation.
  const sample = !!data?.runtimeReview && ['playable', 'production'].includes(data?.state?.phase || '');
  const release = ['acceptance', 'complete'].includes(data?.state?.phase || '');
  const base = '/api/projects/' + encodeURIComponent(projectId);
  const request = async (path: string, body?: object) => {
    const response = await authenticatedFetch(base + path, body ? {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    } : {});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || result.message || String(response.status));
    return result;
  };
  useEffect(() => {
    active.current = true;
    request('/production').then(value => { if (active.current) setData(value); })
      .catch(reason => { if (active.current) setError(String(reason.message || reason)); });
    return () => { active.current = false; };
  }, [projectId]);
  const act = async (decision?: 'accepted' | 'changes-required') => {
    if (!data) return;
    setBusy(true); setError('');
    try {
      await request(decision ? '/quality-review' : '/production-migration',
        decision ? { decision, note, revision: data.revision, ...(sample ? { scope: 'sample' } : {}) } : {});
      if (active.current) {
        const updated = await request('/production');
        if (active.current) setData(updated);
      }
    } catch (reason) { if (active.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (active.current) setBusy(false); }
  };
  const refresh = async () => {
    setBusy(true); setError('');
    try { const updated = await request('/production'); if (active.current) setData(updated); }
    catch (reason) { if (active.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (active.current) setBusy(false); }
  };
  return <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm">
    <p>{chinese ? '制作检查：功能正确、符合需求与体验质量是不同结论。实际操作、观看和听取当前游戏；阶段完成或模型好评不代表高品质。记录意见不启动模型，也不能绕过已知错误。' :
      'Production checks distinguish function, requirement alignment and experience quality. Operate, view and listen to the current game; a finished stage or model rating is not a quality certificate. Recording feedback starts no model and cannot override known failures.'}</p>
    {data && <p className="mt-2 break-all">{phaseLabels[data.state?.phase || '']?.[chinese ? 0 : 1] || data.state?.phase || '—'} · {data.revision.slice(0, 12)}</p>}
    <Button disabled={busy} onClick={() => void refresh()}>{chinese ? '刷新检查结果' : 'Refresh checks'}</Button>
    {(release ? data?.gate?.issues : data?.state?.lastValidationFailure ? [data.state.lastValidationFailure] : [])?.map((issue, index) => <p key={index} className="mt-1">{issue}</p>)}
    {data?.runtimeReview && <div className="mt-2">
      <p>{chinese ? '运行记录（不是独立质量认证）：' : 'Runtime record (not independent quality certification): '}{data.runtimeReview.status}</p>
      {data.runtimeReview.summary && <p>{data.runtimeReview.summary}</p>}
      <p>{chinese ? '作者记录的体验观察：' : 'Author-recorded experience observations:'}</p>
      {data.runtimeReview.quality?.observations.map((value, index) => <p key={index}>{value}</p>)}
      <p>{chinese ? '尚未验证的体验项：' : 'Unverified experience:'}</p>
      {data.runtimeReview.quality?.unverified.map((value, index) => <p key={index}>{value}</p>)}
      {!data.runtimeReview.quality && <p>{chinese ? '未记录；不能推断体验质量通过。' : 'Not recorded; no experience quality pass can be inferred.'}</p>}
    </div>}
    {data?.state?.phase === 'legacy' ? <Button disabled={busy} onClick={() => void act()}>
      {chinese ? '迁移旧项目（不重跑）' : 'Migrate retired project (no run)'}</Button> :
      data && (sample || release) ? <>
        {sample && <p className="mt-2">{chinese ? '可选样板意见：不增加人工必经关卡，不推进阶段，也不授予首发放行。' : 'Optional sample feedback: no mandatory human gate, stage advancement or release approval.'}</p>}
        <label className="mt-2 block">{chinese ? '实际检查结果与限制' : 'Observed result and limits'}
          <textarea className="mt-1 w-full rounded border border-[var(--border)] bg-transparent p-2"
            value={note} onChange={event => setNote(event.target.value)} disabled={busy} />
        </label>
        <div className="mt-2 flex gap-2">
          <Button disabled={busy || !note.trim()} onClick={() => void act('accepted')}>{sample ? (chinese ? '样板可沿用' : 'Sample suitable to extend') : (chinese ? '当前版本合格' : 'Accept current version')}</Button>
          <Button disabled={busy || !note.trim()} onClick={() => void act('changes-required')}>{chinese ? '需要修订' : 'Changes required'}</Button>
        </div>
      </> : null}
    {release && data?.state?.qualityReview && <p className="mt-2">{data.state.qualityReview.decision}: {data.state.qualityReview.note}</p>}
    {data?.state?.sampleReview && <p className="mt-2">{chinese ? '样板意见' : 'Sample feedback'}{!data.runtimeReview?.sampleReviewCurrent && (chinese ? '（历史记录，不代表当前版本）' : ' (historical, not the current build)')}: {data.state.sampleReview.note}</p>}
    {error && <p role="alert" className="mt-2 text-red-500">{error}</p>}
  </section>;
}
