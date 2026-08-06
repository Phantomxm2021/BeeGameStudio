import { z } from 'zod/v4'
import {
  commitResourceInventory,
  type ResourceInventoryDecision,
} from './resource-inventory-commit'
import type { ProjectResourceSelectionClient } from './project-resource-application'
import type { ProvisionalResourceAdapter } from './provisional-resource-adapters'

const commonDecision = {
  requirement_id: z.string().trim().min(1),
  resource_id: z.string().trim().min(1),
  selection_reason: z.array(z.string().trim().min(1)).min(1),
}
export const resourceInventoryCommitInputSchema = z.object({
  decisions: z.array(z.discriminatedUnion('kind', [
    z.object({
      ...commonDecision,
      kind: z.literal('library'),
      pack_id: z.string().trim().min(1),
      expected_pack_version: z.string().trim().min(1),
      element_id: z.string().trim().min(1),
      destination_path: z.string().trim().min(1),
    }).strict(),
    z.object({
      ...commonDecision,
      kind: z.literal('placeholder'),
      destination_path: z.string().trim().min(1),
      format: z.string().trim().min(1),
      reason: z.string().trim().min(1),
      asset_kind: z.string().trim().min(1),
      capabilities: z.array(z.string().trim().min(1)).optional(),
      parameters: z.record(z.string(), z.unknown()).optional(),
    }).strict(),
  ])).min(1),
}).strict()

type Input = z.infer<typeof resourceInventoryCommitInputSchema>
type BuildTool = (definition: Record<string, unknown>) => unknown

export function createNativeResourceInventoryCommitTool(options: {
  buildTool: BuildTool
  workspacePath: string
  dispatchId: string
  client: ProjectResourceSelectionClient
  provisionalAdapters: readonly ProvisionalResourceAdapter[]
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  assertMutationAuthority(): Promise<void>
}): unknown {
  return options.buildTool({
    name: 'CommitResourceInventory',
    alwaysLoad: true,
    inputSchema: resourceInventoryCommitInputSchema,
    isConcurrencySafe: () => false,
    isReadOnly: () => false,
    async description() {
      return 'Validate and durably apply one complete Resource Library or proven-no-match decision for every required resource group.'
    },
    async prompt() {
      return [
        'Submit exactly one complete decision set after ResourceLibrary match_requirements.',
        'Choose exact returned candidate identities. A placeholder is allowed only for a no-match group and remains a normal independently replaceable project resource.',
        'This is the only Resource Curator mutation and terminal operation. It persists progress before downloading or converting and resumes incomplete operations after interruption.',
      ].join(' ')
    },
    async checkPermissions(input: Input) {
      return { behavior: 'allow', updatedInput: input }
    },
    async call(input: Input) {
      const parsed = resourceInventoryCommitInputSchema.parse(input)
      const decisions: ResourceInventoryDecision[] = parsed.decisions.map(decision =>
        decision.kind === 'library'
          ? {
              requirementId: decision.requirement_id,
              kind: 'library',
              resourceId: decision.resource_id,
              packId: decision.pack_id,
              expectedPackVersion: decision.expected_pack_version,
              elementId: decision.element_id,
              destinationPath: decision.destination_path,
              selectionReason: decision.selection_reason,
            }
          : {
              requirementId: decision.requirement_id,
              kind: 'placeholder',
              resourceId: decision.resource_id,
              destinationPath: decision.destination_path,
              format: decision.format,
              reason: decision.reason,
              selectionReason: decision.selection_reason,
              assetKind: decision.asset_kind,
              ...(decision.capabilities ? { capabilities: decision.capabilities } : {}),
              ...(decision.parameters ? { parameters: decision.parameters } : {}),
            },
      )
      const receipt = await commitResourceInventory({
        workspacePath: options.workspacePath,
        dispatchId: options.dispatchId,
        client: options.client,
        provisionalAdapters: options.provisionalAdapters,
        fetchImpl: options.fetchImpl,
        input: { decisions },
        assertMutationAuthority: options.assertMutationAuthority,
      })
      return { data: {
        accepted: true,
        receipt_path: receipt.receiptPath,
        bindings: receipt.bindings.map(binding => ({
          requirement_id: binding.requirementId,
          resource_ids: binding.resourceIds,
        })),
      } }
    },
    renderToolUseMessage() {
      return '资源库存 · 提交'
    },
    mapToolResultToToolResultBlockParam(output: unknown, toolUseID: string) {
      return { tool_use_id: toolUseID, type: 'tool_result', content: JSON.stringify(output) }
    },
  })
}
