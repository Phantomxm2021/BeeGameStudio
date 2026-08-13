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
- Each call accepts at most 8,192 characters of content. For a larger file, create it with a bounded overwrite, then continue with a small number of bounded append calls.
- Use \`overwrite\` only when replacing the complete file. To preserve content already written and continue a large file, use \`append\` with expected_bytes set to the file's exact current byte length. For compatibility, repeated writes to a file newly created during this session continue it safely; pre-existing files keep normal overwrite behavior. A stale or replayed append is rejected instead of duplicating content.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.
- The file_path must be a distinct file path, not a directory path. If the path resolves to an existing directory, the tool will reject it with a clear error message. Use a path that includes a filename with an appropriate extension (e.g., \`my-docs/analysis/api/report.md\`).`
}
