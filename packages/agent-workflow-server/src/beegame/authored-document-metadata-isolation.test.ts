import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Frozen before stage retirement. Retained historical reads, Checklist metadata
// and fsync must stay byte-identical; explicitly retired functions must be absent.
const protectedFunctions = {
  "readAuthoredDocumentReceipt": "4ee66e3ee7c85b949d1622c8a2dadf84ffd11ac842fc9cdeab0d277207e2771f",
  "commitRemediatedDocumentMetadata": "41834124c581842d7429da5b8bd73922c463a1aace8d6472e826745ae2cadeba",
  "commitFoundationRevisionDocumentMetadata": "40b984deea8c25a48a4d99f371c50bd584eb3d86a5387286acaea3a8f0d34bb3",
  "validateFoundationRevisionDocumentMetadataTransition": "61d3fd5dc3b6ec34b5c9d23958964cf58841cd9a2ed21b01c40a6ac93699e6ba",
  "nextRemediatedUpdatedAt": "251f7ecd2f0ead1081b9baa43c6ae5c915d00738af6b70824d792e15ac921df4",
  "assertWorkspaceFilePath": "029a0006859a8da086eb35948de076a6b51b4bbf9a39631bf0d7c80e3828c192",
  "authoredDocumentReceiptPath": "f545e3e7120878ad8c4b357aa93a28ff3884af213e54c834cad47159bcc34963",
  "validateDispatchId": "3cd6b021dde0c7794e8a75fea879ef3c76655e602175d4c08aa140b9e15565a1",
  "durableWrite": "16d13c57639e6a8a8f47492678bfdb89d8699f10229c94f177e73842f09d42a5",
  "syncDirectories": "16619112ce4b2cd34a8bb056e6df868f93a1dbb180e52d5b553d76d515163aba",
  "readOptionalFile": "7f4ab41609b30f0664ce9e6acf41438cbeb2601cc88c11ba9f2f1f4de1484fdb",
  "digest": "30edfd4b25711c815cf248a752c34607bddaacb42909f39d9bb5cfd0f3efab23",
  "parseRemediatedVersion": "7a8dda3e50d2f76cb454312d3f5fea213cfbd32477689563898293ca997e0e67",
  "parseRemediatedDocumentMetadata": "eaf5b373a2d3fa5ebf93057ca909a23326216e12ad30687036333eb3445e3cd2",
  "normalizeServiceOwnedDocumentMetadata": "bcb89040812751a19bd0484708679be981a604d5afbcf165d2d0115ab927a471"
}

test('retiring stage receipt writers preserves historical reads, Checklist metadata and fsync byte-identically', () => {
  const source = readFileSync(new URL('./authored-document-receipt.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('authored-document-receipt.ts', source, ts.ScriptTarget.Latest, true)
  const retired = new Set([
    'commitFoundationRevisionDocumentMetadata', 'validateFoundationRevisionDocumentMetadataTransition',
    'nextRemediatedUpdatedAt', 'assertWorkspaceFilePath', 'digest',
    'parseRemediatedVersion', 'parseRemediatedDocumentMetadata', 'normalizeServiceOwnedDocumentMetadata',
  ])
  for (const [name, hash] of Object.entries(protectedFunctions)) {
    const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
    if (retired.has(name)) {
      expect(declaration).toBeUndefined()
      continue
    }
    expect(declaration).toBeDefined()
    expect(createHash('sha256').update(declaration!.getText(ast)).digest('hex')).toBe(hash)
  }
})
