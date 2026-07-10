import { useState } from 'react'
import type { ResourcePackSummary } from '../../services/resourceLibraryApi'

type Props = { open: boolean; pack: ResourcePackSummary; onClose: () => void; onDelete: () => Promise<void> }

export function DeleteResourcePackDialog({ open, pack, onClose, onDelete }: Props) {
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  if (!open) return null
  const remove = async () => {
    if (confirmation !== pack.name) return
    setDeleting(true); setError('')
    try { await onDelete() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Pack 删除失败') } finally { setDeleting(false) }
  }
  return <div role="dialog" aria-modal="true" aria-label="删除 Pack" className="fixed inset-0 z-[270] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
    <div className="input-surface w-full max-w-[440px] rounded-[28px] border border-red-300/25 bg-[#18191d] p-7 shadow-2xl shadow-black/60">
      <p className="text-[14px] font-semibold text-red-200">危险操作</p>
      <h2 className="mt-2 text-[28px] font-bold tracking-[-0.035em] text-zinc-50">删除 Pack</h2>
      <p className="mt-3 text-[14px] leading-6 text-zinc-400">此操作会永久删除 <span className="font-medium text-zinc-100">{pack.name}</span> 及其全部资源，无法恢复。</p>
      <label className="mt-6 grid gap-2 text-[13px] font-medium text-zinc-300">输入 Pack 名称以确认<input autoFocus aria-label="输入 Pack 名称以确认" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="glass-control type-input h-11 rounded-xl px-3 text-[14px]" placeholder={pack.name} /></label>
      {error ? <p role="alert" className="mt-4 text-[13px] text-red-200">{error}</p> : null}
      <footer className="mt-7 flex justify-end gap-3"><button type="button" onClick={onClose} disabled={deleting} className="secondary-pill type-button h-10 px-4">取消</button><button type="button" onClick={() => void remove()} disabled={confirmation !== pack.name || deleting} className="type-button h-10 rounded-full bg-red-500 px-4 text-white disabled:cursor-not-allowed disabled:opacity-40">{deleting ? '删除中…' : '删除 Pack'}</button></footer>
    </div>
  </div>
}
