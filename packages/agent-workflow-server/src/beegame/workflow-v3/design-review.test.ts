import { expect, test } from 'bun:test'
import { DESIGN_REVIEW_INSTRUCTIONS, designReviewOutputSchema, designAuthorResultSchema, designAuthorOutputSchema, designReviewProgress, assertDesignReviewCoverage, assertDesignReviewReady, parseDesignReview, pendingDesignReviewFindings, type DesignReviewDisposition, type DesignReviewReceipt } from './design-review'
import { parseProductionResult } from './production-workflow'

const finding = { location: 'GDD Rules', issue: 'Conflicting transition', evidence: 'One event has two incompatible outcomes.', impact: 'The agreed behavior is ambiguous.' }
const disposition: DesignReviewDisposition = { finding: 1, status: 'rejected', evidence: 'Rules restricts this transition to idle; the reported counterexample assumes active.' }
const source = { path: 'docs/GDD.md', sha256: 'unchanged-candidate' }
function receipt(report: DesignReviewReceipt['report']): DesignReviewReceipt {
  return { source, nativeThreadId: 'reviewer', nativeTurnId: 'review-turn',
    startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:01Z', report }
}

test('a finding cannot be downgraded to advisory or bypass handoff in an otherwise valid report', () => {
  expect(DESIGN_REVIEW_INSTRUCTIONS).toContain('confirmed brief and saved GDD together')
  expect(DESIGN_REVIEW_INSTRUCTIONS).toContain('Requirements settled in the brief need not be repeated')
  expect(DESIGN_REVIEW_INSTRUCTIONS).toContain('mutually incompatible outcomes under the same applicable conditions')
  expect(DESIGN_REVIEW_INSTRUCTIONS).toContain('Read local details together with global definitions')
  expect(DESIGN_REVIEW_INSTRUCTIONS).toContain('undetermined required player action/information/outcome')
  expect(DESIGN_REVIEW_INSTRUCTIONS).toContain('changed user requirement')
  expect(DESIGN_REVIEW_INSTRUCTIONS).toContain('Each finding requires corrective work before handoff')
  expect(DESIGN_REVIEW_INSTRUCTIONS).toContain('Clarifications and suggestions without a demonstrated violation may be summarized, not turned into findings')
  expect(DESIGN_REVIEW_INSTRUCTIONS).toContain('a provisional choice does not override an explicit requirement')
  expect(DESIGN_REVIEW_INSTRUCTIONS).toContain('preserve user-stated appearance and source constraints')
  expect(DESIGN_REVIEW_INSTRUCTIONS).toContain('registration and runtime checks belong to production, not this review')
  expect(DESIGN_REVIEW_INSTRUCTIONS).not.toContain('a delivery obligation derived only from')
  expect(() => parseDesignReview(JSON.stringify({ summary: 'Optional', findings: [{ ...finding, severity: 'advisory' }] }))).toThrow('invalid report')
  const commitmentConflict = { location: 'GDD Starting values and Acceptance',
    issue: 'Explicitly provisional target made mandatory',
    evidence: 'The starting interval is adjustable; acceptance requires proving that same interval unchanged.',
    impact: 'An implementation choice becomes an additional delivery experiment.' }
  const review = receipt(parseDesignReview(JSON.stringify({ summary: 'Supported conflicts', findings: [finding, commitmentConflict] })))
  expect(review.report.findings).toEqual([finding, commitmentConflict])
  expect(() => assertDesignReviewReady(source, [review])).toThrow('unresolved review findings')
  expect(()=>assertDesignReviewReady(source,[receipt({summary:'Optional clarification only',findings:[]})])).not.toThrow()
})

test('follow-up requires exact coverage in the native schema and local report, not disappearance of earlier findings', () => {
  const initial = designReviewOutputSchema(0)
  expect(initial.required).toEqual(['summary', 'findings'])
  expect(initial.properties).not.toHaveProperty('resolutions')
  expect(initial.additionalProperties).toBe(false)
  const followup = designReviewOutputSchema(2)
  expect(followup.required).toEqual(['summary', 'findings', 'resolutions'])
  expect(followup.properties!.resolutions).toMatchObject({ type: 'array', minItems: 2, maxItems: 2,
    items: { required: ['finding', 'status', 'evidence'], additionalProperties: false,
      properties: { finding: { type: 'integer', minimum: 1, maximum: 2 }, evidence: { minLength: 1 } } } })
  expect(DESIGN_REVIEW_INSTRUCTIONS).not.toContain('Omit on initial review')
  // Even a corrected claim and a new finding cannot substitute for a numbered resolution.
  expect(() => parseDesignReview(JSON.stringify({ summary: 'Original finding corrected; new defect found', findings: [finding] }), 1))
    .toThrow('exactly one evidence-backed disposition')
  for (const resolutions of [undefined, [], [disposition, disposition], [{ ...disposition, finding: 2 }]]) {
    expect(() => parseDesignReview(JSON.stringify({ summary: 'All fixed', findings: [], resolutions }), 1)).toThrow('exactly one evidence-backed disposition')
  }
  expect(() => parseDesignReview(JSON.stringify({ summary: 'Fixed', findings: [], resolutions: [{ ...disposition, evidence: ' ' }] }), 1)).toThrow('invalid report')
})

test('an evidence-backed rejection can hand off without unnecessary document changes', () => {
  const initial = receipt({ summary: 'Reported conflict', findings: [{ ...finding,
    evidence: 'Global controls include Pause; the preparation-state row does not repeat it.' }] })
  const response: DesignReviewDisposition = { finding: 1, status: 'rejected', evidence: 'Global Pause applies during preparation; the local row does not restrict global controls.' }
  const final = receipt(parseDesignReview(JSON.stringify({ summary: 'Original finding disproven', findings: [], resolutions: [response] }), 1))
  final.authorResponses = [response]
  expect(() => assertDesignReviewReady(source, [initial, final])).not.toThrow()
  delete final.authorResponses
  expect(() => assertDesignReviewReady(source, [initial, final])).not.toThrow()
})

test('reviewer resolution decides uncertain author responses but cannot excuse new defects or changed sources', () => {
  const initial = receipt({ summary: 'Reported conflict', findings: [finding] })
  for (const status of ['author-unresolved', 'reviewer-unresolved', 'new-defect'] as const) {
    const final = receipt({ summary: 'Follow-up', findings: status === 'new-defect' ? [finding] : [],
      resolutions: [{ ...disposition, status: status === 'reviewer-unresolved' ? 'unresolved' : 'corrected' }] })
    final.authorResponses = [{ ...disposition, status: status === 'author-unresolved' ? 'unresolved' : 'corrected' }]
    if (status === 'author-unresolved') expect(() => assertDesignReviewReady(source, [initial, final])).not.toThrow()
    else expect(() => assertDesignReviewReady(source, [initial, final])).toThrow('unresolved review findings')
  }
  expect(() => assertDesignReviewReady({ ...source, sha256: 'changed' }, [receipt({ summary: 'Checked', findings: [] })])).toThrow('changed after')
})

test('author responses extend the small final result, never replace the saved draft with a returned body', () => {
  const task = { stage: 'design' as const, originRequestKey: 'synthetic' }
  const value = { status: 'ready', summary: 'Rejected the unsupported finding', reviewResponses: [disposition] }
  expect(parseProductionResult(task, value)).toMatchObject({ action: 'advance', reviewResponses: [disposition] })
  for (const invalid of [{ ...value, document: '# Replacement' },
    { ...value, reviewResponses: [{ ...disposition, finding: 0 }] },
    { ...value, reviewResponses: [{ ...disposition, evidence: '' }] }])
    expect(() => parseProductionResult(task, invalid)).toThrow('missing or invalid')
})

test('successive revision lists use current indices and retain unresolved issues omitted from new findings', () => {
  const first = receipt({ summary: 'Two issues', findings: [finding, { ...finding, issue: 'Second defect' }] })
  const second = receipt({ summary: 'One resolved, one remains, one new', findings: [{ ...finding, issue: 'New dependent defect' }],
    resolutions: [{ ...disposition, status: 'unresolved' }, { ...disposition, finding: 2, status: 'corrected' }] })
  second.authorResponses = [disposition, { ...disposition, finding: 2 }]
  const pending = pendingDesignReviewFindings(second.report, first.report.findings)
  expect(pending.map(item => item.issue)).toEqual([finding.issue, 'New dependent defect'])
  const third = receipt({ summary: 'One remains', findings: [],
    resolutions: [{ ...disposition, status: 'corrected' }, { ...disposition, finding: 2, status: 'unresolved' }] })
  third.authorResponses = [disposition, { ...disposition, finding: 2 }]
  const last = receipt({ summary: 'Resolved', findings: [], resolutions: [disposition] })
  last.authorResponses = [disposition]
  expect(() => assertDesignReviewReady(source, [first, second, third, last])).not.toThrow()
  last.report.resolutions = [{ ...disposition, finding: 2 }]
  expect(() => assertDesignReviewReady(source, [first, second, third, last])).toThrow('exactly one')
})


test('author output stays stable while exact evidence coverage belongs to independent review', () => {
  const task = {stage:'design' as const, originRequestKey:'synthetic'}
  const schema = designAuthorOutputSchema()
  expect(schema).toMatchObject({type:'object',additionalProperties:false,required:['status','summary'],
    properties:{status:{enum:['ready','blocked']}}})
  expect(schema.anyOf).toBeUndefined()
  expect(schema.properties).not.toHaveProperty('reviewResponses')
  expect(designAuthorOutputSchema(true).properties!.status).toMatchObject({enum:['ready','blocked','answered']})
  const revision={status:'ready',summary:'Saved revision'}
  expect(designAuthorResultSchema().safeParse(revision).success).toBe(true)
  expect(parseProductionResult(task,revision)).toMatchObject({action:'advance',summary:'Saved revision'})
  expect(designAuthorResultSchema().safeParse({status:'blocked',summary:'Needs a user decision'}).success).toBe(true)
  expect(()=>parseProductionResult(task,{status:'blocked',summary:'Needs a user decision'})).toThrow('Needs a user decision')
  const previousNotes={...revision,reviewResponses:[disposition]}
  expect(parseProductionResult(task,previousNotes)).toMatchObject({reviewResponses:[disposition]})
})

test('restored receipts retain pending findings, round and no-progress budget and reject broken history', () => {
  const first=receipt({summary:'Two issues',findings:[finding,{...finding,issue:'Second issue'}]})
  const second=receipt({summary:'One remains and one new',findings:[{...finding,issue:'New issue'}],
    resolutions:[{...disposition,status:'unresolved'},{...disposition,finding:2}]})
  second.authorResponses=[disposition,{...disposition,finding:2}]
  expect(designReviewProgress([first,second])).toMatchObject({rounds:2,bestCount:2,stalled:1})
  expect(designReviewProgress([first,second]).findings.map(item=>item.issue)).toEqual([finding.issue,'New issue'])
  const third=receipt({summary:'Still unresolved',findings:[],resolutions:[{...disposition,status:'unresolved'},{...disposition,finding:2,status:'unresolved'}]})
  third.authorResponses=[disposition,{...disposition,finding:2}]
  expect(designReviewProgress([first,second,third])).toMatchObject({rounds:3,bestCount:2,stalled:2})
  const repaired=receipt({summary:'All resolved',findings:[],resolutions:[disposition,{...disposition,finding:2}]})
  repaired.authorResponses=[disposition,{...disposition,finding:2}]
  expect(designReviewProgress([first,second,repaired])).toMatchObject({findings:[],bestCount:Infinity,stalled:0})
  const changed=receipt({summary:'A newly changed source has an issue',findings:[finding]})
  expect(designReviewProgress([first,second,repaired,changed])).toMatchObject({findings:[finding],bestCount:1,stalled:0})
  const withoutAuthorNotes=structuredClone(second);delete withoutAuthorNotes.authorResponses
  expect(()=>assertDesignReviewReady(source,[first,withoutAuthorNotes,repaired])).not.toThrow()
  const corrupt=structuredClone(second);delete corrupt.report.resolutions
  expect(()=>assertDesignReviewReady(source,[first,corrupt,repaired])).toThrow('GDD reviewer round 2')
})

test('coverage errors identify the actor, round and affected numbers without exposing evidence', () => {
  let error=''
  try {assertDesignReviewCoverage([disposition,disposition,{...disposition,finding:3}],2,'GDD reviewer round 4')}
  catch(value){error=(value as Error).message}
  expect(error).toContain('GDD reviewer round 4')
  expect(error).toContain('"missing":[2]')
  expect(error).toContain('"duplicate":[1]')
  expect(error).toContain('"unknown":[3]')
  expect(error).not.toContain(disposition.evidence)
  expect(()=>parseDesignReview(JSON.stringify({summary:'Corrected',findings:[]}),1,4)).toThrow('GDD reviewer round 4')
})


test('three corrected findings require independent evidence, not an author disposition envelope', () => {
  const initial = receipt({ summary: 'Three source conflicts', findings: [finding,
    { ...finding, issue: 'Second conflict' }, { ...finding, issue: 'Third conflict' }] })
  const resolutions = [1, 2, 3].map(id => ({ ...disposition, finding: id }))
  const checked = receipt(parseDesignReview(JSON.stringify({ summary: 'Saved definitions checked', findings: [], resolutions }), 3, 2))
  expect(checked.authorResponses).toBeUndefined()
  expect(() => assertDesignReviewReady(source, [initial, checked])).not.toThrow()
  for (const invalid of [[], resolutions.slice(0, 2), [resolutions[0], resolutions[0], resolutions[2]],
    [resolutions[0], resolutions[1], { ...disposition, finding: 4 }]]) {
    expect(() => parseDesignReview(JSON.stringify({ summary: 'Claims fixed', findings: [], resolutions: invalid }), 3, 2))
      .toThrow('exactly one evidence-backed disposition')
  }
  const unresolved = receipt({ summary: 'Third still conflicts', findings: [],
    resolutions: resolutions.map(item => item.finding === 3 ? { ...item, status: 'unresolved' } : item) })
  expect(() => assertDesignReviewReady(source, [initial, unresolved])).toThrow('unresolved review findings')
})
