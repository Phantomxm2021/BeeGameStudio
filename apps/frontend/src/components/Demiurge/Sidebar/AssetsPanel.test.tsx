import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AssetsPanel } from './AssetsPanel'

vi.mock('../../../i18n/useBeeGameTranslations', () => ({
  useBeeGameText: () => ({ assets: { empty: 'Empty', title: 'Assets', libraryBinding: 'resources', required: 'required', optional: 'optional', noPurpose: 'No purpose', uploaded: 'Uploaded', integrated: 'Integrated', missing: 'Missing', placeholder: 'Placeholder', assetInfo: 'Info', type: 'Type', sourcePack: 'Source', target: 'Target', copiedFile: 'Files', members: 'Dependencies' } }),
}))

describe('AssetsPanel v7', () => {
  it('shows canonical resources and requirements', () => {
    render(<AssetsPanel isLoading={false} manifest={{ version: 8, project_target: { asset_format_capabilities: ['svg'], runtime_asset_root: 'assets/runtime', content_root: 'assets/content', generated_asset_root: 'assets/generated' }, requirements: [{ id: 'visual.player', required: true }], resources: [] }} />)
    expect(screen.getByText('visual.player')).toBeInTheDocument()
  })
})
