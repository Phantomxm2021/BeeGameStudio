import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import type { FoundationDocumentPath } from '../domain/types'

// Fixed offline protocol responses captured on 2026-09-06 from the repository
// complete-game-document-fixture. These are test data, not real model outputs
// or a semantic-quality baseline. Runtime tests never load the old generator.
export const FROZEN_DOCUMENTS_SHA256 = '7cae09cdb668d1e68f97d9a00eaacf8ba40ce20d16ea2ff84a1ab33a1ef7558d'
const bytes = gunzipSync(Buffer.from(
  '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',
  'base64',
)).toString('utf8')
if (createHash('sha256').update(bytes).digest('hex') !== FROZEN_DOCUMENTS_SHA256)
  throw new Error('Frozen offline document bytes changed')
export const FROZEN_DOCUMENTS = Object.freeze(JSON.parse(bytes)) as Readonly<Record<FoundationDocumentPath, string>>
