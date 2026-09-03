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
  const routeImports = new Set([
    './game-ir/balance-producer',
    './game-ir/committed-reader',
    './game-ir/contracts',
    './game-ir/domain-projection',
    './game-ir/domain-source',
    './game-ir/foundation-ready-adapter',
    './game-ir/gameplay-balance-assembler',
    './game-ir/gameplay-producer',
    './game-ir/implementation-verification-assembler',
    './game-ir/implementation-verification-producer',
    './game-ir/model',
    './game-ir/phase5-admission',
    './game-ir/phase6-admission',
    './game-ir/phase7-admission',
    './game-ir/presentation-producer',
    './game-ir/publication',
    './game-ir/resource-realization-assembler',
    './game-ir/resource-realization-producer',
    './game-ir/semantic-obligation-inventory',
    './game-ir/semantic-obligation-validation',
    './game-ir/stage-checkpoint',
    './game-ir/staged-compiler',
    './game-ir/projection-slice-journal',
    './game-ir/projection-slices',
    './game-ir/world-presentation-assembler',
    './game-ir/world-scene-producer',
  ])
  const routeIdentifiers = new Set([
    'GAME_IR_CHECKPOINT_RECORD_KINDS',
    'GAME_IR_DOMAIN_IDS',
    'GAME_IR_MODULE_SOURCE_DOCUMENTS',
    'GAME_IR_STAGED_OPERATIONS',
    'GameIrCheckpointLoad',
    'GameIrCheckpointRecord',
    'GameIrCompileRequest',
    'GameIrStagedRecords',
    'gameIrCompilerAdmissionProgressIdentity',
    'gameIrHandlerFailure',
    'GameIrDomainId',
    'GameIrDomainSourceEnvelope',
    'GameIrReplayAuthority',
    'GameIrSemanticObligationRecord',
    'GameIrStageCheckpointLoader',
    'cleanupGameIrProjectionSliceJournalAfterCheckpoint',
    'createGameIrProjectionSliceJournal',
    'gameIrProjectionSliceJournalPath',
    'gameIrPreflightPacket',
    'deriveProjectionSlicePlan',
    'gameIrSchemaVersion',
    'gameIrState',
  ])
  const outside = new Map<string, ReadonlySet<string>>([
    [
      'beegame/delivery-worker-session-port.ts',
      new Set([
        'identifier: GameIrProjectionModuleId',
        'identifier: GameIrProjectionSlice',
        'identifier: gameIrCompilerTerminalSchema',
        'identifier: gameIrOperation',
        'identifier: gameIrOperationForRequest',
        'identifier: gameIrProjectionModuleForRequest',
        'identifier: gameIrProjectionSliceForRequest',
        'identifier: gameIrProjectionRecordStreamContract',
        'identifier: gameIrValidationStructuredOutputJsonSchema',
        'identifier: gameIrObligationValidationAuthorityForRequest',
        'identifier: gameIrPreflightRecordStreamContract',
        'identifier: gameIrSourceForRequest',
        'identifier: parseGameIrCompilerModelPayload',
        'identifier: parseGameIrProjectionRecordStream',
        'import: ./delivery-workflow/game-ir/model',
        'import: ./delivery-workflow/game-ir/projection-contract',
        'import: ./delivery-workflow/game-ir/projection-slices',
        'import: ./delivery-workflow/game-ir/projection-record-stream',
        'import: ./delivery-workflow/game-ir/semantic-fidelity',
        'import: ./delivery-workflow/game-ir/domain-source',
        'import: ./delivery-workflow/game-ir/semantic-obligation-inventory',
        'import: ./delivery-workflow/game-ir/semantic-obligation-validation',
      ]),
    ],
    [
      'beegame/delivery-workflow/recovery-projector.ts',
      new Set(['identifier: gameIrState']),
    ],
    [
      'beegame/delivery-workflow/recovery.ts',
      new Set([
        'import: ./game-ir/stage-checkpoint',
        'identifier: GameIrStageCheckpointLoader',
        'identifier: GameIrProtocolStep',
        'identifier: gameIrState',
        'identifier: gameIrTerminalActive',
        'identifier: GAME_IR_STAGED_OPERATIONS',
        'import: ./game-ir/projection-slice-journal',
        'identifier: cleanupGameIrProjectionSliceJournalAfterCheckpoint',
        'identifier: gameIrProjectionSliceJournalPath',
        'import: ./game-ir/projection-slices',
        'import: ./game-ir/staged-compiler',
      ]),
    ],
    [
      'beegame/delivery-workflow/schema.ts',
      new Set([
        'import: ./game-ir/contracts',
        'import: ./game-ir/model',
        'identifier: GameIrCheckpointRef',
        'identifier: GameIrCompilationIdentity',
        'identifier: GameIrReadyReceipt',
        'identifier: GameIrState',
        'identifier: gameIr',
        'identifier: gameIrCheckpointRefSchema',
        'identifier: gameIrCompilationIdentitySchema',
        'identifier: gameIrPlacementIsValid',
        'identifier: gameIrReadyReceiptDigest',
        'identifier: gameIrReadyReceiptSchema',
        'identifier: gameIrState',
        'identifier: gameIrStateSchema',
      ]),
    ],
    [
      'beegame/delivery-workflow/transition.ts',
      new Set([
        'import: ./game-ir/contracts',
        'import: ./game-ir/model',
        'identifier: GameIrCheckpointRef',
        'identifier: GameIrCompilationIdentity',
        'identifier: GameIrReadyEventState',
        'identifier: GameIrState',
        'identifier: gameIrReadyReceiptDigest',
        'identifier: gameIrState',
      ]),
    ],
    [
      'beegame/delivery-workflow/types.ts',
      new Set([
        'import: ./game-ir/contracts',
        'identifier: GameIrCheckpointRef',
        'identifier: GameIrCompilationDiagnostic',
        'identifier: GameIrCompilationIdentity',
        'identifier: GameIrCompilationProgressIdentity',
        'identifier: GameIrReadyReceipt',
        'identifier: GameIrState',
        'identifier: gameIrReadyReceiptDigest',
        'identifier: gameIrState',
      ]),
    ],
    [
      'beegame/delivery-workflow/worker-prompts.ts',
      new Set([
        'identifier: GameIrProjectionSlice',
        'identifier: gameIrProjectionSliceForRequest',
        'identifier: gameIrProjectionSliceFromContinuation',
        'import: ./game-ir/model',
        'import: ./game-ir/projection-slice-authority',
        'import: ./game-ir/projection-slices',
        'import: ./game-ir/semantic-obligation-inventory',
        'import: ./game-ir/semantic-obligation-validation',
      ]),
    ],
    [
      'beegame/delivery-workflow/worker-contracts.ts',
      new Set([
        'identifier: GameIrCompilerOperation',
        'identifier: GameIrObligationInventoryModelPayload',
        'identifier: GameIrObligationValidationModelPayload',
        'identifier: GameIrProjectionModelPayload',
        'identifier: GameIrValidationModelPayload',
        'identifier: gameIrCompilerTerminalSchema',
        'identifier: gameIrDiagnosticJsonSchema',
        'identifier: gameIrDiagnosticSchema',
        'identifier: gameIrJsonValue',
        'identifier: gameIrObligationInventoryModelPayloadSchema',
        'identifier: gameIrObligationInventoryTerminalSchema',
        'identifier: gameIrObligationRecordSchema',
        'identifier: gameIrObligationValidationModelPayloadSchema',
        'identifier: gameIrObligationValidationRawResultSchema',
        'identifier: gameIrObligationValidationTerminalSchema',
        'identifier: gameIrProjectionModelPayloadSchema',
        'identifier: gameIrProjectionTerminalSchema',
        'identifier: gameIrSemanticModelSchema',
        'identifier: gameIrSemanticTerminalSchema',
        'identifier: gameIrServiceIdentityFields',
        'identifier: gameIrText',
        'identifier: gameIrValidationJsonSchema',
        'identifier: gameIrValidationModelPayloadSchema',
        'identifier: gameIrValidationModelSchema',
        'identifier: gameIrValidationStructuredOutputJsonSchema',
        'identifier: gameIrValidationTerminalSchema',
      ]),
    ],
    [
      'beegame/delivery-workflow/workflow-display-message.ts',
      new Set(['identifier: GameIrCompilationDiagnostic']),
    ],
  ])
  return files.flatMap(file => {
    const violations = boundaryViolations(file.source)
    const isRoute = /\/(?:controller|dispatch)\.ts$/.test(file.path)
    const relative =
      file.path.split('/packages/agent-workflow-server/src/').pop() ?? file.path
    const allowed = outside.get(relative)
    return violations
      .filter(violation => {
        if (
          isRoute &&
          (violation.startsWith('import: ') ||
            violation.startsWith('identifier: '))
        ) {
          return violation.startsWith('import: ')
            ? !routeImports.has(violation.slice(8))
            : !routeIdentifiers.has(violation.slice(12))
        }
        return !(allowed?.has(violation) ?? false)
      })
      .map(violation => `${file.path}: ${violation}`)
  })
}
