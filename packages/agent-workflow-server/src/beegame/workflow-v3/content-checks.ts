import { readFile, access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { contentDocumentSchema, type BeeGameContentDocument } from '../game-content-schema'
import { contentDraftStructureIssues, undeclaredAssetReferenceIssues, validateContentDocument } from '../game-content-package'
import { checkDesignLayouts } from '../design-layout-check'
import { readBeeGameAssetManifestSync, readBeeGameAssetManifestModulePathsSync } from '../asset-contracts'
import { auditAssetContract } from '../asset-contract-audit'
import { validateResourceSelections } from '../tilemap-contract'
import { readVersion } from './checks'
import { digest, type CheckResult, type FileVersion, type TaskSpec, type UiNodeBindingCoverage, type SceneNodeBindingCoverage } from './state'
import { CHECK_VERSIONS } from './check-versions'

const isContentPath = (path: string) => /^content\/(ui|scenes)\/.+\.json$/.test(path)

// Inventory operands, not inferred design intent. Match the existing selection
// validator's top-level/data locators, including nested image/texture/font refs.
function nodeBindings(value: unknown, location = 'node', bindings: UiNodeBindingCoverage['bindings'] = []) {
  if (Array.isArray(value)) value.forEach((item, i) => nodeBindings(item, `${location}[${i}]`, bindings))
  else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.assetRef === 'string') {
      const fields = { ...record, ...(record.data && typeof record.data === 'object' ? record.data : {}) }
      bindings.push({ location, assetRef: record.assetRef,
        ...Object.fromEntries(['member', 'atlasMember', 'frame'].filter(key => typeof fields[key] === 'string').map(key => [key, fields[key]])) })
    }
    for (const [key, item] of Object.entries(record)) nodeBindings(item, `${location}.${key}`, bindings)
  }
  return bindings
}

/** Saved task files plus their explicit composition/camera links. No eight-document
 * authority and no scan of unrelated task folders. Missing linked files are inputs,
 * not grounds for replacing the link with an easier geometry check. */
export async function runContentCheck(root: string, id: 'content-structure' | 'content-layout' | 'content-resources', task: Pick<TaskSpec, 'expectedOutputs'>, inputs: FileVersion[], constraints: Record<string, unknown>): Promise<CheckResult> {
  const result: CheckResult = { id, version: CHECK_VERSIONS[id], status: 'unverified', inputs: [...inputs],
    observation: 'No saved Scene/UI files in this task scope.', createdAt: new Date().toISOString() }
  const documents = new Map<string, BeeGameContentDocument>(), ids = new Set<string>(), issues: string[] = []
  const uiNodeBindings: UiNodeBindingCoverage[] = []
  const sceneNodeBindings: SceneNodeBindingCoverage[] = []
  let assetContract: ReturnType<typeof auditAssetContract> | undefined
  const pending = [...new Set([...task.expectedOutputs, ...inputs.map(file => file.path)].filter(isContentPath))]
  if (!pending.length && id !== 'content-resources') return result
  const addVersion = async (file: string) => {
    const version = await readVersion(root, file)
    if (!result.inputs.some(input => input.path === file)) result.inputs.push(version)
  }
  try {
    for (let n = 0; n < pending.length; n++) {
      const file = pending[n]!
      let document: BeeGameContentDocument
      try {
        await addVersion(file)
        document = contentDocumentSchema.parse(JSON.parse(await readFile(resolve(root, file), 'utf8')))
      }
      catch (error) { issues.push(file+': '+String(error)); continue }
      documents.set(file, document)
      if (file.startsWith('content/ui/') ? !['ui-screen', 'ui-hud', 'ui-flow'].includes(document.kind) : !['scene-2d', 'scene-3d'].includes(document.kind))
        issues.push(file+': document kind does not match its Scene/UI location')
      if (ids.has(document.id)) issues.push(file+': duplicate content document id '+document.id)
      ids.add(document.id)
      issues.push(...contentDraftStructureIssues(file, document))
      if (id === 'content-resources' && (document.kind === 'scene-2d' || document.kind === 'scene-3d'))
        for (const node of document.data.nodes) sceneNodeBindings.push({
          document: file, nodeId: node.id, parentId: node.parentId, dimension: document.kind === 'scene-3d' ? '3d' : '2d',
          bindings: nodeBindings(node),
          components: (node.components ?? []).map(component => ({id:component.id,type:component.type,
            bindings:nodeBindings(component,'component.'+component.id)})),
          behaviors: node.data?.behaviors ?? [],
        })
      if (document.kind !== 'ui-screen' && document.kind !== 'ui-hud' && document.kind !== 'ui-flow') continue
      if (id === 'content-resources') for (const node of document.data.nodes) {
        const bindings = nodeBindings(node)
        const undeclared = bindings.filter(binding => !document.assetRefs.includes(binding.assetRef))
        uiNodeBindings.push({ document: file, nodeId: node.id, role: node.role, bindings,
          resolution: undeclared.length ? 'invalid' : bindings.length ? 'unverified' : 'not-declared',
          issues: undeclared.map(binding => `${binding.location}: undeclared assetRef ${binding.assetRef}`) })
      }
      const data = document.data.nodes.find(node => node.id === document.data.rootId)?.data
      const links = [...(Array.isArray(data?.layoutCamera) ? data.layoutCamera : data?.layoutCamera ? [data.layoutCamera] : []), ...(data?.layoutUnderlay ? [data.layoutUnderlay] : [])]
      for (const link of links) {
        const path = (link as { path?: unknown })?.path
        if (typeof path !== 'string' || !isContentPath(path) || path.includes('\\') || path.split('/').some(p => !p || p === '.' || p === '..'))
          issues.push(file+': invalid linked content source')
        else if (!pending.includes(path)) pending.push(path)
      }
    }
    const refs = [...new Set([...documents.values()].flatMap(doc => doc.assetRefs))]
    // Geometry may consume linked Scene TileSets even when the task requested
    // only a layout check. Bind the real resource inputs BEFORE that inspection.
    if (id === 'content-resources' || (!issues.length && id === 'content-layout' && refs.length)) {
      const hasManifest = await access(resolve(root, 'assets/asset-manifest.json')).then(() => true, () => false)
      if (hasManifest || refs.length) {
        await addVersion('assets/asset-manifest.json')
        if (id === 'content-resources') {
          assetContract = auditAssetContract(root)
          issues.push(...assetContract.issues)
        }
        for (const file of readBeeGameAssetManifestModulePathsSync(root)) await addVersion(file)
        const manifest = readBeeGameAssetManifestSync(root)
        if (id === 'content-resources') for (const row of uiNodeBindings.filter(row => row.bindings.length)) {
          const doc = documents.get(row.document)!
          validateResourceSelections(root, manifest, doc.data.nodes.find(node => node.id === row.nodeId), row.issues, row.document+'#'+row.nodeId)
          row.resolution = row.issues.length ? 'invalid' : 'resolved'
        }
        for (const resource of manifest.resources.filter(resource => id === 'content-resources' || refs.includes(resource.id)))
          for (const file of new Set([...resource.file_paths, ...(resource.dependencies?.map(dep => dep.local_path) ?? [])])) {
            try { await addVersion(file) }
            catch (error) {
              if (id !== 'content-resources') throw error
              issues.push('Resource input unavailable: '+file)
            }
          }
      }
    }
    if (id === 'content-layout' && !issues.length) {
      const uiFiles = [...documents].filter(([, doc]) => ['ui-screen', 'ui-hud', 'ui-flow'].includes(doc.kind)).map(([file]) => file)
      if (!uiFiles.length) { result.observation = 'Scene structure alone is not viewport visibility evidence; provide its active UI/game-view or target runtime.'; return result }
      // TileSet visual bounds may legitimately be unavailable in a draft. Such
      // deferral stays unverified, not a PASS at the final bound-content gate.
      const geometry = checkDesignLayouts(root, constraints, true, false, uiFiles)
      issues.push(...geometry.issues)
      result.coverage = { files: [...documents.keys()], limitations: geometry.coverage.unverified }
      if (!issues.length && (geometry.deferred.length || !geometry.coverage.targets.length)) {
        result.observation = 'Layout remains unverified: '+[...geometry.deferred, 'No screen-geometry result does not certify XR/world-space UI.'].join('; ')
        return result
      }
    }
    if (id === 'content-resources') {
      if (!refs.length) {
        for (const [file, document] of documents)
          issues.push(...undeclaredAssetReferenceIssues(file, document))
        if (!issues.length && !assetContract?.present) {
          result.observation = 'No resource bindings declared. Resource-free/draft files do not prove final resource coverage.'
          return result
        }
      }
      if (refs.length) {
        const manifest = readBeeGameAssetManifestSync(root)
        const authority = { documentRevision: digest(JSON.stringify(result.inputs)), assetManifestRevision: digest(JSON.stringify(manifest)), manifest }
        for (const [file, document] of documents) {
          validateContentDocument({ workspacePath: root, path: file, document, authority, issues })
          validateResourceSelections(root, manifest, document.data, issues, file)
        }
        result.coverage = { files: [...documents.keys()], limitations: ['All registered Manifest requirements/resources checked; unregistered needs, rendered font fit, audio listening and runtime consumption are not established.'] }
        if (!issues.length && manifest.resources.some(resource => refs.includes(resource.id) && resource.provisional)) {
          result.observation = 'Referenced resources remain provisional; final resource acceptance is unverified.'
          return result
        }
      }
      if (!issues.length && assetContract?.requirements.some(requirement => requirement.required && requirement.structure?.status !== 'passed')) {
        result.observation = 'Registered resource structure remains unverified; file presence and declared metadata are not complete structural or runtime evidence.'
        return result
      }
    }
    result.status = issues.length ? 'failed' : 'passed'
    result.observation = issues.length ? [...new Set(issues)].join('\n') : id === 'content-layout'
      ? 'Current scoped UI and linked compositions passed the existing spatial algorithm. Not font, appearance, interaction or runtime acceptance.'
      : id === 'content-resources' ? 'Scoped bindings, member selection and all registered Manifest resource structures checked. Not runtime or whole-game semantic coverage.'
        : 'Saved Scene/UI structure and linked source identity checked; unbound drafts are allowed. Not final resource or runtime acceptance.'
    result.coverage ??= { files: [...documents.keys()], limitations: ['Only this task and its explicit links checked; semantic coverage of original requirements is not established.'] }
  } catch (error) {
    result.observation = 'Required check input unavailable or invalid: '+(error instanceof Error ? error.message : String(error))
    result.status = issues.length ? 'failed' : 'unverified'
  } finally {
    if (id === 'content-resources') {
      result.coverage ??= { files: [...documents.keys()], limitations: [] }
      result.coverage.uiNodeBindings = uiNodeBindings
      result.coverage.sceneNodeBindings = sceneNodeBindings
      result.coverage.assetContract = assetContract
      result.coverage.limitations.push('Scene inventory preserves declared hierarchy, component bindings and behavior metadata, not executed behavior. File inspection proves only supported structural facts, not clip compatibility, timing, assembly quality or native-engine/XR device use.')
      result.coverage.limitations.push('UI nodes come from parsed scoped sources, not selected runtime probes; failed or unavailable inputs can leave this inventory incomplete. Resolution checks declared resource/member/frame operands only, not appearance or runtime use. No binding is not proof of intentional procedural rendering; omitted sources/elements cannot be certified by this inventory.')
    }
  }
  return result
}
