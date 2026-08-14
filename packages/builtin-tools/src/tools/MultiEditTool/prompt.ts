import { FILE_READ_TOOL_NAME } from '../FileReadTool/prompt.js'

export function getMultiEditToolDescription(): string {
  return `Performs multiple exact string replacements in the same file as one atomic operation.

Usage:
- Use ${FILE_READ_TOOL_NAME} before editing. The tool rejects unread or stale files.
- Provide every replacement in declared order. Each replacement is validated before any bytes are written.
- If any replacement fails, the entire operation fails and the file remains unchanged.
- Use this tool when several independent exact replacements for the same file are already known.
- Each old_string must be unique unless replace_all is true.
- Do not target text introduced by an earlier replacement in the same atomic operation.
- The file_path must identify a file, not a directory.`
}
