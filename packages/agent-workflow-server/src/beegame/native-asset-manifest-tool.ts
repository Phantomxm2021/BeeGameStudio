import {
  RESOURCE_ASSET_KINDS,
  RESOURCE_CAPABILITIES,
  RESOURCE_DIMENSIONS,
  RESOURCE_EMBEDDED_COMPONENT_KINDS,
  RESOURCE_RELATION_KINDS,
  RESOURCE_USAGE_TAGS,
  type ResourceLibraryUsage,
} from '@bee-game-studio/beegame-resource-core'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod/v4'
import {
  BEEGAME_RESOURCE_ROOTS,
  CURRENT_ASSET_MANIFEST_VERSION,
  parseCanonicalBeeGameAssetManifest,
  readBeeGameAssetManifest,
  writeBeeGameAssetManifest,
} from './asset-contracts'
import {
  BEEGAME_CONTENT_SCHEMA,
  BEEGAME_JSON_CONTENT_KINDS,
  BEEGAME_YAML_CONTENT_KINDS,
} from './content-contracts'

const projectTargetSchema = z
  .object({
    platform: z.string().trim().min(1).optional(),
    runtime: z.string().trim().min(1).optional(),
    asset_format_capabilities: z.array(z.string().trim().min(1)).min(1),
  })
  .strict()

const requirementSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1).optional(),
    purpose: z.string().trim().min(1).optional(),
    required: z.boolean().optional(),
    acquisition_profile: z
      .object({
        dimensions: z.array(z.enum(RESOURCE_DIMENSIONS)).min(1),
        asset_kinds: z.array(z.enum(RESOURCE_ASSET_KINDS)).min(1),
        usage_tags: z.array(z.enum(RESOURCE_USAGE_TAGS)),
        capabilities: z.array(z.enum(RESOURCE_CAPABILITIES)),
        styles: z.array(z.string().trim().min(1)),
        coverage: z.array(z.object({
          asset_kinds: z.array(z.enum(RESOURCE_ASSET_KINDS)).optional(),
          usage_tags: z.array(z.enum(RESOURCE_USAGE_TAGS)).optional(),
          capabilities: z.array(z.enum(RESOURCE_CAPABILITIES)).optional(),
          relation_kinds: z.array(z.enum(RESOURCE_RELATION_KINDS)).optional(),
          embedded_kinds: z.array(z.enum(RESOURCE_EMBEDDED_COMPONENT_KINDS)).optional(),
        }).strict().refine(value => Object.values(value).some(item => item !== undefined), 'coverage entries require at least one constraint')).optional(),
      })
      .strict(),
  })
  .strict()

const inputSchema = z.object({
  action: z.literal('submit_resource_plan'),
  project_target: projectTargetSchema,
  requirements: z.array(requirementSchema).min(1).max(256),
}).strict()

type AssetManifestInput = z.infer<typeof inputSchema>
type BuildTool = (definition: Record<string, unknown>) => unknown

async function submitResourcePlan(
  workspacePath: string,
  resourceLibraryUsage: ResourceLibraryUsage,
  input: Extract<AssetManifestInput, { action: 'submit_resource_plan' }>,
) {
  const projectTarget = {
    ...input.project_target,
    resource_library_usage: resourceLibraryUsage,
    runtime_asset_root: BEEGAME_RESOURCE_ROOTS.runtime,
    content_root: BEEGAME_RESOURCE_ROOTS.content,
    generated_asset_root: BEEGAME_RESOURCE_ROOTS.generated,
  }
  const path = join(workspacePath, 'assets', 'asset-manifest.json')
  if (!existsSync(path)) {
    const manifest = parseCanonicalBeeGameAssetManifest({
      version: CURRENT_ASSET_MANIFEST_VERSION,
      project_target: projectTarget,
      requirements: input.requirements,
      resources: [],
    })
    await writeBeeGameAssetManifest(workspacePath, manifest)
    return manifest
  }
  const existing = await readBeeGameAssetManifest(workspacePath)
  if (!isDeepStrictEqual(existing.project_target, projectTarget))
    throw new Error(
      'An established resource plan cannot change project_target in place.',
    )
  const submitted = new Set(input.requirements.map(item => item.id))
  const omitted = existing.requirements
    .map(item => item.id)
    .filter(id => !submitted.has(id))
  if (omitted.length)
    throw new Error(
      `Resource plan cannot silently remove requirement identities: ${omitted.join(', ')}.`,
    )
  const manifest = parseCanonicalBeeGameAssetManifest({
    ...existing,
    requirements: input.requirements,
  })
  await writeBeeGameAssetManifest(workspacePath, manifest)
  return manifest
}

export function createNativeAssetManifestTool(options: {
  buildTool: BuildTool
  workspacePath: string
  resourceLibraryUsage: ResourceLibraryUsage
}): unknown {
  return options.buildTool({
    name: 'AssetManifest',
    alwaysLoad: true,
    inputSchema,
    isConcurrencySafe: () => false,
    isReadOnly: () => false,
    async description() {
      return 'Create the canonical resource plan and author or register independently replaceable project resources.'
    },
    async prompt() {
      return [
        'AssetManifest is the only writer for assets/asset-manifest.json.',
        `submit_resource_plan commits canonical modular Manifest v8 through the service-owned writer. The confirmed Resource Library policy is system-owned and fixed to ${options.resourceLibraryUsage}. The system also owns assets/runtime, assets/content and assets/generated as the three project roots. Do not provide or reinterpret policy or root paths.`,
        'asset_format_capabilities declares runtime-consumable output formats, not permitted Resource Library source extensions. Every requirement acquisition_profile is the sole structured source-discovery contract and must not be inferred from identifiers, names or filenames.',
        'Resource acquisition, conversion and replaceable placeholder creation occur later through the sole CommitResourceInventory transaction. This planning tool does not write media or bindings.',
        `Every content file uses schema ${BEEGAME_CONTENT_SCHEMA} plus id, kind, fulfills, resources and data. JSON owns resource mappings, entities, UI, audio, events, waves and numeric configuration; its allowed kinds are ${BEEGAME_JSON_CONTENT_KINDS.join(', ')}. YAML owns only world, scene, hierarchy and instance placement; its allowed kinds are ${BEEGAME_YAML_CONTENT_KINDS.join(', ')}. Do not duplicate one fact in JSON and YAML.`,
        'The modular manifest accepts only the declared v8 project target, requirements and resource records. Keep substitutable media out of gameplay source and keep engine-specific structures in project content or target adapters.',
      ].join(' ')
    },
    async checkPermissions(input: AssetManifestInput) {
      return { behavior: 'allow', updatedInput: input }
    },
    async call(input: AssetManifestInput) {
      const parsed = inputSchema.safeParse(input)
      if (!parsed.success) throw new Error(z.prettifyError(parsed.error))
      const manifest = await submitResourcePlan(
        options.workspacePath,
        options.resourceLibraryUsage,
        parsed.data,
      )
      return { data: { accepted: true, requirement_count: manifest.requirements.length } }
    },
    renderToolUseMessage(input: Partial<AssetManifestInput>) {
      return input.action ? `资源与内容 · ${input.action}` : '资源与内容'
    },
    mapToolResultToToolResultBlockParam(output: unknown, toolUseID: string) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: JSON.stringify(output),
      }
    },
  })
}
