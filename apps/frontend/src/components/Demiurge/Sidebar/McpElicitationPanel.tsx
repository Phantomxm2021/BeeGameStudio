import { useState } from 'react';

type Field = { type: string; title?: string; description?: string; default?: unknown; enum?: string[]; enumNames?: string[];
  oneOf?: { const: string; title?: string }[]; items?: { enum?: string[]; anyOf?: { const: string; title?: string }[] };
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number; format?: string };
type Form = { mode: 'form' | 'url'; message: string; serverName: string; url?: string;
  requestedSchema?: { type: string; properties: Record<string, Field>; required?: string[] } };

export function McpElicitationPanel({ input, language, busy, error, onSubmit, onDismiss }: {
  input: unknown; language: string; busy: boolean; error?: string;
  onSubmit?: (answers: Record<string, string>) => Promise<void>; onDismiss?: () => Promise<void>;
}) {
  const zh = language.startsWith('zh');
  const form = input as Form;
  const fields = Object.entries(form?.requestedSchema?.properties || {});
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(fields
    .filter(([, field]) => field && field.default !== undefined && field.default !== null).map(([name, field]) => [name, field.default])));
  const fieldOptions = (field: Field): { const: string; title?: string }[] | undefined => field.oneOf || field.enum?.map((value, i) => ({ const: value, title: field.enumNames?.[i] })) ||
    field.items?.anyOf || field.items?.enum?.map(value => ({ const: value }));
  const valid = form && (form.mode === 'url' ? (() => {
    try { const url = new URL(form.url || ''); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
  })() : form.mode === 'form' && form.requestedSchema?.type === 'object' && fields.every(([, field]) =>
    field && (['string', 'boolean', 'number', 'integer'].includes(field.type) || (field.type === 'array' && !!fieldOptions(field)))));
  const set = (name: string, value: unknown) => setValues(current => {
    const next = { ...current }; if (value === undefined) delete next[name]; else next[name] = value; return next;
  });
  const css = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm';
  return <form data-testid="mcp-elicitation-panel" className="mb-3 space-y-3 rounded-lg border border-border p-3"
    onSubmit={event => { event.preventDefault(); if (valid) void onSubmit?.({ content: JSON.stringify(values) }); }}>
    <p className="text-sm font-medium">{form?.serverName}</p>
    <p className="whitespace-pre-wrap text-sm">{form?.message}</p>
    {!valid ? <p role="alert">{zh ? '此 MCP 请求格式暂不支持，请取消后联系工具提供方。' : 'This MCP request format is unsupported. Cancel and contact the tool provider.'}</p>
      : form.mode === 'url' ? <a href={form.url} target="_blank" rel="noopener noreferrer" className="break-all text-sm underline">{form.url}</a>
      : fields.map(([name, field]) => {
        const required = form.requestedSchema?.required?.includes(name);
        const options = fieldOptions(field);
        return <label key={name} className="block space-y-1 text-sm">
          <span>{field.title || name}{required ? ' *' : ''}</span>
          {field.description && <span className="block text-xs text-muted-foreground">{field.description}</span>}
          {field.type === 'boolean' ? <select className={css} aria-label={field.title || name} required={required} disabled={busy}
            value={values[name] === undefined ? '' : String(values[name])} onChange={event => set(name, event.target.value === '' ? undefined : event.target.value === 'true')}>
            <option value="">{zh ? '请选择' : 'Choose'}</option><option value="true">{zh ? '是' : 'Yes'}</option><option value="false">{zh ? '否' : 'No'}</option>
          </select> : options ? <select className={css} aria-label={field.title || name} multiple={field.type === 'array'} required={required} disabled={busy}
            value={(values[name] ?? (field.type === 'array' ? [] : '')) as string | string[]}
            onChange={event => set(name, field.type === 'array' ? Array.from(event.target.selectedOptions, option => option.value) : event.target.value || undefined)}>
            {field.type !== 'array' && <option value="">{zh ? '请选择' : 'Choose'}</option>}
            {options.map(option => <option key={option.const} value={option.const}>{option.title || option.const}</option>)}
          </select> : <input className={css} aria-label={field.title || name} disabled={busy} required={required}
            type={['integer', 'number'].includes(field.type) ? 'number' : field.format === 'email' ? 'email' : field.format === 'date' ? 'date' : 'text'}
            step={field.type === 'integer' ? 1 : 'any'} min={field.minimum} max={field.maximum} minLength={field.minLength} maxLength={field.maxLength}
            value={String(values[name] ?? '')} onChange={event => set(name, event.target.value === '' ? undefined :
              ['integer', 'number'].includes(field.type) ? Number(event.target.value) : event.target.value)} />}
        </label>;
      })}
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    <div className="flex gap-2">
      <button type="submit" disabled={busy || !valid || !onSubmit} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">
        {zh ? (form?.mode === 'url' ? '已完成，继续' : '提交') : (form?.mode === 'url' ? 'Done, continue' : 'Submit')}</button>
      <button type="button" disabled={busy || !onDismiss} onClick={() => void onDismiss?.()} className="rounded-md border border-border px-3 py-2 text-sm">{zh ? '取消' : 'Cancel'}</button>
    </div>
  </form>;
}
