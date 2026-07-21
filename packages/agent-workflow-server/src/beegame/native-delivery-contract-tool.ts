import { z } from 'zod/v4'
import {
  RESOURCE_ASSET_KINDS,
  RESOURCE_CAPABILITIES,
  RESOURCE_CATEGORIES,
  RESOURCE_COMPOSITION_KINDS,
  RESOURCE_DIMENSIONS,
  RESOURCE_LIBRARY_USAGE,
  RESOURCE_USAGE_TAGS,
} from '@bee-game-studio/beegame-resource-core'
import type { ResourceLibraryUsage } from '@bee-game-studio/beegame-resource-core'
import { auditDocumentReadiness, REQUIRED_PROJECT_DOCUMENTS } from './document-readiness-audit'
import { CANONICAL_ASSET_MANIFEST_EXAMPLE } from './asset-contracts'
import type { NativeResourceLibraryEvidenceState } from './native-resource-library-evidence'
import { auditResourceDeliveryReadiness } from './resource-delivery-readiness'

type BuildTool = (definition: Record<string, unknown>) => unknown

/**
 * Exposes BeeGame's deterministic deployment contract to Claude Code as a
 * read-only native capability. It reports facts only and never advances or
 * controls the Agent lifecycle.
 */
export function createNativeDeliveryContractTool(options: {
  buildTool: BuildTool
  workspacePath: string
  getConfirmedBriefContext?: () => string | undefined
  getResourceLibraryEvidence?: () => NativeResourceLibraryEvidenceState
}): unknown {
  return options.buildTool({
    name: 'ProjectDeliveryContract',
    alwaysLoad: true,
    maxResultSizeChars: 20_000,
    inputSchema: z.object({ action: z.literal('inspect') }),
    isConcurrencySafe: () => true,
    isReadOnly: () => true,
    async description() {
      return 'Inspect the current project against BeeGame deterministic document and asset-contract requirements without changing files or Agent state.'
    },
    async prompt() {
      return 'Use this read-only capability before native document review and before a delivery claim. Treat returned diagnostics as deployment facts. BeeGame does not interpret game semantics, edit the project, select resources, or control Claude Code.'
    },
    async checkPermissions(input: { action: 'inspect' }) {
      return { behavior: 'allow', updatedInput: input }
    },
    async call() {
      const confirmedBrief = parseConfirmedBrief(
        options.getConfirmedBriefContext?.(),
      )
      const documentReadiness = auditDocumentReadiness(options.workspacePath)
      const confirmedPolicy = confirmedResourcePolicy(confirmedBrief)
      const resourceReadiness = auditResourceDeliveryReadiness({
        workspacePath: options.workspacePath,
        ...(confirmedPolicy ? { confirmedPolicy } : {}),
        ...(options.getResourceLibraryEvidence
          ? { resourceEvidence: options.getResourceLibraryEvidence() }
          : {}),
      })
      return {
        data: {
          valid: documentReadiness.valid && resourceReadiness.valid,
          issues: [...documentReadiness.issues, ...resourceReadiness.issues],
          confirmed_brief: confirmedBrief,
          resource_contract: resourceReadiness,
          canonical_contract: {
            required_documents: REQUIRED_PROJECT_DOCUMENTS,
            checklist_task_shape: '- [ ] <stable-id> <observable action, expected result, and evidence>',
            asset_manifest_example: CANONICAL_ASSET_MANIFEST_EXAMPLE,
            asset_manifest_rules: {
              inventory_field: 'imports',
              responsibility_field: 'requirements',
              target_native_assembly_field: 'compositions',
              legacy_slots_accepted: false,
              asset_format_capabilities_semantics: 'Actual file extensions that the selected target runtime can consume; implementation libraries, render techniques, and platform names are invalid.',
            },
            resource_library_usage_allowed_values: [
              ...RESOURCE_LIBRARY_USAGE,
            ],
            asset_manifest_vocabularies: {
              dimensions: RESOURCE_DIMENSIONS,
              categories: RESOURCE_CATEGORIES,
              usage_tags: RESOURCE_USAGE_TAGS,
              asset_kinds: RESOURCE_ASSET_KINDS,
              capabilities: RESOURCE_CAPABILITIES,
              composition_kinds: RESOURCE_COMPOSITION_KINDS,
            },
          },
        },
      }
    },
    renderToolUseMessage() {
      return 'Inspect project delivery contract'
    },
    mapToolResultToToolResultBlockParam(output: unknown, toolUseID: string) {
      return { tool_use_id: toolUseID, type: 'tool_result', content: JSON.stringify(output) }
    },
  })
}

function confirmedResourcePolicy(value: unknown): ResourceLibraryUsage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const policy = (value as Record<string, unknown>).resource_library_usage
  return policy === 'optional' || policy === 'preferred' || policy === 'required'
    ? policy
    : undefined
}

function parseConfirmedBrief(value?: string): unknown {
  if (!value?.trim()) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null
  } catch {
    return null
  }
}
