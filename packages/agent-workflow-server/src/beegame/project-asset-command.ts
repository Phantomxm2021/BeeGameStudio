import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export type ProjectAssetCapabilities = {
  libraryBaseUrl?: string
  imageEndpoint?: string
  mediaCommand?: string
}

/** Wrap existing host capabilities in one short-lived project-local CLI command. */
export async function writeProjectAssetCommand(
  path: string,
  capabilities: ProjectAssetCapabilities,
) {
  const template = await readFile(
    fileURLToPath(new URL('./project-asset-cli.mjs', import.meta.url)),
    'utf8',
  )
  const uiBoardCompiler = await readFile(
    fileURLToPath(new URL('../image-generation/ui-reference-board.mjs', import.meta.url)),
    'utf8',
  )
  await writeFile(
    path,
    `const TOOL_CONFIG = ${JSON.stringify(capabilities)}\n${uiBoardCompiler}\n${template}`,
    { mode: 0o600 },
  )
}
