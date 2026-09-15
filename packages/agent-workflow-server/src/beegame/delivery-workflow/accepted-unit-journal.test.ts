import { describe, expect, test } from 'bun:test'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import { deriveAcceptedWorkflowUnits } from './accepted-unit-journal'
import type { DeliveryRun } from './types'

describe('accepted workflow unit journal', () => {
  test('implementation and acceptance evidence retain the same IR dependency', () => {
    const previous = createTestDeliveryRun({ ownerId: 'owner', projectId: 'project' })
    const next: DeliveryRun = { ...previous, phase: 'DELIVERY',
      resourceProductionState: { currentTask: 'RESOURCE_DELIVERED', irResultId: 'b'.repeat(64) },
      tasks: [{ id: 'DIRECT_IMPLEMENTATION', title: 'Scene', checklistIds: ['scene-loads'], resourceIds: [], contentIds: [],
        allowedPaths: ['src/scene.ts'],
        status: 'completed', attempt: 1, completedRevision: previous.revision.workspace, evidenceRefs: ['scene-proof.json'] }],
      evidence: {
        acceptance: { kind: 'acceptance', path: 'acceptance.json', status: 'passed',
          revision: previous.revision.workspace, observedAt: previous.updatedAt },
      } }
    const units = deriveAcceptedWorkflowUnits(previous, next)
    expect(units.map(value => value.unitId)).toEqual(['implementation:DIRECT_IMPLEMENTATION', 'acceptance:delivery'])
    expect(units[0]?.predecessorUnitIds).toEqual(['game-content:delivery'])
    expect(units[1]?.predecessorUnitIds).toEqual(['implementation:DIRECT_IMPLEMENTATION'])
    for (const unit of units) expect(unit.dependencyDigests).toEqual({ gameIr: 'b'.repeat(64) })
  })

  test('records the accepted Scene/UI package between resources and implementation', () => {
    const previous = createTestDeliveryRun({ ownerId: 'owner', projectId: 'project' })
    const contentRevision = 'c'.repeat(64)
    const resourceRevision = 'b'.repeat(64)
    const irRevision = 'a'.repeat(64)
    const next: DeliveryRun = {
      ...previous,
      phase: 'IMPLEMENTATION',
      revision: { ...previous.revision, resource: resourceRevision, content: contentRevision },
      resourceProductionState: { currentTask: 'RESOURCE_DELIVERED', irResultId: irRevision,
        deliveryReceipt: { bindings: [], catalogObserved: false, resourceDigest: resourceRevision,
          acceptedAt: previous.updatedAt } },
      gameContentReceipt: { schemaVersion: 'game-content-ready.v1', contentRevision,
        irRevision, assetManifestRevision: resourceRevision, indexPath: 'content/index.json',
        contentIds: ['scene.main', 'ui.hud'] },
      evidence: { gameContent: { kind: 'game_content', path: 'content/index.json',
        status: 'passed', revision: contentRevision, observedAt: previous.updatedAt } },
    }
    expect(deriveAcceptedWorkflowUnits(previous, next)).toEqual([
      expect.objectContaining({
        unitId: 'game-content:delivery', kind: 'game-content',
        predecessorUnitIds: ['resource:delivery'], inputRevision: contentRevision,
        dependencyDigests: { gameIr: irRevision, resource: resourceRevision },
        payload: { receiptRef: 'content/index.json', irRevision,
          assetManifestRevision: resourceRevision, contentIds: ['scene.main', 'ui.hud'] },
      }),
    ])
  })

  test('does not duplicate Reviewer semantics into accepted-unit events', () => {
    const previous = createTestDeliveryRun({
      runId: 'journal-review',
      projectId: 'project',
      ownerId: 'owner',
      foundationDraftComplete: true,
    })
    const next = {
      ...previous,
      phase: 'DOCUMENT_REVIEW' as const,
      documentStep: 'CHECKLIST_DRAFTING' as const,
    }

    expect(deriveAcceptedWorkflowUnits(previous, next)).toEqual([])
  })

  test('records one accepted unit for the direct resource delivery', () => {
    const previous = createTestDeliveryRun({
      runId: 'journal-resource',
      projectId: 'project',
      ownerId: 'owner',
    })
    const next = {
      ...previous,
      phase: 'IMPLEMENTATION' as const,
      resourceProductionState: {
        currentTask: 'RESOURCE_DELIVERED' as const,
        irResultId: 'a'.repeat(64),
        deliveryReceipt: {
          bindings: [
            { requirementId: 'requirement', resourceIds: ['resource'] },
          ],
          catalogObserved: true,
          resourceDigest: 'resource-digest',
          acceptedAt: previous.updatedAt,
        },
      },
      evidence: {
        resourcePreparation: {
          kind: 'resource_preparation' as const,
          path: 'assets/asset-manifest.json',
          status: 'passed' as const,
          revision: 'resource-revision',
          observedAt: previous.updatedAt,
        },
      },
    }

    expect(deriveAcceptedWorkflowUnits(previous, next)).toEqual([
      expect.objectContaining({
        kind: 'resource-delivery',
        unitId: 'resource:delivery',
        predecessorUnitIds: [],
        dependencyDigests: {
          gameIr: 'a'.repeat(64),
          resource: 'resource-digest',
        },
        payload: {
          receiptRef: 'assets/asset-manifest.json',
          bindings: [
            { requirementId: 'requirement', resourceIds: ['resource'] },
          ],
          catalogObserved: true,
        },
      }),
    ])
  })
})
