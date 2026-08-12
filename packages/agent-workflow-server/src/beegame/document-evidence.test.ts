import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  renderDocumentEvidenceRegister,
  validateDocumentEvidenceEntries,
} from './document-evidence'

describe('document evidence', () => {
  test('accepts a verified external source only with complete license evidence', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'document-evidence-'))
    try {
      const entries = await validateDocumentEvidenceEntries({
        workspacePath,
        entries: [
          {
            evidenceId: 'reference.visual.primary',
            category: 'production_asset',
            displayName: 'Primary visual reference',
            purpose: 'Define a traceable production direction.',
            state: 'verified',
            sourceLocator: 'https://example.com/assets/visual-primary',
            licenseType: 'Commercial license',
            commercialUse: true,
            attribution: 'Attribution required in shipped credits.',
            evidenceRefs: [
              {
                kind: 'url',
                locator: 'https://example.com/licenses/visual-primary',
              },
            ],
          },
        ],
      })

      expect(entries[0]?.state).toBe('verified')
      expect(renderDocumentEvidenceRegister(entries)).toContain(
        'commercial use verified',
      )
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects verified claims with missing fields or unsafe URLs', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'document-evidence-'))
    try {
      const base = {
        evidenceId: 'reference.audio.primary',
        category: 'production_asset' as const,
        displayName: 'Primary audio reference',
        purpose: 'Define a traceable production direction.',
        state: 'verified' as const,
        sourceLocator: 'https://example.com/audio',
        licenseType: 'Commercial license',
        commercialUse: true,
        attribution: 'Attribution required.',
        evidenceRefs: [
          {
            kind: 'url' as const,
            locator: 'https://example.com/licenses/audio',
          },
        ],
      }
      for (const entry of [
        { ...base, sourceLocator: undefined },
        { ...base, licenseType: undefined },
        { ...base, commercialUse: undefined },
        { ...base, attribution: undefined },
        { ...base, evidenceRefs: [] },
        {
          ...base,
          evidenceRefs: [
            {
              kind: 'measurement' as const,
              locator: 'measurement:unrelated',
            },
          ],
        },
        { ...base, sourceLocator: 'javascript:alert(1)' },
        {
          ...base,
          evidenceRefs: [{ kind: 'url' as const, locator: 'data:text/plain,x' }],
        },
      ])
        await expect(
          validateDocumentEvidenceEntries({ workspacePath, entries: [entry] }),
        ).rejects.toThrow(/verified|source|license|commercial|attribution|evidence|url/i)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('checks local evidence existence, containment, regular-file status, and digest', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'document-evidence-'))
    try {
      await mkdir(join(workspacePath, 'assets', '_licenses'), { recursive: true })
      const evidenceBytes = 'license evidence\n'
      await writeFile(
        join(workspacePath, 'assets', '_licenses', 'primary.txt'),
        evidenceBytes,
      )
      const digest = createHash('sha256').update(evidenceBytes).digest('hex')
      const entry = {
        evidenceId: 'asset.primary',
        category: 'production_asset' as const,
        displayName: 'Primary production asset',
        purpose: 'Bind production use to evidence.',
        state: 'verified' as const,
        sourceLocator: 'https://example.com/asset',
        licenseType: 'Commercial license',
        commercialUse: true,
        attribution: 'No attribution required.',
        evidenceRefs: [
          {
            kind: 'file' as const,
            locator: 'assets/_licenses/primary.txt',
            digest,
          },
        ],
      }

      await expect(
        validateDocumentEvidenceEntries({ workspacePath, entries: [entry] }),
      ).resolves.toHaveLength(1)
      await expect(
        validateDocumentEvidenceEntries({
          workspacePath,
          entries: [
            {
              ...entry,
              evidenceRefs: [{ ...entry.evidenceRefs[0]!, digest: '0'.repeat(64) }],
            },
          ],
        }),
      ).rejects.toThrow(/digest/i)
      await expect(
        validateDocumentEvidenceEntries({
          workspacePath,
          entries: [
            {
              ...entry,
              evidenceRefs: [
                {
                  ...entry.evidenceRefs[0]!,
                  locator: 'assets/_licenses/missing.txt',
                },
              ],
            },
          ],
        }),
      ).rejects.toThrow(/missing|regular file|evidence/i)
      await expect(
        validateDocumentEvidenceEntries({
          workspacePath,
          entries: [
            {
              ...entry,
              evidenceRefs: [
                {
                  kind: 'license' as const,
                  locator: 'assets/_licenses/missing.txt',
                  digest,
                },
              ],
            },
          ],
        }),
      ).rejects.toThrow(/missing|regular file|evidence/i)
      await expect(
        validateDocumentEvidenceEntries({
          workspacePath,
          entries: [
            {
              ...entry,
              evidenceRefs: [
                { ...entry.evidenceRefs[0]!, locator: '../outside.txt' },
              ],
            },
          ],
        }),
      ).rejects.toThrow(/outside|project/i)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('renders unselected search directions without licensed language', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'document-evidence-'))
    try {
      const entries = await validateDocumentEvidenceEntries({
        workspacePath,
        entries: [
          {
            evidenceId: 'search.audio.direction',
            category: 'search_direction',
            displayName: 'Audio search direction',
            purpose: 'Describe the desired tonal family before source selection.',
            state: 'source_not_selected',
            evidenceRefs: [],
          },
        ],
      })
      const rendered = renderDocumentEvidenceRegister(entries)
      expect(rendered).toContain('source not selected')
      expect(rendered).not.toContain('commercial use verified')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
