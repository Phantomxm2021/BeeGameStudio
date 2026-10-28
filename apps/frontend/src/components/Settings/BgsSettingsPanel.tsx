import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { getBgsSettings, saveBgsSettings, type BgsSettings } from '../../services/bgsSettingsApi';

export type BgsSettingsHandle = { save: () => Promise<void> };
export type BgsSettingsSaveState = { busy: boolean; disabled: boolean };

export const BgsSettingsPanel = forwardRef<BgsSettingsHandle, {
  language: string;
  desktop?: boolean;
  onSaveStateChange?: (state: BgsSettingsSaveState) => void;
}>(function BgsSettingsPanel({ language, desktop = false, onSaveStateChange }, ref) {
  const zh = language.startsWith('zh');
  const [settings, setSettings] = useState<BgsSettings>();
  const [effort, setEffort] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const disabled = busy || !settings || effort === (settings.effort || '');
  useEffect(() => { onSaveStateChange?.({ busy, disabled }); }, [busy, disabled, onSaveStateChange]);
  useEffect(() => {
    let alive = true;
    getBgsSettings().then(value => { if (alive) { setSettings(value); setEffort(value.effort || ''); } })
      .catch(() => { if (alive) setStatus(zh ? '无法读取 BGS 设置，请检查模型连接后重新打开设置。' : 'Could not load BGS settings. Check your model connection and reopen settings.'); });
    return () => { alive = false; };
  }, [zh]);
  const save = async (nextEffort = effort) => {
    if (!settings) return;
    setBusy(true); setStatus('');
    try {
      const value = await saveBgsSettings(settings.connectionKey, nextEffort || null);
      setSettings(value); setEffort(value.effort || '');
      if (!desktop) setStatus(zh ? '已保存，下一次任务调用生效。' : 'Saved. Applies to the next task invocation.');
    } catch { if (desktop) setEffort(settings.effort || ''); setStatus(zh ? '保存失败；若模型连接已变更，请重新打开设置。' : 'Save failed. Reopen settings if your model connection changed.'); }
    finally { setBusy(false); }
  };
  useImperativeHandle(ref, () => ({ save: () => save() }));
  if (desktop) return <section className="desktop-bgs-settings" aria-label={zh ? '创作' : 'Creation'}>
    <div className="desktop-settings-group-label">{zh ? '创作' : 'Creation'}</div>
    <div className="desktop-setting-row"><span>{zh ? '当前模型' : 'Current model'}</span><span className="desktop-setting-value">{settings?.model || '—'}</span></div>
    <div className="desktop-setting-row"><label htmlFor="desktop-reasoning-effort">{zh ? '推理强度' : 'Reasoning effort'}</label><select id="desktop-reasoning-effort" value={effort} disabled={busy || !settings || (!settings.efforts.length && !settings.effort)} onChange={event => { const next = event.target.value; setEffort(next); void save(next); }}>
      <option value="">{zh ? '使用默认值' : 'Default'}</option>
      {settings?.effort && !settings.efforts.includes(settings.effort) ? <option value={settings.effort} disabled>{settings.effort}</option> : null}
      {settings?.efforts.map(value => <option key={value} value={value}>{value}</option>)}
    </select></div>
    {status ? <p role="alert" className="desktop-inline-feedback">{status}</p> : null}
  </section>;
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
    {status && <p role="status" className="text-xs">{status}</p>}
  </section>;
});
