import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod/v4'
import {
  authorityEvidenceRefSchema,
  type AuthorityEvidenceRef,
} from './foundation-authority-sidecar'

export const DOCUMENT_LICENSE_STATES = [
  'planned_original',
  'source_not_selected',
  'license_unverified',
  'verified',
  'replacement_required',
] as const

export const documentEvidenceEntrySchema = z
  .object({
    evidenceId: z
      .string()
      .trim()
      .min(1)
      .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
    category: z.enum([
      'search_direction',
      'design_reference',
      'production_asset',
    ]),
    displayName: z.string().trim().min(1).max(240),
    purpose: z.string().trim().min(1).max(600),
    state: z.enum(DOCUMENT_LICENSE_STATES),
    sourceLocator: z.string().trim().min(1).max(1_024).optional(),
    licenseType: z.string().trim().min(1).max(240).optional(),
    commercialUse: z.boolean().optional(),
    attribution: z.string().trim().min(1).max(600).optional(),
    evidenceRefs: z.array(authorityEvidenceRefSchema),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.state !== 'verified') return
    for (const [field, present] of [
      ['sourceLocator', entry.sourceLocator !== undefined],
      ['licenseType', entry.licenseType !== undefined],
      ['commercialUse', entry.commercialUse !== undefined],
      ['attribution', entry.attribution !== undefined],
      ['evidenceRefs', entry.evidenceRefs.length > 0],
    ] as const) {
      if (!present)
        context.addIssue({
          code: 'custom',
          message: `verified document evidence requires ${field}`,
          path: [field],
        })
    }
    if (
      !entry.evidenceRefs.some(reference =>
        ['file', 'license', 'url'].includes(reference.kind),
      )
    )
      context.addIssue({
        code: 'custom',
        message:
          'verified document evidence requires a file, license, or stable URL reference',
        path: ['evidenceRefs'],
      })
  })

export type DocumentEvidenceEntry = Readonly<
  Omit<z.infer<typeof documentEvidenceEntrySchema>, 'evidenceRefs'> & {
    evidenceRefs: readonly AuthorityEvidenceRef[]
  }
>

function bytewise(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
}

function assertSafeHttpUrl(value: string, label: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label} is not a valid URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error(`${label} must use http or https`)
}

function projectRelativePath(workspacePath: string, locator: string): string {
  if (isAbsolute(locator))
    throw new Error('document evidence path must be project-relative')
  const root = resolve(workspacePath)
  const target = resolve(root, locator)
  const projectRelative = relative(root, target)
  if (
    !projectRelative ||
    projectRelative.startsWith('..') ||
    isAbsolute(projectRelative)
  )
    throw new Error('document evidence path is outside the project root')
  return target
}

export async function validateDocumentEvidenceEntries(input: {
  workspacePath: string
  entries: readonly unknown[]
}): Promise<readonly DocumentEvidenceEntry[]> {
  const entries = canonicalDocumentEvidenceEntries(input.entries)
  for (const entry of entries) {
    if (entry.sourceLocator?.includes(':'))
      assertSafeHttpUrl(
        entry.sourceLocator,
        `document evidence source locator for ${entry.evidenceId}`,
      )
    for (const reference of entry.evidenceRefs) {
      if (
        reference.kind === 'url' ||
        (reference.kind === 'license' && reference.locator.includes(':'))
      ) {
        assertSafeHttpUrl(
          reference.locator,
          `document evidence URL for ${entry.evidenceId}`,
        )
        continue
      }
      if (reference.kind !== 'file' && reference.kind !== 'license') continue
      const target = projectRelativePath(input.workspacePath, reference.locator)
      let stats
      try {
        stats = await lstat(target)
      } catch {
        throw new Error(
          `document evidence file is missing for ${entry.evidenceId}: ${reference.locator}`,
        )
      }
      if (!stats.isFile())
        throw new Error(
          `document evidence locator is not a regular file for ${entry.evidenceId}: ${reference.locator}`,
        )
      const actualDigest = createHash('sha256')
        .update(await readFile(target))
        .digest('hex')
      if (reference.digest !== actualDigest)
        throw new Error(
          `document evidence digest mismatch for ${entry.evidenceId}: ${reference.locator}`,
        )
    }
  }
  return entries
}

export function canonicalDocumentEvidenceEntries(
  input: readonly unknown[],
): readonly DocumentEvidenceEntry[] {
  const entries = z.array(documentEvidenceEntrySchema).parse(input)
  const ids = entries.map(entry => entry.evidenceId)
  if (new Set(ids).size !== ids.length)
    throw new Error('document evidence IDs are duplicated')
  return Object.freeze(
    [...entries]
      .sort((left, right) => bytewise(left.evidenceId, right.evidenceId))
      .map(entry =>
        Object.freeze({
          ...entry,
          evidenceRefs: Object.freeze(
            [...entry.evidenceRefs]
              .sort((left, right) =>
                bytewise(
                  `${left.kind}\u0000${left.locator}\u0000${left.digest ?? ''}`,
                  `${right.kind}\u0000${right.locator}\u0000${right.digest ?? ''}`,
                ),
              )
              .map(reference => Object.freeze({ ...reference })),
          ),
        }),
      ),
  )
}

function tableCell(value: string | boolean | undefined): string {
  if (value === undefined) return '—'
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
}

function renderedState(entry: DocumentEvidenceEntry): string {
  if (entry.state === 'verified')
    return entry.commercialUse
      ? 'commercial use verified'
      : 'license verified; commercial use not permitted'
  return entry.state.replaceAll('_', ' ')
}

export function renderDocumentEvidenceRegister(
  entries: readonly DocumentEvidenceEntry[],
): string {
  return [
    '| Evidence ID | Name | Category | Purpose | State | Source | License | Attribution | Evidence |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...entries.map(entry =>
      [
        tableCell(entry.evidenceId),
        tableCell(entry.displayName),
        tableCell(entry.category),
        tableCell(entry.purpose),
        tableCell(renderedState(entry)),
        tableCell(entry.sourceLocator),
        tableCell(entry.licenseType),
        tableCell(entry.attribution),
        tableCell(
          entry.evidenceRefs
            .map(reference => `${reference.kind}:${reference.locator}`)
            .join(', ') || undefined,
        ),
      ].join(' | '),
    ),
  ]
    .map(line => (line.startsWith('|') ? line : `| ${line} |`))
    .join('\n')
}
