import { useState } from 'react'
import type { CreateResourcePackInput, ResourcePackPrimaryCategory, ResourcePackSummary } from '../../services/resourceLibraryApi'
import { CONFIGURED_PRODUCTION_SETTING_OPTIONS } from '../../config/productionSettingOptions'

type Props = {
  open: boolean
  onClose: () => void
  onCreate: (input: CreateResourcePackInput) => Promise<ResourcePackSummary>
}

export function CreateResourcePackDialog({ open, onClose, onCreate }: Props) {
  const [name, setName] = useState('')
  const [styles, setStyles] = useState<string[]>([])
  const [dimension, setDimension] = useState<CreateResourcePackInput['dimension']>('agnostic')
  const [gameTypes, setGameTypes] = useState<string[]>([])
  const [customStyle, setCustomStyle] = useState('')
  const [customGameType, setCustomGameType] = useState('')
  const [primaryCategory, setPrimaryCategory] = useState<ResourcePackPrimaryCategory | ''>('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  if (!open) return null
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim() || styles.length === 0 || gameTypes.length === 0 || !primaryCategory) {
      setError('请填写 Pack 名称、风格和适用游戏类型，并选择主分类')
      return
    }
    setSaving(true); setError('')
    try {
      await onCreate({ name: name.trim(), style: styles.join(' / '), dimension, primaryCategory, gameTypes, categories: [] })
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '创建 Pack 失败') } finally { setSaving(false) }
  }
  const chipClass = (selected: boolean) => `type-caption-2 rounded-full border px-3 py-1.5 transition-colors ${selected ? 'border-orange-200/45 bg-orange-200/10 text-orange-100' : 'border-white/10 bg-white/[0.02] text-zinc-400 hover:border-white/20 hover:bg-white/[0.06] hover:text-zinc-200'}`
  const primaryCategoryOptions: ReadonlyArray<readonly [ResourcePackPrimaryCategory, string]> = [['2d-art', '2D 美术包'], ['3d-assets', '3D 资产包'], ['animation-rig', '动画与骨骼包'], ['ui-kit', 'UI Kit'], ['vfx', 'VFX 包'], ['audio', '音频包'], ['fonts', '字体包'], ['world-scene', '世界与场景包'], ['mixed', '综合资源包']]
  return <div role="dialog" aria-modal="true" aria-label="创建 Pack" className="fixed inset-0 z-[260] flex items-center justify-center bg-zinc-950/60 p-4 backdrop-blur-sm">
    <form onSubmit={submit} className="input-surface relative w-full max-w-lg rounded-3xl border border-white/15 p-6 shadow-2xl shadow-black/50">
      <header className="relative z-10 flex items-start justify-between gap-6 border-b border-white/10 pb-5"><div className="min-w-0"><p className="type-caption-1 text-zinc-500">资源库</p><h2 className="type-title-2 mt-1 text-zinc-100">创建 Pack</h2><p className="type-footnote mt-2 max-w-[34rem] text-zinc-500">先定义风格与使用场景，再添加资源。</p></div><button type="button" onClick={onClose} className="glass-icon-button h-9 w-9 shrink-0 text-lg" aria-label="关闭">×</button></header>
      <div className="relative z-10 mt-5 grid gap-5">
        <div data-testid="create-pack-metadata" className="grid gap-4 border-b border-white/10 pb-5 sm:grid-cols-2"><label className="type-callout grid gap-2 text-zinc-300 sm:col-span-2">名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="glass-control type-input h-11 rounded-xl px-3" placeholder="例如：Painterly Forest" /></label><label className="type-callout grid gap-2 text-zinc-300">维度<select value={dimension} onChange={(event) => setDimension(event.target.value as CreateResourcePackInput['dimension'])} className="glass-control type-input h-11 rounded-xl px-3"><option value="agnostic">混合</option><option value="2D">2D</option><option value="3D">3D</option></select></label><label className="type-callout grid gap-2 text-zinc-300">主分类<select value={primaryCategory} onChange={(event) => setPrimaryCategory(event.target.value as ResourcePackPrimaryCategory)} className="glass-control type-input h-11 rounded-xl px-3"><option value="">请选择资源类型</option>{primaryCategoryOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
        <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0"><legend className="type-callout block p-0 text-zinc-300">风格 <span className="type-caption-2 text-zinc-500">可多选</span></legend><div className="flex flex-wrap gap-2">{CONFIGURED_PRODUCTION_SETTING_OPTIONS.styles.map((option) => <button key={option} type="button" aria-pressed={styles.includes(option)} onClick={() => setStyles((current) => current.includes(option) ? current.filter((value) => value !== option) : [...current, option])} className={chipClass(styles.includes(option))}>{option}</button>)}</div><div className="flex gap-2"><input value={customStyle} onChange={(event) => setCustomStyle(event.target.value)} className="glass-control type-input h-10 min-w-0 flex-1 rounded-xl px-3" placeholder="添加自定义风格" /><button type="button" className="secondary-pill type-button h-10 px-4" onClick={() => { const value = customStyle.trim(); if (value && !styles.includes(value)) setStyles((current) => [...current, value]); setCustomStyle('') }}>添加</button></div></fieldset>
        <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0"><legend className="type-callout block p-0 text-zinc-300">适用游戏类型 <span className="type-caption-2 text-zinc-500">可多选</span></legend><div className="flex flex-wrap gap-2">{CONFIGURED_PRODUCTION_SETTING_OPTIONS.genres.map((option) => <button key={option} type="button" aria-pressed={gameTypes.includes(option)} onClick={() => setGameTypes((current) => current.includes(option) ? current.filter((value) => value !== option) : [...current, option])} className={chipClass(gameTypes.includes(option))}>{option}</button>)}</div><div className="flex gap-2"><input value={customGameType} onChange={(event) => setCustomGameType(event.target.value)} className="glass-control type-input h-10 min-w-0 flex-1 rounded-xl px-3" placeholder="添加自定义类型" /><button type="button" className="secondary-pill type-button h-10 px-4" onClick={() => { const value = customGameType.trim(); if (value && !gameTypes.includes(value)) setGameTypes((current) => [...current, value]); setCustomGameType('') }}>添加</button></div></fieldset>
      </div>
      {error ? <p role="alert" className="relative z-10 mt-5 rounded-xl border border-red-300/20 bg-red-400/10 p-3 type-footnote text-red-200">{error}</p> : null}
      <footer className="relative z-10 mt-6 flex justify-end border-t border-white/10 pt-5"><button disabled={saving} className="primary-pill type-button h-10 px-5 disabled:cursor-not-allowed disabled:opacity-50">{saving ? '创建中…' : '创建 Pack'}</button></footer>
    </form>
  </div>
}
