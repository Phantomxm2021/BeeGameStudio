import { mkdir, writeFile } from 'node:fs/promises'
import { TILEMAP_AUTHORING_CONTRACT } from './tilemap-authoring-contract'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BEEGAME_RESOURCE_ROOTS,
  CURRENT_ASSET_MANIFEST_VERSION,
  BEEGAME_RESOURCE_STATUSES,
  type BeeGameAssetManifest,
  type BeeGameProjectResourceSource,
} from './asset-contracts'
import { RESOURCE_DIMENSIONS, RESOURCE_ASSET_KINDS, RESOURCE_SOURCE_KINDS, RESOURCE_LIBRARY_USAGE } from '@bee-game-studio/beegame-resource-core'

/**
 * This is an author-facing project artifact, not a second validator or a
 * workflow protocol.  It makes the same registry interface that the host
 * reads visible to an ordinary CLI turn before that turn writes resources.
 */
export const ASSET_MANIFEST_AUTHORING_CONTRACT_PATH =
  'assets/manifest/CONTRACT.md' as const
export const ASSET_MANIFEST_VALIDATION_COMMAND = 'bun assets/manifest/check.mjs' as const
let checkerBundle: Promise<string> | undefined

export const assetSourceAuthoringExamples = {
  'resource-library': {
    type: 'resource-library', pack_id: 'pack-example', pack_version: '1',
    element_id: 'element-example', element_path: 'sprites/example.png',
  },
  web: {
    type: 'web', source_url: 'https://example.com/assets/example.png',
    page_url: 'https://example.com/assets', license: 'Example licence',
    retrieved_at: '2026-01-01T00:00:00.000Z',
  },
  'agent-authored': {
    type: 'agent-authored', created_at: '2026-01-01T00:00:00.000Z',
    reason: 'Example only.',
  },
  'user-provided': {
    type: 'user-provided', created_at: '2026-01-01T00:00:00.000Z',
    filename: 'example.png',
  },
} satisfies Record<BeeGameProjectResourceSource['type'], BeeGameProjectResourceSource>

function bundledResourceChecker(): Promise<string> {
  return checkerBundle ??= Bun.build({
    entrypoints: [fileURLToPath(new URL('./resource-validation-cli.ts', import.meta.url))],
    target: 'bun', format: 'esm', minify: true,
  }).then(async build => {
    if (!build.success) throw new Error(`Cannot publish resource checker: ${build.logs.join('\n')}`)
    return build.outputs[0]!.text()
  })
}

export function assetManifestAuthoringExamples(): {
  canonical: BeeGameAssetManifest
  index: Record<string, unknown>
  requirementsModule: Record<string, unknown>
  resourceModule: Record<string, unknown>
} {
  const canonical: BeeGameAssetManifest = {
    version: CURRENT_ASSET_MANIFEST_VERSION,
    project_target: {
      platform: 'web',
      runtime: 'example-runtime',
      asset_format_capabilities: ['json'],
      resource_library_usage: 'optional',
      runtime_asset_root: BEEGAME_RESOURCE_ROOTS.runtime,
      generated_asset_root: BEEGAME_RESOURCE_ROOTS.generated,
    },
    requirements: [
      {
        id: 'EXAMPLE-RUNTIME-DATA',
        name: 'Example runtime data',
        purpose: 'Demonstrates one registered project resource.',
        required: true,
        acquisition_profile: {
          dimensions: ['agnostic'],
          asset_kinds: ['data'],
          usage_tags: [],
          capabilities: [],
          styles: ['example'],
        },
      },
    ],
    resources: [
      {
        id: 'EXAMPLE-RUNTIME-DATA-01',
        fulfills: ['EXAMPLE-RUNTIME-DATA'],
        source: assetSourceAuthoringExamples['agent-authored'],
        root_path: 'assets/runtime/example/resource.json',
        file_paths: ['assets/runtime/example/resource.json'],
        provisional: false,
        status: 'verified',
        selected_at: '2026-01-01T00:00:00.000Z',
        selection_reason: ['Example only.'],
        dimension: 'agnostic',
        asset_kind: 'data',
        styles: ['example'],
      },
    ],
  }
  return {
    canonical,
    index: {
      version: CURRENT_ASSET_MANIFEST_VERSION,
      project_target: canonical.project_target,
      modules: {
        requirements: 'assets/manifest/requirements/example.json',
        resources: ['assets/manifest/resources/example-runtime-data.json'],
      },
    },
    requirementsModule: { requirements: canonical.requirements },
    resourceModule: canonical.resources[0],
  }
}

export async function materializeAssetManifestAuthoringContract(
  workspacePath: string,
): Promise<string> {
  const path = join(workspacePath, ASSET_MANIFEST_AUTHORING_CONTRACT_PATH)
  await mkdir(dirname(path), { recursive: true })
  // Bundle the existing host checker, not a second implementation. The agent
  // runs a project-local command without access to BGS source directories.
  await writeFile(join(dirname(path), 'check.mjs'),
    `// Generated validator: run this file; authoring rules are in CONTRACT.md.\n${await bundledResourceChecker()}`, 'utf8')
  await writeFile(path, renderAssetManifestAuthoringContract(), 'utf8')
  return ASSET_MANIFEST_AUTHORING_CONTRACT_PATH
}

export function renderAssetManifestAuthoringContract(section: 'registration' | 'atlas' | 'tilemap' | 'full' = 'full'): string {
  const examples = assetManifestAuthoringExamples()
  const json = (value: unknown) => JSON.stringify(value, null, 2)
  const registration = `## Registration request

Use this input with resources.mjs request.json or combine requests with --register-from.
Minimal local-authoring request (replace example values with actual project facts):

\`\`\`json
${json({ operation: 'register', projectTarget: examples.canonical.project_target,
  requirements: examples.canonical.requirements, resources: [{
    id: 'EXAMPLE-RUNTIME-DATA-01', fulfills: ['EXAMPLE-RUNTIME-DATA'],
    root_path: 'assets/runtime/example/resource.json', file_paths: ['assets/runtime/example/resource.json'],
    provisional: false, reason: 'Locally authored example data.', selection_reason: ['Matches the actual requirement.'],
  }] })}
\`\`\`

The example target supports JSON only; supply the actual approved runtime and supported formats.
For locally authored files, omit source and supply resource.reason. Explicit source accepts web or resource-library provenance; user-provided files use the upload/import path.
Hashes, status, timestamps and registry modules are computed, not request fields.
fulfills names actual requirement IDs. root_path is a loadable file in file_paths; selection_reason is a non-empty string array.
On later registration, omit projectTarget or pass it unchanged; existing requirements cannot be redefined.
Use --contract full for source fields, enums and saved registry examples; --contract atlas or --contract tilemap for those formats.
`
  const atlas = `## Sprite atlas contract

Named atlas entries must use \`frames: { "idle": { "frame": { "x": 0, "y": 0, "w": 32, "h": 32 } } }\`.
Use an image and same-basename JSON sidecar in file_paths. Flat rectangles, rotated and trimmed entries are not supported.
Every rectangle must fit inside the actual image dimensions. Render the full atlas before registering it; do not clamp rectangles to conceal cropped artwork.
Run the resource checker after generating assets. Editors and Agent-written game code consume this data; the Agent owns target-engine mapping, not a BGS game runtime.`
  const tilemap = `## Optional rectangular TileSet data\n\n${json(TILEMAP_AUTHORING_CONTRACT)}\n`
  if (section === 'registration') return registration
  if (section === 'atlas') return atlas
  if (section === 'tilemap') return tilemap
  return `# Asset Manifest authoring contract (v${CURRENT_ASSET_MANIFEST_VERSION})

This is the canonical resource registry reference for this project. Consult the
relevant section when authoring assets; resources.mjs --contract registration
provides the compact registration input. This reference does not prescribe a
source, engine, asset creation method or work organization.

For locally authored or downloaded files, use the resources.mjs entry supplied
in the current project tool context with --help
and its batch register operation. Supply source facts and file paths; the tool
computes hashes and writes the canonical modules/index. Do not hand-fill hashes.
Select and download library files with assets.mjs; preserve its registrationSource
as source in the same resources.mjs registration, including downloaded dependency bindings.
Define the project-wide target and actual requirement IDs consistently. A separate
configuration request with resources:[] may be combined with resource requests
using --register-from. Include every required supported runtime format.
The data-only example below is not a PNG/audio/font target configuration.

## Registration input versus saved manifest

The canonical examples below describe **saved output**, not resources.mjs
request objects. In a register or atlas resource input, explicit \`source\`
accepts only \`web\` or \`resource-library\` with the provenance fields below.
For locally agent-authored files, **omit source** and supply \`resource.reason\`;
the registrar writes \`source.type=agent-authored\`, \`created_at\`, hashes,
status and selection time. Do not copy those generated fields or the canonical
agent-authored/user-provided source examples into a registration request.
User-provided provenance is written by the upload/import path; do not relabel
those files as agent-authored.

${registration}

## Deliverables

- \`assets/asset-manifest.json\` is an **index**, not a flat asset list.
- Its \`modules.requirements\` path is one JSON file directly under
  \`assets/manifest/requirements/\` with exactly \`{ "requirements": [...] }\`.
- Each path in \`modules.resources\` is one JSON file directly under
  \`assets/manifest/resources/\` whose root is one resource object.
- Every required requirement must be named by at least one resource's
  \`fulfills\` array. Resource files belong under
  \`project_target.runtime_asset_root\` (normally \`assets/runtime\`).
- Use workspace-relative paths. Record source, licence facts where applicable,
  and hashes as \`local_file_hashes: { "assets/runtime/file.ext": "64-character lowercase sha256" }\`.
  \`hashes\` is not consumed for integrity checking; do not use it instead.
  \`root_path\` is a loadable entry **file**, not a directory, and must occur in
  \`file_paths\`. Audio groups may choose one real clip as their default entry.
  Do not put Scene/UI/VFX content definitions in
  this registry.

## Canonical example

### \`assets/asset-manifest.json\`

\`\`\`json
${json(examples.index)}
\`\`\`

### \`assets/manifest/requirements/example.json\`

\`\`\`json
${json(examples.requirementsModule)}
\`\`\`

### \`assets/manifest/resources/example-runtime-data.json\`

\`\`\`json
${json(examples.resourceModule)}
\`\`\`

## Canonical values

- dimensions: ${json(RESOURCE_DIMENSIONS)}
- source types: ${json(RESOURCE_SOURCE_KINDS)}
- source fields (examples; replace placeholder values with actual provenance):

\`\`\`json
${json(assetSourceAuthoringExamples)}
\`\`\`

  Web sources require the original asset URL, page URL, licence and retrieval
  time. Library sources require the pack and selected element identity. Keep
  source details attached to each registered resource; these examples do not
  prescribe which source to use.
- resource-library usage: ${json(RESOURCE_LIBRARY_USAGE)}
- requirement asset kinds: ${json(RESOURCE_ASSET_KINDS)}
- resource status: ${json(BEEGAME_RESOURCE_STATUSES)}
- \`usage_tags\` and \`capabilities\` describe the asset in your own words (string
  arrays), not a closed catalogue vocabulary. Extra resource/source description
  fields such as \`notes\` and \`toolchain\` are preserved, not rejected.

${atlas}

${tilemap}

## Check the actual delivery interface

From the project root, run \`${ASSET_MANIFEST_VALIDATION_COMMAND}\` when useful.
The generated \`check.mjs\` is executable code, not an authoring document; use
this CONTRACT.md for the format instead of reading the bundled checker. This
is the host's own read-only checker, bundled into the project. Exit 0 means
the resource interface passes; exit 1 returns specific issues. It checks registry
readability, required bindings, files, hashes and the confirmed sourcing policy.
It does not certify artistic or gameplay quality and does not require another
agent. If correcting an existing delivery, retain usable assets and address the
reported issues rather than recreating everything.

Use only relevant fields. Preserve the exact index/module separation above;
the host reads the completed registry after this turn finishes.
`
}
