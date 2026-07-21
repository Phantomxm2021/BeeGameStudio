import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { CreateResourcePackInput, ResourcePackSummary } from '../../services/resourceLibraryApi'
import { ResourcePackFormDialog, type ResourcePackFormValues } from './ResourcePackFormDialog'

type Props = {
  open: boolean
  onClose: () => void
  onCreate: (input: CreateResourcePackInput) => Promise<ResourcePackSummary>
}

const initialValues: ResourcePackFormValues = {
  name: '', styles: [], dimension: 'agnostic', gameTypes: [], primaryCategory: '', description: '', tags: '',
  version: '0.1.0', license: '', author: '', source: '', licenseEvidence: '', compatibleEngines: '',
}

export function CreateResourcePackDialog({ open, onClose, onCreate }: Props) {
  const { t } = useTranslation()
  const copy = useMemo(() => ({
    title: translated(t, 'resourceLibrary.create', '创建 Pack'),
    creating: translated(t, 'resourceLibrary.creating', '创建中…'),
  }), [t])
  return <ResourcePackFormDialog
    open={open}
    title={copy.title}
    submitLabel={copy.title}
    submittingLabel={copy.creating}
    initialValues={initialValues}
    onClose={onClose}
    formTestId="create-pack-dialog"
    contentTestId="create-pack-content"
    metadataTestId="create-pack-metadata"
    onSubmit={async values => {
      await onCreate({
        name: values.name,
        styles: values.styles,
        dimension: values.dimension,
        primaryCategory: values.primaryCategory || 'mixed',
        gameTypes: values.gameTypes,
        categories: [],
        ...(values.description.trim() ? { description: values.description.trim() } : {}),
        ...(values.tags.trim() ? { tags: splitList(values.tags) } : {}),
        ...(values.version.trim() ? { version: values.version.trim() } : {}),
        ...(values.license.trim() ? { license: values.license.trim() } : {}),
        ...(values.author.trim() ? { author: values.author.trim() } : {}),
        ...(values.source.trim() ? { source: values.source.trim() } : {}),
        ...(values.licenseEvidence.trim() ? { licenseEvidence: values.licenseEvidence.trim() } : {}),
        ...(values.compatibleEngines.trim() ? { compatibleEngines: splitList(values.compatibleEngines) } : {}),
      })
    }}
  />
}

function translated(t: (key: string) => string, key: string, fallback: string): string {
  const value = t(key)
  return value === key ? fallback : value
}

function splitList(value: string): string[] {
  return [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))]
}
