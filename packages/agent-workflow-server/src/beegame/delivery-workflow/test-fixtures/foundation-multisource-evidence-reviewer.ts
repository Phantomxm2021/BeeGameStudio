/** Offline reviewer fixture for the root Author/Reviewer/Revision handoff test. */
export {}
let pending = ''
const mode = process.argv.find(arg => arg.startsWith('--fixture-mode='))?.split('=')[1] ?? 'initial'
const output = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`)
const required = new Set([
  'GDD#player_actions',
  'GDD#rules_systems',
  'LEVEL#material.route-choice-diagram',
])
const routeChoiceContract = 'route_choice_contract:'

function sectionKeys(packet: Record<string, unknown>): string[] {
  const sections = Array.isArray(packet.sections) ? packet.sections : []
  return sections.flatMap(section => {
    if (!section || typeof section !== 'object' || Array.isArray(section)) return []
    const value = section as Record<string, unknown>
    if (typeof value.sectionKey === 'string') return [value.sectionKey]
    const ref = value.ref
    if (ref && typeof ref === 'object' && !Array.isArray(ref)) {
      const record = ref as Record<string, unknown>
      if (typeof record.documentPath === 'string' && typeof record.sectionId === 'string')
        return [`${sectionKey(record.documentPath)}#${record.sectionId}`]
    }
    if (typeof value.documentPath === 'string' && typeof value.sectionId === 'string')
      return [`${sectionKey(value.documentPath)}#${value.sectionId}`]
    return []
  })
}

function sectionKey(documentPath: string): string {
  if (documentPath === 'docs/GDD.md') return 'GDD'
  if (documentPath === 'docs/LEVEL_SCENE_DESIGN.md') return 'LEVEL'
  return documentPath
}

for await (const chunk of Bun.stdin.stream()) {
  pending += new TextDecoder().decode(chunk, { stream: true })
  for (;;) {
    const newline = pending.indexOf('\n')
    if (newline < 0) break
    const line = pending.slice(0, newline)
    pending = pending.slice(newline + 1)
    if (!line.trim()) continue
    const message = JSON.parse(line)
    if (message.type !== 'user') continue
    const prompt = message.message.content.map((block: { text: string }) => block.text).join('')
    const marker = 'Model packet contract: '
    const contract = JSON.parse(prompt.slice(prompt.lastIndexOf(marker) + marker.length)) as Record<string, unknown>
    const packet = contract.packet as Record<string, unknown>
    if (contract.workerType === 'foundation-fact-extractor') {
      output({ type: 'result', subtype: 'success', modelUsage: { fixture: { inputTokens: 1, outputTokens: 1 } },
        structured_output: { status: 'completed', results: (Array.isArray(packet.keys) ? packet.keys : []).map((key: string) => ({ key, status: 'absent' })) } })
      continue
    }
    const shouldCheckEvidence = mode === 'targeted' || (mode === 'initial' && contract.checkId === 'SEM.gameplay_level_viability')
    const keys = sectionKeys(packet)
    const missing = [...required].filter(key => !keys.includes(key))
    if (shouldCheckEvidence && missing.length) {
      // A fixture must fail closed when evidence is omitted; it is not a constant PASS oracle.
      if (mode === 'initial') throw new Error(`missing evidence: ${missing.join(', ')}`)
      const evidence = (Array.isArray(packet.sections) ? packet.sections : []).flatMap(section => {
        if (!section || typeof section !== 'object' || Array.isArray(section)) return []
        const value = section as Record<string, unknown>
        const ref = value.ref && typeof value.ref === 'object' && !Array.isArray(value.ref) ? value.ref as Record<string, unknown> : value
        return typeof ref.documentPath === 'string' && typeof ref.sectionId === 'string' && typeof ref.digest === 'string'
          ? [{ documentPath: ref.documentPath, sectionId: ref.sectionId, digest: ref.digest }] : []
      })
      output({ type: 'result', subtype: 'success', modelUsage: { fixture: { inputTokens: 1, outputTokens: 1 } },
        structured_output: { status: 'FAIL', diagnostic: { observedActual: `missing evidence: ${missing.join(', ')}`, failureReasonCode: 'evidence_insufficient', evidence } } })
      continue
    }
    if (mode === 'initial' && contract.checkId === 'SEM.gameplay_level_viability') {
      output({ type: 'result', subtype: 'success', modelUsage: { fixture: { inputTokens: 1, outputTokens: 1 } }, structured_output: {
        status: 'completed', outcome: 'ISSUES', issues: [{
          problem: 'Player actions must expose readable feedback while preserving the canonical rules and route evidence.',
          expected: 'route_choice_contract: readable', actual: 'route_choice_contract: missing',
          sourceSectionKey: 'GDD#player_actions',
          supportingSectionKeys: ['GDD#rules_systems'],
          remediation: { kind: 'patch', sectionKeys: ['LEVEL#material.route-choice-diagram'] },
        }],
      } })
    } else {
      let targetedRouteReadable = true
      if (mode === 'targeted' && contract.workerType === 'foundation-semantic-reviewer') {
        const target = (Array.isArray(packet.sections) ? packet.sections : []).find((section: unknown) => {
          if (!section || typeof section !== 'object' || Array.isArray(section)) return false
          const value = section as Record<string, unknown>
          const ref = value.ref && typeof value.ref === 'object' && !Array.isArray(value.ref)
            ? value.ref as Record<string, unknown> : value
          return ref.documentPath === 'docs/LEVEL_SCENE_DESIGN.md' && ref.sectionId === 'material.route-choice-diagram'
        }) as Record<string, unknown> | undefined
        const content = typeof target?.content === 'string' ? target.content : ''
        targetedRouteReadable = content.includes(routeChoiceContract) && content.includes('route_choice_contract: readable') && !content.includes('route_choice_contract: missing')
      }
      if (mode === 'targeted' && contract.workerType === 'foundation-semantic-reviewer' && !targetedRouteReadable) {
        const evidence = (Array.isArray(packet.sections) ? packet.sections : []).flatMap(section => {
          if (!section || typeof section !== 'object' || Array.isArray(section)) return []
          const value = section as Record<string, unknown>
          const ref = value.ref && typeof value.ref === 'object' && !Array.isArray(value.ref) ? value.ref as Record<string, unknown> : value
          return typeof ref.documentPath === 'string' && typeof ref.sectionId === 'string' && typeof ref.digest === 'string'
            ? [{ documentPath: ref.documentPath, sectionId: ref.sectionId, digest: ref.digest }] : []
        })
        output({ type: 'result', subtype: 'success', modelUsage: { fixture: { inputTokens: 1, outputTokens: 1 } },
          structured_output: { status: 'FAIL', diagnostic: { observedActual: 'route_choice_contract: missing', failureReasonCode: 'evidence_insufficient', evidence } } })
        continue
      }
      output({ type: 'result', subtype: 'success', modelUsage: { fixture: { inputTokens: 1, outputTokens: 1 } },
        structured_output: mode === 'targeted' ? { status: 'PASS' } : { status: 'completed', outcome: 'PASS' } })
    }
  }
}
