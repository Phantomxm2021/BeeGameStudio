import { expect, test } from 'bun:test'
import { createAgentWorkflowDisplayProjection } from '../app'
import {
  createAcceptedIrChecklistFixture,
  completedChecklistRun,
  disposeAcceptedIrChecklistFixture,
} from '../beegame/delivery-workflow/test-fixtures/accepted-ir-checklist'
import { projectCurrentStageCard } from '../beegame/delivery-workflow/workflow-stage-card-history'

test('IR and Checklist displays do not inherit completed Reviewer timing, tasks or retry controls', async () => {
  const fixture = await createAcceptedIrChecklistFixture()
  try {
    const downstream = completedChecklistRun(fixture)
    downstream.foundationReviewStage!.currentCallElapsedMs = 123456
    downstream.foundationReviewStage!.historicalElapsedMs = 123456
    for (const step of ['GAME_IR_COMPILATION', 'CHECKLIST_DRAFTING'] as const) {
      const run = {
        ...downstream,
        documentStep: step,
        status: 'needs_action' as const,
        blockedReason: 'Current stage needs attention',
        elapsedMs: 100,
      }
      const display = await createAgentWorkflowDisplayProjection({
        run: JSON.parse(JSON.stringify(run)),
        workspacePath: fixture.workspace,
      })
      expect(display.stageId).toBe(
        step === 'GAME_IR_COMPILATION' ? step : 'CHECKLIST_AUTHORING',
      )
      expect(display.foundationTiming).toBeUndefined()
      expect(display.currentCallElapsedMs).toBeUndefined()
      expect(display.nextAction).toBe('retry')
      const tasks = display.tasks as Array<{ id: string }>
      expect(tasks.some(task => task.id === 'foundation-public-stage')).toBe(
        false,
      )
      if (step === 'GAME_IR_COMPILATION')
        expect(tasks[0]?.id).toBe('game-ir-public-stage')
      const card = projectCurrentStageCard({
        run,
        workspacePath: fixture.workspace,
      })!
      expect(
        card.tasks.some(task => task.id === 'foundation-public-stage'),
      ).toBe(false)
      expect(card.block?.nextAction).toBe('retry')
    }
    const ir = {
      ...downstream,
      documentStep: 'GAME_IR_COMPILATION' as const,
      status: 'needs_action' as const,
      blockedReason: 'Usage needs operator evidence',
    }
    ir.gameIrStage = {
      ...ir.gameIrStage!,
      outcome: {
        status: 'needs_action',
        handle: ir.gameIrStage!.handle!,
        billingStatus: 'pending',
        resumable: false,
        reason: 'Usage needs operator evidence',
      },
    }
    const pausedDisplay = await createAgentWorkflowDisplayProjection({
      run: JSON.parse(JSON.stringify(ir)),
      workspacePath: fixture.workspace,
    })
    expect(pausedDisplay.nextAction).toBeUndefined()
    expect(
      projectCurrentStageCard({ run: ir, workspacePath: fixture.workspace })
        ?.block?.nextAction,
    ).toBeUndefined()
  } finally {
    await disposeAcceptedIrChecklistFixture(fixture)
  }
})
