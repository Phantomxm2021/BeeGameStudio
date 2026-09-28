import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'

type Props = { open: boolean; mode?: 'rename' | 'create'; resourceType: 'folder' | 'file'; initialName: string; onClose: () => void; onRename: (name: string) => Promise<void> }

export function RenameResourceDialog({ open, mode = 'rename', resourceType, initialName, onClose, onRename }: Props) {
  const { t } = useTranslation('resourceLibrary')
  const [name, setName] = useState(initialName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setName(initialName); setError('') } }, [initialName, open])
  if (!open) return null
  const title = t(mode === 'create' ? 'detail.newFolder' : resourceType === 'folder' ? 'detail.renameFolder' : 'detail.renameFile')
  const save = async () => {
    const nextName = name.trim()
    if (!nextName) { setError(t('detail.requiredName')); return }
    setSaving(true); setError('')
    try { await onRename(nextName); onClose() } catch (cause) { setError(cause instanceof Error ? cause.message : t('detail.renameFailed')) } finally { setSaving(false) }
  }
  return <Dialog open={open} onOpenChange={value => { if (!value) onClose() }}><DialogContent aria-label={title} className="max-w-[420px] p-5"><p className="text-xs font-semibold text-muted-foreground">{t('library')}</p><DialogTitle className="mt-2 text-xl">{title}</DialogTitle><label className="mt-6 grid gap-2 text-sm font-medium text-muted-foreground">{t('name')}<input autoFocus aria-label={t('name')} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void save() } }} className="h-10 rounded-lg border border-input bg-background px-3 type-input text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30 min-[900px]:text-md" /></label>{error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}<footer className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} disabled={saving} className="h-9 rounded-lg border border-border px-4 text-sm text-foreground transition hover:bg-accent">{t('detail.cancel')}</button><button type="button" onClick={() => void save()} disabled={saving} className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50">{saving ? t('detail.saving') : t('detail.save')}</button></footer></DialogContent></Dialog>
}
