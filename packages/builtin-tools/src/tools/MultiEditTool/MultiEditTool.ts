import type { ToolUseContext } from 'src/Tool.js'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { expandPath } from 'src/utils/path.js'
import {
  checkWritePermissionForTool,
} from 'src/utils/permissions/filesystem.js'
import type { PermissionDecision } from 'src/utils/permissions/PermissionResult.js'
import { matchWildcardPattern } from 'src/utils/permissions/shellRuleMatching.js'
import {
  executeFileEdits,
  validateFileEdits,
} from '../FileEditTool/fileEditPipeline.js'
import { areFileEditsInputsEquivalent } from '../FileEditTool/utils.js'
import { MULTI_EDIT_TOOL_NAME } from './constants.js'
import { getMultiEditToolDescription } from './prompt.js'
import {
  type MultiEditInput,
  type MultiEditOutput,
  inputSchema,
  outputSchema,
} from './types.js'
import {
  getMultiEditActivityDescription,
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  renderToolUseRejectedMessage,
  userFacingName,
} from './UI.js'

export const MultiEditTool = buildTool({
  name: MULTI_EDIT_TOOL_NAME,
  searchHint: 'batch exact replacements one file',
  maxResultSizeChars: 100_000,
  strict: true,
  async description() {
    return 'A tool for atomically editing one file in multiple places'
  },
  async prompt() {
    return getMultiEditToolDescription()
  },
  userFacingName,
  getToolUseSummary,
  getActivityDescription: getMultiEditActivityDescription,
  get inputSchema() {
    return inputSchema()
  },
  get outputSchema() {
    return outputSchema()
  },
  toAutoClassifierInput(input) {
    return `${input.file_path}: ${input.edits.length} atomic edits`
  },
  getPath(input): string {
    return input.file_path
  },
  backfillObservableInput(input) {
    if (typeof input.file_path === 'string') {
      input.file_path = expandPath(input.file_path)
    }
  },
  async preparePermissionMatcher({ file_path }) {
    return pattern => matchWildcardPattern(pattern, file_path)
  },
  async checkPermissions(input, context): Promise<PermissionDecision> {
    const appState = context.getAppState()
    return checkWritePermissionForTool(
      MultiEditTool,
      input,
      appState.toolPermissionContext,
    )
  },
  renderToolUseMessage,
  renderToolResultMessage,
  renderToolUseRejectedMessage,
  renderToolUseErrorMessage,
  async validateInput(input: MultiEditInput, context: ToolUseContext) {
    return validateFileEdits(normalizeMultiEditInput(input), context)
  },
  inputsEquivalent(input1, input2) {
    return areFileEditsInputsEquivalent(
      normalizeMultiEditInput(input1),
      normalizeMultiEditInput(input2),
    )
  },
  async call(input, context, _, parentMessage) {
    const data = await executeFileEdits(
      normalizeMultiEditInput(input),
      context,
      parentMessage,
    )
    return { data }
  },
  mapToolResultToToolResultBlockParam(data: MultiEditOutput, toolUseID) {
    const modifiedNote = data.userModified
      ? ' The user modified the proposed changes before accepting them.'
      : ''
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `The file ${data.filePath} has been updated successfully with ${data.edits.length} atomic edits.${modifiedNote}`,
    }
  },
} satisfies ToolDef<ReturnType<typeof inputSchema>, MultiEditOutput>)

function normalizeMultiEditInput(input: MultiEditInput) {
  return {
    file_path: input.file_path,
    edits: input.edits.map(edit => ({
      ...edit,
      replace_all: edit.replace_all ?? false,
    })),
  }
}
