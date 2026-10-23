import {test,expect} from 'bun:test'
import {verifySourceEditFaults} from './verify-workflow-v3-source-edits'

test('host saves handle lost responses and real child kills without models or unrelated writes',async()=>{
  const result=await verifySourceEditFaults({ownerId:'synthetic-owner'})
  expect(result.modelCalls).toBe(0)
  expect(result.fixtures).toHaveLength(4)
  expect(result.fixtures.filter(f=>f.writerUnresolved).map(f=>f.scenario)).toEqual(['reserved-crash'])
  expect(result.passed.length).toBeGreaterThan(20)
  // Evidence is deliberately retained, including the unresolved synthetic Run.
  // No cleanup guesses that a missing process grants permission to rewrite it.
},120000)
