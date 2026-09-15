import type { SceneDocument, SceneOperation, ScenePatchV1 } from './model'
import { applyPatch, patchFor } from './commands'
import { clone } from './model'

type Entry = { label: string; forward: SceneOperation[]; inverse: SceneOperation[] }
export class SceneHistory {
  private undoStack: Entry[] = []; private redoStack: Entry[] = []; private initialSource: SceneDocument['source']
  constructor(private current: SceneDocument) { this.initialSource = clone(current.source) }
  get document() { return this.current }
  get canUndo() { return this.undoStack.length > 0 }
  get canRedo() { return this.redoStack.length > 0 }
  get lastOperations() { return this.undoStack.at(-1)?.forward ?? [] }
  get committedOperations() { return clone(this.undoStack.flatMap(entry => entry.forward)) }
  get baseSource() { return clone(this.initialSource) }
  setBaseSource(source: SceneDocument['source']) { this.initialSource = clone(source) }
  commit(operations: SceneOperation[], label: string) {
    const forward = clone(operations); const result = applyPatch(this.current, patchFor(this.current, forward, label)); if (!result.applied) throw Error(result.diagnostic)
    this.current = result.document; this.undoStack.push({ label, forward, inverse: clone(result.inverse) }); this.redoStack = []; return this.current
  }
  importPatch(patch: ScenePatchV1) {
    const result = applyPatch(this.current, patch); if (!result.applied) throw Error(result.diagnostic)
    if (result.inverse.length) { this.current = result.document; this.undoStack.push({ label: patch.label, forward: clone(patch.operations), inverse: clone(result.inverse) }); this.redoStack = [] }
    return this.current
  }
  undo() { const e = this.undoStack.at(-1); if (!e) return this.current; const result = applyPatch(this.current, patchFor(this.current, e.inverse, `Undo ${e.label}`)); if (!result.applied) throw Error(`Undo rejected: ${result.diagnostic}`); this.current = result.document; this.undoStack.pop(); this.redoStack.push(e); return this.current }
  redo() { const e = this.redoStack.at(-1); if (!e) return this.current; const result = applyPatch(this.current, patchFor(this.current, e.forward, `Redo ${e.label}`)); if (!result.applied) throw Error(`Redo rejected: ${result.diagnostic}`); this.current = result.document; this.redoStack.pop(); this.undoStack.push(e); return this.current }
  clear() { this.undoStack = []; this.redoStack = [] }
}
