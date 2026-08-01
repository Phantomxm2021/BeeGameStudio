import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ResourcePackSummary, UpdateResourcePackInput } from '../../services/resourceLibraryApi'
import { ResourcePackFormDialog, type ResourcePackFormValues } from './ResourcePackFormDialog'

type Props = {
  open: boolean
  pack: ResourcePackSummary
  onClose: () => void
  onUploadCover: (file: File) => Promise<ResourcePackSummary>
  onSave: (input: UpdateResourcePackInput) => Promise<ResourcePackSummary>
}

export function EditResourcePackDialog({ open, pack, onClose, onUploadCover, onSave }: Props) {
  const { t } = useTranslation()
  const copy = useMemo(() => ({
    title: translated(t, 'resourceLibrary.editPack', '编辑 Pack'),
    update: translated(t, 'resourceLibrary.update', '保存 Pack'),
    updating: translated(t, 'resourceLibrary.updating', '保存中…'),
  }), [t])
  const initialValues = useMemo<ResourcePackFormValues>(() => ({
    name: pack.name,
    styles: [...pack.styles],
    dimension: pack.dimension,
    gameTypes: [...(pack.gameTypes || [])],
    primaryCategory: pack.primaryCategory,
    description: pack.description || '',
    tags: (pack.tags || []).join(', '),
    version: pack.version || '',
    license: pack.license || '',
    author: pack.author || '',
    source: pack.source || '',
    licenseEvidence: pack.licenseEvidence || '',
    compatibleEngines: (pack.compatibleEngines || []).join(', '),
  }), [pack])

  return (
    <ResourcePackFormDialog
    open={open}
    title={copy.title}
    submitLabel={copy.update}
    submittingLabel={copy.updating}
    initialValues={initialValues}
    onClose={onClose}
    allowCover
    formTestId="edit-pack-dialog"
    onSubmit={async (values, cover) => {
      if (cover) await onUploadCover(cover)
      await onSave({
        name: values.name,
        styles: values.styles,
        dimension: values.dimension,
        primaryCategory: values.primaryCategory || pack.primaryCategory,
        gameTypes: values.gameTypes,
        description: values.description.trim(),
        tags: splitList(values.tags),
        source: values.source.trim(),
        author: values.author.trim(),
        license: values.license.trim(),
        licenseEvidence: values.licenseEvidence.trim(),
        compatibleEngines: splitList(values.compatibleEngines),
        version: values.version.trim(),
      })
    }}
  />
  );
}

function translated(t: (key: string) => string, key: string, fallback: string): string {
  const value = t(key)
  return value === key ? fallback : value
}

function splitList(value: string): string[] {
  return [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))]
}
