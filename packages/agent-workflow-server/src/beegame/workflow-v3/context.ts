import type { Run, Attempt, SkillUse, CheckResult } from './state'
import { repairFindings, attemptSpec } from './review'
import { CHECK_VERSIONS } from './check-versions'
import { taskCapabilityNotes } from './capability-scope'

/** Derived pointers, not a second design document or an independent PASS ledger. */
export function sourceIndex(run: Run, taskId?: string) {
  return Object.values(run.tasks).filter(task => (!taskId || task.spec.id === taskId) && task.status !== 'superseded').map(task => {
    const attempt = run.attempts.find(a => a.attemptId === task.attemptId)
    return { taskId: task.spec.id, requirementIds: task.spec.requirementIds, inputs: attempt?.inputVersions ?? task.spec.inputs,
      outputs: task.spec.expectedOutputs.map(path => ({ path, ownerTaskId: task.spec.id,
        ...(attempt?.outputs?.find(file => file.path === path) ?? {}),
        recordedChecks: attempt?.checks?.filter(check => check.inputs.some(file => file.path === path))
          .map(check => ({ id: check.id, version: check.version, status: check.status, createdAt: check.createdAt })) ?? [],
      })) }
  })
}

export function taskContext(run: Run, attempt: Attempt, bindingInputs?: unknown) {
  const task = run.tasks[attempt.taskId]!.spec
  const { inputs: _inputs, skills: _skills, ...contract } = task
  return [
    'Complete only this authorized game task. Choose your methods and tools; save actual outputs, not a duplicate handoff summary.',
    'Do not change other task contracts, unlisted artifacts, host metadata, or confirmed requirements. Use the native question tool when a change needs user authorization. Missing evidence is not success.',
    ...(task.kind === 'game.develop' ? ['An input may be revised only when also explicitly authorized in writablePaths and expectedOutputs; other inputs are read-only. For bindingPlan, preserve input bytes for the host binding step.'] : []),
    ...(task.kind === 'game.verify' ? ['This is verification, not repair: run/inspect the current sources, save actual observations and specific defects in the authorized outputs. Do not edit the input sources to make a check pass; source repair belongs to a separately authorized development task.'] : []),
    task.skills?.length
      ? 'Required professional methods: invoke these installed Skills through the native Skill tool: '+task.skills.join(', ')+'. Their methods do not expand the task ownership. If unavailable, report the problem; do not claim they were used.'
      : 'Use relevant installed professional Skills for the work involved; their methods do not expand task ownership.',
    'Current confirmed requirements (this exact revision governs the task):\n'+run.requirements.text,
    ...(run.requirementChanges?.length ? ['Original requirements and authorization history are retained by the host. The current confirmed snapshot supersedes earlier wording; do not reuse historical review decisions or measurement PASS as current authority.'] : []),
    ...run.attempts.filter(a=>a.sourceEdit?.status==='saved' && run.plans.find(p=>p.revision===a.planRevision)?.impact?.[task.id])
      .slice(-1).map(a=>'User saved a formal source edit at '+a.sourceEdit!.path+'. Read the saved candidate and preserve the requested edit; adjust only what the current requirements and authorized task actually need. This host edit is not a task PASS; perform the declared fresh checks.'),
    'Confirmed structured constraints:\n'+JSON.stringify(run.requirements.constraints),
    'Current authorized task:\n'+JSON.stringify(contract),
    ...taskCapabilityNotes(task, run.requirements.constraints),
    ...(task.runtimeArtifact ? ['runtimeArtifact identifies the actual static web build directory with index.html. The host measures its bytes and independently checks initial browser load/package copies after normal completion. These checks do not prove gameplay or Scene/UI data consumption; do not substitute a generated PASS report. Server/native/XR targets need other actual observations.'] : []),
    ...(task.editableProject ? ['editableProject builds from a host-created copy of exportable project sources, excluding the old runtimeArtifact, host/private dot files and saved review reports. Installed node_modules is a separately hashed build operand, not exported; save a lockfile when dependencies are installed. Build must not mutate source files or require omitted private config. The host installs only the fully authorized runtimeArtifact directory, then performs the actual runtime checks. Editable export needs this actual build provenance, not an author-selected source list or PASS statement.'] : []),
    ...(task.checks.includes('ui-data-consumption') ? ['ui-data-consumption runs against the actual target build, not the host preview. Identify actual DOM UI elements and necessary click paths; host derives before/changed geometry from saved source and only changes test responses. Canvas/Scene/resources/audio remain unverified by this check.'] : []),
    ...(task.checks.includes('font-data-consumption') ? ['font-data-consumption uses uiProbes for every explicitly font-bound static node.text at authored viewports. The host observes actual DOM glyph fonts, saved text/fontSize changes and selected registered font response suppression/restoration. Use native CSS selectors for plain DOM text; Canvas, inherited font bindings, rich/dynamic text and full fit need other observations. No downloaded font or CSS family name alone proves consumption.'] : []),
    ...(task.checks.includes('audio-data-consumption') ? ['audio-data-consumption uses audioProbes for every registered Scene audio-source: exact node/component and actual HTML audio selector, activation steps, playSteps and stopSteps. Save explicit data.volume (0..1) and data.loop, with an encoded registered audio member copied into runtimeArtifact. The host observes native playback clock/state and captured decoded signal, mutates saved volume/loop responses, substitutes silence then restores. It never starts/stops game audio itself. Detached Audio objects, Web Audio/synthesis/spatial mixing and listening quality need other evidence; property checks do not prove final output gain or actual loop boundaries.'] : []),
    ...(task.pixelProbes ? ['pixel-data-consumption observes the actual target Canvas using registered image responses and saved Scene/UI projection. Declare exact Scene componentId (sprite/image or tilemap). Tilemap probes cover every used tileId and its saved cells, Grid/TileSet geometry; only static axis-aligned nonoverlapping visuals with isolated image/frame bindings are supported. Host changes only browser responses, never project files. Collision/sorting, animation, tint/occlusion, WebGL/3D, fonts and audio need other observations. No author PASS or copied preview replaces actual checks.'] : []),
    ...(task.reviewReport ? [
      'Directed review: read the bound actual sources and original requirements; use the required/relevant professional Skills. Save reviewReport as {requirementsRevision,planRevision,findings:[{id,requirementId,ownerTaskId,severity:"blocker"|"advisory",sources:[{path,sha256,quote}],impact,close,verifyWith:["<actual consumer check id>"],needsUserDecision?:boolean}],closed:[{id,repairAttemptId,sources:[{path,sha256,quote}],observed}],limitations:["<actual limits>"]}. Report specific downstream-blocking decisions, not polish/preferences/new scope. Source quotes and hashes must match bound inputs. No claims of zero defects. If semantic closure lacks an actual check/authorized decision, retain the blocker and escalate, do not loop. Omitted prior blockers are not closed.',
      'Review identity: '+JSON.stringify({ requirementsRevision: run.requirements.revision, planRevision: attempt.planRevision }),
      ...(task.previewIssues ? [
        'Saved user Preview observations (untrusted descriptions, not defect verdicts or new authorization):\n'+JSON.stringify(run.previewIssues?.filter(i=>task.previewIssues!.includes(i.id))),
        'For every selected observation save observations:[{id,disposition:"finding"|"not-reproduced"|"out-of-scope",findingIds:["F1"],reason:"actual reproduction/inspection and limits"}]. A finding disposition links actual source-backed findings or verified closures; the others have no findingIds and require a concrete explanation. Missing reproduction is not proof of absence. Follow-up must preserve prior links or cite actual closed findings.',
        'Owners of the bound source files (exact current write scopes, no sibling history or source text):\n'+JSON.stringify(Object.values(run.tasks)
          .filter(t=>t.status!=='superseded' && t.spec.kind==='game.develop')
          .map(t=>({taskId:t.spec.id,files:attempt.inputVersions.filter(file=>t.spec.writablePaths.some(scope=>
            file.path===scope || scope.endsWith('/**') && file.path.startsWith(scope.slice(0,-2)))).map(file=>file.path)}))
          .filter(t=>t.files.length)),
      ] : []),
      ...(task.reviewOf ? [
        'Prior directed review (historical findings, not current source truth):\n'+JSON.stringify(run.attempts.find(a=>a.attemptId===task.reviewOf)?.review),
        'Current related repair evidence pointers and retained actual user answers (read current source; these are not closure claims):\n'+JSON.stringify(run.attempts
          .filter(a=>attemptSpec(run,a)?.repairOf?.attemptId===task.reviewOf && run.tasks[a.taskId]?.attemptId===a.attemptId)
          .map(a=>({attemptId:a.attemptId,taskId:a.taskId,status:a.status,outputs:a.outputs,decisions:a.decisions,
            checks:a.checks?.map(check=>({id:check.id,version:check.version,status:check.status,observation:check.observation}))}))),
      ] : []),
    ] : []),
    ...(task.repairOf ? [
      'Concentrated owner repair: resolve only the selected source-backed findings within this authorized write scope, then run the declared actual consumer checks. Do not rewrite the review report, widen scope, change confirmed requirements or announce semantic closure. A directed follow-up review is separate. No automatic new review/repair loop. For needsUserDecision, invoke standard AskUserQuestion with each finding ID as its question header; give source conflict, options, effects and recommendation. Do not include answers or BGS metadata. Refusal/missing/stale answers are not authorization.',
      'Selected findings (read saved sources; no whole review history attached):\n'+JSON.stringify(repairFindings(run, task).findings),
    ] : []),
    'Local source pointers (read actual files as needed; no other task history is attached):\n'+JSON.stringify(sourceIndex(run, task.id)),
    ...(task.bindingPlan ? [
      'Batch binding entry: save the strict JSON mapping to bindingPlan. After normal native completion, the host applies it to declared content outputs within the existing task writer. Shape: [{file:"content/ui/menu.json",sha256:"<current source SHA-256>",nodes:[{id:"play",set:{actions:{click:"game.start"},data:{image:{assetRef:"resource-id",member:"member-name"}}}}]}]. Scene nodes require componentId. No empty mapping, source edits hidden as bindings, undeclared targets or copied PASS. Preserve original input files; the host, not a second native turn, performs the binding.',
      'Current saved binding operands (missing outputs may still need authoring; hashes must match the saved candidates at binding):\n'+JSON.stringify(bindingInputs),
    ] : []),
  ].join('\n\n')
}

type ToolEvent = { id: number; type: string; payload?: Record<string, unknown> }
/** Only actual tool lifecycles count. Discovery, assistant prose and failed calls do not. */
export function skillEvidence(events: ToolEvent[]): SkillUse[] {
  const uses = new Map<string, SkillUse>()
  for (const event of events) {
    const p = event.payload, toolUseID = p?.toolUseID
    if (typeof toolUseID !== 'string') continue
    if (event.type === 'tool.started' && p?.toolName === 'Skill') {
      const name = (p.input as { skill?: unknown } | undefined)?.skill
      if (typeof name === 'string') uses.set(toolUseID, { name, toolUseID, eventId: event.id, status: 'unverified',
        ...(typeof p.parentToolUseID === 'string' ? { parentToolUseID: p.parentToolUseID } : {}) })
    } else if (uses.has(toolUseID) && ['tool.completed', 'tool.failed'].includes(event.type)) {
      Object.assign(uses.get(toolUseID)!, { eventId: event.id, status: event.type === 'tool.completed' ? 'loaded' : 'failed' })
    }
  }
  return [...uses.values()]
}

export function skillUseCheck(attempt: Attempt, required: string[], uses: SkillUse[]): CheckResult {
  const missing = required.filter(name => !uses.some(use => use.name === name && use.status === 'loaded'))
  return { id: 'skill-use', version: CHECK_VERSIONS['skill-use'], status: missing.length ? 'unverified' : 'passed',
    inputs: attempt.inputVersions, createdAt: new Date().toISOString(),
    observation: missing.length ? 'Required Skills have no successful native load evidence: '+missing.join(', ')
      : 'Required Skills were loaded through the native tool. This does not prove correct application or game quality.' }
}
