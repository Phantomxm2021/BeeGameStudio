import { useEffect, useState } from 'react';
import { getBgsSettings, saveBgsSettings, type BgsSettings } from '../../services/bgsSettingsApi';

export function BgsSettingsPanel({ language }: { language: string }) {
  const zh = language.startsWith('zh');
  const [settings, setSettings] = useState<BgsSettings>();
  const [effort, setEffort] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => {
    let alive = true;
    getBgsSettings().then(value => { if (alive) { setSettings(value); setEffort(value.effort || ''); } })
      .catch(() => { if (alive) setStatus(zh ? '无法读取 BGS 设置，请检查模型连接后重新打开设置。' : 'Could not load BGS settings. Check your model connection and reopen settings.'); });
    return () => { alive = false; };
  }, [zh]);
  const save = async () => {
    if (!settings) return;
    setBusy(true); setStatus('');
    try {
      const value = await saveBgsSettings(settings.connectionKey, effort || null);
      setSettings(value); setEffort(value.effort || '');
      setStatus(zh ? '已保存，下一次任务调用生效。' : 'Saved. Applies to the next task invocation.');
    } catch { setStatus(zh ? '保存失败；若模型连接已变更，请重新打开设置。' : 'Save failed. Reopen settings if your model connection changed.'); }
    finally { setBusy(false); }
  };
  return <section className="space-y-2 py-4" aria-label={zh ? 'BGS 设置' : 'BGS settings'}>
    <div className="grid gap-3 sm:grid-cols-[10.5rem_1fr] sm:items-center">
      <label className="text-sm font-medium" htmlFor="bgs-reasoning-effort">{zh ? '推理强度' : 'Reasoning effort'}</label>
      <select id="bgs-reasoning-effort" className="h-10 rounded-lg border border-border bg-background px-3 text-sm" value={effort}
        disabled={busy || !settings || (!settings.efforts.length && !settings.effort)} onChange={event => setEffort(event.target.value)}>
        <option value="">{zh ? '使用 BGS 默认值' : 'BGS default'}</option>
        {settings?.effort && !settings.efforts.includes(settings.effort) && <option value={settings.effort} disabled>{settings.effort} ({zh ? '已不支持' : 'no longer supported'})</option>}
        {settings?.efforts.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
    </div>
    <p className="text-xs text-muted-foreground">{settings?.efforts.length
      ? (zh ? `应用于当前模型：${settings.model}。设置按当前账号独立保存。` : `Applies to ${settings.model}. Saved separately for your current account.`)
      : (zh ? '当前连接未提供可确认的推理档位，保持默认。' : 'No verified reasoning options are available for this connection. Using defaults.')}</p>
    <button type="button" disabled={busy || !settings || effort === (settings.effort || '')}
      className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50" onClick={() => void save()}>
      {busy ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存推理设置' : 'Save reasoning settings')}
    </button>
    {status && <p role="status" className="text-xs">{status}</p>}
  </section>;
}
