import { Ticket, Trash2 } from 'lucide-react';
import { Switch } from '../ui/switch';
import type { InvitationRecord } from '../../services/invitationApi';

export type InvitationSettingsCopy = {
  title: string;
  description: string;
  newCode: string;
  codeAria: string;
  codePlaceholder: string;
  labelAria: string;
  labelPlaceholder: string;
  maxUsesAria: string;
  maxUsesPlaceholder: string;
  create: string;
  list: string;
  unnamed: string;
  codeValue: (value: string) => string;
  usedCount: (used: number, max?: number | null) => string;
  disable: string;
  enable: string;
  deleteAria: string;
  empty: string;
};

export function InvitationSettingsPanel({
  copy,
  required,
  invitations,
  newCode,
  newLabel,
  newMaxUses,
  status,
  isSaving,
  onToggleRequired,
  onNewCodeChange,
  onNewLabelChange,
  onNewMaxUsesChange,
  onCreate,
  onToggleInvitation,
  onDeleteInvitation,
}: {
  copy: InvitationSettingsCopy;
  required: boolean;
  invitations: InvitationRecord[];
  newCode: string;
  newLabel: string;
  newMaxUses: string;
  status: string;
  isSaving: boolean;
  onToggleRequired: () => void;
  onNewCodeChange: (value: string) => void;
  onNewLabelChange: (value: string) => void;
  onNewMaxUsesChange: (value: string) => void;
  onCreate: () => void;
  onToggleInvitation: (invitation: InvitationRecord) => void;
  onDeleteInvitation: (id: string) => void;
}) {
  return (
    <div className="space-y-5 py-2">
      <div className="divide-y divide-border border-y border-border">
        <div className="flex min-h-16 items-center justify-between gap-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground"><Ticket className="h-4 w-4 text-muted-foreground" />{copy.title}</div>
            <div className="mt-1 text-xs text-muted-foreground">{copy.description}</div>
          </div>
          <Switch checked={required} aria-label={copy.title} onCheckedChange={onToggleRequired} />
        </div>
        <div className="grid gap-3 py-3 sm:grid-cols-[10.5rem_1fr]">
          <span className="text-sm font-medium text-foreground sm:mt-2.5">{copy.newCode}</span>
          <div className="grid gap-2">
            <input aria-label={copy.codeAria} value={newCode} onChange={event => onNewCodeChange(event.target.value)} placeholder={copy.codePlaceholder} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30" />
            <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
              <input aria-label={copy.labelAria} value={newLabel} onChange={event => onNewLabelChange(event.target.value)} placeholder={copy.labelPlaceholder} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30" />
              <input aria-label={copy.maxUsesAria} inputMode="numeric" value={newMaxUses} onChange={event => onNewMaxUsesChange(event.target.value)} placeholder={copy.maxUsesPlaceholder} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30" />
            </div>
            <div className="flex justify-end"><button type="button" onClick={onCreate} disabled={isSaving || !newCode.trim()} className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">{copy.create}</button></div>
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">{copy.list}</div>
        {invitations.length ? <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">{invitations.map(invitation => { const code = String(invitation.code || '').trim(); const label = invitation.label || code || copy.unnamed; return <div key={invitation.id} className="flex items-center justify-between gap-3 px-3 py-3"><div className="min-w-0"><div className="flex items-center gap-2"><span className={`h-2 w-2 shrink-0 rounded-full ${invitation.enabled ? 'bg-muted' : 'bg-muted-foreground'}`} /><span className="truncate text-sm text-foreground">{label}</span></div>{code ? <div className="mt-1 truncate pl-4 font-mono text-xs text-muted-foreground">{copy.codeValue(code)}</div> : null}<div className="mt-1 truncate pl-4 text-xs text-muted-foreground">{copy.usedCount(invitation.usedCount, invitation.maxUses)}</div></div><div className="flex shrink-0 items-center gap-2"><button type="button" onClick={() => onToggleInvitation(invitation)} disabled={isSaving} className="h-8 rounded-lg border border-border px-3 text-xs text-foreground transition hover:bg-accent disabled:opacity-50">{invitation.enabled ? copy.disable : copy.enable}</button><button type="button" aria-label={copy.deleteAria} onClick={() => onDeleteInvitation(invitation.id)} disabled={isSaving || invitation.usedCount > 0} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-accent disabled:opacity-35"><Trash2 className="h-4 w-4" /></button></div></div>; })}</div> : <div className="rounded-lg border border-border px-3 py-4 text-xs text-muted-foreground">{copy.empty}</div>}
        {status ? <div className="text-xs text-foreground dark:text-foreground">{status}</div> : null}
      </div>
    </div>
  );
}
