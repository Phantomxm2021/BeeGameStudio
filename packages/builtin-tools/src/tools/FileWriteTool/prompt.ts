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
- This tool creates missing parent directories automatically; do not run a separate mkdir command first.
- When the caller provides an exact target path for a file that does not exist, write it directly; do not inspect or list its parent directory first.
- Prefer the Edit tool for modifying existing files \u2014 it only sends the diff. Only use this tool to create new files or for complete rewrites.
- IMPORTANT: Never send a complete long document or other long file as one Write argument. First create a small stable scaffold, then normally use 2 to 3 Edit calls to fill it. For a sectioned document, put several adjacent headings under each of 2 or 3 grouped placeholders instead of creating one placeholder per section. Group related sections into each durable step and choose the checkpoints yourself from the file's natural structure.
- Trust each successful file mutation result instead of rereading completed sections. Unless a mutation reports an error, validate the completed file once after all planned steps.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.`
}
