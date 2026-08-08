import { z } from 'zod/v4'
import {
  commitResourceInventory,
  type ResourceInventoryDecision,
} from './resource-inventory-commit'
import type { ProjectResourceSelectionClient } from './project-resource-application'
import type { ProvisionalResourceAdapter } from './provisional-resource-adapters'
import { readBeeGameAssetManifest } from './asset-contracts'

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
      parameters: z.record(z.string(), z.unknown()).optional(),
    }).strict(),
  ])).default([]),
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
      return 'Validate and durably apply one complete Resource Library or proven-no-match decision set for every required resource group.'
    },
    async prompt() {
      const manifest = await readBeeGameAssetManifest(options.workspacePath)
      const runtimeAssetRoot = manifest.project_target?.runtime_asset_root
      if (!runtimeAssetRoot)
        throw new Error('Canonical resource plan is missing runtime_asset_root')
      const allowedFormats = new Set(
        manifest.project_target?.asset_format_capabilities ?? [],
      )
      const activeAdapters = options.provisionalAdapters.filter(adapter =>
        allowedFormats.has(adapter.format),
      )
      const existingProvisionalResources = manifest.resources
        .filter(resource => resource.provisional)
        .map(resource =>
          `${resource.id} -> root_path=${resource.root_path}; file_paths=${resource.file_paths.join(', ')}`,
        )
      return [
        'Submit exactly one complete decision set after ResourceLibrary match_requirements.',
        'When a previous CommitResourceInventory call has already created a prepared or applying durable receipt, resume that exact frozen receipt by submitting decisions: []; do not reconstruct or change the decision set. Otherwise submit the complete set below.',
        'Choose exact identities from one returned bundle per requirement when matched. For a no-match group, submit one or more independently replaceable placeholder resources when one resource cannot cover every declared duty; never mix placeholders with library decisions for the same requirement.',
        'For every decision, selection_reason must be a non-empty array of strings. For a placeholder, asset_kind must be copied exactly from that requirement’s placeholder_asset_kinds returned by ResourceLibrary; never guess a kind or add fields outside the schema.',
        `Library decisions must use exactly kind=library, requirement_id, resource_id, pack_id, expected_pack_version (copy the candidate pack_version here), element_id, destination_path and selection_reason. Do not send bundle_id or pack_version. Placeholder decisions must use exactly kind=placeholder, requirement_id, resource_id, destination_path, format, reason, asset_kind, optional parameters and selection_reason. Every destination_path must be under ${runtimeAssetRoot}; do not use the content or generated asset roots.`,
        'When replacing an existing provisional resource, keep its project resource_id so the library resource replaces it in place.',
        existingProvisionalResources.length
          ? `Existing provisional resource paths are canonical and immutable for their resource_id; when reusing one of these IDs, copy its exact root_path and file_paths instead of inventing a new path: ${existingProvisionalResources.join(' | ')}`
          : '',
        'This is the only Resource Curator mutation and terminal operation. It persists progress before downloading or converting and resumes incomplete operations after interruption.',
        `Active target provisional adapters: ${activeAdapters.map(adapter => adapter.description).join(' | ')}`,
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
