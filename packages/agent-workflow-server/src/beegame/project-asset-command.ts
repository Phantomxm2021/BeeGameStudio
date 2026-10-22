import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export type ProjectAssetCapabilities = {
  // Managed tools resolve live access from the native session environment.
  sessionId?: string
  libraryBaseUrl?: string
  imageEndpoint?: string
  mediaCommand?: string
}

// Capture tool sources when the host module loads, like its imported compiler.
// Later turns must not combine an old host with files from a newer checkout.
const template = readFileSync(fileURLToPath(new URL('./project-asset-cli.mjs', import.meta.url)), 'utf8')
const uiBoardCompiler = readFileSync(fileURLToPath(new URL('../image-generation/ui-reference-board.mjs', import.meta.url)), 'utf8')

/** Write a project-local CLI; managed sessions resolve live access at invocation. */
export async function writeProjectAssetCommand(
  path: string,
  capabilities: ProjectAssetCapabilities,
) {
  await writeFile(
    path,
    `const TOOL_CONFIG = ${JSON.stringify(capabilities)}\n${uiBoardCompiler}\n${template}`,
    { mode: 0o600 },
  )
}
