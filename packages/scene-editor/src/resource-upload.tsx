import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'

/** Shared upload control; registration is supplied by the owning project. */
export function ResourceUploadButton({ onUpload, disabled = false, label = 'Upload assets' }: {
  onUpload: (files: File[]) => Promise<void>; disabled?: boolean; label?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const busy = useRef(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  async function upload(files: File[]) {
    if (!files.length || busy.current) return
    busy.current = true; setUploading(true); setError('')
    try { await onUpload(files) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { busy.current = false; setUploading(false); if (input.current) input.current.value = '' }
  }
  return <div>
    <label title="Upload one file, or select a PNG and its matching JSON atlas together" className="type-caption-2 inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]" style={{ cursor: disabled || uploading ? 'default' : 'pointer', opacity: disabled || uploading ? .5 : 1 }}>
      <Upload size={14} />{uploading ? 'Uploading…' : label}
      <input ref={input} aria-label={label} type="file" multiple disabled={disabled || uploading} style={{ display: 'none' }}
        onChange={event => void upload(Array.from(event.currentTarget.files ?? []))} />
    </label>
    {error ? <p role="alert" className="settings-error">{error}</p> : null}
  </div>
}
