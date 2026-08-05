import type { ResourceLibraryUsage } from '@bee-game-studio/beegame-resource-core'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod/v4'
import {
  BEEGAME_RESOURCE_ROOTS,
  CURRENT_ASSET_MANIFEST_VERSION,
  parseCanonicalBeeGameAssetManifest,
  readBeeGameAssetManifest,
  removeBeeGameUnboundResources,
  writeBeeGameAssetManifest,
} from './asset-contracts'
import {
  BEEGAME_CONTENT_SCHEMA,
  BEEGAME_JSON_CONTENT_KINDS,
  BEEGAME_YAML_CONTENT_KINDS,
} from './content-contracts'
import {
  authorProvisionalResources,
  type ProvisionalResourceAdapter,
} from './provisional-resource-adapters'

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
  })
  .strict()

const provisionalResourceSchema = z
  .object({
    id: z.string().trim().min(1),
    destination_path: z.string().trim().min(1),
    format: z.string().trim().min(1),
    reason: z.string().trim().min(1),
    selection_reason: z.array(z.string().trim().min(1)).min(1).max(8),
    asset_kind: z.string().trim().min(1),
    capabilities: z.array(z.string().trim().min(1)).min(1).optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

const inputSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('submit_resource_plan'),
      project_target: projectTargetSchema,
      requirements: z.array(requirementSchema).min(1).max(256),
    })
    .strict(),
  z
    .object({
      action: z.literal('author_provisional_resources'),
      resources: z.array(provisionalResourceSchema).min(1).max(64),
    })
    .strict(),
  z
    .object({
      action: z.literal('prune_unbound_resources'),
      resource_ids: z.array(z.string().trim().min(1)).min(1).max(64),
    })
    .strict(),
  z
    .object({
      action: z.literal('complete_resource_inventory'),
      bindings: z
        .array(
          z
            .object({
              requirement_id: z.string().trim().min(1),
              resource_ids: z.array(z.string().trim().min(1)).min(1),
            })
            .strict(),
        )
        .min(1),
    })
    .strict(),
])

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
  provisionalResourceAdapters?: readonly ProvisionalResourceAdapter[]
  allowedActions?: AssetManifestInput['action'][]
}): unknown {
  const provisionalAdapters = options.provisionalResourceAdapters ?? []
  return options.buildTool({
    name: 'AssetManifest',
    alwaysLoad: true,
    inputSchema,
    isConcurrencySafe: () => false,
    isReadOnly: (input: AssetManifestInput) =>
      input.action === 'complete_resource_inventory',
    async description() {
      return 'Create the canonical resource plan and author or register independently replaceable project resources.'
    },
    async prompt() {
      return [
        'AssetManifest is the only writer for assets/asset-manifest.json.',
        `submit_resource_plan commits canonical modular Manifest v8 through the service-owned writer. The confirmed Resource Library policy is system-owned and fixed to ${options.resourceLibraryUsage}. The system also owns assets/runtime, assets/content and assets/generated as the three project roots. Do not provide or reinterpret policy or root paths.`,
        `Register downloaded material only through ResourceLibrary import_resources. Create missing placeholders only through author_provisional_resources using one of the target adapters declared below. Match destination extension and asset_kind to the selected adapter. Generic file tools never write runtime_asset_root. A placeholder is provisional but uses the same stable resource identity and content references as final media. Available adapters: ${provisionalAdapters.map(adapter => adapter.description).join('; ')}.`,
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
      if (
        options.allowedActions &&
        !options.allowedActions.includes(parsed.data.action)
      )
        throw new Error(
          `AssetManifest action is unavailable for this Resource Production task: ${parsed.data.action}`,
        )
      if (parsed.data.action === 'submit_resource_plan') {
        const manifest = await submitResourcePlan(
          options.workspacePath,
          options.resourceLibraryUsage,
          parsed.data,
        )
        return {
          data: {
            accepted: true,
            requirement_count: manifest.requirements.length,
          },
        }
      }
      if (parsed.data.action === 'author_provisional_resources') {
        const manifest = await authorProvisionalResources({
          workspacePath: options.workspacePath,
          adapters: provisionalAdapters,
          resources: parsed.data.resources.map(resource => ({
            id: resource.id,
            destinationPath: resource.destination_path,
            format: resource.format,
            reason: resource.reason,
            selectionReason: resource.selection_reason,
            assetKind: resource.asset_kind,
            ...(resource.capabilities
              ? { capabilities: resource.capabilities }
              : {}),
            ...(resource.parameters ? { parameters: resource.parameters } : {}),
          })),
        })
        return {
          data: {
            accepted: true,
            resource_count: manifest.resources.length,
            registered_resource_ids: parsed.data.resources.map(item => item.id),
          },
        }
      }
      if (parsed.data.action === 'prune_unbound_resources') {
        const manifest = await removeBeeGameUnboundResources(
          options.workspacePath,
          parsed.data.resource_ids,
        )
        return {
          data: {
            accepted: true,
            resource_count: manifest.resources.length,
            pruned_resource_ids: parsed.data.resource_ids,
          },
        }
      }
      if (parsed.data.action === 'complete_resource_inventory') {
        const manifest = await readBeeGameAssetManifest(options.workspacePath)
        const requiredIds = new Set(
          manifest.requirements
            .filter(requirement => requirement.required !== false)
            .map(requirement => requirement.id),
        )
        const resourceIds = new Set(
          manifest.resources
            .filter(resource => resource.status === 'verified')
            .map(resource => resource.id),
        )
        const bound = new Set<string>()
        for (const binding of parsed.data.bindings) {
          if (!requiredIds.has(binding.requirement_id))
            throw new Error(
              `Inventory binding references an unknown required requirement: ${binding.requirement_id}`,
            )
          if (binding.resource_ids.some(id => !resourceIds.has(id)))
            throw new Error(
              `Inventory binding references a missing or unverified resource: ${binding.requirement_id}`,
            )
          bound.add(binding.requirement_id)
        }
        const missing = [...requiredIds].filter(id => !bound.has(id))
        if (missing.length)
          throw new Error(
            `Inventory bindings do not cover required requirements: ${missing.join(', ')}`,
          )
        return {
          data: {
            accepted: true,
            bindings: parsed.data.bindings,
          },
        }
      }
      throw new Error('Unsupported AssetManifest action')
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
