import { FILE_READ_TOOL_NAME } from '../FileReadTool/prompt.js'

export const FILE_WRITE_TOOL_NAME = 'Write'
export const DESCRIPTION = 'Write a file to the local filesystem.'

function getPreReadInstruction(): string {
  return `\n- If this is an existing file, you MUST use the ${FILE_READ_TOOL_NAME} tool first to read the file's contents. This tool will fail if you did not read the file first.`
}
export function getWriteToolDescription(): string {
  return `Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.${getPreReadInstruction()}
- Prefer the Edit tool for modifying existing files \u2014 it only sends the diff. Only use this tool to create new files or for complete rewrites.
- For a long file, first create a small stable scaffold, then use the Edit tool to fill its sections in a small number of durable steps. Avoid constructing the entire long file as one tool argument. Choose the checkpoints yourself from the file's natural structure.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.`
}
