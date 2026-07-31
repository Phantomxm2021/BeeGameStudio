import { z } from 'zod/v4'
import {
  parseCanonicalBeeGameAssetManifest,
  writeBeeGameAssetManifest,
} from './asset-contracts'

const assetManifestInputSchema = z
  .object({
    content: z.string().trim().min(1),
  })
  .strict()

type BuildTool = (definition: Record<string, unknown>) => unknown

/**
 * The only manifest-authoring lane for a fresh resource dispatch. The model
 * supplies ordinary JSON text so deeply nested arrays keep their native JSON
 * representation. Validation happens before persistence, and decision
 * timestamps are owned by the workflow service.
 */
export function createNativeAssetManifestTool(options: {
  buildTool: BuildTool
  workspacePath: string
  now?: () => Date
}): unknown {
  return options.buildTool({
    name: 'SubmitAssetManifest',
    alwaysLoad: true,
    inputSchema: assetManifestInputSchema,
    isConcurrencySafe: () => false,
    isReadOnly: () => false,
    async description() {
      return 'Validate and persist the one canonical BeeGame asset manifest from JSON text.'
    },
    async prompt() {
      return 'Call exactly once with content set to the complete canonical manifest as valid JSON text. Every source_decision must include a non-empty reasons array; omit decided_at because the workflow service records the accepted decision time. Invalid JSON or manifests are rejected before any file is written.'
    },
    async checkPermissions(input: z.infer<typeof assetManifestInputSchema>) {
      return { behavior: 'allow', updatedInput: input }
    },
    async call(input: z.infer<typeof assetManifestInputSchema>) {
      let candidate: unknown
      try {
        candidate = JSON.parse(input.content)
      } catch (error) {
        throw new Error(
          `Invalid asset manifest JSON: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      const submittedAt = (options.now ?? (() => new Date()))().toISOString()
      if (isRecord(candidate) && Array.isArray(candidate.requirements)) {
        for (const requirement of candidate.requirements) {
          if (!isRecord(requirement) || !isRecord(requirement.source_decision))
            continue
          requirement.source_decision.decided_at = submittedAt
        }
      }
      const manifest = parseCanonicalBeeGameAssetManifest(candidate)
      await writeBeeGameAssetManifest(options.workspacePath, manifest)
      return {
        data: {
          accepted: true,
          requirementCount: manifest.requirements.length,
          decidedAt: submittedAt,
        },
      }
    },
    renderToolUseMessage() {
      return '提交资产清单'
    },
    mapToolResultToToolResultBlockParam(output: unknown, toolUseID: string) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: JSON.stringify(output),
      }
    },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
