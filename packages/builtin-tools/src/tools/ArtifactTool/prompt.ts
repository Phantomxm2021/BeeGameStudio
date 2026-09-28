export const ARTIFACT_TOOL_NAME = 'artifact'

export async function describeArtifactTool(): Promise<string> {
  return 'With the user’s approval, upload an HTML or Markdown file to the configured Bee Game Studio artifact service and get a public URL. This is separate from the game publisher and the project Artifacts panel.'
}

export async function getArtifactToolPrompt(): Promise<string> {
  return `With explicit user approval, upload an HTML or Markdown file to the configured Bee Game Studio public artifact service and return a shareable URL plus an internal \`id\` (the "hash"). Do not use this to satisfy local project-file or manifest checks. If the service is not configured, report that fact instead of choosing another host.

## Inputs
- \`file_path\` (required): absolute path to a local HTML (\`.html\`/\`.htm\`) or Markdown (\`.md\`/\`.markdown\`) file. Markdown is converted to a styled HTML document before upload — just author plain Markdown (headings, lists, GFM tables, fenced code blocks, blockquotes) and the tool wraps it in a page with a neutral stylesheet.
- \`hash\` (optional): if provided, overwrites the artifact with the same hash (URL stays the same). If omitted, a new random id is generated.
- \`ttl\` (optional, default \`7\`): artifact lifetime in days. Must be \`7\` or \`30\`.

## Output
\`{ id, url, expiresAt }\` — \`id\` is the hash (save it for future overwrite calls), \`url\` is publicly accessible.

## Workflow
1. Use the Write tool to create a local \`.html\` or \`.md\` file.
2. Call this tool with its \`file_path\`.
3. If iterating on the same artifact, pass back the \`id\` returned from the first call as \`hash\` so the URL stays stable.

## Errors
The tool surfaces backend error codes verbatim (e.g. \`payload_too_large\`, \`unauthorized\`). If the file does not exist, is not a regular file, or has an unsupported extension, the tool returns an \`error\` field without making an HTTP request. Accepted extensions: \`.html\`, \`.htm\`, \`.md\`, \`.markdown\`.`
}
