import type { ResourceLibraryUsage } from '@bee-game-studio/beegame-resource-core'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod/v4'
import {
  BEEGAME_RESOURCE_ROOTS,
  CURRENT_ASSET_MANIFEST_VERSION,
  parseCanonicalBeeGameAssetManifest,
  readBeeGameAssetManifest,
  registerBeeGameAuthoredResources,
  writeBeeGameAssetManifest,
} from './asset-contracts'
import {
  BEEGAME_CONTENT_SCHEMA,
  BEEGAME_JSON_CONTENT_KINDS,
  BEEGAME_YAML_CONTENT_KINDS,
} from './content-contracts'

const projectTargetSchema = z.object({
  platform: z.string().trim().min(1).optional(),
  runtime: z.string().trim().min(1).optional(),
  asset_format_capabilities: z.array(z.string().trim().min(1)).min(1),
}).strict()

const requirementSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
  purpose: z.string().trim().min(1).optional(),
  required: z.boolean().optional(),
}).strict()

const authoredResourceSchema = z.object({
  id: z.string().trim().min(1),
  root_path: z.string().trim().min(1),
  file_paths: z.array(z.string().trim().min(1)).min(1),
  provisional: z.boolean(),
  reason: z.string().trim().min(1),
  selection_reason: z.array(z.string().trim().min(1)).min(1).max(8),
  asset_kind: z.string().trim().min(1).optional(),
  capabilities: z.array(z.string().trim().min(1)).min(1).optional(),
  content_profile: z.record(z.string(), z.unknown()).optional(),
  technical_facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
}).strict()

const encodedAuthoredResourceSchema = authoredResourceSchema.extend({
  files: z.array(z.object({
    path: z.string().trim().min(1),
    base64: z.string().min(1).base64(),
  }).strict()).min(1).max(64),
}).strict()

const inputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('submit_resource_plan'),
    project_target: projectTargetSchema,
    requirements: z.array(requirementSchema).min(1).max(256),
  }).strict(),
  z.object({
    action: z.literal('register_authored_resources'),
    resources: z.array(authoredResourceSchema).min(1).max(64),
  }).strict(),
  z.object({
    action: z.literal('author_encoded_resources'),
    resources: z.array(encodedAuthoredResourceSchema).min(1).max(64),
  }).strict(),
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
    throw new Error('An established resource plan cannot change project_target in place.')
  const submitted = new Set(input.requirements.map(item => item.id))
  const omitted = existing.requirements.map(item => item.id).filter(id => !submitted.has(id))
  if (omitted.length)
    throw new Error(`Resource plan cannot silently remove requirement identities: ${omitted.join(', ')}.`)
  const manifest = parseCanonicalBeeGameAssetManifest({
    ...existing,
    requirements: input.requirements,
  })
  await writeBeeGameAssetManifest(workspacePath, manifest)
  return manifest
}

async function authorEncodedResources(
  workspacePath: string,
  resources: Array<z.infer<typeof encodedAuthoredResourceSchema>>,
) {
  const workspaceRoot = resolve(workspacePath)
  const runtimeRoot = resolve(workspaceRoot, BEEGAME_RESOURCE_ROOTS.runtime)
  const authored = resources.map(resource => {
    const declaredPaths = new Set(resource.file_paths)
    const suppliedPaths = new Set(resource.files.map(file => file.path))
    if (
      declaredPaths.size !== suppliedPaths.size ||
      [...declaredPaths].some(path => !suppliedPaths.has(path))
    )
      throw new Error(`Encoded files must exactly match file_paths for ${resource.id}.`)
    for (const file of resource.files) {
      const absolutePath = resolve(workspaceRoot, file.path)
      const projectRelative = relative(workspaceRoot, absolutePath)
      const runtimeRelative = relative(runtimeRoot, absolutePath)
      if (
        projectRelative === '' ||
        projectRelative.startsWith('..') ||
        isAbsolute(projectRelative) ||
        runtimeRelative === '' ||
        runtimeRelative.startsWith('..') ||
        isAbsolute(runtimeRelative)
      )
        throw new Error(`Encoded resource path is outside ${BEEGAME_RESOURCE_ROOTS.runtime}: ${file.path}.`)
      if (Buffer.from(file.base64, 'base64').byteLength === 0)
        throw new Error(`Encoded resource file must not be empty: ${file.path}.`)
    }
    const { files: _files, ...input } = resource
    return input
  })
  for (const resource of resources) {
    for (const file of resource.files) {
      const absolutePath = resolve(workspaceRoot, file.path)
      await mkdir(dirname(absolutePath), { recursive: true })
      await writeFile(absolutePath, Buffer.from(file.base64, 'base64'))
    }
  }
  return registerBeeGameAuthoredResources(workspacePath, authored)
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
        `submit_resource_plan creates canonical version 7 with requirements and resources only. The confirmed Resource Library policy is system-owned and fixed to ${options.resourceLibraryUsage}. The system also owns assets/runtime, assets/content and assets/generated as the three project roots. Do not provide or reinterpret policy or root paths.`,
        'Register downloaded material through Resource Library tools. Use register_authored_resources only after creating standalone text-native files under runtime_asset_root. Use author_encoded_resources to decode and atomically register binary files supplied as base64; never write or read binary media through generic file tools. A placeholder is provisional but uses the same stable resource identity and content references as a final asset.',
        `Every content file uses schema ${BEEGAME_CONTENT_SCHEMA} plus id, kind, fulfills, resources and data. JSON owns resource mappings, entities, UI, audio, events, waves and numeric configuration; its allowed kinds are ${BEEGAME_JSON_CONTENT_KINDS.join(', ')}. YAML owns only world, scene, hierarchy and instance placement; its allowed kinds are ${BEEGAME_YAML_CONTENT_KINDS.join(', ')}. Do not duplicate one fact in JSON and YAML.`,
        'The manifest accepts only the declared v7 project target, requirements and resource records. Keep substitutable media out of gameplay source and keep engine-specific structures in project content or target adapters.',
      ].join(' ')
    },
    async checkPermissions(input: AssetManifestInput) {
      return { behavior: 'allow', updatedInput: input }
    },
    async call(input: AssetManifestInput) {
      const parsed = inputSchema.safeParse(input)
      if (!parsed.success) throw new Error(z.prettifyError(parsed.error))
      if (parsed.data.action === 'submit_resource_plan') {
        const manifest = await submitResourcePlan(
          options.workspacePath,
          options.resourceLibraryUsage,
          parsed.data,
        )
        return { data: { accepted: true, requirement_count: manifest.requirements.length } }
      }
      if (parsed.data.action === 'author_encoded_resources') {
        const manifest = await authorEncodedResources(
          options.workspacePath,
          parsed.data.resources,
        )
        return {
          data: {
            accepted: true,
            resource_count: manifest.resources.length,
            registered_resource_ids: parsed.data.resources.map(item => item.id),
          },
        }
      }
      const manifest = await registerBeeGameAuthoredResources(options.workspacePath, parsed.data.resources)
      return {
        data: {
          accepted: true,
          resource_count: manifest.resources.length,
          registered_resource_ids: parsed.data.resources.map(item => item.id),
        },
      }
    },
    renderToolUseMessage(input: Partial<AssetManifestInput>) {
      return input.action ? `资源与内容 · ${input.action}` : '资源与内容'
    },
    mapToolResultToToolResultBlockParam(output: unknown, toolUseID: string) {
      return { tool_use_id: toolUseID, type: 'tool_result', content: JSON.stringify(output) }
    },
  })
}
