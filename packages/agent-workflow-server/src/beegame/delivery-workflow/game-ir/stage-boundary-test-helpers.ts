import { readdir, readFile } from 'node:fs/promises'
import * as ts from 'typescript'
import { basename, join } from 'node:path'

export const FOUNDATION_PROTECTED_FILES = [
  'packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-artifacts.ts',
  'packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-authority.ts',
  'packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-check-definitions.ts',
  'packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-contracts.ts',
  'packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-production-manifest.ts',
  'packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-rules.ts',
  'packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-state.ts',
  'packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-definitions.ts',
  'packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-extraction.ts',
  'packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.ts',
  'packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-store.ts',
  'packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-impact-analysis.ts',
  'packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-issue-registry.ts',
  'packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-patch-validation.ts',
  'packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-batches.ts',
  'packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-publication.ts',
  'packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-round-policy.ts',
  'packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-stage.ts',
  'packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-semantic-audit.ts',
  'packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-semantic-runtime.ts',
  'packages/agent-workflow-server/src/beegame/delivery-workflow/revision.ts',
] as const

export function boundaryViolations(source: string): string[] {
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
  const runtimeIdentifier = (node: ts.Identifier): boolean =>
    /^(?:GameIr|gameIr)[A-Za-z0-9_]*$/.test(node.text) ||
    /^GAME_IR[A-Za-z0-9_]*$/.test(node.text) ||
    /(?:enable|switch).*gameir|gameir.*(?:enable|switch)/i.test(node.text)
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

export async function readProductionSourceFiles(
  deliveryWorkflowRoot: string,
): Promise<Array<{ path: string; source: string }>> {
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
  return files.sort(
    (left, right) =>
      basename(left.path).localeCompare(basename(right.path)) ||
      left.path.localeCompare(right.path),
  )
}

export async function readSourceFilesRecursively(
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

export function standaloneProductionViolations(
  files: ReadonlyArray<{ path: string; source: string }>,
): string[] {
  return files.flatMap(file =>
    boundaryViolations(file.source).map(
      violation => `${file.path}: ${violation}`,
    ),
  )
}
