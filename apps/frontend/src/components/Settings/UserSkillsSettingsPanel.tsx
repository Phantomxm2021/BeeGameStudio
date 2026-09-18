import { useState, type DragEvent } from 'react';
import { BookOpenText, Trash2 } from 'lucide-react';
import { Switch } from '../ui/switch';
import { Button } from '../beui/project-button';
import type { UserSkill } from '../../services/userSkillsApi';

export type UserSkillsSettingsCopy = {
  enabled: string;
  disabled: string;
  delete: string;
  empty: string;
  emptyDescription: string;
};

export function UserSkillsSettingsPanel({ copy, skills, isSaving, onImport, onToggle, onDelete }: { copy: UserSkillsSettingsCopy; skills: UserSkill[]; isSaving: boolean; onImport: (file: File) => void; onToggle: (skill: UserSkill) => void; onDelete: (skill: UserSkill) => void }) {
  const [isDragActive, setIsDragActive] = useState(false);
  const handleDragOver = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setIsDragActive(true); };
  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragActive(false); };
  const handleDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setIsDragActive(false); const file = event.dataTransfer.files.item?.(0) ?? event.dataTransfer.files[0]; if (file) onImport(file); };
  return <div className="space-y-4 py-2"><section data-testid="user-skills-drop-zone" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} className={`rounded-lg transition-colors ${isDragActive ? 'bg-accent ring-2 ring-ring/40' : ''}`}>{skills.length ? <div className="max-h-[240px] overflow-y-auto rounded-lg border border-border"><div className="divide-y divide-border">{skills.map(skill => <div key={skill.id} className="flex items-center justify-between gap-3 px-3 py-3"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className={`h-2 w-2 shrink-0 rounded-full ${skill.enabled ? 'bg-muted' : 'bg-muted-foreground'}`} /><span className="truncate text-sm text-foreground">{skill.name}</span><span className="text-xs text-muted-foreground">{skill.enabled ? copy.enabled : copy.disabled}</span></div><div className="mt-1 truncate pl-4 text-xs text-muted-foreground">{skill.description}</div></div><div className="flex shrink-0 items-center gap-2"><Switch checked={skill.enabled} aria-label={skill.enabled ? copy.disabled : copy.enabled} disabled={isSaving} onCheckedChange={() => onToggle(skill)} /><Button variant="outline" size="icon-sm" aria-label={copy.delete} title={copy.delete} onClick={() => onDelete(skill)} disabled={isSaving}><Trash2 className="h-4 w-4" /></Button></div></div>)}</div></div> : <div className="flex min-h-[190px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted px-6 py-8 text-center"><div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border text-muted-foreground"><BookOpenText className="h-5 w-5" /></div><div className="text-sm font-medium text-foreground">{copy.empty}</div><p className="mt-2 max-w-md text-xs text-muted-foreground">{copy.emptyDescription}</p></div>}</section></div>;
}
