import type { ProgressMessage } from 'src/types/message.js'
import {
  getToolUseSummary,
  renderToolResultMessage as renderEditResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  renderToolUseRejectedMessage,
  userFacingName,
} from '../FileEditTool/UI.js'
import type { MultiEditInput, MultiEditOutput } from './types.js'

export {
  getToolUseSummary,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  renderToolUseRejectedMessage,
  userFacingName,
}

export function renderToolResultMessage(
  output: MultiEditOutput,
  progressMessages: ProgressMessage[],
  options: { style?: 'condensed'; verbose: boolean },
): React.ReactNode {
  return renderEditResultMessage(
    {
      filePath: output.filePath,
      oldString: '',
      newString: '',
      originalFile: output.originalFile,
      structuredPatch: output.structuredPatch,
      userModified: output.userModified,
      replaceAll: false,
      ...(output.gitDiff && { gitDiff: output.gitDiff }),
    },
    progressMessages,
    options,
  )
}

export function getMultiEditActivityDescription(
  input: Partial<MultiEditInput>,
): string {
  const summary = getToolUseSummary(input)
  return summary ? `Editing ${summary}` : 'Editing file'
}
