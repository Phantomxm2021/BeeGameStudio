import { useState } from 'react'
import type { ResourcePackPrimaryCategory, ResourcePackSummary, UpdateResourcePackInput } from '../../services/resourceLibraryApi'
import { CONFIGURED_PRODUCTION_SETTING_OPTIONS } from '../../config/productionSettingOptions'

type Props = {
  open: boolean
  pack: ResourcePackSummary
  onClose: () => void
  onUploadCover: (file: File) => Promise<ResourcePackSummary>
  onSave: (input: UpdateResourcePackInput) => Promise<ResourcePackSummary>
  onDelete: () => Promise<void>
}

const primaryCategoryOptions: ReadonlyArray<readonly [ResourcePackPrimaryCategory, string]> = [['2d-art', '2D 美术包'], ['3d-assets', '3D 资产包'], ['animation-rig', '动画与骨骼包'], ['ui-kit', 'UI Kit'], ['vfx', 'VFX 包'], ['audio', '音频包'], ['fonts', '字体包'], ['world-scene', '世界与场景包'], ['mixed', '综合资源包']]

export function EditResourcePackDialog({ open, pack, onClose, onUploadCover, onSave, onDelete }: Props) {
  const [name, setName] = useState(pack.name)
  const [styles, setStyles] = useState<string[]>(() => pack.style.split('/').map((value) => value.trim()).filter(Boolean))
  const [dimension, setDimension] = useState(pack.dimension)
  const [gameTypes, setGameTypes] = useState<string[]>(() => [...(pack.gameTypes || [])])
  const [primaryCategory, setPrimaryCategory] = useState<ResourcePackPrimaryCategory>(pack.primaryCategory)
  const [cover, setCover] = useState<File | null>(null)
  const [customStyle, setCustomStyle] = useState('')
  const [customGameType, setCustomGameType] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  if (!open) return null
  const chipClass = (selected: boolean) => `type-caption-2 rounded-full border px-3 py-1.5 transition-colors ${selected ? 'border-orange-200/45 bg-orange-200/10 text-orange-100' : 'border-white/10 bg-white/[0.02] text-zinc-400 hover:border-white/20 hover:bg-white/[0.06] hover:text-zinc-200'}`
  const toggle = (value: string, setValues: React.Dispatch<React.SetStateAction<string[]>>) => setValues((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim() || styles.length === 0 || gameTypes.length === 0) { setError('请填写 Pack 名称、风格和适用游戏类型'); return }
    setSaving(true); setError('')
    try {
      if (cover) await onUploadCover(cover)
      await onSave({ name: name.trim(), style: styles.join(' / '), dimension, primaryCategory, gameTypes })
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Pack 更新失败') } finally { setSaving(false) }
  }
  const remove = async () => {
    if (confirmation !== pack.name) return
    setDeleting(true); setError('')
    try { await onDelete() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Pack 删除失败') } finally { setDeleting(false) }
  }
  return <div role="dialog" aria-modal="true" aria-label="编辑 Pack" className="fixed inset-0 z-[260] flex items-center justify-center overflow-y-auto bg-zinc-950/60 p-4 backdrop-blur-sm">
    <form onSubmit={save} className="input-surface relative my-6 w-full max-w-lg rounded-3xl border border-white/15 p-6 shadow-2xl shadow-black/50">
      <header className="relative z-10 flex items-start justify-between gap-6 border-b border-white/10 pb-5"><div><p className="type-caption-1 text-zinc-500">资源库</p><h2 className="type-title-2 mt-1 text-zinc-100">编辑 Pack</h2><p className="type-footnote mt-2 text-zinc-500">更新 Pack 元数据与封面。</p></div><button type="button" onClick={onClose} className="glass-icon-button h-9 w-9 shrink-0 text-lg" aria-label="关闭">×</button></header>
      <div className="relative z-10 mt-5 grid gap-5">
        <div className="grid gap-4 sm:grid-cols-2"><label className="type-callout grid gap-2 text-zinc-300 sm:col-span-2">名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="glass-control type-input h-11 rounded-xl px-3" /></label><label className="type-callout grid gap-2 text-zinc-300">维度<select value={dimension} onChange={(event) => setDimension(event.target.value as ResourcePackSummary['dimension'])} className="glass-control type-input h-11 rounded-xl px-3"><option value="agnostic">混合</option><option value="2D">2D</option><option value="3D">3D</option></select></label><label className="type-callout grid gap-2 text-zinc-300">主分类<select value={primaryCategory} onChange={(event) => setPrimaryCategory(event.target.value as ResourcePackPrimaryCategory)} className="glass-control type-input h-11 rounded-xl px-3">{primaryCategoryOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
        <label className="type-callout grid gap-2 text-zinc-300">封面 <span className="type-caption-2 text-zinc-500">可选；保存时先上传</span><input aria-label="上传封面" type="file" accept="image/*,video/mp4,video/webm" onChange={(event) => setCover(event.target.files?.[0] || null)} className="glass-control type-input rounded-xl px-3 py-2" />{cover ? <span className="type-caption-2 text-zinc-400">{cover.name}</span> : null}</label>
        <fieldset className="m-0 grid gap-3 border-0 p-0"><legend className="type-callout text-zinc-300">风格 <span className="type-caption-2 text-zinc-500">可多选</span></legend><div className="flex flex-wrap gap-2">{CONFIGURED_PRODUCTION_SETTING_OPTIONS.styles.map((option) => <button key={option} type="button" aria-pressed={styles.includes(option)} onClick={() => toggle(option, setStyles)} className={chipClass(styles.includes(option))}>{option}</button>)}</div><div className="flex gap-2"><input value={customStyle} onChange={(event) => setCustomStyle(event.target.value)} className="glass-control type-input h-10 min-w-0 flex-1 rounded-xl px-3" placeholder="添加自定义风格" /><button type="button" className="secondary-pill type-button h-10 px-4" onClick={() => { const value = customStyle.trim(); if (value && !styles.includes(value)) setStyles((current) => [...current, value]); setCustomStyle('') }}>添加自定义风格</button></div></fieldset>
        <fieldset className="m-0 grid gap-3 border-0 p-0"><legend className="type-callout text-zinc-300">适用游戏类型 <span className="type-caption-2 text-zinc-500">可多选</span></legend><div className="flex flex-wrap gap-2">{CONFIGURED_PRODUCTION_SETTING_OPTIONS.genres.map((option) => <button key={option} type="button" aria-pressed={gameTypes.includes(option)} onClick={() => toggle(option, setGameTypes)} className={chipClass(gameTypes.includes(option))}>{option}</button>)}</div><div className="flex gap-2"><input value={customGameType} onChange={(event) => setCustomGameType(event.target.value)} className="glass-control type-input h-10 min-w-0 flex-1 rounded-xl px-3" placeholder="添加自定义类型" /><button type="button" className="secondary-pill type-button h-10 px-4" onClick={() => { const value = customGameType.trim(); if (value && !gameTypes.includes(value)) setGameTypes((current) => [...current, value]); setCustomGameType('') }}>添加自定义类型</button></div></fieldset>
        <section className="rounded-2xl border border-red-300/25 bg-red-400/[0.07] p-4"><h3 className="type-callout text-red-100">危险区域</h3><p className="type-caption-2 mt-1 text-red-200/70">删除后将无法恢复 Pack 及其资源。</p><label className="mt-3 grid gap-2 type-caption-2 text-red-100">输入 Pack 名称以确认<input aria-label="输入 Pack 名称以确认" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="glass-control type-input h-10 rounded-xl px-3" placeholder={pack.name} /></label><button type="button" disabled={confirmation !== pack.name || deleting} onClick={() => void remove()} className="type-button mt-3 rounded-full border border-red-300/40 bg-red-400/15 px-4 py-2 text-red-100 disabled:cursor-not-allowed disabled:opacity-40">{deleting ? '删除中…' : '确认删除 Pack'}</button></section>
      </div>
      {error ? <p role="alert" className="relative z-10 mt-5 rounded-xl border border-red-300/20 bg-red-400/10 p-3 type-footnote text-red-200">{error}</p> : null}
      <footer className="relative z-10 mt-6 flex justify-end border-t border-white/10 pt-5"><button disabled={saving} className="primary-pill type-button h-10 px-5 disabled:cursor-not-allowed disabled:opacity-50">{saving ? '保存中…' : '保存 Pack'}</button></footer>
    </form>
  </div>
}
