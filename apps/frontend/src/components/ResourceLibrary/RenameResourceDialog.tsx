import { useEffect, useState } from 'react'

type Props = { open: boolean; mode?: 'rename' | 'create'; resourceType: 'folder' | 'file'; initialName: string; onClose: () => void; onRename: (name: string) => Promise<void> }

export function RenameResourceDialog({ open, mode = 'rename', resourceType, initialName, onClose, onRename }: Props) {
  const [name, setName] = useState(initialName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setName(initialName); setError('') } }, [initialName, open])
  if (!open) return null
  const title = mode === 'create' ? '新建文件夹' : resourceType === 'folder' ? '重命名文件夹' : '重命名文件'
  const save = async () => {
    const nextName = name.trim()
    if (!nextName) { setError('名称不能为空'); return }
    setSaving(true); setError('')
    try { await onRename(nextName); onClose() } catch (cause) { setError(cause instanceof Error ? cause.message : '重命名失败') } finally { setSaving(false) }
  }
  return <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[270] grid place-items-center bg-black/70 p-6 backdrop-blur-sm"><div className="input-surface w-full max-w-[420px] rounded-[24px] border border-white/15 bg-[#18191d] p-6 shadow-2xl shadow-black/60"><p className="text-[13px] font-semibold text-orange-200">资源库</p><h2 className="mt-2 text-[26px] font-bold tracking-[-0.03em] text-zinc-50">{title}</h2><label className="mt-6 grid gap-2 text-[13px] font-medium text-zinc-300">名称<input autoFocus aria-label="名称" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void save() } }} className="glass-control type-input h-11 rounded-xl px-3 text-[14px]" /></label>{error ? <p role="alert" className="mt-3 text-[13px] text-red-200">{error}</p> : null}<footer className="mt-7 flex justify-end gap-3"><button type="button" onClick={onClose} disabled={saving} className="secondary-pill type-button h-10 px-4">取消</button><button type="button" onClick={() => void save()} disabled={saving} className="primary-pill type-button h-10 px-4 disabled:opacity-50">{saving ? '保存中…' : '保存'}</button></footer></div></div>
}
