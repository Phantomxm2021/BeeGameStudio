import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { basename, dirname, join } from 'node:path'
import * as ts from 'typescript'

const deliveryWorkflowRoot = dirname(dirname(fileURLToPath(import.meta.url)))

const protectedFoundationFiles = [
  'foundation-audit-artifacts.ts',
  'foundation-audit-authority.ts',
  'foundation-audit-check-definitions.ts',
  'foundation-audit-contracts.ts',
  'foundation-audit-production-manifest.ts',
  'foundation-audit-rules.ts',
  'foundation-audit-state.ts',
  'foundation-fact-definitions.ts',
  'foundation-fact-extraction.ts',
  'foundation-fact-runtime.ts',
  'foundation-fact-store.ts',
  'foundation-impact-analysis.ts',
  'foundation-issue-registry.ts',
  'foundation-patch-validation.ts',
  'foundation-revision-batches.ts',
  'foundation-revision-publication.ts',
  'foundation-revision-round-policy.ts',
  'foundation-revision-stage.ts',
  'foundation-semantic-audit.ts',
  'foundation-semantic-runtime.ts',
  'revision.ts',
] as const

const gameIrContractFiles = ['contracts.ts'] as const

function boundaryViolations(source: string): string[] {
  const file = ts.createSourceFile(
    'boundary.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const violations: string[] = []
  const gameIrModule = (value: string) => /(?:^|\/)game-ir(?:\/|$)/.test(value)
  const moduleViolation = (kind: string, value: string) => {
    if (gameIrModule(value)) violations.push(`${kind}: ${value}`)
  }
  const runtimeIdentifier = (node: ts.Identifier): boolean => {
    return (
      /^(?:GameIr|gameIr)[A-Za-z0-9_]*$/.test(node.text) ||
      /^GAME_IR[A-Za-z0-9_]*$/.test(node.text) ||
      /(?:enable|switch).*gameir|gameir.*(?:enable|switch)/i.test(node.text)
    )
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      if (ts.isStringLiteral(node.moduleSpecifier))
        moduleViolation('import', node.moduleSpecifier.text)
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      moduleViolation('export', node.moduleSpecifier.text)
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      moduleViolation('import-equals', node.moduleReference.expression.text)
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword)
        moduleViolation('dynamic-import', node.arguments[0].text)
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'require'
      )
        moduleViolation('require', node.arguments[0].text)
    }
    if (ts.isIdentifier(node) && runtimeIdentifier(node))
      violations.push(`identifier: ${node.text}`)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return violations
}

function currentStage5Markers(source: string): string[] {
  return boundaryViolations(source)
}

function standaloneProductionViolations(
  files: ReadonlyArray<{ path: string; source: string }>,
): string[] {
  return files.flatMap(file =>
    currentStage5Markers(file.source).map(
      violation => `${file.path}: ${violation}`,
    ),
  )
}

async function readSourceFilesRecursively(
  directory: string,
): Promise<Array<{ path: string; source: string }>> {
  const files: Array<{ path: string; source: string }> = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory())
      files.push(...(await readSourceFilesRecursively(path)))
    else if (entry.isFile())
      files.push({ path, source: await readFile(path, 'utf8') })
  }
  return files
}

async function readProductionSourceFiles(): Promise<
  Array<{ path: string; source: string }>
> {
  const files: Array<{ path: string; source: string }> = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === 'game-ir' || entry.name.endsWith('.test.ts')) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && entry.name.endsWith('.ts'))
        files.push({ path, source: await readFile(path, 'utf8') })
    }
  }
  await visit(deliveryWorkflowRoot)
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

describe('Game IR stage boundary', () => {
  test('keeps the DTO seam independent from Foundation internals', async () => {
    for (const filename of gameIrContractFiles) {
      const source = await readFile(
        join(dirname(fileURLToPath(import.meta.url)), filename),
        'utf8',
      )
      expect(source).toContain("from '../types'")
      expect(source).not.toMatch(
        /from ['"].*foundation-(?:audit|fact|issue|revision)/,
      )
      expect(source).not.toMatch(/from ['"].*(?:controller|schema|recovery)/)
    }
  })

  test('rejects every forbidden import and foundation token in synthetic source', () => {
    const syntheticViolations = [
      "import { compileGame } from './game-ir/runtime'",
      "export { compileGame } from './game-ir/runtime'",
      "import x = require('./game-ir/runtime')",
      "const x = require('./game-ir/runtime')",
      "const x = import('./game-ir/runtime')",
      'type GameIrResult = unknown',
      'const kind = GAME_IR_ENABLED',
      'const state = enableGameIr',
      'const state = switchGameIr',
    ].map(source => boundaryViolations(source))

    expect(syntheticViolations).toEqual([
      ['import: ./game-ir/runtime'],
      ['export: ./game-ir/runtime'],
      ['import-equals: ./game-ir/runtime'],
      ['require: ./game-ir/runtime'],
      ['dynamic-import: ./game-ir/runtime'],
      ['identifier: GameIrResult'],
      ['identifier: GAME_IR_ENABLED'],
      ['identifier: enableGameIr'],
      ['identifier: switchGameIr'],
    ])
    expect(
      boundaryViolations(
        "// import './game-ir/runtime'\nconst text = 'GameIrResult'",
      ),
    ).toEqual([])
    expect(
      boundaryViolations(
        'const object = { GameIrState: "x" }; const value = object.GameIrState; const run = { gameIrState: value }; const config = { enableGameIr: true }',
      ),
    ).toEqual([
      'identifier: GameIrState',
      'identifier: GameIrState',
      'identifier: gameIrState',
      'identifier: enableGameIr',
    ])

    expect(
      standaloneProductionViolations([
        {
          path: 'synthetic-import.ts',
          source: "import { compileGame } from './game-ir/runtime'",
        },
      ]),
    ).toEqual(['synthetic-import.ts: import: ./game-ir/runtime'])
  })

  test('keeps Foundation internals independent from Game IR', async () => {
    const sourceFiles = await readSourceFilesRecursively(deliveryWorkflowRoot)
    for (const filename of protectedFoundationFiles) {
      const matches = sourceFiles.filter(
        file => basename(file.path) === filename,
      )
      expect(matches).toHaveLength(1)
      expect({
        filename,
        violations: boundaryViolations(matches[0]!.source),
      }).toEqual({ filename, violations: [] })
    }
  })

  test('keeps incomplete Stage 5 unreachable from current production files', async () => {
    expect(
      standaloneProductionViolations(await readProductionSourceFiles()),
    ).toEqual([])
  })
})
