import { produceResources } from '../resource-production'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { projectWorkDirectory } from '../project-storage-paths'
import { ZodError } from 'zod/v4'
import { MEDIA_PRODUCTION_ENTRY, RESOURCE_PRODUCTION_ENTRY } from '../content-checker-runtime'
import { writeProjectAssetCommand } from '../project-asset-command'
import { openResourceLibraryAccess } from '../resource-library-access'
import { publishProjectAssetCapabilities } from '../project-preview-capability'
import type { openImageGenerationAccess } from '../../image-generation/access'
import type { LayoutConstraints } from '../ui-layout-audit'

export type AgentImageAccess = ReturnType<typeof openImageGenerationAccess>

/** Account/resource capabilities and source-bound workflow operations only. */
export async function openAgentTools(input: {
  workspacePath: string
  constraints?: LayoutConstraints
  libraryBaseUrl?: string
  getAuthToken: () => string | undefined | Promise<string | undefined>
  sessionId: string
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
  let library: ReturnType<typeof openResourceLibraryAccess> | undefined
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
  const forward = async (request: Request, endpoint: () => string | Promise<string>) => {
    if (closing) throw Error('Resource capability unavailable')
    const operation = (async () => {
      const target = await endpoint()
      if (closing || request.signal.aborted) throw Error('Resource request cancelled')
      const response = await fetch(new Request(target, request), { redirect: 'error' })
      return new Response(response.body ? await response.arrayBuffer() : null, { status: response.status, headers: response.headers })
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
      try { await image?.close() } finally { library?.close() }
    }
  })()
  const libraryState = input.libraryBaseUrl
    ? 'Resource library bridge is configured; catalog requests verify authentication/availability. Errors are not empty search results.'
    : 'Built-in resource library is not configured for this session.'
  try {
    const token = crypto.randomUUID()
    const path = '/' + token
    server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
      if (closing || request.headers.has('origin')) return new Response('Not found', { status: 404 })
      const url = new URL(request.url)
      try {
        if (url.pathname === path + '/image' && openImage) {
          return await forward(request, async () => {
            openingImage ??= Promise.resolve().then(openImage).then(value => image = value)
            return (await openingImage).endpoint + url.search
          })
        }
        if (url.pathname.startsWith(path + '/library/') && libraryBaseUrl) {
          return await forward(request, () => {
            library ??= openResourceLibraryAccess({ baseUrl: libraryBaseUrl, getAuthToken: input.getAuthToken })
            return library.baseUrl + url.pathname.slice((path + '/library').length) + url.search
          })
        }
        if (url.pathname !== path || request.method !== 'POST') return new Response('Not found', { status: 404 })
        const body = await request.json()
        if (body && typeof body === 'object' && 'registration' in body) {
          if (Object.keys(body).length !== 1 || body.registration?.operation !== 'register' || closing)
            throw Error('Resource registration capability unavailable')
          const operation = produceResources(root, body.registration)
          operations.add(operation)
          try { return Response.json(await operation, { headers: { 'Cache-Control': 'no-store' } }) }
          finally { operations.delete(operation) }
        }
        if (body && typeof body === 'object' && 'workflow' in body && Object.keys(body).length === 1)
          return Response.json(await workflow(body.workflow, request.signal), { headers: { 'Cache-Control': 'no-store' } })
        throw Error('Expected resource registration or workflow operation')
      } catch (error) {
        const issues = error instanceof ZodError ? error.issues.map(({ path, code, message }) => ({ path, code, message })) : undefined
        return Response.json({ error: error instanceof Error ? error.message : 'Resource operation failed',
          ...(issues ? { issues } : {}) }, { status: 409 })
      }
    } })
    if(input.workflow) await writeFile(resolve(directory,'workflow.mjs'),[
        'import {realpath,readFile} from "node:fs/promises";',
        'const help='+JSON.stringify('Development preview: --preview start|status returns the current project server and does not run tests or end the turn. New task-owned servers close with the task; existing user previews remain user-owned. Reload the page after edits when reloadAfterEdits is true. Current assignment: --status. For tasks using a tool handoff: --advance <JSON>. Requested deliverable: --visual <JSON>, --resources <JSON>, or --implement <JSON>. When the native BgsWorkflow tool is exposed, prefer BgsWorkflow({action:"status"|"advance"|"visual"|"resources"|"implement"|"select-visual"|"preview", ...handoff fields}); use these commands for legacy native sessions without that tool. JSON: {summary,sections:[exact existing GDD headings],files:[actual project-relative files]}. GDD and visual-design results use the current final JSON contract, not advance. If necessary decisions are blocked, report them without advancing. Advance preserves the full original assignment. Implement is allowed only when the current user request authorizes implementation. In the implementation stage, implement optionally records the current authorized work in this same turn; continue without scheduling implementation again. Normal completion needs no delivery submission. Use --select-visual <JSON> in implementation or resource tasks to retain selected design images; it preserves path/hash references without ending the turn or registering runtime assets. Existing selections cannot be overwritten within that task. For other handoffs, submit once after finalizing outputs, then end this native turn. BGS verifies source identities after cleanup and continues within the requested scope; no model review or quality certification. No automatic retry after failure/pause.')+';',
        'const args=process.argv.slice(2);if(args.length===1 && args[0]==="--help"){console.log(help);process.exit(0)}',
        'let value;if(args.length===1 && args[0]==="--status")value={action:"status"};else if(args.length===2 && args[0]==="--preview" && ["start","status"].includes(args[1]))value={action:"preview",operation:args[1]};else if(args.length===2 && ["--advance","--visual","--resources","--implement","--select-visual"].includes(args[0]))value={...JSON.parse(args[1]),action:args[0].slice(2)};else throw Error(help);',
        'if(await realpath(process.cwd())!=='+JSON.stringify(root)+')throw Error("Workflow belongs to another workspace");',
        'if(!process.env.BEEGAME_ASSET_CAPABILITY_FILE)throw Error("No active BGS turn capability");',
        'const capability=JSON.parse(await readFile(process.env.BEEGAME_ASSET_CAPABILITY_FILE,"utf8"));',
        'if(capability.version!==1 || capability.workspace!==await realpath(process.cwd()) || capability.sessionId!=='+JSON.stringify(input.sessionId)+' || !capability.executionId)throw Error("Expired or mismatched turn capability");',
        'const api=new URL(capability.assets.registrationEndpoint);if(api.protocol!=="http:" || api.hostname!=="127.0.0.1" || api.username || api.password || api.search || api.hash)throw Error("Invalid workflow endpoint");',
        'const response=await fetch(api,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({workflow:value}),redirect:"error"});const result=await response.json();console.log(JSON.stringify(result));if(!response.ok)process.exitCode=1;',
      ].join('\n'),{flag:'wx',mode:0o600})
    revokeAssets = await publishProjectAssetCapabilities(root, input.sessionId, {
      registrationEndpoint: server.url.origin + '/' + token,
      ...(input.libraryBaseUrl ? { libraryBaseUrl: server.url.origin + path + '/library' } : {}),
      ...(input.openImage ? { imageEndpoint: server.url.origin + path + '/image', screenOrientation } : {}),
    })
    await writeProjectAssetCommand(entry('assets.mjs'), { sessionId: input.sessionId,
      mediaCommand: 'bun ' + JSON.stringify(entry('media.mjs')),
      ...(input.openImage ? {imageMcpModules:{
        server:import.meta.resolve('@modelcontextprotocol/sdk/server/index.js'),
        stdio:import.meta.resolve('@modelcontextprotocol/sdk/server/stdio.js'),
        types:import.meta.resolve('@modelcontextprotocol/sdk/types.js'),
      }} : {}) })
    for (const [name, source] of [['media.mjs', MEDIA_PRODUCTION_ENTRY], ['resources.mjs', RESOURCE_PRODUCTION_ENTRY]] as const)
      await writeFile(entry(name), source, { flag: 'wx', mode: 0o600 })
    const { platform, engine, inputs, orientation, dimension } = input.constraints ?? {}
    return {
      directory,
      imageGenerationEntry: input.openImage ? entry('assets.mjs') : undefined,
      uiLayoutConstraints: { platform, engine, inputs, orientation, dimension },
      systemContext: 'Current BGS tools directory (absolute path): ' + JSON.stringify(directory) + '. ' +
        'Read contracts as needed: bun resources.mjs --contract registration (resource fields). --help: bun assets.mjs, bun media.mjs. ' +
        'Prefix each filename with that directory; keep project root as cwd. Bridges expire at turn end. ' +
        (input.workflow ? 'Use BgsWorkflow for operations allowed by the current assignment. GDD and visual-design results use their final JSON contract. Saved sessions without this tool use workflow.mjs. If a saved native schema does not list preview, use workflow.mjs --preview start|status.' : ''),
      turnContext: [libraryState,
        input.openImage ? 'Image generation is configured. Task-authorized requests use the existing generation service for availability, pricing and applicable Credit checks. Generate or edit with generate_image from the configured beegame-images MCP; independent image requests can use parallel tool calls. assets.mjs generate is the CLI alternative for sessions without that tool or explicit command-line use; --help documents the same request fields. ui-assets-plan --help covers runtime skins.' : 'No AI image bridge is configured for this turn.',
      ].join('\n'),
      workflow: input.workflow ? workflow : undefined,
      close,
    }
  } catch (error) { await close(); throw error }
}
