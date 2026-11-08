import { produceResources } from '../resource-production'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { projectWorkDirectory } from '../project-storage-paths'
import { ZodError } from 'zod/v4'
import { readRequestBytes, RequestBodyLimitError } from '@bee-game-studio/beegame-skills-core/request-body'
import { MEDIA_PRODUCTION_ENTRY, RESOURCE_PRODUCTION_ENTRY } from '../content-checker-runtime'
import { writeProjectAssetCommand } from '../project-asset-command'
import { createResourceLibraryAccess } from '../resource-library-access'
import { publishProjectAssetCapabilities } from '../project-preview-capability'
import type { createImageGenerationAccess } from '../../image-generation/access'
import type { LayoutConstraints } from '../ui-layout-audit'
import type { ResourceLibraryUsage } from '@bee-game-studio/beegame-resource-core'

export type AgentImageAccess = ReturnType<typeof createImageGenerationAccess>

/** Account/resource capabilities and source-bound workflow operations only. */
export async function openAgentTools(input: {
  workspacePath: string
  constraints?: LayoutConstraints
  resourceLibraryUsage?: ResourceLibraryUsage
  libraryBaseUrl?: string
  getAuthToken: () => string | undefined | Promise<string | undefined>
  sessionId: string
  creativeTask?: 'discovery'|'direction'|'design'
  referenceOnly?: boolean
  imageRequestScope?: string
  workflow?: (value: unknown, signal?: AbortSignal) => Promise<unknown>
  openImage?: () => AgentImageAccess | Promise<AgentImageAccess>
}) {
  const root = await realpath(input.workspacePath)
  const openImage = input.openImage, libraryBaseUrl = input.libraryBaseUrl
  const orientation = input.constraints?.orientation
  const screenOrientation = orientation === 'Landscape' || orientation === 'Portrait' ? orientation : undefined
  const parent = projectWorkDirectory(root, input.sessionId)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  if (await realpath(parent) !== parent) throw Error('BGS tool directory must not resolve through a link')
  const directory = await mkdtemp(resolve(parent, 'goal-tools-'))
  const entry = (name: string) => resolve(directory, name)
  let library: ReturnType<typeof createResourceLibraryAccess> | undefined
  let image: AgentImageAccess | undefined
  let openingImage: Promise<AgentImageAccess> | undefined
  let revokeAssets: (() => Promise<void>) | undefined
  let server: ReturnType<typeof Bun.serve> | undefined
  let closing: Promise<void> | undefined
  const operations = new Set<Promise<unknown>>()
  const lifetime = new AbortController()
  const workflow = async (value: unknown, signal?: AbortSignal) => {
    const requestSignal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal
    if (requestSignal.aborted || closing || !input.workflow) throw Error('Workflow capability unavailable')
    const operation = input.workflow(value, requestSignal)
    operations.add(operation)
    try {
      const result = await operation
      if (requestSignal.aborted) throw Error('Workflow request cancelled')
      return result
    } finally { operations.delete(operation) }
  }
  const dispatch = async (request: Request, handler: (request: Request) => Promise<Response>, maxBytes: number) => {
    if (closing) throw Error('Resource capability unavailable')
    const signal = AbortSignal.any([request.signal, lifetime.signal])
    const operation = (async () => {
      // Preserve each former listener's body limit, including chunked requests.
      const body = request.body ? await readRequestBytes(request, maxBytes) : undefined
      signal.throwIfAborted()
      return handler(new Request(request.url, { method: request.method, headers: request.headers, body, signal }))
    })()
    operations.add(operation)
    try { return await operation }
    finally { operations.delete(operation) }
  }
  const close = () => closing ??= (async () => {
    lifetime.abort(new Error('Workflow capability closed'))
    try { await revokeAssets?.() }
    finally {
      server?.stop(true)
      await Promise.allSettled([...operations])
      try { await image?.close() }
      finally { await rm(directory, { recursive: true, force: true }) }
    }
  })()
  const libraryState = input.libraryBaseUrl
    ? 'Resource library bridge is configured; catalog requests verify authentication/availability. Errors are not empty search results.'
    : 'Built-in resource library is not configured for this session.'
  try {
    const token = crypto.randomUUID()
    const path = '/' + token
    server = Bun.serve({ hostname: '127.0.0.1', port: 0, idleTimeout: 0, async fetch(request) {
      if (closing || request.headers.has('origin')) return new Response('Not found', { status: 404 })
      const url = new URL(request.url)
      try {
        if (url.pathname === path + '/image' && openImage) {
          return await dispatch(request, async current => {
            if (input.referenceOnly && current.method === 'POST' && (await current.clone().json()).purpose !== 'reference')
              return Response.json({error:'This document assignment permits only reference-purpose images'}, {status:403})
            openingImage ??= Promise.resolve().then(openImage).then(value => image = value)
            const access = await openingImage
            current.signal.throwIfAborted()
            return access.fetch(current)
          }, 256 * 1024)
        }
        if (url.pathname.startsWith(path + '/library/') && libraryBaseUrl) {
          library ??= createResourceLibraryAccess({ baseUrl: libraryBaseUrl, getAuthToken: input.getAuthToken })
          return await dispatch(request, current => library!(current, url.pathname.slice((path + '/library').length)), 1024 * 1024)
        }
        if (input.referenceOnly && !input.workflow) return new Response('Not found', {status:404})
        if (url.pathname !== path || request.method !== 'POST') return new Response('Not found', { status: 404 })
        const body = await request.json()
        if (body && typeof body === 'object' && 'workflow' in body && Object.keys(body).length === 1)
          return Response.json(await workflow(body.workflow, request.signal), { headers: { 'Cache-Control': 'no-store' } })
        if (input.referenceOnly) return new Response('Not found', {status:404})
        if (body && typeof body === 'object' && 'registration' in body) {
          if (Object.keys(body).length !== 1 || body.registration?.operation !== 'register' || closing)
            throw Error('Resource registration capability unavailable')
          const operation = produceResources(root, body.registration, undefined, input.resourceLibraryUsage)
          operations.add(operation)
          try { return Response.json(await operation, { headers: { 'Cache-Control': 'no-store' } }) }
          finally { operations.delete(operation) }
        }
        throw Error('Expected resource registration or workflow operation')
      } catch (error) {
        if (error instanceof RequestBodyLimitError) return Response.json({error:error.message}, {status:413})
        const issues = error instanceof ZodError ? error.issues.map(({ path, code, message }) => ({ path, code, message })) : undefined
        return Response.json({ error: error instanceof Error ? error.message : 'Resource operation failed',
          ...(issues ? { issues } : {}) }, { status: 409 })
      }
    } })
    if(input.workflow) await writeFile(resolve(directory,'workflow.mjs'),[
        'import {realpath,readFile} from "node:fs/promises";',
        'const help='+JSON.stringify(input.creativeTask ? 'Submit the creative handoff through the final result. Optional lookup: --status.' : input.referenceOnly ? 'Design CLI for sessions without BgsWorkflow. Run from project root. Commands: --status; --select-visual <JSON>. JSON: {summary,sections:[],files:[actual project-relative image paths]}. Selection retains reference sources without ending work or registering runtime assets; submit the saved GDD through final JSON.' : 'Legacy CLI for sessions without the BgsWorkflow tool. Run from project root. Commands: --status; --preview start|status; --advance <JSON>; --visual <JSON>; --resources <JSON>; --implement <JSON>; --select-visual <JSON>. JSON: {summary,sections:[exact existing GDD headings],files:[actual project-relative files]}. Follow the current assignment: GDD and visual results use final JSON; implementation follows the current native completion contract. Preview does not test or end work. Selection records references, not runtime assets. Existing permissions, source checks and stop/recovery apply; no automatic retry.')+';',
        'const args=process.argv.slice(2);if(args.length===1 && args[0]==="--help"){console.log(help);process.exit(0)}',
        'let value;if(args.length===1 && args[0]==="--status")value={action:"status"};else if(args.length===2 && args[0]==="--preview" && ["start","status"].includes(args[1]))value={action:"preview",operation:args[1]};else if(args.length===2 && ["--advance","--visual","--resources","--implement","--select-visual"].includes(args[0]))value={...JSON.parse(args[1]),action:args[0].slice(2)};else throw Error(help);',
        'if(await realpath(process.cwd())!=='+JSON.stringify(root)+')throw Error("Workflow belongs to another workspace");',
        'if(!process.env.BEEGAME_ASSET_CAPABILITY_FILE)throw Error("No active BGS turn capability");',
        'const capability=JSON.parse(await readFile(process.env.BEEGAME_ASSET_CAPABILITY_FILE,"utf8"));',
        'if(capability.version!==1 || capability.workspace!==await realpath(process.cwd()) || capability.sessionId!=='+JSON.stringify(input.sessionId)+' || !capability.executionId)throw Error("Expired or mismatched turn capability");',
        'const api=new URL('+(input.referenceOnly ? JSON.stringify(server.url.origin + "/" + token) : 'capability.assets.registrationEndpoint')+');if(api.protocol!=="http:" || api.hostname!=="127.0.0.1" || api.username || api.password || api.search || api.hash)throw Error("Invalid workflow endpoint");',
        'const response=await fetch(api,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({workflow:value}),redirect:"error"});const result=await response.json();console.log(JSON.stringify(result));if(!response.ok)process.exitCode=1;',
      ].join('\n'),{flag:'wx',mode:0o600})
    revokeAssets = await publishProjectAssetCapabilities(root, input.sessionId, {
      ...(input.referenceOnly ? {} : {registrationEndpoint: server.url.origin + '/' + token}),
      ...(input.libraryBaseUrl ? { libraryBaseUrl: server.url.origin + path + '/library' } : {}),
      ...(input.openImage ? { imageEndpoint: server.url.origin + path + '/image', screenOrientation } : {}),
    })
    await writeProjectAssetCommand(entry('assets.mjs'), { sessionId: input.sessionId,
      referenceOnly: input.referenceOnly, imageRequestScope:input.imageRequestScope,
      ...(input.referenceOnly ? {} : {mediaCommand: 'bun ' + JSON.stringify(entry('media.mjs'))}),
      ...(input.openImage ? {imageMcpModules:{
        server:import.meta.resolve('@modelcontextprotocol/sdk/server/index.js'),
        stdio:import.meta.resolve('@modelcontextprotocol/sdk/server/stdio.js'),
        types:import.meta.resolve('@modelcontextprotocol/sdk/types.js'),
      }} : {}) })
    if (!input.referenceOnly) for (const [name, source] of [['media.mjs', MEDIA_PRODUCTION_ENTRY], ['resources.mjs', RESOURCE_PRODUCTION_ENTRY]] as const)
      await writeFile(entry(name), name === 'resources.mjs' && input.resourceLibraryUsage
        ? source.replace("{ profile: 'current' }", JSON.stringify({ profile: 'current', resourceLibraryUsage: input.resourceLibraryUsage }))
        : source, { flag: 'wx', mode: 0o600 })
    return {
      directory,
      imageGenerationEntry: input.openImage ? entry('assets.mjs') : undefined,
      systemContext: input.creativeTask ? 'Current BGS creative tools directory: ' + JSON.stringify(directory) + '. Submit this assignment through its final result.' : input.referenceOnly ? 'Current BGS design-reference tools directory (absolute path): ' + JSON.stringify(directory) + '. Optional image generation uses purpose=reference and new files under assets/reference/. Resource registration and production assets are unavailable.' + (input.workflow ? ' BgsWorkflow status/select-visual retain chosen image sources; saved sessions without that tool use workflow.mjs.' : '') : 'Current BGS tools directory (absolute path): ' + JSON.stringify(directory) + '. ' +
        'Acquisition: bun assets.mjs --help. Processing: bun media.mjs --help. Register delivered files: bun resources.mjs --help. ' +
        'Prefix each filename with that directory; keep project root as cwd. Bridges expire at turn end. ' +
        (input.workflow ? 'Use BgsWorkflow for operations allowed by the current assignment. GDD and visual-design results use their final JSON contract. Saved sessions without this tool use workflow.mjs. If a saved native schema does not list preview, use workflow.mjs --preview start|status.' : ''),
      turnContext: [input.referenceOnly ? (input.libraryBaseUrl ? libraryState + ' Use assets.mjs catalog/elements/pack/element for research.' : '') : libraryState,
        input.openImage ? input.referenceOnly ? 'Image generation is configured for task-authorized design references through generate_image and the system imagegen Skill. The existing service checks availability, pricing and applicable Credit before generation.' : 'Image generation is configured. Task-authorized requests use the existing generation service for availability, pricing and applicable Credit checks. Generate or edit with generate_image from the configured beegame-images MCP; independent image requests can use parallel tool calls. assets.mjs generate is the CLI alternative for sessions without that tool or explicit command-line use; --help documents the same request fields. generate --help documents ordinary production atlas requests.' : input.referenceOnly ? '' : 'No AI image bridge is configured for this turn.',
      ].filter(Boolean).join('\n'),
      workflow: input.workflow ? workflow : undefined,
      close,
    }
  } catch (error) { await close(); throw error }
}
