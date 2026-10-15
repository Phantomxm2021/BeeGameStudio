import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { inspectVisualHandoff } from './visual-handoff'
import { agentTurnHandoffReason } from './agent-goal'
import { createRun, type AgentTurn } from './state'

test('visual handoff requires two real project PNGs without claiming visual quality', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-visual-handoff-'))
  try {
    const absent = await inspectVisualHandoff(root)
    expect(absent.ready).toBe(false)
    expect(absent.issues).toHaveLength(2)
    await mkdir(join(root, 'assets/visual'), { recursive: true })
    await writeFile(join(root, 'assets/visual/ui-board.png'), 'not an image')
    expect((await inspectVisualHandoff(root)).issues[0]).toContain('invalid')
    const png = await sharp({ create: { width: 24, height: 16, channels: 4, background: '#102030' } }).png().toBuffer()
    await writeFile(join(root, 'assets/visual/ui-board.png'), png)
    await writeFile(join(root, 'assets/visual/scene-board.png'), png)
    expect((await inspectVisualHandoff(root)).issues).toContain('UI and scene boards are byte-identical')
    await writeFile(join(root, 'assets/visual/scene-board.png'), await sharp({ create: {
      width: 24, height: 16, channels: 4, background: '#304050',
    } }).png().toBuffer())
    const ready = await inspectVisualHandoff(root)
    expect(ready.ready).toBe(true)
    expect(ready.boards.map(board => [board.path, board.width, board.height])).toEqual([
      ['assets/visual/ui-board.png', 24, 16], ['assets/visual/scene-board.png', 24, 16],
    ])
    expect(ready.note).toContain('coverage')
    const initial=createRun({projectId:'visual-test',ownerId:'owner',workspacePath:root,chatSessionId:'chat',
      requestKey:'goal',text:'Inspect visual handoff',constraints:{},ids:['goal']})
    expect(await agentTurnHandoffReason(initial,{} as AgentTurn)).not.toContain('Visual boards')
    expect(await agentTurnHandoffReason(initial,{} as AgentTurn)).not.toContain('Await an explicit visual-direction decision')
    const premature={measurements:[{requestKey:'premature'}]} as AgentTurn
    initial.agentTurns=[premature]
    expect(await agentTurnHandoffReason(initial,premature)).toContain('measurement freshness could not be verified')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('visual handoff does not inspect an image symlink outside the project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-visual-handoff-'))
  const outside = await mkdtemp(join(tmpdir(), 'bgs-visual-outside-'))
  try {
    await mkdir(join(root, 'assets/visual'), { recursive: true })
    await writeFile(join(outside, 'other.png'), await sharp({ create: { width: 2, height: 2, channels: 4,
      background: '#000000' } }).png().toBuffer())
    await symlink(join(outside, 'other.png'), join(root, 'assets/visual/ui-board.png'))
    expect((await inspectVisualHandoff(root)).issues).toContain('assets/visual/ui-board.png resolves outside the project')
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }) }
})

test('one combined design board can satisfy the file handoff without claiming visual quality', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-visual-handoff-'))
  try {
    await mkdir(join(root, 'assets/visual'), { recursive: true })
    const path = join(root, 'assets/visual/design-board.png')
    await writeFile(path, await sharp({ create: { width: 24, height: 16, channels: 4,
      background: '#102030' } }).png().toBuffer())
    const ready = await inspectVisualHandoff(root)
    expect(ready.ready).toBe(true)
    expect(ready.boards.map(board => board.path)).toEqual(['assets/visual/design-board.png'])
    expect(ready.note).toContain('coverage')
    await writeFile(path, 'not an image')
    expect((await inspectVisualHandoff(root)).ready).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
})
