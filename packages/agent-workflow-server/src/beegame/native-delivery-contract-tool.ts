import { z } from 'zod/v4'
import { auditDocumentReadiness, REQUIRED_PROJECT_DOCUMENTS } from './document-readiness-audit'

type BuildTool = (definition: Record<string, unknown>) => unknown

/**
 * Exposes BeeGame's deterministic deployment contract to Claude Code as a
 * read-only native capability. It reports facts only and never advances or
 * controls the Agent lifecycle.
 */
export function createNativeDeliveryContractTool(options: {
  buildTool: BuildTool
  workspacePath: string
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
      return {
        data: {
          ...auditDocumentReadiness(options.workspacePath),
          canonical_contract: {
            required_documents: REQUIRED_PROJECT_DOCUMENTS,
            checklist_task_shape: '- [ ] <stable-id> <observable action, expected result, and evidence>',
            asset_manifest_minimum: {
              version: 1,
              project_target: {
                asset_format_capabilities: [],
              },
              slots: [],
            },
            resource_library_usage_allowed_values: [
              'optional',
              'preferred',
              'required',
            ],
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
